const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { parseEpisodes } = require('./releaseInfo');

// Public trackers used together with DHT to find peers for a magnet link
const TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.cyberia.is:6969/announce',
    'http://p4p.arenabg.com:1337/announce'
];

const INFO_HASH = /^[0-9a-f]{40}$/;
const VIDEO_FILE = /\.(mp4|m4v|webm|mkv|avi|mov)$/i;
const SAMPLE_FILE = /(^|[^a-z])sample([^a-z]|$)/i;
const SUBTITLE_FILE = /\.(srt|vtt)$/i;
const ENGLISH_SUBTITLE = /(^|[^a-z])(en|eng|english)([^a-z]|$)/i;

function normalizeHash(hash) {
    const infoHash = String(hash || '').trim().toLowerCase();
    if (!INFO_HASH.test(infoHash)) {
        throw new Error(`Invalid torrent hash "${hash}"`);
    }
    return infoHash;
}

function biggest(files) {
    return files.slice().sort((a, b) => b.length - a.length)[0] || null;
}

// Whether a file of a season pack is the episode. Packs name their files "Show.S01E02.mkv", or put
// "02 - Title.mkv" in a "Season 1" folder.
function isEpisodeFile(file, season, episode) {
    const fromName = parseEpisodes(file.name);
    if (fromName.episodes.length) {
        return fromName.episodes.includes(episode) && (!fromName.seasons.length || fromName.seasons.includes(season));
    }
    // Only the folder the file is in, the pack's own folder above it may name every season
    const fromPath = parseEpisodes(path.basename(path.dirname(file.path || '')));
    if (fromPath.seasons.length && !fromPath.seasons.includes(season)) return false;
    const number = /^(?:e|ep|episode)?[ ._-]?(\d{1,3})(?:[ ._-]|$)/i.exec(file.name);
    return !!number && Number(number[1]) === episode && (fromPath.seasons.includes(season) || season === 1);
}

/**
 * The video file to stream. Without `selector` it's the biggest one, which is the movie (some releases also
 * ship a sample clip). For an episode `selector` is { fileIdx, filename, season, episode }: the file the
 * torrent add-on named, or else the one whose name says it's that episode.
 */
function pickVideoFile(torrent, selector = null) {
    const videos = torrent.files.filter(file => VIDEO_FILE.test(file.name));
    if (!selector) return biggest(videos);

    const named = Number.isInteger(selector.fileIdx) ? torrent.files[selector.fileIdx] : null;
    if (named && VIDEO_FILE.test(named.name)) return named;

    const episodes = videos.filter(file => !SAMPLE_FILE.test(file.name));
    if (selector.filename) {
        const byName = episodes.find(file => file.name === selector.filename);
        if (byName) return byName;
    }
    if (Number.isInteger(selector.season) && Number.isInteger(selector.episode)) {
        const matches = episodes.filter(file => isEpisodeFile(file, selector.season, selector.episode));
        if (matches.length) return biggest(matches);
    }
    // A torrent of just this episode
    return episodes.length === 1 ? episodes[0] : null;
}

// English subtitles that come with the video. In a season pack only the ones of this episode count.
function pickSubtitleFile(torrent, selector = null) {
    const video = pickVideoFile(torrent, selector);
    let subtitles = torrent.files.filter(file => SUBTITLE_FILE.test(file.name));

    if (selector && video) {
        const base = video.name.replace(VIDEO_FILE, '');
        subtitles = subtitles.filter(file => (file.path || '').includes(base)
            || isEpisodeFile({ name: file.name, path: file.path }, selector.season, selector.episode));
    }

    const english = subtitles.find(file => ENGLISH_SUBTITLE.test(file.name.replace(SUBTITLE_FILE, '')));
    if (english) return english;

    // YTS releases ship the English subtitles named exactly like the movie file
    if (video) {
        const base = video.name.replace(VIDEO_FILE, '');
        const sameName = subtitles.find(file => file.name.replace(SUBTITLE_FILE, '') === base);
        if (sameName) return sameName;
    }

    return subtitles.length === 1 ? subtitles[0] : null;
}

function withTimeout(promise, ms, message) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Owns the WebTorrent client and every torrent in it.
 *
 * - A torrent is added once per info hash, no matter how many requests ask for it at the same time.
 * - Torrents start fully deselected, so only the pieces that are actually streamed get downloaded.
 * - Every open stream holds a lease. A torrent without leases is removed (with its data) after it has
 *   been idle for `idleTimeout`, so a forgotten or broken torrent can't keep eating CPU, bandwidth and disk.
 */
class TorrentManager {
    constructor(WebTorrent, options = {}) {
        this.WebTorrent = WebTorrent;
        this.clientOptions = options.client || {};
        this.downloadPath = options.downloadPath;
        this.idleTimeout = options.idleTimeout || 10 * 60 * 1000;
        this.readyTimeout = options.readyTimeout || 60 * 1000;
        this.maxTorrents = options.maxTorrents || 4;
        this.preloadBytes = options.preloadBytes || 8 * 1024 * 1024;

        this.entries = new Map(); // info hash -> { torrent, ready, streams, lastActivity, ... }
        this.client = null;

        this.clearDownloads();

        this.sweepTimer = setInterval(() => this.sweep(), 60 * 1000);
        this.sweepTimer.unref();
    }

    // Remove torrent data left behind by a previous run (only the per-torrent folders we create)
    clearDownloads() {
        if (!this.downloadPath) return;
        fs.mkdirSync(this.downloadPath, { recursive: true });
        for (const name of fs.readdirSync(this.downloadPath)) {
            if (INFO_HASH.test(name)) {
                fs.rmSync(path.join(this.downloadPath, name), { recursive: true, force: true });
            }
        }
    }

    getClient() {
        if (!this.client || this.client.destroyed) {
            if (this.client) {
                logger.warn('Torrent client was destroyed, starting a new one');
                this.entries.clear();
            }
            this.client = new this.WebTorrent(this.clientOptions);
            this.client.on('error', (err) => {
                logger.error(`Torrent client error: ${err && err.message ? err.message : err}`);
            });
        }
        return this.client;
    }

    // `trackers` are extra ones that know the torrent, e.g. the private-ish trackers torrent add-ons list
    magnetURI(infoHash, { name, url, trackers = [] } = {}) {
        let magnet = `magnet:?xt=urn:btih:${infoHash}`;
        if (name) magnet += `&dn=${encodeURIComponent(name)}`;
        for (const tracker of new Set([...TRACKERS, ...trackers.filter(tracker => /^(udp|https?|wss?):\/\//.test(tracker))])) {
            magnet += `&tr=${encodeURIComponent(tracker)}`;
        }
        // Fetching the .torrent file is usually faster than getting the metadata from peers
        if (url && /^https?:\/\//.test(url)) magnet += `&xs=${encodeURIComponent(url)}`;
        return magnet;
    }

    get(hash) {
        const entry = this.entries.get(normalizeHash(hash));
        if (!entry || entry.torrent.destroyed) return null;
        return entry;
    }

    // Returns the entry for a torrent, adding the torrent if it isn't loaded yet
    ensure(hash, source = {}) {
        const infoHash = normalizeHash(hash);
        let entry = this.entries.get(infoHash);

        if (entry && entry.torrent.destroyed) {
            this.entries.delete(infoHash);
            entry = null;
        }

        if (!entry) {
            entry = this.add(infoHash, source);
        }

        entry.lastActivity = Date.now();
        return entry;
    }

    add(infoHash, source) {
        const client = this.getClient();
        this.makeRoom();

        const torrent = client.add(this.magnetURI(infoHash, source), {
            path: path.join(this.downloadPath, infoHash),
            deselect: true,
            destroyStoreOnDestroy: true
        });

        const entry = {
            infoHash,
            name: source.name || infoHash,
            torrent,
            streams: 0,
            // Indexes of the files whose start was already asked for
            preloaded: new Set(),
            addedAt: Date.now(),
            lastActivity: Date.now()
        };

        // A torrent with an 'error' listener reports errors here instead of crashing the client
        torrent.on('error', (err) => {
            logger.error(`Torrent "${entry.name}" failed: ${err && err.message ? err.message : err}`);
        });

        entry.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                fail(new Error('Timed out while loading the torrent'));
            }, this.readyTimeout);

            const cleanup = () => {
                clearTimeout(timer);
                torrent.removeListener('ready', onReady);
                torrent.removeListener('error', fail);
                torrent.removeListener('close', onClose);
            };
            const onReady = () => {
                cleanup();
                logger.info(`Torrent "${entry.name}" is ready (${torrent.numPeers} peers)`);
                resolve(torrent);
            };
            const fail = (err) => {
                cleanup();
                this.removeEntry(entry);
                reject(err);
            };
            const onClose = () => fail(new Error('The torrent was removed'));

            torrent.once('ready', onReady);
            torrent.once('error', fail);
            torrent.once('close', onClose);
        });
        // Callers handle the rejection; this only keeps an unawaited failure from crashing the process
        entry.ready.catch(() => {});

        this.entries.set(infoHash, entry);
        logger.info(`Loading torrent "${entry.name}"`);
        return entry;
    }

    /**
     * Takes a lease on a torrent for one stream. Call `release()` exactly when the stream ends;
     * calling it more than once is harmless.
     */
    async acquire(hash, source) {
        const entry = this.ensure(hash, source);
        entry.streams++;

        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            entry.streams = Math.max(0, entry.streams - 1);
            entry.lastActivity = Date.now();
        };

        try {
            const torrent = await entry.ready;
            return { torrent, release };
        } catch (err) {
            release();
            throw err;
        }
    }

    /**
     * Loads the torrent metadata and warms up the start of the video (where the MP4 header is),
     * plus the spot the viewer is going to resume from when `at` (0-1) is given. `file` picks the video
     * of a torrent with many (see pickVideoFile).
     */
    async preloadTorrent(hash, source, { at, file: selector = null } = {}) {
        const entry = this.ensure(hash, source);
        const torrent = await entry.ready;
        const file = pickVideoFile(torrent, selector);
        const index = file ? torrent.files.indexOf(file) : -1;

        if (file && !entry.preloaded.has(index)) {
            entry.preloaded.add(index);
            this.selectBytes(torrent, file, 0, this.preloadBytes);
            if (at > 0 && at < 1) {
                this.selectBytes(torrent, file, Math.floor(file.length * at), this.preloadBytes);
            }
        }

        return {
            success: true,
            stats: {
                progress: torrent.progress,
                downloadSpeed: torrent.downloadSpeed,
                peers: torrent.numPeers
            }
        };
    }

    selectBytes(torrent, file, offset, length) {
        const startByte = file.offset + Math.min(offset, file.length - 1);
        const endByte = file.offset + Math.min(offset + length, file.length) - 1;
        const start = Math.floor(startByte / torrent.pieceLength);
        const end = Math.floor(endByte / torrent.pieceLength);
        torrent.select(start, end, 0);
    }

    // Reads the English subtitles shipped inside a torrent. Only torrents that are already loaded are
    // used: starting a whole torrent just for its subtitles is what made the server download movies twice.
    async readSubtitleFile(hash, timeout = 20000, selector = null) {
        const entry = this.get(hash);
        if (!entry) return null;

        const read = async () => {
            const torrent = await entry.ready;
            const file = pickSubtitleFile(torrent, selector);
            if (!file) return null;
            return { name: file.name, data: Buffer.from(await file.arrayBuffer()) };
        };

        return withTimeout(read(), timeout, 'Timed out while reading the subtitles from the torrent');
    }

    // Frees idle torrents when we are at the limit. Torrents with open streams are never evicted.
    makeRoom() {
        if (this.entries.size < this.maxTorrents) return;

        const idle = [...this.entries.values()]
            .filter(entry => entry.streams === 0)
            .sort((a, b) => a.lastActivity - b.lastActivity);

        while (this.entries.size >= this.maxTorrents && idle.length) {
            const entry = idle.shift();
            logger.info(`Removing torrent "${entry.name}" to make room for a new one`);
            this.removeEntry(entry);
        }

        if (this.entries.size >= this.maxTorrents) {
            logger.warn(`${this.entries.size} torrents are streaming at the same time (limit is ${this.maxTorrents})`);
        }
    }

    remove(hash) {
        const entry = this.entries.get(normalizeHash(hash));
        if (entry) this.removeEntry(entry);
    }

    removeEntry(entry) {
        if (this.entries.get(entry.infoHash) === entry) {
            this.entries.delete(entry.infoHash);
        }

        const folder = path.join(this.downloadPath, entry.infoHash);
        const deleteFolder = () => {
            // A new torrent for the same movie may already be using the folder
            if (this.entries.has(entry.infoHash)) return;
            fs.rm(folder, { recursive: true, force: true }, () => {});
        };

        if (entry.torrent.destroyed) return deleteFolder();
        entry.torrent.destroy({ destroyStore: true }, (err) => {
            if (err) logger.warn(`Could not delete the data of "${entry.name}": ${err.message}`);
            deleteFolder();
        });
    }

    // Runs every minute and removes torrents nobody has streamed for `idleTimeout`
    sweep() {
        const now = Date.now();
        for (const entry of [...this.entries.values()]) {
            if (entry.torrent.destroyed) {
                // Destroyed by WebTorrent itself after an error
                this.removeEntry(entry);
            } else if (entry.streams === 0 && now - entry.lastActivity > this.idleTimeout) {
                logger.info(`Removing idle torrent "${entry.name}"`);
                this.removeEntry(entry);
            }
        }
    }

    getStats() {
        const torrents = [...this.entries.values()].map(entry => ({
            name: entry.name,
            infoHash: entry.infoHash,
            ready: entry.torrent.ready,
            streams: entry.streams,
            peers: entry.torrent.numPeers,
            progress: entry.torrent.progress,
            downloadSpeed: entry.torrent.downloadSpeed,
            uploadSpeed: entry.torrent.uploadSpeed,
            downloaded: entry.torrent.downloaded,
            uploaded: entry.torrent.uploaded,
            size: entry.torrent.length || 0,
            addedAt: entry.addedAt,
            idleFor: entry.streams === 0 ? Date.now() - entry.lastActivity : 0
        }));

        return {
            maxTorrents: this.maxTorrents,
            idleTimeout: this.idleTimeout,
            downloadPath: this.downloadPath,
            downloadSpeed: torrents.reduce((total, torrent) => total + torrent.downloadSpeed, 0),
            uploadSpeed: torrents.reduce((total, torrent) => total + torrent.uploadSpeed, 0),
            totalTorrents: torrents.length,
            torrentsWithReferences: torrents.filter(torrent => torrent.streams > 0).length,
            idleTorrents: torrents.filter(torrent => torrent.streams === 0).length,
            torrents
        };
    }
}

// The bytes `start` to `start + length` of a torrent file, downloading them first when needed
async function readFileRange(file, start, length) {
    const end = Math.min(file.length, start + length) - 1;
    const chunks = [];
    for await (const chunk of file[Symbol.asyncIterator]({ start, end: Math.max(end, start + 1) })) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks).subarray(0, end - start + 1);
}

TorrentManager.pickVideoFile = pickVideoFile;
TorrentManager.readFileRange = readFileRange;
TorrentManager.pickSubtitleFile = pickSubtitleFile;
TorrentManager.normalizeHash = normalizeHash;

module.exports = TorrentManager;
