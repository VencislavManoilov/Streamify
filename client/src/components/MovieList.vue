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
        @wheel="handleWheel"
    >
        <div v-for="movie in category.movies" :key="movie.title" class="movie">
            <button @click="movieClick(movie, $event)">
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
            selectedMovie: null,
            lastDragTime: 0
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
            // Prevent default for mouse events but not touch events
            if (!e.touches) {
                e.preventDefault();
            }
            const container = this.$refs[this.category.name];
            if (!container) return;
            const pageX = e.touches ? e.touches[0].pageX : e.pageX;
            const x = pageX - container.offsetLeft;
            const walk = x - this.startX;
            container.scrollLeft = this.scrollLeft - walk;
            
            if (Math.abs(walk) > 5) {
                this.clickPrevented = true;
                this.lastDragTime = Date.now();
            }
        },
        stopDrag() {
            this.isDragging = false;
        },
        handleClick(event) {
            if (this.clickPrevented) {
                event.preventDefault();
                this.clickPrevented = false;
            }
        },
        movieClick(movie, event) {
            // Prevent selecting a movie if we recently stopped dragging
            const timeSinceDrag = Date.now() - this.lastDragTime;
            if (this.clickPrevented || timeSinceDrag < 300) {
                event.preventDefault();
                event.stopPropagation();
                this.clickPrevented = false;
                return;
            }
            
            this.selectedMovie = movie;
        },
        handleWheel(e) {
            const container = this.$refs[this.category.name];
            if (!container) return;
            
            // Only handle horizontal scrolling or vertical when shift is pressed
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
                e.preventDefault();
                container.scrollLeft += e.deltaX || (e.shiftKey ? e.deltaY : 0);
                this.lastDragTime = Date.now();
            }
            // Let vertical scrolling pass through to the page normally
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
    overflow-x: scroll;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE and Edge */
    -webkit-overflow-scrolling: touch;
    cursor: grab;
    
    /* Hardware acceleration for smoother scrolling */
    transform: translateZ(0);
    will-change: transform;
}

/* Hide scrollbar for Chrome, Safari and Opera */
.movies::-webkit-scrollbar {
    display: none;
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