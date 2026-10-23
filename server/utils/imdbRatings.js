const axios = require('axios');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');
const logger = require('./logger');

/**
 * IMDb's own ratings for series and their episodes. TMDB's votes, which the pages showed before, come from
 * a different crowd and can be far off, so the numbers come from the data files IMDb publishes every day
 * (https://developer.imdb.com/non-commercial-datasets/). The files cover every title on IMDb; only the
 * series in the database and their episodes are kept, in the imdb_ratings table.
 */

const DATASETS_URL = (process.env.IMDB_DATASETS_URL || 'https://datasets.imdbws.com').replace(/\/+$/, '');
const CACHE_DIR = process.env.IMDB_CACHE_DIR || path.join(os.tmpdir(), 'streamify-imdb');
const RATINGS_FILE = 'title.ratings.tsv.gz';
const EPISODES_FILE = 'title.episode.tsv.gz';

const HOUR = 60 * 60 * 1000;
// IMDb publishes new files once a day, looking for them costs a request that comes back empty
const CHECK_INTERVAL = 6 * HOUR;
const FIRST_CHECK_DELAY = 60 * 1000;
// Series that show up in the meantime are looked up together
const NEW_SERIES_DELAY = 20 * 1000;
const INSERT_BATCH = 1000;

// Downloads a data file unless the copy we have is as new as IMDb's. The copy's mtime is IMDb's Last-Modified,
// which is also returned as `version`.
async function download(name) {
    const file = path.join(CACHE_DIR, name);
    const saved = await fs.promises.stat(file).catch(() => null);
    const response = await axios.get(`${DATASETS_URL}/${name}`, {
        responseType: 'stream',
        timeout: 60000,
        headers: saved ? { 'If-Modified-Since': saved.mtime.toUTCString() } : {},
        validateStatus: status => status === 200 || status === 304
    });
    if (response.status === 304) {
        response.data.destroy();
        return { file, version: saved.mtime.getTime() };
    }

    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    const partial = `${file}.part`;
    await pipeline(response.data, fs.createWriteStream(partial));
    const modified = new Date(response.headers['last-modified'] || Date.now());
    await fs.promises.utimes(partial, modified, modified);
    await fs.promises.rename(partial, file);
    return { file, version: modified.getTime() };
}

// Calls onLine with every line of a gzipped TSV file except the header
async function eachLine(file, onLine) {
    const source = fs.createReadStream(file);
    const input = zlib.createGunzip();
    source.on('error', err => input.destroy(err));
    source.pipe(input);
    input.setEncoding('utf8');

    let rest = '';
    let header = true;
    for await (const chunk of input) {
        const text = rest + chunk;
        let start = 0;
        let end;
        while ((end = text.indexOf('\n', start)) !== -1) {
            if (header) header = false;
            else onLine(text.slice(start, end));
            start = end + 1;
        }
        rest = text.slice(start);
    }
    if (rest && !header) onLine(rest);
}

/**
 * Saves IMDb's ratings of these series and of their episodes, or of every series in the database when no
 * codes are given, and puts the ratings on the series rows. Every series gets a row, with a null rating
 * when IMDb has none, so it isn't looked up over and over; episodes only get one when they are rated.
 */
async function sync(knex, codes) {
    const started = Date.now();
    const series = new Set(codes || await knex('series').pluck('imdb_code'));
    const ratings = await download(RATINGS_FILE);
    if (!series.size) return ratings.version;

    const ratingsFile = ratings.file;
    const episodesFile = (await download(EPISODES_FILE)).file;

    // Episodes of these series as IMDb numbers them: episode code -> [series code, season, episode]
    const episodes = new Map();
    await eachLine(episodesFile, (line) => {
        const first = line.indexOf('\t');
        const second = line.indexOf('\t', first + 1);
        const parent = line.slice(first + 1, second);
        if (!series.has(parent)) return;
        const [code, , season, episode] = line.split('\t');
        // "\N" when IMDb doesn't know where an episode goes
        if (/^\d+$/.test(season) && /^\d+$/.test(episode)) {
            episodes.set(code, [parent, Number(season), Number(episode)]);
        }
    });

    const rows = new Map([...series].map(code => [code, { imdb_code: code, series_code: null, season: null, episode: null, rating: null, votes: 0 }]));
    await eachLine(ratingsFile, (line) => {
        const code = line.slice(0, line.indexOf('\t'));
        const episode = episodes.get(code);
        if (!episode && !series.has(code)) return;
        const [, rating, votes] = line.split('\t');
        const [seriesCode, season, number] = episode || [null, null, null];
        rows.set(code, { imdb_code: code, series_code: seriesCode, season, episode: number, rating: Number(rating), votes: Number(votes) });
    });

    const list = [...rows.values()];
    await knex.transaction(async (trx) => {
        if (codes) {
            await trx('imdb_ratings').whereIn('imdb_code', [...series]).orWhereIn('series_code', [...series]).del();
        } else {
            await trx('imdb_ratings').del();
        }
        for (let i = 0; i < list.length; i += INSERT_BATCH) {
            await trx('imdb_ratings').insert(list.slice(i, i + INSERT_BATCH));
        }
        // The pages show the rating column of the series table
        const update = trx('series')
            .update({ rating: trx.ref('imdb_ratings.rating') })
            .updateFrom('imdb_ratings')
            .where('series.imdb_code', trx.ref('imdb_ratings.imdb_code'))
            .whereNotNull('imdb_ratings.rating');
        await (codes ? update.whereIn('series.imdb_code', [...series]) : update);
    });

    const rated = list.filter(row => row.series_code === null && row.rating !== null).length;
    logger.info(`Saved IMDb ratings of ${rated}/${series.size} series and ${list.length - series.size} episodes in ${Math.round((Date.now() - started) / 1000)}s`);
    return ratings.version;
}

// One sync at a time: the files are shared and a full sync would undo a partial one running alongside it
let tail = Promise.resolve();
function enqueue(task) {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
}

const pending = new Set();
let pendingTimer = null;

// Looks up the ratings of a series that has none yet, together with the others added around the same time
function queue(knex, code) {
    pending.add(code);
    if (pendingTimer) return;
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        const codes = [...pending];
        pending.clear();
        enqueue(() => sync(knex, codes))
            .catch(err => logger.warn(`Could not look up the IMDb ratings of ${codes.length} series: ${err.message}`));
    }, NEW_SERIES_DELAY);
    pendingTimer.unref();
}

/**
 * IMDb's rating of a series: a number, null when IMDb has none, or undefined when it wasn't looked up
 * yet (it is then looked up soon).
 */
async function seriesRating(knex, code) {
    const row = await knex('imdb_ratings').where({ imdb_code: code }).first('rating');
    if (!row) {
        queue(knex, code);
        return undefined;
    }
    return row.rating;
}

/**
 * The seasons with IMDb's episode ratings instead of the catalogs' ones. An episode IMDb didn't rate has
 * no rating, like on IMDb. A series that wasn't looked up yet keeps its ratings until it is.
 */
async function rateEpisodes(knex, code, seasons) {
    const rows = await knex('imdb_ratings')
        .where({ imdb_code: code })
        .orWhere({ series_code: code })
        .select('series_code', 'season', 'episode', 'rating', 'votes');
    if (!rows.some(row => row.series_code === null)) {
        queue(knex, code);
        return seasons;
    }

    // IMDb sometimes has two titles under the same number; the one more people rated wins
    const ratings = new Map();
    for (const row of rows) {
        if (row.series_code === null) continue;
        const key = `${row.season}:${row.episode}`;
        const known = ratings.get(key);
        if (!known || row.votes > known.votes) ratings.set(key, row);
    }
    return seasons.map(season => ({
        ...season,
        episodes: season.episodes.map((episode) => {
            const imdb = ratings.get(`${season.number}:${episode.episode}`);
            return { ...episode, rating: imdb ? imdb.rating : null };
        })
    }));
}

// Version (Last-Modified) of the files the last refresh of every series read. Unknown after a start, so the
// first check refreshes everything.
let syncedVersion = null;

// Refreshes every series when IMDb has published new files
async function checkForUpdate(knex) {
    try {
        const { version } = await download(RATINGS_FILE);
        if (version !== syncedVersion) {
            syncedVersion = await enqueue(() => sync(knex));
        }
    } catch (err) {
        logger.warn(`Could not update the IMDb ratings: ${err.message}`);
    }
}

function startImdbRatings(knex) {
    setTimeout(() => checkForUpdate(knex), FIRST_CHECK_DELAY).unref();
    setInterval(() => checkForUpdate(knex), CHECK_INTERVAL).unref();
}

module.exports = { startImdbRatings, seriesRating, rateEpisodes };
