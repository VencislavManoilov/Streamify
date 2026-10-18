// How subtitles look and how far they are moved in time. Both are kept in this browser.
const STYLE_KEY = 'subtitleSettings';
const OFFSETS_KEY = 'subtitleOffsets';
// Offsets are kept for this many movies, the ones touched longest ago are forgotten first
const KEEP_OFFSETS = 100;

export const SUBTITLE_COLORS = ['#ffffff', '#fde047', '#86efac', '#7dd3fc', '#f9a8d4'];
export const DEFAULT_STYLE = { fontSize: 1, bgOpacity: 0.5, color: '#ffffff' };

function read(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch (err) {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
        // Storage can be unavailable (private mode), the settings then only last for this page
    }
}

function between(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export function loadStyle() {
    const saved = read(STYLE_KEY) || {};
    return {
        fontSize: between(saved.fontSize, 0.5, 2, DEFAULT_STYLE.fontSize),
        bgOpacity: between(saved.bgOpacity, 0, 1, DEFAULT_STYLE.bgOpacity),
        color: /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : DEFAULT_STYLE.color
    };
}

export function saveStyle(style) {
    write(STYLE_KEY, style);
}

// Seconds the subtitles of a movie in a language are moved by; later when positive
export function loadOffset(imdbCode, language) {
    const offsets = read(OFFSETS_KEY) || {};
    const movie = offsets[imdbCode] || {};
    return between(movie[language], -600, 600, 0);
}

export function saveOffset(imdbCode, language, offset) {
    const offsets = read(OFFSETS_KEY) || {};
    const movie = { ...(offsets[imdbCode] || {}) };
    if (offset) {
        movie[language] = offset;
    } else {
        delete movie[language];
    }

    // Added again at the end, so the movies at the start are the ones touched longest ago
    delete offsets[imdbCode];
    if (Object.keys(movie).length) offsets[imdbCode] = movie;
    const codes = Object.keys(offsets);
    codes.slice(0, Math.max(0, codes.length - KEEP_OFFSETS)).forEach(code => delete offsets[code]);

    write(OFFSETS_KEY, offsets);
}

// Where the subtitle file put every cue, before any offset
const fileTimes = new WeakMap();

// Moves every cue of a track `offset` seconds away from where the subtitle file put it
export function shiftCues(track, offset) {
    if (!track || !track.cues) return;

    let moved = false;
    for (const cue of Array.from(track.cues)) {
        let times = fileTimes.get(cue);
        if (!times) {
            times = { start: cue.startTime, end: cue.endTime };
            fileTimes.set(cue, times);
        }

        // Browsers ignore negative times, so cues moved to before the movie starts stop at 0
        const start = Math.max(0, times.start + offset);
        const end = Math.max(0, times.end + offset);
        if (start === cue.startTime && end === cue.endTime) continue;

        // Moved while it's out of the track: Firefox never takes a cue off the screen when its times change
        // while it's showing, so every change of the sync left the line on screen stuck there
        track.removeCue(cue);
        cue.startTime = start;
        cue.endTime = end;
        track.addCue(cue);
        moved = true;
    }

    // Plyr redraws the subtitles on this event, which browsers leave out when the line on screen is only taken away
    if (moved) track.dispatchEvent(new Event('cuechange'));
}
