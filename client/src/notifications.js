import { reactive } from 'vue';

// The popups that slide in from the top of the screen (ToastHost.vue shows them)
const state = reactive({
    items: []
});

const timers = new Map();
let nextId = 1;
// More than this and the oldest popup that goes away on its own makes room
const MAX_SHOWN = 3;

function stopTimer(id) {
    clearTimeout(timers.get(id));
    timers.delete(id);
}

function startTimer(id, duration) {
    stopTimer(id);
    if (duration > 0) {
        timers.set(id, setTimeout(() => notifications.dismiss(id), duration));
    }
}

export const notifications = {
    state,

    /**
     * Shows a popup, or changes the one with the same `id` in place. `tone` is 'neutral', 'success' or
     * 'danger', `action` an optional { label, handler } button. A `duration` of 0 keeps it until dismissed.
     */
    show({ id = `notification-${nextId++}`, tone = 'neutral', icon = null, title, message = '', action = null, duration = 5000 }) {
        const item = { id, tone, icon, title, message, action, duration };
        const index = state.items.findIndex(existing => existing.id === id);
        if (index === -1) {
            state.items.push(item);
        } else {
            state.items.splice(index, 1, item);
        }
        startTimer(id, duration);

        const extra = state.items.filter(shown => shown.duration > 0 && shown.id !== id).slice(0, Math.max(0, state.items.length - MAX_SHOWN));
        extra.forEach(shown => this.dismiss(shown.id));
        return id;
    },

    dismiss(id) {
        stopTimer(id);
        const index = state.items.findIndex(item => item.id === id);
        if (index !== -1) state.items.splice(index, 1);
    },

    // A popup stays while the pointer is on it and goes a moment after it leaves
    hold(id) {
        stopTimer(id);
    },

    release(id) {
        const item = state.items.find(existing => existing.id === id);
        if (item && item.duration > 0) startTimer(id, 2500);
    }
};
