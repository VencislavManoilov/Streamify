<template>
    <div class="home">
        <!-- Search input and button -->
        <div class="search-bar">
            <input v-model="searchQuery" type="text" ref="searchInput" placeholder="Search for movies..." @keyup.enter="searchMovies" />
            <button @click="searchMovies">Search</button>
        </div>
        <div class="category" v-for="category in categories" :key="category.name">
            <MovieList :category="category" />
        </div>
    </div>
</template>

<script>
import axios from 'axios';
import MovieList from './MovieList.vue';

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
        MovieList
    },
    async mounted() {
        this.keyHandler = (e) => {
          if (e.key === '/' && document.activeElement !== this.$refs.searchInput) {
            e.preventDefault();
            this.$refs.searchInput.focus();
          }
        };
        window.addEventListener('keydown', this.keyHandler);

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
    beforeUnmount() {
        window.removeEventListener('keydown', this.keyHandler);
    },
    methods: {
        searchMovies() {
            if (this.searchQuery.trim() !== '') {
                this.$router.push({ path: '/search', query: { query: this.searchQuery } });
            }
        },
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
</style>
