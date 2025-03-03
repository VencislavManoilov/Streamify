<template>
    <div class="movie-details" v-if="movie">
        <h1>{{ movie.title }}</h1>
        <!-- <img :src="movie.large_cover_image" :alt="movie.title" class="movie-image" /> -->
        <p>Rating: {{ movie.rating }}</p>
        <p>Genres: {{ movie.genres.join(', ') }}</p>
        <video v-if="movie.torrents && movie.torrents.length" controls>
            <source :src="`http://localhost:8080/stream/${movie.imdb_code}`" type="video/mp4" />
            Your browser does not support the video tag.
        </video>
    </div>
</template>

<script>
import axios from 'axios';

export default {
    name: 'MoviePage',
    data() {
        return {
            movie: null
        };
    },
    mounted() {
        const imdbCode = this.$route.params.imdb_code;
        axios.get(`http://localhost:8080/movies/${imdbCode}`)
        .then(response => {
            this.movie = response.data.movie;
        }).catch(error => {
            console.error('There was an error!', error);
        });
    }
};
</script>

<style scoped>
.movie-details {
    padding: 20px;
}
</style>