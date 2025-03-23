const express = require('express');
const app = express();
const dotenv = require('dotenv');
const ensureSchema = require('./schema');
const knex = require('./knex');
const { default: axios } = require('axios');
const cors = require('cors');
const rangeParser = require('range-parser');
const Authorization = require('./middleware/Auth');
const TorrentManager = require('./utils/torrentManager');
const srtToVtt = require('srt-to-vtt');
const logger = require('./utils/logger');

const PORT = 8080;

app.use(cors({
    origin: process.env.CORS_ORIGIN ? JSON.parse(process.env.CORS_ORIGIN) : "http://localhost:3000"
}));

dotenv.config();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let torrentClient;

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const OMDB_URL = "https://www.omdbapi.com/";

let categories = [];

async function uploadMovie(movie, type) {
    if (!movie.id) {
        return;
    }
    try {
        const existingMovie = await knex('movies').where({ imdb_code: movie.imdb_code }).first();

        if (type === "yts") {
            const newMovie = {
                imdb_code: movie.imdb_code,
                slug: movie.slug || movie.title.toLowerCase().replace(/\s+/g, '-'),
                title: movie.title,
                genres: JSON.stringify(movie.genres),
                year: movie.year,
                rating: movie.rating,
                runtime: movie.runtime,
                summary: movie.summary || movie.description || movie.description_full || movie.description_intro || movie.overview || "No summary available",
                background_image: movie.background_image,
                small_cover_image: movie.small_cover_image,
                medium_cover_image: movie.medium_cover_image,
                large_cover_image: movie.large_cover_image,
                torrents: JSON.stringify(movie.torrents)
            };

            if(existingMovie) {
                return knex('movies').where({ imdb_code: movie.imdb_code }).update(newMovie);
            }

            return knex('movies').insert(newMovie);
        }

        if(existingMovie) {
            return knex('movies').where({ imdb_code: movie.imdb_code }).update(movie);
        }

        return knex('movies').insert(movie);
    } catch (dbError) {
        logger.error("Database insertion error: " + dbError);
        return Promise.reject(dbError);
    }
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
    next();
}, adminRoute);

const authRoute = require('./routes/auth');
app.use('/auth', async (req, res, next) => {
    req.knex = knex;
    next();
}, authRoute);

app.get("/movies", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, (req, res) => {
    knex('movies').select('*').limit(15).then(movies => {
        res.json({ movies });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.get("/movies/:imdb_code", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, (req, res) => {
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

app.get("/categories", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, (req, res) => {
    try {
        res.status(200).json(categories);
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post("/reset-movie", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, async (req, res) => {
    const { imdb_code } = req.body;

    try {
        const movie = await knex('movies').where({ imdb_code }).first();
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }
    } catch (err) {
        res.status(500).json({ error: "Internal server error" });
    }

    try {
        const data = await axios.get("https://yts.mx/api/v2/movie_details.json?imdb_id=" + imdb_code);
        movie = data.data.data.movie;
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

app.get("/stream/:imdb_code/:torrent_hash", async (req, res) => {
    const { imdb_code, torrent_hash } = req.params;

    try {
        const movie = await knex('movies').where({ imdb_code }).first();

        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        if (!movie.torrents || movie.torrents.length === 0) {
            return res.status(404).json({ error: "Torrent not found" });
        }

        const torrentMeta = movie.torrents.find(torr => torr.hash === torrent_hash);
        if (!torrentMeta) {
            return res.status(404).json({ error: "Torrent not found" });
        }
        const torrentUrl = torrentMeta.url;

        try {
            // Get torrent from torrent manager
            let torrentInstance = null;
            
            try {
                torrentInstance = await global.torrentManager.getTorrent(torrentUrl, torrent_hash);
            } catch (err) {
                if (err.message && err.message.includes('duplicate torrent')) {
                    // Try direct lookup if duplicate error occurs
                    logger.info("Handling duplicate torrent error - attempting direct lookup");
                    
                    // Get the hash from the error message if possible
                    const match = err.message.match(/duplicate torrent ([0-9a-f]+)/i);
                    const hashToUse = match && match[1] ? match[1] : torrent_hash;
                    
                    // Try to get the torrent directly from the client
                    const existingTorrent = global.torrentManager.torrentClient.get(hashToUse);
                    if (existingTorrent) {
                        // Register it in the manager
                        global.torrentManager.activeTorrents.set(torrent_hash, {
                            torrent: existingTorrent,
                            refCount: 1,
                            lastAccessed: Date.now()
                        });
                        torrentInstance = existingTorrent;
                    } else {
                        throw new Error("Could not retrieve torrent after duplicate error");
                    }
                } else {
                    throw err;
                }
            }
            
            if (!torrentInstance) {
                throw new Error("Failed to get torrent instance");
            }
            
            const file = torrentInstance.files.find(file => file.name.endsWith('.mp4'));
            if (!file) {
                global.torrentManager.releaseReference(torrent_hash);
                return res.status(404).json({ error: "MP4 file not found in torrent" });
            }

            const range = req.headers.range;
            if (!range) {
                global.torrentManager.releaseReference(torrent_hash);
                return res.status(416).send('Requires Range header');
            }

            const ranges = rangeParser(file.length, range);
            if (ranges === -1 || ranges === -2) {
                global.torrentManager.releaseReference(torrent_hash);
                return res.status(416).send('Invalid Range');
            }

            const { start, end } = ranges[0];
            const chunksize = (end - start) + 1;

            file.select();
            
            // Calculate which pieces this range needs
            const startPiece = Math.floor(start / torrentInstance.pieceLength);
            const endPiece = Math.floor(end / torrentInstance.pieceLength);
            
            // Prioritize additional pieces ahead for better buffering
            const piecesToPrioritize = 10; 
            const pieceEnd = Math.min(endPiece + piecesToPrioritize, torrentInstance.pieces.length - 1);
            
            // Use the torrent's piece selection API
            torrentInstance.critical(startPiece, pieceEnd);

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${file.length}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunksize,
                "Content-Type": "video/mp4"
            });

            const stream = file.createReadStream({ start, end });
            let responded = false;

            stream.on('error', (streamErr) => {
                if (!responded) {
                    responded = true;
                    res.status(500).json({ error: 'Stream error' });
                }
                global.torrentManager.releaseReference(torrent_hash);
            });

            stream.on('end', () => {
                responded = true;
                global.torrentManager.releaseReference(torrent_hash);
            });

            res.on('close', () => {
                if (!responded) {
                    responded = true;
                }
                if (!stream.destroyed) {
                    stream.destroy();
                }
                global.torrentManager.releaseReference(torrent_hash);
            });

            stream.pipe(res);
        } catch (torrentError) {
            logger.error("Torrent error: " + torrentError);
            return res.status(500).json({ error: "Failed to start streaming: " + torrentError.message });
        }
    } catch (err) {
        logger.error("Stream error: " + err);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    }
});

app.get("/captions/:imdb_code/:torrent_hash", async (req, res) => {
    const { imdb_code, torrent_hash } = req.params;

    try {
        const movie = await knex('movies').where({ imdb_code }).first();

        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        const torrentMeta = movie.torrents.find(torr => torr.hash === torrent_hash);
        if (!torrentMeta) {
            return res.status(404).json({ error: "Torrent not found" });
        }

        const torrentUrl = torrentMeta.url;

        // Get the torrent instance
        const torrentInstance = await global.torrentManager.getTorrent(torrentUrl, torrent_hash);

        // Find subtitle files (e.g., .srt or .vtt)
        const subtitleFiles = torrentInstance.files.filter(file =>
            file.name.endsWith('.srt') || file.name.endsWith('.vtt')
        );

        if (subtitleFiles.length === 0) {
            global.torrentManager.releaseReference(torrent_hash);
            return res.status(404).json({ error: "No subtitles found in torrent" });
        }

        // Select the first subtitle file (or implement logic to choose based on language)
        const subtitleFile = subtitleFiles[0];

        // Stream the subtitle file to the client
        res.setHeader("Content-Type", "text/vtt");

        const stream = subtitleFile.createReadStream();

        // Convert SRT to VTT if necessary
        if (subtitleFile.name.endsWith('.srt')) {
            stream.pipe(srtToVtt()).pipe(res);
        } else {
            stream.pipe(res);
        }

        stream.on("error", (err) => {
            logger.error("Error streaming subtitle file: " + err);
            global.torrentManager.releaseReference(torrent_hash);
            res.status(500).json({ error: "Failed to stream subtitles" });
        });

        stream.on("end", () => {
            global.torrentManager.releaseReference(torrent_hash);
        });
    } catch (err) {
        logger.error("Error fetching captions: " + err);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.get("/search", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, async (req, res) => {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: "Query is required" });

    try {
        const response = await axios.get(OMDB_URL, {
            params: { s: query, apikey: OMDB_API_KEY },
        });

        if (response.data.Response === "False") {
            return res.status(404).json({ error: response.data.Error });
        }

        response.data.Search.forEach(async (search) => {
            const data = await axios.get("https://yts.mx/api/v2/movie_details.json?imdb_id=" + search.imdbID);
            movie = data.data.data.movie;
            await uploadMovie(movie, "yts");
        });

        res.json(response.data.Search);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ error: "Failed to fetch movies" });
    }
});

async function loadCategories() {
    categories = [];
    try {
        const load = await knex('categories').select('*');
        for(const category of load) {
            category.movies = category.movies;
            category.movies = category.movies.sort(() => Math.random() - 0.5);
            const movies = [];
            category.movies.map(async movie => {
                const data = await knex('movies').where({ imdb_code: movie }).first();
                movies.push(data);
            });
            categories.push({ name: category.name, movies });
        }
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

    await knex('categories').del();

    const trendingMovies = await axios.get(`https://api.themoviedb.org/3/trending/movie/day?api_key=${process.env.TMDB_API_KEY}`);
    const newMovies = await axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${process.env.TMDB_API_KEY}`);
    const popular = await axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${process.env.TMDB_API_KEY}`);
    const topRated = await axios.get(`https://api.themoviedb.org/3/movie/top_rated?api_key=${process.env.TMDB_API_KEY}`);

    const trendingMoviesData = trendingMovies.data.results;
    const newMoviesData = newMovies.data.results;
    const popularMoviesData = popular.data.results;
    const topRatedMoviesData = topRated.data.results;

    const allCategories = [
        { name: "Trending", movies: trendingMoviesData },
        { name: "New Movies", movies: newMoviesData },
        { name: "Popular", movies: popularMoviesData },
        { name: "Top Rated", movies: topRatedMoviesData },
    ];

    // Fetch movies by genre
    for (const genre of genres) {
        const genreMovies = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${process.env.TMDB_API_KEY}&with_genres=${genre.id}`);
        allCategories.push({ name: genre.name, movies: genreMovies.data.results });
    }

    for (const category of allCategories) {
        let categoryMovies = [];
        logger.info(`Fetching YTS movies for category ${category.name}...`);
        for (const movie of category.movies) {
            if (movie.original_title) {
                try {
                    const data = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${movie.original_title}&limit=1`);
                    const ytsMovie = data.data.data.movies[0];
                    if (ytsMovie) {
                        ytsMovie.overview = movie.overview;
                        categoryMovies.push(ytsMovie);
                        logger.info(`✅ ${ytsMovie.title}`);
                    } else {
                        logger.warn(`❌ ${movie.original_title}`);
                    }
                } catch (error) {
                    logger.warn(`❌ ${movie.original_title}`);
                }
            }
        }

        logger.info(`Uploading ${categoryMovies.length} movies for category ${category.name}...`);
        for(const movie of categoryMovies) {
            await uploadMovie(movie, "yts");
        }
        logger.info(`Uploaded ${categoryMovies.length} movies for category ${category.name}!`);

        try {
            logger.info(`Inserting category ${category.name} into database...`);
            const existingCategory = await knex('categories').where({ name: category.name }).first();
            const movieIds = categoryMovies.map(movie => movie.imdb_code);
            if (existingCategory) {
                await knex('categories').where({ name: category.name }).update({ movies: JSON.stringify(movieIds) });
            } else {
                await knex('categories').insert({ name: category.name, movies: JSON.stringify(movieIds) });
            }
            logger.info(`Category ${category.name} inserted successfully!`);
        } catch (dbError) {
            logger.error(`Database insertion error for category ${category.name}: ${dbError}`);
        }
    }

    await loadCategories();

    return logger.info("Fetched movies for categories!");
};

let lastFetchTime = Date.now(); // Store the timestamp of the last fetch
const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

setInterval(async () => {
    const adminUser = await knex('users').where({ role: 'admin' }).first();
    if (!adminUser) {
        logger.warn("No admin user found. Please create an admin account.");
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY
        }
    });
    
    try {
        await fetchTrendingMovies();
        lastFetchTime = Date.now(); // Update the last fetch time

        const URL = process.env.FRONTEND_URL || "http://localhost:3000";
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: adminUser.email,
            subject: 'Successfully Refreshed the Categories! Streamify',
            text: `The categories have been successfully refreshed! You can check them out on ${URL}`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>The categories have been successfully refreshed! You can check them out on <a href="${URL}">${URL}</a></p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if(error){
                logger.error(error);
                return res.status(500).json({ message: 'Error sending email' });
            }
            return res.status(200).json({ message: 'Email sent' });
        });
    } catch (err) {
        logger.error("Error fetching trending movies: " + err);
        const URL = process.env.FRONTEND_URL || "http://localhost:3000";
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: adminUser.email,
            subject: 'Error Refreshing the Categories! Streamify',
            text: `There was an error refreshing the categories. Please check the server logs for more information.`,
            html: `
                <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                    <p>There was an error refreshing the categories. Please check the server logs for more information.</p>
                </div>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if(error){
                logger.error(error);
                return res.status(500).json({ message: 'Error sending email' });
            }
            return res.status(200).json({ message: 'Email sent' });
        });
    }
}, SEVEN_DAYS_IN_MS);

function nextRefresh() {
    const nextRefreshTime = lastFetchTime + SEVEN_DAYS_IN_MS;

    return nextRefreshTime;
}

// Dynamically import WebTorrent and initialize torrentClient before starting the server
(async () => {
    try {
        const { default: WebTorrent } = await import('webtorrent');
        torrentClient = new WebTorrent();
        torrentClient.setMaxListeners(50); // Increased from 20
        
        // Initialize the torrent manager
        const torrentManager = new TorrentManager(torrentClient);
        
        // Clean up idle torrents every 10 minutes
        setInterval(() => {
            torrentManager.cleanupIdleTorrents();
        }, 10 * 60 * 1000);

        // Make torrentManager available globally
        global.torrentManager = torrentManager;

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

            // Check if the users table is emtpy
            const users = await knex('users').select('*');
            if(!users || users.length === 0) {
                logger.info("Welcome to Streamify! Please create an account to get started:");
                logger.info("http://localhost:3000/admin/auth");
            }

            app.listen(PORT, () => {
                logger.info(`Server is running on port ${PORT}`);
            });
        });
    } catch (err) {
        logger.error('Failed to load WebTorrent module: ' + err);
        process.exit(1);
    }
})();