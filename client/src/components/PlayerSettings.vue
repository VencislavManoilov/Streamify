<template>
    <div class="settings" role="dialog" aria-label="Player settings">
        <Transition :name="view === 'style' ? 'slide-forward' : 'slide-back'" mode="out-in">
            <div v-if="view === 'main'" key="main" class="view">
                <section class="group">
                    <div class="group-head">
                        <h3>Playback speed</h3>
                        <span class="value">{{ speedText }}</span>
                    </div>
                    <SnapSlider
                        :model-value="speedIndex"
                        :count="speeds.length"
                        :labels="speedLabels"
                        ticks
                        label="Playback speed"
                        :value-text="speedText"
                        @update:model-value="$emit('update:speed', speeds[$event])"
                    />
                </section>

                <section class="group">
                    <div class="group-head">
                        <h3>Subtitles</h3>
                    </div>
                    <div class="chips" role="radiogroup" aria-label="Subtitles">
                        <button
                            v-for="option in trackOptions"
                            :key="option.index"
                            type="button"
                            tabindex="-1"
                            role="radio"
                            class="chip"
                            :class="{ active: option.index === currentTrack, missing: option.status === 'error' }"
                            :aria-checked="option.index === currentTrack"
                            :disabled="option.status === 'error'"
                            :title="option.status === 'error' ? `No ${option.label} subtitles were found` : ''"
                            @click="$emit('select-track', option.index)"
                        >
                            {{ option.label }}
                            <span v-if="option.status === 'loading' && option.index === currentTrack" class="pulse" aria-hidden="true"></span>
                        </button>
                    </div>
                    <p v-if="trackNote" class="note">{{ trackNote }}</p>

                    <div v-if="current && current.status !== 'error'" class="sync">
                        <div class="group-head">
                            <h3>Sync</h3>
                            <span class="value" :class="{ muted: !offset }">{{ offsetText }}</span>
                            <button v-if="offset" type="button" tabindex="-1" class="icon-button" title="Back to the original timing" aria-label="Reset the sync" @click="$emit('update:offset', 0)">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4" /></svg>
                            </button>
                        </div>
                        <div class="nudges">
                            <button v-for="step in nudges" :key="step" type="button" tabindex="-1" class="nudge" @click="nudge(step)">{{ stepText(step) }}</button>
                        </div>
                        <p class="note">{{ offsetHint }}</p>
                    </div>
                </section>

                <button type="button" tabindex="-1" class="row-button" @click="view = 'style'">
                    <span>Subtitle style</span>
                    <span class="row-value">{{ styleSummary }}</span>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>
                </button>
            </div>

            <div v-else key="style" class="view">
                <button type="button" tabindex="-1" class="back" @click="view = 'main'">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6" /></svg>
                    <span>Subtitle style</span>
                </button>

                <div class="preview" aria-hidden="true">
                    <span class="preview-text" :style="previewStyle">This is how subtitles look</span>
                </div>

                <section class="group">
                    <div class="group-head">
                        <h3>Size</h3>
                        <span class="value">{{ Math.round(subtitleStyle.fontSize * 100) }}%</span>
                    </div>
                    <SnapSlider
                        :model-value="sizeIndex"
                        :count="sizes.length"
                        label="Subtitle size"
                        :value-text="`${Math.round(subtitleStyle.fontSize * 100)}%`"
                        @update:model-value="changeStyle({ fontSize: sizes[$event] })"
                    />
                </section>

                <section class="group">
                    <div class="group-head">
                        <h3>Background</h3>
                        <span class="value">{{ Math.round(subtitleStyle.bgOpacity * 100) }}%</span>
                    </div>
                    <SnapSlider
                        :model-value="backgroundIndex"
                        :count="backgrounds.length"
                        label="Subtitle background"
                        :value-text="`${Math.round(subtitleStyle.bgOpacity * 100)}%`"
                        @update:model-value="changeStyle({ bgOpacity: backgrounds[$event] })"
                    />
                </section>

                <section class="group">
                    <div class="group-head">
                        <h3>Color</h3>
                    </div>
                    <div class="swatches" role="radiogroup" aria-label="Subtitle color">
                        <button
                            v-for="color in colors"
                            :key="color"
                            type="button"
                            tabindex="-1"
                            role="radio"
                            class="swatch"
                            :class="{ active: subtitleStyle.color === color }"
                            :aria-checked="subtitleStyle.color === color"
                            :aria-label="color"
                            :style="{ '--swatch': color }"
                            @click="changeStyle({ color })"
                        ></button>
                    </div>
                </section>

                <button type="button" tabindex="-1" class="text-button" :disabled="isDefaultStyle" @click="$emit('update:subtitle-style', { ...defaultStyle })">Reset to default</button>
            </div>
        </Transition>
    </div>
</template>

<script>
import { DEFAULT_STYLE, SUBTITLE_COLORS } from '../subtitles';
import SnapSlider from './SnapSlider.vue';

const SIZES = Array.from({ length: 16 }, (_, index) => Math.round((0.5 + index * 0.1) * 10) / 10);
const BACKGROUNDS = Array.from({ length: 11 }, (_, index) => index / 10);
const NUDGES = [-1, -0.1, 0.1, 1];

function nearest(values, value) {
    let best = 0;
    values.forEach((candidate, index) => {
        if (Math.abs(candidate - value) < Math.abs(values[best] - value)) best = index;
    });
    return best;
}

function seconds(value) {
    return `${Math.abs(value).toFixed(1)} s`;
}

export default {
    name: 'PlayerSettings',
    components: {
        SnapSlider
    },
    props: {
        speed: {
            type: Number,
            required: true
        },
        speeds: {
            type: Array,
            required: true
        },
        // [{ index, label, status }] where status is 'idle', 'loading', 'ready' or 'error'
        tracks: {
            type: Array,
            default: () => []
        },
        // -1 when subtitles are off
        currentTrack: {
            type: Number,
            default: -1
        },
        // Seconds the current subtitles are moved by, later when positive
        offset: {
            type: Number,
            default: 0
        },
        subtitleStyle: {
            type: Object,
            required: true
        }
    },
    emits: ['update:speed', 'select-track', 'update:offset', 'update:subtitle-style'],
    data() {
        return {
            view: 'main',
            sizes: SIZES,
            backgrounds: BACKGROUNDS,
            nudges: NUDGES,
            colors: SUBTITLE_COLORS,
            defaultStyle: DEFAULT_STYLE
        };
    },
    computed: {
        speedIndex() {
            return nearest(this.speeds, this.speed);
        },
        speedLabels() {
            return this.speeds.map(speed => String(speed));
        },
        speedText() {
            return this.speed === 1 ? 'Normal' : `${this.speed}×`;
        },
        trackOptions() {
            return [{ index: -1, label: 'Off', status: 'ready' }, ...this.tracks];
        },
        current() {
            return this.tracks.find(track => track.index === this.currentTrack) || null;
        },
        trackNote() {
            if (!this.current) return '';
            if (this.current.status === 'loading') return `Loading the ${this.current.label} subtitles…`;
            if (this.current.status === 'error') return `No ${this.current.label} subtitles were found for this movie.`;
            return '';
        },
        offsetText() {
            if (!this.offset) return '0.0 s';
            return `${this.offset > 0 ? '+' : '−'}${seconds(this.offset)}`;
        },
        offsetHint() {
            if (this.offset > 0) return `Subtitles show ${seconds(this.offset)} later than in the file.`;
            if (this.offset < 0) return `Subtitles show ${seconds(this.offset)} earlier than in the file.`;
            return 'Subtitles too early? Press +. Too late? Press −.';
        },
        sizeIndex() {
            return nearest(this.sizes, this.subtitleStyle.fontSize);
        },
        backgroundIndex() {
            return nearest(this.backgrounds, this.subtitleStyle.bgOpacity);
        },
        styleSummary() {
            return `${Math.round(this.subtitleStyle.fontSize * 100)}%`;
        },
        isDefaultStyle() {
            return Object.keys(DEFAULT_STYLE).every(key => this.subtitleStyle[key] === DEFAULT_STYLE[key]);
        },
        previewStyle() {
            return {
                fontSize: `${Math.round(15 * this.subtitleStyle.fontSize)}px`,
                color: this.subtitleStyle.color,
                backgroundColor: `rgba(0, 0, 0, ${this.subtitleStyle.bgOpacity})`
            };
        }
    },
    methods: {
        nudge(step) {
            // Kept in tenths of a second, so adding steps up never drifts to 0.30000000000000004
            this.$emit('update:offset', Math.round((this.offset + step) * 10) / 10);
        },
        stepText(step) {
            const sign = step > 0 ? '+' : '−';
            return Math.abs(step) >= 1 ? `${sign}${Math.abs(step)} s` : `${sign}${Math.abs(step) * 1000} ms`;
        },
        changeStyle(change) {
            this.$emit('update:subtitle-style', { ...this.subtitleStyle, ...change });
        }
    }
};
</script>

<style scoped>
.settings {
    position: absolute;
    right: -4px;
    /* Clears the whole control bar, which reaches above the gear */
    bottom: calc(100% + var(--settings-offset, 12px));
    z-index: 5;
    width: 340px;
    max-width: calc(100vw - 32px);
    max-height: var(--settings-max-height, 480px);
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
    padding: 18px 18px 14px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 18px;
    background: linear-gradient(180deg, rgba(26, 28, 44, 0.93) 0%, rgba(14, 15, 26, 0.96) 100%);
    -webkit-backdrop-filter: blur(22px) saturate(150%);
    backdrop-filter: blur(22px) saturate(150%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.07), 0 28px 70px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(0, 0, 0, 0.25);
    color: var(--text);
    font-family: var(--font);
    font-size: 0.95rem;
    line-height: 1.4;
    text-align: left;
    cursor: default;
    transform-origin: calc(100% - 22px) calc(100% + var(--settings-offset, 12px));
}

.view {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.group {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.group + .group {
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
}

.group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
}

.group-head h3 {
    flex: 1;
    margin: 0;
    font-size: 0.92rem;
    font-weight: 650;
    letter-spacing: 0.01em;
}

.value {
    color: var(--accent);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
}

.value.muted {
    color: var(--text-muted);
    font-weight: 600;
}

.chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 15px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
    font: inherit;
    font-size: 0.9rem;
    font-weight: 550;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.15s ease;
}

.chip:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.13);
}

.chip:active:not(:disabled) {
    transform: scale(0.96);
}

.chip.active {
    border-color: #f2f2f4;
    background: #f2f2f4;
    color: #0b0b10;
    font-weight: 700;
}

.chip.missing {
    color: var(--text-faint);
    text-decoration: line-through;
    text-decoration-color: rgba(255, 255, 255, 0.3);
    cursor: not-allowed;
}

/* Picked, but there's nothing to show */
.chip.active.missing {
    border-color: rgba(229, 115, 107, 0.55);
    background: rgba(229, 115, 107, 0.14);
    color: #f3b4ae;
    font-weight: 600;
    text-decoration-color: rgba(243, 180, 174, 0.6);
}

/* Pulses next to a language whose subtitles are still on their way */
.pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite;
}

.note {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.84rem;
}

.sync {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 6px;
    padding: 12px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.nudges {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
}

.nudge {
    height: 36px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.07);
    color: var(--text);
    font: inherit;
    font-size: 0.86rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.15s ease;
}

.nudge:hover {
    background: rgba(255, 255, 255, 0.14);
}

.nudge:active {
    transform: scale(0.95);
    background: rgba(233, 195, 123, 0.22);
}

.icon-button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.icon-button:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text);
}

.icon-button svg,
.row-button svg,
.back svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.row-button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    margin-top: -2px;
    padding: 12px 8px 4px 0;
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.07);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.92rem;
    font-weight: 650;
    text-align: left;
    cursor: pointer;
}

.row-button span:first-child {
    flex: 1;
}

.row-value {
    color: var(--text-muted);
    font-weight: 500;
}

.row-button svg {
    color: var(--text-muted);
    transition: transform 0.2s ease;
}

.row-button:hover svg {
    transform: translateX(2px);
    color: var(--text);
}

.back {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: -6px 0 -4px -6px;
    padding: 4px 8px 4px 2px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 0.98rem;
    font-weight: 700;
    cursor: pointer;
    align-self: flex-start;
}

.back:hover {
    background: rgba(255, 255, 255, 0.08);
}

/* A still from a dark scene with a line of subtitles, styled like the real ones */
.preview {
    display: grid;
    place-items: end center;
    height: 78px;
    padding: 0 12px 12px;
    border-radius: 12px;
    background:
        radial-gradient(ellipse 70% 90% at 30% 20%, rgba(125, 108, 240, 0.35), transparent 70%),
        radial-gradient(ellipse 60% 80% at 85% 40%, rgba(22, 108, 138, 0.45), transparent 70%),
        linear-gradient(160deg, #1a1c2e, #07080f);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
    overflow: hidden;
}

.preview-text {
    padding: 0.15em 0.5em;
    border-radius: 2px;
    line-height: 1.5;
    text-align: center;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    white-space: nowrap;
}

.swatches {
    display: flex;
    gap: 12px;
}

.swatch {
    width: 30px;
    height: 30px;
    padding: 0;
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-radius: 50%;
    background: var(--swatch);
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.swatch:hover {
    transform: scale(1.08);
}

.swatch.active {
    border-color: #10121d;
    box-shadow: 0 0 0 2px var(--swatch), 0 0 14px var(--swatch);
}

.text-button {
    align-self: flex-start;
    padding: 2px 0;
    border: none;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: 0.88rem;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
}

.text-button:hover:not(:disabled) {
    color: var(--text);
}

.text-button:disabled {
    opacity: 0.45;
    cursor: default;
}

.slide-forward-enter-active,
.slide-forward-leave-active,
.slide-back-enter-active,
.slide-back-leave-active {
    transition: opacity 0.16s ease, transform 0.16s ease;
}

.slide-forward-enter-from,
.slide-back-leave-to {
    opacity: 0;
    transform: translateX(16px);
}

.slide-forward-leave-to,
.slide-back-enter-from {
    opacity: 0;
    transform: translateX(-16px);
}

@keyframes pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .slide-forward-enter-active,
    .slide-forward-leave-active,
    .slide-back-enter-active,
    .slide-back-leave-active {
        transition: opacity 0.16s ease;
    }

    .pulse {
        animation: none;
    }
}
</style>
