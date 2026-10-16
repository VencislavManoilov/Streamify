<template>
    <section>
        <div class="page-title">
            <div>
                <h2>Overview</h2>
                <p>How Streamify is doing right now.</p>
            </div>
        </div>

        <div v-if="down.length" class="notice bad health-notice">
            <span class="dot bad"></span>
            <div>
                <strong>{{ down.length === 1 ? `${down[0].name} is not working` : `${down.length} services are not working` }}</strong>
                <p v-for="service in down" :key="service.id">
                    {{ service.name }}: {{ service.error || 'no answer' }}<template v-if="service.id === 'mail'">. Invitations and access request emails will fail, use invitation links instead.</template>
                </p>
            </div>
            <button type="button" class="btn small" @click="$emit('open', 'system')">Details</button>
        </div>

        <LoadingSpinner v-if="!stats" :size="40" label="Loading the stats" />
        <template v-else>
            <div class="grid tiles">
                <div class="card tile">
                    <span class="label">Users</span>
                    <span class="value num">{{ stats.users.count }}</span>
                    <span class="note" :class="{ up: stats.users.newThisMonth }">+{{ stats.users.newThisMonth }} in the last 30 days</span>
                </div>
                <div class="card tile">
                    <span class="label">Active this week</span>
                    <span class="value num">{{ stats.users.activeThisWeek }}<small>/ {{ stats.users.count }}</small></span>
                    <span class="note">watched something in 7 days</span>
                </div>
                <div class="card tile">
                    <span class="label">Hours watched</span>
                    <span class="value num">{{ hours(stats.watching.seconds) }}</span>
                    <span class="note">{{ stats.watching.plays }} movies started, {{ stats.watching.finished }} finished</span>
                </div>
                <div class="card tile">
                    <span class="label">Streaming now</span>
                    <span class="value num">{{ streaming }}</span>
                    <span class="note">{{ torrents ? `${torrents.totalTorrents} of ${torrents.maxTorrents} torrents loaded` : 'torrent client is off' }}</span>
                </div>
                <div class="card tile">
                    <span class="label">Movie library</span>
                    <span class="value num">{{ stats.movies.count.toLocaleString() }}</span>
                    <span class="note">in {{ stats.categories.count }} categories</span>
                </div>
                <button type="button" class="card tile tile-button" @click="$emit('open', 'requests')">
                    <span class="label">Access requests</span>
                    <span class="value num" :class="{ attention: stats.requests.pending }">{{ stats.requests.pending }}</span>
                    <span class="note">{{ stats.requests.pending ? 'waiting for an invitation' : 'nothing waiting' }}</span>
                </button>
            </div>
        </template>

        <div class="grid two">
            <div class="card">
                <div class="card-head">
                    <h3>Recently watched</h3>
                    <span class="sub">across all users</span>
                </div>
                <LoadingSpinner v-if="!activity" :size="32" label="Loading the activity" />
                <ul v-else-if="activity.recent.length" class="list">
                    <li v-for="item in activity.recent" :key="`${item.user_id}-${item.imdb_code}`">
                        <div class="movie-row">
                            <img v-if="item.small_cover_image" class="poster" :src="item.small_cover_image" alt="" loading="lazy" />
                            <span v-else class="poster"></span>
                            <div class="text">
                                <div class="title">{{ item.title }}</div>
                                <div class="meta">
                                    <strong class="who">{{ item.username }}</strong>
                                    · {{ item.completed ? 'finished' : `${percent(item)}% in` }}
                                </div>
                            </div>
                        </div>
                        <span class="faint when">{{ ago(item.last_watched_at) }}</span>
                    </li>
                </ul>
                <p v-else class="empty">Nobody has watched anything yet.</p>
            </div>

            <div class="card">
                <div class="card-head">
                    <h3>Most watched</h3>
                    <span class="sub">by number of viewers</span>
                </div>
                <LoadingSpinner v-if="!activity" :size="32" label="Loading the top movies" />
                <ol v-else-if="activity.top.length" class="list top">
                    <li v-for="(movie, index) in activity.top" :key="movie.imdb_code">
                        <div class="movie-row">
                            <span class="rank num">{{ index + 1 }}</span>
                            <img v-if="movie.small_cover_image" class="poster" :src="movie.small_cover_image" alt="" loading="lazy" />
                            <span v-else class="poster"></span>
                            <div class="text">
                                <div class="title">{{ movie.title }}</div>
                                <div class="meta">{{ movie.year }} · {{ duration(movie.seconds) }} watched</div>
                            </div>
                        </div>
                        <span class="pill num">{{ movie.viewers }} {{ movie.viewers === 1 ? 'viewer' : 'viewers' }}</span>
                    </li>
                </ol>
                <p v-else class="empty">No movies watched yet.</p>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <h3>Recent problems</h3>
                <button type="button" class="btn small" @click="$emit('open', 'logs')">All logs</button>
            </div>
            <ul v-if="problems.length" class="list problems">
                <li v-for="(log, index) in problems" :key="index">
                    <span class="pill" :class="log.level === 'error' ? 'bad' : 'warn'">{{ log.level }}</span>
                    <span class="mono problem-text">{{ log.message }}</span>
                    <span class="faint when">{{ ago(log.timestamp) }}</span>
                </li>
            </ul>
            <p v-else class="empty">No warnings or errors since the server started.</p>
        </div>
    </section>
</template>

<script>
import api from '../../api';
import LoadingSpinner from '../LoadingSpinner.vue';
import { formatDuration, formatHours, timeAgo } from './format';

export default {
    name: 'OverviewTab',
    components: {
        LoadingSpinner
    },
    props: {
        stats: { type: Object, default: null },
        services: { type: Array, default: () => [] },
        logs: { type: Array, default: () => [] }
    },
    emits: ['open'],
    data() {
        return {
            activity: null
        };
    },
    computed: {
        down() {
            return this.services.filter(service => !service.ok);
        },
        torrents() {
            return this.stats && this.stats.torrents;
        },
        streaming() {
            return this.torrents ? this.torrents.torrentsWithReferences : 0;
        },
        problems() {
            return this.logs.filter(log => log.level === 'error' || log.level === 'warn').slice(-6).reverse();
        }
    },
    async mounted() {
        try {
            const response = await api.get('/admin/activity');
            this.activity = response.data;
        } catch (error) {
            this.activity = { recent: [], top: [] };
        }
    },
    methods: {
        hours: formatHours,
        duration: formatDuration,
        ago: timeAgo,
        percent(item) {
            return item.duration ? Math.round(item.position / item.duration * 100) : 0;
        }
    }
};
</script>

<style scoped>
.health-notice {
    margin-bottom: 16px;
    align-items: center;
}

.health-notice > div {
    flex: 1;
}

.tile-button {
    text-align: left;
    font: inherit;
    color: inherit;
    cursor: pointer;
    transition: border-color 0.15s ease;
}

.tile-button:hover {
    border-color: rgba(255, 255, 255, 0.22);
}

.attention {
    color: var(--accent);
}

.who {
    color: var(--text-muted);
    font-weight: 600;
}

.when {
    flex: none;
    font-size: 0.83rem;
}

.rank {
    width: 18px;
    color: var(--text-faint);
    font-weight: 700;
    text-align: right;
    flex: none;
}

.problems > li {
    justify-content: flex-start;
}

.problem-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
