const axios = require('axios');
const logger = require('./logger');
const { getEpisodeSources } = require('./streamSources');

/**
 * Series come from TMDB (posters, cast, genres, status...) and their episodes from Cinemeta, Stremio's own
 * catalog. Torrent add-ons number episodes the way Cinemeta does, which isn't always TMDB's way (anime and
 * long running shows split their seasons differently), so the episode list has to be Cinemeta's.
 */

const TMDB_IMAGES = 'https://image.tmdb.org/t/p';
const CINEMETA_URL = (process.env.CINEMETA_URL || 'https://v3-cinemeta.strem.io').replace(/\/+$/, '');
const cinemeta = axios.create({ baseURL: CINEMETA_URL, timeout: 15000 });

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// The details of a series (status, next episode) change, so they're looked up again after a day
const KEEP_SERIES = DAY;
const KEEP_DETAILS = 14 * DAY;
// Episode lists of shows that still air change weekly, the others hardly ever
const KEEP_EPISODES_AIRING = 12 * HOUR;
const KEEP_EPISODES_ENDED = 7 * DAY;
// Whether a series has torrents at all, see checkAvailable
const KEEP_AVAILABLE = 14 * DAY;
const KEEP_UNAVAILABLE = 3 * DAY;
const MAX_ENRICHED_SEASONS = 20;
const CAST_SIZE = 15;

const AIRING = ['Returning Series', 'In Production', 'Planned', 'Pilot'];

// TMDB's TV genres are pairs; split, they match the movie genres from YTS
const GENRES = {
    'Action & Adventure': ['Action', 'Adventure'],
    'Sci-Fi & Fantasy': ['Sci-Fi', 'Fantasy'],
    'War & Politics': ['War', 'Politics'],
    Kids: ['Family'],
    Reality: ['Reality-TV'],
    Talk: ['Talk-Show']
};

// Talk shows, news and soaps aren't what people come here for, and torrents of them rarely last
const SKIPPED_GENRES = [10763, 10766, 10767];

function image(path, size) {
    return path ? `${TMDB_IMAGES}/${size}${path}` : '';
}

function yearOf(date) {
    const year = Number(String(date || '').slice(0, 4));
    return year > 1800 ? year : null;
}

function genreNames(genres) {
    const names = (genres || []).flatMap(genre => GENRES[genre.name] || [genre.name]);
    return [...new Set(names)];
}

function episodeRef(episode) {
    if (!episode) return null;
    return {
        season: episode.season_number,
        episode: episode.episode_number,
        name: episode.name || '',
        airDate: episode.air_date || null
    };
}

function certification(contentRatings) {
    const ratings = (contentRatings && contentRatings.results) || [];
    const us = ratings.find(rating => rating.iso_3166_1 === 'US' && rating.rating);
    return us ? us.rating.trim() : '';
}

function trailer(videos) {
    const youtube = ((videos && videos.results) || []).filter(video => video.site === 'YouTube' && video.key);
    const video = youtube.find(item => item.type === 'Trailer' && item.official)
        || youtube.find(item => item.type === 'Trailer')
        || youtube.find(item => item.type === 'Teaser');
    return video ? { key: video.key, name: video.name || 'Trailer' } : null;
}

// A row of the series table from TMDB's answer
function toRow(tv) {
    const ended = ['Ended', 'Canceled'].includes(tv.status);
    const runtimes = (tv.episode_run_time || []).filter(Boolean);
    return {
        imdb_code: tv.external_ids.imdb_id,
        tmdb_id: tv.id,
        title: tv.name,
        original_title: tv.original_name && tv.original_name !== tv.name ? tv.original_name : '',
        year: yearOf(tv.first_air_date),
        end_year: ended ? yearOf(tv.last_air_date) : null,
        status: tv.status || '',
        genres: JSON.stringify(genreNames(tv.genres)),
        rating: Math.round((tv.vote_average || 0) * 10) / 10,
        runtime: runtimes[0] || (tv.last_episode_to_air && tv.last_episode_to_air.runtime) || null,
        number_of_seasons: tv.number_of_seasons || 0,
        number_of_episodes: tv.number_of_episodes || 0,
        summary: tv.overview || 'No summary available',
        background_image: image(tv.backdrop_path, 'w1280'),
        small_cover_image: image(tv.poster_path, 'w154'),
        medium_cover_image: image(tv.poster_path, 'w342'),
        large_cover_image: image(tv.poster_path, 'w780'),
        networks: JSON.stringify((tv.networks || []).map(network => network.name).filter(Boolean)),
        last_episode: JSON.stringify(episodeRef(tv.last_episode_to_air)),
        next_episode: JSON.stringify(episodeRef(tv.next_episode_to_air)),
        original_language: tv.original_language || '',
        certification: certification(tv.content_ratings),
        fetched_at: new Date()
    };
}

// What the series card and page show besides the row itself: cast, creators, trailer...
function toDetails(tv) {
    const cast = ((tv.aggregate_credits && tv.aggregate_credits.cast) || [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .slice(0, CAST_SIZE)
        .map(person => ({
            name: person.name,
            character: ((person.roles || [])[0] || {}).character || '',
            episodes: person.total_episode_count || 0,
            profilePath: person.profile_path || null
        }));

    return {
        tmdbId: tv.id,
        tagline: tv.tagline || '',
        type: tv.type || '',
        creators: (tv.created_by || []).map(person => person.name).filter(Boolean),
        cast,
        trailer: trailer(tv.videos),
        firstAired: tv.first_air_date || null,
        lastAired: tv.last_air_date || null,
        originalTitle: tv.original_name && tv.original_name !== tv.name ? tv.original_name : '',
        originalLanguage: tv.original_language || '',
        languages: (tv.spoken_languages || []).map(language => language.english_name || language.name).filter(Boolean),
        countries: (tv.production_countries || []).map(country => country.name).filter(Boolean),
        studios: (tv.production_companies || []).slice(0, 4).map(company => company.name).filter(Boolean),
        networks: (tv.networks || []).map(network => network.name).filter(Boolean)
    };
}

async function fetchTv(tmdb, tmdbId, { full = false } = {}) {
    const append = full ? 'external_ids,content_ratings,aggregate_credits,videos' : 'external_ids,content_ratings';
    const response = await tmdb.get(`/tv/${tmdbId}`, { params: { append_to_response: append } });
    return response.data;
}

async function saveRow(knex, row) {
    await knex('series').insert(row).onConflict('imdb_code').merge();
    return knex('series').where({ imdb_code: row.imdb_code }).first();
}

// Looks a series up on TMDB by its TMDB id and saves it. Resolves to null when it has no IMDb code.
async function importSeries(knex, tmdb, tmdbId) {
    const tv = await fetchTv(tmdb, tmdbId);
    if (!tv.external_ids || !/^tt\d+$/.test(tv.external_ids.imdb_id || '')) return null;
    return saveRow(knex, toRow(tv));
}

const loadingSeries = new Map(); // IMDb code -> promise

/**
 * The series with this IMDb code, from the database and looked up on TMDB when it isn't there or is a day
 * old. Resolves to null when TMDB doesn't know it.
 */
async function getSeries(knex, tmdb, imdbCode, { refresh = false } = {}) {
    const saved = await knex('series').where({ imdb_code: imdbCode }).first();
    const fresh = saved && saved.fetched_at && Date.now() - new Date(saved.fetched_at).getTime() < KEEP_SERIES;
    if (saved && (fresh || !process.env.TMDB_API_KEY) && !refresh) return saved;

    if (!loadingSeries.has(imdbCode)) {
        const lookup = (async () => {
            let tmdbId = saved && saved.tmdb_id;
            if (!tmdbId) {
                const found = await tmdb.get(`/find/${imdbCode}`, { params: { external_source: 'imdb_id' } });
                const match = (found.data.tv_results || [])[0];
                if (!match) return null;
                tmdbId = match.id;
            }
            const tv = await fetchTv(tmdb, tmdbId);
            // TMDB may know the series under another IMDb code now, the one asked for stays
            const row = toRow({ ...tv, external_ids: { ...(tv.external_ids || {}), imdb_id: imdbCode } });
            return saveRow(knex, row);
        })();
        loadingSeries.set(imdbCode, lookup.finally(() => loadingSeries.delete(imdbCode)));
    }

    try {
        return await loadingSeries.get(imdbCode);
    } catch (err) {
        logger.warn(`Could not load the series ${imdbCode} from TMDB: ${err.message}`);
        if (saved) return saved;
        throw err;
    }
}

// Cast, creators and the rest, looked up the first time a series is opened and then every two weeks
async function getDetails(knex, tmdb, series) {
    const fresh = series.details && series.details_fetched_at
        && Date.now() - new Date(series.details_fetched_at).getTime() < KEEP_DETAILS;
    if (fresh || !process.env.TMDB_API_KEY) return series.details || null;

    try {
        const tv = await fetchTv(tmdb, series.tmdb_id, { full: true });
        const details = toDetails(tv);
        await knex('series').where({ imdb_code: series.imdb_code }).update({
            details: JSON.stringify(details),
            details_fetched_at: new Date()
        });
        return details;
    } catch (err) {
        logger.warn(`Could not load the details of ${series.title} from TMDB: ${err.message}`);
        if (series.details) return series.details;
        throw err;
    }
}

function cinemetaEpisode(video) {
    return {
        episode: Number(video.number !== undefined ? video.number : video.episode),
        title: video.name || video.title || '',
        overview: video.overview || video.description || '',
        aired: video.released || video.firstAired || null,
        still: video.thumbnail || '',
        runtime: null,
        rating: Number(video.rating) || null
    };
}

function groupSeasons(episodes) {
    const seasons = new Map();
    for (const { season, ...episode } of episodes) {
        if (!Number.isInteger(season) || !Number.isInteger(episode.episode) || episode.episode < 0) continue;
        if (!seasons.has(season)) seasons.set(season, []);
        seasons.get(season).push(episode);
    }
    return [...seasons.entries()]
        // Specials go last
        .sort(([a], [b]) => (a === 0) - (b === 0) || a - b)
        .map(([number, list]) => ({
            number,
            name: number === 0 ? 'Specials' : `Season ${number}`,
            episodes: list.sort((a, b) => a.episode - b.episode)
                .filter((episode, index, sorted) => index === 0 || sorted[index - 1].episode !== episode.episode)
        }));
}

async function fromCinemeta(imdbCode) {
    const response = await cinemeta.get(`/meta/series/${imdbCode}.json`);
    const videos = (response.data && response.data.meta && response.data.meta.videos) || [];
    return groupSeasons(videos.map(video => ({ season: Number(video.season), ...cinemetaEpisode(video) })));
}

async function tmdbSeason(tmdb, tmdbId, number) {
    const response = await tmdb.get(`/tv/${tmdbId}/season/${number}`);
    return (response.data.episodes || []).map(episode => ({
        episode: episode.episode_number,
        title: episode.name || '',
        overview: episode.overview || '',
        aired: episode.air_date || null,
        still: image(episode.still_path, 'w400'),
        runtime: episode.runtime || null,
        rating: episode.vote_average ? Math.round(episode.vote_average * 10) / 10 : null
    }));
}

// Runtimes and better stills from TMDB, for the seasons where both catalogs number the episodes alike
async function enrich(tmdb, series, seasons) {
    if (!series.tmdb_id || !process.env.TMDB_API_KEY || seasons.length > MAX_ENRICHED_SEASONS) return seasons;
    return Promise.all(seasons.map(async (season) => {
        try {
            const episodes = await tmdbSeason(tmdb, series.tmdb_id, season.number);
            if (episodes.length !== season.episodes.length) return season;
            const byNumber = new Map(episodes.map(episode => [episode.episode, episode]));
            return {
                ...season,
                episodes: season.episodes.map((episode) => {
                    const match = byNumber.get(episode.episode);
                    if (!match) return episode;
                    return {
                        ...episode,
                        title: episode.title || match.title,
                        overview: episode.overview || match.overview,
                        still: match.still || episode.still,
                        runtime: match.runtime,
                        rating: match.rating || episode.rating
                    };
                })
            };
        } catch (err) {
            return season;
        }
    }));
}

async function fromTmdb(tmdb, series) {
    const tv = await fetchTv(tmdb, series.tmdb_id);
    const numbers = (tv.seasons || []).map(season => season.season_number).filter(Number.isInteger);
    const seasons = await Promise.all(numbers.map(async number => ({
        number,
        name: number === 0 ? 'Specials' : `Season ${number}`,
        episodes: await tmdbSeason(tmdb, series.tmdb_id, number).catch(() => [])
    })));
    return seasons.filter(season => season.episodes.length).sort((a, b) => (a.number === 0) - (b.number === 0) || a.number - b.number);
}

const loadingEpisodes = new Map();

/**
 * Every season with its episodes: [{ number, name, episodes: [{ episode, title, overview, aired, still,
 * runtime, rating }] }], specials last. Kept in the database for half a day (a week for ended shows).
 */
async function getEpisodes(knex, tmdb, series, { refresh = false } = {}) {
    const saved = await knex('series_episodes').where({ imdb_code: series.imdb_code }).first();
    const keep = AIRING.includes(series.status) ? KEEP_EPISODES_AIRING : KEEP_EPISODES_ENDED;
    if (saved && !refresh && Date.now() - new Date(saved.fetched_at).getTime() < keep) return saved.seasons;

    const key = series.imdb_code;
    if (!loadingEpisodes.has(key)) {
        const lookup = (async () => {
            let seasons = await fromCinemeta(series.imdb_code).catch((err) => {
                logger.warn(`Cinemeta couldn't list the episodes of ${series.title}: ${err.message}`);
                return [];
            });
            seasons = seasons.length ? await enrich(tmdb, series, seasons) : await fromTmdb(tmdb, series);
            if (!seasons.length) throw new Error('No episodes found');
            await knex('series_episodes')
                .insert({ imdb_code: key, seasons: JSON.stringify(seasons), fetched_at: new Date() })
                .onConflict('imdb_code')
                .merge();
            return seasons;
        })();
        loadingEpisodes.set(key, lookup.finally(() => loadingEpisodes.delete(key)));
    }

    try {
        return await loadingEpisodes.get(key);
    } catch (err) {
        if (saved) return saved.seasons;
        throw err;
    }
}

function hasAired(episode, now = Date.now()) {
    if (!episode.aired) return true;
    const time = new Date(episode.aired).getTime();
    return !Number.isFinite(time) || time <= now;
}

function knownAvailability(series) {
    const checkedAt = series.available_checked_at ? new Date(series.available_checked_at).getTime() : 0;
    const keep = series.available ? KEEP_AVAILABLE : KEEP_UNAVAILABLE;
    const known = series.available !== null && series.available !== undefined && Date.now() - checkedAt < keep;
    return known ? series.available : null;
}

/**
 * Whether the series has torrents, judged by its first episode. Checked again after two weeks, or three
 * days when it had none. Resolves to true, false, or null when nobody could be asked.
 */
async function checkAvailable(knex, series, { force = false, priority = 'high' } = {}) {
    const known = knownAvailability(series);
    if (!force && known !== null) return known;

    try {
        const { sources, partial } = await getEpisodeSources(knex, series, 1, 1, { priority });
        // An add-on that couldn't be asked may well have had it
        if (!sources.length && partial) return null;
        const available = sources.length > 0;
        await knex('series').where({ imdb_code: series.imdb_code }).update({ available, available_checked_at: new Date() });
        series.available = available;
        return available;
    } catch (err) {
        return null;
    }
}

// Runs `fn` for every item with at most `limit` running at once. `fn` must not throw.
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    }));
    return results;
}

// Saved rows for TMDB ids, importing the ones that aren't saved or are old
async function rowsFor(knex, tmdb, tmdbIds) {
    const saved = tmdbIds.length ? await knex('series').whereIn('tmdb_id', tmdbIds) : [];
    const byId = new Map(saved.map(row => [row.tmdb_id, row]));
    return mapLimit(tmdbIds, 6, async (tmdbId) => {
        const row = byId.get(tmdbId);
        if (row && Date.now() - new Date(row.fetched_at).getTime() < KEEP_SERIES) return row;
        try {
            return await importSeries(knex, tmdb, tmdbId);
        } catch (err) {
            logger.warn(`Could not load the series ${tmdbId} from TMDB: ${err.message}`);
            return row || null;
        }
    });
}

// A search waits this long for the torrent checks of new series. The checks go on afterwards, so the
// next search knows.
const SEARCH_CHECK_WAIT = 5000;

/**
 * Series matching a search, best match first, without the ones that have no torrents.
 */
async function searchSeries(knex, tmdb, query) {
    if (!process.env.TMDB_API_KEY) return [];
    const response = await tmdb.get('/search/tv', { params: { query, include_adult: false } });
    const results = (response.data.results || [])
        .filter(result => !(result.genre_ids || []).some(id => SKIPPED_GENRES.includes(id)))
        .slice(0, 20);

    const rows = (await rowsFor(knex, tmdb, results.map(result => result.id))).filter(Boolean);
    const available = rows.map(knownAvailability);
    const checks = rows.map((row, index) => (available[index] !== null ? null : checkAvailable(knex, row).then((result) => {
        available[index] = result;
    })));
    await Promise.race([
        Promise.all(checks),
        new Promise(resolve => setTimeout(resolve, SEARCH_CHECK_WAIT))
    ]);
    // A series that couldn't be checked (yet) is kept, it's probably fine
    return rows.filter((row, index) => available[index] !== false);
}

const CATEGORY_GENRES = [
    { id: 10759, name: 'Action & Adventure' },
    { id: 35, name: 'Comedy' },
    { id: 80, name: 'Crime' },
    { id: 18, name: 'Drama' },
    { id: 10765, name: 'Sci-Fi & Fantasy' },
    { id: 9648, name: 'Mystery' },
    { id: 16, name: 'Animation' },
    { id: 99, name: 'Documentary' },
    { id: 10768, name: 'War & Politics' }
];

function isoDay(date) {
    return date.toISOString().slice(0, 10);
}

/**
 * The rows of the series home page, like the movie ones: trending, new, popular, best rated and genres.
 * Resolves once they are saved, to a function that checks which of them have torrents (which takes a while)
 * and saves them again without the ones that don't.
 */
async function fetchSeriesCategories(knex, tmdb) {
    const halfYearAgo = isoDay(new Date(Date.now() - 180 * DAY));
    const today = isoDay(new Date());
    const voted = { 'vote_count.gte': 150, without_genres: SKIPPED_GENRES.join('|') };
    const lists = [
        { name: 'Trending', path: '/trending/tv/day' },
        { name: 'New Episodes', path: '/tv/on_the_air' },
        { name: 'New Series', path: '/discover/tv', params: { 'first_air_date.gte': halfYearAgo, 'first_air_date.lte': today, sort_by: 'popularity.desc', 'vote_count.gte': 20, without_genres: SKIPPED_GENRES.join('|') } },
        { name: 'Popular', path: '/tv/popular' },
        { name: 'Top Rated', path: '/tv/top_rated' },
        { name: 'Miniseries', path: '/discover/tv', params: { with_type: 2, sort_by: 'popularity.desc', ...voted } },
        { name: 'Anime', path: '/discover/tv', params: { with_genres: 16, with_original_language: 'ja', sort_by: 'popularity.desc', 'vote_count.gte': 50 } },
        ...CATEGORY_GENRES.map(genre => ({ name: genre.name, path: '/discover/tv', params: { with_genres: genre.id, sort_by: 'popularity.desc', ...voted } }))
    ];

    const fetched = [];
    for (const list of lists) {
        try {
            const response = await tmdb.get(list.path, { params: list.params });
            const ids = (response.data.results || [])
                .filter(result => !(result.genre_ids || []).some(id => SKIPPED_GENRES.includes(id)))
                .map(result => result.id);
            const rows = (await rowsFor(knex, tmdb, ids)).filter(Boolean);
            fetched.push({ name: list.name, rows });
        } catch (err) {
            logger.warn(`Could not load the series category ${list.name}: ${err.message}`);
        }
    }
    if (!fetched.some(list => list.rows.length)) {
        throw new Error('No series category could be loaded');
    }

    // Saved right away without the series known to have no torrents. The others are checked afterwards in
    // the background, slowly, so they don't get in the way of people looking for episodes.
    const save = async (isAvailable) => {
        const categories = fetched.map(list => ({
            name: list.name,
            series: [...new Set(list.rows.filter(row => isAvailable(row) !== false).map(row => row.imdb_code))]
        }));
        // Swapped in one go, so a failed refresh never leaves the page empty
        await knex.transaction(async (trx) => {
            await trx('series_categories').del();
            for (const category of categories) {
                await trx('series_categories').insert({ name: category.name, series: JSON.stringify(category.series) });
            }
        });
        return categories;
    };
    await save(knownAvailability);
    logger.info(`Saved ${fetched.length} series categories`);

    return async function checkAll() {
        const unique = [...new Map(fetched.flatMap(list => list.rows).map(row => [row.imdb_code, row])).values()];
        const available = new Map();
        await mapLimit(unique, 2, async (row) => {
            available.set(row.imdb_code, await checkAvailable(knex, row, { priority: 'low' }));
        });
        const categories = await save(row => available.get(row.imdb_code));
        const kept = categories.reduce((total, category) => total + category.series.length, 0);
        logger.info(`Checked the torrents of ${unique.length} series, ${kept} series are in the categories`);
    };
}

async function loadSeriesCategories(knex) {
    const rows = await knex('series_categories').select('*').orderBy('id');
    const loaded = [];
    for (const category of rows) {
        const codes = [...(category.series || [])].sort(() => Math.random() - 0.5);
        const series = codes.length ? await knex('series').whereIn('imdb_code', codes) : [];
        const byCode = new Map(series.map(row => [row.imdb_code, row]));
        loaded.push({ name: category.name, movies: codes.map(code => byCode.get(code)).filter(Boolean).map(publicSeries) });
    }
    return loaded;
}

// A series as the pages get it. `type` tells it apart from a movie wherever both are listed together.
function publicSeries(row) {
    if (!row) return null;
    const { details, details_fetched_at, available_checked_at, fetched_at, tmdb_id, ...rest } = row;
    return { ...rest, type: 'series' };
}

const FINISHED_RATIO = 0.95;

function isFinished(progress) {
    return !!progress && progress.duration > 0 && progress.position >= progress.duration * FINISHED_RATIO;
}

/**
 * The episode to play when the series is opened: where the viewer left off, the next one when that was
 * finished, or the first one. `progress` are the viewer's episode history rows.
 */
function nextUp(seasons, progress, now = Date.now()) {
    const list = seasons
        .filter(season => season.number > 0)
        .flatMap(season => season.episodes.map(episode => ({ season: season.number, ...episode })));
    if (!list.length) return null;

    const find = (season, episode) => progress.find(row => row.season === season && row.episode === episode);
    const latest = progress.slice().sort((a, b) => new Date(b.last_watched_at) - new Date(a.last_watched_at))[0];
    if (!latest) {
        return { season: list[0].season, episode: list[0].episode, position: 0, reason: 'start' };
    }
    if (!isFinished(latest)) {
        return { season: latest.season, episode: latest.episode, position: latest.position, reason: 'resume' };
    }

    const index = list.findIndex(item => item.season === latest.season && item.episode === latest.episode);
    const next = index === -1 ? null : list[index + 1];
    if (next && hasAired(next, now)) {
        const started = find(next.season, next.episode);
        return {
            season: next.season,
            episode: next.episode,
            position: started && !isFinished(started) ? started.position : 0,
            reason: 'next'
        };
    }
    return {
        season: latest.season,
        episode: latest.episode,
        position: 0,
        reason: 'caught-up',
        upcoming: next ? { season: next.season, episode: next.episode, aired: next.aired } : null
    };
}

module.exports = {
    getSeries,
    getDetails,
    getEpisodes,
    checkAvailable,
    searchSeries,
    fetchSeriesCategories,
    loadSeriesCategories,
    publicSeries,
    nextUp,
    hasAired,
    isFinished,
    mapLimit
};
