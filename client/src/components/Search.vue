<template>
    <div>
        <h1>Search Results</h1>
        <div v-if="loading">Loading...</div>
        <div v-else-if="error">{{ error }}</div>
        <div v-else>
            <div v-for="movie in movies" :key="movie.id" class="movie">
                <router-link :to="'/movie/' + movie.imdb_code">
                    <h2>{{ movie.title }}</h2>
                </router-link>
            </div>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.BACKEND_URL || 'http://localhost:8080';

export default {
    name: "SearchPage",
    data() {
        return {
            movies: [],
            loading: true,
            error: null,
        };
    },
    created() {
        this.fetchMovies();
    },
    methods: {
        async fetchMovies() {
            const query = this.$route.query.query;
            if (!query) {
                this.error = "No search query provided.";
                this.loading = false;
                return;
            }

            try {
                const response = await fetch(URL+`/search?query=${query}`);
                if (!response.ok) {
                    throw new Error("Failed to fetch movies.");
                }
                
                const data = await response.json();
                
                await new Promise(resolve => setTimeout(resolve, 500));

                await data.forEach(async (movie) => {
                    await axios.get(URL+`/movies/${movie.imdbID}`)
                    .then(response => {
                        this.movies.push(response.data.movie);
                    }).catch(error => {
                        console.error('There was an error!', error);
                    });
                });
            } catch (err) {
                this.error = err.message;
            } finally {
                this.loading = false;
            }
        },
    },
};
</script>

<style scoped>
.movie {
    margin-bottom: 20px;
}
</style>