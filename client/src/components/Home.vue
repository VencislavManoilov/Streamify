<template>
    <div class="home">
        <h1>Movies</h1>
        <div class="movies">
            <div v-for="movie in movies" :key="movie.title" class="movie">
                <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" />
                <h2>{{ movie.title }}</h2>
                <p>Rating: {{ movie.rating }}</p>
                <p>Genres: {{ movie.genres.join(', ') }}</p>
            </div>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

export default {
    name: 'HomePage',
    data() {
        return {
            movies: []
        };
    },
    mounted() {
        axios.get('http://localhost:8080/movies')
        .then(response => {
            this.movies = response.data.movies;
        }).catch(error => {
            console.error('There was an error!', error);
        });
    }
};
</script>

<style scoped>
.home {
    padding: 20px;
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