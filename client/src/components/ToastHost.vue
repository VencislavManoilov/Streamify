<template>
    <!-- Moves into the fullscreen element while there is one, so the popups show over a fullscreen movie too -->
    <Teleport :to="target">
        <div class="toasts">
            <!-- A dim that pours down from the top edge of the screen and wraps around the popups -->
            <Transition name="dim">
                <div v-if="items.length" :key="tone" class="dim" :class="tone" aria-hidden="true"></div>
            </Transition>

            <TransitionGroup name="toast" tag="div" class="stack">
                <div
                    v-for="item in items"
                    :key="item.id"
                    class="toast"
                    :class="item.tone"
                    :role="item.tone === 'danger' ? 'alert' : 'status'"
                    @mouseenter="hold(item.id)"
                    @mouseleave="release(item.id)"
                >
                    <!-- The color is its own layer, so a popup that changes tone fades from one to the other -->
                    <Transition name="tone">
                        <span :key="item.tone" class="paint" :class="item.tone" aria-hidden="true"></span>
                    </Transition>

                    <span class="icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24"><path :d="iconPath(item)" /></svg>
                    </span>
                    <span class="text">
                        <strong>{{ item.title }}</strong>
                        <span v-if="item.message" class="message">{{ item.message }}</span>
                    </span>
                    <button v-if="item.action" type="button" class="action" @click="act(item)">{{ item.action.label }}</button>
                    <button type="button" class="close" aria-label="Dismiss" @click="dismiss(item.id)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" /></svg>
                    </button>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<script>
import { notifications } from '../notifications';

const ICONS = {
    offline: 'M2.5 8.8a14.5 14.5 0 0 1 4.3-2.6M10.6 5A14.5 14.5 0 0 1 21.5 8.8M5.3 12.2a9.8 9.8 0 0 1 4.5-2.4M14.7 9.9a9.8 9.8 0 0 1 4 2.3M8.6 15.6a5.2 5.2 0 0 1 6.8 0M12 19.4h.01M3.5 3.5l17 17',
    online: 'M2.5 8.8a14.5 14.5 0 0 1 19 0M5.3 12.2a9.8 9.8 0 0 1 13.4 0M8.6 15.6a5.2 5.2 0 0 1 6.8 0M12 19.4h.01',
    removed: 'M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2l.9-12.5M10.2 11v5M13.8 11v5',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    error: 'M12 7.5v6M12 16.8h.01M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6z',
    info: 'M12 11v5.5M12 7.8h.01M12 3.2a8.8 8.8 0 1 0 0 17.6 8.8 8.8 0 0 0 0-17.6z'
};

// The dim takes the color of the most important popup on screen
const TONE_ORDER = ['danger', 'success', 'neutral'];

function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

export default {
    name: 'ToastHost',
    data() {
        return {
            fullscreen: fullscreenElement()
        };
    },
    computed: {
        items() {
            return notifications.state.items;
        },
        tone() {
            return TONE_ORDER.find(tone => this.items.some(item => item.tone === tone)) || 'neutral';
        },
        target() {
            return this.fullscreen || 'body';
        }
    },
    mounted() {
        this.onFullscreenChange = () => {
            this.fullscreen = fullscreenElement();
        };
        document.addEventListener('fullscreenchange', this.onFullscreenChange);
        document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);
    },
    beforeUnmount() {
        document.removeEventListener('fullscreenchange', this.onFullscreenChange);
        document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    },
    methods: {
        iconPath(item) {
            return ICONS[item.icon] || ICONS[item.tone === 'danger' ? 'error' : item.tone === 'success' ? 'check' : 'info'];
        },
        act(item) {
            notifications.dismiss(item.id);
            item.action.handler();
        },
        dismiss(id) {
            notifications.dismiss(id);
        },
        hold(id) {
            notifications.hold(id);
        },
        release(id) {
            notifications.release(id);
        }
    }
};
</script>

<style scoped>
.toasts {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3000;
    pointer-events: none;
    font-family: var(--font);
}

.dim {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 400px;
    pointer-events: none;
    background:
        radial-gradient(ellipse 30% 62% at 50% 0%, var(--tint) 0%, transparent 72%),
        radial-gradient(ellipse 78% 100% at 50% 0%, rgba(2, 3, 8, 0.94) 0%, rgba(2, 3, 8, 0.76) 26%, rgba(2, 3, 8, 0.42) 50%, rgba(2, 3, 8, 0.14) 67%, rgba(2, 3, 8, 0) 82%);
}

.dim.danger {
    --tint: rgba(244, 63, 94, 0.36);
}

.dim.success {
    --tint: rgba(16, 185, 129, 0.32);
}

.dim.neutral {
    --tint: rgba(125, 108, 240, 0.2);
}

.stack {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: max(18px, env(safe-area-inset-top)) 16px 0;
}

.toast {
    position: relative;
    isolation: isolate;
    display: flex;
    align-items: center;
    gap: 14px;
    width: max-content;
    min-width: min(340px, 100%);
    max-width: min(500px, 100%);
    box-sizing: border-box;
    padding: 11px 10px 11px 11px;
    border-radius: 20px;
    color: #fff;
    pointer-events: auto;
    box-shadow: var(--glow), 0 26px 60px -20px rgba(0, 0, 0, 0.8);
    transition: box-shadow 0.45s ease;
}

.toast.danger {
    --glow: 0 18px 48px -12px rgba(225, 29, 72, 0.75);
}

.toast.success {
    --glow: 0 18px 48px -12px rgba(5, 150, 105, 0.7);
}

.toast.neutral {
    --glow: 0 18px 48px -16px rgba(125, 108, 240, 0.5);
}

.paint {
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
}

.paint.danger {
    background: linear-gradient(135deg, #fb5a76 0%, #e11d48 46%, #b4123b 100%);
}

.paint.success {
    background: linear-gradient(135deg, #1fc99a 0%, #079b6e 48%, #04775a 100%);
}

.paint.neutral {
    background: linear-gradient(135deg, rgba(40, 43, 66, 0.97) 0%, rgba(22, 24, 39, 0.97) 100%);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.09);
}

.icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.toast.neutral .icon {
    background: rgba(125, 108, 240, 0.22);
    color: #cfc8ff;
}

.icon svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-right: 4px;
}

.text strong {
    font-size: 1rem;
    font-weight: 700;
    font-stretch: 108%;
    line-height: 1.3;
}

.message {
    font-size: 0.88rem;
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.86);
}

.toast.neutral .message {
    color: var(--text-muted);
}

.action {
    flex: none;
    height: 34px;
    padding: 0 16px;
    border: none;
    border-radius: 17px;
    background: rgba(255, 255, 255, 0.94);
    color: #11131e;
    font-size: 0.92rem;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.2s ease;
}

.action:hover {
    background: #fff;
}

.action:active {
    transform: scale(0.96);
}

.close {
    flex: none;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.78);
    cursor: pointer;
    transition: background-color 0.2s ease, color 0.2s ease;
}

.close:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #fff;
}

.close svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
}

/* Slides down from behind the top edge and settles with a soft ease */
.toast-enter-active {
    transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
}

.toast-leave-active {
    transition: transform 0.38s cubic-bezier(0.55, 0, 0.75, 0), opacity 0.32s ease;
}

.toast-enter-from,
.toast-leave-to {
    opacity: 0;
    transform: translateY(calc(-100% - 36px)) scale(0.94);
}

.toast-move {
    transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
}

.dim-enter-active {
    transition: opacity 0.5s ease;
}

.dim-leave-active {
    transition: opacity 0.7s ease;
}

.dim-enter-from,
.dim-leave-to {
    opacity: 0;
}

.tone-enter-active,
.tone-leave-active {
    transition: opacity 0.5s ease;
}

.tone-enter-from,
.tone-leave-to {
    opacity: 0;
}

@media (max-width: 640px) {
    .dim {
        height: 300px;
    }

    .toast {
        width: 100%;
        min-width: 0;
    }
}

@media (prefers-reduced-motion: reduce) {
    .toast-enter-active,
    .toast-leave-active {
        transition: opacity 0.2s ease;
    }

    .toast-enter-from,
    .toast-leave-to {
        transform: none;
    }
}
</style>
