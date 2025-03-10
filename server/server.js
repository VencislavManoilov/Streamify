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

// Load environment variables early in the process
dotenv.config();

// Create a production-ready memory cache
const NodeCache = require('node-cache');
const cache = new NodeCache({ 
  stdTTL: 300, // 5 minutes default TTL
  checkperiod: 60  // Check for expired keys every minute
});

const PORT = process.env.PORT || 8080;
const OMDB_API_KEY = process.env.OMDB_API_KEY;
const OMDB_URL = "https://www.omdbapi.com/";
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Improved middleware configuration
app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Basic rate limiting
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10000, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later'
});
app.use('/api/', limiter);

// Add request logging middleware
const morgan = require('morgan');
app.use(morgan('combined'));

// Add database to all requests
app.use((req, res, next) => {
    req.knex = knex;
    next();
});

// Global categories store
let categories = [];

// Improved error handler function
function handleError(res, error, message = "An error occurred", statusCode = 500) {
    console.error(`${message}:`, error);
    return res.status(statusCode).json({ 
        error: message,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
}

// Better database movie insertion with validation
async function uploadMovie(movie, type) {
    if (!movie || !movie.id) {
        return null;
    }
    
    try {
        // Use transaction for better data consistency
        return await knex.transaction(async trx => {
            const existingMovie = await trx('movies').where({ imdb_code: movie.imdb_code }).first();
            if (existingMovie) {
                return existingMovie;
            }

            if (type === "yts") {
                const newMovie = {
                    imdb_code: movie.imdb_code,
                    slug: movie.slug || movie.title.toLowerCase().replace(/\s+/g, '-'),
                    title: movie.title,
                    genres: JSON.stringify(movie.genres || []),
                    year: movie.year || null,
                    rating: movie.rating || 0,
                    runtime: movie.runtime || 0,
                    summary: movie.summary || "No summary available",
                    background_image: movie.background_image || null,
                    small_cover_image: movie.small_cover_image || null,
                    medium_cover_image: movie.medium_cover_image || null,
                    large_cover_image: movie.large_cover_image || null,
                    torrents: JSON.stringify(movie.torrents || [])
                };
                
                const [id] = await trx('movies').insert(newMovie);
                return { id, ...newMovie };
            }

            const [id] = await trx('movies').insert(movie);
            return { id, ...movie };
        });
    } catch (dbError) {
        console.error("Database insertion error:", dbError);
        return null;
    }
}

// API health check endpoint
app.get("/", (req, res) => {
    res.json({ 
        version: '1.0.0',
        message: "Welcome to Streamify API!",
        status: "online",
        timestamp: new Date().toISOString()
    });
});

// API routes
const adminRoute = require('./routes/admin');
app.use('/admin', adminRoute);

const authRoute = require('./routes/auth');
app.use('/auth', authRoute);

// Movie list endpoint with caching
app.get("/movies", Authorization, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const cacheKey = `movies_${page}_${limit}`;
    
    try {
        // Check cache first
        const cachedData = cache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }
        
        const offset = (page - 1) * limit;
        const [movies, totalCount] = await Promise.all([
            knex('movies').select('*').offset(offset).limit(limit),
            knex('movies').count('* as count').first()
        ]);
        
        const result = { 
            movies, 
            pagination: {
                page,
                limit,
                total: totalCount.count,
                pages: Math.ceil(totalCount.count / limit)
            }
        };
        
        // Store in cache
        cache.set(cacheKey, result);
        
        res.json(result);
    } catch (err) {
        handleError(res, err, "Failed to fetch movies");
    }
});

// Single movie details endpoint with caching
app.get("/movies/:imdb_code", Authorization, async (req, res) => {
    const { imdb_code } = req.params;
    const cacheKey = `movie_${imdb_code}`;
    
    try {
        // Check cache first
        const cachedMovie = cache.get(cacheKey);
        if (cachedMovie) {
            return res.json({ movie: cachedMovie });
        }
        
        const movie = await knex('movies').where({ imdb_code }).first();
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }
        
        // Store in cache
        cache.set(cacheKey, movie);
        
        res.json({ movie });
    } catch (err) {
        handleError(res, err, "Failed to fetch movie details");
    }
});

app.get("/categories", Authorization, (req, res) => {
    try {
        res.status(200).json(categories);
    } catch (err) {
        handleError(res, err, "Failed to fetch categories");
    }
});

app.get("/stream/:imdb_code/:torrent_hash", async (req, res) => {
    const { imdb_code, torrent_hash } = req.params;
    let torrentInstance = null;
    let stream = null;

    try {
        // Retrieve movie info
        const movie = await knex('movies').where({ imdb_code }).first();
        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        // Parse torrents if stored as JSON string
        const torrents = typeof movie.torrents === 'string' 
            ? JSON.parse(movie.torrents) 
            : movie.torrents;
            
        if (!torrents || torrents.length === 0) {
            return res.status(404).json({ error: "No torrents available" });
        }

        const torrentMeta = torrents.find(torr => torr.hash === torrent_hash);
        if (!torrentMeta) {
            return res.status(404).json({ error: "Torrent not found" });
        }
        
        // Validate required URL
        if (!torrentMeta.url) {
            return res.status(400).json({ error: "Invalid torrent data" });
        }

        // Get torrent from manager
        torrentInstance = await global.torrentManager.getTorrent(torrentMeta.url, torrent_hash);
        
        // Find video file with better detection
        const videoFiles = torrentInstance.files.filter(file => {
            const name = file.name.toLowerCase();
            return name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.avi');
        });
        
        if (videoFiles.length === 0) {
            global.torrentManager.releaseReference(torrent_hash);
            return res.status(404).json({ error: "No video file found in torrent" });
        }
        
        // Use largest video file (likely the main movie)
        const file = videoFiles.sort((a, b) => b.length - a.length)[0];

        // Process range header
        const range = req.headers.range;
        if (!range) {
            global.torrentManager.releaseReference(torrent_hash);
            return res.status(416).json({ error: 'Range header required' });
        }

        const ranges = rangeParser(file.length, range);
        if (ranges === -1 || ranges === -2) {
            global.torrentManager.releaseReference(torrent_hash);
            return res.status(416).json({ error: 'Invalid Range' });
        }

        const { start, end } = ranges[0];
        const chunksize = (end - start) + 1;

        // Improve piece selection strategy for better streaming
        const startPiece = Math.floor(start / torrentInstance.pieceLength);
        const endPiece = Math.floor(end / torrentInstance.pieceLength);
        
        // Calculate a dynamic number of pieces to prioritize based on file size
        const piecesToPrioritize = Math.min(
            Math.max(20, Math.floor(torrentInstance.pieces.length * 0.05)), // At least 20 pieces or 5%
            100 // Cap at 100 pieces to prevent excessive memory use
        ); 
        
        const pieceEnd = Math.min(endPiece + piecesToPrioritize, torrentInstance.pieces.length - 1);
        
        // Progressive piece prioritization
        for (let i = startPiece; i <= pieceEnd; i++) {
            // Prioritize decreases as we get further from the current position
            const priority = i <= endPiece ? 7 : Math.max(1, 7 - Math.floor((i - endPiece) / 5));
            torrentInstance.select(i, i, priority);
        }
        
        // Use critical for the pieces directly needed now
        torrentInstance.critical(startPiece, endPiece);

        // Set proper content type based on file extension
        const fileName = file.name.toLowerCase();
        let contentType = 'video/mp4';
        if (fileName.endsWith('.mkv')) contentType = 'video/x-matroska';
        else if (fileName.endsWith('.avi')) contentType = 'video/x-msvideo';

        res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${file.length}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunksize,
            "Content-Type": contentType,
            "Cache-Control": "no-cache, no-store"
        });

        stream = file.createReadStream({ start, end });
        let responded = false;

        stream.on('error', (streamErr) => {
            console.error(`Stream error for ${torrent_hash}:`, streamErr);
            if (!responded) {
                responded = true;
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Stream error' });
                } else {
                    res.end();
                }
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
            if (stream && !stream.destroyed) {
                stream.destroy();
            }
            global.torrentManager.releaseReference(torrent_hash);
        });

        stream.pipe(res);
    } catch (err) {
        console.error(`Streaming error for ${torrent_hash}:`, err);
        if (torrentInstance) {
            global.torrentManager.releaseReference(torrent_hash);
        }
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to start streaming" });
        } else {
            res.end();
        }
    }
});

// Optimized search endpoint
app.get("/search", Authorization, async (req, res) => {
    const { query } = req.query;
    if (!query || query.trim() === '') {
        return res.status(400).json({ error: "Valid search query required" });
    }
    
    const cacheKey = `search_${query.toLowerCase()}`;
    
    try {
        // Check cache first
        const cachedResults = cache.get(cacheKey);
        if (cachedResults) {
            return res.json(cachedResults);
        }
        
        // First try local database
        const localResults = await knex('movies')
            .where('title', 'like', `%${query}%`)
            .orWhere('imdb_code', 'like', `%${query}%`)
            .limit(15);
            
        if (localResults.length > 0) {
            // Cache and return local results if we have them
            cache.set(cacheKey, localResults);
            return res.json(localResults);
        }
        
        // If not found locally, try OMDB API
        const response = await axios.get(OMDB_URL, {
            params: { s: query, apikey: OMDB_API_KEY },
            timeout: 5000 // 5 second timeout
        });

        if (response.data.Response === "False") {
            return res.status(404).json({ error: response.data.Error || "No results found" });
        }
        
        // Process search results in background without blocking response
        const results = response.data.Search || [];
        cache.set(cacheKey, results);
        
        // Return results to client immediately
        res.json(results);
        
        // Process results in background
        setTimeout(async () => {
            try {
                for (const movie of results) {
                    try {
                        const data = await axios.get("https://yts.mx/api/v2/movie_details.json?imdb_id=" + movie.imdbID, {
                            timeout: 5000
                        });
                        if (data.data.data.movie) {
                            await uploadMovie(data.data.data.movie, "yts");
                        }
                    } catch (movieErr) {
                        console.error(`Failed to process movie ${movie.imdbID}:`, movieErr);
                    }
                }
            } catch (bgErr) {
                console.error("Background processing error:", bgErr);
            }
        }, 100);
    } catch (error) {
        handleError(res, error, "Failed to search movies");
    }
});

// Enhanced category loading
async function loadCategories() {
    try {
        const categoryRows = await knex('categories').select('*');
        categories = [];
        
        for (const category of categoryRows) {
            // Parse movie IDs if stored as string
            const movieIds = typeof category.movies === 'string' 
                ? JSON.parse(category.movies) 
                : (category.movies || []);
                
            if (movieIds.length === 0) continue;
            
            // Randomize movies
            const shuffledMovieIds = [...movieIds].sort(() => Math.random() - 0.5);
            
            // Batch fetch movies to avoid too many queries
            const movies = await knex('movies')
                .whereIn('imdb_code', shuffledMovieIds)
                .limit(20); // Limit number of movies per category for performance
            
            if (movies.length > 0) {
                categories.push({ name: category.name, movies });
            }
        }
        
        return categories;
    } catch (dbError) {
        console.error("Failed to load categories:", dbError);
        return [];
    }
}

// More efficient movie fetching
const fetchTrendingMovies = async () => {
    try {
        console.log("Starting to fetch movie categories...");
        
        // Parallel API requests
        const [trendingMovies, newMovies, popular, topRated] = await Promise.all([
            axios.get(`https://api.themoviedb.org/3/trending/movie/day?api_key=${TMDB_API_KEY}`),
            axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}`),
            axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}`),
            axios.get(`https://api.themoviedb.org/3/movie/top_rated?api_key=${TMDB_API_KEY}`)
        ]);

        const categoryData = [
            {name: "Trending", movies: trendingMovies.data.results},
            {name: "New Movies", movies: newMovies.data.results},
            {name: "Popular", movies: popular.data.results},
            {name: "Top Rated", movies: topRated.data.results}
        ];
        
        for (const category of categoryData) {
            let categoryMovies = [];
            console.log(`Fetching YTS movies for category ${category.name}...`);
            
            // Process in batches of 5 for better concurrency control
            const batchSize = 5;
            for (let i = 0; i < category.movies.length; i += batchSize) {
                const batch = category.movies.slice(i, i + batchSize);
                const promises = batch.map(async (movie) => {
                    if (!movie.original_title) return null;
                    
                    try {
                        const data = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(movie.original_title)}&limit=1`, {
                            timeout: 5000
                        });
                        
                        if (data.data.data.movie_count > 0 && data.data.data.movies && data.data.data.movies.length > 0) {
                            return data.data.data.movies[0];
                        }
                    } catch (error) {
                        // Just log error and continue with next movie
                        console.log(`Failed to fetch movie "${movie.original_title}":`, error.message);
                    }
                    return null;
                });
                
                // Wait for current batch to complete
                const results = await Promise.all(promises);
                categoryMovies = categoryMovies.concat(results.filter(Boolean));
            }
            
            console.log(`Found ${categoryMovies.length} YTS movies for category ${category.name}`);

            if (categoryMovies.length > 0) {
                // Insert movies in transaction for better consistency
                await knex.transaction(async (trx) => {
                    // Upload movies first
                    for (const movie of categoryMovies) {
                        await uploadMovie(movie, "yts");
                    }
                    
                    // Then update category
                    const movieIds = categoryMovies.map(movie => movie.imdb_code).filter(Boolean);
                    const existingCategory = await trx('categories').where({ name: category.name }).first();
                    
                    if (existingCategory) {
                        await trx('categories')
                            .where({ name: category.name })
                            .update({ movies: JSON.stringify(movieIds) });
                    } else if (movieIds.length > 0) {
                        await trx('categories').insert({ 
                            name: category.name, 
                            movies: JSON.stringify(movieIds) 
                        });
                    }
                });
                
                console.log(`Updated category ${category.name} with ${categoryMovies.length} movies`);
            }
        }
        
        return console.log("Successfully updated all movie categories!");
    } catch (err) {
        console.error("Failed to fetch movie categories:", err);
        throw err;
    }
};

// Graceful shutdown handling
let server;
function setupGracefulShutdown() {
    const shutdown = async () => {
        console.log('Shutting down gracefully...');
        
        // Close HTTP server first to stop accepting new requests
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        
        // Clean up torrent manager
        if (global.torrentManager) {
            global.torrentManager.shutdown();
        }
        
        // Close database connections
        await knex.destroy();
        
        console.log('Shutdown complete');
        process.exit(0);
    };
    
    // Listen for termination signals
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    });
}

// Dynamically import WebTorrent and initialize torrentClient before starting the server
(async () => {
    setupGracefulShutdown();
    
    try {
        // Initialize database schema
        await ensureSchema();
        
        // Initialize WebTorrent client
        const { default: WebTorrent } = await import('webtorrent');
        const torrentClient = new WebTorrent({
            maxConns: 100,       // More connections for better performance
            uploadLimit: 100,    // 100 KB/s upload limit
            downloadLimit: 0,    // No download limit
            dht: true,           // Enable DHT
            tracker: true        // Enable default trackers
        });
        
        // Setup global torrent manager
        const torrentManager = new TorrentManager(torrentClient);
        global.torrentManager = torrentManager;
        
        // Load categories
        await loadCategories();
        
        // Check for admin account
        const users = await knex('users').count('* as count').first();
        if (users.count === 0) {
            console.log("Welcome to Streamify! Please create an account to get started:");
            console.log("http://localhost:3000/admin/auth");
        }
        
        // Start server
        server = app.listen(PORT, () => {
            console.log(`Streamify server running on port ${PORT}`);
            console.log(`API available at http://localhost:${PORT}`);
        });
        
        // Optional: Update movie data periodically
        // Uncomment to enable background movie updates
        /*
        setTimeout(() => {
            fetchTrendingMovies().catch(err => {
                console.error("Failed to fetch initial trending movies:", err);
            });
        }, 2000);
        
        // Update movies every 24 hours
        const ONE_DAY = 24 * 60 * 60 * 1000;
        setInterval(() => {
            fetchTrendingMovies().catch(err => {
                console.error("Failed to update trending movies:", err);
            });
        }, ONE_DAY);
        */
        
    } catch (err) {
        console.error('Failed to initialize server:', err);
        process.exit(1);
    }
})();