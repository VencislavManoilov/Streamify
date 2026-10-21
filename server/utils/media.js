const { execFile } = require('child_process');
const logger = require('./logger');

// ffmpeg turns videos the browser can't play into ones it can (see utils/hls.js). Without it episodes in
// other formats can't be converted, so only the ones the browser plays as they are work.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

const PROBE_TIMEOUT = 60 * 1000;

let tools = null;

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, { maxBuffer: 8 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
            if (err) {
                err.stderr = stderr;
                return reject(err);
            }
            resolve(stdout);
        });
    });
}

// Whether ffmpeg and ffprobe can be run, checked once
async function checkTools() {
    if (!tools) {
        tools = Promise.all([
            run(FFMPEG, ['-hide_banner', '-version'], { timeout: 10000 }),
            run(FFPROBE, ['-hide_banner', '-version'], { timeout: 10000 })
        ]).then(([version]) => {
            const found = /ffmpeg version (\S+)/.exec(version);
            logger.info(`Found ffmpeg ${found ? found[1] : ''}, episodes in any format can be played`);
            return { available: true, version: found ? found[1] : null };
        }).catch((err) => {
            logger.warn(`ffmpeg isn't installed (${err.code || err.message}). Episodes the browser can't play as they are won't work.`);
            return { available: false, version: null };
        });
    }
    return tools;
}

// ISO 639-1 codes (TMDB) and the ISO 639-2 codes video files use for the same language
const LANGUAGES = {
    en: ['eng', 'en'], ja: ['jpn', 'ja'], ko: ['kor', 'ko'], es: ['spa', 'es'], fr: ['fre', 'fra', 'fr'],
    de: ['ger', 'deu', 'de'], it: ['ita', 'it'], ru: ['rus', 'ru'], pt: ['por', 'pt'], zh: ['chi', 'zho', 'zh'],
    hi: ['hin', 'hi'], tr: ['tur', 'tr'], sv: ['swe', 'sv'], da: ['dan', 'da'], no: ['nor', 'nob', 'no'],
    nl: ['dut', 'nld', 'nl'], pl: ['pol', 'pl'], bg: ['bul', 'bg'], uk: ['ukr', 'uk'], fi: ['fin', 'fi'],
    he: ['heb', 'he'], ar: ['ara', 'ar'], th: ['tha', 'th'], cs: ['cze', 'ces', 'cs'], el: ['gre', 'ell', 'el'],
    hu: ['hun', 'hu'], ro: ['rum', 'ron', 'ro'], is: ['ice', 'isl', 'is'], fa: ['per', 'fas', 'fa'], id: ['ind', 'id']
};

function languageMatches(trackLanguage, wanted) {
    const codes = LANGUAGES[wanted] || [wanted];
    return codes.includes(String(trackLanguage || '').toLowerCase());
}

function numberOr(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function containerOf(formatName) {
    const names = String(formatName || '').split(',');
    if (names.includes('matroska')) return 'matroska';
    if (names.includes('mp4') || names.includes('mov')) return 'mp4';
    if (names.includes('webm')) return 'webm';
    return names[0] || 'unknown';
}

// What the file has inside: its container, the video and every audio track
async function probe(url) {
    const stdout = await run(FFPROBE, [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        // Enough to know the codecs; reading further would wait for a slow torrent for nothing
        '-probesize', '5M',
        '-analyzeduration', '3M',
        url
    ], { timeout: PROBE_TIMEOUT });

    const data = JSON.parse(stdout);
    const streams = data.streams || [];
    const videoStream = streams.find(stream => stream.codec_type === 'video' && !(stream.disposition && stream.disposition.attached_pic));
    const audioStreams = streams.filter(stream => stream.codec_type === 'audio');
    const format = data.format || {};

    return {
        container: containerOf(format.format_name),
        duration: numberOr(format.duration),
        startTime: numberOr(format.start_time, 0),
        bitRate: numberOr(format.bit_rate),
        video: videoStream ? {
            codec: videoStream.codec_name,
            profile: videoStream.profile || '',
            pixelFormat: videoStream.pix_fmt || '',
            width: videoStream.width || 0,
            height: videoStream.height || 0,
            tenBit: /10|12/.test(videoStream.pix_fmt || '') || /10/.test(videoStream.profile || ''),
            hdr: ['smpte2084', 'arib-std-b67'].includes(videoStream.color_transfer)
        } : null,
        // A track is known by its place among the audio tracks, which is how ffmpeg's -map 0:a:N picks it
        audio: audioStreams.map((stream, position) => ({
            position,
            codec: stream.codec_name,
            channels: stream.channels || 2,
            language: (stream.tags && stream.tags.language) || '',
            title: (stream.tags && stream.tags.title) || '',
            default: !!(stream.disposition && stream.disposition.default)
        }))
    };
}

// The audio track to play: the show's own language, then English, then the one the file marks as default
function preferredAudio(audio, originalLanguage) {
    if (!audio.length) return null;
    const wanted = [originalLanguage, 'en'].filter(Boolean);
    for (const language of wanted) {
        const match = audio.find(track => languageMatches(track.language, language) && !/commentary/i.test(track.title));
        if (match) return match;
    }
    return audio.find(track => track.default) || audio[0];
}

// The track a browser plays when it gets the file as it is
function browserAudio(audio) {
    return audio.find(track => track.default) || audio[0] || null;
}

const PLAIN_AUDIO = ['aac', 'mp3'];

function audioPlayable(codec, caps) {
    if (PLAIN_AUDIO.includes(codec)) return true;
    if (codec === 'opus' || codec === 'vorbis' || codec === 'flac') return caps.has('opus') || caps.has('webm') || caps.has('mkv');
    if (codec === 'ac3') return caps.has('ac3');
    if (codec === 'eac3') return caps.has('eac3');
    return false;
}

function videoPlayable(video, caps) {
    if (!video) return false;
    if (video.codec === 'h264') return !video.tenBit || caps.has('avc10');
    if (video.codec === 'hevc') return caps.has(video.tenBit ? 'hevc10' : 'hevc');
    if (video.codec === 'vp9') return caps.has('vp9');
    if (video.codec === 'av1') return caps.has('av1');
    return false;
}

function containerPlayable(container, caps) {
    if (container === 'mp4') return true;
    if (container === 'webm') return caps.has('webm') || caps.has('mkv');
    if (container === 'matroska') return caps.has('mkv');
    return false;
}

/**
 * How a file gets to the browser:
 * - 'direct': the browser plays the file as it is
 * - 'hls' with video 'copy': the video stays as it is, the audio becomes AAC (cheap)
 * - 'hls' with video 'transcode': the video is encoded again as H.264 (takes a lot of CPU)
 * - 'unsupported': this browser can't play it and the server can't convert it
 * `canCopy` says whether the file's keyframes are known, which cutting it without re-encoding needs, and
 * `audioTrack` is the position of a track the viewer picked.
 */
function decide(info, caps, { audioTrack = null, originalLanguage = '', ffmpeg = false, transcodeVideo = false, canCopy = false } = {}) {
    const chosen = audioTrack !== null
        ? info.audio.find(track => track.position === audioTrack) || preferredAudio(info.audio, originalLanguage)
        : preferredAudio(info.audio, originalLanguage);
    const videoOk = videoPlayable(info.video, caps);
    const audioOk = !chosen || audioPlayable(chosen.codec, caps);
    const containerOk = containerPlayable(info.container, caps);
    const sameAudio = !chosen || chosen === browserAudio(info.audio);

    if (videoOk && audioOk && containerOk && sameAudio) {
        return { mode: 'direct', audio: chosen, video: 'direct' };
    }
    // HLS segments here are MPEG-TS, which carries H.264 but not the newer codecs
    if (ffmpeg && videoOk && info.video.codec === 'h264' && canCopy) {
        return { mode: 'hls', audio: chosen, video: 'copy' };
    }
    if (ffmpeg && transcodeVideo && info.video) {
        return { mode: 'hls', audio: chosen, video: 'transcode' };
    }
    // Better a picture without the right sound than nothing
    if (videoOk && containerOk) {
        return { mode: 'direct', audio: browserAudio(info.audio), video: 'direct', warning: audioOk ? 'language' : 'audio' };
    }
    return { mode: 'unsupported', audio: chosen, video: 'none' };
}

module.exports = {
    FFMPEG,
    FFPROBE,
    checkTools,
    probe,
    decide,
    preferredAudio,
    audioPlayable,
    videoPlayable,
    containerPlayable,
    languageMatches
};
