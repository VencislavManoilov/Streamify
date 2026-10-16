const express = require('express');
const Authorization = require('../middleware/Auth');

const router = express.Router();

router.use(Authorization);

// The movies the user saved for later, most recently added first
router.get('/', async (req, res) => {
    try {
        const movies = await req.knex('watchlist as w')
            .join('movies as m', 'm.imdb_code', 'w.imdb_code')
            .where('w.user_id', req.user.id)
            .orderBy('w.created_at', 'desc')
            .select('m.*');

        res.json({ movies });
    } catch (err) {
        res.status(500).json({ error: 'Failed to load the watchlist' });
    }
});

// Adding a movie that is already on the list changes nothing
router.put('/:imdb_code', async (req, res) => {
    const { imdb_code } = req.params;

    try {
        const movie = await req.knex('movies').where({ imdb_code }).first('imdb_code');
        if (!movie) {
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
