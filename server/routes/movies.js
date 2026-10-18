const express = require('express');
const Authorization = require('../middleware/Auth');
const yts = require('../utils/yts');
const { getDetails } = require('../utils/movieDetails');
const logger = require('../utils/logger');

const router = express.Router();

router.use(Authorization);

const HOUR = 60 * 60 * 1000;
// A reset looks the movie up on YTS again and rewrites it. YTS rarely changes a movie within the hour,
// so after a reset the movie can't be reset again for this long.
const RESET_COOLDOWN = HOUR;
// How many resets one person can start within an hour, so nobody can hammer YTS through the server
const RESETS_PER_HOUR = 5;

const resetsByUser = new Map(); // user id -> when they started their resets of the last hour
const resetting = new Map(); // IMDb code -> promise of the reset in progress

function recentResets(userId, now = Date.now()) {
    const times = (resetsByUser.get(userId) || []).filter(time => now - time < HOUR);
    if (times.length) {
        resetsByUser.set(userId, times);
    } else {
        resetsByUser.delete(userId);
    }
    return times;
}

// When the user can reset this movie and why not before. Admins are never held back.
function resetStatus(movie, user, now = Date.now()) {
    const resetAt = movie.reset_at ? new Date(movie.reset_at).getTime() : null;
    if (user.role === 'admin') {
        return { resetAt, availableAt: null, reason: null, remaining: null };
    }

    const times = recentResets(user.id, now);
    const movieReady = resetAt ? resetAt + RESET_COOLDOWN : 0;
    const userReady = times.length >= RESETS_PER_HOUR ? times[0] + HOUR : 0;
    const availableAt = Math.max(movieReady, userReady);

    return {
        resetAt,
        availableAt: availableAt > now ? availableAt : null,
        reason: availableAt > now ? (movieReady >= userReady ? 'movie' : 'user') : null,
        remaining: Math.max(0, RESETS_PER_HOUR - times.length)
    };
}

function describeTorrent({ hash, quality, type, video_codec }) {
    return { hash, quality, type, video_codec };
}

// Which torrents the reset added and which ones YTS doesn't list anymore
function torrentChanges(before, after) {
    const key = torrent => String(torrent.hash).toLowerCase();
    const old = new Set((before || []).map(key));
    const current = new Set((after || []).map(key));
    return {
        added: (after || []).filter(torrent => !old.has(key(torrent))).map(describeTorrent),
        removed: (before || []).filter(torrent => !current.has(key(torrent))).map(describeTorrent)
    };
}

async function resetMovie(req, movie) {
    const imdb_code = movie.imdb_code;

    let ytsMovie;
    try {
        ytsMovie = await yts.getMovieDetails(imdb_code);
    } catch (err) {
        logger.error(`Could not reset "${movie.title}", YTS failed: ${err.message}`);
        throw Object.assign(new Error("YTS can't be reached right now. Try again in a while."), { status: 502 });
    }
    if (!ytsMovie || !ytsMovie.torrents || !ytsMovie.torrents.length) {
        throw Object.assign(new Error("YTS doesn't have any torrents for this movie anymore."), { status: 404 });
    }

    await req.uploadMovie(ytsMovie, 'yts');
    await req.knex('movies').where({ imdb_code }).update({ reset_at: new Date() });
    logger.info(`${req.user.username} reset "${movie.title}"`);

    // The cast and crew are looked up again too, but the reset doesn't fail when TMDB does
    const details = await getDetails(req.knex, req.tmdb, imdb_code, { refresh: true }).catch(() => undefined);
    const updated = await req.knex('movies').where({ imdb_code }).first();

    return { movie: updated, details, changes: torrentChanges(movie.torrents, updated.torrents) };
}

function statusJson(status) {
    return {
        resetAt: status.resetAt ? new Date(status.resetAt).toISOString() : null,
        availableAt: status.availableAt ? new Date(status.availableAt).toISOString() : null,
        reason: status.reason,
        remaining: status.remaining
    };
}

router.get('/', (req, res) => {
    req.knex('movies').select('*').limit(15).then(movies => {
        res.json({ movies });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

router.get('/:imdb_code', (req, res) => {
    const { imdb_code } = req.params;

    req.knex('movies').where({ imdb_code }).first().then(movie => {
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        res.json({ movie });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

// Cast, crew and the rest of what TMDB knows about the movie. `details` is null when TMDB doesn't know it.
router.get('/:imdb_code/details', async (req, res) => {
    const { imdb_code } = req.params;

    try {
        const movie = await req.knex('movies').where({ imdb_code }).first('imdb_code');
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        res.json({ details: await getDetails(req.knex, req.tmdb, imdb_code) });
    } catch (err) {
        res.status(502).json({ error: "The details of this movie couldn't be loaded" });
    }
});

// Whether the user can reset the movie right now, and when they can if not
router.get('/:imdb_code/reset', async (req, res) => {
    try {
        const movie = await req.knex('movies').where({ imdb_code: req.params.imdb_code }).first();
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        res.json(statusJson(resetStatus(movie, req.user)));
    } catch (err) {
        res.status(500).json({ error: "Failed to check the movie" });
    }
});

// Looks the movie up on YTS again and replaces its details and torrents with the latest ones
router.post('/:imdb_code/reset', async (req, res) => {
    const { imdb_code } = req.params;

    try {
        const movie = await req.knex('movies').where({ imdb_code }).first();
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        // When someone is resetting this movie already, wait for that reset instead of starting another one
        if (!resetting.has(imdb_code)) {
            const status = resetStatus(movie, req.user);
            if (status.availableAt) {
                const error = status.reason === 'movie'
                    ? 'This movie was reset a moment ago, so it is already up to date.'
                    : "You've reset a lot of movies in the last hour.";
                res.set('Retry-After', String(Math.ceil((status.availableAt - Date.now()) / 1000)));
                return res.status(429).json({ error, ...statusJson(status) });
            }

            if (req.user.role !== 'admin') {
                resetsByUser.set(req.user.id, [...recentResets(req.user.id), Date.now()]);
            }
            resetting.set(imdb_code, resetMovie(req, movie).finally(() => resetting.delete(imdb_code)));
        }

        const result = await resetting.get(imdb_code);
        res.json({ ...result, ...statusJson(resetStatus(result.movie, req.user)) });
    } catch (err) {
        if (!err.status) logger.error(`Could not reset ${imdb_code}: ${err.message}`);
        res.status(err.status || 500).json({ error: err.status ? err.message : "The movie couldn't be reset. Try again later." });
    }
});

module.exports = router;
