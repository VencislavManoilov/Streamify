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

<style scoped src="./detailsCard.css"></style>
