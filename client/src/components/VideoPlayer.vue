<template>
    <!-- Also the fullscreen element, so the overlays below and the popups stay visible in fullscreen.
         Clicking a control never focuses it, so Space always pauses instead of pressing that control. -->
    <div
        ref="videoContainer"
        class="video-container"
        :class="{ started: start }"
        :style="captionStyle"
        @mousedown.capture="keepFocus"
        @mousemove.capture="ignoreStillMoves"
    >
        <!-- Plyr owns this element; its source and subtitle tracks are set from code -->
        <video ref="video" controls playsinline preload="none" :poster="poster"></video>

        <div v-if="!start" class="overlay start">
            <template v-if="ready">
                <button class="play-button" type="button" tabindex="-1" :aria-label="resumeAt ? `Resume from ${formatTime(resumeAt)}` : 'Play'" @click="startPlayback()">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.6 5.75v12.5L18.1 12z" /></svg>
                </button>
                <template v-if="resumeAt">
                    <p class="resume">Resume from {{ formatTime(resumeAt) }}</p>
                    <button class="start-over" type="button" tabindex="-1" @click="startPlayback(true)">Start from the beginning</button>
                </template>
                <slot name="start" />
            </template>
            <slot v-else name="waiting" />
        </div>

        <div v-if="start && (!src || !isVideoLoaded || buffering) && !loadError && !error" class="overlay loading">
            <LoadingSpinner :size="60" label="Loading the video" />
            <p v-if="streamNote || note" class="overlay-note">{{ streamNote || note }}</p>
            <slot name="loading" />
        </div>

        <div v-if="start && (loadError || error)" class="overlay failed">
            <p class="overlay-message">{{ error || loadError }}</p>
            <div class="failed-actions">
                <button v-if="!error" class="retry" type="button" tabindex="-1" @click="retry">Try again</button>
                <slot name="failed" />
            </div>
        </div>

        <slot name="overlay" />

        <!-- Extra buttons (e.g. the next episode) sit in Plyr's control bar after fast forward -->
        <Teleport v-if="extraSlot && $slots.controls" :to="extraSlot">
            <slot name="controls" />
        </Teleport>

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
                    :audio-tracks="audioTracks"
                    :current-audio="currentAudio"
                    :media-label="mediaLabel"
                    @update:speed="setSpeed"
                    @select-track="selectTrack"
                    @update:offset="setOffset"
                    @update:subtitle-style="setSubtitleStyle"
                    @select-audio="$emit('select-audio', $event)"
                />
            </Transition>
        </Teleport>
    </div>
</template>

<script>
import { markRaw } from 'vue';
import Plyr from 'plyr';
import 'plyr/dist/plyr.css';
import { connection } from '../connection';
import { loadOffset, loadStyle, saveOffset, saveStyle, shiftCues } from '../subtitles';
import { SubtitleStream, emptyTrackSrc } from '../subtitleStream';
import LoadingSpinner from './LoadingSpinner.vue';
import PlayerSettings from './PlayerSettings.vue';

// How often the position is saved while watching
const SAVE_INTERVAL = 15000;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// A stream that gets no data for this long while the video waits for it is loaded again. Before the
// video has played at all the server may still be loading the torrent, which can take a minute.
const STALL_TIMEOUT = 15000;
const START_TIMEOUT = 75000;
// A converted video waits for the server to make each segment, which a slow torrent can drag out
const HLS_STALL_TIMEOUT = 45000;
const HLS_START_TIMEOUT = 150000;
// Data that keeps coming in without adding to what's loaded where the video waits doesn't keep it alive for
// longer than this (or the timeouts above, when they're longer)
const GROWTH_TIMEOUT = 60000;
// Seconds loaded where the video waits that should have it playing. When it still doesn't move for
// STALL_TIMEOUT, the browser is stuck on this stream and waiting longer doesn't help.
const STUCK_AHEAD = 10;
// Times a broken stream is loaded again before the error is shown, when it doesn't play in between
const MAX_RECOVERIES = 4;
// Plyr's own settings icon
const SETTINGS_ICON = 'M16.135 7.784a2 2 0 01-1.23-2.969c.322-.536.225-.998-.094-1.316l-.31-.31c-.318-.318-.78-.415-1.316-.094a2 2 0 01-2.969-1.23C10.065 1.258 9.669 1 9.219 1h-.438c-.45 0-.845.258-.997.865a2 2 0 01-2.969 1.23c-.536-.322-.999-.225-1.317.093l-.31.31c-.318.318-.415.781-.093 1.317a2 2 0 01-1.23 2.969C1.26 7.935 1 8.33 1 8.781v.438c0 .45.258.845.865.997a2 2 0 011.23 2.969c-.322.536-.225.998.094 1.316l.31.31c.319.319.782.415 1.316.094a2 2 0 012.969 1.23c.151.607.547.865.997.865h.438c.45 0 .845-.258.997-.865a2 2 0 012.969-1.23c.535.321.997.225 1.316-.094l.31-.31c.318-.318.415-.781.094-1.316a2 2 0 011.23-2.969c.607-.151.865-.547.865-.997v-.438c0-.451-.26-.846-.865-.997zM9 12a3 3 0 110-6 3 3 0 010 6z';

// hls.js is only downloaded for the first video that needs it
let hlsModule = null;
function loadHls() {
    if (!hlsModule) {
        hlsModule = import('hls.js').then(module => module.default).catch((err) => {
            hlsModule = null;
            throw err;
        });
    }
    return hlsModule;
}

// Segments come from a torrent while it downloads, so the server can take long to answer
const HLS_CONFIG = {
    maxBufferLength: 60,
    maxMaxBufferLength: 180,
    backBufferLength: 60,
    fragLoadPolicy: {
        default: {
            maxTimeToFirstByteMs: 120000,
            maxLoadTimeMs: 180000,
            timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
        }
    },
    playlistLoadPolicy: {
        default: {
            maxTimeToFirstByteMs: 90000,
            maxLoadTimeMs: 120000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
            errorRetry: { maxNumRetry: 3, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
        }
    },
    // Converted videos carry no subtitles, and hls.js would empty and switch off the page's own tracks
    subtitleStreamController: null,
    subtitleTrackController: null,
    timelineController: null
};

/**
 * The video player of the movie and series pages. It plays `src` (a file or, with `srcType` 'hls', a
 * converted video), shows the start, loading and error overlays, keeps the stream alive through network
 * changes and reports progress through `saveProgress(payload, { beacon, contentKey })`.
 *
 * A new `contentKey` is another video (the next episode): the player keeps running, so fullscreen stays,
 * and plays it from `resumeAt` once its `src` is there. A new `src` for the same content is another
 * source of the same video, which continues where the old one was.
 */
export default {
    name: 'VideoPlayer',
    components: {
        LoadingSpinner,
        PlayerSettings
    },
    props: {
        src: {
            type: String,
            default: ''
        },
        // 'file' (played as it is) or 'hls' (converted by the server)
        srcType: {
            type: String,
            default: 'file'
        },
        contentKey: {
            type: String,
            required: true
        },
        poster: {
            type: String,
            default: ''
        },
        // Seconds to start from; the start screen offers to start over instead
        resumeAt: {
            type: Number,
            default: 0
        },
        // Whether the play button can be pressed; the 'waiting' slot shows instead until then
        ready: {
            type: Boolean,
            default: false
        },
        // [{ label, srclang, src, default }], or with `stream` instead of `src` for subtitles read from the
        // video file while it plays (see subtitleStream.js). Plyr turns on the first in the viewer's language;
        // `default` is for the browser's own controls on phones.
        subtitles: {
            type: Array,
            default: () => []
        },
        // Where the subtitle offsets of this video are kept (see subtitles.js)
        subtitleKey: {
            type: String,
            required: true
        },
        // 'movie' or 'episode', for the texts
        mediaLabel: {
            type: String,
            default: 'movie'
        },
        // While a dialog is open the keyboard belongs to it
        blocked: {
            type: Boolean,
            default: false
        },
        saveProgress: {
            type: Function,
            default: null
        },
        // Shown under the spinner while the video loads, e.g. what it's waiting for
        note: {
            type: String,
            default: ''
        },
        failMessage: {
            type: String,
            default: "The video couldn't be loaded. Try again or pick another source."
        },
        // A problem the page found before the video could load, shown like a failed stream
        error: {
            type: String,
            default: ''
        },
        // [{ index, label }] audio tracks the viewer can switch between
        audioTracks: {
            type: Array,
            default: () => []
        },
        currentAudio: {
            type: Number,
            default: null
        }
    },
    emits: ['started', 'playing', 'failed', 'ended', 'time', 'select-audio'],
    data() {
        return {
            start: false,
            isVideoLoaded: false,
            buffering: false,
            loadError: null,
            player: null,
            // The elements in Plyr's control bar that hold the settings button and the extra buttons
            settingsSlot: null,
            extraSlot: null,
            settingsOpen: false,
            settingsIcon: SETTINGS_ICON,
            speed: 1,
            speeds: SPEEDS,
            // [{ index, label, language, fromFile, syncKey, status }], in the order of the video's text tracks
            subtitleTracks: [],
            currentTrack: -1,
            subtitleOffset: 0,
            subtitleStyle: loadStyle(),
            // null, 'reconnecting' or 'offline' while the stream is being picked up again
            streamState: null
        };
    },
    computed: {
        isMobile() {
            return window.innerWidth < 768;
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
            if (this.streamState === 'offline') return `You're offline. The ${this.mediaLabel} continues when the connection is back.`;
            if (this.streamState === 'reconnecting') return 'Reconnecting…';
            return '';
        },
        sourceState() {
            return { contentKey: this.contentKey, src: this.src };
        }
    },
    watch: {
        // Both change together when the next episode comes, so they're looked at together
        sourceState(state, previous) {
            if (state.contentKey !== previous.contentKey) {
                this.changeContent(previous.contentKey);
            } else if (state.src !== previous.src) {
                this.changeSource();
            }
        },
        subtitles() {
            // A source change can bring other subtitles (English ones from its torrent)
            if (this.start && this.src) this.syncSubtitleTracks();
        }
    },
    created() {
        this.resetProgress();

        // Stream health, see checkStream
        this.lastDataAt = Date.now();
        this.lastGrowthAt = Date.now();
        this.lastAhead = 0;
        this.recoveries = 0;
        this.recovering = false;
        this.waitingForNetwork = false;
        this.staleStream = false;
        this.trackElements = [];
        // The SubtitleStream of each track whose subtitles come from the video file
        this.streams = [];
        // The kind of subtitles the viewer picked last, { language, fromFile }, so the next video gets the same
        this.trackChoice = null;
        this.hls = null;
        this.hlsMediaErrors = 0;
        // Subtitle offsets of this video by language, read from storage the first time they're needed
        this.offsets = {};

        this.stopReconnect = connection.onReconnect(() => this.onReconnect());
    },
    mounted() {
        this.onKeydown = (event) => this.handleKey(event);
        this.onPointerUp = () => {
            this.releaseControls();
            this.dropFocus();
        };
        this.onPointerDown = (event) => this.closeSettingsOutside(event);
        this.onResize = () => this.fitSettings();
        window.addEventListener('keydown', this.onKeydown, true);
        window.addEventListener('pointerup', this.onPointerUp, true);
        window.addEventListener('pointerdown', this.onPointerDown, true);
        window.addEventListener('resize', this.onResize);
        document.addEventListener('fullscreenchange', this.onResize);

        this.setupPlayer();
    },
    methods: {
        resetProgress() {
            // Progress bookkeeping, kept out of the reactive data on purpose
            this.lastTime = null;
            this.unsavedWatch = 0;
            this.lastSavedPosition = null;
            this.pendingSeek = null;
            this.duration = null;
            // Set once the video has really played since it was loaded
            this.everPlayed = false;
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

                this.addControlSlots();
                // Like Plyr's own menu, the settings close when the controls hide
                this.player.on('controlshidden', () => {
                    this.settingsOpen = false;
                });
                for (const event of ['captionsenabled', 'captionsdisabled', 'languagechange']) {
                    this.player.on(event, () => this.syncCaptions());
                }
            }

            // Plyr's controls stay out of the Tab order, so the keyboard always controls the video itself
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
                    this.lastGrowthAt = Date.now();
                },
                // Data is arriving, so the stream is alive even while the video still waits for enough of it
                progress: () => {
                    this.lastDataAt = Date.now();
                },
                error: () => this.onVideoError(),
                timeupdate: () => this.onTimeUpdate(),
                seeking: () => this.updateStreams(true),
                seeked: () => {
                    this.lastTime = videoElement.currentTime;
                    this.persistProgress();
                },
                play: () => {
                    // The connection came back while the video was paused, its old stream is gone
                    if (this.staleStream) this.resumeStream();
                },
                pause: () => this.persistProgress(),
                ended: () => {
                    this.persistProgress();
                    this.$emit('ended');
                },
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
            // Without Plyr the browser's own menu turns subtitles on and off
            this.onTextTracksChange = () => this.updateStreams();
            videoElement.textTracks.addEventListener('change', this.onTextTracksChange);

            this.streamTimer = setInterval(() => this.checkStream(), 2000);
        },
        addControlSlots() {
            const controls = this.player.elements.controls;
            if (!controls) return;
            const settings = document.createElement('div');
            settings.className = 'plyr__controls__item plyr__menu';
            controls.insertBefore(settings, controls.querySelector('[data-plyr="fullscreen"]'));
            this.settingsSlot = settings;

            const extra = document.createElement('div');
            extra.className = 'plyr__controls__item player-extra';
            const forward = controls.querySelector('[data-plyr="fast-forward"]');
            controls.insertBefore(extra, forward ? forward.nextSibling : null);
            this.extraSlot = extra;
        },
        // Called by the page too, e.g. by a play button outside the player
        startPlayback(fromBeginning = false) {
            const videoElement = this.$refs.video;
            if (!videoElement || this.start) return;

            this.start = true;
            // Plyr counts the pointer over the start screen as over its controls, which it never hides then.
            // The start screen goes away without a mouseleave, so that's undone here.
            if (this.player && this.player.elements.controls) this.player.elements.controls.hover = false;
            this.$emit('started');
            if (this.src) this.loadVideo(fromBeginning ? 0 : this.resumeAt);
            this.startSavingProgress();
        },
        // Another video comes in: what's left of the old one is saved under its own key first
        changeContent(previousKey) {
            this.persistProgress({ contentKey: previousKey });
            this.resetProgress();
            this.recoveries = 0;
            this.streamState = null;
            this.loadError = null;
            this.isVideoLoaded = false;
            this.buffering = false;
            this.offsets = {};
            this.stopVideo();
            if (this.start && this.src) this.loadVideo(this.resumeAt);
        },
        // Another source of the same video continues where the old one was
        changeSource() {
            if (!this.start) return;
            this.loadError = null;
            if (!this.src) {
                this.stopVideo();
                this.isVideoLoaded = false;
                return;
            }
            const videoElement = this.$refs.video;
            const position = this.everPlayed ? (this.lastTime || videoElement.currentTime) : (this.pendingSeek !== null ? this.pendingSeek : this.resumeAt);
            this.recoveries = 0;
            this.loadVideo(position || 0);
        },
        stopVideo() {
            const videoElement = this.$refs.video;
            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }
            if (videoElement) {
                videoElement.pause();
                videoElement.removeAttribute('src');
                videoElement.load();
            }
        },
        // Points the player at the source and starts playing at `startAt` seconds
        async loadVideo(startAt) {
            const videoElement = this.$refs.video;
            const src = this.src;
            this.isVideoLoaded = false;
            this.buffering = false;
            this.loadError = null;
            this.pendingSeek = startAt > 0 ? startAt : null;
            this.lastTime = null;
            this.lastDataAt = Date.now();
            this.lastGrowthAt = Date.now();
            this.lastAhead = 0;
            this.staleStream = false;
            this.hlsMediaErrors = 0;
            this.syncSubtitleTracks();

            if (this.hls) {
                this.hls.destroy();
                this.hls = null;
            }

            // iPhones play HLS themselves and have no MediaSource for hls.js
            const nativeHls = !!videoElement.canPlayType('application/vnd.apple.mpegurl') && !window.MediaSource;
            if (this.srcType === 'hls' && !nativeHls) {
                let Hls;
                try {
                    Hls = await loadHls();
                } catch (err) {
                    this.showLoadError();
                    return;
                }
                // Another source or video came in while hls.js was loading
                if (this.destroyed || src !== this.src) return;
                if (!Hls.isSupported()) {
                    this.showLoadError("This browser can't play converted videos.");
                    return;
                }
                const hls = new Hls({ ...HLS_CONFIG, startPosition: startAt > 0 ? startAt : -1 });
                hls.on(Hls.Events.ERROR, (event, data) => this.onHlsError(Hls, data));
                for (const event of [Hls.Events.FRAG_LOADED, Hls.Events.FRAG_BUFFERED, Hls.Events.MANIFEST_LOADED]) {
                    hls.on(event, () => {
                        this.lastDataAt = Date.now();
                    });
                }
                hls.loadSource(src);
                hls.attachMedia(videoElement);
                this.hls = markRaw(hls);
            } else {
                videoElement.src = src;
                if (startAt > 0) {
                    // Browsers remember this until the metadata is loaded; onLoadedMetadata makes sure
                    videoElement.currentTime = startAt;
                }
            }

            const playing = this.player ? this.player.play() : videoElement.play();
            if (playing && playing.catch) {
                playing.catch(error => {
                    console.error('Error playing video:', error);
                });
            }
        },
        // hls.js retries what it can by itself; only what it gives up on counts as a broken stream
        onHlsError(Hls, data) {
            if (!data.fatal || !this.start) return;
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.hlsMediaErrors < 2) {
                this.hlsMediaErrors += 1;
                if (this.hlsMediaErrors === 2) this.hls.swapAudioCodec();
                this.hls.recoverMediaError();
                return;
            }
            console.error('HLS error:', data.details);
            this.buffering = false;
            this.isVideoLoaded = false;
            this.recoverStream({ failed: true });
        },
        onLoadedMetadata() {
            const videoElement = this.$refs.video;
            // hls.js starts at the position itself
            if (!this.hls && this.pendingSeek !== null && Number.isFinite(videoElement.duration)) {
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
            this.lastGrowthAt = Date.now();
            this.$emit('playing');

            if (!this.everPlayed) {
                this.everPlayed = true;
                // Saved as soon as the video plays, so it's in the history even when it's left right away
                this.persistProgress();
            }
        },
        onVideoError() {
            // Taking the old source away when the next video comes in isn't an error
            if (!this.start || (!this.$refs.video.getAttribute('src') && !this.hls)) return;
            const videoElement = this.$refs.video;
            console.error('Video error:', videoElement.error);
            this.buffering = false;
            // A video the viewer paused loads its stream again once it's played
            if (videoElement.paused && this.everPlayed) {
                this.staleStream = true;
                return;
            }
            this.isVideoLoaded = false;
            this.recoverStream({ failed: true });
        },
        showLoadError(message) {
            this.streamState = null;
            this.loadError = message || this.failMessage;
            this.isVideoLoaded = false;
            this.$emit('failed', { everPlayed: this.everPlayed });
        },
        // Runs every 2 seconds. A video that waits for data that doesn't come has lost its stream, which
        // happens when the network changes: the old connection just goes quiet. So has one whose data never
        // reaches the spot the video waits at, or that has plenty there and still doesn't play.
        checkStream() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start || !this.src || this.loadError || this.recovering || this.waitingForNetwork) return;

            const now = Date.now();
            const ahead = this.bufferedAhead();
            if (ahead > this.lastAhead + 0.25) this.lastGrowthAt = now;
            this.lastAhead = ahead;

            const waiting = !videoElement.paused && !videoElement.ended && (!this.isVideoLoaded || this.buffering);
            if (!waiting) {
                this.lastDataAt = now;
                this.lastGrowthAt = now;
                return;
            }

            // A torrent that is just slow gets more and more time
            const converted = this.srcType === 'hls';
            const limit = this.everPlayed
                ? (converted ? HLS_STALL_TIMEOUT : STALL_TIMEOUT) * 2 ** this.recoveries
                : (converted ? HLS_START_TIMEOUT : START_TIMEOUT);
            const stuck = ahead >= STUCK_AHEAD && now - this.lastGrowthAt > STALL_TIMEOUT;
            if (stuck) console.warn(`The video doesn't play with ${Math.round(ahead)}s loaded`);
            if (stuck || now - this.lastDataAt > limit || now - this.lastGrowthAt > Math.max(limit, GROWTH_TIMEOUT)) {
                // One that never played is given up on right away, so the page can try another source
                this.recoverStream({ failed: stuck });
            }
        },
        // Loads a broken stream again from where the video is, or waits for the connection to come back first
        async recoverStream({ failed }) {
            if (this.recovering) return;
            this.recovering = true;
            this.streamState = 'reconnecting';
            const online = await connection.check();
            this.recovering = false;
            if (this.destroyed || !this.start) return;

            if (!online) {
                // onReconnect picks the video up again
                this.waitingForNetwork = true;
                this.streamState = 'offline';
                return;
            }

            // With a working connection, a video that failed before it ever played can't be loaded from this source
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
        // The connection died with the old network, so the stream is loaded again from where the video is
        onReconnect() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start || videoElement.ended || (this.loadError && !this.waitingForNetwork)) return;

            this.waitingForNetwork = false;
            this.streamState = null;
            this.recoveries = 0;
            // A paused video loads again once it's played, so nothing is downloaded until then
            if (videoElement.paused) {
                this.staleStream = true;
                return;
            }
            this.resumeStream();
        },
        resumeStream() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.src) return;
            const position = this.pendingSeek !== null ? this.pendingSeek : (videoElement.currentTime || this.lastTime || this.resumeAt);
            this.loadVideo(position);
        },
        retry() {
            const videoElement = this.$refs.video;
            const position = this.lastTime || videoElement.currentTime || this.resumeAt;
            this.recoveries = 0;
            if (this.src) {
                this.loadVideo(position);
            } else {
                this.loadError = null;
            }
        },
        // Seconds of video ready to play after the current spot
        bufferedAhead() {
            const videoElement = this.$refs.video;
            if (!videoElement || !this.start) return 0;
            const time = videoElement.currentTime;
            for (let i = 0; i < videoElement.buffered.length; i++) {
                if (videoElement.buffered.start(i) <= time + 0.5 && videoElement.buffered.end(i) >= time) {
                    return videoElement.buffered.end(i) - time;
                }
            }
            return 0;
        },
        isPaused() {
            const videoElement = this.$refs.video;
            return !videoElement || videoElement.paused;
        },
        // Where the video is now, for the page to continue another source there
        position() {
            const videoElement = this.$refs.video;
            if (!this.start || !videoElement) return this.resumeAt;
            return this.lastTime || videoElement.currentTime || this.resumeAt;
        },
        // Puts the subtitle tracks of the current video on, unless they're on already
        syncSubtitleTracks() {
            const signature = this.subtitles.map(track => track.src || track.stream).join('|');
            if (signature === this.placedSubtitles) return;
            this.placedSubtitles = signature;
            this.replaceSubtitleTracks();
        },
        replaceSubtitleTracks() {
            const videoElement = this.$refs.video;
            // Plyr only takes the new track when its place in the list differs from the old one's. Otherwise
            // it keeps turning on the removed track and the new one stays off, so it's made to pick again.
            if (this.player) this.player.captions.currentTrack = -1;
            this.streams.forEach(stream => stream && stream.stop());
            this.streams = [];
            this.trackElements.forEach(track => track.remove());
            this.trackElements = [];
            // The ones from the video file keep their own sync, the file's timing isn't a download's
            this.subtitleTracks = this.subtitles.map(({ label, srclang, stream }, index) => ({
                index,
                label,
                language: srclang,
                fromFile: !!stream,
                syncKey: stream ? `${srclang}-file` : srclang,
                status: 'idle'
            }));

            this.subtitles.forEach(({ label, srclang, src, stream, default: isDefault }, index) => {
                const track = document.createElement('track');
                track.kind = 'subtitles';
                track.label = label;
                track.srclang = srclang;
                // Subtitles from the video file go into a track that starts empty
                track.src = stream ? emptyTrackSrc() : src;
                // The browser would show a default track itself next to the one Plyr shows (Firefox does)
                if (isDefault && !this.player) track.default = true;
                if (stream) {
                    this.streams[index] = new SubtitleStream({
                        url: stream,
                        getTrack: () => track.track,
                        onStatus: status => this.setTrackStatus(index, status),
                        onCues: () => this.applyOffset(index)
                    });
                } else {
                    track.addEventListener('load', () => {
                        this.setTrackStatus(index, 'ready');
                        this.applyOffset(index);
                    });
                }
                track.addEventListener('error', () => this.setTrackStatus(index, 'error'));
                videoElement.appendChild(track);
                this.trackElements[index] = track;
            });
            this.updateStreams();
        },
        setTrackStatus(index, status) {
            const track = this.subtitleTracks[index];
            if (!track) return;
            track.status = status;
            // Subtitles that can't be shown give way to others in the same language
            if (status === 'error' && index === this.currentTrack) {
                const other = this.subtitleTracks.find(item => item.language === track.language && item.status !== 'error');
                if (other) this.showTrack(other.index);
            }
        },
        // Reads the subtitles from the video file that are on around where the video is, and stops the others
        updateStreams(seeking = false) {
            const videoElement = this.$refs.video;
            if (!videoElement) return;
            const time = this.pendingSeek !== null ? this.pendingSeek : videoElement.currentTime;
            const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : (this.duration || Infinity);
            this.streams.forEach((stream, index) => {
                if (!stream) return;
                const element = this.trackElements[index];
                const on = this.player ? this.currentTrack === index : !!element && element.track.mode === 'showing';
                if (on && this.start && this.src) {
                    stream.update(time, duration, seeking);
                } else {
                    stream.stop();
                }
            });
        },
        // Mirrors the subtitles Plyr shows (its CC button and the C key change them too)
        syncCaptions() {
            if (!this.player) return;
            this.currentTrack = this.player.currentTrack;

            // Plyr turns on the first track in the viewer's language; the kind they picked last goes first
            const shown = this.subtitleTracks[this.currentTrack];
            const choice = this.trackChoice;
            if (shown && choice && shown.language === choice.language && shown.fromFile !== choice.fromFile) {
                const preferred = this.subtitleTracks.find(item => item.language === choice.language && item.fromFile === choice.fromFile && item.status !== 'error');
                if (preferred) {
                    this.showTrack(preferred.index);
                    return;
                }
            }

            this.updateStreams();
            const track = this.subtitleTracks[this.currentTrack];
            if (!track) return;
            this.subtitleOffset = this.offsetFor(track.syncKey);
            const element = this.trackElements[this.currentTrack];
            // Selecting a track makes the browser download it
            if (element && element.readyState < 2 && track.status !== 'error' && !this.streams[this.currentTrack]) track.status = 'loading';
        },
        // The viewer picked subtitles in the settings, or -1 to turn them off
        selectTrack(index) {
            if (!this.player) return;
            const track = this.subtitleTracks[index];
            if (track) this.trackChoice = { language: track.language, fromFile: track.fromFile };
            this.showTrack(index);
        },
        // Plyr's own way, its currentTrack setter, starts its captions over and then turns on the first track
        // in that language again, so of two English tracks the second could never be picked. Its state is set
        // here like its internal set() does it.
        showTrack(index) {
            if (!this.player) return;
            const element = this.trackElements[index];
            if (index === -1 || !element) {
                this.player.toggleCaptions(false);
            } else {
                const captions = this.player.captions;
                captions.currentTrack = index;
                captions.currentTrackNode = element.track;
                captions.language = element.track.language;
                this.player.storage.set({ language: element.track.language });
                // Turns it on (Plyr loads it by making it 'hidden'), and draws its lines right away
                this.player.toggleCaptions(true);
                element.track.dispatchEvent(new Event('cuechange'));
            }
            this.syncCaptions();
        },
        offsetFor(syncKey) {
            if (!(syncKey in this.offsets)) this.offsets[syncKey] = loadOffset(this.subtitleKey, syncKey);
            return this.offsets[syncKey];
        },
        setOffset(offset) {
            const track = this.subtitleTracks[this.currentTrack];
            if (!track) return;
            this.subtitleOffset = offset;
            this.offsets[track.syncKey] = offset;
            saveOffset(this.subtitleKey, track.syncKey, offset);
            this.applyOffset(this.currentTrack);
        },
        applyOffset(index) {
            const element = this.trackElements[index];
            const track = this.subtitleTracks[index];
            if (!element || !track) return;
            shiftCues(element.track, this.offsetFor(track.syncKey));
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
        // The panel opens above the timeline and may not grow taller than the player
        fitSettings() {
            const container = this.$refs.videoContainer;
            const timeline = this.player && this.player.elements.controls.querySelector('.plyr__progress__container');
            if (!container || !this.settingsSlot || !timeline) return;
            const controlsTop = timeline.getBoundingClientRect().top;
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
        // Plyr shows its controls, and the pointer, on every mousemove. Some setups send one without the mouse
        // moving, e.g. when the page hides the pointer, which would bring both straight back.
        ignoreStillMoves(event) {
            const last = this.lastMouse;
            this.lastMouse = { x: event.screenX, y: event.screenY };
            if (last && last.x === event.screenX && last.y === event.screenY) event.stopPropagation();
        },
        // Plyr keeps its controls up while one of them is pressed, and only sees the press end when the button is
        // let go over them. Let go anywhere else, they (and the pointer) would never hide again.
        releaseControls() {
            if (this.player && this.player.elements.controls) this.player.elements.controls.pressed = false;
        },
        // Plyr's seek and volume sliders do take the focus while they're dragged, so it's dropped afterwards
        dropFocus() {
            setTimeout(() => {
                const focused = document.activeElement;
                const container = this.$refs.videoContainer;
                if (focused && container && focused !== document.body && container.contains(focused)) focused.blur();
            });
        },
        // Runs before Plyr's own shortcuts. Space always plays or pauses the video: a focused button or link
        // loses the focus first, so it doesn't get pressed instead.
        handleKey(event) {
            if (this.blocked || event.defaultPrevented) return;

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
                if (!event.repeat && this.ready) this.startPlayback();
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
                    this.lastGrowthAt = Date.now();
                }
            }
            this.lastTime = time;
            const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : this.duration;
            if (this.everPlayed && duration) this.$emit('time', { currentTime: time, duration });
            this.updateStreams();
        },
        startSavingProgress() {
            if (this.saveTimer) return;
            this.saveTimer = setInterval(() => this.persistProgress(), SAVE_INTERVAL);
            // Refreshing or closing the tab
            this.onPageHide = () => this.persistProgress({ beacon: true });
            this.onVisibilityChange = () => {
                if (document.visibilityState === 'hidden') this.persistProgress({ beacon: true });
            };
            window.addEventListener('pagehide', this.onPageHide);
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        },
        progressPayload() {
            const videoElement = this.$refs.video;
            // Nothing is saved before the video has really played
            if (!videoElement || !this.start || !this.everPlayed) return null;

            // While the stream loads again its duration is unknown for a moment, the last one is still right
            const duration = Number.isFinite(videoElement.duration) && videoElement.duration > 0 ? videoElement.duration : this.duration;
            if (!duration) return null;

            const position = this.pendingSeek !== null ? this.pendingSeek : videoElement.currentTime;
            const moved = this.lastSavedPosition === null || Math.abs(position - this.lastSavedPosition) >= 1;
            if (!moved && this.unsavedWatch < 0.5) return null;

            return { position: Math.min(position, duration), duration, watched: this.unsavedWatch };
        },
        persistProgress({ beacon = false, contentKey = this.contentKey } = {}) {
            if (!this.saveProgress) return;
            const payload = this.progressPayload();
            if (!payload) return;

            this.unsavedWatch = 0;
            this.lastSavedPosition = payload.position;

            const saving = this.saveProgress(payload, { beacon, contentKey });
            if (saving && saving.catch) {
                saving.catch(() => {
                    // Counted again with the next save, unless another video is playing by then
                    if (contentKey !== this.contentKey) return;
                    this.unsavedWatch += payload.watched;
                    this.lastSavedPosition = null;
                });
            }
        }
    },
    beforeUnmount() {
        // Save where we stopped before the video goes away
        this.persistProgress();
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
            videoElement.textTracks.removeEventListener('change', this.onTextTracksChange);
        }
        this.streams.forEach(stream => stream && stream.stop());

        if (this.player) {
            this.player.destroy();
        }

        // Stop the download right away, so the server can release the torrent
        this.stopVideo();
    }
};
</script>

<style scoped>
/* Subtitles are sized from the player's width (cqw), so they grow with it in fullscreen */
.video-container {
    --plyr-color-main: #e9c37b;
    --plyr-font-family: var(--font);
    --plyr-focus-visible-color: var(--accent);
    --plyr-control-icon-size: 20px;
    --plyr-control-padding: 9px;
    --plyr-video-control-color: #fff;
    --plyr-video-control-color-hover: #fff;
    --plyr-video-control-background-hover: rgba(255, 255, 255, 0.14);
    /* The timeline is drawn at half this thickness until it's pointed at */
    --plyr-range-track-height: 6px;
    --plyr-range-thumb-height: 14px;
    --plyr-range-thumb-active-shadow-width: 6px;
    --plyr-range-thumb-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
    /* Plyr reads the pressed thumb's halo of video players from the audio variable */
    --plyr-audio-range-thumb-active-shadow-color: rgba(255, 255, 255, 0.25);
    --plyr-video-range-track-background: rgba(255, 255, 255, 0.24);
    --plyr-video-progress-buffered-background: rgba(255, 255, 255, 0.24);
    --plyr-tooltip-background: rgba(14, 15, 26, 0.94);
    --plyr-tooltip-color: var(--text);
    --plyr-tooltip-radius: 8px;
    --plyr-tooltip-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    /* Frosted glass for the round play buttons over the video. The sheen and the rim make it read as glass
       even where the browser can't blur what's behind it. */
    --glass-background: radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.34) 0%, rgba(255, 255, 255, 0.1) 46%, rgba(255, 255, 255, 0.04) 100%), rgba(18, 20, 32, 0.22);
    --glass-background-hover: radial-gradient(circle at 30% 22%, rgba(255, 255, 255, 0.42) 0%, rgba(255, 255, 255, 0.16) 46%, rgba(255, 255, 255, 0.08) 100%), rgba(18, 20, 32, 0.18);
    --glass-border: 1px solid rgba(255, 255, 255, 0.42);
    --glass-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.5), inset 0 -10px 20px rgba(0, 0, 0, 0.14), 0 12px 32px rgba(0, 0, 0, 0.35);
    --glass-blur: blur(14px) saturate(170%);
    /* How far the subtitles move up while the controls show */
    --controls-lift: 72px;
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

/* Plyr's control bar has no panel of its own: the controls float over a soft shadow that rises from the bottom
   of the video. The timeline runs along the top; the playback buttons, volume and time sit under it on the left
   and the subtitle, settings and fullscreen buttons on the right. */
.video-container :deep(.plyr__controls) {
    display: grid;
    grid-template-columns: repeat(7, auto) 1fr repeat(3, auto);
    grid-template-areas:
        "seek seek seek seek seek seek seek seek seek seek seek"
        "play rewind forward extra volume current duration . captions settings fullscreen";
    align-items: center;
    column-gap: 4px;
    padding: 64px 18px 10px;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.8) 0%, rgba(0, 0, 0, 0.58) 26%, rgba(0, 0, 0, 0.26) 58%, rgba(0, 0, 0, 0.08) 82%, rgba(0, 0, 0, 0) 100%);
    transition: opacity 0.35s ease, transform 0.35s ease;
}

.video-container:fullscreen :deep(.plyr__controls) {
    padding: 110px 40px 24px;
}

.video-container:-webkit-full-screen :deep(.plyr__controls) {
    padding: 110px 40px 24px;
}

/* The pointer goes away with the controls. Plyr only hides it when its own element is fullscreen, and here
   the fullscreen element is the container around it. */
.video-container :deep(.plyr--hide-controls) {
    cursor: none;
}

/* Sinks a little as it fades out */
.video-container :deep(.plyr--hide-controls .plyr__controls) {
    transform: translateY(8px);
}

.video-container :deep(.plyr__controls .plyr__controls__item) {
    margin: 0;
}

.video-container :deep(.plyr__controls .plyr__progress__container) {
    grid-area: seek;
    margin-bottom: 2px;
    padding: 0 6px;
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

.video-container :deep(.player-extra) {
    grid-area: extra;
    display: flex;
    align-items: center;
}

.video-container :deep(.player-extra:empty) {
    display: none;
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

/* Plain white icons with a shadow of their own, so they stay readable over bright scenes */
.video-container :deep(.plyr__controls .plyr__control) {
    border-radius: 50%;
    transition: background-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
}

.video-container :deep(.plyr__controls .plyr__control svg) {
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.55));
}

.video-container :deep(.plyr__controls .plyr__control:active) {
    transform: scale(0.9);
}

.video-container :deep(.plyr__controls [data-plyr="play"] svg) {
    width: 26px;
    height: 26px;
}

.video-container :deep(.plyr__controls [data-plyr="play"]) {
    margin-right: 2px;
    padding: 8px;
}

/* Subtitles on: the button turns gold */
.video-container :deep([data-plyr="captions"].plyr__control--pressed) {
    color: var(--accent);
}

.video-container :deep(.plyr__controls .plyr__time) {
    padding: 0;
    color: #fff;
    font-size: 0.88rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    white-space: nowrap;
}

.video-container :deep(.plyr__volume + .plyr__time--current) {
    margin-left: 8px;
}

.video-container :deep(.plyr__controls .plyr__time--duration) {
    color: rgba(255, 255, 255, 0.7);
    font-weight: 500;
}

.video-container :deep(.plyr__time + .plyr__time::before) {
    content: '/';
    margin: 0 6px;
    color: rgba(255, 255, 255, 0.5);
}

/* Both sliders are white lines: solid white up to where the movie (or the volume) is, see-through after it */
.video-container :deep(.plyr__controls input[type="range"]::-moz-range-progress) {
    background: #fff;
}

.video-container :deep(.plyr__controls input[type="range"]::-webkit-slider-runnable-track) {
    background-image: linear-gradient(#fff, #fff);
    background-repeat: no-repeat;
    background-size: var(--value, 0%) 100%;
}

.video-container :deep(.plyr__controls input[type="range"]:hover::-moz-range-thumb) {
    box-shadow: var(--plyr-range-thumb-shadow), 0 0 0 5px rgba(255, 255, 255, 0.2);
}

.video-container :deep(.plyr__controls input[type="range"]:hover::-webkit-slider-thumb) {
    box-shadow: var(--plyr-range-thumb-shadow), 0 0 0 5px rgba(255, 255, 255, 0.2);
}

/* The volume slider slides out of the speaker button while it's pointed at */
.video-container :deep(.plyr__volume) {
    --plyr-range-track-height: 3px;
    --plyr-range-thumb-height: 12px;
    --plyr-range-thumb-active-shadow-width: 5px;
}

.video-container :deep(.plyr__volume input[type="range"]) {
    width: 0;
    min-width: 0;
    margin: 0;
    opacity: 0;
    transition: width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), margin 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease;
}

.video-container :deep(.plyr__volume:hover input[type="range"]),
.video-container :deep(.plyr__volume input[type="range"]:active) {
    width: 72px;
    margin: 0 8px 0 4px;
    opacity: 1;
}

/* The timeline is a thin line that doubles in thickness, and shows its thumb, when it's pointed at or dragged */
.video-container :deep(.plyr__progress) {
    transform: scaleY(0.5);
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.video-container :deep(.plyr__progress__container:hover .plyr__progress),
.video-container :deep(.plyr__progress__container:active .plyr__progress) {
    transform: none;
}

.video-container :deep(.plyr__progress input[type="range"]::-moz-range-thumb) {
    transform: scale(0);
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease;
}

.video-container :deep(.plyr__progress input[type="range"]::-webkit-slider-thumb) {
    transform: scale(0);
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.2s ease;
}

.video-container :deep(.plyr__progress__container:hover input[type="range"]::-moz-range-thumb),
.video-container :deep(.plyr__progress__container:active input[type="range"]::-moz-range-thumb) {
    transform: none;
}

.video-container :deep(.plyr__progress__container:hover input[type="range"]::-webkit-slider-thumb),
.video-container :deep(.plyr__progress__container:active input[type="range"]::-webkit-slider-thumb) {
    transform: none;
}

/* The time under the pointer, in a small dark pill */
.video-container :deep(.plyr__progress .plyr__tooltip) {
    padding: 5px 9px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.82rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
}

/* Subtitles move up over the controls while they show */
.video-container :deep(.plyr:not(.plyr--hide-controls) .plyr__controls:not(:empty) ~ .plyr__captions) {
    transform: translateY(calc(-1 * var(--controls-lift)));
}

.video-container:fullscreen {
    --controls-lift: 92px;
}

.video-container:-webkit-full-screen {
    --controls-lift: 92px;
}

/* The big button over a paused movie is the same glass circle as the start button */
.video-container :deep(.plyr__control--overlaid) {
    display: grid;
    place-items: center;
    width: 88px;
    height: 88px;
    padding: 0;
    border: var(--glass-border);
    background: var(--glass-background);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--glass-shadow);
    color: #fff;
}

.video-container :deep(.plyr--paused .plyr__control--overlaid) {
    opacity: 1;
}

.video-container.started :deep(.plyr--full-ui.plyr--video .plyr__control--overlaid) {
    display: grid;
}

.video-container :deep(.plyr__control--overlaid:hover) {
    background: var(--glass-background-hover);
    transform: translate(-50%, -50%) scale(1.06);
}

.video-container :deep(.plyr__control--overlaid svg) {
    left: 2px;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
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
    border: var(--glass-border);
    border-radius: 50%;
    background: var(--glass-background);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--glass-shadow);
    color: #fff;
    cursor: pointer;
    transition: transform 0.2s ease, background-color 0.2s ease;
}

.play-button:hover {
    transform: scale(1.06);
    background: var(--glass-background-hover);
}

/* The triangle is drawn a hair right of center, which is what looks centered in a circle */
.play-button svg {
    width: 40px;
    height: 40px;
    fill: currentColor;
    filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
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

.overlay-message,
.overlay :slotted(.overlay-message) {
    max-width: 36ch;
    margin: 0;
    font-size: 1.1rem;
}

.overlay :slotted(.overlay-note) {
    max-width: 40ch;
    margin: 4px 0 0;
    font-size: 1rem;
    font-weight: 600;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.7);
}

.failed-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
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
