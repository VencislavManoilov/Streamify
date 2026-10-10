<template>
    <div class="search-page">
        <AppHeader back search />

        <main class="results">
            <template v-if="search">
                <h1 class="searchTitle">Results for “{{ search }}”</h1>
                <p v-if="!loading && !error && movies.length" class="count">{{ movies.length }} {{ movies.length === 1 ? 'movie' : 'movies' }}</p>
            </template>

            <LoadingSpinner v-if="loading" overlay label="Searching" />
            <p v-else-if="error" class="message">{{ error }}</p>
            <div v-else-if="search && movies.length === 0" class="message">
                <p>No movies found for “{{ search }}”.</p>
                <p class="hint">Check the spelling or try another title.</p>
            </div>
            <p v-else-if="!search" class="message">Type a movie title in the search bar to find it.</p>
            <div v-else class="movies">
                <button v-for="movie in movies" :key="movie.imdb_code" type="button" class="movie" :aria-label="movie.title" @click="selectedMovie = movie">
                    <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" loading="lazy" />
                </button>
            </div>
        </main>

        <MovieDetails v-if="selectedMovie" :movie="selectedMovie" @close="selectedMovie = null" />
    </div>
</template>

<script>
import api from '../api';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieDetails from './MovieDetails.vue';

export default {
    name: "SearchPage",
    data() {
        return {
            movies: [],
            loading: false,
            error: null,
            search: '',
            selectedMovie: null
        };
    },
    components: {
        AppHeader,
        LoadingSpinner,
        MovieDetails
    },
    watch: {
        '$route.query.query'() {
            if (this.$route.name === 'Search') this.fetchMovies();
        }
    },
    created() {
        this.fetchMovies();
    },
    methods: {
        async fetchMovies() {
            const query = String(this.$route.query.query || '').trim();
            this.search = query;
            this.error = null;
            this.movies = [];
            this.selectedMovie = null;

            if (!query) {
                this.loading = false;
                return;
            }

            // Only the newest search may update the page
            const requestId = (this.requestId = (this.requestId || 0) + 1);
            this.loading = true;

            try {
                const response = await api.get('/search', { params: { query } });
                if (requestId !== this.requestId) return;
                this.movies = response.data.movies;
            } catch (err) {
                if (requestId !== this.requestId) return;
                if (!err.response || err.response.status !== 401) {
                    this.error = "Search isn't working right now. Try again in a moment.";
                }
            } finally {
                if (requestId === this.requestId) this.loading = false;
            }
        }
    },
};
</script>

<style scoped>
.search-page {
    padding-bottom: 48px;
}

.results {
    padding: 4px var(--gutter) 0;
}

.searchTitle {
    margin: 8px 0 4px;
    font-size: clamp(1.5rem, 3vw, 2rem);
    font-weight: 750;
    font-stretch: 112%;
    line-height: 1.15;
    overflow-wrap: anywhere;
}

.count {
    margin: 0 0 20px;
    color: var(--text-muted);
}

.message {
    margin: 24px 0;
    color: var(--text-muted);
    font-size: 1.05rem;
}

.message p {
    margin: 0 0 4px;
}

.hint {
    color: var(--text-faint);
}

.movies {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(clamp(128px, 28vw, 180px), 1fr));
    gap: 16px;
    margin-top: 8px;
}

.movie {
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    padding: 0;
    border: none;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
    cursor: pointer;
    transition: filter 0.2s ease;
}

.movie:hover {
    filter: brightness(1.12);
}

.movie:focus-visible {
    outline-offset: -2px;
    outline-width: 3px;
}

.movie-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}
</style>
