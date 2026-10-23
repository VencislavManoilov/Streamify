<template>
    <div class="series-page">
        <AppHeader back search />

        <LoadingSpinner v-if="!series && !pageError" overlay label="Loading the series" />
        <p v-else-if="pageError" class="page-message">{{ pageError }}</p>

        <div v-if="series" class="series-content">
            <div class="title-row">
                <div class="titles">
                    <p class="series-name">{{ series.title }}</p>
                    <h1 class="episode-title">
                        <span v-if="current" class="episode-code">{{ episodeCode }}</span>
                        <span>{{ episodeTitle }}</span>
                    </h1>
                </div>
                <!-- Blurred after a click, so Space keeps pausing the video instead of pressing it again -->
                <WatchlistButton :movie="series" @click="$event.currentTarget.blur()" />
            </div>

            <p v-if="caughtUp" class="caught-up">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4.2 4.2L18.5 8" /></svg>
                <span>{{ caughtUp }}</span>
            </p>

            <VideoPlayer
                ref="player"
                :src="playerSrc"
                :src-type="playerType"
                :content-key="contentKey"
                :poster="poster"
                :resume-at="resumeAt"
                :ready="playerReady"
                :subtitles="subtitles"
                :subtitle-key="subtitleKey"
                media-label="episode"
                :save-progress="saveProgress"
                :note="loadingNote"
                :error="started ? playerError : ''"
                :audio-tracks="audioTracks"
                :current-audio="plan ? plan.audio : null"
                fail-message="This source stopped working. Try again or pick another source."
                @started="started = true"
                @playing="onPlaying"
                @failed="onPlayerFailed"
                @ended="onEnded"
                @time="onTime"
                @select-audio="chooseAudio"
            >
                <template #waiting>
                    <div class="waiting">
                        <LoadingSpinner v-if="sourcesState === 'loading'" :size="44" label="Looking for this episode" />
                        <p class="overlay-message">{{ waitingText }}</p>
                        <button v-if="sourcesState === 'empty' || sourcesState === 'error'" type="button" class="overlay-button" tabindex="-1" @click="loadSources({ refresh: true })">Look again</button>
                        <button v-else-if="prepareError && sources.length > 1" type="button" class="overlay-button" tabindex="-1" @click="openSources">Pick a source</button>
                    </div>
                </template>
                <template #start>
                    <p v-if="autoMessage" class="overlay-note">{{ autoMessage }}</p>
                </template>
                <template #loading>
                    <button v-if="canTryAnother" type="button" class="overlay-link" tabindex="-1" @click="tryAnother">Try another source</button>
                </template>
                <template #failed>
                    <button v-if="untriedSource()" type="button" class="overlay-button" tabindex="-1" @click="tryAnother">Try another source</button>
                    <button v-else-if="sources.length > 1" type="button" class="overlay-button" tabindex="-1" @click="openSources">Pick a source</button>
                </template>
                <template #controls>
                    <button
                        v-if="nextEpisode"
                        type="button"
                        tabindex="-1"
                        class="plyr__control"
                        :aria-label="`Next episode: ${nextLabel}`"
                        :title="`Next episode: ${nextLabel}`"
                        @click="goNext"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 5.8v12.4l9.2-6.2z" /><rect x="16.6" y="5.6" width="2.4" height="12.8" rx="1" /></svg>
                    </button>
                </template>
                <template #overlay>
                    <Transition name="pop">
                        <div v-if="upNextVisible && nextEpisode" class="up-next" role="dialog" aria-label="Next episode">
                            <div class="up-next-still" :style="nextStill ? { backgroundImage: `url(${nextStill})` } : null">
                                <svg v-if="countdownActive" class="ring" viewBox="0 0 44 44" aria-hidden="true">
                                    <circle cx="22" cy="22" r="19" class="ring-track" />
                                    <circle cx="22" cy="22" r="19" class="ring-fill" :style="{ strokeDashoffset: ringOffset }" />
                                </svg>
                            </div>
                            <div class="up-next-text">
                                <p class="up-next-label">{{ countdownActive ? `Next episode in ${countdown}` : 'Next episode' }}</p>
                                <p class="up-next-title">{{ nextLabel }}</p>
                                <div class="up-next-actions">
                                    <button type="button" class="up-next-play" tabindex="-1" @click="goNext">
                                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                                        Play now
                                    </button>
                                    <button v-if="countdownActive" type="button" class="up-next-cancel" tabindex="-1" @click="dismissUpNext">Cancel</button>
                                </div>
                            </div>
                        </div>
                    </Transition>
                    <Transition name="pop">
                        <div v-if="slowWarning" class="slow-warning" role="status">
                            <span class="slow-dot" aria-hidden="true"></span>
                            <span class="slow-text">
                                <strong>This source is slow</strong>
                                <span>It may keep stopping to load.</span>
                            </span>
                            <button v-if="untriedSource()" type="button" class="slow-switch" tabindex="-1" @click="tryAnother">Switch</button>
                            <button type="button" class="slow-close" tabindex="-1" aria-label="Keep this source" @click="dismissSlow">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
                            </button>
                        </div>
                    </Transition>
                </template>
            </VideoPlayer>

            <div class="controls-row">
                <SourcePicker
                    ref="sourcePicker"
                    :sources="sources"
                    :selected="selected"
                    :failed="failed"
                    :health="health"
                    :empty-text="sourcesEmptyText"
                    :refreshing="sourcesState === 'loading'"
                    @select="chooseSource"
                    @refresh="loadSources({ refresh: true })"
                />
                <div class="episode-nav">
                    <button type="button" class="nav-step" :disabled="!previousEpisode" :title="previousEpisode ? `Previous: ${labelOf(previousEpisode)}` : ''" @click="goTo(previousEpisode)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
                        <span>Previous</span>
                    </button>
                    <button type="button" class="nav-step next" :disabled="!nextEpisode" :title="nextEpisode ? `Next: ${nextLabel}` : 'This is the latest episode'" @click="goNext">
                        <span>Next episode</span>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
                    </button>
                </div>
            </div>

            <section v-if="currentEpisode" class="episode-about">
                <p class="episode-facts">
                    <span v-if="currentEpisode.aired">{{ airedText }}</span>
                    <span v-if="currentEpisode.runtime">{{ currentEpisode.runtime }} min</span>
                    <span v-if="currentEpisode.rating" class="episode-rating">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                        {{ currentEpisode.rating }}
                    </span>
                </p>
                <p v-if="currentEpisode.overview" class="episode-overview">{{ currentEpisode.overview }}</p>
            </section>

            <EpisodePicker
                v-if="seasons.length"
                :seasons="seasons"
                :current-season="current ? current.season : null"
                :current-episode="current ? current.episode : null"
                :progress="progress"
                :availability="availability"
                @select="goTo"
                @season="loadAvailability"
            />

            <section class="about">
                <div class="facts-row">
                    <p class="facts">
                        <span class="rating">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                            {{ series.rating }} / 10
                        </span>
                        <span v-if="years">{{ years }}</span>
                        <span v-if="seasonCount">{{ seasonCount }} {{ seasonCount === 1 ? 'season' : 'seasons' }}</span>
                        <span v-if="series.certification" class="certification" :title="`Rated ${series.certification}`">{{ series.certification }}</span>
                        <span v-if="genres" class="genres">{{ genres }}</span>
                    </p>
                    <div class="links">
                        <a v-if="trailerUrl" :href="trailerUrl" target="_blank" rel="noopener noreferrer" class="trailer-button" title="Watch the trailer on YouTube">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8.8v6.4l5.2-3.2z" /><circle cx="12" cy="12" r="8.6" /></svg>
                            <span>Trailer</span>
                        </a>
                        <a :href="'https://www.imdb.com/title/' + series.imdb_code" target="_blank" rel="noopener noreferrer" class="imdb-button" aria-label="Open on IMDb">
                            <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb">
                        </a>
                    </div>
                </div>

                <p v-if="details && details.tagline" class="tagline">{{ details.tagline }}</p>

                <div class="summary">
                    <h2>About the series</h2>
                    <p>{{ series.summary || 'No summary available' }}</p>
                </div>

                <MovieExtras class="extras" :details="details" :loading="detailsLoading" variant="page" />
            </section>
        </div>
    </div>
</template>

<script>
import api from '../api';
import { API_URL } from '../config';
import { browserCaps, episodeLabel } from '../playback';
import { episodeList, formatAirDate, hasAired, seriesData, seriesYears } from '../seriesData';
import { session } from '../session';
import { episodeHistoryPath, watchHistory } from '../watchHistory';
import { watchlist } from '../watchlist';
import AppHeader from './AppHeader.vue';
import EpisodePicker from './EpisodePicker.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieExtras from './MovieExtras.vue';
import SourcePicker from './SourcePicker.vue';
import VideoPlayer from './VideoPlayer.vue';
import WatchlistButton from './WatchlistButton.vue';

// Shorter starts aren't worth resuming
const MIN_RESUME_SECONDS = 30;
// Past this point the credits are rolling, so the episode counts as watched
const FINISHED_RATIO = 0.95;
const STATS_INTERVAL = 2500;
// The next episode is offered this many seconds before the end, and starts after the countdown
const UP_NEXT_SECONDS = 30;
const UP_NEXT_COUNTDOWN = 10;
// From here on the next episode's torrent is loaded in the background, so it starts right away
const PREFETCH_AT = 0.85;
// Sources tried one after another without asking, when they don't load at all
const AUTO_TRIES = 3;
// How long a source has to be too slow before it's pointed out
const SLOW_GRACE = 20000;
// After this long the loading screen offers another source
const LONG_LOAD = 20000;
// A source that brings in nothing for this long before the episode plays is given up on
const DEAD_AFTER = 35000;

// Why a source didn't work, by the server's error code
const REASONS = {
    'no-peers': "This source isn't available right now",
    'no-file': "This source doesn't have the episode",
    unsupported: "This source's format can't play in this browser",
    unreadable: "This source's video couldn't be read",
    'no-source': 'This source is gone',
    failed: "This source couldn't be loaded"
};

const languageNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;

function languageName(code) {
    if (!code) return '';
    try {
        return (languageNames && languageNames.of(code)) || code;
    } catch (err) {
        return code;
    }
}

// The two letter code of a language a video file names, often with three ("eng"), or '' when it names none
function languageCode(code) {
    if (!code || code === 'und') return '';
    try {
        return Intl.getCanonicalLocales(code)[0].split('-')[0];
    } catch (err) {
        return '';
    }
}

// What sets a subtitle track inside the video file apart from others in its language: 'Forced' (only the
// lines in other languages), 'SDH' (for the hard of hearing) or its own name
function trackDetail(track, name) {
    // Some files name their tracks "null" or "und"
    const title = /^(null|undefined|und|none)$/i.test((track.title || '').trim()) ? '' : (track.title || '').trim();
    if (track.forced || /forced/i.test(title)) return 'Forced';
    if (track.hearingImpaired || /\b(sdh|cc)\b/i.test(title)) return 'SDH';
    if (title && !/^\d/.test(title) && title.toLowerCase() !== name.toLowerCase()) return title.slice(0, 24);
    return '';
}

function progressKey(season, episode) {
    return `${season}:${episode}`;
}

export default {
    name: 'SeriesPage',
    components: {
        AppHeader,
        EpisodePicker,
        LoadingSpinner,
        MovieExtras,
        SourcePicker,
        VideoPlayer,
        WatchlistButton
    },
    data() {
        return {
            series: null,
            pageError: null,
            seasons: [],
            // "season:episode" -> { position, duration, completed }
            progress: {},
            details: null,
            detailsLoading: true,
            // { season, episode } that's open
            current: null,
            resumeAt: 0,
            sources: [],
            // 'idle', 'loading', 'ready', 'empty', 'error' or 'unaired'
            sourcesState: 'idle',
            // hash -> why it didn't work, for this episode
            failed: {},
            selected: null,
            // How the server sends the selected source (see /series/.../prepare)
            plan: null,
            preparing: false,
            preparingSince: 0,
            prepareError: '',
            stats: null,
            playerPaused: true,
            // The download speeds of the last few polls
            speeds: [],
            buffered: 0,
            // The viewer pressed play, so the next episodes start by themselves
            started: false,
            // The episode has played since it was opened
            episodePlayed: false,
            playerError: '',
            autoMessage: '',
            // An audio track the viewer picked: { hash, index }. A season pack keeps it for the next episodes,
            // another release may have its tracks in another order.
            audioChoice: null,
            // season -> 'loading' | { episode -> summary }
            availability: {},
            upNextVisible: false,
            upNextDismissed: false,
            countdownActive: false,
            countdown: UP_NEXT_COUNTDOWN,
            slowSince: 0,
            slowWarning: false,
            slowDismissed: false,
            caughtUp: '',
            now: Date.now()
        };
    },
    computed: {
        imdbCode() {
            return this.$route.params.imdb_code;
        },
        routeKey() {
            const { imdb_code: imdbCode, season, episode } = this.$route.params;
            return this.$route.name === 'Series' ? `${imdbCode}|${season || ''}|${episode || ''}` : null;
        },
        contentKey() {
            return this.current ? `${this.imdbCode}:${this.current.season}:${this.current.episode}` : `${this.imdbCode}:none`;
        },
        subtitleKey() {
            return this.current ? `${this.imdbCode}:S${this.current.season}E${this.current.episode}` : this.imdbCode;
        },
        list() {
            return episodeList(this.seasons);
        },
        currentEpisode() {
            if (!this.current) return null;
            const season = this.seasons.find(item => item.number === this.current.season);
            return (season && season.episodes.find(item => item.episode === this.current.episode)) || null;
        },
        currentIndex() {
            if (!this.current) return -1;
            return this.list.findIndex(item => item.season === this.current.season && item.episode === this.current.episode);
        },
        nextEpisode() {
            const next = this.currentIndex === -1 ? null : this.list[this.currentIndex + 1];
            return next && hasAired(next, this.now) ? next : null;
        },
        previousEpisode() {
            return this.currentIndex > 0 ? this.list[this.currentIndex - 1] : null;
        },
        nextLabel() {
            return this.nextEpisode ? this.labelOf(this.nextEpisode) : '';
        },
        nextStill() {
            return this.nextEpisode ? this.nextEpisode.still : '';
        },
        ringOffset() {
            return (2 * Math.PI * 19 * (1 - this.countdown / UP_NEXT_COUNTDOWN)).toFixed(2);
        },
        episodeCode() {
            return this.current ? episodeLabel(this.current.season, this.current.episode) : '';
        },
        episodeTitle() {
            if (!this.current) return '';
            return (this.currentEpisode && this.currentEpisode.title) || `Episode ${this.current.episode}`;
        },
        airedText() {
            const date = formatAirDate(this.currentEpisode.aired, { day: 'numeric', month: 'long', year: 'numeric' });
            return hasAired(this.currentEpisode, this.now) ? `Aired ${date}` : `Airs ${date}`;
        },
        poster() {
            return (this.currentEpisode && this.currentEpisode.still) || this.series.background_image;
        },
        playerSrc() {
            return this.plan ? `${API_URL}${this.plan.url}` : '';
        },
        playerType() {
            return this.plan && this.plan.mode === 'hls' ? 'hls' : 'file';
        },
        playerReady() {
            return this.sourcesState === 'ready' && !!this.selected && !this.prepareError;
        },
        // English subtitles come from the episode's torrent when it has them, and from OpenSubtitles otherwise.
        // The ones inside the video file are read from it while it plays.
        subtitles() {
            if (!this.current) return [];
            const base = `/subtitles/series/${this.imdbCode}/${this.current.season}/${this.current.episode}`;
            // A season pack has the subtitles of every episode, so the torrent's need the episode's file
            const torrent = this.plan ? `&hash=${this.selected.hash}&file=${this.plan.fileIndex}` : '';
            const inFile = this.fileSubtitles;
            const fileEnglish = inFile.find(track => track.default);
            const downloaded = [
                { label: 'English', srclang: 'en', src: `${base}?lang=en${torrent}`, default: !fileEnglish },
                { label: 'Bulgarian', srclang: 'bg', src: `${base}?lang=bg` }
            ];
            // The file's own English ones fit the video best. The player turns on the first in the viewer's
            // language, so they go before the downloaded ones.
            if (!fileEnglish) return [...downloaded, ...inFile];
            return [fileEnglish, ...downloaded, ...inFile.filter(track => track !== fileEnglish)];
        },
        fileSubtitles() {
            if (!this.plan || !this.selected || !this.plan.subtitles) return [];
            const { season, episode } = this.current;
            const base = `${API_URL}/series/${this.imdbCode}/${season}/${episode}/subtitles/${this.selected.hash}/${this.plan.fileIndex}`;
            const tracks = this.plan.subtitles.map((track, position) => {
                const language = languageCode(track.language);
                const name = languageName(language) || `Track ${position + 1}`;
                const detail = trackDetail(track, name);
                return {
                    detail,
                    // Like "English SDH · Embedded"
                    track: { label: `${name}${detail ? ` ${detail}` : ''} · Embedded`, srclang: language || 'und', stream: `${base}/${track.index}`, default: false }
                };
            });
            // Whole English ones before those for the hard of hearing; never the ones with only the foreign lines
            const english = tracks.filter(({ track, detail }) => track.srclang === 'en' && detail !== 'Forced');
            const main = english.find(({ detail }) => detail !== 'SDH') || english[0];
            if (main) main.track.default = true;
            return tracks.map(({ track }) => track);
        },
        audioTracks() {
            const tracks = (this.plan && this.plan.audioTracks) || [];
            if (tracks.length < 2) return [];
            return tracks.map((track, position) => {
                const name = languageName(track.language) || `Track ${position + 1}`;
                const title = track.title && !/^\d/.test(track.title) && track.title.toLowerCase() !== name.toLowerCase() ? ` · ${track.title}` : '';
                return { index: track.index, label: `${name}${title}`.slice(0, 40) };
            });
        },
        waitingText() {
            if (this.sourcesState === 'loading') return 'Looking for this episode…';
            if (this.sourcesState === 'unaired') return `This episode airs ${formatAirDate(this.currentEpisode && this.currentEpisode.aired, { day: 'numeric', month: 'long' })}.`;
            if (this.sourcesState === 'empty') return "No torrents of this episode were found. New episodes usually show up within a day of airing.";
            if (this.sourcesState === 'error') return "Couldn't look for this episode right now.";
            if (this.prepareError) return this.prepareError;
            return '';
        },
        sourcesEmptyText() {
            return { loading: 'Looking…', empty: 'None found', error: "Couldn't look", unaired: 'Not aired yet' }[this.sourcesState] || 'None yet';
        },
        // Under the spinner while the episode loads
        loadingNote() {
            if (this.autoMessage) return this.autoMessage;
            if (this.sourcesState === 'loading') return 'Looking for this episode…';
            return this.selected && this.preparing ? 'Getting the episode ready…' : '';
        },
        // Offered under the spinner when the episode takes long to start
        canTryAnother() {
            return !!this.untriedSource() && !this.episodePlayed && !!this.selected && this.now - this.preparingSince > LONG_LOAD;
        },
        // How the chosen source streams right now, next to its name. Only in words: the torrent's peers and
        // speeds made it look like the browser downloads the episode from the torrent itself.
        health() {
            if (!this.selected) return null;
            if (this.prepareError) return { tone: 'bad', text: "Didn't load" };
            if (this.preparing || !this.plan) return { tone: 'muted', text: 'Loading…' };
            // Before play is pressed, and while paused, nothing is asked of the torrent, so its speed says nothing
            if (!this.started || this.playerPaused) return { tone: 'good', text: this.started ? 'Paused' : 'Ready' };
            const stats = this.stats;
            if (!stats || !stats.ready) return { tone: 'muted', text: 'Loading…' };
            const needed = this.plan.bitrate || 0;
            const speed = this.averageSpeed;
            // With plenty ready to play the browser stops asking for more, so the speed drops and says nothing.
            // Neither does it once the whole episode is on the server.
            if (this.buffered >= 30 || stats.progress >= 0.999 || !needed || speed >= needed * 1.1) {
                return { tone: 'good', text: 'Smooth' };
            }
            if (speed < needed * 0.8) {
                return { tone: 'bad', text: 'Slow', title: 'This source loads slower than the episode plays' };
            }
            return { tone: 'warn', text: 'Just keeping up', title: 'This source loads about as fast as the episode plays' };
        },
        // The speed of the last few seconds, which says more than one moment does
        averageSpeed() {
            if (!this.speeds.length) return this.stats ? this.stats.downloadSpeed : 0;
            return this.speeds.reduce((total, speed) => total + speed, 0) / this.speeds.length;
        },
        years() {
            return seriesYears(this.series);
        },
        seasonCount() {
            return this.seasons.filter(season => season.number > 0).length || this.series.number_of_seasons;
        },
        genres() {
            return (this.series.genres || []).join(', ');
        },
        trailerUrl() {
            const trailer = this.details && this.details.trailer;
            return trailer ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}` : '';
        }
    },
    watch: {
        routeKey: {
            immediate: true,
            handler(key) {
                if (key) this.onRoute();
            }
        }
    },
    created() {
        this.clock = setInterval(() => {
            this.now = Date.now();
        }, 5000);
    },
    beforeUnmount() {
        this.destroyed = true;
        clearInterval(this.clock);
        clearInterval(this.statsTimer);
        clearInterval(this.countdownTimer);
    },
    methods: {
        labelOf(episode) {
            const title = episode.title ? ` · ${episode.title}` : '';
            return `${episodeLabel(episode.season, episode.episode)}${title}`;
        },
        async onRoute() {
            const imdbCode = this.imdbCode;
            const { season, episode } = this.$route.params;

            if (!this.series || this.series.imdb_code !== imdbCode) {
                const loaded = await this.loadSeries(imdbCode);
                if (!loaded || imdbCode !== this.imdbCode) return;
            }

            // Without an episode the one to watch next opens, and the address says which
            if (!season || !episode) {
                const next = this.nextUp;
                const target = next || (this.list[0] ? { season: this.list[0].season, episode: this.list[0].episode } : null);
                if (!target) {
                    this.pageError = 'This series has no episodes yet.';
                    return;
                }
                this.caughtUp = next && next.reason === 'caught-up' ? this.caughtUpText(next) : '';
                this.$router.replace({ name: 'Series', params: { imdb_code: imdbCode, season: String(target.season), episode: String(target.episode) } });
                return;
            }

            this.openEpisode(Number(season), Number(episode));
        },
        caughtUpText(next) {
            const upcoming = next.upcoming && next.upcoming.aired
                ? ` The next one airs ${formatAirDate(next.upcoming.aired, { weekday: 'long', day: 'numeric', month: 'long' })}.`
                : '';
            return `You're all caught up on ${this.series.title}.${upcoming}`;
        },
        async loadSeries(imdbCode) {
            this.series = null;
            this.pageError = null;
            this.seasons = [];
            this.progress = {};
            this.details = null;
            this.current = null;
            this.availability = {};
            this.nextUp = null;
            this.prefetched = null;

            try {
                const [series, seasons, next] = await Promise.all([
                    seriesData.series(imdbCode),
                    seriesData.episodes(imdbCode),
                    seriesData.next(imdbCode).catch(() => ({ next: null, progress: [] })),
                    // The episode that was just left may still be saving its progress
                    watchHistory.settled()
                ]);
                if (imdbCode !== this.imdbCode) return false;
                this.seasons = seasons;
                this.nextUp = next.next;
                this.progress = Object.fromEntries(next.progress.map(entry => [progressKey(entry.season, entry.episode), entry]));
                this.series = series;
            } catch (error) {
                if (imdbCode !== this.imdbCode) return false;
                if (error.response && error.response.status === 404) {
                    this.pageError = "This series isn't available.";
                } else if (!error.response || error.response.status !== 401) {
                    this.pageError = "This series couldn't be loaded. Check your connection and refresh the page.";
                }
                return false;
            }

            this.detailsLoading = true;
            seriesData.details(imdbCode).then((details) => {
                if (imdbCode === this.imdbCode) this.details = details;
            }).catch(() => {}).finally(() => {
                this.detailsLoading = false;
            });
            return true;
        },
        resumeFor(season, episode) {
            const entry = this.progress[progressKey(season, episode)];
            if (!entry || !entry.duration) return 0;
            if (entry.position < MIN_RESUME_SECONDS || entry.position >= entry.duration * FINISHED_RATIO) return 0;
            // A few seconds back, so the scene picks up where it was left
            return Math.max(0, entry.position - 3);
        },
        openEpisode(season, episode) {
            if (this.current && this.current.season === season && this.current.episode === episode) return;

            this.current = { season, episode };
            this.resumeAt = this.resumeFor(season, episode);
            this.sources = [];
            this.failed = {};
            this.selected = null;
            this.plan = null;
            this.preparing = false;
            this.prepareError = '';
            this.playerError = '';
            this.autoMessage = '';
            this.autoTries = 0;
            this.stats = null;
            this.buffered = 0;
            this.episodePlayed = false;
            this.hideUpNext();
            this.upNextDismissed = false;
            this.slowSince = 0;
            this.slowWarning = false;
            this.slowDismissed = false;
            clearInterval(this.statsTimer);
            if (this.caughtUp && this.nextUp && (this.nextUp.season !== season || this.nextUp.episode !== episode)) this.caughtUp = '';

            if (!hasAired(this.currentEpisode, Date.now())) {
                this.sourcesState = 'unaired';
                return;
            }

            // The next episode was looked up while the last one ended
            const prefetched = this.prefetched;
            this.prefetched = null;
            if (prefetched && prefetched.key === this.contentKey && prefetched.sources) {
                this.useSources(prefetched.sources, prefetched.prepared);
            } else {
                this.loadSources();
            }
        },
        async loadSources({ refresh = false } = {}) {
            const key = this.contentKey;
            const { season, episode } = this.current;
            this.sourcesState = 'loading';
            try {
                const response = await api.get(`/series/${this.imdbCode}/${season}/${episode}/sources`, {
                    params: { caps: browserCaps(), refresh: refresh ? 1 : undefined }
                });
                if (key !== this.contentKey) return;
                this.useSources(response.data.sources);
            } catch (error) {
                if (key !== this.contentKey) return;
                this.sourcesState = error.response && error.response.status === 401 ? 'idle' : 'error';
            }
        },
        // `prepared` is a plan made ahead for the first source
        useSources(sources, prepared = null) {
            this.sources = sources;
            this.noteAvailability(sources);
            if (!sources.length) {
                this.sourcesState = 'empty';
                return;
            }
            this.sourcesState = 'ready';
            // A refreshed list keeps playing what plays
            if (this.selected && this.plan && sources.some(source => source.hash === this.selected.hash)) return;
            const best = sources.find(source => !this.failed[source.hash]) || sources[0];
            if (prepared && prepared.hash === best.hash) {
                this.selected = best;
                this.plan = prepared.plan;
                this.preparingSince = Date.now();
                this.startStats();
            } else {
                this.prepare(best);
            }
        },
        // What the source list says about the episode, for its card in the episode list
        noteAvailability(sources) {
            const { season, episode } = this.current;
            const known = this.availability[season];
            if (!known || known === 'loading') return;
            const seeders = Math.max(0, ...sources.map(source => source.seeders || 0));
            const health = !sources.length ? 'none' : seeders >= 40 ? 'great' : seeders >= 10 ? 'good' : seeders >= 1 ? 'slow' : 'dead';
            this.availability = {
                ...this.availability,
                [season]: { ...known, [episode]: { count: sources.length, health, seeders, resolution: sources[0] ? sources[0].resolution : null } }
            };
        },
        // Loads a torrent of the episode on the server. One that doesn't work is swapped for the next best,
        // a few times in a row, as long as the episode hasn't played yet.
        async prepare(source, { auto = false } = {}) {
            const token = (this.prepareToken = (this.prepareToken || 0) + 1);
            const key = this.contentKey;
            const { season, episode } = this.current;
            const at = this.episodePlayed && this.$refs.player ? this.$refs.player.position() : this.resumeAt;

            this.selected = source;
            this.plan = null;
            this.preparing = true;
            this.preparingSince = Date.now();
            this.prepareError = '';
            this.playerError = '';
            this.slowSince = 0;
            this.slowWarning = false;
            if (!auto) this.autoMessage = '';
            this.startStats();

            try {
                const response = await api.post(`/series/${this.imdbCode}/${season}/${episode}/prepare`, {
                    hash: source.hash,
                    caps: browserCaps(),
                    audio: this.audioFor(source),
                    at
                });
                if (token !== this.prepareToken || key !== this.contentKey) return;
                this.plan = response.data.plan;
                this.preparing = false;
                this.autoMessage = '';
            } catch (error) {
                if (token !== this.prepareToken || key !== this.contentKey) return;
                this.preparing = false;
                if (error.response && error.response.status === 401) return;
                const code = error.response && error.response.data && error.response.data.code;
                this.sourceFailed(source, REASONS[code] || REASONS.failed);
            }
        },
        sourceFailed(source, reason) {
            this.failed = { ...this.failed, [source.hash]: reason };
            const next = this.untriedSource();
            if (next && !this.episodePlayed && (this.autoTries || 0) < AUTO_TRIES) {
                this.autoTries = (this.autoTries || 0) + 1;
                this.autoMessage = `${reason}, trying another source…`;
                this.prepare(next, { auto: true });
                return;
            }
            this.autoMessage = '';
            this.prepareError = next ? `${reason}. Pick another source below the player.` : `${reason}, and no other source is left.`;
            this.playerError = this.prepareError;
        },
        untriedSource() {
            return this.sources.find(source => !this.failed[source.hash] && (!this.selected || source.hash !== this.selected.hash)) || null;
        },
        tryAnother() {
            const next = this.untriedSource();
            if (!next) {
                this.openSources();
                return;
            }
            if (this.selected && !this.failed[this.selected.hash]) {
                this.failed = { ...this.failed, [this.selected.hash]: 'Too slow, switched away' };
                this.report(this.selected, 'slow');
            }
            this.autoTries = 0;
            this.prepare(next);
        },
        // Lets the server rank a torrent that didn't work lower for everyone for a while
        report(source, reason) {
            const { season, episode } = this.current;
            api.post(`/series/${this.imdbCode}/${season}/${episode}/report`, { hash: source.hash, reason }).catch(() => {});
        },
        chooseSource(source) {
            if (this.selected && source.hash === this.selected.hash && this.plan && !this.playerError) return;
            const failed = { ...this.failed };
            delete failed[source.hash];
            this.failed = failed;
            this.autoTries = AUTO_TRIES;
            this.prepare(source);
        },
        // Another audio track of the same file, continuing where the video is
        chooseAudio(index) {
            if (!this.selected || (this.plan && this.plan.audio === index)) return;
            this.audioChoice = { hash: this.selected.hash, index };
            this.prepare(this.selected);
        },
        audioFor(source) {
            return this.audioChoice && this.audioChoice.hash === source.hash ? this.audioChoice.index : null;
        },
        openSources() {
            if (this.$refs.sourcePicker) this.$refs.sourcePicker.show();
            this.$nextTick(() => {
                const picker = this.$refs.sourcePicker && this.$refs.sourcePicker.$el;
                if (picker) picker.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        },
        // Watches the torrent of a newly picked source from scratch
        startStats() {
            clearInterval(this.statsTimer);
            this.stats = null;
            this.speeds = [];
            this.lastDownloaded = 0;
            this.lastDataAt = Date.now();
            this.statsTimer = setInterval(() => this.pollStats(), STATS_INTERVAL);
            this.pollStats();
        },
        async pollStats() {
            const source = this.selected;
            if (!source || document.visibilityState === 'hidden') return;
            const file = this.plan ? this.plan.fileIndex : source.fileIdx;
            try {
                const response = await api.get(`/torrents/${source.hash}/stats`, { params: { file: Number.isInteger(file) ? file : undefined } });
                if (source !== this.selected || this.destroyed) return;
                this.stats = response.data;
                this.speeds = [...this.speeds, response.data.downloadSpeed || 0].slice(-4);
                this.buffered = this.$refs.player ? this.$refs.player.bufferedAhead() : 0;
                this.playerPaused = this.$refs.player ? this.$refs.player.isPaused() : true;
                this.now = Date.now();
                this.watchDeadSource();
                this.watchSlowness();
            } catch (err) {
                // The next poll tries again
            }
        },
        // Add-ons count seeders now and then, so a torrent they call healthy can be dead by now. One that brings
        // in nothing at all before the episode ever played is swapped for the next one.
        watchDeadSource() {
            const stats = this.stats;
            if (!stats || !stats.ready || this.episodePlayed) return;
            // Only while something waits for its data: a source that's ready and waits for Play rests
            const waiting = this.preparing || this.started;
            if (!waiting) {
                this.lastDataAt = Date.now();
                return;
            }
            if (stats.downloaded > (this.lastDownloaded || 0)) {
                this.lastDownloaded = stats.downloaded;
                this.lastDataAt = Date.now();
                return;
            }
            if (Date.now() - this.lastDataAt > DEAD_AFTER && (this.plan || this.preparing)) {
                const source = this.selected;
                this.report(source, 'dead');
                this.prepareToken = (this.prepareToken || 0) + 1;
                this.preparing = false;
                this.sourceFailed(source, REASONS['no-peers']);
            }
        },
        // A source that stays too slow while the episode plays is pointed out, with a way to switch
        watchSlowness() {
            const playing = this.$refs.player && !this.$refs.player.isPaused();
            if (this.health && this.health.tone === 'bad' && playing && this.plan) {
                if (!this.slowSince) this.slowSince = Date.now();
                if (!this.slowDismissed && Date.now() - this.slowSince > SLOW_GRACE) this.slowWarning = true;
            } else if (!this.health || this.health.tone === 'good') {
                this.slowSince = 0;
                this.slowWarning = false;
            }
        },
        dismissSlow() {
            this.slowDismissed = true;
            this.slowWarning = false;
        },
        onPlaying() {
            this.episodePlayed = true;
            this.autoMessage = '';
        },
        // The stream broke and couldn't be picked up again. A source that never played is swapped right away.
        onPlayerFailed({ everPlayed }) {
            if (!this.selected) return;
            if (!everPlayed && !this.episodePlayed) {
                this.sourceFailed(this.selected, "This source's video couldn't be played");
            } else {
                this.failed = { ...this.failed, [this.selected.hash]: 'Stopped working' };
            }
        },
        // Called by the player. Resolves when saved, rejects when the save failed.
        saveProgress(payload, { beacon, contentKey }) {
            const [imdbCode, season, episode] = contentKey.split(':');
            if (!season || season === 'none') return true;
            const key = progressKey(Number(season), Number(episode));

            if (imdbCode === this.imdbCode) {
                const before = this.progress[key] || {};
                this.progress = {
                    ...this.progress,
                    [key]: {
                        ...before,
                        position: payload.position,
                        duration: payload.duration,
                        completed: !!before.completed || payload.position >= payload.duration * FINISHED_RATIO
                    }
                };
            }

            const path = episodeHistoryPath(imdbCode, season, episode);
            // A normal request can be cancelled when the page is closing, a beacon can't
            if (beacon && navigator.sendBeacon) {
                const body = new Blob([JSON.stringify({ ...payload, token: session.token })], { type: 'text/plain' });
                if (navigator.sendBeacon(`${API_URL}${path}`, body)) return true;
            }

            // Saves of the same episode go out one after another, so an older position never wins
            return watchHistory.saveEpisode(imdbCode, season, episode, payload).then((response) => {
                // Watching the very last episode to the end took the series off the watchlist
                if (response.data && response.data.removedFromWatchlist) watchlist.forget(imdbCode);
            });
        },
        onTime({ currentTime, duration }) {
            if (!this.nextEpisode || duration < 120) return;
            if (currentTime / duration >= PREFETCH_AT) this.prefetchNext();

            const offerAt = Math.min(UP_NEXT_SECONDS, duration * 0.1);
            const remaining = duration - currentTime;
            if (remaining <= offerAt && !this.upNextDismissed) {
                this.showUpNext(true);
            } else if (remaining > offerAt + 5 && this.upNextVisible) {
                // Seeked back
                this.hideUpNext();
                this.upNextDismissed = false;
            }
        },
        onEnded() {
            if (!this.nextEpisode) return;
            if (!this.upNextDismissed) {
                this.goNext();
            } else {
                // Still offered, without counting down
                this.showUpNext(false);
            }
        },
        showUpNext(countdown) {
            if (this.upNextVisible && this.countdownActive === countdown) return;
            this.upNextVisible = true;
            this.countdownActive = countdown;
            this.countdown = UP_NEXT_COUNTDOWN;
            clearInterval(this.countdownTimer);
            if (!countdown) return;
            this.countdownTimer = setInterval(() => {
                // Waits while the video is paused
                if (this.$refs.player && this.$refs.player.isPaused()) return;
                this.countdown -= 1;
                if (this.countdown <= 0) this.goNext();
            }, 1000);
        },
        hideUpNext() {
            this.upNextVisible = false;
            this.countdownActive = false;
            clearInterval(this.countdownTimer);
        },
        dismissUpNext() {
            this.upNextDismissed = true;
            this.hideUpNext();
        },
        goNext() {
            const next = this.nextEpisode;
            this.hideUpNext();
            if (next) this.goTo(next);
        },
        goTo(episode) {
            if (!episode) return;
            this.$router.push({ name: 'Series', params: { imdb_code: this.imdbCode, season: String(episode.season), episode: String(episode.episode) } });
        },
        // Looks the next episode up and loads its best torrent while this one ends, so it starts right away
        async prefetchNext() {
            const next = this.nextEpisode;
            const key = `${this.imdbCode}:${next.season}:${next.episode}`;
            if (this.prefetchKey === key) return;
            this.prefetchKey = key;
            try {
                const response = await api.get(`/series/${this.imdbCode}/${next.season}/${next.episode}/sources`, { params: { caps: browserCaps() } });
                const sources = response.data.sources;
                const prefetched = { key, sources, prepared: null };
                this.prefetched = prefetched;
                const best = sources[0];
                if (!best) return;
                const prepared = await api.post(`/series/${this.imdbCode}/${next.season}/${next.episode}/prepare`, {
                    hash: best.hash,
                    caps: browserCaps(),
                    audio: this.audioFor(best),
                    at: this.resumeFor(next.season, next.episode)
                });
                prefetched.prepared = { hash: best.hash, plan: prepared.data.plan };
            } catch (err) {
                // The episode is looked up again when it opens
            }
        },
        async loadAvailability(season) {
            if (this.availability[season]) return;
            this.availability = { ...this.availability, [season]: 'loading' };
            try {
                const response = await api.get(`/series/${this.imdbCode}/season/${season}/availability`, { params: { caps: browserCaps() } });
                this.availability = { ...this.availability, [season]: response.data.episodes };
                if (this.current && this.current.season === season && this.sources.length) this.noteAvailability(this.sources);
            } catch (err) {
                const availability = { ...this.availability };
                delete availability[season];
                this.availability = availability;
            }
        }
    }
};
</script>

<style scoped>
.series-page {
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

.series-content {
    width: 100%;
    max-width: 1040px;
    box-sizing: border-box;
    flex-grow: 1;
    margin: 0 auto;
    padding: 0 var(--gutter) 48px;
}

.title-row {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    margin: 4px 0 18px;
}

.titles {
    flex: 1;
    min-width: 0;
}

.series-name {
    margin: 0 0 4px;
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.episode-title {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 14px;
    margin: 0;
    font-size: clamp(1.6rem, 3.6vw, 2.4rem);
    font-weight: 800;
    font-stretch: 115%;
    line-height: 1.1;
    letter-spacing: -0.01em;
}

.episode-code {
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.caught-up {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 14px;
    padding: 12px 16px;
    border: 1px solid rgba(110, 231, 160, 0.25);
    border-radius: 12px;
    background: rgba(110, 231, 160, 0.08);
    color: #bbf7d0;
}

.caught-up svg {
    flex: none;
    width: 20px;
    height: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.4;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* What the start screen shows while the episode isn't ready to play */
.waiting {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
}

.waiting :deep(.spinner) {
    padding: 0;
}

.overlay-message {
    max-width: 40ch;
    margin: 0;
    font-size: 1.05rem;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.6);
}

.overlay-note {
    max-width: 44ch;
    margin: 6px 0 0;
    color: var(--text-muted);
    font-size: 0.95rem;
}

.overlay-button {
    height: 42px;
    padding: 0 20px;
    border: 1px solid rgba(255, 255, 255, 0.3);
    border-radius: 21px;
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
    font-size: 0.98rem;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 0.2s ease;
}

.overlay-button:hover {
    background: rgba(255, 255, 255, 0.2);
}

/* Under the spinner, which lets clicks through to the player, so this one takes them back */
.overlay-link {
    margin-top: 4px;
    padding: 4px 8px;
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    pointer-events: auto;
}

/* The next episode, offered in the corner while the credits roll */
.up-next {
    position: absolute;
    right: 20px;
    bottom: 96px;
    z-index: 4;
    display: flex;
    gap: 14px;
    width: min(400px, calc(100% - 40px));
    padding: 12px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 16px;
    background: rgba(12, 13, 22, 0.86);
    -webkit-backdrop-filter: blur(18px) saturate(150%);
    backdrop-filter: blur(18px) saturate(150%);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55);
}

.up-next-still {
    position: relative;
    flex: 0 0 132px;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    border-radius: 10px;
    background: linear-gradient(135deg, rgba(125, 108, 240, 0.35), rgba(22, 108, 138, 0.3)) center / cover;
    overflow: hidden;
}

.ring {
    width: 44px;
    height: 44px;
    transform: rotate(-90deg);
    filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.6));
}

.ring circle {
    fill: none;
    stroke-width: 3.5;
}

.ring-track {
    stroke: rgba(255, 255, 255, 0.3);
}

.ring-fill {
    stroke: #fff;
    stroke-dasharray: 119.38;
    stroke-linecap: round;
    transition: stroke-dashoffset 1s linear;
}

.up-next-text {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    min-width: 0;
}

.up-next-label {
    margin: 0;
    color: var(--accent);
    font-size: 0.8rem;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.up-next-title {
    margin: 0;
    overflow: hidden;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.up-next-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
}

.up-next-play,
.up-next-cancel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 14px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 700;
    cursor: pointer;
}

.up-next-play {
    border: none;
    background: #f2f2f4;
    color: #0b0b10;
}

.up-next-play:hover {
    background: #fff;
}

.up-next-play svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
}

.up-next-cancel {
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: transparent;
    color: var(--text);
}

.up-next-cancel:hover {
    background: rgba(255, 255, 255, 0.1);
}

/* Shown in the top corner when the source can't keep up */
.slow-warning {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 4;
    display: flex;
    align-items: center;
    gap: 12px;
    max-width: min(420px, calc(100% - 32px));
    padding: 10px 10px 10px 14px;
    box-sizing: border-box;
    border: 1px solid rgba(241, 154, 147, 0.35);
    border-radius: 14px;
    background: rgba(24, 12, 14, 0.86);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.5);
}

.slow-dot {
    flex: none;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #f19a93;
    box-shadow: 0 0 0 5px rgba(241, 154, 147, 0.18);
}

.slow-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    font-size: 0.86rem;
    line-height: 1.35;
}

.slow-text strong {
    font-size: 0.92rem;
}

.slow-text span {
    color: var(--text-muted);
}

.slow-switch {
    flex: none;
    height: 34px;
    padding: 0 14px;
    border: none;
    border-radius: 10px;
    background: #f2f2f4;
    color: #0b0b10;
    font-size: 0.88rem;
    font-weight: 700;
    cursor: pointer;
}

.slow-close {
    flex: none;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
}

.slow-close:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
}

.slow-close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
}

.pop-enter-active,
.pop-leave-active {
    transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.2, 0.9, 0.3, 1.1);
}

.pop-enter-from,
.pop-leave-to {
    opacity: 0;
    transform: translateY(10px) scale(0.97);
}

.controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px 20px;
    margin-top: 18px;
}

.episode-nav {
    display: flex;
    gap: 8px;
}

.nav-step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 46px;
    padding: 0 16px 0 12px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
}

.nav-step.next {
    padding: 0 12px 0 18px;
    border-color: #f2f2f4;
    background: #f2f2f4;
    color: #0b0b10;
}

.nav-step:hover:not(:disabled) {
    background: var(--surface-hover);
}

.nav-step.next:hover:not(:disabled) {
    background: #fff;
}

.nav-step:disabled {
    opacity: 0.4;
    cursor: default;
}

.nav-step svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.episode-about {
    margin-top: 22px;
}

.episode-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    margin: 0;
    color: var(--text-muted);
}

.episode-rating {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text);
    font-weight: 600;
}

.episode-rating svg {
    width: 16px;
    height: 16px;
    fill: var(--accent);
}

.episode-overview {
    max-width: 72ch;
    margin: 8px 0 0;
    color: #cdd0dc;
    line-height: 1.65;
}

.about {
    margin-top: 44px;
    padding-top: 28px;
    border-top: 1px solid var(--line);
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

@media (max-width: 640px) {
    .title-row {
        align-items: flex-start;
    }

    .up-next {
        right: 10px;
        bottom: 64px;
        width: calc(100% - 20px);
        padding: 8px;
    }

    .up-next-still {
        flex-basis: 96px;
    }

    .slow-warning {
        top: 8px;
        right: 8px;
        left: 8px;
        max-width: none;
    }

    .episode-nav {
        width: 100%;
    }

    .nav-step {
        flex: 1;
        justify-content: center;
    }

    .facts {
        gap: 6px 14px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .ring-fill {
        transition: none;
    }
}
</style>
