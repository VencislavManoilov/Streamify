const crypto = require('crypto');
const logger = require('./logger');
const media = require('./media');
const { readMatroska } = require('./matroska');
const { HlsService, buildPlan } = require('./hls');
const TorrentManager = require('./torrentManager');
const { parseRelease } = require('./releaseInfo');
const { markFailed } = require('./streamSources');

// How long a torrent gets to find peers and its file list before another one is better tried
const METADATA_WAIT = 30 * 1000;
// And then to bring in the start and the end of the file, where its header and index are
const INSPECT_WAIT = 60 * 1000;
const KEEP_INSPECTED = 300;

function errorWith(status, code, message) {
    return Object.assign(new Error(message), { status, code });
}

// Without ffprobe the file name is all there is to go by
function guessInfo(file) {
    const release = parseRelease(file.name);
    const container = release.container === 'mkv' ? 'matroska' : release.container === 'webm' ? 'webm' : release.container ? 'mp4' : 'unknown';
    return {
        container,
        duration: null,
        startTime: 0,
        guessed: true,
        video: { codec: release.codec || 'h264', tenBit: release.tenBit, height: 0, width: 0 },
        audio: release.audio ? [{ position: 0, codec: release.audio, channels: 2, language: '', title: '', default: true }] : []
    };
}

/**
 * Gets episodes from their torrents to the browser: finds the episode's file in the torrent, looks at what
 * is in it and decides whether the browser gets it as it is or converted (see utils/hls.js).
 */
class Playback {
    constructor({ port, cacheDir, transcode }) {
        this.port = port;
        // ffmpeg reads torrents through the server's own address, this keeps that route to itself
        this.secret = crypto.randomBytes(18).toString('hex');
        this.hls = new HlsService({ cacheDir, transcode });
        this.inspected = new Map(); // "hash:file" -> promise of { info, keyframes }
        this.torrents = new Map(); // hash -> { name, trackers }, to load a torrent again after it was removed
        this.tools = { available: false, version: null };
        this.toolsChecked = media.checkTools().then((tools) => {
            this.tools = tools;
        });
    }

    get manager() {
        return global.torrentManager;
    }

    // What this server can do with files the browser can't play
    get abilities() {
        return {
            ffmpeg: this.tools.available,
            transcodeVideo: this.tools.available && this.hls.transcode.enabled
        };
    }

    // The first name a torrent got stays, it's the nicer one from prepare()
    torrentSource(source, name) {
        const known = this.torrents.get(source.hash);
        const torrent = { name: (known && known.name) || name || source.release, trackers: source.trackers || (known && known.trackers) || [] };
        this.torrents.set(source.hash, torrent);
        return torrent;
    }

    knownTorrent(hash) {
        return this.torrents.get(hash) || null;
    }

    inputUrl(hash, fileIndex) {
        return `http://127.0.0.1:${this.port}/internal/${this.secret}/torrents/${hash}/${fileIndex}`;
    }

    /**
     * Takes a lease on the torrent of `source` and finds the episode's file in it. Rejects with code
     * 'no-peers' when the torrent doesn't load within `wait`, or 'no-file' when the episode isn't in it.
     * Call `release()` of the result when done.
     */
    async open(source, selector, name, wait = METADATA_WAIT) {
        const acquiring = this.manager.acquire(source.hash, this.torrentSource(source, name));
        let timer;
        const timeout = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(errorWith(504, 'no-peers', "The torrent didn't find anyone to download it from")), wait);
        });

        let lease;
        try {
            lease = await Promise.race([acquiring, timeout]);
        } catch (err) {
            // It may still load later, its lease is given back then
            acquiring.then(late => late.release(), () => {});
            if (err.code) throw err;
            throw errorWith(504, 'no-peers', err.message);
        } finally {
            clearTimeout(timer);
        }

        const file = TorrentManager.pickVideoFile(lease.torrent, selector);
        if (!file) {
            lease.release();
            throw errorWith(404, 'no-file', "This torrent doesn't have the episode in it");
        }
        return { lease, torrent: lease.torrent, file, fileIndex: lease.torrent.files.indexOf(file) };
    }

    /**
     * What the file holds and where its keyframes are, found once per file. An MKV says it all in its header
     * and index, which are read straight from the torrent. Anything else is shown to ffprobe.
     */
    inspect(hash, fileIndex, file) {
        const key = `${hash}:${fileIndex}`;
        if (!this.inspected.has(key)) {
            const task = (async () => {
                await this.toolsChecked;
                if (/\.(mkv|webm)$/i.test(file.name)) {
                    const read = (start, length) => TorrentManager.readFileRange(file, start, length);
                    const info = await readMatroska(read, file.length).catch((err) => {
                        logger.warn(`Could not read the header of "${file.name}": ${err.message}`);
                        return null;
                    });
                    if (info && info.video) return { info, keyframes: info.keyframes };
                }
                const info = this.tools.available ? await media.probe(this.inputUrl(hash, fileIndex)) : guessInfo(file);
                return { info, keyframes: null };
            })();
            this.inspected.set(key, task);
            task.catch(() => this.inspected.delete(key));
            // The oldest go first
            if (this.inspected.size > KEEP_INSPECTED) this.inspected.delete(this.inspected.keys().next().value);
        }
        return this.inspected.get(key);
    }

    variantOf(decision) {
        return `a${decision.audio ? decision.audio.position : 'x'}-${decision.video}`;
    }

    // The HLS session of a file in a variant like "a1-copy" (audio track 1, video kept as it is)
    session({ hash, fileIndex, variant, inspected, name }) {
        const key = `${hash}-${fileIndex}-${variant}`;
        const existing = this.hls.get(key);
        if (existing) return existing;

        const match = /^a(\d+|x)-(copy|transcode)$/.exec(variant);
        if (!match) throw errorWith(400, 'bad-variant', 'Unknown video variant');
        const audio = match[1] === 'x' ? null : inspected.info.audio.find(track => track.position === Number(match[1]));
        if (match[1] !== 'x' && !audio) throw errorWith(404, 'no-audio', 'No such audio track');
        if (match[2] === 'transcode' && !this.abilities.transcodeVideo) throw errorWith(415, 'unsupported', 'Converting video is turned off');

        const plan = buildPlan(inspected.info, { video: match[2], audio, keyframes: inspected.keyframes });
        if (!plan) throw errorWith(415, 'unsupported', "This video can't be converted");
        return this.hls.open(key, { name, inputUrl: this.inputUrl(hash, fileIndex), plan });
    }

    /**
     * Gets an episode ready to play and says how: { mode: 'direct' | 'hls', url, ... }. `caps` are the codecs
     * and containers the viewer's browser plays, `audioTrack` the position of a track the viewer picked, `at`
     * the second the viewer starts from.
     */
    async prepare({ series, season, episode, source, caps, audioTrack = null, at = 0 }) {
        const started = Date.now();
        const selector = { fileIdx: source.fileIdx, filename: source.filename, season, episode };
        const name = `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
        let opened;
        try {
            opened = await this.open(source, selector, name);
        } catch (err) {
            if (err.code === 'no-peers') markFailed(source.hash);
            throw err;
        }
        const { lease, file, fileIndex } = opened;
        const loaded = Date.now();

        try {
            let inspected;
            let timer;
            try {
                inspected = await Promise.race([
                    this.inspect(source.hash, fileIndex, file),
                    new Promise((resolve, reject) => {
                        timer = setTimeout(() => reject(errorWith(504, 'no-peers', "The torrent doesn't bring in any data")), INSPECT_WAIT);
                    })
                ]);
            } catch (err) {
                if (err.code === 'no-peers') {
                    markFailed(source.hash);
                    throw err;
                }
                logger.warn(`Could not read "${file.name}": ${(err.stderr || err.message || '').trim().split('\n').pop()}`);
                throw errorWith(422, 'unreadable', "The video file couldn't be read");
            } finally {
                clearTimeout(timer);
            }
            const { info } = inspected;

            const decision = media.decide(info, caps, {
                audioTrack,
                originalLanguage: series.original_language,
                ffmpeg: this.abilities.ffmpeg,
                transcodeVideo: this.abilities.transcodeVideo,
                canCopy: !!(inspected.keyframes && inspected.keyframes.length)
            });
            if (decision.mode === 'unsupported') {
                throw errorWith(415, 'unsupported', "This video's format can't be played in this browser");
            }

            logger.info(`"${name}" plays ${decision.mode === 'hls' ? `converted (${decision.video === 'copy' ? 'audio' : 'video and audio'})` : 'as it is'}, `
                + `torrent loaded in ${((loaded - started) / 1000).toFixed(1)}s, file read in ${((Date.now() - loaded) / 1000).toFixed(1)}s`);

            const base = `/series/${series.imdb_code}/${season}/${episode}/${source.hash}/${fileIndex}`;
            const variant = decision.mode === 'hls' ? this.variantOf(decision) : null;
            const duration = info.duration || null;

            // Warm up where the viewer starts. A converted video reads the torrent through ffmpeg, which is
            // started here already instead of when the player asks for the first segment.
            const fraction = duration && at > 0 ? Math.min(0.99, at / duration) : 0;
            this.manager.preloadTorrent(source.hash, this.torrentSource(source, name), { at: fraction, file: selector }).catch(() => {});
            if (variant) {
                const session = this.session({ hash: source.hash, fileIndex, variant, inspected, name });
                const start = Math.max(0, session.plan.segments.findIndex(segment => segment.end > at + (info.startTime || 0)));
                session.segment(start).catch(() => {});
            }

            return {
                mode: decision.mode,
                url: decision.mode === 'hls' ? `/hls${base}/${variant}/index.m3u8` : `/stream${base}`,
                video: decision.video,
                warning: decision.warning || null,
                duration,
                size: file.length,
                filename: file.name,
                fileIndex,
                // Bytes per second the torrent has to bring in for the video to play without stopping
                bitrate: duration ? Math.round(file.length / duration) : null,
                audio: decision.audio ? decision.audio.position : null,
                audioTracks: info.audio.map(track => ({
                    index: track.position,
                    language: track.language,
                    title: track.title,
                    codec: track.codec,
                    channels: track.channels
                })),
                guessed: !!info.guessed,
                codecs: {
                    container: info.container,
                    video: info.video ? info.video.codec : null,
                    audio: decision.audio ? decision.audio.codec : null,
                    height: info.video ? info.video.height : null
                }
            };
        } finally {
            lease.release();
        }
    }
}

module.exports = { Playback, errorWith };
