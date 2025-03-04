const express = require('express');
const app = express();
const dotenv = require('dotenv');
const ensureSchema = require('./schema');
const knex = require('./knex');
const { default: axios } = require('axios');
const cors = require('cors');
const rangeParser = require('range-parser');
const Authorization = require('./middleware/Auth');

const PORT = 8080;

app.use(cors({
    origin: "http://localhost:3000"
}));

dotenv.config();
app.use(express.urlencoded({ extended: true }));

const OMDB_API_KEY = process.env.OMDB_API_KEY;
const OMDB_URL = "https://www.omdbapi.com/";

async function uploadMovie(movie, type) {
    if (!movie.id) {
        return;
    }
    try {
        const existingMovie = await knex('movies').where({ imdb_code: movie.imdb_code }).first();
        if (existingMovie) {
            return;
        }

        if (type === "yts") {
            const newMovie = {
                imdb_code: movie.imdb_code,
                slug: movie.slug || movie.title.toLowerCase().replace(/\s+/g, '-'),
                title: movie.title,
                genres: JSON.stringify(movie.genres),
                year: movie.year,
                rating: movie.rating,
                runtime: movie.runtime,
                summary: movie.summary || "No summary available",
                background_image: movie.background_image,
                small_cover_image: movie.small_cover_image,
                medium_cover_image: movie.medium_cover_image,
                large_cover_image: movie.large_cover_image,
                torrents: JSON.stringify(movie.torrents)
            };
            return knex('movies').insert(newMovie);
        }

        return knex('movies').insert(movie);
    } catch (dbError) {
        console.error("Database insertion error:", dbError);
        return Promise.reject(dbError);
    }
}

app.get("/", (req, res) => {
    res.json({ 
        version: '1.0.0',
        message: "Welcome to Streamify API!"
    });
})

const authRoute = require('./routes/auth');
app.use('/auth', async (req, res, next) => {
    req.knex = knex;
    next();
}, authRoute);

app.get("/movies", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, (req, res) => {
    knex('movies').select('*').then(movies => {
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

app.get("/stream/:imdb_code", (req, res, next) => {
    req.knex = knex;
    next();
}, Authorization, async (req, res) => {
    const { imdb_code } = req.params;

    try {
        const movie = await knex('movies').where({ imdb_code }).first();

        if (!movie) {
            return res.status(404).json({ error: "Movie not found" });
        }

        if (!movie.torrents || movie.torrents.length === 0) {
            return res.status(404).json({ error: "Torrent not found" });
        }

        const torrentUrl = movie.torrents[0].url;

        const WebTorrent = await import('webtorrent');
        const client = new WebTorrent.default();

        client.add(torrentUrl, torrent => {
            const file = torrent.files.find(file => file.name.endsWith('.mp4'));

            if (!file) {
                return res.status(404).json({ error: "MP4 file not found in torrent" });
            }

            const range = req.headers.range;
            if (!range) {
                return res.status(416).send('Requires Range header');
            }

            const ranges = rangeParser(file.length, range);
            if (ranges === -1) {
                return res.status(416).send('Unsatisfiable Range');
            }
            if (ranges === -2) {
                return res.status(400).send('Malformed Range');
            }

            const { start, end } = ranges[0];
            const chunksize = (end - start) + 1;

            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${file.length}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunksize,
                "Content-Type": "video/mp4"
            });

            const stream = file.createReadStream({ start, end });
            let responseSent = false;

            stream.on('error', (streamErr) => {
                if (!responseSent) {
                    res.status(500).json({ error: 'Stream error' });
                    responseSent = true;
                }
                if (!client.destroyed) {
                    client.destroy();
                }
            });

            stream.pipe(res);

            res.on('close', () => {
                if (!responseSent) {
                    responseSent = true;
                }
                if (!stream.destroyed) {
                    stream.destroy();
                }
                if (!client.destroyed) {
                    client.destroy();
                }
            });

            stream.on('end', () => {
                responseSent = true;
            });
        });

        client.on('error', (clientErr) => {
            if (clientErr.code === 'UTP_ECONNRESET') {
                console.log('Connection reset by peer');
            } else {
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Client error' });
                }
            }
            if (!client.destroyed) {
                client.destroy();
            }
        });

    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
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
        console.log(error);
        res.status(500).json({ error: "Failed to fetch movies" });
    }
});

ensureSchema().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});