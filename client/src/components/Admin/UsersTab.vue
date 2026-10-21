<template>
    <section>
        <div class="page-title">
            <div>
                <h2>Users</h2>
                <p>{{ users.length }} {{ users.length === 1 ? 'account' : 'accounts' }}, {{ adminCount }} with admin access.</p>
            </div>
            <div class="actions">
                <button type="button" class="btn primary" @click="inviting = true">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    Invite user
                </button>
            </div>
        </div>

        <div class="card">
            <div class="card-head toolbar">
                <input v-model="query" class="input search" type="search" placeholder="Search by name or email" aria-label="Search users" />
                <div class="segmented" role="group" aria-label="Filter by role">
                    <button v-for="option in roleOptions" :key="option.id" type="button" :class="{ active: role === option.id }" @click="role = option.id">
                        {{ option.label }}<span class="count">{{ option.count }}</span>
                    </button>
                </div>
            </div>

            <LoadingSpinner v-if="loading" :size="36" label="Loading the users" />
            <p v-else-if="loadError" class="empty error-text">{{ loadError }}</p>
            <div v-else class="table-wrap">
                <table class="data">
                    <thead>
                        <tr>
                            <th v-for="column in columns" :key="column.id"
                                class="sortable" :class="{ sorted: sort === column.id, right: column.right }"
                                :aria-sort="sort === column.id ? (descending ? 'descending' : 'ascending') : null"
                                @click="sortBy(column.id)">
                                {{ column.label }}<span v-if="sort === column.id" aria-hidden="true">{{ descending ? ' ↓' : ' ↑' }}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template v-for="user in visible" :key="user.id">
                            <tr class="clickable" :class="{ open: openId === user.id }" @click="toggle(user)">
                                <td>
                                    <div class="who">
                                        <ProfileAvatar :name="user.username" :size="32" />
                                        <div class="who-text">
                                            <div class="name">{{ user.username }}<span v-if="me && user.id === me.id" class="you">you</span></div>
                                            <div class="faint email">{{ user.email }}</div>
                                        </div>
                                    </div>
                                </td>
                                <td><span class="pill" :class="user.role === 'admin' ? 'accent' : ''">{{ user.role }}</span></td>
                                <td class="num muted">{{ date(user.created_at) }}</td>
                                <td class="num muted">{{ ago(user.last_watched_at) }}</td>
                                <td class="num right">{{ user.movies }}</td>
                                <td class="num right">{{ user.episodes }}</td>
                                <td class="num right">{{ hours(user.seconds) }}</td>
                                <td class="num right">{{ user.saved }}</td>
                            </tr>
                            <tr v-if="openId === user.id" class="detail-row">
                                <td :colspan="columns.length">
                                    <LoadingSpinner v-if="!detail" :size="28" label="Loading the user" />
                                    <div v-else class="detail">
                                        <div class="detail-side">
                                            <dl class="facts">
                                                <dt>User ID</dt><dd class="mono">{{ user.id }}</dd>
                                                <dt>Email</dt><dd>{{ user.email }}</dd>
                                                <dt>Joined</dt><dd>{{ dateTime(user.created_at) }}</dd>
                                                <dt>Last watched</dt><dd>{{ user.last_watched_at ? dateTime(user.last_watched_at) : 'never' }}</dd>
                                                <dt>Watch time</dt><dd>{{ duration(user.seconds) }}</dd>
                                            </dl>
                                            <div class="actions detail-actions">
                                                <button type="button" class="btn small" :disabled="isMe(user) || busy" @click.stop="toggleRole(user)">
                                                    {{ user.role === 'admin' ? 'Remove admin' : 'Make admin' }}
                                                </button>
                                                <button type="button" class="btn small danger" :disabled="isMe(user) || busy" @click.stop="remove(user)">Delete user</button>
                                            </div>
                                            <p v-if="isMe(user)" class="faint self-note">You can't change or delete your own account here.</p>
                                        </div>
                                        <div>
                                            <h4>Recently watched</h4>
                                            <ul v-if="detail.history.length" class="list mini">
                                                <li v-for="movie in detail.history" :key="`${movie.imdb_code}-${movie.season}-${movie.episode}`">
                                                    <div class="movie-row">
                                                        <img v-if="movie.small_cover_image" class="poster" :src="movie.small_cover_image" alt="" loading="lazy" />
                                                        <span v-else class="poster"></span>
                                                        <div class="text">
                                                            <div class="title">{{ movie.title }}<span v-if="movie.season !== undefined" class="faint"> · S{{ movie.season }} E{{ movie.episode }}</span></div>
                                                            <div class="meta">{{ movie.completed ? 'Finished' : `${progress(movie)}% watched` }} · {{ ago(movie.last_watched_at) }}</div>
                                                        </div>
                                                    </div>
                                                </li>
                                            </ul>
                                            <p v-else class="faint">Nothing yet.</p>
                                        </div>
                                        <div>
                                            <h4>Watchlist</h4>
                                            <ul v-if="detail.watchlist.length" class="list mini">
                                                <li v-for="movie in detail.watchlist" :key="movie.imdb_code">
                                                    <div class="movie-row">
                                                        <img v-if="movie.small_cover_image" class="poster" :src="movie.small_cover_image" alt="" loading="lazy" />
                                                        <span v-else class="poster"></span>
                                                        <div class="text">
                                                            <div class="title">{{ movie.title }}</div>
                                                            <div class="meta">{{ movie.year }} · saved {{ ago(movie.created_at) }}</div>
                                                        </div>
                                                    </div>
                                                </li>
                                            </ul>
                                            <p v-else class="faint">Empty.</p>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </template>
                        <tr v-if="!visible.length">
                            <td :colspan="columns.length" class="empty">No users match.</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <InviteDialog v-if="inviting" :mail-ok="mailOk" @close="inviting = false" />
    </section>
</template>

<script>
import api from '../../api';
import LoadingSpinner from '../LoadingSpinner.vue';
import ProfileAvatar from '../ProfileAvatar.vue';
import InviteDialog from './InviteDialog.vue';
import { errorText, formatDate, formatDateTime, formatDuration, formatHours, timeAgo } from './format';

const COLUMNS = [
    { id: 'username', label: 'User' },
    { id: 'role', label: 'Role' },
    { id: 'created_at', label: 'Joined' },
    { id: 'last_watched_at', label: 'Last active' },
    { id: 'movies', label: 'Movies', right: true },
    { id: 'episodes', label: 'Episodes', right: true },
    { id: 'seconds', label: 'Hours', right: true },
    { id: 'saved', label: 'Saved', right: true }
];

export default {
    name: 'UsersTab',
    components: {
        LoadingSpinner,
        ProfileAvatar,
        InviteDialog
    },
    inject: ['confirmAction', 'notify'],
    props: {
        me: { type: Object, default: null },
        mailOk: { default: null }
    },
    emits: ['changed'],
    data() {
        return {
            users: [],
            loading: true,
            loadError: '',
            query: '',
            role: 'all',
            sort: 'created_at',
            descending: true,
            openId: null,
            detail: null,
            busy: false,
            inviting: false,
            columns: COLUMNS
        };
    },
    computed: {
        adminCount() {
            return this.users.filter(user => user.role === 'admin').length;
        },
        roleOptions() {
            return [
                { id: 'all', label: 'All', count: this.users.length },
                { id: 'admin', label: 'Admins', count: this.adminCount },
                { id: 'user', label: 'Users', count: this.users.length - this.adminCount }
            ];
        },
        visible() {
            const query = this.query.toLowerCase();
            const rows = this.users.filter(user =>
                (this.role === 'all' || user.role === this.role) &&
                (!query || user.username.toLowerCase().includes(query) || user.email.toLowerCase().includes(query))
            );

            const key = this.sort;
            const direction = this.descending ? -1 : 1;
            const value = (user) => {
                const raw = user[key];
                if (key === 'created_at' || key === 'last_watched_at') return raw ? new Date(raw).getTime() : 0;
                return typeof raw === 'string' ? raw.toLowerCase() : raw;
            };
            return [...rows].sort((a, b) => (value(a) > value(b) ? 1 : value(a) < value(b) ? -1 : 0) * direction);
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        date: formatDate,
        dateTime: formatDateTime,
        duration: formatDuration,
        hours: formatHours,
        ago: timeAgo,
        isMe(user) {
            return !!this.me && this.me.id === user.id;
        },
        progress(movie) {
            return movie.duration ? Math.round(movie.position / movie.duration * 100) : 0;
        },
        async load() {
            try {
                const response = await api.get('/admin/users');
                this.users = response.data;
                this.loadError = '';
            } catch (error) {
                this.loadError = errorText(error, 'The users could not be loaded');
            } finally {
                this.loading = false;
            }
        },
        sortBy(column) {
            if (this.sort === column) {
                this.descending = !this.descending;
            } else {
                this.sort = column;
                this.descending = column !== 'username' && column !== 'role';
            }
        },
        async toggle(user) {
            if (this.openId === user.id) {
                this.openId = null;
                return;
            }
            this.openId = user.id;
            this.detail = null;
            try {
                const response = await api.get(`/admin/user/${user.id}`);
                if (this.openId === user.id) this.detail = response.data;
            } catch (error) {
                this.notify(errorText(error, 'The user could not be loaded'), 'bad');
                this.openId = null;
            }
        },
        async toggleRole(user) {
            const role = user.role === 'admin' ? 'user' : 'admin';
            const ok = await this.confirmAction({
                title: role === 'admin' ? `Make ${user.username} an admin?` : `Remove admin from ${user.username}?`,
                message: role === 'admin'
                    ? 'Admins can open this panel, manage every user, see the logs and shut down the server.'
                    : 'They keep their account, history and watchlist but lose access to this panel.',
                confirmLabel: role === 'admin' ? 'Make admin' : 'Remove admin',
                danger: role !== 'admin'
            });
            if (!ok) return;

            this.busy = true;
            try {
                await api.patch(`/admin/user/${user.id}`, { role });
                user.role = role;
                this.notify(`${user.username} is now ${role === 'admin' ? 'an admin' : 'a regular user'}`);
                this.$emit('changed');
            } catch (error) {
                this.notify(errorText(error, 'The role could not be changed'), 'bad');
            } finally {
                this.busy = false;
            }
        },
        async remove(user) {
            const ok = await this.confirmAction({
                title: `Delete ${user.username}?`,
                message: `The account of ${user.email} is removed together with its watch history and watchlist. This can't be undone.`,
                confirmLabel: 'Delete user',
                danger: true
            });
            if (!ok) return;

            this.busy = true;
            try {
                await api.delete(`/admin/user/${user.id}`);
                this.users = this.users.filter(other => other.id !== user.id);
                this.openId = null;
                this.notify(`${user.username} was deleted`);
                this.$emit('changed');
            } catch (error) {
                this.notify(errorText(error, 'The user could not be deleted'), 'bad');
            } finally {
                this.busy = false;
            }
        }
    }
};
</script>

<style scoped>
.toolbar {
    margin-bottom: 16px;
}

.search {
    flex: 1 1 240px;
    max-width: 360px;
}

.who {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 200px;
}

.who-text {
    min-width: 0;
}

.name {
    font-weight: 600;
}

.email {
    font-size: 0.85rem;
}

.you {
    margin-left: 8px;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--surface-strong);
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}

tr.open > td {
    background: var(--row-hover);
}

.detail-row > td {
    background: rgba(0, 0, 0, 0.18);
    padding-top: 20px !important;
    padding-bottom: 22px !important;
}

.detail-row:hover > td {
    background: rgba(0, 0, 0, 0.18) !important;
}

.detail {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr));
    gap: 28px;
}

.detail h4 {
    margin: 0 0 12px;
    color: var(--text-muted);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.detail-actions {
    margin-top: 18px;
}

.self-note {
    margin: 10px 0 0;
    font-size: 0.83rem;
}

.mini {
    max-height: 300px;
    overflow-y: auto;
}

.mini .poster {
    width: 28px;
    height: 42px;
}
</style>
