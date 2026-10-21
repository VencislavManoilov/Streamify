const express = require('express');
const Authorization = require('../middleware/Auth');
const logger = require('../utils/logger');
const series = require('../utils/series');
const { getEpisodeSources, findSource, rank, healthOf, markFailed } = require('../utils/streamSources');

const router = express.Router();

router.use(Authorization);

const IMDB_CODE = /^tt\d+$/;
// How many episodes one availability request checks at most (long anime seasons have a hundred)
const MAX_CHECKED = 60;

// The codecs and containers the viewer's browser plays, sent by the player like "mkv.hevc.ac3"
function capsOf(value) {
    return new Set(String(value || '').split(/[.,\s]+/).filter(cap => /^[a-z0-9]{2,12}$/.test(cap)));
}

function numberParam(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 && number < 10000 ? number : null;
}

// The series of the request, or null after answering with an error
async function loadSeries(req, res) {
    const { imdb_code } = req.params;
    if (!IMDB_CODE.test(imdb_code)) {
        res.status(404).json({ error: 'Series not found' });
        return null;
    }
    try {
        const row = await series.getSeries(req.knex, req.tmdb, imdb_code);
        if (!row) {
            res.status(404).json({ error: 'Series not found' });
            return null;
        }
        return row;
    } catch (err) {
        res.status(502).json({ error: "The series couldn't be loaded" });
        return null;
    }
}

function rankFor(req, row, sources, caps) {
    return rank(sources, caps, req.playback.abilities, {
        originalLanguage: row.original_language || 'en',
        runtime: row.runtime
    });
}

router.get('/categories', (req, res) => {
    res.json(req.seriesCategories());
});

router.get('/:imdb_code', async (req, res) => {
    const row = await loadSeries(req, res);
    if (row) res.json({ series: series.publicSeries(row) });
});

// Cast, creators and the rest from TMDB. `details` is null when it couldn't be loaded.
router.get('/:imdb_code/details', async (req, res) => {
    const row = await loadSeries(req, res);
    if (!row) return;
    try {
        res.json({ details: await series.getDetails(req.knex, req.tmdb, row) });
    } catch (err) {
        res.status(502).json({ error: "The details of this series couldn't be loaded" });
    }
});

router.get('/:imdb_code/episodes', async (req, res) => {
    const row = await loadSeries(req, res);
    if (!row) return;
    try {
        res.json({ seasons: await series.getEpisodes(req.knex, req.tmdb, row) });
    } catch (err) {
        logger.warn(`Could not list the episodes of ${row.title}: ${err.message}`);
        res.status(502).json({ error: "The episodes of this series couldn't be loaded" });
    }
});

// The episode to play when the series is opened, and how far every watched episode got
router.get('/:imdb_code/next', async (req, res) => {
    const row = await loadSeries(req, res);
    if (!row) return;
    try {
        const [seasons, progress] = await Promise.all([
            series.getEpisodes(req.knex, req.tmdb, row),
            req.knex('episode_history').where({ user_id: req.user.id, imdb_code: row.imdb_code })
        ]);
        res.json({
            next: series.nextUp(seasons, progress),
            progress: progress.map(entry => ({
                season: entry.season,
                episode: entry.episode,
                position: entry.position,
                duration: entry.duration,
                completed: entry.completed,
                lastWatchedAt: entry.last_watched_at
            }))
        });
    } catch (err) {
        res.status(502).json({ error: "The episodes of this series couldn't be loaded" });
    }
});

/**
 * How well every episode of a season can be watched: how many torrents it has, the best quality and how
 * healthy they are. `episodes` can name the ones to check ("1,2,3"), otherwise all that aired are.
 */
router.get('/:imdb_code/season/:season/availability', async (req, res) => {
    const seasonNumber = numberParam(req.params.season);
    const row = await loadSeries(req, res);
    if (!row) return;

    try {
        const seasons = await series.getEpisodes(req.knex, req.tmdb, row);
        const season = seasons.find(item => item.number === seasonNumber);
        if (!season) return res.status(404).json({ error: 'Season not found' });

        const wanted = req.query.episodes
            ? new Set(String(req.query.episodes).split(',').map(numberParam).filter(number => number !== null))
            : null;
        const episodes = season.episodes
            .filter(episode => series.hasAired(episode) && (!wanted || wanted.has(episode.episode)))
            .slice(0, MAX_CHECKED);
        const caps = capsOf(req.query.caps);

        const results = await series.mapLimit(episodes, 4, async (episode) => {
            try {
                const { sources } = await getEpisodeSources(req.knex, row, season.number, episode.episode);
                const ranked = rankFor(req, row, sources, caps);
                if (!ranked.length) return [episode.episode, { count: 0, health: 'none' }];
                const best = ranked[0];
                const seeders = Math.max(...ranked.map(source => source.seeders || 0));
                return [episode.episode, {
                    count: ranked.length,
                    health: healthOf(seeders),
                    seeders,
                    resolution: best.resolution,
                    playback: best.playback
                }];
            } catch (err) {
                return [episode.episode, { count: null, health: 'unknown' }];
            }
        });

        res.json({ episodes: Object.fromEntries(results) });
    } catch (err) {
        res.status(502).json({ error: "The episodes of this series couldn't be checked" });
    }
});

// The torrents of an episode, the best for this browser first
router.get('/:imdb_code/:season/:episode/sources', async (req, res) => {
    const season = numberParam(req.params.season);
    const episode = numberParam(req.params.episode);
    if (season === null || episode === null) return res.status(404).json({ error: 'Episode not found' });
    const row = await loadSeries(req, res);
    if (!row) return;

    try {
        const found = await getEpisodeSources(req.knex, row, season, episode, { refresh: req.query.refresh === '1' });
        const ranked = rankFor(req, row, found.sources, capsOf(req.query.caps));
        res.json({
            sources: ranked.slice(0, 20),
            fetchedAt: found.fetchedAt,
            stale: !!found.stale,
            abilities: req.playback.abilities
        });
    } catch (err) {
        logger.warn(`Could not find the torrents of ${row.title} ${season}x${episode}: ${err.message}`);
        res.status(502).json({ error: "Couldn't look for this episode right now. Try again in a moment." });
    }
});

/**
 * Loads a torrent of the episode and says how the player gets it: the file as it is, or converted (HLS).
 * Body: { hash, caps, audio (a track the viewer picked), at (the second the viewer starts from) }.
 */
router.post('/:imdb_code/:season/:episode/prepare', async (req, res) => {
    const season = numberParam(req.params.season);
    const episode = numberParam(req.params.episode);
    if (season === null || episode === null) return res.status(404).json({ error: 'Episode not found' });
    const row = await loadSeries(req, res);
    if (!row) return;

    const source = await findSource(req.knex, row.imdb_code, season, episode, req.body.hash).catch(() => null);
    if (!source) return res.status(404).json({ error: 'This torrent is not one of the episode', code: 'no-source' });

    const audioTrack = Number.isInteger(req.body.audio) ? req.body.audio : null;
    const at = Number(req.body.at) > 0 ? Number(req.body.at) : 0;

    try {
        const plan = await req.playback.prepare({
            series: row,
            season,
            episode,
            source,
            caps: capsOf(req.body.caps),
            audioTrack,
            at
        });
        res.json({ plan });
    } catch (err) {
        if (!err.code) logger.error(`Could not prepare ${row.title} ${season}x${episode}: ${err.message}`);
        res.status(err.status || 500).json({ error: err.code ? err.message : "The episode couldn't be loaded", code: err.code || 'failed' });
    }
});

// The player says a torrent stopped bringing in data, so it goes down the list for everyone for a while
router.post('/:imdb_code/:season/:episode/report', async (req, res) => {
    const season = numberParam(req.params.season);
    const episode = numberParam(req.params.episode);
    if (season === null || episode === null || !IMDB_CODE.test(req.params.imdb_code)) return res.status(404).end();
    const source = await findSource(req.knex, req.params.imdb_code, season, episode, req.body.hash).catch(() => null);
    if (!source) return res.status(404).end();
    markFailed(source.hash);
    logger.info(`${req.user.username} reported a ${req.body.reason === 'slow' ? 'slow' : 'dead'} torrent of ${req.params.imdb_code} ${season}x${episode}`);
    res.status(204).end();
});

module.exports = router;
