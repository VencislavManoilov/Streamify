<template>
    <div class="container" @click.self="close">
        <article class="movie-details" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" ref="card">
            <button class="closeButton" ref="closeButton" type="button" aria-label="Close" @click="close">
                <svg class="closeSvg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>

            <div class="scroll">
                <div class="hero" :style="{ backgroundImage: movie.background_image ? `url(${movie.background_image})` : 'none' }">
                    <div class="headline">
                        <h1 class="title" :id="titleId">{{ movie.title }}</h1>
                        <p v-if="details && details.tagline" class="tagline">{{ details.tagline }}</p>
                    </div>
                </div>

                <div class="content">
                    <div class="intro">
                        <div class="actions">
                            <router-link :to="'/movie/' + movie.imdb_code" class="play-button">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                                <span>Play</span>
                            </router-link>
                            <!-- Kept together, so on narrow screens they wrap below Play as a pair -->
                            <div class="more-actions">
                                <WatchlistButton :movie="movie" />
                                <a :href="'https://www.imdb.com/title/' + movie.imdb_code" target="_blank" rel="noopener noreferrer" class="imdb-button" aria-label="Open on IMDb">
                                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb">
                                </a>
                                <a v-if="trailerUrl" :href="trailerUrl" target="_blank" rel="noopener noreferrer" class="trailer-button" aria-label="Watch the trailer" title="Watch the trailer on YouTube">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8.8v6.4l5.2-3.2z" /><circle cx="12" cy="12" r="8.6" /></svg>
                                    <span>Trailer</span>
                                </a>
                            </div>
                        </div>

                        <p class="facts">
                            <span class="rating">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                                {{ movie.rating }} / 10
                            </span>
                            <span v-if="movie.year">{{ movie.year }}</span>
                            <span v-if="runtime">{{ runtime }}</span>
                            <span v-if="details && details.certification" class="certification" :title="`Rated ${details.certification}`">{{ details.certification }}</span>
                        </p>
                        <p v-if="genres" class="genres">{{ genres }}</p>
                    </div>

                    <img :src="movie.medium_cover_image" alt="" class="cover" />

                    <p class="summary">{{ movie.summary || 'No description available.' }}</p>

                    <MovieExtras class="more" :details="details" :loading="detailsLoading" variant="card" />
                </div>
            </div>
        </article>
    </div>
</template>

<script>
import { movieDetails, formatRuntime } from '../movieDetails';
import MovieExtras from './MovieExtras.vue';
import WatchlistButton from './WatchlistButton.vue';

let instances = 0;

export default {
    name: 'MovieDetails',
    components: {
        MovieExtras,
        WatchlistButton
    },
    props: {
        movie: {
            type: Object,
            required: true
        }
    },
    emits: ['close'],
    data() {
        instances += 1;
        return {
            titleId: `movie-details-title-${instances}`,
            details: null,
            detailsLoading: true
        };
    },
    computed: {
        runtime() {
            return formatRuntime(this.movie.runtime);
        },
        genres() {
            return (this.movie.genres || []).join(', ');
        },
        trailerUrl() {
            const trailer = this.details && this.details.trailer;
            return trailer ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}` : '';
        }
    },
    created() {
        // The card works without them, so a failed lookup only leaves the extra section out
        movieDetails.load(this.movie.imdb_code).then((details) => {
            this.details = details;
        }).catch(() => {}).finally(() => {
            this.detailsLoading = false;
        });
    },
    mounted() {
        // Keep the page behind the card from scrolling
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        this.previousFocus = document.activeElement;
        this.$refs.closeButton.focus({ preventScroll: true });

        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        window.addEventListener('keydown', this.keyHandler);
    },
    beforeUnmount() {
        document.body.style.overflow = this.previousOverflow;
        window.removeEventListener('keydown', this.keyHandler);
        if (this.previousFocus && this.previousFocus.focus) {
            this.previousFocus.focus({ preventScroll: true });
        }
    },
    methods: {
        close() {
            this.$emit('close');
        }
    }
}
</script>

<style scoped>
.container {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background-color: rgba(3, 4, 9, 0.66);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    z-index: 1000;
}

.movie-details {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 800px;
    max-height: min(780px, calc(100dvh - 48px));
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--line);
    border-radius: 20px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    outline: none;
    animation: card-in 0.22s ease-out;
}

/* Everything below the close button scrolls, so nothing ever spills out of the card */
.scroll {
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.22) transparent;
}

.hero {
    position: relative;
    display: flex;
    align-items: flex-end;
    min-height: 260px;
    padding: 64px 24px 24px;
    box-sizing: border-box;
    background-color: #0b0c15;
    background-size: cover;
    background-position: center 30%;
}

/* Keeps the title readable on bright backdrops and blends the image into the card */
.hero::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, var(--bg-elevated) 0%, rgba(16, 18, 29, 0.55) 45%, rgba(16, 18, 29, 0) 75%);
}

.headline {
    position: relative;
    z-index: 1;
    padding-right: 204px;
}

.title {
    margin: 0;
    font-size: clamp(1.9rem, 4.2vw, 2.8rem);
    font-weight: 800;
    font-stretch: 115%;
    line-height: 1.05;
    letter-spacing: -0.01em;
    text-shadow: 0 2px 18px rgba(0, 0, 0, 0.6);
}

.tagline {
    margin: 8px 0 0;
    color: rgba(236, 238, 246, 0.82);
    font-size: 1.05rem;
    font-style: italic;
    text-shadow: 0 1px 12px rgba(0, 0, 0, 0.7);
    animation: fade-in 0.4s ease;
}

.content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: 24px;
    padding: 0 24px 28px;
}

.intro {
    grid-column: 1;
    grid-row: 1;
    padding-top: 4px;
}

.cover {
    position: relative;
    z-index: 1;
    grid-column: 2;
    grid-row: 1;
    width: 180px;
    aspect-ratio: 2 / 3;
    margin-top: -170px;
    object-fit: cover;
    border-radius: 10px;
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}

.closeButton {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 2;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background-color: rgba(8, 9, 16, 0.55);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: var(--text);
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.closeButton:hover {
    background-color: rgba(255, 255, 255, 0.18);
}

.closeSvg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
}

.actions {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 4px 0 20px;
}

.more-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
}

.play-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 26px 0 20px;
    border-radius: 12px;
    background-color: #f2f2f4;
    color: #0b0b10;
    font-size: 1.1rem;
    font-weight: 700;
    transition: background-color 0.2s ease, transform 0.2s ease;
}

.play-button:hover {
    background-color: #ffffff;
}

.play-button:active {
    transform: scale(0.97);
}

.play-button svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
}

.imdb-button {
    display: flex;
    align-items: center;
    height: 48px;
    padding: 0 14px;
    box-sizing: border-box;
    border-radius: 12px;
    background-color: #f5c518;
    transition: filter 0.2s ease;
}

.imdb-button:hover {
    filter: brightness(0.9);
}

.imdb-button img {
    height: 24px;
    width: auto;
}

.trailer-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 48px;
    padding: 0 18px 0 14px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.trailer-button:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.36);
}

.trailer-button svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
}

.trailer-button svg path {
    fill: currentColor;
    stroke: none;
}

.facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 18px;
    margin: 0 0 8px;
    color: var(--text-muted);
    font-size: 1.05rem;
}

.rating {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-weight: 600;
}

.rating svg {
    width: 20px;
    height: 20px;
    fill: var(--accent);
}

/* The age rating, outlined like on a poster */
.certification {
    padding: 1px 7px;
    border: 1px solid rgba(255, 255, 255, 0.32);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.85rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    line-height: 1.5;
}

.genres {
    margin: 0;
    color: var(--text-muted);
    font-size: 1.05rem;
}

.summary {
    grid-column: 1 / -1;
    grid-row: 2;
    max-width: 68ch;
    margin: 20px 0 0;
    color: #cdd0dc;
    font-size: 1.02rem;
    line-height: 1.65;
}

.more {
    grid-column: 1 / -1;
    grid-row: 3;
    margin-top: 26px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
}

@keyframes card-in {
    from {
        opacity: 0;
        transform: translateY(14px) scale(0.985);
    }
}

@keyframes fade-in {
    from {
        opacity: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .movie-details,
    .tagline {
        animation: none;
    }
}

@media (max-width: 640px) {
    .container {
        padding: 0;
    }

    .movie-details {
        max-height: 100dvh;
        height: 100%;
        border-radius: 0;
        border: none;
    }

    .hero {
        min-height: 220px;
        padding: 72px 16px 16px;
    }

    .headline {
        padding-right: 0;
    }

    .title {
        font-size: 1.8rem;
    }

    .content {
        column-gap: 16px;
        padding: 0 16px 24px;
    }

    .cover {
        width: 104px;
        margin-top: 0;
        align-self: start;
    }

    .actions {
        flex-wrap: wrap;
    }

    .play-button {
        flex: 1;
        justify-content: center;
    }

    /* Just the icon, so the buttons fit next to the poster */
    .trailer-button {
        width: 48px;
        padding: 0;
        justify-content: center;
    }

    .trailer-button span {
        display: none;
    }
}
</style>
