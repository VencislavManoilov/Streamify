<template>
    <div class="home">
        <!-- Search input and button -->
        <div class="search-bar">
            <input v-model="searchQuery" type="text" placeholder="Search for movies..." />
            <button @click="searchMovies">Search</button>
        </div>
        <h1>Movies</h1>
        <div class="movies">
            <div v-for="movie in movies" :key="movie.title" class="movie">
                <router-link :to="'/movie/' + movie.imdb_code">
                    <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" />
                    <h2>{{ movie.title }}</h2>
                    <p>Rating: {{ movie.rating }}</p>
                    <p>Genres: {{ movie.genres.join(', ') }}</p>
                </router-link>
            </div>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'MovieCatalog',
    data() {
        return {
            movies: [],
            searchQuery: ''
        };
    },
    mounted() {
        axios.get(URL+"/movies", {
            headers: {
                Authorization: localStorage.getItem('token')
            }
        })
        .then(response => {
            this.movies = response.data.movies;
        }).catch(error => {
            console.error('There was an error!', error);
        });
    },
    methods: {
        searchMovies() {
            if (this.searchQuery.trim() !== '') {
                this.$router.push({ path: '/search', query: { query: this.searchQuery } });
            }
        }
    }
};
</script>

<style scoped>
.search-bar {
    margin-bottom: 20px;
}

.search-bar input {
    padding: 10px;
    font-size: 16px;
    width: 300px;
    margin-right: 10px;
}

.search-bar button {
    padding: 10px 20px;
    font-size: 16px;
    cursor: pointer;
}

.movies {
    display: flex;
    flex-wrap: wrap;
}

.movie {
    margin: 10px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 5px;
    width: 200px;
    text-align: center;
}

.movie-image {
    width: 100%;
    height: auto;
    border-radius: 5px;
}
</style>