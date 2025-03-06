<template>
    <div>
        <button class="homeButton">
            <router-link :to="'/'">
                <span>Home</span>
            </router-link>
        </button>
        <div class="search-bar">
            <input v-model="searchQuery" type="text" placeholder="Search for movies..." @keyup.enter="searchMovies" />
            <button @click="searchMovies">Search</button>
        </div>
        <h1 class="searchTitle">Search results for "{{ search }}"</h1>
        <div v-if="loading">Loading...</div>
        <div v-else-if="error">{{ error }}</div>
        <div v-else-if="movies.length === 0">No movies found.</div>
        <div v-else>
            <div class="movies" 
                ref="container" 
                @mousedown="startDrag($event)" 
                @mousemove="onDrag($event)" 
                @mouseup="stopDrag" 
                @mouseleave="stopDrag">
                <div v-for="movie in movies" :key="movie.title" class="movie" @click="handleClick">
                    <button v-on:click="selectedMovie = movie">
                        <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" />
                    </button>
                </div>
            </div>
        </div>

        <MovieDetails v-if="selectedMovie" 
            :backgroundImage="selectedMovie.background_image" 
            :cover="selectedMovie.medium_cover_image" 
            :title="selectedMovie.title" 
            :rating="selectedMovie.rating" 
            :year="selectedMovie.year" 
            :genres="selectedMovie.genres"
            :imdb_code="selectedMovie.imdb_code"
            @close="selectedMovie = null"
        />
    </div>
</template>

<script>
import axios from 'axios';
import MovieDetails from './MovieDetails.vue';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: "SearchPage",
    data() {
        return {
            movies: [],
            loading: true,
            error: null,
            search: '',
            selectedMovie: null,
            searchQuery: this.$route.query.query,
            isDragging: false,
            startX: 0,
            scrollLeft: 0,
            clickPrevented: false,
        };
    },
    components: {
        MovieDetails
    },
    created() {
        this.fetchMovies();
    },
    methods: {
        async fetchMovies() {
            const query = this.$route.query.query;
            this.search = this.$route.query.query;
            if (!query) {
                this.error = "No search query provided.";
                this.loading = false;
                return;
            }

            try {
                const response = await fetch(URL+`/search?query=${query}`, {
                    headers: {
                        Authorization: localStorage.getItem('token')
                    }
                });
                if (!response.ok) {
                    throw new Error("Failed to fetch movies. Try again!");
                }
                
                const data = await response.json();
                
                await new Promise(resolve => setTimeout(resolve, 500));

                await data.forEach(async (movie) => {
                    await axios.get(URL+`/movies/${movie.imdbID}`, {
                        headers: {
                            Authorization: localStorage.getItem('token')
                        }
                    })
                    .then(response => {
                        this.movies.push(response.data.movie);
                        this.loading = false;
                    }).catch(error => {
                        console.error('There was an error!', error);
                    });
                });
            } catch (err) {
                this.error = "Error fetching movies. Try again!";
            } finally {
                this.loading = false;
            }
        },
        searchMovies() {
            if (this.searchQuery.trim() !== '') {
                this.$router.push({ path: '/search', query: { query: this.searchQuery } });
            }
        },
        startDrag(e) {
            this.isDragging = true;
            const container = this.$refs.container;
            this.startX = e.pageX - container.offsetLeft;
            this.scrollLeft = container.scrollLeft;
            this.clickPrevented = false;
        },
        onDrag(e) {
            if (!this.isDragging) return;
            e.preventDefault();
            const container = this.$refs.container;
            const x = e.pageX - container.offsetLeft;
            const walk = (x - this.startX) * 2; // scroll-fast
            container.scrollLeft = this.scrollLeft - walk;
            this.clickPrevented = true;
        },
        stopDrag() {
            this.isDragging = false;
        },
        handleClick(event) {
            if (this.clickPrevented) {
                event.preventDefault();
                this.clickPrevented = false;
            }
        }
    },
};
</script>

<style scoped>
.search-bar {
    margin: 20px;
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

.homeButton {
    margin: 20px;
    margin-bottom: 0;
    border: none;
    background-color: #333;
    padding: 10px 20px;
    border-radius: 5px;
    cursor: pointer;
    transition: background-color 0.3s ease;
}

.homeButton span {
    color: #fff;
    font-size: 1.2rem;
}

.homeButton:hover {
    background-color: #555;
}

.searchTitle {
    margin: 20px;
}

.movies {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: start;
    width: fit-content;
    max-width: 80%;
    margin: 0 auto;
    overflow-x: hidden;
}

.movie {
    flex: 0 0 200px;
    margin-left: 12px;
    margin-bottom: 6px;
    padding: 0;
    border: none;
    border-radius: 5px;
    text-align: center;
}

.movie:last-child {
    margin-right: 12px;
}

.movie > button {
    -moz-user-select: all;
    -webkit-user-select: all;
    user-select: all;
    pointer-events: auto;
    padding: 0;
    border: none;
    background: transparent;
}

.movie-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 5px;
    -moz-user-select: none;
    -webkit-user-select: none;
    user-select: none;
    pointer-events: none;
}

</style>