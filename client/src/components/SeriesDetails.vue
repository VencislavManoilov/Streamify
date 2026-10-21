<template>
    <div class="container" @click.self="close">
        <article class="movie-details" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" ref="card">
            <button class="closeButton" ref="closeButton" type="button" aria-label="Close" @click="close">
                <svg class="closeSvg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>

            <div class="scroll">
                <div class="hero" :style="{ backgroundImage: series.background_image ? `url(${series.background_image})` : 'none' }">
                    <div class="headline">
                        <p class="kicker">
                            <span>Series</span>
                            <span v-if="network">{{ network }}</span>
                        </p>
                        <h1 class="title" :id="titleId">{{ series.title }}</h1>
                        <p v-if="details && details.tagline" class="tagline">{{ details.tagline }}</p>
                    </div>
                </div>

                <div class="content">
                    <div class="intro">
                        <div class="actions">
                            <router-link :to="playLink" class="play-button">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                                <span>{{ playLabel }}</span>
                            </router-link>
                            <!-- Kept together, so on narrow screens they wrap below Play as a pair -->
                            <div class="more-actions">
                                <WatchlistButton :movie="series" />
                                <a :href="'https://www.imdb.com/title/' + series.imdb_code" target="_blank" rel="noopener noreferrer" class="imdb-button" aria-label="Open on IMDb">
                                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb">
                                </a>
                                <a v-if="trailerUrl" :href="trailerUrl" target="_blank" rel="noopener noreferrer" class="trailer-button" aria-label="Watch the trailer" title="Watch the trailer on YouTube">
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 8.8v6.4l5.2-3.2z" /><circle cx="12" cy="12" r="8.6" /></svg>
                                    <span>Trailer</span>
                                </a>
                            </div>
                        </div>

                        <p v-if="nextNote" class="next-note">
                            <span class="next-episode">{{ nextNote.episode }}</span>
                            <span>{{ nextNote.text }}</span>
                        </p>

                        <p class="facts">
                            <span class="rating">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" /></svg>
                                {{ series.rating }} / 10
                            </span>
                            <span v-if="years">{{ years }}</span>
                            <span v-if="seasonCount">{{ seasonCount }} {{ seasonCount === 1 ? 'season' : 'seasons' }}</span>
                            <span v-if="episodeCount">{{ episodeCount }} episodes</span>
                            <span v-if="series.certification" class="certification" :title="`Rated ${series.certification}`">{{ series.certification }}</span>
                            <span v-if="status" class="status" :class="status.tone">{{ status.text }}</span>
                        </p>
                        <p v-if="genres" class="genres">{{ genres }}</p>
                        <p v-if="airing" class="airing">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.5" width="16" height="14.5" rx="2.5" /><path d="M8 3.5v4M16 3.5v4M4 10h16" /></svg>
                            {{ airing }}
                        </p>
                    </div>

                    <img :src="series.medium_cover_image" alt="" class="cover" />

                    <p class="summary">{{ series.summary || 'No description available.' }}</p>

                    <section v-if="seasons.length" class="seasons">
                        <h3>Seasons</h3>
                        <div class="season-list">
                            <router-link v-for="season in seasons" :key="season.number" :to="seasonLink(season)" class="season">
                                <span class="season-name">{{ season.name }}</span>
                                <span class="season-meta">{{ seasonMeta(season) }}</span>
                                <span v-if="watchedIn(season)" class="season-progress" :title="`${watchedIn(season)} of ${season.episodes.length} watched`">
                                    <span :style="{ width: `${(watchedIn(season) / season.episodes.length) * 100}%` }"></span>
                                </span>
                            </router-link>
                        </div>
                    </section>

                    <MovieExtras class="more" :details="details" :loading="detailsLoading" variant="card" />
                </div>
            </div>
        </article>
    </div>
</template>

<script>
import { episodeLabel } from '../playback';
import { formatAirDate, seriesData, seriesYears } from '../seriesData';
import MovieExtras from './MovieExtras.vue';
import WatchlistButton from './WatchlistButton.vue';

let instances = 0;

const STATUS = {
    'Returning Series': { text: 'Ongoing', tone: 'live' },
    'In Production': { text: 'In production', tone: 'live' },
    Planned: { text: 'Planned', tone: 'live' },
    Ended: { text: 'Ended', tone: 'done' },
    Canceled: { text: 'Canceled', tone: 'done' }
};

// The card of a series: what it is, how much of it there is and where the viewer is in it
export default {
    name: 'SeriesDetails',
    components: {
        MovieExtras,
        WatchlistButton
    },
    props: {
        series: {
            type: Object,
            required: true
        }
    },
    emits: ['close'],
    data() {
        instances += 1;
        return {
            titleId: `series-details-title-${instances}`,
            details: null,
            detailsLoading: true,
            seasons: [],
            // { season, episode, position, reason } from the server, see nextUp in server/utils/series.js
            next: null,
            progress: []
        };
    },
    computed: {
        network() {
            return (this.series.networks || [])[0] || '';
        },
        years() {
            return seriesYears(this.series);
        },
        regularSeasons() {
            return this.seasons.filter(season => season.number > 0);
        },
        seasonCount() {
            return this.regularSeasons.length || this.series.number_of_seasons;
        },
        episodeCount() {
            const listed = this.regularSeasons.reduce((total, season) => total + season.episodes.length, 0);
            return listed || this.series.number_of_episodes;
        },
        status() {
            return STATUS[this.series.status] || null;
        },
        genres() {
            return (this.series.genres || []).join(', ');
        },
        // When the next episode airs, for a series that's still running
        airing() {
            const next = this.series.next_episode;
            if (!next || !next.airDate) return '';
            return `Next episode ${formatAirDate(next.airDate, { weekday: 'short', day: 'numeric', month: 'long' })}`;
        },
        trailerUrl() {
            const trailer = this.details && this.details.trailer;
            return trailer ? `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}` : '';
        },
        playLink() {
            const base = `/series/${this.series.imdb_code}`;
            return this.next ? `${base}/${this.next.season}/${this.next.episode}` : base;
        },
        playLabel() {
            if (!this.next) return 'Play';
            return { resume: 'Resume', next: 'Play next', 'caught-up': 'Watch again' }[this.next.reason] || 'Play';
        },
        // Which episode the Play button opens and why
        nextNote() {
            const next = this.next;
            if (!next || next.reason === 'start') return null;
            const episode = episodeLabel(next.season, next.episode);
            if (next.reason === 'resume') {
                const entry = this.progress.find(item => item.season === next.season && item.episode === next.episode);
                const left = entry && entry.duration ? Math.max(1, Math.round((entry.duration - entry.position) / 60)) : 0;
                return { episode, text: left ? `${left} min left` : 'Continue where you stopped' };
            }
            if (next.reason === 'next') return { episode, text: this.episodeTitle(next.season, next.episode) || 'Up next' };
            const upcoming = next.upcoming && next.upcoming.aired ? ` The next one airs ${formatAirDate(next.upcoming.aired, { day: 'numeric', month: 'long' })}.` : '';
            return { episode: 'All caught up', text: `You've watched every episode.${upcoming}` };
        }
    },
    created() {
        const imdbCode = this.series.imdb_code;
        // The card works without them, so failed lookups only leave their parts out
        seriesData.details(imdbCode).then((details) => {
            this.details = details;
        }).catch(() => {}).finally(() => {
            this.detailsLoading = false;
        });
        seriesData.episodes(imdbCode).then((seasons) => {
            this.seasons = seasons;
        }).catch(() => {});
        seriesData.next(imdbCode).then(({ next, progress }) => {
            this.next = next;
            this.progress = progress;
        }).catch(() => {});
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
        },
        episodeTitle(season, episode) {
            const found = this.seasons.find(item => item.number === season);
            const match = found && found.episodes.find(item => item.episode === episode);
            return match ? match.title : '';
        },
        watchedIn(season) {
            return this.progress.filter(item => item.season === season.number && item.completed).length;
        },
        seasonMeta(season) {
            const first = season.episodes.find(episode => episode.aired);
            const year = first ? new Date(first.aired).getFullYear() : null;
            const count = `${season.episodes.length} ${season.episodes.length === 1 ? 'episode' : 'episodes'}`;
            return year ? `${count} · ${year}` : count;
        },
        // A season opens at its first episode that isn't watched yet
        seasonLink(season) {
            const unwatched = season.episodes.find(episode => !this.progress.some(item => item.season === season.number && item.episode === episode.episode && item.completed));
            const episode = (unwatched || season.episodes[0] || { episode: 1 }).episode;
            return `/series/${this.series.imdb_code}/${season.number}/${episode}`;
        }
    }
};
</script>

<style scoped src="./detailsCard.css"></style>

<style scoped>
/* "Series · AMC" above the title */
.kicker {
    display: flex;
    gap: 10px;
    margin: 0 0 8px;
    color: rgba(236, 238, 246, 0.85);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-shadow: 0 1px 10px rgba(0, 0, 0, 0.7);
}

.kicker span + span::before {
    content: '·';
    margin-right: 10px;
    color: var(--accent);
}

/* Which episode Play opens */
.next-note {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    margin: -6px 0 18px;
    color: var(--text-muted);
    font-size: 0.98rem;
}

.next-episode {
    color: var(--accent);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.status {
    padding: 1px 9px;
    border-radius: 999px;
    font-size: 0.85rem;
    font-weight: 650;
}

.status.live {
    background: rgba(74, 222, 128, 0.14);
    color: #86efac;
}

.status.done {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
}

.airing {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 0;
    color: var(--text);
    font-size: 0.98rem;
    font-weight: 600;
}

.airing svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.8;
    stroke-linecap: round;
}

.seasons {
    grid-column: 1 / -1;
    grid-row: 3;
    margin-top: 26px;
}

.seasons h3 {
    margin: 0 0 12px;
    font-size: 1.05rem;
    font-weight: 700;
    font-stretch: 112%;
}

/* The seasons in a row that scrolls sideways */
.season-list {
    display: flex;
    gap: 10px;
    margin: 0 -24px;
    padding: 2px 24px 6px;
    overflow-x: auto;
    scrollbar-width: none;
}

.season-list::-webkit-scrollbar {
    display: none;
}

.season {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 132px;
    padding: 12px 14px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
    overflow: hidden;
    transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}

.season:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.24);
}

.season:active {
    transform: scale(0.97);
}

.season-name {
    font-weight: 700;
}

.season-meta {
    color: var(--text-muted);
    font-size: 0.86rem;
    white-space: nowrap;
}

.season-progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.1);
}

.season-progress span {
    display: block;
    height: 100%;
    background: var(--accent);
}

.more {
    grid-row: 4;
}

@media (max-width: 640px) {
    .season-list {
        margin: 0 -16px;
        padding: 2px 16px 6px;
    }
}
</style>
