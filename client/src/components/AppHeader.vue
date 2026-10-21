<template>
    <header class="app-header">
        <div v-if="back" class="header-nav">
            <button class="nav-button" type="button" aria-label="Back" @click="goBack">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M19 12H5M11 5l-7 7 7 7" />
                </svg>
            </button>
            <router-link v-if="showHome" :to="homePath" class="nav-button" aria-label="Home">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 10.5 12 4l8 6.5M6 9v11h4.5v-5.5h3V20H18V9" />
                </svg>
            </router-link>
        </div>
        <SearchBar v-if="search" class="header-search" />
        <MediaSwitch v-if="search" class="header-switch" />
        <div class="header-end">
            <router-link v-if="adminLink && isAdmin" to="/admin" class="admin-link">Admin</router-link>
            <router-link
                to="/profile"
                class="profile-button"
                :class="{ current: $route.name === 'Profile' }"
                :aria-label="`Your profile (${username})`"
                :title="username"
            >
                <ProfileAvatar :name="username" :size="40" />
            </router-link>
        </div>
    </header>
</template>

<script>
import SearchBar from './SearchBar.vue';
import MediaSwitch from './MediaSwitch.vue';
import ProfileAvatar from './ProfileAvatar.vue';
import { session } from '../session';

const SERIES_PAGES = ['SeriesHome', 'Series'];

export default {
    name: 'AppHeader',
    components: {
        SearchBar,
        MediaSwitch,
        ProfileAvatar
    },
    props: {
        back: {
            type: Boolean,
            default: false
        },
        search: {
            type: Boolean,
            default: false
        },
        adminLink: {
            type: Boolean,
            default: false
        }
    },
    data() {
        return {
            // The earlier page of this site that the back button returns to, if there is one
            backPath: null
        };
    },
    computed: {
        username() {
            return session.user ? session.user.username : '';
        },
        isAdmin() {
            return session.isAdmin;
        },
        // A series page leads home to the series
        homePath() {
            return SERIES_PAGES.includes(this.$route.name) ? '/series' : '/';
        },
        // Not needed when the back button leads to the home page anyway
        showHome() {
            return !!this.backPath && this.$router.resolve(this.backPath).path !== this.homePath;
        }
    },
    watch: {
        // history.state isn't reactive, so it's read again after every navigation
        $route: {
            immediate: true,
            handler() {
                const state = window.history.state;
                this.backPath = (state && state.back) || null;
            }
        }
    },
    methods: {
        goBack() {
            // Go back if the previous page is part of this site, otherwise go to the home page
            if (this.backPath) {
                this.$router.back();
            } else {
                this.$router.push(this.homePath);
            }
        }
    }
};
</script>

<style scoped>
.app-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px var(--gutter);
}

.header-search {
    flex: 1 1 auto;
    min-width: 0;
}

.header-switch {
    flex: none;
}

.header-end {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: none;
    margin-left: auto;
}

.header-nav {
    display: flex;
    gap: 8px;
    flex: none;
}

/* Back is a button and Home a link, border-box keeps them the same size */
.nav-button {
    flex: none;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 50%;
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    transition: background-color 0.2s ease, transform 0.2s ease;
}

.nav-button:hover {
    background: var(--surface-hover);
}

.nav-button:active {
    transform: scale(0.94);
}

.nav-button svg {
    width: 22px;
    height: 22px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.admin-link {
    color: var(--text-muted);
    font-size: 0.95rem;
    transition: color 0.2s ease;
}

.admin-link:hover {
    color: var(--text);
}

.profile-button {
    display: block;
    border-radius: 50%;
    transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.profile-button:hover,
.profile-button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px rgba(255, 255, 255, 0.85);
}

.profile-button.current {
    box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}

.profile-button:active {
    transform: scale(0.95);
}

/* On phones the switch gets a row of its own under the search bar */
@media (max-width: 640px) {
    .app-header {
        flex-wrap: wrap;
        row-gap: 12px;
    }

    /* Stays next to the buttons instead of taking a row of its own */
    .header-search {
        flex: 1 1 0;
    }

    .header-switch {
        order: 3;
        flex-basis: 100%;
    }
}
</style>
