const axios = require('axios');
const logger = require('./logger');
const { parseRelease, parseEpisodes, isVideoFile, titleWords } = require('./releaseInfo');

/**
 * Finds the torrents of an episode the way Stremio does: by asking Stremio torrent add-ons for the streams
 * of "<IMDb code>:<season>:<episode>". Torrentio is the default. It scrapes a couple of dozen trackers and
 * already knows which file of a season pack is which episode. Any other add-on that answers with torrents
 * (MediaFusion, Comet, Jackettio, a self-hosted Torrentio or Knightcrawler...) can be added with
 * STREAM_ADDONS. When none of them has anything, Knaben, a search engine over many trackers, is searched
 * for the episode and for packs of its season.
 */

const DEFAULT_ADDONS = 'https://torrentio.strem.fun';
const KNABEN_URL = (process.env.KNABEN_URL || 'https://api.knaben.org/v1').replace(/\/+$/, '');
const USER_AGENT = 'Streamify/1.0 (+https://github.com/VencislavManoilov/Streamify)';

const HOUR = 60 * 60 * 1000;
// Torrents come and go slowly, but seeders change, so a list is looked up again after a few hours
const KEEP_FOUND = 6 * HOUR;
// An episode without any torrent may just be too new, so it is asked about again soon
const KEEP_MISSING = HOUR;
// A list made while an add-on couldn't be reached is missing its torrents, so it's asked for again soon
const KEEP_PARTIAL = 5 * 60 * 1000;
const ADDON_TIMEOUT = 12000;

// Addresses of the add-ons. A copied manifest address works too, e.g. https://torrentio.strem.fun/sort=seeders/manifest.json
function addonUrls() {
    const value = process.env.STREAM_ADDONS === undefined ? DEFAULT_ADDONS : process.env.STREAM_ADDONS;
    return value.split(/[\s,]+/)
        .map(url => url.trim().replace(/\/manifest\.json$/, '').replace(/\/+$/, ''))
        .filter(url => /^https?:\/\//.test(url));
}

function addonName(url) {
    try {
        const host = new URL(url).hostname.replace(/^www\./, '');
        return host.split('.').slice(-3, -1).join('.') || host;
    } catch (err) {
        return 'add-on';
    }
}

/**
 * Spaces out the requests to one site. Torrentio answers bursts with "429 Too Many Requests", so requests
 * start at least `interval` apart, a few at a time, and a 429 pauses the site for a while. What a viewer is
 * waiting for (priority 'high') goes before background checks ('low').
 */
class Pacer {
    constructor({ concurrency = 3, interval = 300 } = {}) {
        this.concurrency = concurrency;
        this.interval = interval;
        this.running = 0;
        this.lastStart = 0;
        this.pausedUntil = 0;
        this.queues = { high: [], low: [] };
        this.timer = null;
    }

    run(task, priority = 'high') {
        return new Promise((resolve, reject) => {
            this.queues[priority === 'low' ? 'low' : 'high'].push({ task, resolve, reject });
            this.pump();
        });
    }

    pause(ms) {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
    }

    pump() {
        if (this.timer) return;
        while (this.running < this.concurrency && (this.queues.high.length || this.queues.low.length)) {
            const wait = Math.max(this.pausedUntil, this.lastStart + this.interval) - Date.now();
            if (wait > 0) {
                this.timer = setTimeout(() => {
                    this.timer = null;
                    this.pump();
                }, wait);
                return;
            }
            const job = this.queues.high.shift() || this.queues.low.shift();
            this.running++;
            this.lastStart = Date.now();
            Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => {
                this.running--;
                this.pump();
            });
        }
    }
}

const pacers = new Map(); // host -> Pacer

function pacerFor(url) {
    const host = new URL(url).host;
    if (!pacers.has(host)) pacers.set(host, new Pacer());
    return pacers.get(host);
}

// A request through the site's pacer. A 429 pauses the site (as long as it asks, or a few seconds) and is
// tried again twice.
async function paced(url, send, priority) {
    const pacer = pacerFor(url);
    for (let attempt = 0; ; attempt++) {
        try {
            return await pacer.run(send, priority);
        } catch (err) {
            const status = err.response && err.response.status;
            if (status !== 429 || attempt >= 2) throw err;
            const retryAfter = Number(err.response.headers && err.response.headers['retry-after']) * 1000;
            pacer.pause(retryAfter > 0 ? Math.min(retryAfter, 60000) : 3000 * 2 ** attempt);
        }
    }
}

const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };

function parseSize(text) {
    const match = /💾\s*([\d.,]+)\s*([KMGT]?i?B)/i.exec(text);
    if (!match) return null;
    const unit = match[2].toUpperCase().replace('I', '');
    return Math.round(parseFloat(match[1].replace(',', '.')) * (SIZE_UNITS[unit] || 1));
}

// Flag emojis are pairs of regional indicator letters, e.g. 🇬🇧 is G and B
function flagCountries(text) {
    const countries = [];
    for (const match of String(text).matchAll(/([\u{1F1E6}-\u{1F1FF}])([\u{1F1E6}-\u{1F1FF}])/gu)) {
        const code = String.fromCharCode(match[1].codePointAt(0) - 0x1F1E6 + 65, match[2].codePointAt(0) - 0x1F1E6 + 65);
        if (!countries.includes(code)) countries.push(code);
    }
    return countries;
}

function fromAddon(stream, addon) {
    const hash = String(stream.infoHash || '').toLowerCase();
    // Debrid and web links aren't torrents
    if (!/^[0-9a-f]{40}$/.test(hash)) return null;

    const text = String(stream.title || stream.description || '');
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    const hints = stream.behaviorHints || {};
    const pathLine = lines.find((line, index) => index > 0 && isVideoFile(line.split('/').pop()));
    const filename = hints.filename || (pathLine ? pathLine.split('/').pop() : null);
    const seeders = /👤\s*([\d,]+)/.exec(text);
    const provider = /(?:⚙️|🔎|🔗)\s*([^\n👤💾]+)/u.exec(text);
    const trackers = (stream.sources || [])
        .filter(source => typeof source === 'string' && source.startsWith('tracker:'))
        .map(source => source.slice('tracker:'.length));

    return {
        hash,
        fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null,
        release: lines[0] || filename || hash,
        filename,
        size: parseSize(text),
        seeders: seeders ? Number(seeders[1].replace(/,/g, '')) : null,
        provider: provider ? provider[1].trim() : addon,
        addon,
        countries: flagCountries(text),
        multiAudio: /\b(multi|dual)[ -]?audio\b/i.test(text),
        // Torrentio puts the quality on the second line of the name, e.g. "Torrentio\n1080p"
        label: String(stream.name || '').split('\n').slice(1).join(' ').trim(),
        trackers: trackers.slice(0, 30)
    };
}

async function fromAddons(imdbCode, season, episode, priority) {
    const urls = addonUrls();
    const results = await Promise.allSettled(urls.map(async (url) => {
        const address = `${url}/stream/series/${imdbCode}:${season}:${episode}.json`;
        const response = await paced(address, () => axios.get(address, {
            timeout: ADDON_TIMEOUT,
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }
        }), priority);
        const streams = (response.data && response.data.streams) || [];
        return streams.map(stream => fromAddon(stream, addonName(url))).filter(Boolean);
    }));

    const sources = [];
    let failed = 0;
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            sources.push(...result.value);
        } else {
            failed++;
            logger.warn(`${addonName(urls[index])} couldn't list the torrents of ${imdbCode} ${season}x${episode}: ${result.reason.message}`);
        }
    });
    return { sources, failed, allFailed: failed > 0 && failed === urls.length };
}

// The words of a release name before its season marker, without a year or country, e.g. "the office us 2005"
function nameWords(name) {
    const text = String(name).replace(/[[(][^\])]*[\])]/g, ' ');
    const marker = /\b(S\d{1,2}|season|\d{1,2}x\d{2}|complete)\b/i.exec(text);
    const words = titleWords(marker ? text.slice(0, marker.index) : text);
    while (words.length && /^(19|20)\d{2}$|^(us|uk|au|nz|ca)$/.test(words[words.length - 1])) words.pop();
    return words;
}

function sameTitle(name, titles) {
    const words = nameWords(name).join(' ');
    return titles.some(title => {
        const wanted = titleWords(title).join(' ');
        return wanted && (words === wanted || words === wanted.replace(/^the /, '') || `the ${words}` === wanted);
    });
}

async function knabenSearch(query, priority) {
    const response = await paced(KNABEN_URL, () => axios.post(KNABEN_URL, {
        search_type: '100%',
        search_field: 'title',
        query,
        order_by: 'seeders',
        order_direction: 'desc',
        categories: [2000000],
        size: 50,
        hide_unsafe: true,
        hide_xxx: true
    }, { timeout: ADDON_TIMEOUT, headers: { 'User-Agent': USER_AGENT } }), priority);
    return (response.data && response.data.hits) || [];
}

// The fallback when no add-on knows the episode: single episodes and packs that hold its season
async function fromKnaben(series, season, episode, priority) {
    const code = `S${String(season).padStart(2, '0')}`;
    const titles = [series.title, series.original_title].filter(Boolean);
    const queries = [`${series.title} ${code}E${String(episode).padStart(2, '0')}`, `${series.title} ${code}`];
    const results = await Promise.allSettled(queries.map(query => knabenSearch(query, priority)));

    const sources = [];
    for (const result of results) {
        if (result.status !== 'fulfilled') {
            const reason = result.reason;
            logger.warn(`Knaben couldn't be searched for ${series.title} ${code}: ${reason.message || reason.code || (reason.response && reason.response.status)}`);
            continue;
        }
        for (const hit of result.value) {
            const hash = String(hit.hash || '').toLowerCase();
            if (!/^[0-9a-f]{40}$/.test(hash) || !sameTitle(hit.title, titles)) continue;
            const { seasons, episodes, complete } = parseEpisodes(hit.title);
            const single = seasons.includes(season) && episodes.includes(episode);
            const pack = (seasons.includes(season) && !episodes.length) || complete;
            if (!single && !pack) continue;
            sources.push({
                hash,
                fileIdx: null,
                release: hit.title,
                filename: single && isVideoFile(hit.title) ? hit.title : null,
                // The size of a pack is the whole pack, not the episode
                size: single ? hit.bytes || null : null,
                seeders: Number.isFinite(hit.seeders) ? hit.seeders : null,
                provider: hit.tracker || 'Knaben',
                addon: 'knaben',
                countries: [],
                multiAudio: /\b(multi|dual)[ -]?audio\b/i.test(hit.title),
                label: '',
                trackers: [],
                pack: !single
            });
        }
    }
    return sources;
}

// What the names say about a source, the file's name first since it describes the episode itself
function describe(source) {
    const fromFile = source.filename ? parseRelease(source.filename) : {};
    const fromRelease = parseRelease(source.release);
    const pick = key => (fromFile[key] !== undefined && fromFile[key] !== null && fromFile[key] !== false ? fromFile[key] : fromRelease[key]);
    let resolution = pick('resolution');
    if (!resolution && /^(4k|2160p|1080p|720p|480p)/i.test(source.label)) {
        resolution = source.label.toLowerCase().startsWith('4k') ? '2160p' : source.label.slice(0, 5).toLowerCase();
    }
    return {
        resolution,
        codec: pick('codec'),
        audio: pick('audio'),
        source: pick('source'),
        container: fromFile.container || (source.filename ? null : 'mkv'),
        hdr: !!(fromFile.hdr || fromRelease.hdr),
        tenBit: !!(fromFile.tenBit || fromRelease.tenBit),
        unwatchable: !!(fromFile.unwatchable || fromRelease.unwatchable) || /\b(3d|cam|scr)\b/i.test(source.label),
        episodes: fromFile.episodes || [],
        seasons: fromFile.seasons || []
    };
}

// Drops what can't be the episode: other episodes, cinema recordings, 3D, discs and archives
function keep(source, season, episode) {
    const info = source.info;
    if (info.unwatchable) return false;
    if (source.filename && !isVideoFile(source.filename)) return false;
    if (info.seasons.length && !info.seasons.includes(season)) return false;
    if (info.episodes.length && !info.episodes.includes(episode)) return false;
    return true;
}

function merge(sources) {
    const byHash = new Map();
    for (const source of sources) {
        const known = byHash.get(source.hash);
        if (!known) {
            byHash.set(source.hash, source);
        } else {
            // Add-ons that know the torrent better (the file inside it, more seeders) win
            if (known.fileIdx === null && source.fileIdx !== null) {
                known.fileIdx = source.fileIdx;
                known.filename = source.filename || known.filename;
            }
            known.seeders = Math.max(known.seeders || 0, source.seeders || 0) || known.seeders;
            known.trackers = [...new Set([...known.trackers, ...source.trackers])].slice(0, 40);
        }
    }
    return [...byHash.values()];
}

/**
 * Looks the torrents of an episode up. Resolves to { sources, fetchedAt, partial }, `partial` when an add-on
 * couldn't be asked. `series` is a row of the series table (the fallback search needs its title).
 */
async function lookup(series, season, episode, priority) {
    const { sources: found, failed, allFailed } = await fromAddons(series.imdb_code, season, episode, priority);
    let sources = found;
    if (!sources.length) {
        sources = await fromKnaben(series, season, episode, priority).catch((err) => {
            logger.warn(`The fallback search for ${series.title} failed: ${err.message}`);
            return [];
        });
    }
    if (!sources.length && allFailed) {
        throw new Error('No torrent add-on could be reached');
    }

    const described = merge(sources)
        .map(source => ({ ...source, info: describe(source) }))
        .filter(source => keep(source, season, episode));
    return { sources: described, fetchedAt: new Date().toISOString(), partial: failed > 0 };
}

const loading = new Map(); // "imdb:season:episode" -> promise

function isFresh(row) {
    const age = Date.now() - new Date(row.fetched_at).getTime();
    const sources = Array.isArray(row.sources) ? row.sources : [];
    return age < (row.partial ? KEEP_PARTIAL : sources.length ? KEEP_FOUND : KEEP_MISSING);
}

/**
 * The torrents of an episode, kept in the database for a few hours. When the add-ons can't be reached the
 * last list is used, however old. `priority` 'low' lets lookups a viewer waits for go first.
 */
async function getEpisodeSources(knex, series, season, episode, { refresh = false, priority = 'high' } = {}) {
    const where = { imdb_code: series.imdb_code, season, episode };
    const saved = await knex('episode_sources').where(where).first();
    if (saved && !refresh && isFresh(saved)) {
        return { sources: saved.sources || [], fetchedAt: new Date(saved.fetched_at).toISOString(), partial: !!saved.partial };
    }

    const key = `${series.imdb_code}:${season}:${episode}`;
    if (!loading.has(key)) {
        const task = lookup(series, season, episode, priority).then(async (result) => {
            await knex('episode_sources')
                .insert({ ...where, sources: JSON.stringify(result.sources), partial: result.partial, fetched_at: new Date(result.fetchedAt) })
                .onConflict(['imdb_code', 'season', 'episode'])
                .merge();
            return result;
        });
        loading.set(key, task.finally(() => loading.delete(key)));
    }

    try {
        return await loading.get(key);
    } catch (err) {
        if (saved) return { sources: saved.sources || [], fetchedAt: new Date(saved.fetched_at).toISOString(), stale: true };
        throw err;
    }
}

// A torrent from the saved list of an episode, the only ones the stream routes play
async function findSource(knex, imdbCode, season, episode, hash) {
    const saved = await knex('episode_sources').where({ imdb_code: imdbCode, season, episode }).first();
    const wanted = String(hash || '').toLowerCase();
    return saved ? (saved.sources || []).find(source => source.hash === wanted) || null : null;
}

// How the browser will get a source: as it is, with its audio converted, re-encoded, or not at all.
// `server` says what this server can convert ({ ffmpeg, transcodeVideo }).
function playbackOf(info, caps, server) {
    const container = info.container || 'mkv';
    const videoOk = info.codec === 'hevc' ? caps.has(info.tenBit ? 'hevc10' : 'hevc')
        : info.codec === 'av1' ? caps.has('av1')
        : info.codec === 'vp9' ? caps.has('vp9')
        : info.codec === 'mpeg4' ? false
        : !info.tenBit || caps.has('avc10'); // H.264, or not named, which nearly always is H.264
    const audioOk = !info.audio || ['aac', 'mp3', 'opus', 'flac'].includes(info.audio)
        || (info.audio === 'ac3' && caps.has('ac3')) || (info.audio === 'eac3' && caps.has('eac3'));
    const containerOk = ['mp4', 'm4v', 'mov'].includes(container) || (['mkv', 'webm'].includes(container) && caps.has('mkv'));

    if (!videoOk) return server.ffmpeg && server.transcodeVideo ? 'convert-video' : 'unsupported';
    if (!audioOk || !containerOk) {
        if (server.ffmpeg && info.codec !== 'mpeg4') return 'convert-audio';
        return containerOk ? 'no-sound' : 'unsupported';
    }
    return 'direct';
}

// How well a torrent is seeded, which is how fast it can be streamed
function healthOf(seeders) {
    if (seeders === null || seeders === undefined) return 'unknown';
    if (seeders >= 40) return 'great';
    if (seeders >= 10) return 'good';
    if (seeders >= 1) return 'slow';
    return 'dead';
}

// Torrents that didn't work for someone lately: nobody shared them or they were far too slow. Add-ons
// count seeders now and then, so a torrent they call healthy can be dead by now.
const FAILED_FOR = 6 * HOUR;
const failedSources = new Map(); // hash -> when it failed

function markFailed(hash) {
    failedSources.set(String(hash).toLowerCase(), Date.now());
    if (failedSources.size > 5000) failedSources.delete(failedSources.keys().next().value);
}

function failedLately(hash) {
    const at = failedSources.get(hash);
    if (!at) return false;
    if (Date.now() - at < FAILED_FOR) return true;
    failedSources.delete(hash);
    return false;
}

const RESOLUTION_SCORE = { '1080p': 100, '720p': 88, '1440p': 80, '2160p': 55, '576p': 52, '480p': 50 };
const PLAYBACK_SCORE = { direct: 35, 'convert-audio': 25, 'no-sound': -40, 'convert-video': -25, unsupported: -1000 };
const LANGUAGE_SCORE = { original: 0, multi: -25, dub: -70 };

// The countries whose flag stands for a show's own language, by TMDB's language code
const HOME_COUNTRIES = {
    en: ['GB', 'US'], ja: ['JP'], ko: ['KR'], es: ['ES', 'MX'], fr: ['FR'], de: ['DE'], it: ['IT'], ru: ['RU'],
    pt: ['PT', 'BR'], zh: ['CN', 'TW', 'HK'], hi: ['IN'], tr: ['TR'], sv: ['SE'], da: ['DK'], no: ['NO'],
    nl: ['NL'], pl: ['PL'], uk: ['UA'], fi: ['FI'], bg: ['BG']
};
const FOREIGN_WORDS = /\b(ita|italian|french|truefrench|vostfr|vff|vfi|latino|castellano|spanish|dublado|nacional|rus|russian|ukr|hindi|tamil|telugu|pt-?br|german|deutsch|polish|turkish|arabic|multi|dual)\b/i;
const ENGLISH_WORDS = /\b(eng|english)\b/i;
const CYRILLIC = /[\u0400-\u04FF]/;

/**
 * Whether a release has the show in its own language: 'original', 'multi' (the original and dubs, where a
 * dub is often the track a player picks first) or 'dub' (dubbed only). Torrentio flags the languages of a
 * release, the name says the rest.
 */
function languageFit(source, originalLanguage) {
    const home = HOME_COUNTRIES[originalLanguage];
    if (!home) return 'original';
    const text = `${source.release} ${source.filename || ''}`;
    const flags = source.countries || [];
    const hasHome = flags.some(country => home.includes(country)) || (originalLanguage === 'en' && ENGLISH_WORDS.test(text));
    const foreign = flags.some(country => !home.includes(country)) || CYRILLIC.test(text) || FOREIGN_WORDS.test(text) || source.multiAudio;
    if (!foreign) return 'original';
    return hasHome ? 'multi' : 'dub';
}

/**
 * The sources of an episode best first, each with how it would play in this browser (`caps`, from the
 * player) and how healthy it is. `originalLanguage` (TMDB's code) pushes dubbed releases down.
 */
function rank(sources, caps, server, { originalLanguage = 'en', runtime = null } = {}) {
    return sources.map((source) => {
        const info = source.info || describe(source);
        const playback = playbackOf(info, caps, server);
        const seeders = source.seeders;
        let score = RESOLUTION_SCORE[info.resolution] || 60;
        score += PLAYBACK_SCORE[playback];
        score += seeders === null || seeders === undefined ? 5 : seeders === 0 ? -80 : 15 * Math.log10(1 + seeders);
        if (info.hdr) score -= 15; // browsers show HDR washed out
        if (info.source === 'remux') score -= 20; // far bigger than anything a stream needs
        if (info.source === 'hdtv' && info.resolution !== '1080p') score -= 5;
        const language = languageFit(source, originalLanguage);
        score += LANGUAGE_SCORE[language];
        if (failedLately(source.hash)) score -= 60;
        // The more a second of video weighs, the more seeders it takes to stream it without stopping. Up to
        // about 6 Mbit/s (a good 1080p encode) is easy, a Blu-ray rip at 20 is often too much.
        if (source.size && runtime) {
            const megabitsPerSecond = (source.size * 8) / (runtime * 60) / 1e6;
            if (megabitsPerSecond > 6) score -= Math.min(40, (megabitsPerSecond - 6) * 2.5);
        }

        return {
            hash: source.hash,
            fileIdx: source.fileIdx,
            release: source.release,
            filename: source.filename,
            size: source.size,
            seeders,
            provider: source.provider,
            pack: !!source.pack || !!(source.filename && source.release !== source.filename && !parseEpisodes(source.release).episodes.length),
            resolution: info.resolution,
            codec: info.codec,
            audio: info.audio,
            hdr: info.hdr,
            languages: source.countries,
            language,
            playback,
            health: healthOf(seeders),
            score: Math.round(score * 10) / 10
        };
    })
        .filter(source => source.playback !== 'unsupported')
        .sort((a, b) => b.score - a.score);
}

module.exports = { getEpisodeSources, findSource, rank, healthOf, markFailed, addonUrls, addonName };
