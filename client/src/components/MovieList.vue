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
            lastDragTime: 0,
            // New properties for inertia scrolling
            scrollAnimationId: null,
            lastScrollLeft: 0,
            scrollVelocity: 0,
            lastTimestamp: 0
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
            // Cancel any ongoing inertia scrolling
            if (this.scrollAnimationId) {
                cancelAnimationFrame(this.scrollAnimationId);
                this.scrollAnimationId = null;
            }
            
            this.isDragging = true; 
            const container = this.$refs[this.category.name];
            if (!container) return;
            const pageX = e.touches ? e.touches[0].pageX : e.pageX;
            this.startX = pageX - container.offsetLeft;
            this.scrollLeft = container.scrollLeft;
            this.clickPrevented = false;
            
            // Initialize for velocity tracking
            this.lastScrollLeft = container.scrollLeft;
            this.lastTimestamp = Date.now();
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
            
            // Track scrolling velocity
            const now = Date.now();
            const elapsed = now - this.lastTimestamp;
            
            if (elapsed > 0) {
                // Calculate pixels per millisecond
                this.scrollVelocity = (container.scrollLeft - this.lastScrollLeft) / elapsed;
                this.lastScrollLeft = container.scrollLeft;
                this.lastTimestamp = now;
            }
            
            if (Math.abs(walk) > 5) {
                this.clickPrevented = true;
                this.lastDragTime = now;
            }
        },
        stopDrag() {
            if (!this.isDragging) return;
            this.isDragging = false;
            
            // Start inertia scrolling if there's significant velocity
            if (Math.abs(this.scrollVelocity) > 0.1) {
                this.startInertiaScroll();
            }
        },
        startInertiaScroll() {
            const container = this.$refs[this.category.name];
            if (!container) return;
            
            // Initial velocity from drag (pixels per ms)
            let velocity = this.scrollVelocity * 15; // Amplify for better feel
            const friction = 0.95; // Friction factor (0-1), higher = less friction
            const minVelocity = 0.1; // Minimum velocity to continue animation
            
            const animate = () => {
                if (Math.abs(velocity) < minVelocity) {
                    this.scrollAnimationId = null;
                    return;
                }
                
                // Apply friction to slow down
                velocity *= friction;
                
                // Apply scrolling
                container.scrollLeft += velocity;
                
                // Continue animation
                this.scrollAnimationId = requestAnimationFrame(animate);
                
                // Update last drag time to prevent accidental clicks
                this.lastDragTime = Date.now();
            };
            
            // Start animation
            this.scrollAnimationId = requestAnimationFrame(animate);
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
            
            // Cancel any ongoing inertia scrolling on manual wheel input
            if (this.scrollAnimationId) {
                cancelAnimationFrame(this.scrollAnimationId);
                this.scrollAnimationId = null;
            }
            
            // Only handle horizontal scrolling or vertical when shift is pressed
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
                e.preventDefault();
                container.scrollLeft += e.deltaX || (e.shiftKey ? e.deltaY : 0);
                this.lastDragTime = Date.now();
            }
            // Let vertical scrolling pass through to the page normally
        }
    },
    // Ensure we clean up any animations when component is destroyed
    beforeUnmount() {
        if (this.scrollAnimationId) {
            cancelAnimationFrame(this.scrollAnimationId);
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