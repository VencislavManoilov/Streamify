import api from './api';

// Cast, crew and the other details from TMDB, asked for once per movie and page load
const cache = new Map(); // IMDb code -> promise of the details (null when TMDB doesn't know the movie)

export const movieDetails = {
    load(imdbCode) {
        if (!cache.has(imdbCode)) {
            const request = api.get(`/movies/${imdbCode}/details`).then(response => response.data.details);
            cache.set(imdbCode, request);
            // A failed request is tried again the next time the movie is opened
            request.catch(() => cache.delete(imdbCode));
        }
        return cache.get(imdbCode);
    },

    // For details that came with another answer, like the one of a reset
    set(imdbCode, details) {
        cache.set(imdbCode, Promise.resolve(details));
    }
};

const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

export function profileImage(path, size = 'w185') {
    return path ? `${TMDB_IMAGES}/${size}${path}` : null;
}

export function formatRuntime(minutes) {
    const total = Number(minutes);
    if (!total) return '';
    const hours = Math.floor(total / 60);
    return hours ? `${hours}h ${total % 60}m` : `${total}m`;
}
