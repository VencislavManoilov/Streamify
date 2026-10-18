import { reactive } from 'vue';
import { API_URL } from './config';
import { notifications } from './notifications';

// How long the server gets to answer before it counts as unreachable
const PING_TIMEOUT = 6000;
const FIRST_RETRY = 2000;
const LAST_RETRY = 15000;
const POPUP = 'connection';

const state = reactive({
    online: true,
    // 'device' when this computer has no network, 'server' when it has one but Streamify can't be reached
    reason: null
});

const listeners = new Set();
let pending = null;
let retryTimer = null;
let retryDelay = FIRST_RETRY;
let started = false;

// Any answer from the server, even an error, means the way there works. The answer itself isn't read,
// so it doesn't depend on CORS either.
async function ping() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
    try {
        await fetch(`${API_URL}/`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        return true;
    } catch (err) {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

function goOffline(reason) {
    if (state.online || state.reason !== reason) {
        notifications.show(reason === 'device'
            ? { id: POPUP, tone: 'danger', icon: 'offline', title: "You're offline", message: 'Check your internet connection.', duration: 0 }
            : { id: POPUP, tone: 'danger', icon: 'offline', title: 'Connection lost', message: "Can't reach Streamify. Trying again…", duration: 0 });
    }
    state.online = false;
    state.reason = reason;

    // Without a network the 'online' event says when it's back, this is only in case it never comes
    clearTimeout(retryTimer);
    retryTimer = setTimeout(check, reason === 'device' ? LAST_RETRY : retryDelay);
    retryDelay = Math.min(retryDelay * 2, LAST_RETRY);
}

function goOnline() {
    clearTimeout(retryTimer);
    retryDelay = FIRST_RETRY;
    if (state.online) return;

    state.online = true;
    state.reason = null;
    notifications.show({ id: POPUP, tone: 'success', icon: 'online', title: 'Back online', message: "You're connected again.", duration: 3500 });
    listeners.forEach(listener => listener());
}

// Asks the server whether it can be reached and updates the state. Resolves to true when it can.
function check() {
    if (!pending) {
        pending = ping().then((reachable) => {
            if (reachable) {
                goOnline();
            } else {
                goOffline(navigator.onLine === false ? 'device' : 'server');
            }
            return reachable;
        }).finally(() => {
            pending = null;
        });
    }
    return pending;
}

export const connection = {
    state,

    get online() {
        return state.online;
    },

    start() {
        if (started) return;
        started = true;
        window.addEventListener('offline', () => goOffline('device'));
        // The network can take a moment to really work after it comes back, so the server is asked first
        window.addEventListener('online', () => check());
        if (navigator.onLine === false) goOffline('device');
    },

    check,

    // Called whenever the connection comes back after it was lost. Returns a function that stops it.
    onReconnect(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
    }
};
