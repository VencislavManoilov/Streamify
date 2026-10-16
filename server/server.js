const dotenv = require('dotenv');
dotenv.config();

// Some of the DHT bootstrap servers resolve to IPv6 first, which the IPv4-only DHT socket can't reach.
// Without this the DHT never finds any nodes and torrents can only get peers from trackers.
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const app = express();
const ensureSchema = require('./schema');
const knex = require('./knex');
const { default: axios } = require('axios');
const cors = require('cors');
const rangeParser = require('range-parser');
const Authorization = require('./middleware/Auth');
const TorrentManager = require('./utils/torrentManager');
const yts = require('./utils/yts');
const { sendMail, startMailMonitor } = require('./utils/mailer');
const srtToVtt = require('srt-to-vtt');
const logger = require('./utils/logger');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const PORT = 8080;

const http = require('http');
const WebSocket = require('ws');

// A stray rejected promise gets logged instead of taking the whole server down
process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled promise rejection: ${reason && reason.stack ? reason.stack : reason}`);
});

// Create HTTP server from your Express app
const server = http.createServer(app);

// Create WebSocket server that uses your HTTP server
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
    // Basic connection setup
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
});

// Keep-alive ping (prevents connections from timing out)
setInterval(() => {
    wss.clients.forEach(ws => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

// Make the WebSocket server available to routes
app.wss = wss;
app.locals.knex = knex;

app.set('trust proxy', true);

const allowedOrigins = process.env.CORS_ORIGIN
    ? JSON.parse(process.env.CORS_ORIGIN)
    : ["http://localhost:3000"];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const OMDB_URL = "https://www.omdbapi.com/";

const tmdb = axios.create({
    baseURL: "https://api.themoviedb.org/3",
    timeout: 15000,
    params: { api_key: process.env.TMDB_API_KEY }
});

// Streams that haven't sent anything for this long are closed (see pipeTorrentFile)
const STREAM_STALL_TIMEOUT = (Number(process.env.STREAM_STALL_SECONDS) || 5 * 60) * 1000;
const SUBTITLE_CACHE_DIR = path.join(__dirname, 'subtitle_cache');
const IMDB_CODE = /^tt\d+$/;

let categories = [];

const withKnex = (req, res, next) => {
    req.knex = knex;
    next();
};

// Runs `fn` for every item with at most `limit` calls in flight. `fn` must not throw.
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

async function uploadMovie(movie, type) {
    if (!movie || !movie.id) {
        return;
    }
    try {
        if (type === "yts") {
            const newMovie = {
                imdb_code: movie.imdb_code,
                slug: movie.slug || movie.title.toLowerCase().replace(/\s+/g, '-'),
                title: movie.title,
                genres: JSON.stringify(movie.genres || []),
                year: movie.year,
                rating: movie.rating || 0,
                runtime: movie.runtime || null,
                summary: movie.summary || movie.description || movie.description_full || movie.description_intro || movie.overview || "No summary available",
                background_image: movie.background_image || '',
                small_cover_image: movie.small_cover_image || '',
                medium_cover_image: movie.medium_cover_image || '',
                large_cover_image: movie.large_cover_image || '',
                torrents: JSON.stringify(movie.torrents || [])
            };

            return await knex('movies').insert(newMovie).onConflict('imdb_code').merge();
        }

        const existingMovie = await knex('movies').where({ imdb_code: movie.imdb_code }).first();
        if(existingMovie) {
            return await knex('movies').where({ imdb_code: movie.imdb_code }).update(movie);
        }

        return await knex('movies').insert(movie);
    } catch (dbError) {
        logger.error("Database insertion error: " + dbError);
        return Promise.reject(dbError);
    }
}

function findTorrent(movie, torrentHash) {
    const wanted = String(torrentHash).toLowerCase();
    return (movie.torrents || []).find(torrent => String(torrent.hash).toLowerCase() === wanted);
}

function torrentSource(movie, torrentMeta) {
    return { url: torrentMeta.url, name: `${movie.title} (${torrentMeta.quality})` };
}

app.get("/", (req, res) => {
    res.json({
        version: '1.0.0',
        message: "Welcome to Streamify API!"
    });
})

const adminRoute = require('./routes/admin');
app.use('/admin', async (req, res, next) => {
    req.knex = knex;
    req.torrentManager = global.torrentManager;
    req.fetchTrendingMovies = fetchTrendingMovies;
    req.nextRefresh = nextRefresh;
    req.tmdb = tmdb;
    next();
}, adminRoute);
adminRoute.ws(app);

const authRoute = require('./routes/auth');
app.use('/auth', withKnex, authRoute);

const historyRoute = require('./routes/history');
app.use('/history', withKnex, historyRoute);

const watchlistRoute = require('./routes/watchlist');
app.use('/watchlist', withKnex, watchlistRoute);

app.get("/movies", withKnex, Authorization, (req, res) => {
    knex('movies').select('*').limit(15).then(movies => {
        res.json({ movies });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get("/movies/:imdb_code", withKnex, Authorization, (req, res) => {
    const { imdb_code } = req.params;

    knex('movies').where({ imdb_code }).first().then(movie => {
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        res.json({ movie });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get("/categories", withKnex, Authorization, (req, res) => {
    try {
        res.status(200).json(categories);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/reset-movie", withKnex, Authorization, async (req, res) => {
    const { imdb_code } = req.body;

    try {
        const existingMovie = await knex('movies').where({ imdb_code }).first();
        if (!existingMovie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        const movie = await yts.getMovieDetails(imdb_code);
        if(movie) {
            await uploadMovie(movie, "yts");
            return res.json({ message: "Movie reset successfully", movie });
        }

        return res.status(404).json({ error: "Movie not found" });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: "Failed to fetch movies" });
    }
})

app.get("/preload/:imdb_code/:torrent_hash", withKnex, Authorization, async (req, res) => {
    const { imdb_code, torrent_hash } = req.params;

    try {
        // Get movie details from database
        const movie = await knex('movies').where({ imdb_code }).first();

        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        const torrentMeta = findTorrent(movie, torrent_hash);
        if (!torrentMeta) {
            return res.status(404).json({ error: "Torrent not found" });
        }

        // `at` is where the viewer will resume, as a fraction of the movie (0-1)
        const result = await global.torrentManager.preloadTorrent(torrentMeta.hash, torrentSource(movie, torrentMeta), {
            at: Number(req.query.at) || 0
        });

        res.json({
            status: "success",
            message: "Torrent preloading initiated",
            torrentInfo: {
                title: movie.title,
                imdb_code,
                hash: torrent_hash,
                ...result
            }
        });
    } catch (err) {
        logger.error("Preload error: " + err.message);
        res.status(500).json({ error: "Failed to preload torrent: " + err.message });
    }
});

function waitForDrain(res) {
    return new Promise((resolve) => {
        const done = () => {
            res.removeListener('drain', done);
            res.removeListener('close', done);
            resolve();
        };
        res.on('drain', done);
        res.on('close', done);
    });
}

// Copies bytes `start`-`end` of a torrent file into the response. The headers are already sent at
// this point, so errors just end the response (the browser then asks for the rest again).
async function pipeTorrentFile(file, start, end, res, release) {
    const iterator = file[Symbol.asyncIterator]({ start, end });
    let remaining = end - start + 1;
    let lastProgress = Date.now();
    let closed = false;

    // A stream nobody reads (a paused or forgotten tab) is closed after a while, so the torrent can go
    // idle and be cleaned up instead of staying busy forever
    const stallTimer = setInterval(() => {
        if (Date.now() - lastProgress > STREAM_STALL_TIMEOUT) res.destroy();
    }, 30 * 1000);

    res.once('close', () => {
        closed = true;
        clearInterval(stallTimer);
        // Stops downloading the pieces only this stream wanted
        Promise.resolve(iterator.return && iterator.return()).catch(() => {});
        release();
    });

    try {
        for await (const chunk of iterator) {
            if (closed) break;
            const data = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
            remaining -= data.length;
            lastProgress = Date.now();
            if (!res.write(data)) await waitForDrain(res);
            if (remaining <= 0) break;
        }
        if (!closed) res.end();
    } catch (err) {
        if (!closed) {
            logger.warn(`Stopped streaming "${file.name}": ${err.message}`);
            res.destroy();
        }
    }
}

app.get("/stream/:imdb_code/:torrent_hash", async (req, res) => {
    const { imdb_code, torrent_hash } = req.params;

    let closed = false;
    res.on('close', () => { closed = true; });

    let movie;
    try {
        movie = await knex('movies').where({ imdb_code }).first();
    } catch (err) {
        logger.error("Stream error: " + err);
        return res.status(500).json({ error: err.message });
    }

    if (!movie) {
        return res.status(404).json({ error: "Movie not found" });
    }

    const torrentMeta = findTorrent(movie, torrent_hash);
    if (!torrentMeta) {
        return res.status(404).json({ error: "Torrent not found" });
    }

    let lease;
    try {
        lease = await global.torrentManager.acquire(torrentMeta.hash, torrentSource(movie, torrentMeta));
    } catch (err) {
        logger.error(`Could not load the torrent of "${movie.title}": ${err.message}`);
        if (!closed) {
            res.status(503).json({ error: "This movie can't be loaded right now. Try again in a moment or pick another quality." });
        }
        return;
    }

    // The browser gave up (e.g. seeked somewhere else) while the torrent was loading
    if (closed) {
        return lease.release();
    }

    const file = TorrentManager.pickVideoFile(lease.torrent);
    if (!file) {
        lease.release();
        return res.status(404).json({ error: "MP4 file not found in torrent" });
    }

    const ranges = req.headers.range ? rangeParser(file.length, req.headers.range, { combine: true }) : null;
    if (ranges === -1) {
        lease.release();
        res.setHeader('Content-Range', `bytes */${file.length}`);
        return res.status(416).send('Invalid Range');
    }

    // A malformed Range header is ignored and the whole file is sent, like any HTTP server does
    const partial = Array.isArray(ranges) && ranges.type === 'bytes' && ranges.length > 0;
    const start = partial ? ranges[0].start : 0;
    const end = partial ? ranges[0].end : file.length - 1;

    res.status(partial ? 206 : 200);
    res.set({
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": file.type || "video/mp4"
    });
    if (partial) {
        res.set("Content-Range", `bytes ${start}-${end}/${file.length}`);
    }

    if (req.method === 'HEAD') {
        lease.release();
        return res.end();
    }

    pipeTorrentFile(file, start, end, res, lease.release);
});

// OpenSubtitles API configuration
const OPENSUBS_API_URL = "https://api.opensubtitles.com/api/v1";
let openSubsToken = null;
let tokenExpiry = null;
const OPENSUBS_USER_AGENT = "Streamify v1.0.0"; // Define a specific user agent for our app

// Function to login to OpenSubtitles and get access token
async function getOpenSubtitlesToken() {
    // Return existing token if it's still valid
    if (openSubsToken && tokenExpiry && tokenExpiry > Date.now()) {
        return openSubsToken;
    }

    try {
        const response = await axios.post(`${OPENSUBS_API_URL}/login`, {
            username: process.env.OPENSUBS_USERNAME,
            password: process.env.OPENSUBS_PASSWORD
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': process.env.OPENSUBS_API_KEY,
                'User-Agent': OPENSUBS_USER_AGENT
            }
        });

        // Set token with 24h expiry (or use actual expiry from response if available)
        openSubsToken = response.data.token;
        tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23 hours to be safe

        logger.info("Successfully logged in to OpenSubtitles API");
        return openSubsToken;
    } catch (error) {
        logger.error(`OpenSubtitles login error: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        throw new Error("Failed to authenticate with OpenSubtitles");
    }
}

// Function to search and download subtitles for a movie
async function getSubtitles(imdbId, language = 'en') {
    try {
        // Create cache directory if it doesn't exist
        if (!fs.existsSync(SUBTITLE_CACHE_DIR)) {
            fs.mkdirSync(SUBTITLE_CACHE_DIR, { recursive: true });
        }

        // Check if we already have this subtitle cached
        const cacheFilePath = path.join(SUBTITLE_CACHE_DIR, `${imdbId}_${language}.vtt`);
        if (fs.existsSync(cacheFilePath)) {
            return cacheFilePath;
        }

        // Ensure we have a valid token
        const token = await getOpenSubtitlesToken();

        // Format the IMDb ID properly (OpenSubtitles expects the 'tt' prefix)
        const formattedImdbId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;

        // Search for subtitles - note we're using the proper OpenSubtitles format
        const searchResponse = await axios.get(`${OPENSUBS_API_URL}/subtitles`, {
            params: {
                imdb_id: formattedImdbId,
                languages: language
            },
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': process.env.OPENSUBS_API_KEY,
                'Authorization': `Bearer ${token}`,
                'User-Agent': OPENSUBS_USER_AGENT,
                'Accept': 'application/json'
            }
        });

        if (!searchResponse.data.data || searchResponse.data.data.length === 0) {
            throw new Error(`No subtitles found for IMDb ID ${formattedImdbId} in language ${language}`);
        }

        // Find the best subtitle (highest rated or first available)
        let bestSubtitle = null;
        for (const sub of searchResponse.data.data) {
            if (!bestSubtitle ||
                (sub.attributes.ratings && bestSubtitle.attributes.ratings &&
                 sub.attributes.ratings > bestSubtitle.attributes.ratings)) {
                bestSubtitle = sub;
            }
        }

        if (!bestSubtitle) {
            throw new Error(`No suitable subtitle found for IMDb ID ${formattedImdbId} in language ${language}`);
        }

        // Make sure there are files available
        if (!bestSubtitle.attributes.files || bestSubtitle.attributes.files.length === 0) {
            throw new Error('Selected subtitle has no files available');
        }

        // Download subtitle file
        const downloadResponse = await axios.post(
            `${OPENSUBS_API_URL}/download`,
            { file_id: bestSubtitle.attributes.files[0].file_id },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Api-Key': process.env.OPENSUBS_API_KEY,
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': OPENSUBS_USER_AGENT,
                    'Accept': 'application/json'
                }
            }
        );

        // Download the actual subtitle file
        const subtitleFileUrl = downloadResponse.data.link;

        const subtitleResponse = await axios.get(subtitleFileUrl, {
            responseType: 'stream',
            headers: {
                'User-Agent': OPENSUBS_USER_AGENT
            }
        });

        // Convert SRT to VTT if needed and save to cache
        const fileStream = fs.createWriteStream(cacheFilePath);

        if (subtitleFileUrl.endsWith('.srt')) {
            // Convert SRT to VTT
            subtitleResponse.data.pipe(srtToVtt()).pipe(fileStream);
        } else {
            subtitleResponse.data.pipe(fileStream);
        }

        return new Promise((resolve, reject) => {
            fileStream.on('finish', () => {
                logger.info(`Subtitle file saved to ${cacheFilePath}`);
                resolve(cacheFilePath);
            });

            fileStream.on('error', (err) => {
                logger.error(`Error saving subtitle file: ${err.message}`);
                reject(err);
            });
        });
    } catch (error) {
        logger.error(`Error getting subtitles: ${error.message}`);
        if (error.response) {
            logger.error(`Response status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        throw error;
    }
}

function convertSrtToVtt(srt) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        Readable.from([srt]).pipe(srtToVtt())
            .on('data', chunk => chunks.push(chunk))
            .on('end', () => resolve(Buffer.concat(chunks)))
            .on('error', reject);
    });
}

// English subtitles shipped inside the torrent that is being watched (YTS releases usually have them)
async function getTorrentSubtitles(imdbId, torrentHash) {
    const infoHash = TorrentManager.normalizeHash(torrentHash);
    const cacheFilePath = path.join(SUBTITLE_CACHE_DIR, `${imdbId}_${infoHash}_en.vtt`);
    if (fs.existsSync(cacheFilePath)) {
        return cacheFilePath;
    }

    const subtitles = await global.torrentManager.readSubtitleFile(infoHash);
    if (!subtitles) {
        return null;
    }

    const vtt = /\.vtt$/i.test(subtitles.name) ? subtitles.data : await convertSrtToVtt(subtitles.data);
    await fs.promises.mkdir(SUBTITLE_CACHE_DIR, { recursive: true });
    await fs.promises.writeFile(cacheFilePath, vtt);
    logger.info(`Subtitle file saved to ${cacheFilePath}`);
    return cacheFilePath;
}

// New endpoint for direct subtitle access (without torrent requirement)
app.get("/subtitles/:imdb_code", async (req, res) => {
    const { imdb_code } = req.params;
    const language = String(req.query.lang || 'en');
    const torrentHash = req.query.hash ? String(req.query.hash) : null;

    if (!imdb_code || !IMDB_CODE.test(imdb_code)) {
        return res.status(400).json({ error: "IMDb code is required" });
    }

    if(!/^[a-z]{2}$/.test(language)) {
        return res.status(400).json({ error: "Invalid language code" });
    }

    let subtitlePath = null;
    if (language === "en" && torrentHash) {
        try {
            subtitlePath = await getTorrentSubtitles(imdb_code, torrentHash);
        } catch (err) {
            logger.warn(`Could not use the subtitles from the torrent: ${err.message}`);
        }
    }

    try {
        if (!subtitlePath) {
            subtitlePath = await getSubtitles(imdb_code, language);
        }
    } catch (err) {
        return res.status(404).json({ error: "Subtitles not found" });
    }

    res.type('text/vtt').sendFile(subtitlePath, (err) => {
        if (err && !res.headersSent) {
            logger.error("Error streaming subtitle file: " + err);
            res.status(500).json({ error: "Failed to stream subtitles" });
        }
    });
});

// OMDb has the best title matching and YTS has what can actually be streamed, so both are searched.
// Results keep OMDb's order, followed by the extra matches from YTS.
async function searchMovies(query) {
    const [omdb, ytsSearch] = await Promise.allSettled([
        axios.get(OMDB_URL, { params: { s: query, type: 'movie', apikey: OMDB_API_KEY }, timeout: 10000 }),
        yts.listMovies({ query_term: query, limit: 20, sort_by: 'download_count' })
    ]);

    if (omdb.status === 'rejected' && ytsSearch.status === 'rejected') {
        throw new Error(`OMDb: ${omdb.reason.message}, YTS: ${ytsSearch.reason.message}`);
    }

    const found = new Map(); // IMDb code -> YTS movie
    if (ytsSearch.status === 'fulfilled') {
        for (const movie of ytsSearch.value) {
            found.set(movie.imdb_code, movie);
        }
    } else {
        logger.warn(`YTS search failed: ${ytsSearch.reason.message}`);
    }

    let omdbCodes = [];
    if (omdb.status === 'fulfilled') {
        omdbCodes = [...new Set((omdb.value.data.Search || []).map(result => result.imdbID))];
    } else {
        logger.warn(`OMDb search failed: ${omdb.reason.message}`);
    }

    // OMDb only gives us the IMDb code, so look those movies up on YTS
    await mapLimit(omdbCodes.filter(code => !found.has(code)), 5, async (code) => {
        try {
            const movie = await yts.getMovieDetails(code);
            if (movie) found.set(code, movie);
        } catch (err) {
            logger.warn(`Could not look up ${code} on YTS: ${err.message}`);
        }
    });

    const codes = [
        ...omdbCodes.filter(code => found.has(code)),
        ...[...found.keys()].filter(code => !omdbCodes.includes(code))
    ].filter(code => {
        const movie = found.get(code);
        return movie.torrents && movie.torrents.length > 0;
    });

    for (const code of codes) {
        await uploadMovie(found.get(code), "yts").catch(() => {});
    }

    const rows = codes.length ? await knex('movies').whereIn('imdb_code', codes) : [];
    const byCode = new Map(rows.map(movie => [movie.imdb_code, movie]));
    return codes.map(code => byCode.get(code)).filter(Boolean);
}

app.get("/search", withKnex, Authorization, async (req, res) => {
    const query = String(req.query.query || '').trim();
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
        res.json({ movies: await searchMovies(query) });
    } catch (error) {
        logger.error("Search error: " + error.message);
        res.status(500).json({ error: "Failed to fetch movies" });
    }
});

async function loadCategories() {
    try {
        const load = await knex('categories').select('*').orderBy('id');
        const loaded = [];
        for(const category of load) {
            const codes = [...category.movies].sort(() => Math.random() - 0.5);
            const movies = codes.length ? await knex('movies').whereIn('imdb_code', codes) : [];
            const byCode = new Map(movies.map(movie => [movie.imdb_code, movie]));
            loaded.push({ name: category.name, movies: codes.map(code => byCode.get(code)).filter(Boolean) });
        }
        categories = loaded;
        return categories;
    } catch (dbError) {
        logger.error("Database error: " + dbError);
        return Promise.reject(dbError);
    }
}

const fetchTrendingMovies = async () => {
    const genres = [
        { id: 28, name: "Action" },
        { id: 35, name: "Comedy" },
        { id: 27, name: "Horror" },
        { id: 18, name: "Drama" },
        { id: 16, name: "Animation" },
        { id: 10749, name: "Romance" },
        { id: 878, name: "Science Fiction" },
        { id: 53, name: "Thriller" },
        { id: 12, name: "Adventure" },
        { id: 80, name: "Crime" },
        { id: 14, name: "Fantasy" },
        // { id: 10751, name: "Family" },
        { id: 36, name: "History" },
        // { id: 10402, name: "Music" },
        { id: 9648, name: "Mystery" },
        { id: 10752, name: "War" },
        // { id: 37, name: "Western" }
    ];

    const lists = [
        { name: "Trending", path: '/trending/movie/day' },
        { name: "New Movies", path: '/movie/now_playing' },
        { name: "Popular", path: '/movie/popular' },
        { name: "Top Rated", path: '/movie/top_rated' },
        ...genres.map(genre => ({ name: genre.name, path: '/discover/movie', params: { with_genres: genre.id } }))
    ];

    const allCategories = [];
    for (const list of lists) {
        const response = await tmdb.get(list.path, { params: list.params });
        allCategories.push({ name: list.name, movies: response.data.results });
    }

    // TMDB movie -> IMDb code -> that exact movie on YTS. Searching YTS by title instead picks a
    // different movie with a similar name surprisingly often.
    const lookups = new Map(); // TMDB id -> Promise of the YTS movie (or null)
    const findOnYts = (tmdbMovie) => {
        if (!lookups.has(tmdbMovie.id)) {
            lookups.set(tmdbMovie.id, (async () => {
                const ids = await tmdb.get(`/movie/${tmdbMovie.id}/external_ids`);
                if (!ids.data.imdb_id) return null;
                const ytsMovie = await yts.getMovieDetails(ids.data.imdb_id);
                if (!ytsMovie || !ytsMovie.torrents || !ytsMovie.torrents.length) return null;
                ytsMovie.overview = tmdbMovie.overview;
                return ytsMovie;
            })().catch(() => null));
        }
        return lookups.get(tmdbMovie.id);
    };

    const newCategories = [];
    for (const category of allCategories) {
        logger.info(`Fetching YTS movies for category ${category.name}...`);
        const matches = await mapLimit(category.movies, 6, async (movie) => {
            const ytsMovie = await findOnYts(movie);
            if (ytsMovie) {
                logger.info(`✅ ${ytsMovie.title}`);
            } else {
                logger.warn(`❌ ${movie.title}`);
            }
            return ytsMovie;
        });
        const categoryMovies = matches.filter(Boolean);

        logger.info(`Uploading ${categoryMovies.length} movies for category ${category.name}...`);
        const uploaded = [];
        for(const movie of categoryMovies) {
            try {
                await uploadMovie(movie, "yts");
                uploaded.push(movie.imdb_code);
            } catch (err) {
                // already logged by uploadMovie
            }
        }
        logger.info(`Uploaded ${uploaded.length} movies for category ${category.name}!`);

        newCategories.push({ name: category.name, movies: [...new Set(uploaded)] });
    }

    // Swap the categories in one go, so a failed refresh never leaves the home page empty
    await knex.transaction(async (trx) => {
        await trx('categories').del();
        for (const category of newCategories) {
            await trx('categories').insert({ name: category.name, movies: JSON.stringify(category.movies) });
        }
    });
    logger.info(`Inserted ${newCategories.length} categories into database!`);

    await loadCategories();

    return logger.info("Fetched movies for categories!");
};

// The categories refresh on a fixed weekly slot (Monday 00:00, server time), so restarting the
// server doesn't push the next refresh back by a week
const REFRESH_DAY = 1; // 0 = Sunday, 1 = Monday, ...
const REFRESH_HOUR = 0;

// The most recent weekly slot at or before `from`
function previousRefreshSlot(from = new Date()) {
    const slot = new Date(from);
    slot.setHours(REFRESH_HOUR, 0, 0, 0);
    slot.setDate(slot.getDate() - ((slot.getDay() - REFRESH_DAY + 7) % 7));
    if (slot > from) slot.setDate(slot.getDate() - 7);
    return slot;
}

function nextRefresh() {
    const slot = previousRefreshSlot();
    slot.setDate(slot.getDate() + 7);
    return slot.getTime();
}

async function emailAdmin(subject, text, html) {
    const adminUser = await knex('users').where({ role: 'admin' }).first();
    if (!adminUser) {
        return logger.warn("No admin user found. Please create an admin account.");
    }

    try {
        await sendMail({ from: process.env.EMAIL_USER, to: adminUser.email, subject, text, html });
    } catch (error) {
        logger.error("Error sending email: " + (error.message || error));
    }
}

async function refreshCategories() {
    const URL = process.env.FRONTEND_URL || "http://localhost:3000";

    try {
        await fetchTrendingMovies();

        await emailAdmin(
            'Successfully Refreshed the Categories! Streamify',
            `The categories have been successfully refreshed! You can check them out on ${URL}`,
            `
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>The categories have been successfully refreshed! You can check them out on <a href="${URL}">${URL}</a></p>
                </div>
            `
        );
    } catch (err) {
        logger.error("Error fetching trending movies: " + err);

        await emailAdmin(
            'Error Refreshing the Categories! Streamify',
            `There was an error refreshing the categories. Please check the server logs for more information.`,
            `
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>There was an error refreshing the categories. Please check the server logs for more information.</p>
                </div>
            `
        );
    }
}

function scheduleWeeklyRefresh() {
    // Recomputed after every run instead of a fixed interval, so daylight saving changes don't shift the slot
    setTimeout(async () => {
        await refreshCategories();
        scheduleWeeklyRefresh();
    }, Math.max(0, nextRefresh() - Date.now()));
}

// Errors thrown by route handlers end up here instead of in Express' HTML error page
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
        logger.error(`${req.method} ${req.originalUrl} failed: ${err.message || err}`);
    }
    if (res.headersSent) {
        return res.destroy();
    }
    res.status(status).json({ error: status < 500 || err.message === "Not allowed by CORS" ? err.message : "Internal server error" });
});

// Dynamically import WebTorrent and initialize the torrent manager before starting the server
(async () => {
    try {
        const { default: WebTorrent } = await import('webtorrent');

        // Make torrentManager available globally
        global.torrentManager = new TorrentManager(WebTorrent, {
            downloadPath: process.env.TORRENT_DOWNLOAD_PATH || path.join(os.tmpdir(), 'streamify-torrents'),
            idleTimeout: (Number(process.env.TORRENT_IDLE_MINUTES) || 10) * 60 * 1000,
            maxTorrents: Number(process.env.TORRENT_MAX_ACTIVE) || 4,
            client: {
                // Connection attempts count against this limit too, and most peers in a swarm can't be
                // reached, so the default of 55 makes movies take several times longer to start
                maxConns: Number(process.env.TORRENT_MAX_CONNECTIONS) || 150
            }
        });
        // Start the client (and its DHT) now, so the first movie finds peers faster
        global.torrentManager.getClient();

        // Continue with any other initialization before starting the server...
        ensureSchema().then(async () => {
            const categoriesExist = await knex('categories').select('*');
            if (!categoriesExist || categoriesExist.length === 0) {
                try {
                    logger.info("Fetching movies for categories...");
                    await fetchTrendingMovies();
                } catch (err) {
                    logger.error("Failed to fetch movie categories: " + err);
                }
            }

            await loadCategories();

            // The server was down during the last weekly slot, so catch up now without delaying the start
            const lastRefresh = await knex('categories').min('created_at as at').first();
            if (lastRefresh && lastRefresh.at && new Date(lastRefresh.at) < previousRefreshSlot()) {
                logger.info("Missed the weekly category refresh while the server was down, refreshing now...");
                refreshCategories();
            }
            scheduleWeeklyRefresh();

            // Check if the users table is emtpy
            const users = await knex('users').select('*');
            if(!users || users.length === 0) {
                logger.info("Welcome to Streamify! Please create an account to get started:");
                logger.info("http://localhost:3000/admin/auth");
            }

            server.listen(PORT, () => {
                logger.info(`Server is running on port ${PORT}`);
            });

            startMailMonitor();
        });
    } catch (err) {
        logger.error('Failed to load WebTorrent module: ' + err);
        process.exit(1);
    }
})();
