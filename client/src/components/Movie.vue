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

            <!-- Also the fullscreen element, so the overlays below and the popups stay visible in fullscreen.
                 Clicking a control never focuses it, so Space always pauses instead of pressing that control. -->
            <div
                ref="videoContainer"
                class="video-container"
                :class="{ started: start }"
                :style="captionStyle"
                @mousedown.capture="keepFocus"
            >
                <!-- Plyr owns this element; its source and subtitle tracks are set from code -->
                <video ref="video" id="movie-player" controls playsinline preload="none" :poster="movie.background_image"></video>

                <div v-if="!start" class="overlay start">
                    <template v-if="selectedTorrent && !showTorrents">
                        <button class="play-button" type="button" tabindex="-1" :aria-label="resumeAt ? `Resume from ${formatTime(resumeAt)}` : 'Play'" @click="startMovie()">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 5.75v12.5L18.1 12z" /></svg>
                        </button>
                        <template v-if="resumeAt">
                            <p class="resume">Resume from {{ formatTime(resumeAt) }}</p>
                            <button class="start-over" type="button" tabindex="-1" @click="startMovie(true)">Start from the beginning</button>
                        </template>
                    </template>
                    <p v-else-if="showTorrents" class="overlay-message">Select a quality above to start watching</p>
                </div>

                <div v-if="start && (!isVideoLoaded || buffering) && !loadError" class="overlay loading">
                    <LoadingSpinner :size="60" label="Loading the video" />
                    <p v-if="streamNote" class="overlay-note">{{ streamNote }}</p>
                </div>

                <div v-if="loadError" class="overlay failed">
                    <p class="overlay-message">{{ loadError }}</p>
                    <button class="retry" type="button" tabindex="-1" @click="retry">Try again</button>
                </div>

                <!-- The settings button sits in Plyr's control bar, between the captions and fullscreen buttons -->
                <Teleport v-if="settingsSlot" :to="settingsSlot">
                    <button
                        type="button"
                        tabindex="-1"
                        class="plyr__control"
                        aria-label="Settings"
                        aria-haspopup="dialog"
                        :aria-expanded="settingsOpen ? 'true' : 'false'"
                        @click="toggleSettings"
                    >
                        <svg viewBox="0 0 18 18" aria-hidden="true"><path :d="settingsIcon" /></svg>
                    </button>
                    <Transition name="settings">
                        <PlayerSettings
                            v-if="settingsOpen"
                            :speed="speed"
                            :speeds="speeds"
                            :tracks="subtitleTracks"
                            :current-track="currentTrack"
                            :offset="subtitleOffset"
                            :subtitle-style="subtitleStyle"
                            @update:speed="setSpeed"
                            @select-track="selectTrack"
                            @update:offset="setOffset"
                            @update:subtitle-style="setSubtitleStyle"
                        />
                    </Transition>
                </Teleport>
            </div>

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
import { markRaw } from 'vue';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import api from '../api';
import { API_URL } from '../config';
import { connection } from '../connection';
import { movieDetails, formatRuntime } from '../movieDetails';
import { session } from '../session';
import { loadOffset, loadStyle, saveOffset, saveStyle, shiftCues } from '../subtitles';
import { watchHistory } from '../watchHistory';
import { watchlist } from '../watchlist';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieExtras from './MovieExtras.vue';
import PlayerSettings from './PlayerSettings.vue';
import ResetMovieDialog from './ResetMovieDialog.vue';
import WatchlistButton from './WatchlistButton.vue';

// How often the position is saved while watching
const SAVE_INTERVAL = 15000;
// Shorter starts aren't worth resuming
const MIN_RESUME_SECONDS = 30;
// Past this point the credits are rolling, so the next time starts from the beginning
const FINISHED_RATIO = 0.95;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// A stream that gets no data for this long while the movie waits for it is loaded again. Before the
// movie has played at all the server may still be loading the torrent, which can take a minute.
const STALL_TIMEOUT = 15000;
const START_TIMEOUT = 75000;
// Times a broken stream is loaded again before the error is shown, when it doesn't play in between
const MAX_RECOVERIES = 4;
// Plyr's own settings icon
const SETTINGS_ICON = 'M16.135 7.784a2 2 0 01-1.23-2.969c.322-.536.225-.998-.094-1.316l-.31-.31c-.318-.318-.78-.415-1.316-.094a2 2 0 01-2.969-1.23C10.065 1.258 9.669 1 9.219 1h-.438c-.45 0-.845.258-.997.865a2 2 0 01-2.969 1.23c-.536-.322-.999-.225-1.317.093l-.31.31c-.318.318-.415.781-.093 1.317a2 2 0 01-1.23 2.969C1.26 7.935 1 8.33 1 8.781v.438c0 .45.258.845.865.997a2 2 0 011.23 2.969c-.322.536-.225.998.094 1.316l.31.31c.319.319.782.415 1.316.094a2 2 0 012.969 1.23c.151.607.547.865.997.865h.438c.45 0 .845-.258.997-.865a2 2 0 012.969-1.23c.535.321.997.225 1.316-.094l.31-.31c.318-.318.415-.781.094-1.316a2 2 0 011.23-2.969c.607-.151.865-.547.865-.997v-.438c0-.451-.26-.846-.865-.997zM9 12a3 3 0 110-6 3 3 0 010 6z';

function bestTorrent(torrents) {
    return torrents.find(torrent => torrent.quality == '1080p' && torrent.video_codec == 'x264') || torrents.find(torrent => torrent.quality == "1080p") || torrents[0];
}

export default {
    name: 'MoviePage',
    components: {
        AppHeader,
        LoadingSpinner,
        MovieExtras,
        PlayerSettings,
        ResetMovieDialog,
        WatchlistButton
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
            // Cast, crew and the rest from TMDB
            details: null,
            detailsLoading: true,
            // The element in Plyr's control bar that holds the settings button
            settingsSlot: null,
            settingsOpen: false,
            settingsIcon: SETTINGS_ICON,
            speed: 1,
            speeds: SPEEDS,
            // [{ index, label, language, status }], in the order of the video's text tracks
            subtitleTracks: [],
            currentTrack: -1,
            subtitleOffset: 0,
            subtitleStyle: loadStyle(),
            // null, 'reconnecting' or 'offline' while the stream is being picked up again
            streamState: null,
            showResetDialog: false
        };
    },
    computed: {
        videoSrc() {
            return this.movie && this.selectedTorrent ? `${API_URL}/stream/${this.movie.imdb_code}/${this.selectedTorrent}` : '';
        },
        isMobile() {
            return window.innerWidth < 768;
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
        },
        // Plyr reads the caption colors from these variables; the size scales with the player's width
        captionStyle() {
            return {
                '--caption-scale': this.subtitleStyle.fontSize,
                '--plyr-captions-background': `rgba(0, 0, 0, ${this.subtitleStyle.bgOpacity})`,
                '--plyr-captions-text-color': this.subtitleStyle.color
            };
        },
        streamNote() {
            if (this.streamState === 'offline') return "You're offline. The movie continues when the connection is back.";
            if (this.streamState === 'reconnecting') return 'Reconnecting…';
            return '';
        }
    },
    created() {
        // Progress bookkeeping, kept out of the reactive data on purpose
        this.lastTime = null;
        this.unsavedWatch = 0;
        this.lastSavedPosition = null;
        this.pendingSeek = null;
        this.duration = null;
        // Set once the movie has really played on this visit
        this.everPlayed = false;

        // Stream health, see checkStream
        this.lastDataAt = Date.now();
        this.recoveries = 0;
        this.recovering = false;
        this.waitingForNetwork = false;
        this.staleStream = false;
        this.trackElements = [];
        // Subtitle offsets of this movie by language, read from storage the first time they're needed
        this.offsets = {};

        this.stopReconnect = connection.onReconnect(() => this.onReconnect());
    },
    async mounted() {
        const imdbCode = this.$route.params.imdb_code;

        this.onKeydown = (event) => this.handleKey(event);
        this.onPointerUp = () => this.dropFocus();
        this.onPointerDown = (event) => this.closeSettingsOutside(event);
        this.onResize = () => this.fitSettings();
        window.addEventListener('keydown', this.onKeydown, true);
        window.addEventListener('pointerup', this.onPointerUp, true);
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('fullscreenchange', this.onResize);

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

        await this.$nextTick();
        this.setupPlayer();
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
        setupPlayer() {
            const videoElement = this.$refs.video;
            if (!videoElement) return;

            if (!this.isMobile) {
                this.player = markRaw(new Plyr(videoElement, {
                    keyboard: { focused: false, global: true },
                    captions: { active: true, update: true },
                    fullscreen: { enabled: true, fallback: true, iosNative: false, container: '.video-container' },
                    // The control bar is laid out in two rows by the styles below, whatever this order
                    controls: [
                        'play-large',
                        'play',
                        'rewind',
                        'fast-forward',
                        'progress',
                        'current-time',
                        'duration',
                        'mute',
                        'volume',
                        'captions',
                        'fullscreen'
                    ],
                    seekTime: 10,
                    speed: { selected: 1, options: SPEEDS }
                }));

                this.addSettingsButton();
                // Like Plyr's own menu, the settings close when the controls hide
                this.player.on('controlshidden', () => {
                    this.settingsOpen = false;
                });
                for (const event of ['captionsenabled', 'captionsdisabled', 'languagechange']) {
                    this.player.on(event, () => this.syncCaptions());
                }
            }

            // Plyr's controls stay out of the Tab order, so the keyboard always controls the movie itself
            this.$refs.videoContainer.querySelectorAll('button, input, [tabindex]').forEach((element) => {
                element.setAttribute('tabindex', '-1');
            });

            // Plyr keeps using this same element, so these listeners stay valid (mobile uses it directly)
            this.videoListeners = {
                loadedmetadata: () => this.onLoadedMetadata(),
                durationchange: () => {
                    if (Number.isFinite(videoElement.duration) && videoElement.duration > 0) this.duration = videoElement.duration;
                },
                playing: () => this.onPlaying(),
                canplay: () => {
                    this.buffering = false;
                    this.lastDataAt = Date.now();
                },
                waiting: () => {
                    this.buffering = true;
                    this.lastDataAt = Date.now();
                },
                // Data is arriving, so the stream is alive even while the movie still waits for enough of it
                progress: () => {
                    this.lastDataAt = Date.now();
                },
                error: () => this.onVideoError(),
                timeupdate: () => this.onTimeUpdate(),
                seeked: () => {
                    this.lastTime = videoElement.currentTime;
                    this.saveProgress();
                },
                play: () => {
                    // The connection came back while the movie was paused, its old stream is gone
                    if (this.staleStream) this.resumeStream();
                },
                pause: () => this.saveProgress(),
                ended: () => this.saveProgress(),
                ratechange: () => {
                    this.speed = videoElement.playbackRate;
                    // Loading the stream again resets the speed to this one
                    if (videoElement.defaultPlaybackRate !== videoElement.playbackRate) {
                        videoElement.defaultPlaybackRate = videoElement.playbackRate;
                    }
                }
            };
            for (const [event, listener] of Object.entries(this.videoListeners)) {
                videoElement.addEventListener(event, listener);
            }

            this.streamTimer = setInterval(() => this.checkStream(), 2000);
        },
        addSettingsButton() {
            const controls = this.player.elements.controls;
            if (!controls) return;
            const slot = document.createElement('div');
            slot.className = 'plyr__controls__item plyr__menu';
            controls.insertBefore(slot, controls.querySelector('[data-plyr="fullscreen"]'));
            this.settingsSlot = slot;
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
            this.lastDataAt = Date.now();
            this.staleStream = false;

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
        onPlaying() {
            this.isVideoLoaded = true;
            this.buffering = false;
            this.recoveries = 0;
            this.streamState = null;
            this.lastDataAt = Date.now();

            if (!this.everPlayed) {
                this.everPlayed = true;
                // Saved as soon as the movie plays, so it's in the history even when it's left right away
                this.saveProgress();
            }
        },
        onVideoError() {
            if (!this.start) return;
            const videoElement = this.$refs.video;
            console.error('Video error:', videoElement.error);
            this.buffering = false;
            // A movie the viewer paused loads its stream again once it's played
            if (videoElement.paused && this.everPlayed) {
                this.staleStream = true;
                return;
            }
            this.isVideoLoaded = false;
            this.recoverStream({ failed: true });
        },
        showLoadError() {
            this.streamState = null;
            this.loadError = "The video couldn't be loaded. Try again or select another quality.";
            this.isVideoLoaded = false;
            this.showTorrents = true;
        },
        // Runs every 2 seconds. A movie that waits for data that doesn't come has lost its stream, which
        // happens when the network changes: the old connection just goes quiet.
        checkStream() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start || this.loadError || this.recovering || this.waitingForNetwork) return;

            const waiting = !videoElement.paused && !videoElement.ended && (!this.isVideoLoaded || this.buffering);
            if (!waiting) {
                this.lastDataAt = Date.now();
                return;
            }

            // A torrent that is just slow gets more and more time
            const limit = this.everPlayed ? STALL_TIMEOUT * 2 ** this.recoveries : START_TIMEOUT;
            if (Date.now() - this.lastDataAt > limit) {
                this.recoverStream({ failed: false });
            }
        },
        // Loads a broken stream again from where the movie is, or waits for the connection to come back first
        async recoverStream({ failed }) {
            if (this.recovering) return;
            this.recovering = true;
            this.streamState = 'reconnecting';
            const online = await connection.check();
            this.recovering = false;
            if (this.destroyed || !this.start) return;

            if (!online) {
                // onReconnect picks the movie up again
                this.waitingForNetwork = true;
                this.streamState = 'offline';
                return;
            }

            // With a working connection, a movie that failed before it ever played can't be loaded from this torrent
            if ((failed && !this.everPlayed) || this.recoveries >= MAX_RECOVERIES) {
                this.showLoadError();
                return;
            }

            // Paused in the meantime, so it waits until it's played
            if (this.$refs.video.paused && this.everPlayed) {
                this.streamState = null;
                this.isVideoLoaded = true;
                this.staleStream = true;
                return;
            }

            this.recoveries += 1;
            this.resumeStream();
        },
        // The connection died with the old network, so the stream is loaded again from where the movie is
        onReconnect() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start || videoElement.ended || (this.loadError && !this.waitingForNetwork)) return;

            this.waitingForNetwork = false;
            this.streamState = null;
            this.recoveries = 0;
            // A paused movie loads again once it's played, so nothing is downloaded until then
            if (videoElement.paused) {
                this.staleStream = true;
                return;
            }
            this.resumeStream();
        },
        resumeStream() {
            const videoElement = this.$refs.video;
            if (!videoElement) return;
            const position = this.pendingSeek !== null ? this.pendingSeek : (videoElement.currentTime || this.lastTime || this.resumeAt);
            this.loadVideo(position);
        },
        retry() {
            const videoElement = this.$refs.video;
            const position = this.lastTime || videoElement.currentTime || this.resumeAt;
            this.recoveries = 0;
            this.loadVideo(position);
        },
        addSubtitleTracks(videoElement) {
            const tracks = [
                // English subtitles come from the torrent itself when it has them
                { label: 'English', srclang: 'en', src: `/subtitles/${this.movie.imdb_code}?lang=en&hash=${this.selectedTorrent}`, default: true },
                { label: 'Bulgarian', srclang: 'bg', src: `/subtitles/${this.movie.imdb_code}?lang=bg` }
            ];
            this.subtitleTracks = tracks.map(({ label, srclang }, index) => ({ index, label, language: srclang, status: 'idle' }));

            tracks.forEach(({ label, srclang, src, default: isDefault }, index) => {
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = label;
                track.srclang = srclang;
                track.src = src;
                if (isDefault) track.default = true;
                track.addEventListener('load', () => {
                    this.setTrackStatus(index, 'ready');
                    this.applyOffset(index);
                });
                track.addEventListener('error', () => this.setTrackStatus(index, 'error'));
                videoElement.appendChild(track);
                this.trackElements[index] = track;
            });
        },
        setTrackStatus(index, status) {
            const track = this.subtitleTracks[index];
            if (track) track.status = status;
        },
        // Mirrors the subtitles Plyr shows (its CC button and the C key change them too)
        syncCaptions() {
            if (!this.player) return;
            this.currentTrack = this.player.currentTrack;

            const track = this.subtitleTracks[this.currentTrack];
            if (!track) return;
            this.subtitleOffset = this.offsetFor(track.language);
            const element = this.trackElements[this.currentTrack];
            // Selecting a track makes the browser download it
            if (element && element.readyState < 2 && track.status !== 'error') track.status = 'loading';
        },
        selectTrack(index) {
            if (!this.player) return;
            this.player.currentTrack = index;
            this.syncCaptions();
        },
        offsetFor(language) {
            if (!(language in this.offsets)) this.offsets[language] = loadOffset(this.movie.imdb_code, language);
            return this.offsets[language];
        },
        setOffset(offset) {
            const track = this.subtitleTracks[this.currentTrack];
            if (!track) return;
            this.subtitleOffset = offset;
            this.offsets[track.language] = offset;
            saveOffset(this.movie.imdb_code, track.language, offset);
            this.applyOffset(this.currentTrack);
        },
        applyOffset(index) {
            const element = this.trackElements[index];
            const track = this.subtitleTracks[index];
            if (!element || !track) return;
            shiftCues(element.track, this.offsetFor(track.language));
        },
        setSubtitleStyle(style) {
            this.subtitleStyle = style;
            saveStyle(style);
        },
        setSpeed(speed) {
            const videoElement = this.$refs.video;
            videoElement.defaultPlaybackRate = speed;
            if (this.player) {
                this.player.speed = speed;
            } else {
                videoElement.playbackRate = speed;
            }
            this.speed = speed;
        },
        toggleSettings() {
            this.settingsOpen = !this.settingsOpen;
            if (this.settingsOpen) this.$nextTick(() => this.fitSettings());
        },
        // The panel opens above the control bar and may not grow taller than the player
        fitSettings() {
            const container = this.$refs.videoContainer;
            if (!container || !this.settingsSlot || !this.player) return;
            const controlsTop = this.player.elements.controls.getBoundingClientRect().top;
            const room = controlsTop - container.getBoundingClientRect().top - 24;
            container.style.setProperty('--settings-offset', `${Math.round(this.settingsSlot.getBoundingClientRect().top - controlsTop + 10)}px`);
            container.style.setProperty('--settings-max-height', `${Math.max(180, Math.round(room))}px`);
        },
        closeSettingsOutside(event) {
            if (this.settingsOpen && this.settingsSlot && !this.settingsSlot.contains(event.target)) {
                this.settingsOpen = false;
            }
        },
        // A click doesn't move the focus onto the player's buttons, so Space can't press them again. Plyr's seek
        // and volume bars are range inputs, which don't move at all without their mousedown (dropFocus blurs them).
        keepFocus(event) {
            if (event.target.closest('button, [role="slider"]:not(input)')) event.preventDefault();
        },
        // Plyr's seek and volume sliders do take the focus while they're dragged, so it's dropped afterwards
        dropFocus() {
            setTimeout(() => {
                const focused = document.activeElement;
                const container = this.$refs.videoContainer;
                if (focused && container && focused !== document.body && container.contains(focused)) focused.blur();
            });
        },
        // Runs before Plyr's own shortcuts. Space always plays or pauses the movie: a focused button or link
        // loses the focus first, so it doesn't get pressed instead.
        handleKey(event) {
            if (this.showResetDialog || event.defaultPrevented) return;

            if (event.key === 'Escape' && this.settingsOpen) {
                event.preventDefault();
                this.settingsOpen = false;
                return;
            }

            if (event.key !== ' ' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const focused = document.activeElement;
            // Typing in the search bar
            if (focused && focused.matches('input:not([type="range"]), textarea, select, [contenteditable]')) return;

            if (!this.start) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat && this.selectedTorrent && !this.showTorrents) this.startMovie();
                return;
            }

            if (focused && focused !== document.body && focused.blur) focused.blur();

            // Without Plyr (small screens) the browser's own player doesn't listen to the keyboard
            if (!this.player) {
                event.preventDefault();
                const videoElement = this.$refs.video;
                if (!event.repeat && videoElement) {
                    if (videoElement.paused) {
                        videoElement.play().catch(() => {});
                    } else {
                        videoElement.pause();
                    }
                }
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
                this.recoveries = 0;
                this.loadVideo(position);
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
            if (this.start) {
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
                    this.lastDataAt = Date.now();
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
            // Nothing is saved before the movie has really played on this visit
            if (!videoElement || !this.start || !this.movie || !this.everPlayed) return null;

            // While the stream loads again its duration is unknown for a moment, the last one is still right
            const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : this.duration;
            if (!duration) return null;

            const position = this.pendingSeek !== null ? this.pendingSeek : videoElement.currentTime;
            const moved = this.lastSavedPosition === null || Math.abs(position - this.lastSavedPosition) >= 1;
            if (!moved && this.unsavedWatch < 0.5) return null;

            return { position: Math.min(position, duration), duration, watched: this.unsavedWatch };
        },
        saveProgress({ beacon = false } = {}) {
            const payload = this.progressPayload();
            if (!payload) return;

            const imdbCode = this.movie.imdb_code;
            this.unsavedWatch = 0;
            this.lastSavedPosition = payload.position;

            // A normal request can be cancelled when the page is closing, a beacon can't
            if (beacon && navigator.sendBeacon) {
                const body = new Blob([JSON.stringify({ ...payload, token: session.token })], { type: 'text/plain' });
                if (navigator.sendBeacon(`${API_URL}/history/${imdbCode}`, body)) {
                    this.savedProgress = this.savedProgress || payload;
                    return;
                }
            }

            // Saves of the same movie go out one after another, so an older position never wins
            watchHistory.save(imdbCode, payload).then((response) => {
                this.savedProgress = this.savedProgress || payload;
                // Watching the movie to the end took it off the watchlist
                if (response.data && response.data.removedFromWatchlist) {
                    watchlist.forget(imdbCode);
                }
            }).catch(() => {
                // Count this time again with the next save
                this.unsavedWatch += payload.watched;
                this.lastSavedPosition = null;
            });
        }
    },
    beforeUnmount() {
        // Save where we stopped before the video goes away
        this.saveProgress();
        this.destroyed = true;

        clearInterval(this.saveTimer);
        clearInterval(this.streamTimer);
        if (this.stopReconnect) this.stopReconnect();
        if (this.onPageHide) window.removeEventListener('pagehide', this.onPageHide);
        if (this.onVisibilityChange) document.removeEventListener('visibilitychange', this.onVisibilityChange);
        window.removeEventListener('keydown', this.onKeydown, true);
        window.removeEventListener('pointerup', this.onPointerUp, true);
        window.removeEventListener('pointerdown', this.onPointerDown, true);
        window.removeEventListener('resize', this.onResize);
        document.removeEventListener('fullscreenchange', this.onResize);

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

/* Subtitles are sized from the player's width (cqw), so they grow with it in fullscreen */
.video-container {
    --plyr-color-main: #e9c37b;
    --plyr-font-family: var(--font);
    --plyr-focus-visible-color: var(--accent);
    --plyr-control-icon-size: 20px;
    --plyr-control-padding: 10px;
    --plyr-video-control-color: var(--text);
    --plyr-video-control-color-hover: #fff;
    --plyr-video-control-background-hover: rgba(255, 255, 255, 0.12);
    --plyr-range-track-height: 4px;
    --plyr-range-thumb-height: 14px;
    --plyr-range-thumb-active-shadow-width: 6px;
    --plyr-range-thumb-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
    /* Plyr reads the pressed thumb's halo of video players from the audio variable */
    --plyr-audio-range-thumb-active-shadow-color: rgba(233, 195, 123, 0.28);
    --plyr-video-range-track-background: rgba(255, 255, 255, 0.14);
    --plyr-video-progress-buffered-background: rgba(255, 255, 255, 0.2);
    --plyr-tooltip-background: rgba(14, 15, 26, 0.94);
    --plyr-tooltip-color: var(--text);
    --plyr-tooltip-radius: 8px;
    --plyr-tooltip-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    /* How far the subtitles move up while the control bar shows */
    --dock-lift: 84px;
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 14px;
    overflow: hidden;
    background: #000;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    container-type: inline-size;
}

.video-container:fullscreen {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
}

.video-container:-webkit-full-screen {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
    border-radius: 0;
    box-shadow: none;
}

.video-container :deep(.plyr),
.video-container video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
}

/* Without Plyr's own stacking context its control bar, and the settings panel in it, can sit above the
   buffering spinner */
.video-container :deep(.plyr) {
    z-index: auto;
}

.video-container video {
    object-fit: contain;
    background: #000;
}

.video-container :deep(.plyr__captions) {
    font-size: calc(clamp(16px, 2.6cqw, 60px) * var(--caption-scale, 1));
}

.video-container :deep(.plyr__caption) {
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
}

/* Before the movie starts, the backdrop fills the player and our own play button replaces Plyr's */
.video-container :deep(.plyr__poster) {
    background-size: cover;
}

.video-container:not(.started) :deep(.plyr__control--overlaid) {
    display: none;
}

/* Plyr's control bar, made into a glass dock like the settings panel: the timeline on top, the playback
   buttons, volume and time below it on the left, and the subtitle, settings and fullscreen buttons on the right */
.video-container :deep(.plyr__controls) {
    left: 12px;
    right: 12px;
    bottom: 12px;
    display: grid;
    grid-template-columns: repeat(6, auto) 1fr repeat(3, auto);
    grid-template-areas:
        "seek seek seek seek seek seek seek seek seek seek"
        "play rewind forward volume current duration . captions settings fullscreen";
    align-items: center;
    column-gap: 2px;
    padding: 4px 10px 8px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    background: linear-gradient(180deg, rgba(26, 28, 44, 0.8) 0%, rgba(14, 15, 26, 0.88) 100%);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
    backdrop-filter: blur(18px) saturate(150%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 18px 48px rgba(0, 0, 0, 0.45);
    transition: opacity 0.3s ease, transform 0.3s ease;
}

.video-container:fullscreen :deep(.plyr__controls) {
    left: 24px;
    right: 24px;
    bottom: 24px;
    max-width: 1200px;
    margin: 0 auto;
}

.video-container:-webkit-full-screen :deep(.plyr__controls) {
    left: 24px;
    right: 24px;
    bottom: 24px;
    max-width: 1200px;
    margin: 0 auto;
}

/* Sinks a little as it fades instead of dropping out of the player */
.video-container :deep(.plyr--hide-controls .plyr__controls) {
    transform: translateY(10px);
}

.video-container :deep(.plyr__controls .plyr__controls__item) {
    margin: 0;
}

.video-container :deep(.plyr__controls .plyr__progress__container) {
    grid-area: seek;
    padding: 0 4px;
}

.video-container :deep([data-plyr="play"]) {
    grid-area: play;
}

.video-container :deep([data-plyr="rewind"]) {
    grid-area: rewind;
}

.video-container :deep([data-plyr="fast-forward"]) {
    grid-area: forward;
}

.video-container :deep(.plyr__volume) {
    grid-area: volume;
}

.video-container :deep(.plyr__time--current) {
    grid-area: current;
}

.video-container :deep(.plyr__time--duration) {
    grid-area: duration;
}

.video-container :deep([data-plyr="captions"]) {
    grid-area: captions;
}

.video-container :deep(.plyr__controls .plyr__menu) {
    grid-area: settings;
}

.video-container :deep([data-plyr="fullscreen"]) {
    grid-area: fullscreen;
}

.video-container :deep(.plyr__controls .plyr__control) {
    border-radius: 50%;
    transition: background-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
}

.video-container :deep(.plyr__controls .plyr__control:active) {
    transform: scale(0.92);
}

/* Play stands out as a white disc, like the picked chip in the settings */
.video-container :deep(.plyr__controls [data-plyr="play"]) {
    margin-right: 6px;
    background: #f2f2f4;
    color: #0b0b10;
}

.video-container :deep(.plyr__controls [data-plyr="play"]:hover) {
    background: #fff;
    color: #0b0b10;
}

/* Subtitles on: the button turns gold */
.video-container :deep([data-plyr="captions"].plyr__control--pressed) {
    color: var(--accent);
}

.video-container :deep(.plyr__controls .plyr__time) {
    padding: 0;
    color: var(--text);
    font-size: 0.86rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.video-container :deep(.plyr__volume + .plyr__time--current) {
    margin-left: 10px;
}

.video-container :deep(.plyr__controls .plyr__time--duration) {
    color: var(--text-muted);
    font-weight: 500;
}

.video-container :deep(.plyr__time + .plyr__time::before) {
    content: '/';
    margin: 0 6px;
    color: var(--text-faint);
}

.video-container :deep(.plyr__volume input[type="range"]) {
    width: 76px;
    min-width: 0;
    margin: 0 4px 0 2px;
}

/* The timeline and the volume share the settings sliders' look: a gold fill and a white thumb with a gold halo */
.video-container :deep(.plyr__controls input[type="range"]::-moz-range-progress) {
    background: linear-gradient(90deg, #c9a15a, var(--accent));
}

.video-container :deep(.plyr__controls input[type="range"]::-webkit-slider-runnable-track) {
    background-image: linear-gradient(90deg, #c9a15a, var(--accent));
    background-repeat: no-repeat;
    background-size: var(--value, 0%) 100%;
}

.video-container :deep(.plyr__controls input[type="range"]:hover::-moz-range-thumb) {
    box-shadow: var(--plyr-range-thumb-shadow), 0 0 0 6px rgba(233, 195, 123, 0.28);
}

.video-container :deep(.plyr__controls input[type="range"]:hover::-webkit-slider-thumb) {
    box-shadow: var(--plyr-range-thumb-shadow), 0 0 0 6px rgba(233, 195, 123, 0.28);
}

/* The timeline's thumb only shows while it's pointed at, and the line thickens a little then */
.video-container :deep(.plyr__progress input[type="range"]::-moz-range-thumb) {
    transform: scale(0);
}

.video-container :deep(.plyr__progress input[type="range"]::-webkit-slider-thumb) {
    transform: scale(0);
}

.video-container :deep(.plyr__progress__container:hover) {
    --plyr-range-track-height: 6px;
}

.video-container :deep(.plyr__progress__container:hover input[type="range"]::-moz-range-thumb) {
    transform: none;
}

.video-container :deep(.plyr__progress__container:hover input[type="range"]::-webkit-slider-thumb) {
    transform: none;
}

/* The time under the pointer, in a dark pill like the rest of the player */
.video-container :deep(.plyr__progress .plyr__tooltip) {
    padding: 5px 9px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.82rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
}

/* Subtitles move up over the dock while it shows */
.video-container :deep(.plyr:not(.plyr--hide-controls) .plyr__controls:not(:empty) ~ .plyr__captions) {
    transform: translateY(calc(-1 * var(--dock-lift)));
}

.video-container:fullscreen {
    --dock-lift: 96px;
}

.video-container:-webkit-full-screen {
    --dock-lift: 96px;
}

/* The big button over a paused movie is the same glass circle as the start button */
.video-container :deep(.plyr__control--overlaid) {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.35);
    background: rgba(10, 11, 20, 0.45);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
    color: #fff;
}

.video-container.started :deep(.plyr--full-ui.plyr--video .plyr__control--overlaid) {
    display: grid;
}

.video-container :deep(.plyr__control--overlaid:hover) {
    background: rgba(255, 255, 255, 0.2);
    transform: translate(-50%, -50%) scale(1.06);
}

.video-container :deep(.plyr__control--overlaid svg) {
    left: 2px;
    width: 34px;
    height: 34px;
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

/* The spinner shows over the video while it buffers; the player controls stay above it and usable */
.overlay.loading {
    z-index: 2;
    background: rgba(0, 0, 0, 0.35);
    pointer-events: none;
}

.overlay-note {
    max-width: 40ch;
    margin: 4px 0 0;
    font-size: 1rem;
    font-weight: 600;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.7);
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

/* The settings panel grows out of the gear */
.settings-enter-active {
    transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-leave-active {
    transition: opacity 0.14s ease, transform 0.14s ease;
}

.settings-enter-from,
.settings-leave-to {
    opacity: 0;
    transform: translateY(6px) scale(0.96);
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
    .video-container {
        border-radius: 10px;
    }

    .play-button {
        width: 72px;
        height: 72px;
    }

    .facts {
        gap: 6px 14px;
    }
}
</style>
