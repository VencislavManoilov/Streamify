<template>
    <div class="admin">
        <header class="topbar">
            <div class="brand">
                <span class="wordmark">Streamify</span>
                <span class="badge">Admin</span>
            </div>

            <div class="topbar-end">
                <button
                    type="button"
                    class="status"
                    :class="overall.level"
                    :title="overall.title"
                    @click="openTab('system')"
                >
                    <span class="dot" :class="overall.level"></span>
                    <span class="status-text">{{ overall.label }}</span>
                </button>
                <router-link to="/" class="btn small ghost site-link">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                    <span>Open site</span>
                </router-link>
                <div class="me" v-if="me">
                    <ProfileAvatar :name="me.username" :size="32" />
                    <span class="me-name">{{ me.username }}</span>
                </div>
                <button type="button" class="btn small" @click="logout">Log out</button>
            </div>
        </header>

        <div class="layout">
            <nav class="sidebar" aria-label="Admin sections">
                <button
                    v-for="item in nav"
                    :key="item.id"
                    type="button"
                    class="nav-item"
                    :class="{ active: tab === item.id }"
                    :aria-current="tab === item.id ? 'page' : null"
                    @click="openTab(item.id)"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="item.icon" /></svg>
                    <span>{{ item.label }}</span>
                    <span v-if="item.badge" class="nav-badge" :class="item.badgeLevel">{{ item.badge }}</span>
                </button>
            </nav>

            <main class="content">
                <OverviewTab
                    v-if="tab === 'overview'"
                    :stats="stats"
                    :services="services"
                    :logs="logs"
                    @open="openTab"
                />
                <UsersTab v-else-if="tab === 'users'" :me="me" :mail-ok="mailOk" @changed="loadStats" />
                <RequestsTab v-else-if="tab === 'requests'" :mail-ok="mailOk" @changed="loadStats" />
                <ContentTab v-else-if="tab === 'content'" :stats="stats" @changed="loadStats" />
                <SystemTab
                    v-else-if="tab === 'system'"
                    :stats="stats"
                    :health="health"
                    :checking="checkingHealth"
                    @recheck="loadHealth"
                    @mail="onMailStatus"
                />
                <LogsTab v-else-if="tab === 'logs'" :logs="logs" :connection="logConnection" @clear="logs = []" />
            </main>
        </div>

        <div v-if="dialog" class="admin-dialog" @click.self="closeDialog(false)" @keydown.esc="closeDialog(false)">
            <div class="card" role="alertdialog" aria-modal="true" :aria-label="dialog.title">
                <div class="card-head"><h3>{{ dialog.title }}</h3></div>
                <p class="confirm-text">{{ dialog.message }}</p>
                <div class="actions dialog-actions">
                    <button type="button" class="btn" @click="closeDialog(false)">Cancel</button>
                    <button
                        ref="confirmButton"
                        type="button"
                        class="btn"
                        :class="dialog.danger ? 'danger' : 'primary'"
                        @click="closeDialog(true)"
                    >{{ dialog.confirmLabel }}</button>
                </div>
            </div>
        </div>

        <div class="toasts" aria-live="polite">
            <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
                <span class="dot" :class="toast.type"></span>
                <span>{{ toast.message }}</span>
            </div>
        </div>
    </div>
</template>

<script>
import api from '../../api';
import { API_URL } from '../../config';
import { session } from '../../session';
import ProfileAvatar from '../ProfileAvatar.vue';
import OverviewTab from './OverviewTab.vue';
import UsersTab from './UsersTab.vue';
import RequestsTab from './RequestsTab.vue';
import ContentTab from './ContentTab.vue';
import SystemTab from './SystemTab.vue';
import LogsTab from './LogsTab.vue';
import './admin.css';

const TABS = ['overview', 'users', 'requests', 'content', 'system', 'logs'];
const STATS_INTERVAL = 10 * 1000;
const HEALTH_INTERVAL = 5 * 60 * 1000;
const MAX_LOGS = 1000;

export default {
    name: 'AdminPanel',
    components: {
        ProfileAvatar,
        OverviewTab,
        UsersTab,
        RequestsTab,
        ContentTab,
        SystemTab,
        LogsTab
    },
    provide() {
        return {
            confirmAction: this.confirmAction,
            notify: this.notify
        };
    },
    data() {
        return {
            stats: null,
            health: null,
            checkingHealth: false,
            logs: [],
            logConnection: 'connecting',
            dialog: null,
            toasts: [],
            timers: [],
            socket: null,
            closed: false
        };
    },
    computed: {
        me() {
            return session.user;
        },
        tab() {
            return TABS.includes(this.$route.query.tab) ? this.$route.query.tab : 'overview';
        },
        // The health check, with the mail result swapped for the newer one from the stats
        services() {
            if (!this.health) return [];
            const mail = this.stats && this.stats.mail && this.stats.mail.current;
            return this.health.services.map(service => {
                if (service.id !== 'mail' || !mail) return service;
                return { ...service, ok: mail.ok, error: mail.error, latency: mail.latency, checkedAt: mail.at };
            });
        },
        mailOk() {
            const mail = this.stats && this.stats.mail && this.stats.mail.current;
            return mail ? mail.ok : null;
        },
        overall() {
            if (!this.services.length) {
                return { level: '', label: 'Checking…', title: 'Checking the services' };
            }
            const down = this.services.filter(service => !service.ok);
            if (!down.length) {
                return { level: 'ok', label: 'All systems normal', title: 'Every service answers' };
            }
            const names = down.map(service => service.name);
            return {
                level: 'bad',
                label: down.length === 1 ? `${names[0]} down` : `${down.length} services down`,
                title: `Not working: ${names.join(', ')}`
            };
        },
        nav() {
            const pending = this.stats ? this.stats.requests.pending : 0;
            const errors = this.logs.filter(log => log.level === 'error').length;
            const down = this.services.filter(service => !service.ok).length;
            return [
                { id: 'overview', label: 'Overview', icon: 'M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z' },
                { id: 'users', label: 'Users', icon: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 19v-1a4 4 0 0 0-3-3.85M15.5 3.15a3.5 3.5 0 0 1 0 6.7' },
                { id: 'requests', label: 'Requests', icon: 'M4 6h16v12H4zM4 7l8 6 8-6', badge: pending || null, badgeLevel: 'accent' },
                { id: 'content', label: 'Content', icon: 'M4 5h16v14H4zM4 9h16M9 5v4M15 5v4M10 12.5v4l3.5-2z' },
                { id: 'system', label: 'System', icon: 'M12 3v3M12 18v3M4.2 7.5l2.6 1.5M17.2 15l2.6 1.5M4.2 16.5 6.8 15M17.2 9l2.6-1.5M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', badge: down || null, badgeLevel: 'bad' },
                { id: 'logs', label: 'Logs', icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', badge: errors || null, badgeLevel: 'bad' }
            ];
        }
    },
    mounted() {
        this.loadStats();
        this.loadHealth();
        this.connectLogs();

        this.timers.push(setInterval(() => {
            if (!document.hidden) this.loadStats();
        }, STATS_INTERVAL));
        this.timers.push(setInterval(() => {
            if (!document.hidden) this.loadHealth();
        }, HEALTH_INTERVAL));
    },
    beforeUnmount() {
        this.closed = true;
        this.timers.forEach(clearInterval);
        if (this.socket) this.socket.close();
    },
    methods: {
        openTab(id) {
            if (id === this.tab) return;
            this.$router.replace({ query: id === 'overview' ? {} : { tab: id } });
        },
        async loadStats() {
            try {
                const response = await api.get('/admin/stats');
                this.stats = response.data;
            } catch (error) {
                this.handleAuthError(error);
            }
        },
        async loadHealth() {
            if (this.checkingHealth) return;
            this.checkingHealth = true;
            try {
                const response = await api.get('/admin/health');
                this.health = response.data;
            } catch (error) {
                this.handleAuthError(error);
            } finally {
                this.checkingHealth = false;
            }
        },
        // The system tab checked the mail server itself, keep everything else in step
        onMailStatus(mail) {
            if (this.stats) {
                this.stats = { ...this.stats, mail: { ...this.stats.mail, current: mail.current, uptime: mail.uptime, checking: mail.checking } };
            }
            if (this.health) {
                this.health = { ...this.health, mail };
            }
        },
        // The account lost its admin role: reload the session so the router sees that, then leave
        async handleAuthError(error) {
            if (error.response && error.response.status === 403) {
                await session.login(session.token).catch(() => {});
                this.$router.replace('/admin/auth');
            }
        },
        connectLogs() {
            const token = session.token;
            if (!token || this.closed) return;

            const wsUrl = API_URL.replace(/^http/, 'ws');
            const socket = new WebSocket(`${wsUrl}/admin/logs-ws?token=${encodeURIComponent(token)}`);
            this.socket = socket;
            this.logConnection = 'connecting';

            socket.onopen = () => {
                this.logConnection = 'live';
            };

            socket.onmessage = (event) => {
                let data;
                try {
                    data = JSON.parse(event.data);
                } catch (err) {
                    return;
                }

                if (data.type === 'initialLogs') {
                    this.logs = data.logs.slice(-MAX_LOGS);
                } else if (data.type === 'newLog') {
                    this.logs.push(data.log);
                    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
                }
            };

            // Reconnect when the server restarts or the connection drops
            socket.onclose = () => {
                if (this.closed) return;
                this.logConnection = 'offline';
                setTimeout(() => this.connectLogs(), 5000);
            };
        },
        logout() {
            session.logout();
            this.$router.push('/admin/auth');
        },
        confirmAction({ title, message, confirmLabel = 'Confirm', danger = false }) {
            return new Promise((resolve) => {
                this.dialog = { title, message, confirmLabel, danger, resolve };
                this.$nextTick(() => this.$refs.confirmButton && this.$refs.confirmButton.focus());
            });
        },
        closeDialog(result) {
            if (!this.dialog) return;
            this.dialog.resolve(result);
            this.dialog = null;
        },
        notify(message, type = 'ok') {
            const id = Date.now() + Math.random();
            this.toasts.push({ id, message, type });
            setTimeout(() => {
                this.toasts = this.toasts.filter(toast => toast.id !== id);
            }, type === 'bad' ? 7000 : 4000);
        }
    }
};
</script>

<style scoped>
.admin {
    min-height: 100vh;
}

.topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    height: 64px;
    padding: 0 var(--gutter);
    border-bottom: 1px solid var(--card-line);
    background: rgba(8, 9, 18, 0.78);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
}

.brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
}

.wordmark {
    font-size: 1.25rem;
    font-weight: 800;
    font-stretch: 120%;
    letter-spacing: -0.02em;
}

.badge {
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(233, 195, 123, 0.14);
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.topbar-end {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
}

.status {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    height: 34px;
    padding: 0 14px;
    border: 1px solid var(--card-line);
    border-radius: 17px;
    background: var(--surface);
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    min-width: 0;
}

.status.ok {
    color: var(--ok);
    border-color: rgba(111, 211, 160, 0.25);
}

.status.bad {
    color: var(--bad);
    border-color: rgba(239, 122, 114, 0.4);
    background: rgba(239, 122, 114, 0.08);
}

.status-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.me {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-left: 6px;
}

.me-name {
    font-weight: 600;
    font-size: 0.92rem;
}

.layout {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 32px;
    padding: 28px var(--gutter) 64px;
    max-width: 1480px;
    margin: 0 auto;
}

.sidebar {
    position: sticky;
    top: 92px;
    align-self: start;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 42px;
    padding: 0 14px;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.nav-item svg {
    width: 19px;
    height: 19px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    flex: none;
}

.nav-item:hover {
    background: var(--surface);
    color: var(--text);
}

.nav-item.active {
    background: var(--surface-strong);
    color: var(--text);
    box-shadow: inset 3px 0 0 var(--accent);
}

.nav-badge {
    margin-left: auto;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    font-size: 0.72rem;
    font-weight: 700;
    line-height: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
}

.nav-badge.accent {
    background: var(--accent);
    color: #1a1406;
}

.nav-badge.bad {
    background: rgba(239, 122, 114, 0.2);
    color: var(--bad);
}

.content {
    min-width: 0;
}

.dialog-actions {
    justify-content: flex-end;
}

.toasts {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
}

.toast {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    border: 1px solid var(--card-line);
    border-radius: 12px;
    background: #171a28;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    font-size: 0.92rem;
    animation: toast-in 0.2s ease;
}

.toast.bad {
    border-color: rgba(239, 122, 114, 0.4);
}

@keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
}

@media (max-width: 960px) {
    .layout {
        grid-template-columns: minmax(0, 1fr);
        gap: 20px;
        padding-top: 16px;
    }

    .sidebar {
        position: static;
        flex-direction: row;
        overflow-x: auto;
        margin: 0 calc(var(--gutter) * -1);
        padding: 0 var(--gutter) 4px;
        scrollbar-width: none;
    }

    .nav-item {
        flex: none;
        height: 38px;
    }

    .nav-item.active {
        box-shadow: inset 0 -2px 0 var(--accent);
    }

    .me-name,
    .site-link span {
        display: none;
    }
}

@media (max-width: 560px) {
    .wordmark {
        font-size: 1.05rem;
    }

    .me {
        display: none;
    }

    .status {
        padding: 0 11px;
    }

    .status-text {
        max-width: 110px;
    }
}
</style>
