<template>
    <div class="home">
        <AppHeader search admin-link />

        <LoadingSpinner v-if="loading" overlay label="Loading movies" />
        <p v-else-if="error" class="message">{{ error }}</p>
        <template v-else>
            <MovieList v-for="category in categories" :key="category.name" :category="category" />
        </template>
    </div>
</template>

<script>
import api from '../api';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieList from './MovieList.vue';

export default {
    name: 'MovieCatalog',
    data() {
        return {
            categories: [],
            loading: true,
            error: null
        };
    },
    components: {
        AppHeader,
        LoadingSpinner,
        MovieList
    },
    async mounted() {
        try {
            const response = await api.get('/categories');
            this.categories = response.data.filter(category => category.movies.length > 0);
        } catch (error) {
            console.error('There was an error!', error);
            if (!error.response || error.response.status !== 401) {
                this.error = "Movies couldn't be loaded. Check your connection and refresh the page.";
            }
        } finally {
            this.loading = false;
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
