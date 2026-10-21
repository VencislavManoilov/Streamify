<template>
    <div class="sources" :class="{ open }">
        <div class="bar">
            <button type="button" class="current" :aria-expanded="open ? 'true' : 'false'" aria-controls="source-list" @click="toggle">
                <span class="label">Source</span>
                <span v-if="selected" class="summary">
                    <span class="quality" :class="qualityClass(selected)">{{ qualityText(selected) }}</span>
                    <span class="description">{{ shortDescription(selected) }}</span>
                </span>
                <span v-else class="summary muted">{{ emptyText }}</span>
                <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            <span v-if="health" class="health" :class="health.tone" :title="health.title || ''">
                <span class="dot" aria-hidden="true"></span>{{ health.text }}
            </span>
        </div>

        <Transition name="drawer">
            <div v-if="open" id="source-list" class="drawer">
                <div class="drawer-head">
                    <p>{{ sources.length }} {{ sources.length === 1 ? 'source' : 'sources' }}, the best for this browser first</p>
                    <button type="button" class="text-button" :disabled="refreshing" @click="$emit('refresh')">
                        {{ refreshing ? 'Looking…' : 'Look again' }}
                    </button>
                </div>
                <ul class="list">
                    <li v-for="source in sources" :key="source.hash">
                        <button
                            type="button"
                            class="source"
                            :class="{ active: selected && source.hash === selected.hash, failed: !!failed[source.hash] }"
                            @click="pick(source)"
                        >
                            <span class="quality" :class="qualityClass(source)">{{ qualityText(source) }}</span>
                            <span class="body">
                                <span class="name" :title="source.release">{{ source.filename || source.release }}</span>
                                <span class="tags">
                                    <span class="seeds" :class="seedTone(source)">
                                        <span class="dot" aria-hidden="true"></span>{{ seedersText(source.seeders) }}
                                    </span>
                                    <span v-if="source.size">{{ formatSize(source.size) }}</span>
                                    <span v-if="codecText(source)">{{ codecText(source) }}</span>
                                    <span v-if="source.playback === 'convert-audio'" class="tag" title="The server converts the sound for this browser">Sound converted</span>
                                    <span v-else-if="source.playback === 'convert-video'" class="tag warn" title="The server re-encodes the whole video for this browser, which takes longer to start">Video converted</span>
                                    <span v-else-if="source.playback === 'no-sound'" class="tag bad">May play without sound</span>
                                    <span v-if="source.language === 'multi'" class="tag" title="Has the original audio and dubs">Multi-audio</span>
                                    <span v-else-if="source.language === 'dub'" class="tag warn" title="Probably dubbed into another language">Dubbed</span>
                                    <span v-if="source.hdr" class="tag" title="HDR looks washed out in most browsers">HDR</span>
                                    <span v-if="source.pack" class="tag">Season pack</span>
                                    <span class="provider">{{ source.provider }}</span>
                                </span>
                                <span v-if="failed[source.hash]" class="failed-reason">{{ failed[source.hash] }}</span>
                            </span>
                            <span v-if="selected && source.hash === selected.hash" class="playing">Playing</span>
                        </button>
                    </li>
                </ul>
            </div>
        </Transition>
    </div>
</template>

<script>
import { formatSize, seedersText } from '../playback';

const CODECS = { h264: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg4: 'XviD' };
const AUDIO = { aac: 'AAC', ac3: 'Dolby', eac3: 'Dolby+', dts: 'DTS', truehd: 'TrueHD', opus: 'Opus', flac: 'FLAC', mp3: 'MP3' };

// The torrents of the episode, the chosen one on top with how well it's streaming right now
export default {
    name: 'SourcePicker',
    props: {
        sources: {
            type: Array,
            default: () => []
        },
        selected: {
            type: Object,
            default: null
        },
        // hash -> why it didn't work
        failed: {
            type: Object,
            default: () => ({})
        },
        // { tone, text, title } of the source that plays
        health: {
            type: Object,
            default: null
        },
        emptyText: {
            type: String,
            default: 'None yet'
        },
        refreshing: {
            type: Boolean,
            default: false
        }
    },
    emits: ['select', 'refresh'],
    data() {
        return {
            open: false
        };
    },
    methods: {
        toggle() {
            this.open = !this.open;
        },
        // Opened from outside, e.g. by "Try another source"
        show() {
            this.open = true;
        },
        pick(source) {
            this.open = false;
            this.$emit('select', source);
        },
        qualityText(source) {
            if (source.resolution === '2160p') return '4K';
            return source.resolution || 'SD';
        },
        qualityClass(source) {
            return { uhd: source.resolution === '2160p', hd: source.resolution === '1080p' || source.resolution === '1440p' };
        },
        shortDescription(source) {
            return [formatSize(source.size), this.codecText(source), seedersText(source.seeders)].filter(Boolean).join(' · ');
        },
        codecText(source) {
            return [CODECS[source.codec], AUDIO[source.audio]].filter(Boolean).join(' ');
        },
        seedTone(source) {
            return { great: 'good', good: 'good', slow: 'warn', dead: 'bad' }[source.health] || 'muted';
        },
        formatSize,
        seedersText
    }
};
</script>

<style scoped>
.sources {
    position: relative;
    flex: 1 1 360px;
    min-width: 0;
}

.bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 14px;
}

.current {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    max-width: 100%;
    min-width: 0;
    height: 46px;
    padding: 0 14px 0 16px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.current:hover,
.open .current {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.22);
}

.label {
    flex: none;
    color: var(--text-faint);
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.summary {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.summary.muted {
    color: var(--text-muted);
}

.description {
    overflow: hidden;
    color: var(--text-muted);
    font-size: 0.92rem;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.chevron {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: var(--text-muted);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.25s ease;
}

.open .chevron {
    transform: rotate(180deg);
}

.quality {
    flex: none;
    min-width: 34px;
    padding: 2px 7px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-align: center;
}

.quality.hd {
    border-color: rgba(233, 195, 123, 0.6);
    color: var(--accent);
}

.quality.uhd {
    border-color: rgba(167, 139, 250, 0.65);
    color: #c4b5fd;
}

/* How the chosen source streams right now */
.health {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.92rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
}

.dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
}

.health.good,
.seeds.good {
    color: #6ee7a0;
}

.health.warn,
.seeds.warn {
    color: #f6c56b;
}

.health.bad,
.seeds.bad {
    color: #f19a93;
}

.health.good .dot {
    box-shadow: 0 0 0 4px rgba(110, 231, 160, 0.16);
}

.health.bad .dot {
    animation: blink 1.4s ease-in-out infinite;
}

.health.muted .dot {
    animation: blink 1.4s ease-in-out infinite;
}

@keyframes blink {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
}

.drawer {
    margin-top: 10px;
    padding: 10px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: rgba(16, 18, 29, 0.92);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}

.drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 4px 8px 10px;
    color: var(--text-faint);
    font-size: 0.88rem;
}

.drawer-head p {
    margin: 0;
}

.text-button {
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
}

.text-button:hover:not(:disabled) {
    color: var(--text);
}

.list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 380px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.source {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 10px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease, border-color 0.15s ease;
}

.source:hover {
    background: var(--surface);
}

.source.active {
    border-color: rgba(233, 195, 123, 0.4);
    background: rgba(233, 195, 123, 0.08);
}

.source.failed .name,
.source.failed .tags {
    opacity: 0.55;
}

.source .quality {
    margin-top: 1px;
}

.body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
}

.name {
    overflow: hidden;
    font-size: 0.92rem;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    color: var(--text-muted);
    font-size: 0.82rem;
}

.seeds {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 650;
}

.seeds .dot {
    width: 6px;
    height: 6px;
}

.tag {
    padding: 1px 7px;
    border-radius: 5px;
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-muted);
}

.tag.warn {
    background: rgba(246, 197, 107, 0.12);
    color: #f6c56b;
}

.tag.bad {
    background: rgba(241, 154, 147, 0.12);
    color: #f19a93;
}

.provider {
    color: var(--text-faint);
}

.failed-reason {
    color: #f19a93;
    font-size: 0.84rem;
}

.playing {
    flex: none;
    align-self: center;
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 750;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.drawer-enter-active,
.drawer-leave-active {
    transition: opacity 0.2s ease, transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.drawer-enter-from,
.drawer-leave-to {
    opacity: 0;
    transform: translateY(-6px);
}

@media (max-width: 640px) {
    .current {
        width: 100%;
    }

    .description {
        flex: 1;
    }

    .list {
        max-height: 320px;
    }
}

@media (prefers-reduced-motion: reduce) {
    .health .dot {
        animation: none;
    }
}
</style>
