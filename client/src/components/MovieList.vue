<template>
    <h1>{{ category.name }}</h1>
    <div class="movies"
        :ref="category.name" 
        @mousedown="startDrag($event)" 
        @mousemove="onDrag($event)" 
        @mouseup="stopDrag" 
        @mouseleave="stopDrag"
        @touchstart="startDrag($event)"
        @touchmove="onDrag($event)"
        @touchend="stopDrag"
        @touchcancel="stopDrag"
    >
        <div v-for="movie in category.movies" :key="movie.title" class="movie" @click="handleClick">
            <button v-on:click="selectedMovie = movie">
                <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" />
            </button>
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
</template>

<script>
import MovieDetails from './MovieDetails.vue';

export default {
    data() {
        return {
            searchQuery: '',
            isDragging: false,
            startX: 0,
            scrollLeft: 0,
            clickPrevented: false,
            selectedMovie: null
        };
    },
    props: {
        category: Object
    },
    components: {
        MovieDetails
    },
    methods: {
        startDrag(e) {
            this.isDragging = true; 
            const container = this.$refs[this.category.name];
            if (!container) return;
            const pageX = e.touches ? e.touches[0].pageX : e.pageX;
            this.startX = pageX - container.offsetLeft;
            this.scrollLeft = container.scrollLeft;
            this.clickPrevented = false;
        },
        onDrag(e) {
            if (!this.isDragging) return;
            e.preventDefault();
            const container = this.$refs[this.category.name];
            if (!container) return;
            const pageX = e.touches ? e.touches[0].pageX : e.pageX;
            const x = pageX - container.offsetLeft;
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
    }
}
</script>

<style scoped>
h1 {
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