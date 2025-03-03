const express = require('express');
const app = express();
const dotenv = require('dotenv');
const ensureSchema = require('./schema');
const knex = require('./knex');
const { default: axios } = require('axios');

const PORT = 8080;

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

ensureSchema().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});