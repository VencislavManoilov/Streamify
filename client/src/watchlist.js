import { reactive } from 'vue';
import api from './api';
import { session } from './session';

// The movies the logged in user saved for later, newest first. Every page shares this list, so a movie
// saved from a card shows up on the profile page right away.
const state = reactive({
    movies: [],
    // Whose list `movies` is, so someone else logging in on this page gets their own list
    userId: null
});

let pendingLoad = null;
// Movies whose add or remove is still on its way to the server
const pending = new Set();

function currentUserId() {
    return session.user ? session.user.id : null;
}

function withoutMovie(movies, imdbCode) {
    return movies.filter(movie => movie.imdb_code !== imdbCode);
}

export const watchlist = {
    // True once the list of the logged in user is loaded
    get ready() {
        return state.userId !== null && state.userId === currentUserId();
    },

    get movies() {
        return this.ready ? state.movies : [];
    },

    has(imdbCode) {
        return this.movies.some(movie => movie.imdb_code === imdbCode);
    },

    // Resolves once the list is loaded. The server is only asked once, unless `refresh` asks for the latest list.
    load({ refresh = false } = {}) {
        if (this.ready && !refresh) return Promise.resolve();
        if (!pendingLoad) {
            const userId = currentUserId();
            pendingLoad = api.get('/watchlist').then((response) => {
                if (userId !== currentUserId()) return;
                state.movies = response.data.movies;
                state.userId = userId;
            }).finally(() => {
                pendingLoad = null;
            });
        }
        return pendingLoad;
    },

    // The list changes right away and goes back to how it was if the server can't save the change
    async add(movie) {
        await this.load();
        const code = movie.imdb_code;
        if (this.has(code) || pending.has(code)) return;

        // Listed like the catalog lists movies, without the progress a movie from the history has
        const saved = { ...movie };
        delete saved.progress;

        state.movies = [saved, ...state.movies];
        pending.add(code);
        try {
            await api.put(`/watchlist/${code}`);
        } catch (err) {
            state.movies = withoutMovie(state.movies, code);
            throw err;
        } finally {
            pending.delete(code);
        }
    },

    async remove(movie) {
        await this.load();
        const code = movie.imdb_code;
        const index = this.movies.findIndex(saved => saved.imdb_code === code);
        if (index === -1 || pending.has(code)) return;

        const removed = state.movies[index];
        state.movies = withoutMovie(state.movies, code);
        pending.add(code);
        try {
            await api.delete(`/watchlist/${code}`);
        } catch (err) {
            const movies = state.movies.slice();
            movies.splice(Math.min(index, movies.length), 0, removed);
            state.movies = movies;
            throw err;
        } finally {
            pending.delete(code);
        }
    },

    // For a movie the server already took off the list, because it was watched to the end
    forget(imdbCode) {
        state.movies = withoutMovie(state.movies, imdbCode);
    }
};
