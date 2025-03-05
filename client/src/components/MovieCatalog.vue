<template>
    <div class="home">
        <!-- Search input and button -->
        <div class="search-bar">
            <input v-model="searchQuery" type="text" placeholder="Search for movies..." />
            <button @click="searchMovies">Search</button>
        </div>
        <div class="category" v-for="category in categories" :key="category.name">
            <h2>{{ category.name }}</h2>
            <div class="movies">
                <div v-for="movie in category.movies" :key="movie.title" class="movie">
                    <router-link :to="'/movie/' + movie.imdb_code">
                        <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" />
                        <h3>{{ movie.title }}</h3>
                        <p>Rating: {{ movie.rating }}</p>
                        <p>Genres: {{ movie.genres.join(', ') }}</p>
                    </router-link>
                </div>
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
            categories: [],
            searchQuery: ''
        };
    },
    async mounted() {
        await axios.get(URL+"/categories", {
            headers: {
                Authorization: localStorage.getItem('token')
            }
        })
        .then(async (response) => {
            let movieIds = response.data.categories;
            let newCategories = [];
            for(const category of movieIds) {
                let newCategory = { name: category.name, movies: [] };
                for(const movie of category.movies) {
                    await axios.get(URL+`/movies/${movie}`, {
                        headers: {
                            Authorization: localStorage.getItem('token')
                        }
                    })
                    .then(response => {
                        newCategory.movies.push(response.data.movie);
                    }).catch(error => {
                        console.error('There was an error!', error);
                    });
                }
                newCategories.push(newCategory);
            }

            this.categories = newCategories;
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

.category {
    margin-bottom: 20px;
    display: flex;
    flex-direction: column;
    width: 100%;
}

.movies {
    display: flex;
    flex-direction: row;
    width: 100%;
    overflow-x: auto;
    gap: 10px;
}
.movie {
    flex: 0 0 200px;
    margin: 10px;
    padding: 10px;
    border: 1px solid #ccc;
    border-radius: 5px;
    text-align: center;
}

.movie-image {
    width: 100%;
    height: auto;
    border-radius: 5px;
}
</style>