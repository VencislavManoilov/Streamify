<template>
    <!-- Built from plain elements instead of a range input: the player styles every range input inside it,
         and an input would take the focus away from the player's keyboard shortcuts -->
    <div class="snap" :class="{ dragging, labeled: !!labels }">
        <div
            ref="track"
            class="track"
            role="slider"
            :aria-label="label"
            aria-valuemin="0"
            :aria-valuemax="count - 1"
            :aria-valuenow="modelValue"
            :aria-valuetext="valueText"
            @pointerdown="start"
            @pointermove="move"
            @pointerup="end"
            @pointercancel="end"
            @lostpointercapture="end"
        >
            <span class="rail"></span>
            <span class="fill" :style="{ width: at(modelValue) }"></span>
            <template v-if="ticks">
                <span v-for="stop in stops" :key="stop" class="tick" :class="{ passed: stop <= modelValue }" :style="{ left: at(stop) }"></span>
            </template>
            <span class="thumb" :style="{ left: at(modelValue) }"></span>
        </div>

        <div v-if="labels" class="labels">
            <button
                v-for="(text, stop) in labels"
                :key="stop"
                type="button"
                tabindex="-1"
                class="label"
                :class="{ active: stop === modelValue }"
                :style="{ left: at(stop) }"
                @click="set(stop)"
            >{{ text }}</button>
        </div>
    </div>
</template>

<script>
// The thumb's width. Stops sit from its center at one end to its center at the other end.
const THUMB = 18;

export default {
    name: 'SnapSlider',
    props: {
        // The index of the selected stop
        modelValue: {
            type: Number,
            required: true
        },
        count: {
            type: Number,
            required: true
        },
        // Text under every stop, which picks that stop when clicked
        labels: {
            type: Array,
            default: null
        },
        ticks: {
            type: Boolean,
            default: false
        },
        label: {
            type: String,
            default: ''
        },
        valueText: {
            type: String,
            default: ''
        }
    },
    emits: ['update:modelValue'],
    data() {
        return {
            dragging: false
        };
    },
    computed: {
        stops() {
            return Array.from({ length: this.count }, (_, index) => index);
        }
    },
    methods: {
        at(stop) {
            const fraction = this.count > 1 ? stop / (this.count - 1) : 0;
            return `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${fraction})`;
        },
        set(stop) {
            const value = Math.max(0, Math.min(this.count - 1, stop));
            if (value !== this.modelValue) this.$emit('update:modelValue', value);
        },
        stopAt(event) {
            const rect = this.$refs.track.getBoundingClientRect();
            const fraction = (event.clientX - rect.left - THUMB / 2) / Math.max(1, rect.width - THUMB);
            return Math.round(Math.max(0, Math.min(1, fraction)) * (this.count - 1));
        },
        start(event) {
            if (event.button !== 0) return;
            event.preventDefault();
            this.dragging = true;
            this.$refs.track.setPointerCapture(event.pointerId);
            this.set(this.stopAt(event));
        },
        move(event) {
            if (this.dragging) this.set(this.stopAt(event));
        },
        end() {
            this.dragging = false;
        }
    }
};
</script>

<style scoped>
.snap {
    position: relative;
    padding: 0 2px;
}

.snap.labeled {
    padding-bottom: 22px;
}

.track {
    position: relative;
    height: 26px;
    cursor: pointer;
    touch-action: none;
}

.rail,
.fill {
    position: absolute;
    top: 50%;
    left: 0;
    height: 6px;
    margin-top: -3px;
    border-radius: 3px;
}

.rail {
    right: 0;
    background: rgba(255, 255, 255, 0.14);
}

.fill {
    background: linear-gradient(90deg, #c9a15a, var(--accent));
    transition: width 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.15);
}

.tick {
    position: absolute;
    top: 50%;
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.4);
    transition: background-color 0.2s ease;
}

.tick.passed {
    background: rgba(16, 18, 29, 0.55);
}

/* Slides to the stop it snaps to, with a hint of overshoot */
.thumb {
    position: absolute;
    top: 50%;
    width: 18px;
    height: 18px;
    margin: -9px 0 0 -9px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 0 rgba(233, 195, 123, 0.35);
    transition: left 0.18s cubic-bezier(0.2, 0.9, 0.3, 1.15), box-shadow 0.2s ease, transform 0.2s ease;
}

.track:hover .thumb,
.dragging .thumb {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45), 0 0 0 6px rgba(233, 195, 123, 0.28);
}

.dragging .thumb {
    transform: scale(1.1);
}

.labels {
    position: absolute;
    left: 2px;
    right: 2px;
    bottom: 0;
    height: 20px;
}

.label {
    position: absolute;
    top: 0;
    padding: 0 3px;
    border: none;
    background: transparent;
    color: var(--text-faint);
    font: inherit;
    font-size: 0.78rem;
    font-variant-numeric: tabular-nums;
    line-height: 20px;
    white-space: nowrap;
    cursor: pointer;
    transform: translateX(-50%);
    transition: color 0.2s ease;
}

.label:hover {
    color: var(--text);
}

.label.active {
    color: var(--text);
    font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
    .fill,
    .thumb {
        transition: none;
    }
}
</style>
