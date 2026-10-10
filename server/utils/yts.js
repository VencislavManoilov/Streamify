const axios = require('axios');

// YTS keeps moving domains, so the API location can be changed without touching the code
const YTS_API_URL = (process.env.YTS_API_URL || 'https://movies-api.accel.li/api/v2').replace(/\/+$/, '');

const yts = axios.create({
    baseURL: YTS_API_URL,
    timeout: 15000
});

// Returns the YTS movie (with torrents) for an IMDb code, or null when YTS doesn't have it
async function getMovieDetails(imdbCode) {
    const response = await yts.get('/movie_details.json', { params: { imdb_id: imdbCode } });
    const movie = response.data && response.data.data && response.data.data.movie;
    // YTS answers unknown movies with an empty movie that has id 0
    return movie && movie.id ? movie : null;
}

async function listMovies(params) {
    const response = await yts.get('/list_movies.json', { params });
    return (response.data && response.data.data && response.data.data.movies) || [];
}

module.exports = { YTS_API_URL, getMovieDetails, listMovies };
