import api from './api';

// Series, their details and episodes, asked for once per series and page load. A failed request is
// tried again the next time.
const caches = {
    series: new Map(),
    details: new Map(),
    episodes: new Map()
};

function cached(cache, key, load) {
    if (!cache.has(key)) {
        const request = load();
        cache.set(key, request);
        request.catch(() => cache.delete(key));
    }
    return cache.get(key);
}

export const seriesData = {
    series(imdbCode) {
        return cached(caches.series, imdbCode, () => api.get(`/series/${imdbCode}`).then(response => response.data.series));
    },

    // Cast, creators and the rest from TMDB (null when TMDB couldn't be asked)
    details(imdbCode) {
        return cached(caches.details, imdbCode, () => api.get(`/series/${imdbCode}/details`).then(response => response.data.details));
    },

    // [{ number, name, episodes: [{ episode, title, overview, aired, still, runtime, rating }] }], specials last
    episodes(imdbCode) {
        return cached(caches.episodes, imdbCode, () => api.get(`/series/${imdbCode}/episodes`).then(response => response.data.seasons));
    },

    // Where the viewer left off: { next: { season, episode, position, reason }, progress: [...] }. Never
    // cached, it changes with every episode watched.
    next(imdbCode) {
        return api.get(`/series/${imdbCode}/next`).then(response => response.data);
    }
};

// The seasons' episodes in watching order, specials left out
export function episodeList(seasons) {
    return (seasons || [])
        .filter(season => season.number > 0)
        .flatMap(season => season.episodes.map(episode => ({ season: season.number, ...episode })));
}

export function hasAired(episode, now = Date.now()) {
    if (!episode || !episode.aired) return true;
    const time = new Date(episode.aired).getTime();
    return !Number.isFinite(time) || time <= now;
}

// "21 Jan 2008"
export function formatAirDate(date, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    const time = new Date(date);
    return Number.isFinite(time.getTime()) ? time.toLocaleDateString('en-GB', options) : '';
}

// "2008–2013", or "2019–" for a series still running
export function seriesYears(series) {
    if (!series.year) return '';
    if (series.end_year) return series.end_year === series.year ? String(series.year) : `${series.year}–${series.end_year}`;
    return ['Ended', 'Canceled'].includes(series.status) ? String(series.year) : `${series.year}–`;
}

const DAY = 24 * 60 * 60 * 1000;

// "New season" or "New episode" for a series whose latest episode aired lately
export function freshness(series, now = Date.now()) {
    const last = series && series.last_episode;
    if (!last || !last.airDate) return '';
    const age = now - new Date(last.airDate).getTime();
    if (!(age >= 0 && age <= 10 * DAY)) return '';
    if (last.episode === 1) return last.season > 1 ? 'New season' : 'New series';
    return 'New episode';
}
