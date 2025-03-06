<template>
    <div class="home">
        <!-- Search input and button -->
        <div class="search-bar">
            <input v-model="searchQuery" type="text" placeholder="Search for movies..." @keyup.enter="searchMovies" />
            <button @click="searchMovies">Search</button>
        </div>
        <div class="category" v-for="category in categories" :key="category.name">
            <h1>{{ category.name }}</h1>
            <div class="movies" 
                 :ref="'moviesContainer' + category.name" 
                 @mousedown="startDrag($event, category.name)" 
                 @mousemove="onDrag($event, category.name)" 
                 @mouseup="stopDrag" 
                 @mouseleave="stopDrag">
                <div v-for="movie in category.movies" :key="movie.title" class="movie" @click="handleClick">
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
    name: 'MovieCatalog',
    data() {
        return {
            categories: [],
            searchQuery: '',
            isDragging: false,
            startX: 0,
            scrollLeft: 0,
            currentCategory: null,
            clickPrevented: false,
            selectedMovie: null
        };
    },
    components: {
        MovieDetails
    },
    async mounted() {
        await axios.get(URL+"/categories", {
            headers: {
                Authorization: localStorage.getItem('token')
            }
        })
        .then(async (response) => {
            this.categories = response.data;
        }).catch(error => {
            console.error('There was an error!', error);
        });
    },
    methods: {
        searchMovies() {
            if (this.searchQuery.trim() !== '') {
                this.$router.push({ path: '/search', query: { query: this.searchQuery } });
            }
        },
        startDrag(e, categoryName) {
            this.isDragging = true;
            this.currentCategory = categoryName;
            const container = this.$refs['moviesContainer' + categoryName][0];
            this.startX = e.pageX - container.offsetLeft;
            this.scrollLeft = container.scrollLeft;
            this.clickPrevented = false;
        },
        onDrag(e, categoryName) {
            if (!this.isDragging || this.currentCategory !== categoryName) return;
            e.preventDefault();
            const container = this.$refs['moviesContainer' + categoryName][0];
            const x = e.pageX - container.offsetLeft;
            const walk = (x - this.startX) * 2; // scroll-fast
            container.scrollLeft = this.scrollLeft - walk;
            this.clickPrevented = true;
        },
        stopDrag() {
            this.isDragging = false;
            this.currentCategory = null;
        },
        handleClick(event) {
            if (this.clickPrevented) {
                event.preventDefault();
                this.clickPrevented = false;
            }
        }
    }
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

.category {
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    width: 100%;
}

.category > h1 {
    margin-left: 12px;
    margin-bottom: 6px;
    margin-top: 0;
}

.movies {
    display: flex;
    flex-direction: row;
    width: 100%;
    overflow-x: hidden;
}

.movies:active {
    cursor: grabbing;
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