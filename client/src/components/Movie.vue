<template>
    <div class="movie">
        <AppHeader back search />

        <LoadingSpinner v-if="!movie && !pageError" overlay label="Loading the movie" />
        <p v-else-if="pageError" class="page-message">{{ pageError }}</p>

        <div class="movie-details" v-if="movie">
            <h1 class="title">{{ movie.title }}</h1>

            <div class="torrents" v-if="showTorrents && movie.torrents && movie.torrents.length">
                <button
                    v-for="torrent in movie.torrents"
                    :key="torrent.hash"
                    type="button"
                    :class="{ selectedTorrent: torrent.hash === selectedTorrent }"
                    @click="chooseTorrent(torrent.hash, $event)"
                >{{ torrent.type }} {{ torrent.quality }} {{ torrent.video_codec }}</button>
            </div>

            <div class="video-container" :class="{ started: start }">
                <!-- Plyr owns this element; its source and subtitle tracks are set from code -->
                <video ref="video" id="movie-player" controls playsinline preload="none" :poster="movie.background_image"></video>

                <div v-if="!start" class="overlay start">
                    <template v-if="selectedTorrent && !showTorrents">
                        <button class="play-button" type="button" :aria-label="resumeAt ? `Resume from ${formatTime(resumeAt)}` : 'Play'" @click="startMovie()">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 5.75v12.5L18.1 12z" /></svg>
                        </button>
                        <template v-if="resumeAt">
                            <p class="resume">Resume from {{ formatTime(resumeAt) }}</p>
                            <button class="start-over" type="button" @click="startMovie(true)">Start from the beginning</button>
                        </template>
                    </template>
                    <p v-else-if="showTorrents" class="overlay-message">Select a quality above to start watching</p>
                </div>

                <div v-if="start && (!isVideoLoaded || buffering) && !loadError" class="overlay loading">
                    <LoadingSpinner :size="60" label="Loading the video" />
                </div>

                <div v-if="loadError" class="overlay failed">
                    <p class="overlay-message">{{ loadError }}</p>
                    <button class="retry" type="button" @click="retry">Try again</button>
                </div>

                <!-- Subtitle settings modal -->
                <div v-if="showSubtitleSettings" class="subtitle-settings-modal" @click.self="showSubtitleSettings = false">
                    <div class="subtitle-settings-container">
                        <h3>Subtitle Settings</h3>
                        <div class="setting-group">
                            <label>Font Size</label>
                            <div class="setting-controls">
                                <button @click="changeFontSize(-0.1)">-</button>
                                <span>{{ (subtitleSettings.fontSize * 100).toFixed(0) }}%</span>
                                <button @click="changeFontSize(0.1)">+</button>
                            </div>
                        </div>

                        <div class="setting-group">
                            <label>Background Opacity</label>
                            <div class="setting-controls">
                                <button @click="changeBackgroundOpacity(-0.1)">-</button>
                                <span>{{ (subtitleSettings.bgOpacity * 100).toFixed(0) }}%</span>
                                <button @click="changeBackgroundOpacity(0.1)">+</button>
                            </div>
                        </div>

                        <div class="setting-group">
                            <label>Text Color</label>
                            <div class="color-options">
                                <span
                                    v-for="color in colors"
                                    :key="color"
                                    :style="{ backgroundColor: color }"
                                    class="color-option"
                                    :class="{ active: subtitleSettings.color === color }"
                                    @click="subtitleSettings.color = color; applySubtitleSettings()"
                                ></span>
                            </div>
                        </div>

                        <button class="close-btn" @click="showSubtitleSettings = false">Close</button>
                    </div>
                </div>
            </div>

            <!-- Subtitle settings button -->
            <button v-if="selectedTorrent" class="subtitle-settings-btn" type="button" @click="openSubtitleSettings($event)">
                Subtitle Settings
            </button>

            <div class="movie-info">
                <p class="rating">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                    {{ movie.rating }} / 10
                </p>
                <a :href="'https://www.imdb.com/title/' + movie.imdb_code" target="_blank" rel="noopener noreferrer" class="imdb-button" aria-label="Open on IMDb">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb">
                </a>
            </div>

            <p class="year">Year: {{ movie.year }}</p>
            <p class="genres">Genres: {{ (movie.genres || []).join(', ') }}</p>

            <div class="summary">
                <h2>Summary</h2>
                <p>{{ movie.summary || "No summary available" }}</p>
            </div>

            <button class="resetMovie" type="button" @click="resetMovie()">Reset</button>
        </div>
    </div>
</template>

<script>
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import api from '../api';
import { API_URL } from '../config';
import { session } from '../session';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';

// How often the position is saved while watching
const SAVE_INTERVAL = 15000;
// Shorter starts aren't worth resuming
const MIN_RESUME_SECONDS = 30;
// Past this point the credits are rolling, so the next time starts from the beginning
const FINISHED_RATIO = 0.95;
// A movie only lands in the history after it has really been watched for a moment
const MIN_WATCH_SECONDS = 10;

export default {
    name: 'MoviePage',
    components: {
        AppHeader,
        LoadingSpinner
    },
    data() {
        return {
            movie: null,
            pageError: null,
            selectedTorrent: null,
            start: false,
            showTorrents: false,
            isVideoLoaded: false,
            buffering: false,
            loadError: null,
            player: null,
            savedProgress: null,
            resumeAt: 0,
            showSubtitleSettings: false,
            subtitleSettings: {
                fontSize: 1.0,       // multiplier for default size
                bgOpacity: 0.5,      // background opacity 0-1
                color: '#ffffff'     // text color
            },
            colors: ['#ffffff', '#ffff00', '#00ff00', '#00ffff', '#ff00ff']
        };
    },
    computed: {
        videoSrc() {
            return this.movie && this.selectedTorrent ? `${API_URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
        },
        isMobile() {
            return window.innerWidth < 768;
        }
    },
    created() {
        this.loadSavedSubtitleSettings();
        // Progress bookkeeping, kept out of the reactive data on purpose
        this.lastTime = null;
        this.unsavedWatch = 0;
        this.watchedThisVisit = 0;
        this.lastSavedPosition = null;
        this.pendingSeek = null;
    },
    async mounted() {
        const imdbCode = this.$route.params.imdb_code;

        try {
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

        const torrents = this.movie.torrents || [];
        const bestTorrent = torrents.find(torrent => torrent.quality == '1080p' && torrent.video_codec == 'x264') || torrents.find(torrent => torrent.quality == "1080p") || torrents[0];
        if (!bestTorrent) {
            this.pageError = 'There is no video for this movie yet.';
            return;
        }

        await this.$nextTick();
        this.setupPlayer();
        this.selectTorrent(bestTorrent.hash);
    },
    methods: {
        setupPlayer() {
            const videoElement = this.$refs.video;
            if (!videoElement) return;

            if (!this.isMobile) {
                this.player = new Plyr(videoElement, {
                    keyboard: { focused: false, global: true },
                    captions: { active: true, update: true },
                    controls: [
                        'play-large',
                        'rewind',
                        'play',
                        'fast-forward',
                        'progress',
                        'current-time',
                        'duration',
                        'mute',
                        'volume',
                        'captions',
                        'settings',
                        'fullscreen'
                    ],
                    seekTime: 10,
                    settings: ['captions', 'quality', 'speed']
                });

                // Apply custom styles
                this.applySubtitleSettings();
            }

            // Plyr keeps using this same element, so these listeners stay valid (mobile uses it directly)
            this.videoListeners = {
                loadedmetadata: () => this.onLoadedMetadata(),
                playing: () => {
                    this.isVideoLoaded = true;
                    this.buffering = false;
                },
                canplay: () => {
                    this.buffering = false;
                },
                waiting: () => {
                    this.buffering = true;
                },
                error: () => this.onVideoError(),
                timeupdate: () => this.onTimeUpdate(),
                seeked: () => {
                    this.lastTime = videoElement.currentTime;
                    this.saveProgress();
                },
                pause: () => this.saveProgress(),
                ended: () => this.saveProgress()
            };
            for (const [event, listener] of Object.entries(this.videoListeners)) {
                videoElement.addEventListener(event, listener);
            }
        },
        startMovie(fromBeginning = false) {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.selectedTorrent) return;

            this.start = true;
            if (!this.tracksAdded) {
                this.addSubtitleTracks(videoElement);
                this.tracksAdded = true;
            }
            this.loadVideo(fromBeginning ? 0 : this.resumeAt);
            this.startSavingProgress();
        },
        // Points the player at the selected torrent and starts playing at `startAt` seconds
        loadVideo(startAt) {
            const videoElement = this.$refs.video;
            this.isVideoLoaded = false;
            this.buffering = false;
            this.loadError = null;
            this.pendingSeek = startAt > 0 ? startAt : null;
            this.lastTime = null;

            videoElement.src = this.videoSrc;
            if (startAt > 0) {
                // Browsers remember this until the metadata is loaded; onLoadedMetadata makes sure
                videoElement.currentTime = startAt;
            }

            const playing = this.player ? this.player.play() : videoElement.play();
            if (playing && playing.catch) {
                playing.catch(error => {
                    console.error('Error playing video:', error);
                });
            }
        },
        onLoadedMetadata() {
            const videoElement = this.$refs.video;
            if (this.pendingSeek !== null && Number.isFinite(videoElement.duration)) {
                const target = Math.min(this.pendingSeek, videoElement.duration - 1);
                if (Math.abs(videoElement.currentTime - target) > 1) {
                    videoElement.currentTime = target;
                }
            }
            this.pendingSeek = null;
        },
        onVideoError() {
            if (!this.start) return;
            const videoElement = this.$refs.video;
            console.error('Video error:', videoElement.error);
            this.loadError = "The video couldn't be loaded. Try again or select another quality.";
            this.isVideoLoaded = false;
            this.showTorrents = true;
        },
        retry() {
            const videoElement = this.$refs.video;
            const position = this.lastTime || videoElement.currentTime || this.resumeAt;
            this.loadVideo(position);
        },
        addSubtitleTracks(videoElement) {
            const tracks = [
                // English subtitles come from the torrent itself when it has them
                { label: 'English', srclang: 'en', src: `/subtitles/${this.movie.imdb_code}?lang=en&hash=${this.selectedTorrent}`, default: true },
                { label: 'Bulgarian', srclang: 'bg', src: `/subtitles/${this.movie.imdb_code}?lang=bg` }
            ];
            for (const { label, srclang, src, default: isDefault } of tracks) {
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = label;
                track.srclang = srclang;
                track.src = src;
                if (isDefault) track.default = true;
                videoElement.appendChild(track);
            }
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
        // A quality picked from the list above the player
        chooseTorrent(torrentHash, event) {
            if (event) event.currentTarget.blur();
            const videoElement = this.$refs.video;
            const switching = this.start && torrentHash !== this.selectedTorrent;
            const position = this.start ? (this.lastTime || videoElement.currentTime) : this.resumeAt;

            this.selectedTorrent = torrentHash;
            if (!this.start) {
                this.startMovie();
            } else if (switching || this.loadError) {
                this.loadVideo(position);
            }
        },
        resumePosition(progress) {
            if (!progress || !progress.duration) return 0;
            const { position, duration } = progress;
            if (position < MIN_RESUME_SECONDS || position >= duration * FINISHED_RATIO) return 0;
            // A few seconds back, so the scene picks up where it was left
            return Math.max(0, position - 3);
        },
        formatTime(seconds) {
            const total = Math.floor(seconds);
            const h = Math.floor(total / 3600);
            const m = Math.floor((total % 3600) / 60);
            const s = String(total % 60).padStart(2, '0');
            return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
        },
        onTimeUpdate() {
            const videoElement = this.$refs.video;
            const time = videoElement.currentTime;
            if (this.lastTime !== null && !videoElement.paused && !videoElement.seeking) {
                const delta = time - this.lastTime;
                // Bigger jumps are seeks, not watching
                if (delta > 0 && delta < 3) {
                    this.unsavedWatch += delta;
                    this.watchedThisVisit += delta;
                }
            }
            this.lastTime = time;
        },
        startSavingProgress() {
            if (this.saveTimer) return;
            this.saveTimer = setInterval(() => this.saveProgress(), SAVE_INTERVAL);
            // Refreshing or closing the tab
            this.onPageHide = () => this.saveProgress({ beacon: true });
            this.onVisibilityChange = () => {
                if (document.visibilityState === 'hidden') this.saveProgress({ beacon: true });
            };
            window.addEventListener('pagehide', this.onPageHide);
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        },
        progressPayload() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start || !this.movie) return null;

            const duration = videoElement.duration;
            if (!Number.isFinite(duration) || duration <= 0) return null;
            if (!this.savedProgress && this.watchedThisVisit < MIN_WATCH_SECONDS) return null;

            const position = this.pendingSeek !== null ? this.pendingSeek : videoElement.currentTime;
            const moved = this.lastSavedPosition === null || Math.abs(position - this.lastSavedPosition) >= 1;
            if (!moved && this.unsavedWatch < 0.5) return null;

            return { position, duration, watched: this.unsavedWatch };
        },
        saveProgress({ beacon = false } = {}) {
            const payload = this.progressPayload();
            if (!payload) return;

            this.unsavedWatch = 0;
            this.lastSavedPosition = payload.position;

            // A normal request can be cancelled when the page is closing, a beacon can't
            if (beacon && navigator.sendBeacon) {
                const body = new Blob([JSON.stringify({ ...payload, token: session.token })], { type: 'text/plain' });
                if (navigator.sendBeacon(`${API_URL}/history/${this.movie.imdb_code}`, body)) {
                    this.savedProgress = this.savedProgress || payload;
                    return;
                }
            }

            api.put(`/history/${this.movie.imdb_code}`, payload).then(() => {
                this.savedProgress = this.savedProgress || payload;
            }).catch(() => {
                // Count this time again with the next save
                this.unsavedWatch += payload.watched;
                this.lastSavedPosition = null;
            });
        },
        openSubtitleSettings(event) {
            // Without this, Space would reopen the settings instead of pausing the movie
            event.currentTarget.blur();
            this.showSubtitleSettings = true;
        },
        async resetMovie() {
            // Ask if user is sure
            if(!confirm('Are you sure you want to reset the movie? \nThis will reset the movie information and torrents.')) {
                return;
            }

            try {
                const response = await api.post('/reset-movie', {
                    imdb_code: this.movie.imdb_code
                });

                alert(response.data.message || 'Movie reset successfully!');
                window.location.reload();
            } catch (error) {
                const data = error.response ? error.response.data : null;
                alert(`There was an error! \n${(data && (data.message || data.error)) || data || 'An error occurred'}`);
            }
        },
        changeFontSize(delta) {
            this.subtitleSettings.fontSize = Math.max(0.5, Math.min(2.0, this.subtitleSettings.fontSize + delta));
            this.applySubtitleSettings();
        },

        changeBackgroundOpacity(delta) {
            this.subtitleSettings.bgOpacity = Math.max(0, Math.min(1, this.subtitleSettings.bgOpacity + delta));
            this.applySubtitleSettings();
        },

        applySubtitleSettings() {
            if (!this.player) return;

            // Save settings to localStorage
            localStorage.setItem('subtitleSettings', JSON.stringify(this.subtitleSettings));

            // Apply settings through CSS
            const fontSize = this.subtitleSettings.fontSize * 1.8; // Base size is 1.8rem
            const bgOpacity = this.subtitleSettings.bgOpacity;
            const color = this.subtitleSettings.color;

            const styleEl = document.getElementById('plyr-subtitle-styles') || document.createElement('style');
            styleEl.id = 'plyr-subtitle-styles';
            styleEl.innerHTML = `
                .plyr__captions {
                    font-size: ${fontSize}rem !important;
                    color: ${color} !important;
                    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7) !important;
                }
                .plyr__captions span {
                    background-color: rgba(0, 0, 0, ${bgOpacity}) !important;
                    padding: 2px 8px !important;
                }
            `;

            if (!document.getElementById('plyr-subtitle-styles')) {
                document.head.appendChild(styleEl);
            }
        },

        loadSavedSubtitleSettings() {
            const savedSettings = localStorage.getItem('subtitleSettings');
            if (savedSettings) {
                try {
                    this.subtitleSettings = JSON.parse(savedSettings);
                } catch (e) {
                    console.error('Error parsing saved subtitle settings', e);
                }
            }
        }
    },
    beforeUnmount() {
        // Save where we stopped before the video goes away
        this.saveProgress();

        clearInterval(this.saveTimer);
        if (this.onPageHide) window.removeEventListener('pagehide', this.onPageHide);
        if (this.onVisibilityChange) document.removeEventListener('visibilitychange', this.onVisibilityChange);

        const videoElement = this.$refs.video;
        if (videoElement && this.videoListeners) {
            for (const [event, listener] of Object.entries(this.videoListeners)) {
                videoElement.removeEventListener(event, listener);
            }
        }

        if (this.player) {
            // Use Plyr's destroy method
            this.player.destroy();
        }

        // Stop the download right away, so the server can release the torrent
        if (videoElement) {
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();
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

.title {
    margin: 8px 0 20px;
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

.video-container {
    --plyr-color-main: #e9c37b;
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 14px;
    overflow: hidden;
    background: #000;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}

.video-container :deep(.plyr),
.video-container video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

.video-container video {
    object-fit: contain;
    background: #000;
}

/* Before the movie starts, the backdrop fills the player and our own play button replaces Plyr's */
.video-container :deep(.plyr__poster) {
    background-size: cover;
}

.video-container:not(.started) :deep(.plyr__control--overlaid) {
    display: none;
}

.overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px;
    box-sizing: border-box;
    color: var(--text);
    text-align: center;
    z-index: 10;
}

.overlay.start {
    background: linear-gradient(180deg, rgba(5, 6, 12, 0.25) 0%, rgba(5, 6, 12, 0.7) 100%);
}

/* The spinner shows over the video while it buffers; the player controls stay usable */
.overlay.loading {
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
}

.overlay.failed {
    background: rgba(5, 6, 12, 0.82);
}

.play-button {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 50%;
    background: rgba(10, 11, 20, 0.45);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: #fff;
    cursor: pointer;
    transition: transform 0.2s ease, background-color 0.2s ease;
}

.play-button:hover {
    transform: scale(1.06);
    background: rgba(255, 255, 255, 0.2);
}

/* The triangle is drawn a hair right of center, which is what looks centered in a circle */
.play-button svg {
    width: 40px;
    height: 40px;
    fill: currentColor;
}

.resume {
    margin: 6px 0 0;
    font-size: 1.1rem;
    font-weight: 600;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.6);
}

.start-over {
    padding: 6px 12px;
    border: none;
    border-radius: 16px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.95rem;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
}

.start-over:hover {
    color: var(--text);
}

.overlay-message {
    max-width: 36ch;
    margin: 0;
    font-size: 1.1rem;
}

.retry {
    height: 42px;
    padding: 0 22px;
    border: none;
    border-radius: 21px;
    background: #f2f2f4;
    color: #0b0b10;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
}

.movie-info {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 24px;
    margin-bottom: 18px;
}

.imdb-button {
    background-color: #f5c518;
    padding: 4px 8px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    transition: all 0.3s ease;
}

.imdb-button:hover {
    filter: brightness(0.85);
}

.imdb-button img {
    height: 24px;
    width: auto;
}

.rating {
    margin: 0;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 1.3rem;
    font-weight: 600;
}

.rating svg {
    width: 24px;
    height: 24px;
    fill: var(--accent);
}

.year, .genres {
    font-size: 1.1rem;
    margin: 0 0 6px;
    color: var(--text-muted);
}

.summary {
    margin-top: 28px;
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

.resetMovie {
    margin: 40px 0 0;
    padding: 10px 20px;
    font-size: 1rem;
    color: var(--danger);
    background-color: transparent;
    border: 1px solid rgba(229, 115, 107, 0.5);
    border-radius: 10px;
    cursor: pointer;
    transition: background-color 0.3s ease;
}

.resetMovie:hover {
    background-color: rgba(229, 115, 107, 0.12);
}

.subtitle-settings-btn {
    margin-top: 14px;
    padding: 8px 16px;
    background-color: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 18px;
    cursor: pointer;
    font-size: 14px;
    transition: background-color 0.2s ease;
}

.subtitle-settings-btn:hover {
    background-color: var(--surface-hover);
}

.subtitle-settings-modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
}

.subtitle-settings-container {
    background-color: var(--bg-elevated);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
    width: 90%;
    max-width: 400px;
}

.subtitle-settings-container h3 {
    margin-top: 0;
    text-align: center;
    margin-bottom: 20px;
}

.setting-group {
    margin-bottom: 20px;
}

.setting-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: bold;
}

.setting-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
}

.setting-controls button {
    width: 40px;
    height: 40px;
    font-size: 18px;
    background-color: var(--surface-strong);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
}

.color-options {
    display: flex;
    justify-content: space-between;
}

.color-option {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    cursor: pointer;
    border: 2px solid transparent;
}

.color-option.active {
    border-color: #fff;
    box-shadow: 0 0 5px rgba(255, 255, 255, 0.8);
}

.close-btn {
    display: block;
    width: 100%;
    padding: 10px;
    background-color: var(--surface-strong);
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    margin-top: 10px;
}

@media (max-width: 640px) {
    .video-container {
        border-radius: 10px;
    }

    .play-button {
        width: 72px;
        height: 72px;
    }
}
</style>
