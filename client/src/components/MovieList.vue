<template>
    <section class="row">
        <h2 class="row-title">{{ category.name }}</h2>
        <div class="row-viewport">
            <div class="movies"
                ref="track"
                @mousedown="startDrag($event)"
                @mousemove="onDrag($event)"
                @mouseup="stopDrag"
                @mouseleave="stopDrag"
                @touchstart.passive="startDrag($event)"
                @touchmove.passive="onDrag($event)"
                @touchend="stopDrag"
                @touchcancel="stopDrag"
                @wheel="handleWheel"
                @scroll.passive="updateEdges"
            >
                <div v-for="movie in category.movies" :key="movie.imdb_code" class="movie">
                    <button type="button" :aria-label="posterLabel(movie)" @click="movieClick(movie, $event)">
                        <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" loading="lazy" draggable="false" />
                        <span v-if="movie.progress" class="progress" aria-hidden="true">
                            <span class="progress-fill" :style="{ width: progressPercent(movie) + '%' }"></span>
                        </span>
                    </button>
                </div>
            </div>

            <div class="edge left" :class="{ visible: canScrollLeft }">
                <button type="button" class="edge-arrow" aria-label="Scroll left" @click="scrollStep(-1)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5L8 12l6.5 6.5" /></svg>
                </button>
            </div>
            <div class="edge right" :class="{ visible: canScrollRight }">
                <button type="button" class="edge-arrow" aria-label="Scroll right" @click="scrollStep(1)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" /></svg>
                </button>
            </div>
        </div>

        <MovieDetails v-if="selectedMovie" :movie="selectedMovie" @close="selectedMovie = null" />
    </section>
</template>

<script>
import MovieDetails from './MovieDetails.vue';

const POSTER_GAP = 12;

export default {
    name: 'MovieList',
    data() {
        return {
            isDragging: false,
            startX: 0,
            scrollLeft: 0,
            clickPrevented: false,
            selectedMovie: null,
            lastDragTime: 0,
            // Inertia scrolling
            scrollAnimationId: null,
            lastScrollLeft: 0,
            scrollVelocity: 0,
            lastTimestamp: 0,
            // Which edges have more posters behind them
            canScrollLeft: false,
            canScrollRight: false
        };
    },
    props: {
        category: Object
    },
    components: {
        MovieDetails
    },
    watch: {
        'category.movies'() {
            this.$nextTick(() => this.updateEdges());
        }
    },
    mounted() {
        this.resizeObserver = new ResizeObserver(() => this.updateEdges());
        this.resizeObserver.observe(this.$refs.track);
        this.updateEdges();
    },
    methods: {
        startDrag(e) {
            // Cancel any ongoing inertia scrolling
            this.cancelInertia();

            this.isDragging = true;
            const container = this.$refs.track;
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
            const container = this.$refs.track;
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
            const container = this.$refs.track;
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
        cancelInertia() {
            if (this.scrollAnimationId) {
                cancelAnimationFrame(this.scrollAnimationId);
                this.scrollAnimationId = null;
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
            const container = this.$refs.track;
            if (!container) return;

            // Cancel any ongoing inertia scrolling on manual wheel input
            this.cancelInertia();

            // Only handle horizontal scrolling or vertical when shift is pressed
            if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
                e.preventDefault();
                container.scrollLeft += e.deltaX || (e.shiftKey ? e.deltaY : 0);
                this.lastDragTime = Date.now();
            }
            // Let vertical scrolling pass through to the page normally
        },
        // Moves the row by about three posters (less on small screens)
        scrollStep(direction) {
            const container = this.$refs.track;
            if (!container) return;
            this.cancelInertia();

            const poster = container.querySelector('.movie');
            const posterStep = poster ? poster.getBoundingClientRect().width + POSTER_GAP : 212;
            const distance = Math.min(posterStep * 3, container.clientWidth * 0.75);
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            container.scrollBy({ left: direction * distance, behavior: reduceMotion ? 'auto' : 'smooth' });
        },
        updateEdges() {
            if (this.edgeFrame) return;
            this.edgeFrame = requestAnimationFrame(() => {
                this.edgeFrame = null;
                const container = this.$refs.track;
                if (!container) return;
                const maxScroll = container.scrollWidth - container.clientWidth;
                this.canScrollLeft = container.scrollLeft > 2;
                this.canScrollRight = container.scrollLeft < maxScroll - 2;
            });
        },
        progressPercent(movie) {
            const { position, duration, completed } = movie.progress;
            if (!duration) return 0;
            if (completed && position >= duration * 0.95) return 100;
            return Math.min(100, Math.max(3, (position / duration) * 100));
        },
        posterLabel(movie) {
            if (!movie.progress) return movie.title;
            return `${movie.title}, ${Math.round(this.progressPercent(movie))}% watched`;
        }
    },
    // Ensure we clean up any animations when component is destroyed
    beforeUnmount() {
        this.cancelInertia();
        if (this.edgeFrame) cancelAnimationFrame(this.edgeFrame);
        if (this.resizeObserver) this.resizeObserver.disconnect();
    }
}
</script>

<style scoped>
.row {
    margin-bottom: 28px;
}

.row-title {
    margin: 0 0 12px;
    padding: 0 var(--gutter);
    font-size: 1.3rem;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.005em;
}

.row-viewport {
    position: relative;
}

.movies {
    display: flex;
    flex-direction: row;
    gap: 12px;
    width: 100%;
    box-sizing: border-box;
    padding: 0 var(--gutter);
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
    flex: 0 0 clamp(132px, 34vw, 200px);
    padding: 0;
}

.movie > button {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 2 / 3;
    padding: 0;
    border: none;
    border-radius: 8px;
    overflow: hidden;
    background: var(--surface);
    cursor: pointer;
    -moz-user-select: none;
    -webkit-user-select: none;
    user-select: none;
    transition: filter 0.2s ease;
}

.movie > button:hover {
    filter: brightness(1.12);
}

.movie > button:focus-visible {
    outline-offset: -2px;
    outline-width: 3px;
}

.movie-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    -moz-user-select: none;
    -webkit-user-select: none;
    user-select: none;
    pointer-events: none;
}

/* How far a movie from the history has been watched */
.progress {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.3);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    overflow: hidden;
}

.progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
}

/* Dark fades over the ends of the row with an arrow, shown only when there are more posters that way */
.edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 168px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.25s ease, visibility 0s linear 0.25s;
}

.edge.visible {
    opacity: 1;
    visibility: visible;
    transition: opacity 0.25s ease;
}

.edge.left {
    left: 0;
    justify-content: flex-start;
    padding-left: 16px;
    background: linear-gradient(to right, rgba(5, 6, 11, 0.97) 0%, rgba(5, 6, 11, 0.86) 30%, rgba(5, 6, 11, 0.45) 65%, rgba(5, 6, 11, 0) 100%);
}

.edge.right {
    right: 0;
    justify-content: flex-end;
    padding-right: 16px;
    background: linear-gradient(to left, rgba(5, 6, 11, 0.97) 0%, rgba(5, 6, 11, 0.86) 30%, rgba(5, 6, 11, 0.45) 65%, rgba(5, 6, 11, 0) 100%);
}

.edge-arrow {
    pointer-events: auto;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 50%;
    background: rgba(14, 15, 26, 0.6);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: var(--text);
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
}

.edge-arrow:hover {
    background: rgba(255, 255, 255, 0.18);
    border-color: rgba(255, 255, 255, 0.3);
    transform: scale(1.06);
}

.edge-arrow:active {
    transform: scale(0.96);
}

.edge-arrow svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

@media (max-width: 640px) {
    .row-title {
        font-size: 1.15rem;
    }

    .edge {
        width: 76px;
    }

    .edge.left {
        padding-left: 6px;
    }

    .edge.right {
        padding-right: 6px;
    }

    .edge-arrow {
        width: 36px;
        height: 36px;
    }
}
</style>
