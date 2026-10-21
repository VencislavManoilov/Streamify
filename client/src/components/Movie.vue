<template>
    <div class="movie">
        <AppHeader back search />

        <LoadingSpinner v-if="!movie && !pageError" overlay label="Loading the movie" />
        <p v-else-if="pageError" class="page-message">{{ pageError }}</p>

        <div class="movie-details" v-if="movie">
            <div class="title-row">
                <h1 class="title">{{ movie.title }}</h1>
                <!-- Blurred after a click, so Space keeps pausing the movie instead of pressing it again -->
                <WatchlistButton :movie="movie" @click="$event.currentTarget.blur()" />
            </div>

            <div class="torrents" v-if="showTorrents && movie.torrents && movie.torrents.length">
                <button
                    v-for="torrent in movie.torrents"
                    :key="torrent.hash"
                    type="button"
                    :class="{ selectedTorrent: torrent.hash === selectedTorrent }"
                    @click="chooseTorrent(torrent.hash, $event)"
                >{{ torrent.type }} {{ torrent.quality }} {{ torrent.video_codec }}</button>
            </div>

            <VideoPlayer
                ref="player"
                :src="videoSrc"
                :content-key="movie.imdb_code"
                :poster="movie.background_image"
                :resume-at="resumeAt"
                :ready="!!selectedTorrent && !showTorrents"
                :subtitles="subtitles"
                :subtitle-key="movie.imdb_code"
                :blocked="showResetDialog"
                :save-progress="saveProgress"
                fail-message="The video couldn't be loaded. Try again or select another quality."
                @started="started = true"
                @failed="showTorrents = true"
            >
                <template #waiting>
                    <p v-if="showTorrents" class="overlay-message">Select a quality above to start watching</p>
                </template>
            </VideoPlayer>

            <section class="about">
                <div class="facts-row">
                    <p class="facts">
                        <span class="rating">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                            {{ movie.rating }} / 10
                        </span>
                        <span v-if="movie.year">{{ movie.year }}</span>
                        <span v-if="runtime">{{ runtime }}</span>
                        <span v-if="details && details.certification" class="certification" :title="`Rated ${details.certification}`">{{ details.certification }}</span>
                        <span v-if="genres" class="genres">{{ genres }}</span>
                    </p>
                    <div class="links">
                        <a v-if="trailerUrl" :href="trailerUrl" target="_blank" rel="noopener noreferrer" class="trailer-button" title="Watch the trailer on YouTube">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8.8v6.4l5.2-3.2z" /><circle cx="12" cy="12" r="8.6" /></svg>
                            <span>Trailer</span>
                        </a>
                        <a :href="'https://www.imdb.com/title/' + movie.imdb_code" target="_blank" rel="noopener noreferrer" class="imdb-button" aria-label="Open on IMDb">
                            <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb">
                        </a>
                    </div>
                </div>

                <p v-if="details && details.tagline" class="tagline">{{ details.tagline }}</p>

                <div class="summary">
                    <h2>Summary</h2>
                    <p>{{ movie.summary || "No summary available" }}</p>
                </div>

                <MovieExtras class="extras" :details="details" :loading="detailsLoading" variant="page" />
            </section>

            <div class="reset-row">
                <button class="reset-button" type="button" @click="showResetDialog = true">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></svg>
                    Reset movie
                </button>
                <p class="reset-hint">Video not loading or a quality missing? Resetting looks for the latest torrents.</p>
            </div>
        </div>

        <ResetMovieDialog v-if="showResetDialog" :movie="movie" @close="showResetDialog = false" @reset="onReset" />
    </div>
</template>

<script>
import api from '../api';
import { API_URL } from '../config';
import { movieDetails, formatRuntime } from '../movieDetails';
import { session } from '../session';
import { watchHistory } from '../watchHistory';
import { watchlist } from '../watchlist';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieExtras from './MovieExtras.vue';
import ResetMovieDialog from './ResetMovieDialog.vue';
import VideoPlayer from './VideoPlayer.vue';
import WatchlistButton from './WatchlistButton.vue';

// Shorter starts aren't worth resuming
const MIN_RESUME_SECONDS = 30;
// Past this point the credits are rolling, so the next time starts from the beginning
const FINISHED_RATIO = 0.95;

function bestTorrent(torrents) {
    return torrents.find(torrent => torrent.quality == '1080p' && torrent.video_codec == 'x264') || torrents.find(torrent => torrent.quality == "1080p") || torrents[0];
}

export default {
    name: 'MoviePage',
    components: {
        AppHeader,
        LoadingSpinner,
        MovieExtras,
        ResetMovieDialog,
        VideoPlayer,
        WatchlistButton
    },
    data() {
        return {
            movie: null,
            pageError: null,
            selectedTorrent: null,
            // Set once the viewer pressed play
            started: false,
            showTorrents: false,
            savedProgress: null,
            resumeAt: 0,
            // Cast, crew and the rest from TMDB
            details: null,
            detailsLoading: true,
            showResetDialog: false
        };
    },
    computed: {
        videoSrc() {
            return this.movie && this.selectedTorrent ? `${API_URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
        },
        // English subtitles come from the torrent itself when it has them
        subtitles() {
            if (!this.movie) return [];
            return [
                { label: 'English', srclang: 'en', src: `/subtitles/${this.movie.imdb_code}?lang=en&hash=${this.selectedTorrent}`, default: true },
                { label: 'Bulgarian', srclang: 'bg', src: `/subtitles/${this.movie.imdb_code}?lang=bg` }
            ];
        },
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
    async mounted() {
        const imdbCode = this.$route.params.imdb_code;

        try {
            // The movie may have been left a moment ago, and its last position may still be on the way
            await watchHistory.settled();
            const [movieResponse, progressResponse] = await Promise.all([
                api.get(`/movies/${imdbCode}`),
                api.get(`/history/${imdbCode}`).catch(() => null)
            ]);
            this.movie = movieResponse.data.movie;
            this.savedProgress = progressResponse ? progressResponse.data.progress : null;
            this.resumeAt = this.resumePosition(this.savedProgress);
        } catch (error) {
            console.error('There was an error!', error);
            if (error.response && error.response.status === 404) {
                this.pageError = "This movie isn't available.";
            } else if (!error.response || error.response.status !== 401) {
                this.pageError = "This movie couldn't be loaded. Check your connection and refresh the page.";
            }
            return;
        }

        this.loadDetails();

        const torrent = bestTorrent(this.movie.torrents || []);
        if (!torrent) {
            this.pageError = 'There is no video for this movie yet.';
            return;
        }

        this.selectTorrent(torrent.hash);
    },
    methods: {
        loadDetails() {
            this.detailsLoading = true;
            movieDetails.load(this.movie.imdb_code).then((details) => {
                this.details = details;
            }).catch(() => {
                // The page works without them, the section is just left out
            }).finally(() => {
                this.detailsLoading = false;
            });
        },
        async selectTorrent(torrentHash) {
            this.selectedTorrent = torrentHash;

            try {
                // Loads the torrent and the start of the movie (and the resume point) before Play is pressed
                const at = this.savedProgress && this.resumeAt ? this.resumeAt / this.savedProgress.duration : 0;
                await api.get(`/preload/${this.movie.imdb_code}/${torrentHash}`, { params: { at } });
            } catch (error) {
                if (error.response && error.response.status === 401) return;
                this.showTorrents = true;
                console.error('Error selecting torrent:', error);
            }
        },
        // A quality picked from the list above the player. A new one continues where the old one was.
        async chooseTorrent(torrentHash, event) {
            if (event) event.currentTarget.blur();
            const player = this.$refs.player;
            const same = torrentHash === this.selectedTorrent;

            this.selectedTorrent = torrentHash;
            await this.$nextTick();
            if (!this.started) {
                player.startPlayback();
            } else if (same && player.loadError) {
                player.retry();
            }
        },
        // The reset brought the latest details and torrents. The movie keeps playing unless its torrent is gone.
        onReset({ movie, details }) {
            const previous = this.selectedTorrent;
            this.movie = movie;
            if (details !== undefined) {
                this.details = details;
                movieDetails.set(movie.imdb_code, details);
            }

            const torrents = movie.torrents || [];
            if (!torrents.length || torrents.some(torrent => torrent.hash === previous)) return;

            const torrent = bestTorrent(torrents);
            if (this.started) {
                this.chooseTorrent(torrent.hash);
            } else {
                this.showTorrents = false;
                this.selectTorrent(torrent.hash);
            }
        },
        resumePosition(progress) {
            if (!progress || !progress.duration) return 0;
            const { position, duration } = progress;
            if (position < MIN_RESUME_SECONDS || position >= duration * FINISHED_RATIO) return 0;
            // A few seconds back, so the scene picks up where it was left
            return Math.max(0, position - 3);
        },
        // Called by the player. Resolves when saved, rejects when the save failed.
        saveProgress(payload, { beacon }) {
            const imdbCode = this.movie.imdb_code;

            // A normal request can be cancelled when the page is closing, a beacon can't
            if (beacon && navigator.sendBeacon) {
                const body = new Blob([JSON.stringify({ ...payload, token: session.token })], { type: 'text/plain' });
                if (navigator.sendBeacon(`${API_URL}/history/${imdbCode}`, body)) {
                    this.savedProgress = this.savedProgress || payload;
                    return true;
                }
            }

            // Saves of the same movie go out one after another, so an older position never wins
            return watchHistory.save(imdbCode, payload).then((response) => {
                this.savedProgress = this.savedProgress || payload;
                // Watching the movie to the end took it off the watchlist
                if (response.data && response.data.removedFromWatchlist) {
                    watchlist.forget(imdbCode);
                }
            });
        }
    }
};
</script>

<style scoped>
.movie {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100dvh;
}

.page-message {
    padding: 0 var(--gutter);
    color: var(--text-muted);
    font-size: 1.05rem;
}

.movie-details {
    width: 100%;
    max-width: 1040px;
    box-sizing: border-box;
    flex-grow: 1;
    margin: 0 auto;
    padding: 0 var(--gutter) 48px;
}

.title-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 8px 0 20px;
}

.title {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: clamp(1.9rem, 4.2vw, 2.8rem);
    font-weight: 800;
    font-stretch: 115%;
    line-height: 1.05;
    letter-spacing: -0.01em;
}

.torrents {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
}

.torrents > button {
    height: 40px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.torrents > button:hover {
    background: var(--surface-hover);
}

.torrents > button.selectedTorrent {
    background: #f2f2f4;
    border-color: #f2f2f4;
    color: #0b0b10;
    font-weight: 600;
}


.about {
    margin-top: 24px;
}

.facts-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px 24px;
}

.facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 18px;
    margin: 0;
    color: var(--text-muted);
    font-size: 1.05rem;
}

.rating {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 1.3rem;
    font-weight: 600;
}

.rating svg {
    width: 24px;
    height: 24px;
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

.links {
    display: flex;
    align-items: center;
    gap: 10px;
}

.trailer-button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 34px;
    padding: 0 14px 0 10px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.trailer-button:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.36);
}

.trailer-button svg {
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linejoin: round;
}

.trailer-button svg path {
    fill: currentColor;
    stroke: none;
}

.imdb-button {
    display: flex;
    align-items: center;
    height: 34px;
    padding: 0 8px;
    box-sizing: border-box;
    border-radius: 6px;
    background-color: #f5c518;
    transition: filter 0.2s ease;
}

.imdb-button:hover {
    filter: brightness(0.85);
}

.imdb-button img {
    height: 24px;
    width: auto;
}

.tagline {
    margin: 22px 0 0;
    color: #cdd0dc;
    font-size: 1.15rem;
    font-style: italic;
}

.summary {
    margin-top: 22px;
}

.summary > h2 {
    margin-bottom: 0;
    font-size: 1.3rem;
    font-weight: 700;
    font-stretch: 112%;
}

.summary > p {
    max-width: 72ch;
    margin-top: 8px;
    color: #cdd0dc;
    line-height: 1.65;
}

.extras {
    margin-top: 30px;
}

.reset-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 18px;
    margin-top: 44px;
    padding-top: 24px;
    border-top: 1px solid var(--line);
}

.reset-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 42px;
    padding: 0 18px 0 14px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.98rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.reset-button:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.36);
}

.reset-button svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.reset-hint {
    flex: 1 1 260px;
    margin: 0;
    color: var(--text-faint);
    font-size: 0.92rem;
}

@media (max-width: 640px) {
    .facts {
        gap: 6px 14px;
    }
}
</style>
