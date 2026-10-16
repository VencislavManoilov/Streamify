<template>
    <div class="search-page">
        <AppHeader back search />

        <main class="results">
            <template v-if="search">
                <h1 class="searchTitle">Results for “{{ search }}”</h1>
                <p v-if="!loading && !error && movies.length === 1" class="count">1 movie</p>

                <template v-if="!loading && !error && movies.length > 1">
                    <div class="toolbar">
                        <p class="count">
                            {{ countLabel }}
                            <button v-if="selectedGenres.length" type="button" class="clear" @click="clearGenres">Clear filters</button>
                        </p>
                        <div class="sort">
                            <label class="sort-field">
                                <span>Sort by</span>
                                <select v-model="sortField">
                                    <option value="relevance">Relevance</option>
                                    <option v-for="(field, key) in sortFields" :key="key" :value="key">{{ field.label }}</option>
                                </select>
                            </label>
                            <button
                                v-if="sortField !== 'relevance'"
                                type="button"
                                class="order"
                                :title="`Show ${otherOrderLabel.toLowerCase()}`"
                                @click="toggleOrder"
                            >
                                <svg viewBox="0 0 24 24" :class="order" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
                                {{ orderLabel }}
                            </button>
                        </div>
                    </div>

                    <div v-if="genreOptions.length" class="genres" role="group" aria-label="Categories">
                        <button
                            v-for="genre in genreOptions"
                            :key="genre.name"
                            type="button"
                            class="genre"
                            :aria-pressed="selectedGenres.includes(genre.name)"
                            @click="toggleGenre(genre.name)"
                        >{{ genre.name }} <span class="genre-count">{{ genre.count }}</span></button>
                    </div>
                </template>
            </template>

            <LoadingSpinner v-if="loading" overlay label="Searching" />
            <p v-else-if="error" class="message">{{ error }}</p>
            <div v-else-if="search && movies.length === 0" class="message">
                <p>No movies found for “{{ search }}”.</p>
                <p class="hint">Check the spelling or try another title.</p>
            </div>
            <p v-else-if="!search" class="message">Type a movie title in the search bar to find it.</p>
            <div v-else-if="!visibleMovies.length" class="message">
                <p>None of these movies is in all of the selected categories.</p>
                <button type="button" class="clear" @click="clearGenres">Clear filters</button>
            </div>
            <div v-else class="movies">
                <button v-for="movie in visibleMovies" :key="movie.imdb_code" type="button" class="movie" :aria-label="posterLabel(movie)" @click="selectedMovie = movie">
                    <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" loading="lazy" />
                    <span v-if="sortText(movie)" class="badge" aria-hidden="true">
                        <svg v-if="sortField === 'rating'" viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                        {{ sortText(movie) }}
                    </span>
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

function formatRuntime(minutes) {
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// Every way the results can be sorted besides the order the search returned them in
const SORT_FIELDS = {
    year: {
        label: 'Year',
        value: movie => movie.year,
        format: year => String(year),
        orders: { desc: 'Newest first', asc: 'Oldest first' }
    },
    rating: {
        label: 'Rating',
        value: movie => movie.rating,
        format: rating => rating.toFixed(1),
        orders: { desc: 'Highest first', asc: 'Lowest first' }
    },
    length: {
        label: 'Length',
        value: movie => movie.runtime,
        format: formatRuntime,
        orders: { desc: 'Longest first', asc: 'Shortest first' }
    }
};

// A year, rating or length of 0 means it isn't known
function isKnown(value) {
    return Number.isFinite(value) && value > 0;
}

export default {
    name: "SearchPage",
    data() {
        return {
            movies: [],
            loading: false,
            error: null,
            search: '',
            selectedMovie: null,
            sortFields: SORT_FIELDS
        };
    },
    components: {
        AppHeader,
        LoadingSpinner,
        MovieDetails
    },
    computed: {
        // Sorting and filters live in the address, so coming back from a movie keeps them
        sortField: {
            get() {
                const sort = this.$route.query.sort;
                return Object.keys(SORT_FIELDS).includes(sort) ? sort : 'relevance';
            },
            // A new field starts with the newest, best rated or longest movies first
            set(sort) {
                this.updateQuery({ sort: sort === 'relevance' ? undefined : sort, order: undefined });
            }
        },
        order() {
            return this.$route.query.order === 'asc' ? 'asc' : 'desc';
        },
        orderLabel() {
            return SORT_FIELDS[this.sortField].orders[this.order];
        },
        otherOrderLabel() {
            return SORT_FIELDS[this.sortField].orders[this.order === 'asc' ? 'desc' : 'asc'];
        },
        selectedGenres() {
            return [].concat(this.$route.query.genre || []).filter(genre => typeof genre === 'string' && genre);
        },
        // Movies in every selected category
        filteredMovies() {
            if (!this.selectedGenres.length) return this.movies;
            return this.movies.filter(movie => this.selectedGenres.every(genre => (movie.genres || []).includes(genre)));
        },
        visibleMovies() {
            const field = SORT_FIELDS[this.sortField];
            if (!field) return this.filteredMovies;

            const direction = this.order === 'asc' ? 1 : -1;
            // Movies without the value go last either way; ties keep the search order
            return this.filteredMovies.slice().sort((a, b) => {
                const x = Number(field.value(a));
                const y = Number(field.value(b));
                if (!isKnown(x) || !isKnown(y)) return isKnown(y) - isKnown(x);
                return (x - y) * direction;
            });
        },
        // Only the categories of the movies on screen, so every choice still leaves something to show
        genreOptions() {
            const counts = new Map();
            for (const movie of this.filteredMovies) {
                for (const genre of movie.genres || []) {
                    counts.set(genre, (counts.get(genre) || 0) + 1);
                }
            }
            // A selected category always stays, so it can be turned off again
            for (const genre of this.selectedGenres) {
                if (!counts.has(genre)) counts.set(genre, 0);
            }
            return [...counts]
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        countLabel() {
            const total = `${this.movies.length} movies`;
            return this.selectedGenres.length ? `${this.filteredMovies.length} of ${total}` : total;
        }
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
        },
        // Replaced instead of pushed, so Back leaves the results in one step
        updateQuery(changes) {
            this.$router.replace({ query: { ...this.$route.query, ...changes } });
        },
        toggleOrder() {
            this.updateQuery({ order: this.order === 'asc' ? undefined : 'asc' });
        },
        toggleGenre(genre) {
            const selected = this.selectedGenres.includes(genre)
                ? this.selectedGenres.filter(selectedGenre => selectedGenre !== genre)
                : [...this.selectedGenres, genre];
            this.updateQuery({ genre: selected.length ? selected : undefined });
        },
        clearGenres() {
            this.updateQuery({ genre: undefined });
        },
        // The value the results are sorted by, shown on each poster
        sortText(movie) {
            const field = SORT_FIELDS[this.sortField];
            if (!field) return '';
            const value = Number(field.value(movie));
            return isKnown(value) ? field.format(value) : '';
        },
        posterLabel(movie) {
            const text = this.sortText(movie);
            return text ? `${movie.title}, ${SORT_FIELDS[this.sortField].label.toLowerCase()} ${text}` : movie.title;
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

.toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 24px;
    margin-bottom: 16px;
}

.toolbar .count {
    margin: 0;
}

.clear {
    margin-left: 10px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
}

.clear:hover {
    color: var(--text);
}

.message .clear {
    margin: 8px 0 0;
}

.sort {
    display: flex;
    align-items: center;
    gap: 8px;
}

.sort-field {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-muted);
    font-size: 0.95rem;
}

.sort select,
.order {
    height: 40px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background-color: var(--surface);
    color: var(--text);
    font: inherit;
    font-size: 0.95rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.sort select:hover,
.order:hover {
    background-color: var(--surface-hover);
}

.sort select {
    padding: 0 38px 0 16px;
    -webkit-appearance: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a4a9be' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 14px center;
    background-size: 16px;
}

/* The open list is drawn by the browser, which doesn't know the page is dark */
.sort option {
    background-color: var(--bg-elevated);
    color: var(--text);
}

.order {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px 0 12px;
}

.order svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.2s ease;
}

.order svg.asc {
    transform: rotate(180deg);
}

.genres {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 20px;
}

.genre {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.92rem;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.genre:hover {
    background: var(--surface-hover);
}

.genre[aria-pressed="true"] {
    background: #f2f2f4;
    border-color: #f2f2f4;
    color: #0b0b10;
    font-weight: 600;
}

.genre-count {
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
}

.genre[aria-pressed="true"] .genre-count {
    color: rgba(11, 11, 16, 0.55);
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
    position: relative;
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

/* What the results are sorted by */
.badge {
    position: absolute;
    left: 8px;
    bottom: 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 8px;
    background: rgba(8, 9, 16, 0.72);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: var(--text);
    font-size: 0.82rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.badge svg {
    width: 13px;
    height: 13px;
    fill: var(--accent);
}

/* On phones the categories scroll sideways in one line instead of pushing the results down */
@media (max-width: 640px) {
    .genres {
        flex-wrap: nowrap;
        overflow-x: auto;
        margin: 0 calc(var(--gutter) * -1) 20px;
        padding: 0 var(--gutter);
        scrollbar-width: none;
    }

    .genres::-webkit-scrollbar {
        display: none;
    }
}
</style>
