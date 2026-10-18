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

            <section v-if="!historyError" class="stats" aria-label="Your statistics">
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

            <MovieList :category="watchlistRow">
                <template #empty>
                    <p v-if="watchlistError" class="row-message">{{ watchlistError }}</p>
                    <p v-else class="row-message">The movies you save with the bookmark button will show up here until you've watched them.</p>
                </template>
            </MovieList>

            <p v-if="historyError" class="message">{{ historyError }}</p>
            <MovieList v-else :category="historyRow" remove-label="Remove from watch history" @remove="removeFromHistory">
                <template #empty>
                    <div class="empty">
                        <p>The movies you watch will show up here, most recent first.</p>
                        <router-link to="/" class="browse">Browse movies</router-link>
                    </div>
                </template>
            </MovieList>
        </main>
    </div>
</template>

<script>
import api from '../api';
import { notifications } from '../notifications';
import { session } from '../session';
import { watchHistory } from '../watchHistory';
import { watchlist } from '../watchlist';
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
            historyError: null,
            watchlistError: null,
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
        watchlistRow() {
            return { name: 'Watchlist', movies: watchlist.movies };
        },
        historyRow() {
            return { name: 'Watch history', movies: this.history };
        }
    },
    async mounted() {
        // A rejected session already sends the user to the login page
        const loggedOut = err => !!err.response && err.response.status === 401;

        // The movie that was just left may still be saving its progress
        await watchHistory.settled();

        const [history, saved] = await Promise.allSettled([
            api.get('/history'),
            // Asked for again here, since movies finished on another device have left the list
            watchlist.load({ refresh: true })
        ]);

        if (history.status === 'fulfilled') {
            this.stats = history.value.data.stats;
            this.history = history.value.data.history;
        } else if (!loggedOut(history.reason)) {
            this.historyError = "Your watch history couldn't be loaded. Refresh the page to try again.";
        }

        if (saved.status === 'rejected' && !loggedOut(saved.reason)) {
            this.watchlistError = "Your watchlist couldn't be loaded. Refresh the page to try again.";
        }

        this.loading = false;
    },
    methods: {
        logout() {
            session.logout();
            this.$router.replace({ name: 'Welcome' });
        },
        // Changes the statistics by what one entry of the history adds to them (`sign` -1 takes it away)
        countEntry(progress, sign) {
            this.stats = {
                moviesWatched: this.stats.moviesWatched + sign,
                secondsWatched: Math.max(0, this.stats.secondsWatched + sign * progress.watchedSeconds),
                moviesFinished: this.stats.moviesFinished + (progress.completed ? sign : 0)
            };
        },
        // The poster goes right away and comes back if the server can't remove it. Undo puts it back.
        async removeFromHistory(movie) {
            const index = this.history.findIndex(entry => entry.imdb_code === movie.imdb_code);
            if (index === -1) return;
            this.history = this.history.filter(entry => entry.imdb_code !== movie.imdb_code);
            this.countEntry(movie.progress, -1);

            let removed;
            try {
                removed = await watchHistory.remove(movie.imdb_code);
            } catch (err) {
                this.putBack(movie, index);
                if (!err.response || err.response.status !== 401) {
                    notifications.show({ tone: 'danger', title: "Couldn't remove the movie", message: 'Check your connection and try again.' });
                }
                return;
            }

            notifications.show({
                id: `history-${movie.imdb_code}`,
                icon: 'removed',
                title: 'Removed from your watch history',
                message: movie.title,
                duration: 6000,
                // Nothing to put back when it was already gone from the server
                action: removed ? { label: 'Undo', handler: () => this.undoRemove(movie, index, removed) } : null
            });
        },
        async undoRemove(movie, index, removed) {
            this.putBack({ ...movie, progress: removed }, index);
            try {
                await watchHistory.restore(movie.imdb_code, removed);
            } catch (err) {
                this.history = this.history.filter(entry => entry.imdb_code !== movie.imdb_code);
                this.countEntry(removed, -1);
                if (!err.response || err.response.status !== 401) {
                    notifications.show({ tone: 'danger', title: "Couldn't put the movie back", message: 'Check your connection and try again.' });
                }
            }
        },
        putBack(movie, index) {
            if (this.history.some(entry => entry.imdb_code === movie.imdb_code)) return;
            const history = this.history.slice();
            history.splice(Math.min(index, history.length), 0, movie);
            this.history = history;
            this.countEntry(movie.progress, 1);
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
    margin-bottom: 40px;
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
    margin: 0 var(--gutter) 44px;
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

.row-message {
    margin: 0;
    padding: 0 var(--gutter);
    color: var(--text-muted);
}

.empty {
    padding: 0 var(--gutter);
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
