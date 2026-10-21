// What this browser plays, which decides how the server sends it an episode: the file as it is, or
// converted (see server/utils/media.js). Sent as a short list like "mkv.hevc.opus".
let caps = null;

function supports(video, Source, type) {
    if (video.canPlayType(type)) return true;
    try {
        return !!(Source && Source.isTypeSupported && Source.isTypeSupported(type));
    } catch (err) {
        return false;
    }
}

export function browserCaps() {
    if (caps === null) {
        const video = document.createElement('video');
        const Source = window.MediaSource || window.ManagedMediaSource;
        const found = {
            mkv: !!video.canPlayType('video/x-matroska'),
            webm: supports(video, Source, 'video/webm; codecs="vp8, vorbis"'),
            hevc: supports(video, Source, 'video/mp4; codecs="hvc1.1.6.L120.90"'),
            hevc10: supports(video, Source, 'video/mp4; codecs="hvc1.2.4.L120.90"'),
            avc10: supports(video, Source, 'video/mp4; codecs="avc1.6E0028"'),
            vp9: supports(video, Source, 'video/webm; codecs="vp9"'),
            av1: supports(video, Source, 'video/mp4; codecs="av01.0.08M.08"'),
            ac3: supports(video, Source, 'audio/mp4; codecs="ac-3"'),
            eac3: supports(video, Source, 'audio/mp4; codecs="ec-3"'),
            opus: supports(video, Source, 'audio/webm; codecs="opus"')
        };
        caps = Object.keys(found).filter(key => found[key]).join('.');
    }
    return caps;
}

export function formatSize(bytes) {
    if (!bytes) return '';
    const gigabytes = bytes / 1024 ** 3;
    return gigabytes >= 1 ? `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

// How well seeded a torrent is (see healthOf in server/utils/streamSources.js), in words
export const HEALTH = {
    great: { label: 'Fast', tone: 'good' },
    good: { label: 'Good', tone: 'good' },
    slow: { label: 'Slow', tone: 'warn' },
    dead: { label: 'No seeders', tone: 'bad' },
    none: { label: 'Not available', tone: 'bad' },
    unknown: { label: 'Unknown', tone: 'muted' }
};

export function seedersText(seeders) {
    if (seeders === null || seeders === undefined) return 'seeders unknown';
    return `${seeders} ${seeders === 1 ? 'seeder' : 'seeders'}`;
}

// "S1 · E2"
export function episodeLabel(season, episode) {
    return season === 0 ? `Special ${episode}` : `S${season} · E${episode}`;
}
