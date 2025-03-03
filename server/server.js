const express = require('express');
const app = express();
const dotenv = require('dotenv');
const ensureSchema = require('./schema');
const knex = require('./knex');
const { default: axios } = require('axios');
const cors = require('cors');
const rangeParser = require('range-parser');

const PORT = 8080;

app.use(cors({
    origin: "http://localhost:3000"
}));

dotenv.config();
app.use(express.json());

app.get("/", (req, res) => {
    res.json({ 
        version: '1.0.0',
        message: "Welcome to Streamify API!"
    });
})

app.get("/movies", (req, res) => {
    knex('movies').select('*').then(movies => {
        res.json({ movies });
    }).catch(err => {
        res.status(500).json({ error: err.message });
    });
});

app.post("/movies", async (req, res) => {
    try {
        const response = await axios.get("https://yts.mx/api/v2/list_movies.json");
        const movies = response.data.data.movies;

        for (const movie of movies) {
            try {
                const newMovie = {
                    imdb_code: movie.imdb_code,
                    slug: movie.slug,
                    title: movie.title,
                    genres: JSON.stringify(movie.genres),
                    year: movie.year,
                    rating: movie.rating,
                    runtime: movie.runtime,
                    summary: movie.summary,
                    background_image: movie.background_image,
                    small_cover_image: movie.small_cover_image,
                    medium_cover_image: movie.medium_cover_image,
                    large_cover_image: movie.large_cover_image,
                    torrents: JSON.stringify(movie.torrents)
                };

                await knex('movies').insert(newMovie);
            } catch (dbError) {
                console.error("Database insertion error:", dbError);
                return res.status(500).json({ error: "Database Insertion Error" });
            }
        }

        res.json({ message: "Movies added successfully!" });
    } catch (err) {
        console.error("Error fetching movies or processing data:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get("/movies/:imdb_code", (req, res) => {
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

app.get("/stream/:imdb_code", async (req, res) => {
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

ensureSchema().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});