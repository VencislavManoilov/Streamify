<template>
    <section class="episodes" aria-labelledby="episodes-title">
        <div class="head">
            <h2 id="episodes-title">Episodes</h2>
            <div ref="tabs" class="tabs" role="tablist" aria-label="Seasons">
                <button
                    v-for="season in seasons"
                    :key="season.number"
                    type="button"
                    role="tab"
                    class="tab"
                    :class="{ active: season.number === shownSeason, playing: season.number === currentSeason }"
                    :aria-selected="season.number === shownSeason"
                    :data-season="season.number"
                    @click="showSeason(season.number)"
                >
                    <span>{{ season.name }}</span>
                    <span class="count">{{ season.episodes.length }}</span>
                    <span v-if="watchedShare(season)" class="tab-progress" aria-hidden="true">
                        <span :style="{ width: `${watchedShare(season) * 100}%` }"></span>
                    </span>
                </button>
            </div>
        </div>

        <ol v-if="shown" class="grid">
            <li v-for="episode in shown.episodes" :key="episode.episode">
                <button
                    type="button"
                    class="card"
                    :class="{ current: isCurrent(episode), watched: isWatched(episode), unaired: !aired(episode), missing: availabilityOf(episode).tone === 'bad' }"
                    :disabled="!aired(episode)"
                    :aria-current="isCurrent(episode) ? 'true' : null"
                    :aria-label="cardLabel(episode)"
                    @click="$emit('select', { season: shown.number, episode: episode.episode })"
                >
                    <span class="thumb">
                        <img v-if="episode.still && !brokenStills[stillKey(episode)]" :src="episode.still" alt="" loading="lazy" @error="brokenStills[stillKey(episode)] = true" />
                        <span v-else class="thumb-fallback" aria-hidden="true"></span>
                        <span class="number" aria-hidden="true">{{ episode.episode }}</span>
                        <span v-if="episode.runtime" class="runtime" aria-hidden="true">{{ episode.runtime }}m</span>
                        <span v-if="isCurrent(episode)" class="now" aria-hidden="true">
                            <span class="bars"><span></span><span></span><span></span></span>
                            Playing
                        </span>
                        <span v-else-if="aired(episode)" class="hover-play" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" /></svg>
                        </span>
                        <span v-if="isWatched(episode) && !isCurrent(episode)" class="check" aria-hidden="true">
                            <svg viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8" /></svg>
                        </span>
                        <span v-if="progressShare(episode)" class="progress" aria-hidden="true">
                            <span :style="{ width: `${progressShare(episode) * 100}%` }"></span>
                        </span>
                    </span>

                    <span class="info">
                        <span class="title">{{ episode.title || `Episode ${episode.episode}` }}</span>
                        <span class="meta">
                            <span v-if="episode.aired" class="date">{{ aired(episode) ? formatDate(episode.aired) : `Airs ${formatDate(episode.aired)}` }}</span>
                            <span v-if="aired(episode)" class="availability" :class="availabilityOf(episode).tone" :title="availabilityOf(episode).title">
                                <span class="dot" aria-hidden="true"></span>{{ availabilityOf(episode).text }}
                            </span>
                        </span>
                        <span v-if="episode.overview" class="overview">{{ episode.overview }}</span>
                    </span>
                </button>
            </li>
        </ol>
    </section>
</template>

<script>
import { formatAirDate, hasAired } from '../seriesData';
import { seedersText } from '../playback';

/**
 * The seasons of a series as tabs and the episodes of one as cards: how far each was watched and whether
 * it can be watched, from `availability` (see /series/:imdb_code/season/:season/availability).
 */
export default {
    name: 'EpisodePicker',
    props: {
        seasons: {
            type: Array,
            required: true
        },
        currentSeason: {
            type: Number,
            default: null
        },
        currentEpisode: {
            type: Number,
            default: null
        },
        // "season:episode" -> { position, duration, completed }
        progress: {
            type: Object,
            default: () => ({})
        },
        // season -> episode -> { count, health, seeders, resolution }, or 'loading'
        availability: {
            type: Object,
            default: () => ({})
        }
    },
    emits: ['select', 'season'],
    data() {
        return {
            shownSeason: this.currentSeason !== null ? this.currentSeason : (this.seasons[0] && this.seasons[0].number),
            brokenStills: {}
        };
    },
    computed: {
        shown() {
            return this.seasons.find(season => season.number === this.shownSeason) || this.seasons[0] || null;
        }
    },
    watch: {
        // The next episode may be in the next season
        currentSeason(season) {
            if (season !== null) this.showSeason(season);
        },
        shownSeason: {
            immediate: true,
            handler(season) {
                if (season !== null && season !== undefined) this.$emit('season', season);
            }
        }
    },
    mounted() {
        this.scrollTabIntoView();
    },
    methods: {
        showSeason(number) {
            this.shownSeason = number;
            this.$nextTick(() => this.scrollTabIntoView());
        },
        scrollTabIntoView() {
            const tab = this.$refs.tabs && this.$refs.tabs.querySelector(`[data-season="${this.shownSeason}"]`);
            if (!tab) return;
            const tabs = this.$refs.tabs;
            const left = tab.offsetLeft - (tabs.clientWidth - tab.offsetWidth) / 2;
            tabs.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
        },
        stillKey(episode) {
            return `${this.shown.number}:${episode.episode}`;
        },
        entry(episode) {
            return this.progress[`${this.shown.number}:${episode.episode}`] || null;
        },
        isCurrent(episode) {
            return this.shown.number === this.currentSeason && episode.episode === this.currentEpisode;
        },
        isWatched(episode) {
            const entry = this.entry(episode);
            return !!entry && (entry.completed || (entry.duration > 0 && entry.position >= entry.duration * 0.95));
        },
        progressShare(episode) {
            const entry = this.entry(episode);
            if (!entry || !entry.duration || this.isWatched(episode)) return 0;
            return Math.min(1, Math.max(0.03, entry.position / entry.duration));
        },
        watchedShare(season) {
            if (!season.episodes.length) return 0;
            const watched = season.episodes.filter((episode) => {
                const entry = this.progress[`${season.number}:${episode.episode}`];
                return entry && (entry.completed || (entry.duration > 0 && entry.position >= entry.duration * 0.95));
            }).length;
            return watched / season.episodes.length;
        },
        aired(episode) {
            return hasAired(episode);
        },
        formatDate(date) {
            return formatAirDate(date);
        },
        availabilityOf(episode) {
            const season = this.availability[this.shown.number];
            if (season === 'loading' || !season) return { tone: 'checking', text: 'Checking…', title: 'Looking for torrents of this episode' };
            const found = season[episode.episode];
            if (!found) return { tone: 'muted', text: '', title: '' };
            if (found.health === 'unknown') return { tone: 'muted', text: "Couldn't check", title: 'The torrent sites could not be asked right now' };
            if (found.health === 'none' || !found.count) return { tone: 'bad', text: 'Not available', title: 'No torrent of this episode was found' };
            if (found.health === 'dead') return { tone: 'bad', text: 'No seeders', title: 'Its torrents have nobody sharing them right now' };
            const quality = found.resolution || 'Available';
            if (found.health === 'slow') return { tone: 'warn', text: `${quality} · slow`, title: `Only ${seedersText(found.seeders)}, it may load slowly` };
            return { tone: 'good', text: quality, title: `${found.count} ${found.count === 1 ? 'source' : 'sources'}, up to ${seedersText(found.seeders)}` };
        },
        cardLabel(episode) {
            const parts = [`Episode ${episode.episode}`, episode.title];
            if (!this.aired(episode)) parts.push(`airs ${this.formatDate(episode.aired)}`);
            else if (this.isWatched(episode)) parts.push('watched');
            else if (this.progressShare(episode)) parts.push(`${Math.round(this.progressShare(episode) * 100)}% watched`);
            const availability = this.availabilityOf(episode);
            if (availability.text && this.aired(episode)) parts.push(availability.text);
            return parts.filter(Boolean).join(', ');
        }
    }
};
</script>

<style scoped>
.episodes {
    margin-top: 36px;
}

.head {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin-bottom: 18px;
}

.head h2 {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 700;
    font-stretch: 112%;
}

/* Seasons as pills in a row that scrolls sideways */
.tabs {
    display: flex;
    gap: 8px;
    margin: 0 calc(var(--gutter) * -1);
    padding: 2px var(--gutter) 4px;
    overflow-x: auto;
    scrollbar-width: none;
}

.tabs::-webkit-scrollbar {
    display: none;
}

.tab {
    position: relative;
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: 20px;
    background: var(--surface);
    color: var(--text);
    font-size: 0.95rem;
    font-weight: 600;
    overflow: hidden;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.tab:hover {
    background: var(--surface-hover);
}

.tab.active {
    border-color: #f2f2f4;
    background: #f2f2f4;
    color: #0b0b10;
}

.count {
    color: var(--text-faint);
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
}

.tab.active .count {
    color: rgba(11, 11, 16, 0.5);
}

/* The season with the episode that's playing */
.tab.playing:not(.active)::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
}

/* How much of the season has been watched */
.tab-progress {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 5px;
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.12);
}

.tab-progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent);
}

.tab.active .tab-progress {
    background: rgba(11, 11, 16, 0.12);
}

.tab.active .tab-progress span {
    background: #b38a3c;
}

.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    gap: 22px 18px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.card {
    display: flex;
    flex-direction: column;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}

.card:disabled {
    cursor: default;
}

.thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    border-radius: 12px;
    overflow: hidden;
    background: var(--surface);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.25s ease;
}

.card:hover:not(:disabled) .thumb {
    transform: translateY(-3px);
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.45);
}

.card:focus-visible {
    outline: none;
}

.card:focus-visible .thumb {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
}

.thumb img,
.thumb-fallback {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.thumb-fallback {
    background: linear-gradient(135deg, rgba(125, 108, 240, 0.32), rgba(22, 108, 138, 0.28));
}

/* Darker at the bottom, where the number and the progress sit */
.thumb::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(to top, rgba(4, 5, 10, 0.78) 0%, rgba(4, 5, 10, 0.1) 45%, rgba(4, 5, 10, 0) 70%);
    pointer-events: none;
}

.number {
    position: absolute;
    left: 12px;
    bottom: 8px;
    z-index: 1;
    font-size: 1.9rem;
    font-weight: 800;
    font-stretch: 125%;
    line-height: 1;
    text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
}

.runtime {
    position: absolute;
    right: 10px;
    bottom: 12px;
    z-index: 1;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(8, 9, 16, 0.66);
    font-size: 0.78rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
}

.hover-play,
.now {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: grid;
    place-items: center;
}

.hover-play svg {
    width: 48px;
    height: 48px;
    padding: 11px 9px 11px 13px;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.4);
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.16);
    -webkit-backdrop-filter: blur(10px);
    backdrop-filter: blur(10px);
    fill: #fff;
    opacity: 0;
    transform: scale(0.85);
    transition: opacity 0.2s ease, transform 0.25s ease;
}

.card:hover .hover-play svg,
.card:focus-visible .hover-play svg {
    opacity: 1;
    transform: none;
}

/* The episode that's playing: dimmed, with moving bars */
.now {
    grid-auto-flow: column;
    gap: 8px;
    align-content: center;
    justify-content: center;
    align-items: center;
    background: rgba(6, 7, 13, 0.55);
    color: var(--accent);
    font-size: 0.9rem;
    font-weight: 750;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.bars {
    display: inline-flex;
    align-items: flex-end;
    gap: 3px;
    height: 16px;
}

.bars span {
    width: 3px;
    height: 100%;
    border-radius: 1px;
    background: currentColor;
    animation: bars 1s ease-in-out infinite;
    transform-origin: bottom;
}

.bars span:nth-child(2) {
    animation-delay: -0.35s;
}

.bars span:nth-child(3) {
    animation-delay: -0.7s;
}

@keyframes bars {
    0%, 100% { transform: scaleY(0.35); }
    50% { transform: scaleY(1); }
}

.check {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--accent);
    color: #1a1406;
}

.check svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.progress {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2;
    height: 4px;
    background: rgba(255, 255, 255, 0.24);
}

.progress span {
    display: block;
    height: 100%;
    background: var(--accent);
}

.card.watched .thumb img {
    filter: saturate(0.7) brightness(0.8);
}

.card.unaired .thumb {
    opacity: 0.45;
    box-shadow: none;
}

.card.missing:not(.current) .thumb img {
    filter: grayscale(0.85) brightness(0.65);
}

.card.current .thumb {
    box-shadow: 0 0 0 2px var(--accent), 0 14px 34px rgba(0, 0, 0, 0.45);
}

.info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px 2px 0;
    min-width: 0;
}

.title {
    overflow: hidden;
    font-weight: 700;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.card.current .title {
    color: var(--accent);
}

.meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 2px 12px;
    color: var(--text-faint);
    font-size: 0.86rem;
}

.availability {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
}

.dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
}

.availability.good {
    color: #6ee7a0;
}

.availability.warn {
    color: #f6c56b;
}

.availability.bad {
    color: #f19a93;
}

.availability.muted {
    color: var(--text-faint);
}

.availability.checking {
    color: var(--text-faint);
}

.availability.checking .dot {
    animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
}

.overview {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.45;
}

/* On phones every episode is a row: the still on the left, the text next to it */
@media (max-width: 640px) {
    .grid {
        grid-template-columns: 1fr;
        gap: 16px;
    }

    .card {
        flex-direction: row;
        gap: 14px;
        align-items: flex-start;
    }

    .thumb {
        flex: 0 0 42%;
        border-radius: 10px;
    }

    .info {
        padding-top: 2px;
    }

    .title {
        white-space: normal;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
    }

    .number {
        left: 9px;
        bottom: 6px;
        font-size: 1.4rem;
    }

    .runtime {
        right: 6px;
        bottom: 8px;
    }

    .overview {
        -webkit-line-clamp: 3;
    }
}

@media (prefers-reduced-motion: reduce) {
    .thumb,
    .hover-play svg {
        transition: none;
    }

    .bars span,
    .availability.checking .dot {
        animation: none;
    }
}
</style>
