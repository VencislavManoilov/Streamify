const express = require('express');
const Authorization = require('../middleware/Auth');

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

// Profile statistics and every watched movie, most recently watched first
router.get('/', async (req, res) => {
    try {
        const rows = await req.knex('watch_history as h')
            .join('movies as m', 'm.imdb_code', 'h.imdb_code')
            .where('h.user_id', req.user.id)
            .orderBy('h.last_watched_at', 'desc')
            .select('m.*', 'h.position', 'h.duration', 'h.watched_seconds', 'h.completed', 'h.last_watched_at');

        const history = rows.map(({ position, duration, watched_seconds, completed, last_watched_at, ...movie }) => ({
            ...movie,
            progress: toProgress({ position, duration, watched_seconds, completed, last_watched_at })
        }));

        res.json({
            stats: {
                moviesWatched: history.length,
                secondsWatched: Math.round(history.reduce((total, movie) => total + movie.progress.watchedSeconds, 0)),
                moviesFinished: history.filter(movie => movie.progress.completed).length
            },
            history
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the watch history' });
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
