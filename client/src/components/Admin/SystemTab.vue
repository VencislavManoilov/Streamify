<template>
    <section>
        <div class="page-title">
            <div>
                <h2>System</h2>
                <p>Services the server depends on, the mail server and the machine it runs on.</p>
            </div>
            <div class="actions">
                <span v-if="health" class="faint checked">Checked {{ ago(health.checkedAt) }}</span>
                <button type="button" class="btn" :disabled="checking" @click="$emit('recheck')">
                    <svg :class="{ spin: checking }" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
                    {{ checking ? 'Checking…' : 'Check all again' }}
                </button>
            </div>
        </div>

        <div class="grid two">
            <div class="card mail-card">
                <div class="card-head">
                    <h3>Mail server</h3>
                    <button type="button" class="btn small" :disabled="!mail || mailChecking" @click="checkMailNow">
                        <svg :class="{ spin: mailChecking }" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
                        {{ mailChecking ? 'Checking…' : 'Check now' }}
                    </button>
                </div>

                <LoadingSpinner v-if="!mail" :size="32" label="Loading the mail status" />
                <template v-else>
                    <div class="mail-state">
                        <span class="dot big" :class="mailLevel"></span>
                        <div>
                            <div class="mail-headline" :class="mailLevel">{{ mailHeadline }}</div>
                            <div class="faint">
                                <template v-if="mail.current">
                                    Checked {{ ago(mail.current.at) }}<template v-if="mail.current.ok"> · logged in after {{ mail.current.latency }} ms</template>
                                </template>
                                <template v-else>Not checked yet</template>
                            </div>
                        </div>
                    </div>

                    <div v-if="mail.current && !mail.current.ok" class="notice bad mail-error">
                        <div>
                            <strong>{{ mail.current.error }}</strong>
                            <p v-if="mail.current.hint">{{ mail.current.hint }}</p>
                            <p v-if="mail.current.code" class="mono">{{ mail.current.code }}</p>
                        </div>
                    </div>

                    <div v-if="mail.history.length" class="history">
                        <div class="history-head">
                            <span class="faint">Recent checks</span>
                            <span class="num" :class="uptimeClass">{{ uptimeText }}</span>
                        </div>
                        <div class="bars" role="img" :aria-label="`${uptimeText} of the last ${mail.history.length} checks passed`">
                            <span
                                v-for="(check, index) in mail.history"
                                :key="index"
                                class="bar"
                                :class="check.ok ? 'ok' : 'bad'"
                                :title="`${dateTime(check.at)}: ${check.ok ? `ok, ${check.latency} ms` : 'failed'}`"
                            ></span>
                        </div>
                        <div class="history-foot faint">
                            <span>{{ dateTime(mail.history[0].at) }}</span>
                            <span>now</span>
                        </div>
                    </div>

                    <dl class="facts mail-facts">
                        <dt>Server</dt>
                        <dd class="mono">{{ mail.host ? `${mail.host}:${mail.port}` : 'not set' }}</dd>
                        <dt>Encryption</dt>
                        <dd>{{ mail.secure ? 'TLS from the start (SMTPS)' : 'STARTTLS when offered' }}</dd>
                        <dt>Certificate</dt>
                        <dd>{{ mail.rejectUnauthorized ? 'verified' : 'not verified (self-signed allowed)' }}</dd>
                        <dt>Login</dt>
                        <dd class="mono">{{ mail.user || 'not set' }}</dd>
                        <dt>Auto check</dt>
                        <dd>{{ mail.checkInterval ? everyText : 'off (MAIL_CHECK_MINUTES=0)' }}</dd>
                        <dt>Emails sent</dt>
                        <dd>
                            <span class="num">{{ mail.sent }}</span> sent<span v-if="mail.failed">, <span class="num error-text">{{ mail.failed }} failed</span></span>
                            <span class="faint"> since the server started</span>
                        </dd>
                        <template v-if="mail.lastSent">
                            <dt>Last sent</dt>
                            <dd>{{ ago(mail.lastSent.at) }} <span class="faint">· {{ mail.lastSent.subject }}</span></dd>
                        </template>
                        <template v-if="mail.lastFailure">
                            <dt>Last failure</dt>
                            <dd>
                                {{ ago(mail.lastFailure.at) }} <span class="faint">· {{ mail.lastFailure.subject }}</span>
                                <div class="error-text failure">{{ mail.lastFailure.error }}</div>
                            </dd>
                        </template>
                    </dl>

                    <p class="faint mail-note">Checks connect and log in to the mail server like a real email would, then disconnect. No email is ever sent by a check.</p>
                </template>
            </div>

            <div class="card">
                <div class="card-head">
                    <h3>Services</h3>
                </div>
                <LoadingSpinner v-if="!services.length" :size="32" label="Checking the services" />
                <ul v-else class="list services">
                    <li v-for="service in services" :key="service.id">
                        <div class="service">
                            <span class="dot" :class="service.ok ? 'ok' : 'bad'"></span>
                            <div class="service-text">
                                <div class="service-name">{{ service.name }}</div>
                                <div v-if="service.ok" class="faint service-detail">{{ service.detail || 'working' }}</div>
                                <div v-else class="error-text service-detail">{{ service.error || 'not working' }}</div>
                            </div>
                        </div>
                        <span v-if="service.latency !== undefined && service.latency !== null" class="faint num latency">{{ service.latency }} ms</span>
                    </li>
                </ul>
            </div>
        </div>

        <div class="card" v-if="server">
            <div class="card-head">
                <h3>Server</h3>
                <span class="sub">up {{ duration(server.uptime) }}</span>
            </div>
            <div class="grid two server-grid">
                <dl class="facts">
                    <dt>Started</dt><dd>{{ dateTime(server.startedAt) }}</dd>
                    <dt>Node.js</dt><dd class="mono">{{ server.node }}</dd>
                    <dt>System</dt><dd>{{ server.platform }}</dd>
                    <dt>Host name</dt><dd class="mono">{{ server.hostname }}</dd>
                    <dt>CPU load</dt>
                    <dd class="num">{{ server.load.map(value => value.toFixed(2)).join(' · ') }} <span class="faint">(1, 5, 15 min on {{ server.cpus }} cores)</span></dd>
                    <dt>Server process</dt>
                    <dd class="num">{{ bytes(server.memory.rss) }} <span class="faint">({{ bytes(server.memory.heapUsed) }} heap)</span></dd>
                </dl>
                <div class="meters">
                    <div>
                        <div class="meter-head">
                            <span>Memory</span>
                            <span class="num faint">{{ bytes(memoryUsed) }} / {{ bytes(server.system.total) }}</span>
                        </div>
                        <div class="meter" :class="level(memoryUsed / server.system.total)">
                            <span :style="{ width: `${memoryUsed / server.system.total * 100}%` }"></span>
                        </div>
                    </div>
                    <div v-if="server.disk">
                        <div class="meter-head">
                            <span>Torrent disk</span>
                            <span class="num faint">{{ bytes(server.disk.free) }} free of {{ bytes(server.disk.total) }}</span>
                        </div>
                        <div class="meter" :class="level(diskUsed / server.disk.total)">
                            <span :style="{ width: `${diskUsed / server.disk.total * 100}%` }"></span>
                        </div>
                        <div class="faint mono disk-path">{{ server.disk.path }}</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="card danger-zone">
            <div class="card-head">
                <h3>Danger zone</h3>
            </div>
            <div class="danger-row">
                <div>
                    <strong>Shut down the server</strong>
                    <p class="muted">Stops the server process and every stream. With Docker's restart policy it starts again on its own.</p>
                </div>
                <button type="button" class="btn danger" @click="shutdown">Shut down</button>
            </div>
        </div>
    </section>
</template>

<script>
import api from '../../api';
import LoadingSpinner from '../LoadingSpinner.vue';
import { errorText, formatBytes, formatDateTime, formatDuration, timeAgo } from './format';

const MAIL_INTERVAL = 15 * 1000;

export default {
    name: 'SystemTab',
    components: {
        LoadingSpinner
    },
    inject: ['confirmAction', 'notify'],
    props: {
        stats: { type: Object, default: null },
        health: { type: Object, default: null },
        checking: { type: Boolean, default: false }
    },
    emits: ['recheck', 'mail'],
    data() {
        return {
            mail: null,
            mailChecking: false,
            timer: null
        };
    },
    computed: {
        server() {
            return this.stats && this.stats.server;
        },
        // The services from the health check, with the newest mail result
        services() {
            if (!this.health) return [];
            return this.health.services.map(service => {
                if (service.id !== 'mail' || !this.mail || !this.mail.current) return service;
                const current = this.mail.current;
                return { ...service, ok: current.ok, error: current.error, latency: current.latency };
            });
        },
        mailLevel() {
            if (!this.mail || !this.mail.current) return '';
            return this.mail.current.ok ? 'ok' : 'bad';
        },
        mailHeadline() {
            if (!this.mail.configured) return 'Not configured';
            if (!this.mail.current) return 'Waiting for the first check';
            return this.mail.current.ok ? 'Working' : 'Not working';
        },
        uptimeText() {
            if (this.mail.uptime === null) return '–';
            return `${Math.round(this.mail.uptime * 1000) / 10}% passed`;
        },
        uptimeClass() {
            if (this.mail.uptime === null) return '';
            if (this.mail.uptime === 1) return 'ok-text';
            return this.mail.uptime >= 0.9 ? 'warn-text' : 'error-text';
        },
        everyText() {
            const minutes = Math.round(this.mail.checkInterval / 60000);
            return minutes === 1 ? 'every minute' : `every ${minutes} minutes`;
        },
        memoryUsed() {
            return this.server.system.total - this.server.system.free;
        },
        diskUsed() {
            return this.server.disk.total - this.server.disk.free;
        }
    },
    mounted() {
        this.loadMail();
        this.timer = setInterval(() => {
            if (!document.hidden) this.loadMail();
        }, MAIL_INTERVAL);
    },
    beforeUnmount() {
        clearInterval(this.timer);
    },
    methods: {
        ago: timeAgo,
        dateTime: formatDateTime,
        duration: formatDuration,
        bytes: formatBytes,
        level(ratio) {
            if (ratio > 0.9) return 'bad';
            if (ratio > 0.75) return 'warn';
            return 'ok';
        },
        async loadMail() {
            try {
                const response = await api.get('/admin/mail');
                this.mail = response.data;
            } catch (error) {
                // the next poll tries again
            }
        },
        async checkMailNow() {
            this.mailChecking = true;
            try {
                const response = await api.post('/admin/mail/check', {}, { timeout: 60000 });
                this.mail = response.data;
                this.$emit('mail', response.data);
                const current = response.data.current;
                this.notify(current.ok ? 'The mail server works' : `The mail server check failed: ${current.error}`, current.ok ? 'ok' : 'bad');
            } catch (error) {
                this.notify(errorText(error, 'The check could not be run'), 'bad');
            } finally {
                this.mailChecking = false;
            }
        },
        async shutdown() {
            const ok = await this.confirmAction({
                title: 'Shut down the server?',
                message: 'Everyone watching is cut off and the site stops working until the server is started again.',
                confirmLabel: 'Shut down',
                danger: true
            });
            if (!ok) return;

            try {
                await api.post('/admin/shutdown');
                this.notify('The server is shutting down', 'warn');
            } catch (error) {
                this.notify(errorText(error, 'The server could not be shut down'), 'bad');
            }
        }
    }
};
</script>

<style scoped>
.checked {
    font-size: 0.85rem;
}

.mail-state {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
}

.dot.big {
    width: 14px;
    height: 14px;
}

.mail-headline {
    font-size: 1.35rem;
    font-weight: 700;
    line-height: 1.2;
}

.mail-headline.ok {
    color: var(--ok);
}

.mail-headline.bad {
    color: var(--bad);
}

.mail-error {
    margin-bottom: 18px;
}

.mail-error .mono {
    margin-top: 6px;
    color: var(--text-faint);
}

.history {
    margin-bottom: 20px;
}

.history-head,
.history-foot {
    display: flex;
    justify-content: space-between;
    font-size: 0.82rem;
}

.history-head {
    margin-bottom: 6px;
    font-weight: 600;
}

.history-foot {
    margin-top: 4px;
    font-size: 0.75rem;
}

.bars {
    display: flex;
    gap: 2px;
    height: 28px;
}

.bar {
    flex: 1 1 0;
    max-width: 10px;
    border-radius: 2px;
    background: var(--ok);
    opacity: 0.85;
}

.bar.bad {
    background: var(--bad);
    opacity: 1;
}

.bar:hover {
    opacity: 1;
    filter: brightness(1.2);
}

.warn-text {
    color: var(--warn);
}

.mail-facts {
    padding-top: 18px;
    border-top: 1px solid var(--card-line);
}

.failure {
    margin-top: 2px;
    font-size: 0.85rem;
}

.mail-note {
    margin: 18px 0 0;
    font-size: 0.83rem;
}

.service {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
}

.service .dot {
    margin-top: 8px;
}

.service-text {
    min-width: 0;
}

.service-name {
    font-weight: 600;
}

.service-detail {
    font-size: 0.85rem;
    overflow-wrap: anywhere;
}

.latency {
    flex: none;
    font-size: 0.85rem;
}

.server-grid {
    align-items: start;
}

.meters {
    display: flex;
    flex-direction: column;
    gap: 18px;
}

.meter-head {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
    font-size: 0.9rem;
    font-weight: 600;
}

.disk-path {
    margin-top: 6px;
    font-size: 0.75rem;
}

.danger-zone {
    border-color: rgba(239, 122, 114, 0.25);
}

.danger-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
}

.danger-row p {
    margin: 2px 0 0;
    font-size: 0.9rem;
}
</style>
