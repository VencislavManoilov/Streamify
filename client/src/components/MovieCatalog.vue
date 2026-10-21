<template>
    <div class="home">
        <AppHeader search admin-link />

        <LoadingSpinner v-if="loading" overlay :label="kind === 'series' ? 'Loading series' : 'Loading movies'" />
        <p v-else-if="error" class="message">{{ error }}</p>
        <p v-else-if="!categories.length" class="message">{{ emptyText }}</p>
        <template v-else>
            <MovieList v-for="category in categories" :key="`${kind}-${category.name}`" :category="category" :hide-fresh="freshRows.includes(category.name)" />
        </template>
    </div>
</template>

<script>
import api from '../api';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieList from './MovieList.vue';

// The rows of each kind, loaded once per page load, so switching between movies and series is instant
const loaded = {};

// Rows of nothing but new things, where a "New episode" badge on every poster says nothing
const FRESH_ROWS = ['New Episodes', 'New Series'];

const ADDRESSES = { movie: '/categories', series: '/series/categories' };

export default {
    name: 'MovieCatalog',
    components: {
        AppHeader,
        LoadingSpinner,
        MovieList
    },
    props: {
        // 'movie' or 'series'
        kind: {
            type: String,
            default: 'movie'
        }
    },
    data() {
        return {
            categories: [],
            loading: true,
            error: null,
            freshRows: FRESH_ROWS
        };
    },
    computed: {
        emptyText() {
            return this.kind === 'series'
                ? 'The series are still being gathered. Check back in a few minutes.'
                : 'There are no movies yet. Check back in a few minutes.';
        }
    },
    watch: {
        kind() {
            window.scrollTo({ top: 0 });
            this.load();
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        async load() {
            const kind = this.kind;
            if (loaded[kind]) {
                this.categories = loaded[kind];
                this.loading = false;
                this.error = null;
                return;
            }

            this.loading = true;
            this.error = null;
            try {
                const response = await api.get(ADDRESSES[kind]);
                const categories = response.data.filter(category => category.movies.length > 0);
                // An empty list may only mean the server is still gathering them, so it's asked again next time
                if (categories.length) loaded[kind] = categories;
                if (kind === this.kind) this.categories = categories;
            } catch (error) {
                console.error('There was an error!', error);
                if (kind === this.kind && (!error.response || error.response.status !== 401)) {
                    this.error = kind === 'series'
                        ? "Series couldn't be loaded. Check your connection and refresh the page."
                        : "Movies couldn't be loaded. Check your connection and refresh the page.";
                }
            } finally {
                if (kind === this.kind) this.loading = false;
            }
        }
    }
};
</script>

<style scoped>
.home {
    padding-bottom: 48px;
}

.message {
    padding: 0 var(--gutter);
    color: var(--text-muted);
}
</style>
