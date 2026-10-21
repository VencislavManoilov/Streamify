<template>
    <section class="row">
        <h2 class="row-title">{{ category.name }}</h2>
        <!-- Stays in the row instead of replacing it, so an open card doesn't close when the last movie goes -->
        <slot v-if="!category.movies.length" name="empty" />
        <div class="row-viewport" :class="{ 'more-left': canScrollLeft, 'more-right': canScrollRight }">
            <!-- Posters that leave the row (or come back to it) fold in and out instead of jumping -->
            <TransitionGroup
                ref="track"
                tag="div"
                name="poster"
                class="movies"
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
                @after-enter="updateEdges"
                @after-leave="updateEdges"
            >
                <div v-for="movie in category.movies" :key="movie.imdb_code" class="movie">
                    <button type="button" class="poster" :aria-label="posterLabel(movie)" @click="movieClick(movie, $event)">
                        <img :src="movie.medium_cover_image" :alt="movie.title" class="movie-image" loading="lazy" draggable="false" />
                        <span v-if="badge(movie)" class="badge" :class="badge(movie).tone" aria-hidden="true">{{ badge(movie).text }}</span>
                        <span v-if="movie.type === 'series' && movie.progress" class="episode-tag" aria-hidden="true">{{ episodeTag(movie) }}</span>
                        <span v-if="movie.progress" class="progress" aria-hidden="true">
                            <span class="progress-fill" :style="{ width: progressPercent(movie) + '%' }"></span>
                        </span>
                    </button>
                    <button
                        v-if="removeLabel"
                        type="button"
                        class="remove"
                        :aria-label="`${removeLabel}: ${movie.title}`"
                        :title="removeLabel"
                        @click="removeClick(movie, $event)"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
                    </button>
                </div>
            </TransitionGroup>

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

        <SeriesDetails v-if="selectedMovie && selectedMovie.type === 'series'" :series="selectedMovie" @close="selectedMovie = null" />
        <MovieDetails v-else-if="selectedMovie" :movie="selectedMovie" @close="selectedMovie = null" />
    </section>
</template>

<script>
import { episodeLabel } from '../playback';
import { freshness } from '../seriesData';
import MovieDetails from './MovieDetails.vue';
import SeriesDetails from './SeriesDetails.vue';

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
        category: Object,
        // Gives every poster a button that asks the page to take the movie out of the row
        removeLabel: {
            type: String,
            default: ''
        },
        // Marks the series in a row that has movies too
        showType: {
            type: Boolean,
            default: false
        },
        // For rows that are all new episodes anyway
        hideFresh: {
            type: Boolean,
            default: false
        }
    },
    emits: ['remove'],
    components: {
        MovieDetails,
        SeriesDetails
    },
    watch: {
        'category.movies'() {
            this.$nextTick(() => this.updateEdges());
        }
    },
    mounted() {
        this.resizeObserver = new ResizeObserver(() => this.updateEdges());
        this.resizeObserver.observe(this.trackElement());
        this.updateEdges();
    },
    methods: {
        // The scrolling row of posters (the element the transition group renders)
        trackElement() {
            return this.$refs.track ? this.$refs.track.$el : null;
        },
        startDrag(e) {
            // Cancel any ongoing inertia scrolling
            this.cancelInertia();

            this.isDragging = true;
            const container = this.trackElement();
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
            const container = this.trackElement();
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
            const container = this.trackElement();
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
        // A click that ends a drag of the row isn't meant for the poster under the pointer
        endsDrag(event) {
            const timeSinceDrag = Date.now() - this.lastDragTime;
            if (this.clickPrevented || timeSinceDrag < 300) {
                event.preventDefault();
                event.stopPropagation();
                this.clickPrevented = false;
                return true;
            }
            return false;
        },
        movieClick(movie, event) {
            if (this.endsDrag(event)) return;
            this.selectedMovie = movie;
        },
        removeClick(movie, event) {
            if (this.endsDrag(event)) return;
            this.$emit('remove', movie);
        },
        handleWheel(e) {
            const container = this.trackElement();
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
            const container = this.trackElement();
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
                const container = this.trackElement();
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
        // "New episode" on a series that aired one lately, "Series" in a row that also has movies
        badge(movie) {
            if (movie.type !== 'series') return null;
            const fresh = this.hideFresh ? '' : freshness(movie);
            if (fresh) return { text: fresh, tone: 'fresh' };
            return this.showType ? { text: 'Series', tone: 'plain' } : null;
        },
        episodeTag(movie) {
            return episodeLabel(movie.progress.season, movie.progress.episode);
        },
        posterLabel(movie) {
            const name = movie.type === 'series' ? `${movie.title} (series)` : movie.title;
            if (!movie.progress) return name;
            const where = movie.type === 'series' ? `, ${this.episodeTag(movie)}` : '';
            return `${name}${where}, ${Math.round(this.progressPercent(movie))}% watched`;
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
/* Lengths that can be animated, so the fades at the ends of a row grow in and out smoothly */
@property --fade-left {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
}

@property --fade-right {
    syntax: '<length>';
    inherits: false;
    initial-value: 0px;
}

.row {
    margin-bottom: 28px;
}

/* Above the dims at the ends of the rows, which reach a bit over and under their row */
.row-title {
    position: relative;
    z-index: 2;
    margin: 0 0 12px;
    padding: 0 var(--gutter);
    font-size: 1.3rem;
    font-weight: 700;
    font-stretch: 112%;
    letter-spacing: 0.005em;
}

.row-viewport {
    --fade: 150px;
    position: relative;
}

/* The posters fade out toward an end that has more posters behind it, instead of being cut off there */
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
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-left), #000 calc(100% - var(--fade-right)), transparent 100%);
    transition: --fade-left 0.35s ease, --fade-right 0.35s ease;

    /* Hardware acceleration for smoother scrolling */
    transform: translateZ(0);
    will-change: transform;
}

.more-left .movies {
    --fade-left: var(--fade);
}

.more-right .movies {
    --fade-right: var(--fade);
}

/* Hide scrollbar for Chrome, Safari and Opera */
.movies::-webkit-scrollbar {
    display: none;
}

.movies:active {
    cursor: grabbing;
}

.movie {
    position: relative;
    flex: 0 0 clamp(132px, 34vw, 200px);
    padding: 0;
}

.poster {
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

.poster:hover {
    filter: brightness(1.12);
}

.poster:focus-visible {
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

/* "New episode" on a series that aired one lately, or what kind of title it is in a mixed row */
.badge {
    position: absolute;
    top: 8px;
    left: 8px;
    padding: 3px 8px;
    border-radius: 7px;
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.35;
    pointer-events: none;
}

.badge.fresh {
    background: var(--accent);
    color: #1a1406;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.badge.plain {
    background: rgba(8, 9, 16, 0.72);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: var(--text);
}

/* The episode of a series in the history, just above its progress */
.episode-tag {
    position: absolute;
    left: 8px;
    bottom: 18px;
    padding: 2px 8px;
    border-radius: 7px;
    background: rgba(8, 9, 16, 0.74);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
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

/* Shows up on the poster under the pointer; always there on touch screens, which have no hover */
.remove {
    position: absolute;
    top: 8px;
    right: 8px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 50%;
    background: rgba(8, 9, 16, 0.62);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: #fff;
    cursor: pointer;
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease;
}

.movie:hover .remove,
.remove:focus-visible {
    opacity: 1;
    transform: none;
}

.remove:hover {
    background: rgba(225, 29, 72, 0.92);
    border-color: transparent;
}

.remove:active {
    transform: scale(0.92);
}

.remove svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
}

@media (hover: none) {
    .remove {
        opacity: 1;
        transform: none;
    }
}

/* A poster that leaves folds away and the ones after it slide over; one that comes back unfolds */
.poster-enter-active,
.poster-leave-active {
    transition: flex-basis 0.4s cubic-bezier(0.4, 0, 0.2, 1), margin-right 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, transform 0.4s ease;
}

.poster-enter-from,
.poster-leave-to {
    flex-basis: 0;
    margin-right: -12px;
    opacity: 0;
    transform: scale(0.85);
}

/* A soft dim behind the arrow at an end with more posters. It reaches over and under the row and fades
   out in every direction, so it never shows an edge of its own. */
.edge {
    position: absolute;
    top: -56px;
    bottom: -56px;
    width: 230px;
    display: flex;
    align-items: center;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.35s ease, visibility 0s linear 0.35s;
}

.edge.visible {
    opacity: 1;
    visibility: visible;
    transition: opacity 0.35s ease;
}

.edge.left {
    left: 0;
    justify-content: flex-start;
    padding-left: 16px;
    background: radial-gradient(farthest-side at 0% 50%, rgba(4, 5, 11, 0.7) 0%, rgba(4, 5, 11, 0.45) 35%, rgba(4, 5, 11, 0.16) 68%, rgba(4, 5, 11, 0) 100%);
}

.edge.right {
    right: 0;
    justify-content: flex-end;
    padding-right: 16px;
    background: radial-gradient(farthest-side at 100% 50%, rgba(4, 5, 11, 0.7) 0%, rgba(4, 5, 11, 0.45) 35%, rgba(4, 5, 11, 0.16) 68%, rgba(4, 5, 11, 0) 100%);
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

    .row-viewport {
        --fade: 64px;
    }

    .edge {
        top: -32px;
        bottom: -32px;
        width: 96px;
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

@media (prefers-reduced-motion: reduce) {
    .poster-enter-active,
    .poster-leave-active {
        transition: opacity 0.2s ease;
    }

    .poster-enter-from,
    .poster-leave-to {
        flex-basis: clamp(132px, 34vw, 200px);
        margin-right: 0;
        transform: none;
    }
}
</style>
