<template>
    <div class="spinner" :class="{ overlay }" role="status">
        <span class="glow" :style="{ width: diameter + 'px', height: diameter + 'px', '--thickness': thickness + 'px' }">
            <span class="track"></span>
            <span class="arc"></span>
        </span>
        <span class="sr-only">{{ label }}</span>
    </div>
</template>

<script>
export default {
    name: 'LoadingSpinner',
    props: {
        // Defaults to 48px, or 60px when it covers the whole screen
        size: {
            type: Number,
            default: null
        },
        // Covers the whole screen and centers the spinner in it
        overlay: {
            type: Boolean,
            default: false
        },
        label: {
            type: String,
            default: 'Loading'
        }
    },
    computed: {
        diameter() {
            return this.size || (this.overlay ? 60 : 48);
        },
        thickness() {
            return Math.max(2, Math.round(this.diameter / 14));
        }
    }
};
</script>

<style scoped>
.spinner {
    display: grid;
    place-items: center;
    padding: 24px 0;
    /* Quick loads finish before the spinner shows up, so it doesn't flicker */
    animation: spinner-in 0.3s ease 0.15s both;
}

.spinner.overlay {
    position: fixed;
    inset: 0;
    padding: 0;
    z-index: 5;
    pointer-events: none;
}

/* The glow sits on a wrapper because a mask would cut off a drop shadow on the arc itself */
.glow {
    position: relative;
    display: block;
    filter: drop-shadow(0 0 10px rgba(233, 195, 123, 0.35));
}

.track,
.arc {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - var(--thickness)), #000 calc(100% - var(--thickness) + 0.5px));
    mask: radial-gradient(farthest-side, transparent calc(100% - var(--thickness)), #000 calc(100% - var(--thickness) + 0.5px));
}

.track {
    background: rgba(255, 255, 255, 0.08);
}

.arc {
    background: conic-gradient(
        from 0deg,
        rgba(125, 108, 240, 0) 0deg,
        rgba(125, 108, 240, 0.55) 140deg,
        var(--accent) 300deg,
        #fff8e8 356deg,
        transparent 360deg
    );
    animation: spin 0.9s linear infinite;
}

/* Rounded, bright head of the comet */
.arc::after {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: var(--thickness);
    height: var(--thickness);
    border-radius: 50%;
    background: #fff8e8;
    transform: translateX(-50%);
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@keyframes spinner-in {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes pulse {
    0%, 100% { opacity: 0.35; }
    50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .arc {
        animation: pulse 1.6s ease-in-out infinite;
    }
}
</style>
