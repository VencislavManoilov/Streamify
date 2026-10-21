<template>
    <div ref="track" class="media-switch" :class="{ three: options.length === 3 }" role="radiogroup" :aria-label="filtering ? 'Show' : 'Browse'">
        <span class="indicator" :class="{ ready: indicatorReady }" :style="indicatorStyle" aria-hidden="true"></span>
        <button
            v-for="option in options"
            :key="option.value"
            :ref="el => setButton(option.value, el)"
            type="button"
            role="radio"
            class="option"
            :class="{ active: option.value === active }"
            :aria-checked="option.value === active"
            @click="choose(option.value)"
        >
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <template v-if="option.value === 'movie'">
                    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
                    <path d="M3.5 9.5h17M8 5l2 4.5M13 5l2 4.5" />
                </template>
                <template v-else-if="option.value === 'series'">
                    <rect x="3" y="6.5" width="18" height="12.5" rx="2.5" />
                    <path d="M8.5 3l3.5 3.5L15.5 3M9 22h6" />
                </template>
                <template v-else>
                    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
                    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
                    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
                    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
                </template>
            </svg>
            <span>{{ option.label }}</span>
        </button>
    </div>
</template>

<script>
const SERIES_PAGES = ['SeriesHome', 'Series'];

/**
 * Movies or series. On the home pages and the movie and series pages it goes to that catalog. On the search
 * page it filters the results instead, and also offers all of them, which every new search starts with.
 */
export default {
    name: 'MediaSwitch',
    data() {
        return {
            indicator: { left: 0, width: 0 },
            indicatorReady: false
        };
    },
    computed: {
        filtering() {
            return this.$route.name === 'Search';
        },
        options() {
            const kinds = [
                { value: 'movie', label: 'Movies' },
                { value: 'series', label: 'Series' }
            ];
            return this.filtering ? [{ value: 'all', label: 'All' }, ...kinds] : kinds;
        },
        active() {
            if (this.filtering) {
                const type = this.$route.query.type;
                return type === 'movie' || type === 'series' ? type : 'all';
            }
            return SERIES_PAGES.includes(this.$route.name) ? 'series' : 'movie';
        },
        indicatorStyle() {
            return { transform: `translateX(${this.indicator.left}px)`, width: `${this.indicator.width}px` };
        }
    },
    watch: {
        active() {
            this.$nextTick(() => this.placeIndicator());
        },
        options() {
            this.$nextTick(() => this.placeIndicator());
        }
    },
    created() {
        this.buttons = {};
    },
    mounted() {
        this.placeIndicator();
        // Fonts and the header's layout settle a moment later
        this.resizeObserver = new ResizeObserver(() => this.placeIndicator());
        this.resizeObserver.observe(this.$refs.track);
        requestAnimationFrame(() => {
            this.indicatorReady = true;
        });
    },
    beforeUnmount() {
        if (this.resizeObserver) this.resizeObserver.disconnect();
    },
    methods: {
        setButton(value, element) {
            if (element) this.buttons[value] = element;
        },
        placeIndicator() {
            const button = this.buttons[this.active];
            if (!button) return;
            this.indicator = { left: button.offsetLeft, width: button.offsetWidth };
        },
        choose(value) {
            if (this.filtering) {
                // Replaced like the other filters, so Back leaves the results in one step
                this.$router.replace({ query: { ...this.$route.query, type: value === 'all' ? undefined : value } });
                return;
            }
            if (value === this.active && !['Movie', 'Series'].includes(this.$route.name)) return;
            this.$router.push(value === 'series' ? { name: 'SeriesHome' } : { name: 'Home' });
        }
    }
};
</script>

<style scoped>
.media-switch {
    position: relative;
    display: flex;
    flex: none;
    height: 44px;
    padding: 3px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 22px;
    background: var(--surface);
}

/* The light pill under the chosen option, which slides to the one picked next */
.indicator {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 0;
    border-radius: 19px;
    background: #f2f2f4;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
}

.indicator.ready {
    transition: transform 0.32s cubic-bezier(0.3, 1.3, 0.5, 1), width 0.32s cubic-bezier(0.3, 1.3, 0.5, 1);
}

.option {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 0 15px 0 12px;
    border: none;
    border-radius: 19px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.25s ease;
}

.option:hover {
    color: var(--text);
}

.option.active {
    color: #0b0b10;
}

.option svg {
    width: 18px;
    height: 18px;
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* On phones it gets the whole width of its own row, see AppHeader */
@media (max-width: 640px) {
    .media-switch {
        width: 100%;
        height: 40px;
    }

    .option {
        flex: 1;
    }
}

@media (prefers-reduced-motion: reduce) {
    .indicator.ready {
        transition: none;
    }
}
</style>
