// Reads what a torrent or file name says about the video in it, e.g.
// "Breaking.Bad.S01E01.Pilot.1080p.BluRay.x264.DTS-HD.MA.5.1-DEMAND.mkv". Release names follow loose
// conventions, so everything here is a best guess that the file itself (see utils/hls.js) has the final say on.

const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'm4v', 'webm', 'avi', 'mov', 'ts', 'm2ts', 'wmv', 'mpg', 'mpeg'];
const VIDEO_FILE = new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i');

const RESOLUTIONS = [
    { label: '2160p', pattern: /\b(2160p|4k|uhd)\b/i },
    { label: '1440p', pattern: /\b1440p\b/i },
    { label: '1080p', pattern: /\b(1080[pi]|fhd)\b/i },
    { label: '720p', pattern: /\b(720p|hd720)\b/i },
    { label: '576p', pattern: /\b576[pi]\b/i },
    { label: '480p', pattern: /\b(480p|sd|dvdrip|xvid)\b/i }
];

const CODECS = [
    { codec: 'hevc', pattern: /\b(x[ .]?265|h[ .]?265|hevc)\b/i },
    { codec: 'av1', pattern: /\bav1\b/i },
    { codec: 'h264', pattern: /\b(x[ .]?264|h[ .]?264|avc)\b/i },
    { codec: 'mpeg4', pattern: /\b(xvid|divx)\b/i },
    { codec: 'vp9', pattern: /\bvp9\b/i }
];

const AUDIO = [
    { audio: 'truehd', pattern: /\btrue-?hd\b/i },
    { audio: 'dts', pattern: /\bdts(-?hd|-?x|-?ma|-?es)?\b/i },
    { audio: 'eac3', pattern: /\b(ddp|dd\+|e-?ac-?3|eac3|atmos)(?=[\s.\-_\d]|$)/i },
    { audio: 'ac3', pattern: /\b(ac-?3|dd(?=[\s.\-_]?[257]\.?[01])|dolby ?digital)/i },
    { audio: 'aac', pattern: /\baac/i },
    { audio: 'opus', pattern: /\bopus\b/i },
    { audio: 'flac', pattern: /\bflac\b/i },
    { audio: 'mp3', pattern: /\bmp3\b/i }
];

const SOURCES = [
    { source: 'remux', pattern: /\bremux\b/i },
    { source: 'bluray', pattern: /\b(blu-?ray|bdrip|brrip|bd(?=[\s.\-_]?(rip|remux|25|50))|bd)\b/i },
    { source: 'web', pattern: /\b(web-?dl|web-?rip|webrip|web|amzn|nf|dsnp|hmax|atvp|hulu|pcok|max)\b/i },
    { source: 'hdtv', pattern: /\b(hdtv|pdtv|tvrip|dsr)\b/i },
    { source: 'dvd', pattern: /\b(dvd-?rip|dvd|dvd5|dvd9)\b/i }
];

// Releases nobody wants to watch: recorded in a cinema, or made for 3D glasses
const UNWATCHABLE = /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|scr|screener|dvdscr)\b|\b3d\b|\bsbs\b|\bhsbs\b/i;
const HDR = /\b(hdr10\+?|hdr|dv|dovi|dolby[ .]?vision)\b/i;
const TEN_BIT = /\b10[ -.]?bit\b|\bhi10p?\b/i;

function cleanName(name) {
    return String(name || '').replace(/[[\]()]/g, ' ').replace(/_/g, ' ');
}

function firstMatch(list, text, key) {
    const found = list.find(item => item.pattern.test(text));
    return found ? found[key] : null;
}

function range(from, to) {
    const numbers = [];
    for (let n = from; n <= to && numbers.length < 100; n++) numbers.push(n);
    return numbers;
}

/**
 * The seasons and episodes a name mentions. A name without episodes is a pack of whole seasons.
 * Understands S01E02, S01E02E03, S01E02-E04, 1x02, "Season 1 Episode 2", S01-S03, "Season 1-3" and
 * "Complete Series".
 */
function parseEpisodes(name) {
    const text = cleanName(name);

    let match = /\bS(\d{1,2})[ .\-]?E(\d{1,3})(?:(?:[ .\-]?E|-E?)(\d{1,3}))*/i.exec(text);
    if (match) {
        const season = Number(match[1]);
        const numbers = match[0].match(/\d{1,3}/g).slice(1).map(Number);
        const isRange = /-E?\d/i.test(match[0].slice(match[0].search(/E/i)));
        const episodes = isRange && numbers.length === 2 ? range(numbers[0], numbers[1]) : numbers;
        return { seasons: [season], episodes };
    }

    match = /\b(\d{1,2})x(\d{2,3})(?:-(\d{2,3}))?\b/i.exec(text);
    if (match) {
        const first = Number(match[2]);
        return { seasons: [Number(match[1])], episodes: match[3] ? range(first, Number(match[3])) : [first] };
    }

    match = /\bseason[ .\-]?(\d{1,2})[ .\-,]*(?:episode|ep)[ .\-]?(\d{1,3})\b/i.exec(text);
    if (match) {
        return { seasons: [Number(match[1])], episodes: [Number(match[2])] };
    }

    // Packs of seasons: S01-S05, S01-05, S01-S02-S03, Seasons 1-5, Season 1 to 5
    const listed = (text.match(/\bS\d{1,2}\b(?![ .\-]?E\d)/gi) || []).map(token => Number(token.slice(1)));
    match = /\bS(\d{1,2})[ .]?(?:-|to|&)[ .]?S?(\d{1,2})\b/i.exec(text)
        || /\bseasons?[ .\-]?(\d{1,2})[ .]?(?:-|to|&)[ .]?(\d{1,2})\b/i.exec(text);
    if (match && Number(match[2]) >= Number(match[1])) {
        return { seasons: range(Math.min(Number(match[1]), ...listed), Math.max(Number(match[2]), ...listed)), episodes: [] };
    }

    match = /\bS(\d{1,2})\b(?![ .\-]?E\d)/i.exec(text) || /\bseason[ .\-]?(\d{1,2})\b/i.exec(text);
    if (match) {
        return { seasons: [Number(match[1])], episodes: [] };
    }

    if (/\b(complete|full)[ .\-]?(series|collection)\b|\ball[ .\-]?seasons\b/i.test(text)) {
        return { seasons: [], episodes: [], complete: true };
    }

    return { seasons: [], episodes: [] };
}

function parseRelease(name) {
    const text = cleanName(name);
    const extension = (/\.([a-z0-9]{2,4})$/i.exec(String(name || '').trim()) || [])[1];
    const container = extension && VIDEO_EXTENSIONS.includes(extension.toLowerCase()) ? extension.toLowerCase() : null;

    return {
        resolution: firstMatch(RESOLUTIONS, text, 'label'),
        codec: firstMatch(CODECS, text, 'codec'),
        audio: firstMatch(AUDIO, text, 'audio'),
        source: firstMatch(SOURCES, text, 'source'),
        container,
        hdr: HDR.test(text),
        tenBit: TEN_BIT.test(text),
        unwatchable: UNWATCHABLE.test(text),
        ...parseEpisodes(name)
    };
}

function isVideoFile(name) {
    return VIDEO_FILE.test(String(name || '')) && !/\bsample\b/i.test(String(name || ''));
}

// Words of a title, for comparing a release name with the title of the series it should be
function titleWords(title) {
    return String(title || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

module.exports = { parseRelease, parseEpisodes, isVideoFile, titleWords, VIDEO_FILE };
