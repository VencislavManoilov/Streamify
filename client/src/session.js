import axios from 'axios';
import { reactive } from 'vue';
import { API_URL } from './config';

const TOKEN_KEY = 'token';

const state = reactive({
    user: null,
    checked: false
});

let pendingCheck = null;
const expiredListeners = [];

function readToken() {
    try {
        return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
        return null;
    }
}

function writeToken(token) {
    try {
        if (token) {
            localStorage.setItem(TOKEN_KEY, token);
        } else {
            localStorage.removeItem(TOKEN_KEY);
        }
    } catch (err) {
        // storage can be unavailable (private mode); the session then only lasts for this page
    }
}

async function check() {
    const token = readToken();
    if (!token) {
        state.user = null;
        state.checked = true;
        return null;
    }

    try {
        const response = await axios.get(`${API_URL}/auth/me`, { headers: { Authorization: token }, timeout: 10000 });
        // Old sessions get swapped for one that never expires
        if (response.data.token) writeToken(response.data.token);
        state.user = response.data.user;
    } catch (err) {
        if (!err.response || err.response.status !== 401) {
            // The server can't be reached; keep the token and try again on the next page
            throw err;
        }
        writeToken(null);
        state.user = null;
    }

    state.checked = true;
    return state.user;
}

// Where to go after logging in. Only pages of this site are allowed.
export function safeRedirect(path) {
    return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') ? path : '/';
}

export const session = {
    state,

    get token() {
        return readToken();
    },

    get user() {
        return state.user;
    },

    get isAdmin() {
        return !!state.user && state.user.role === 'admin';
    },

    // Resolves to the logged in user (or null). The server is only asked once per page load.
    ensure() {
        if (state.checked) return Promise.resolve(state.user);
        if (!pendingCheck) {
            pendingCheck = check().finally(() => {
                pendingCheck = null;
            });
        }
        return pendingCheck;
    },

    login(token) {
        writeToken(token);
        state.checked = false;
        return this.ensure();
    },

    logout() {
        writeToken(null);
        state.user = null;
        state.checked = true;
    },

    // Called when the server rejects the token, e.g. because the account was deleted
    expire() {
        this.logout();
        expiredListeners.forEach(listener => listener());
    },

    onExpired(listener) {
        expiredListeners.push(listener);
    }
};
