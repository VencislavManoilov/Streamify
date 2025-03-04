<template>
    <div class="movie-details" v-if="movie">
        <h1>{{ movie.title }}</h1>
        <!-- <img :src="movie.large_cover_image" :alt="movie.title" class="movie-image" /> -->
        <p>Rating: {{ movie.rating }}</p>
        <p>Genres: {{ movie.genres.join(', ') }}</p>
        <div v-if="movie.torrents && movie.torrents.length">
            <div v-for="torrent in movie.torrents" :key="torrent.url">
                <button @click="selectedTorrent = torrent.hash">{{ torrent?.type }} {{ torrent?.quality }} {{ torrent?.video_codec }}</button>
            </div>
        </div>
        <video class="movie" v-if="selectedTorrent && movie.torrents && movie.torrents.length" controls>
            <source :src="`${URL}/stream/${movie.imdb_code}/${selectedTorrent}`" type="video/mp4" />
            Your browser does not support the video tag.
        </video>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'MoviePage',
    data() {
        return {
            movie: null,
            selectedTorrent: null,
            URL: URL
        };
    },
    mounted() {
        const imdbCode = this.$route.params.imdb_code;
        axios.get(URL+`/movies/${imdbCode}`, {
            headers: {
                Authorization: localStorage.getItem('token')
            }
        })
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

.movie {
    max-width: 100%;
}
</style>