<template>
    <button
        type="button"
        class="watchlist-button"
        :class="{ saved, pop: popping, failed }"
        aria-label="Save to watchlist"
        :aria-pressed="saved"
        :title="title"
        @click="toggle"
        @animationend="popping = false"
    >
        <svg viewBox="0 0 24 24" aria-hidden="true">
            <path class="ribbon" d="M7 3h10a1.5 1.5 0 0 1 1.5 1.5V21L12 16.5 5.5 21V4.5A1.5 1.5 0 0 1 7 3z" />
            <path v-if="saved" class="mark" d="M8.75 10l2.25 2.25L15.25 8" />
            <path v-else class="mark" d="M12 7v6M9 10h6" />
        </svg>
    </button>
</template>

<script>
import { watchlist } from '../watchlist';

// How long the button stays marked after a change couldn't be saved
const FAILED_FOR = 4000;

export default {
    name: 'WatchlistButton',
    props: {
        movie: {
            type: Object,
            required: true
        }
    },
    data() {
        return {
            popping: false,
            failed: false
        };
    },
    computed: {
        saved() {
            return watchlist.has(this.movie.imdb_code);
        },
        title() {
            if (this.failed) return "Your watchlist couldn't be updated. Try again.";
            return this.saved ? 'Remove from watchlist' : 'Add to watchlist';
        }
    },
    mounted() {
        // Until the list is loaded the movie shows as not saved
        watchlist.load().catch(() => {});
    },
    beforeUnmount() {
        clearTimeout(this.failedTimer);
    },
    methods: {
        async toggle() {
            // What the button showed decides what the click does, even when the list was still loading
            const save = !this.saved;
            this.failed = false;
            this.popping = save;

            try {
                await (save ? watchlist.add(this.movie) : watchlist.remove(this.movie));
            } catch (err) {
                this.popping = false;
                // A rejected session already sends the user to the login page
                if (err.response && err.response.status === 401) return;

                this.failed = true;
                clearTimeout(this.failedTimer);
                this.failedTimer = setTimeout(() => {
                    this.failed = false;
                }, FAILED_FOR);
            }
        }
    }
};
</script>

<style scoped>
.watchlist-button {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    padding: 0;
    box-sizing: border-box;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, transform 0.2s ease;
}

.watchlist-button:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.36);
}

.watchlist-button:active {
    transform: scale(0.94);
}

.watchlist-button svg {
    width: 24px;
    height: 24px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

/* Saved: a gold ribbon with a check */
.watchlist-button.saved {
    border-color: rgba(233, 195, 123, 0.55);
    background: rgba(233, 195, 123, 0.12);
    color: var(--accent);
}

.watchlist-button.saved:hover {
    background: rgba(233, 195, 123, 0.2);
    border-color: rgba(233, 195, 123, 0.75);
}

.watchlist-button.saved .ribbon {
    fill: currentColor;
}

.watchlist-button.saved .mark {
    stroke: #0b0b10;
}

.watchlist-button.failed {
    border-color: var(--danger);
}

.watchlist-button.pop svg {
    animation: pop 0.35s ease;
}

@keyframes pop {
    40% {
        transform: scale(1.2);
    }
}

@media (prefers-reduced-motion: reduce) {
    .watchlist-button.pop svg {
        animation: none;
    }
}
</style>
