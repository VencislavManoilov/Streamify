<template>
    <div class="profile-page">
        <AppHeader back />

        <LoadingSpinner v-if="loading" overlay label="Loading your profile" />
        <main v-else class="profile">
            <section class="identity">
                <ProfileAvatar :name="user.username" :size="96" />
                <div class="who">
                    <h1 class="name">{{ user.username }}</h1>
                    <p class="email">{{ user.email }}</p>
                    <p v-if="memberSince" class="since">Member since {{ memberSince }}</p>
                </div>
                <button class="logout" type="button" @click="logout">Log out</button>
            </section>

            <section v-if="!error" class="stats" aria-label="Your statistics">
                <div class="stat">
                    <span class="value">{{ stats.moviesWatched }}</span>
                    <span class="label">{{ stats.moviesWatched === 1 ? 'movie watched' : 'movies watched' }}</span>
                </div>
                <div class="stat">
                    <span class="value">{{ timeWatched }}</span>
                    <span class="label">time watched</span>
                </div>
                <div class="stat">
                    <span class="value">{{ stats.moviesFinished }}</span>
                    <span class="label">finished</span>
                </div>
            </section>

            <p v-if="error" class="message">{{ error }}</p>
            <MovieList v-else-if="history.length" :category="historyRow" />
            <section v-else class="empty">
                <h2>Watch history</h2>
                <p>The movies you watch will show up here, most recent first.</p>
                <router-link to="/" class="browse">Browse movies</router-link>
            </section>
        </main>
    </div>
</template>

<script>
import api from '../api';
import { session } from '../session';
import AppHeader from './AppHeader.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import MovieList from './MovieList.vue';
import ProfileAvatar from './ProfileAvatar.vue';

export default {
    name: 'ProfilePage',
    components: {
        AppHeader,
        LoadingSpinner,
        MovieList,
        ProfileAvatar
    },
    data() {
        return {
            loading: true,
            error: null,
            stats: { moviesWatched: 0, secondsWatched: 0, moviesFinished: 0 },
            history: []
        };
    },
    computed: {
        user() {
            return session.user || {};
        },
        memberSince() {
            if (!this.user.created_at) return '';
            return new Date(this.user.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        },
        timeWatched() {
            const minutes = Math.floor(this.stats.secondsWatched / 60);
            const hours = Math.floor(minutes / 60);
            return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
        },
        historyRow() {
            return { name: 'Watch history', movies: this.history };
        }
    },
    async mounted() {
        try {
            const response = await api.get('/history');
            this.stats = response.data.stats;
            this.history = response.data.history;
        } catch (err) {
            if (!err.response || err.response.status !== 401) {
                this.error = "Your watch history couldn't be loaded. Refresh the page to try again.";
            }
        } finally {
            this.loading = false;
        }
    },
    methods: {
        logout() {
            session.logout();
            this.$router.replace({ name: 'Welcome' });
        }
    }
};
</script>

<style scoped>
.profile-page {
    padding-bottom: 56px;
}

.identity {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 24px;
    padding: 16px var(--gutter) 0;
}

.who {
    flex: 1 1 240px;
    min-width: 0;
}

.name {
    margin: 0;
    font-size: clamp(1.9rem, 4vw, 2.6rem);
    font-weight: 800;
    font-stretch: 118%;
    line-height: 1.05;
    overflow-wrap: anywhere;
}

.email,
.since {
    margin: 6px 0 0;
    color: var(--text-muted);
}

.since {
    color: var(--text-faint);
    font-size: 0.95rem;
    margin-top: 2px;
}

.logout {
    flex: none;
    height: 44px;
    padding: 0 22px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    border-radius: 22px;
    background: var(--surface);
    color: var(--text);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.logout:hover {
    background: var(--surface-hover);
    border-color: rgba(255, 255, 255, 0.36);
}

.stats {
    display: flex;
    flex-wrap: wrap;
    margin: 40px var(--gutter) 44px;
}

.stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 40px;
    border-left: 1px solid var(--line);
}

.stat:first-child {
    padding-left: 0;
    border-left: none;
}

.value {
    font-size: clamp(2.2rem, 5vw, 3.2rem);
    font-weight: 700;
    font-stretch: 125%;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: -0.01em;
}

.label {
    color: var(--text-muted);
}

.message {
    padding: 0 var(--gutter);
    color: var(--text-muted);
}

.empty {
    padding: 0 var(--gutter);
}

.empty h2 {
    margin: 0 0 8px;
    font-size: 1.3rem;
    font-weight: 700;
    font-stretch: 112%;
}

.empty p {
    margin: 0 0 20px;
    color: var(--text-muted);
}

.browse {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 22px;
    border-radius: 12px;
    background: #f2f2f4;
    color: #0b0b10;
    font-weight: 700;
    transition: background-color 0.2s ease;
}

.browse:hover {
    background: #ffffff;
}

@media (max-width: 640px) {
    .identity {
        gap: 16px;
    }

    .identity :deep(.avatar) {
        width: 72px;
        height: 72px;
    }

    .stats {
        gap: 20px 0;
    }

    .stat {
        padding: 0 20px;
    }
}
</style>
