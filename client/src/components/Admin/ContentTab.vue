<template>
    <section>
        <div class="page-title">
            <div>
                <h2>Content</h2>
                <p>The home page categories and the torrents that are loaded for streaming.</p>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <h3>Categories</h3>
                <button type="button" class="btn" :disabled="refreshing" @click="refresh">
                    <svg :class="{ spin: refreshing }" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
                    {{ refreshing ? 'Refreshing…' : 'Refresh now' }}
                </button>
            </div>

            <div class="grid tiles facts-row">
                <div>
                    <div class="faint small-label">Last refresh</div>
                    <div class="fact">{{ data && data.refreshedAt ? dateTime(data.refreshedAt) : '–' }}</div>
                </div>
                <div>
                    <div class="faint small-label">Next automatic refresh</div>
                    <div class="fact num">{{ countdown }}</div>
                </div>
                <div>
                    <div class="faint small-label">Movies in categories</div>
                    <div class="fact num">{{ totalMovies }}</div>
                </div>
            </div>
            <p v-if="refreshing" class="faint refresh-note">Looking up every TMDB list on YTS takes a few minutes. Progress shows up in the logs.</p>

            <LoadingSpinner v-if="!data" :size="32" label="Loading the categories" />
            <div v-else class="categories">
                <div v-for="category in data.categories" :key="category.id" class="category">
                    <div class="category-head">
                        <span class="category-name">{{ category.name }}</span>
                        <span class="num faint">{{ category.movies }}</span>
                    </div>
                    <div class="meter" :class="{ warn: category.movies < 5 }">
                        <span :style="{ width: `${Math.min(100, category.movies / maxMovies * 100)}%` }"></span>
                    </div>
                </div>
                <p v-if="!data.categories.length" class="empty">No categories yet. Refresh to fetch them.</p>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <h3>Torrents</h3>
                <div v-if="torrents" class="actions torrent-totals">
                    <span class="pill num">{{ torrents.totalTorrents }} / {{ torrents.maxTorrents }} loaded</span>
                    <span class="pill info num">↓ {{ speed(torrents.downloadSpeed) }}</span>
                    <span class="pill num">↑ {{ speed(torrents.uploadSpeed) }}</span>
                </div>
            </div>

            <p v-if="!stats" class="empty">Loading…</p>
            <p v-else-if="!torrents" class="empty error-text">The torrent client is not running.</p>
            <template v-else>
                <div v-if="torrents.torrents.length" class="table-wrap torrent-table">
                    <table class="data">
                        <thead>
                            <tr>
                                <th>Movie</th>
                                <th>State</th>
                                <th class="right">Peers</th>
                                <th class="right">Down</th>
                                <th class="right">Up</th>
                                <th class="right">Downloaded</th>
                                <th class="right">Loaded</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="torrent in torrents.torrents" :key="torrent.infoHash">
                                <td>
                                    <div class="torrent-name">{{ torrent.name }}</div>
                                    <div class="faint mono hash">{{ torrent.infoHash }}</div>
                                </td>
                                <td>
                                    <span v-if="!torrent.ready" class="pill warn">loading</span>
                                    <span v-else-if="torrent.streams" class="pill ok">{{ torrent.streams }} streaming</span>
                                    <span v-else class="pill">idle {{ duration(torrent.idleFor / 1000) }}</span>
                                </td>
                                <td class="right num">{{ torrent.peers }}</td>
                                <td class="right num">{{ speed(torrent.downloadSpeed) }}</td>
                                <td class="right num">{{ speed(torrent.uploadSpeed) }}</td>
                                <td class="right num">{{ bytes(torrent.downloaded) }}<span v-if="torrent.size" class="faint"> / {{ bytes(torrent.size) }}</span></td>
                                <td class="right num faint">{{ ago(torrent.addedAt) }}</td>
                                <td class="right">
                                    <button type="button" class="btn small danger" @click="removeTorrent(torrent)">Remove</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p v-else class="empty">Nothing is loaded. Torrents load when someone starts a movie.</p>
                <p class="faint torrent-note">
                    Idle torrents are removed after {{ duration(torrents.idleTimeout / 1000) }}. Only the parts people watch are downloaded.
                </p>
            </template>
        </div>
    </section>
</template>

<script>
import api from '../../api';
import LoadingSpinner from '../LoadingSpinner.vue';
import { errorText, formatBytes, formatDateTime, formatDuration, formatSpeed, timeAgo } from './format';

export default {
    name: 'ContentTab',
    components: {
        LoadingSpinner
    },
    inject: ['confirmAction', 'notify'],
    props: {
        stats: { type: Object, default: null }
    },
    emits: ['changed'],
    data() {
        return {
            data: null,
            refreshing: false,
            now: Date.now(),
            clock: null
        };
    },
    computed: {
        torrents() {
            return this.stats && this.stats.torrents;
        },
        totalMovies() {
            if (!this.data) return '–';
            return this.data.categories.reduce((total, category) => total + category.movies, 0);
        },
        maxMovies() {
            if (!this.data || !this.data.categories.length) return 1;
            return Math.max(1, ...this.data.categories.map(category => category.movies));
        },
        countdown() {
            if (!this.data || !this.data.nextRefresh) return '–';
            const diff = this.data.nextRefresh - this.now;
            if (diff <= 0) return 'any moment';
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor(diff / 3600000) % 24;
            const minutes = Math.floor(diff / 60000) % 60;
            const seconds = Math.floor(diff / 1000) % 60;
            return `${days}d ${hours}h ${minutes}m ${seconds}s`;
        }
    },
    mounted() {
        this.load();
        this.clock = setInterval(() => {
            this.now = Date.now();
        }, 1000);
    },
    beforeUnmount() {
        clearInterval(this.clock);
    },
    methods: {
        bytes: formatBytes,
        speed: formatSpeed,
        duration: formatDuration,
        dateTime: formatDateTime,
        ago: timeAgo,
        async load() {
            try {
                const response = await api.get('/admin/categories');
                this.data = response.data;
                this.refreshing = this.refreshing || response.data.refreshing;
            } catch (error) {
                this.notify(errorText(error, 'The categories could not be loaded'), 'bad');
            }
        },
        async refresh() {
            const ok = await this.confirmAction({
                title: 'Refresh the categories now?',
                message: 'Every category is fetched again from TMDB and matched on YTS. The home page keeps the old categories until it is done.',
                confirmLabel: 'Refresh'
            });
            if (!ok) return;

            this.refreshing = true;
            try {
                await api.post('/admin/reset-categories', {}, { timeout: 0 });
                this.notify('The categories were refreshed');
                this.$emit('changed');
            } catch (error) {
                this.notify(errorText(error, 'The refresh failed, check the logs'), 'bad');
            } finally {
                this.refreshing = false;
                this.load();
            }
        },
        async removeTorrent(torrent) {
            const ok = await this.confirmAction({
                title: `Remove "${torrent.name}"?`,
                message: torrent.streams
                    ? `${torrent.streams} ${torrent.streams === 1 ? 'person is' : 'people are'} watching it right now and will be cut off. The downloaded data is deleted.`
                    : 'The downloaded data is deleted. It loads again when someone starts the movie.',
                confirmLabel: 'Remove',
                danger: true
            });
            if (!ok) return;

            try {
                await api.delete(`/admin/torrents/${torrent.infoHash}`);
                this.notify('Torrent removed');
                this.$emit('changed');
            } catch (error) {
                this.notify(errorText(error, 'The torrent could not be removed'), 'bad');
            }
        }
    }
};
</script>

<style scoped>
.facts-row {
    margin-bottom: 20px;
}

.small-label {
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 2px;
}

.fact {
    font-size: 1.05rem;
    font-weight: 600;
}

.refresh-note {
    margin: -8px 0 16px;
    font-size: 0.88rem;
}

.categories {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr));
    gap: 14px 28px;
}

.category-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 0.92rem;
}

.category-name {
    font-weight: 600;
}

.categories .empty {
    grid-column: 1 / -1;
}

.torrent-name {
    font-weight: 600;
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.hash {
    font-size: 0.75rem;
}

.torrent-note {
    margin: 0;
    padding-top: 14px;
    font-size: 0.85rem;
}

.table-wrap + .torrent-note {
    margin: 0 -20px -20px;
    padding: 14px 20px 18px;
    border-top: 1px solid var(--card-line);
}

.card .torrent-table {
    margin-bottom: 0;
}
</style>
