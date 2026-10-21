const express = require('express');
const Authorization = require('../middleware/Auth');
const { publicSeries } = require('../utils/series');

const router = express.Router();

router.use(Authorization);

// The movies and series the user saved for later, most recently added first
router.get('/', async (req, res) => {
    try {
        const [movies, series] = await Promise.all([
            req.knex('watchlist as w')
                .join('movies as m', 'm.imdb_code', 'w.imdb_code')
                .where('w.user_id', req.user.id)
                .select('m.*', 'w.created_at as saved_at'),
            req.knex('watchlist as w')
                .join('series as s', 's.imdb_code', 'w.imdb_code')
                .where('w.user_id', req.user.id)
                .select('s.*', 'w.created_at as saved_at')
        ]);

        const saved = [
            ...movies.map(movie => ({ ...movie, type: 'movie' })),
            ...series.map(row => publicSeries(row))
        ].sort((a, b) => new Date(b.saved_at) - new Date(a.saved_at))
            .map(({ saved_at, ...item }) => item);

        res.json({ movies: saved });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the watchlist' });
    }
});

// Adding a movie or series that is already on the list changes nothing
router.put('/:imdb_code', async (req, res) => {
    const { imdb_code } = req.params;

    try {
        const [movie, series] = await Promise.all([
            req.knex('movies').where({ imdb_code }).first('imdb_code'),
            req.knex('series').where({ imdb_code }).first('imdb_code')
        ]);
        if (!movie && !series) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        await req.knex('watchlist')
            .insert({ user_id: req.user.id, imdb_code })
            .onConflict(['user_id', 'imdb_code'])
            .ignore();

        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: 'Failed to add the movie to the watchlist' });
    }
});

router.delete('/:imdb_code', async (req, res) => {
    try {
        await req.knex('watchlist')
            .where({ user_id: req.user.id, imdb_code: req.params.imdb_code })
            .del();

        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: 'Failed to remove the movie from the watchlist' });
    }
});

module.exports = router;
