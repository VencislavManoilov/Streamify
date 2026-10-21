const express = require('express');
const Authorization = require('../middleware/Auth');
const { publicSeries } = require('../utils/series');

const router = express.Router();

// A movie counts as finished once the viewer reaches the end credits
const FINISHED_RATIO = 0.95;
// The player reports every few seconds, so a single report can't add more than this
const MAX_WATCHED_PER_REPORT = 5 * 60;

// navigator.sendBeacon() can't set headers, so it sends JSON as text/plain with the token inside
router.use(express.text({ type: 'text/plain' }), (req, res, next) => {
    if (typeof req.body === 'string') {
        try {
            req.body = JSON.parse(req.body);
        } catch (err) {
            req.body = {};
        }
        if (!req.headers.authorization && req.body.token) {
            req.headers.authorization = req.body.token;
        }
    }
    next();
}, Authorization);

function toProgress(row) {
    return {
        position: row.position,
        duration: row.duration,
        watchedSeconds: row.watched_seconds,
        completed: row.completed,
        lastWatchedAt: row.last_watched_at
    };
}

function toEpisodeProgress(row) {
    return { season: row.season, episode: row.episode, ...toProgress(row) };
}

// A series in the history is shown by the episode watched last, with the time of all its episodes
function seriesEntries(rows) {
    const bySeries = new Map();
    for (const row of rows) {
        const { season, episode, position, duration, watched_seconds, completed, last_watched_at, ...series } = row;
        const progress = toEpisodeProgress({ season, episode, position, duration, watched_seconds, completed, last_watched_at });
        const entry = bySeries.get(series.imdb_code);
        if (!entry) {
            // Rows come newest first, so the first one is the episode watched last
            bySeries.set(series.imdb_code, { ...publicSeries(series), progress, watchedSeconds: progress.watchedSeconds, episodesWatched: 1, episodesFinished: completed ? 1 : 0 });
        } else {
            entry.watchedSeconds += progress.watchedSeconds;
            entry.episodesWatched += 1;
            entry.episodesFinished += completed ? 1 : 0;
        }
    }
    return [...bySeries.values()];
}

// Profile statistics and every watched movie and series, most recently watched first
router.get('/', async (req, res) => {
    try {
        const [rows, episodeRows] = await Promise.all([
            req.knex('watch_history as h')
                .join('movies as m', 'm.imdb_code', 'h.imdb_code')
                .where('h.user_id', req.user.id)
                .orderBy('h.last_watched_at', 'desc')
                .select('m.*', 'h.position', 'h.duration', 'h.watched_seconds', 'h.completed', 'h.last_watched_at'),
            req.knex('episode_history as h')
                .join('series as s', 's.imdb_code', 'h.imdb_code')
                .where('h.user_id', req.user.id)
                .orderBy('h.last_watched_at', 'desc')
                .select('s.*', 'h.season', 'h.episode', 'h.position', 'h.duration', 'h.watched_seconds', 'h.completed', 'h.last_watched_at')
        ]);

        const movies = rows.map(({ position, duration, watched_seconds, completed, last_watched_at, ...movie }) => ({
            ...movie,
            type: 'movie',
            progress: toProgress({ position, duration, watched_seconds, completed, last_watched_at })
        }));
        const series = seriesEntries(episodeRows);
        const history = [...movies, ...series]
            .sort((a, b) => new Date(b.progress.lastWatchedAt) - new Date(a.progress.lastWatchedAt));

        const movieSeconds = movies.reduce((total, movie) => total + movie.progress.watchedSeconds, 0);
        const episodeSeconds = series.reduce((total, entry) => total + entry.watchedSeconds, 0);

        res.json({
            stats: {
                moviesWatched: movies.length,
                secondsWatched: Math.round(movieSeconds + episodeSeconds),
                moviesFinished: movies.filter(movie => movie.progress.completed).length,
                seriesWatched: series.length,
                episodesWatched: episodeRows.length,
                episodesFinished: episodeRows.filter(row => row.completed).length
            },
            history
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the watch history' });
    }
});

function episodeOf(req) {
    const season = Number(req.params.season);
    const episode = Number(req.params.episode);
    return Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode >= 0 ? { season, episode } : null;
}

// Where the viewer stopped in every episode of a series they watched
router.get('/series/:imdb_code', async (req, res) => {
    try {
        const rows = await req.knex('episode_history')
            .where({ user_id: req.user.id, imdb_code: req.params.imdb_code })
            .orderBy([{ column: 'season' }, { column: 'episode' }]);
        res.json({ episodes: rows.map(toEpisodeProgress) });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the progress' });
    }
});

// Whether finishing this episode finished the whole series: the last episode of a series that has ended
async function finishesSeries(knex, imdbCode, season, episode) {
    const [series, episodes] = await Promise.all([
        knex('series').where({ imdb_code: imdbCode }).first('status'),
        knex('series_episodes').where({ imdb_code: imdbCode }).first('seasons')
    ]);
    if (!series || !['Ended', 'Canceled'].includes(series.status) || !episodes) return false;
    const regular = (episodes.seasons || []).filter(item => item.number > 0 && item.episodes.length);
    const last = regular[regular.length - 1];
    return !!last && last.number === season && last.episodes[last.episodes.length - 1].episode === episode;
}

async function saveEpisodeProgress(req, res) {
    const { imdb_code } = req.params;
    const where = episodeOf(req);
    const duration = Number(req.body.duration);
    const position = Number(req.body.position);
    const watched = Number(req.body.watched) || 0;

    if (!where) {
        return res.status(404).json({ error: 'Episode not found' });
    }
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0) {
        return res.status(400).json({ error: 'Position and duration are required' });
    }

    try {
        const series = await req.knex('series').where({ imdb_code }).first('imdb_code');
        if (!series) {
            return res.status(404).json({ error: 'Series not found' });
        }

        const key = { user_id: req.user.id, imdb_code, ...where };
        const previous = await req.knex('episode_history').where(key).first('position', 'duration');
        const wasFinished = !!previous && previous.position >= previous.duration * FINISHED_RATIO;

        const progress = {
            position: Math.min(position, duration),
            watchedSeconds: Math.min(Math.max(watched, 0), MAX_WATCHED_PER_REPORT)
        };
        const finished = progress.position >= duration * FINISHED_RATIO;

        await req.knex('episode_history')
            .insert({
                ...key,
                position: progress.position,
                duration,
                watched_seconds: progress.watchedSeconds,
                completed: finished,
                last_watched_at: req.knex.fn.now()
            })
            .onConflict(['user_id', 'imdb_code', 'season', 'episode'])
            .merge({
                position: progress.position,
                duration,
                watched_seconds: req.knex.raw('?? + ?', ['episode_history.watched_seconds', progress.watchedSeconds]),
                completed: req.knex.raw('?? OR ?', ['episode_history.completed', finished]),
                last_watched_at: req.knex.fn.now()
            });

        // Like a movie, a series leaves the watchlist when the report that crosses the finish line of its
        // very last episode comes in
        let removedFromWatchlist = false;
        if (finished && !wasFinished && await finishesSeries(req.knex, imdb_code, where.season, where.episode)) {
            const removed = await req.knex('watchlist').where({ user_id: req.user.id, imdb_code }).del();
            removedFromWatchlist = removed > 0;
        }

        res.json({ removedFromWatchlist });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save the progress' });
    }
}

router.put('/series/:imdb_code/:season/:episode', saveEpisodeProgress);
router.post('/series/:imdb_code/:season/:episode', saveEpisodeProgress);

// Takes a whole series off the watch history. The removed episodes come back in the answer for the undo.
router.delete('/series/:imdb_code', async (req, res) => {
    try {
        const rows = await req.knex('episode_history')
            .where({ user_id: req.user.id, imdb_code: req.params.imdb_code })
            .del()
            .returning('*');
        res.json({ removed: rows.length ? rows.map(toEpisodeProgress) : null });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove the series from the watch history' });
    }
});

// Puts back the episodes that were just removed (the undo of the route above)
router.post('/series/:imdb_code/restore', async (req, res) => {
    const { imdb_code } = req.params;
    const episodes = Array.isArray(req.body.episodes) ? req.body.episodes.slice(0, 5000) : [];
    const rows = [];
    for (const entry of episodes) {
        const season = Number(entry.season);
        const episode = Number(entry.episode);
        const duration = Number(entry.duration);
        const position = Number(entry.position);
        const watchedSeconds = Number(entry.watchedSeconds);
        const lastWatchedAt = new Date(entry.lastWatchedAt);
        if (!Number.isInteger(season) || !Number.isInteger(episode) || !Number.isFinite(duration) || duration <= 0
            || !Number.isFinite(position) || position < 0 || !Number.isFinite(watchedSeconds) || watchedSeconds < 0) {
            return res.status(400).json({ error: 'Every episode needs its position, duration and watched time' });
        }
        rows.push({
            user_id: req.user.id,
            imdb_code,
            season,
            episode,
            position: Math.min(position, duration),
            duration,
            watched_seconds: watchedSeconds,
            completed: entry.completed === true,
            last_watched_at: lastWatchedAt.getTime() <= Date.now() ? lastWatchedAt : new Date()
        });
    }

    try {
        const series = await req.knex('series').where({ imdb_code }).first('imdb_code');
        if (!series) {
            return res.status(404).json({ error: 'Series not found' });
        }
        // Episodes watched again in the meantime started new entries, which are kept
        if (rows.length) {
            await req.knex('episode_history').insert(rows).onConflict(['user_id', 'imdb_code', 'season', 'episode']).ignore();
        }
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: 'Failed to put the series back in the watch history' });
    }
});

// Where the viewer stopped watching a movie
router.get('/:imdb_code', async (req, res) => {
    try {
        const row = await req.knex('watch_history')
            .where({ user_id: req.user.id, imdb_code: req.params.imdb_code })
            .first();

        res.json({ progress: row ? toProgress(row) : null });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the progress' });
    }
});

async function saveProgress(req, res) {
    const { imdb_code } = req.params;
    const duration = Number(req.body.duration);
    const position = Number(req.body.position);
    const watched = Number(req.body.watched) || 0;

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0) {
        return res.status(400).json({ error: 'Position and duration are required' });
    }

    try {
        const movie = await req.knex('movies').where({ imdb_code }).first('imdb_code');
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        const previous = await req.knex('watch_history')
            .where({ user_id: req.user.id, imdb_code })
            .first('position', 'duration');
        const wasFinished = !!previous && previous.position >= previous.duration * FINISHED_RATIO;

        const progress = {
            position: Math.min(position, duration),
            duration,
            watchedSeconds: Math.min(Math.max(watched, 0), MAX_WATCHED_PER_REPORT)
        };
        const finished = progress.position >= duration * FINISHED_RATIO;

        await req.knex('watch_history')
            .insert({
                user_id: req.user.id,
                imdb_code,
                position: progress.position,
                duration,
                watched_seconds: progress.watchedSeconds,
                completed: finished,
                last_watched_at: req.knex.fn.now()
            })
            .onConflict(['user_id', 'imdb_code'])
            .merge({
                position: progress.position,
                duration,
                watched_seconds: req.knex.raw('?? + ?', ['watch_history.watched_seconds', progress.watchedSeconds]),
                completed: req.knex.raw('?? OR ?', ['watch_history.completed', finished]),
                last_watched_at: req.knex.fn.now()
            });

        // Watching a movie to the end takes it off the watchlist. Only the report that crosses the finish line
        // does it, so a movie put back on the list while the credits roll stays there.
        let removedFromWatchlist = false;
        if (finished && !wasFinished) {
            const removed = await req.knex('watchlist').where({ user_id: req.user.id, imdb_code }).del();
            removedFromWatchlist = removed > 0;
        }

        res.json({ removedFromWatchlist });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save the progress' });
    }
}

router.put('/:imdb_code', saveProgress);
router.post('/:imdb_code', saveProgress);

// Takes a movie off the watch history. The removed entry comes back in the answer, so it can be undone.
router.delete('/:imdb_code', async (req, res) => {
    try {
        const [row] = await req.knex('watch_history')
            .where({ user_id: req.user.id, imdb_code: req.params.imdb_code })
            .del()
            .returning('*');

        res.json({ removed: row ? toProgress(row) : null });
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove the movie from the watch history' });
    }
});

// Puts back an entry that was just removed (the undo of the route above)
router.post('/:imdb_code/restore', async (req, res) => {
    const { imdb_code } = req.params;
    const duration = Number(req.body.duration);
    const position = Number(req.body.position);
    const watchedSeconds = Number(req.body.watchedSeconds);
    const lastWatchedAt = new Date(req.body.lastWatchedAt);

    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(position) || position < 0
        || !Number.isFinite(watchedSeconds) || watchedSeconds < 0) {
        return res.status(400).json({ error: 'Position, duration and the watched time are required' });
    }

    try {
        const movie = await req.knex('movies').where({ imdb_code }).first('imdb_code');
        if (!movie) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        // Watching the movie again in the meantime started a new entry, which is kept
        await req.knex('watch_history')
            .insert({
                user_id: req.user.id,
                imdb_code,
                position: Math.min(position, duration),
                duration,
                watched_seconds: watchedSeconds,
                completed: req.body.completed === true,
                last_watched_at: lastWatchedAt.getTime() <= Date.now() ? lastWatchedAt : req.knex.fn.now()
            })
            .onConflict(['user_id', 'imdb_code'])
            .ignore();

        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: 'Failed to put the movie back in the watch history' });
    }
});

module.exports = router;
