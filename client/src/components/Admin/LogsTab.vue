<template>
    <section>
        <div class="page-title">
            <div>
                <h2>Logs</h2>
                <p>The last {{ logs.length }} lines from the server, live.</p>
            </div>
            <div class="actions">
                <span class="pill" :class="connectionClass">
                    <span class="dot" :class="connectionClass"></span>{{ connectionLabel }}
                </span>
                <button type="button" class="btn small" :disabled="!logs.length" @click="download">Download</button>
                <button type="button" class="btn small" :disabled="!logs.length" @click="$emit('clear')">Clear view</button>
            </div>
        </div>

        <div class="card logs-card">
            <div class="card-head toolbar">
                <div class="segmented" role="group" aria-label="Filter by level">
                    <button v-for="option in levels" :key="option.id" type="button" :class="{ active: level === option.id }" @click="level = option.id">
                        {{ option.label }}<span class="count">{{ option.count }}</span>
                    </button>
                </div>
                <input v-model="query" class="input search" type="search" placeholder="Search the logs" aria-label="Search the logs" />
                <label class="follow">
                    <input v-model="follow" type="checkbox" />
                    Follow new lines
                </label>
            </div>

            <div ref="scroller" class="logs" @scroll="onScroll">
                <div v-for="(log, index) in visible" :key="index" class="line" :class="log.level">
                    <span class="time">{{ time(log.timestamp) }}</span>
                    <span class="level">{{ log.level }}</span>
                    <span class="message">{{ log.message }}</span>
                </div>
                <p v-if="!visible.length" class="empty">{{ logs.length ? 'No lines match.' : 'No logs yet.' }}</p>
            </div>
        </div>
    </section>
</template>

<script>
const LEVELS = [
    { id: 'all', label: 'All' },
    { id: 'error', label: 'Errors' },
    { id: 'warn', label: 'Warnings' },
    { id: 'info', label: 'Info' },
    { id: 'log', label: 'Other' }
];

export default {
    name: 'LogsTab',
    props: {
        logs: { type: Array, default: () => [] },
        connection: { type: String, default: 'connecting' }
    },
    emits: ['clear'],
    data() {
        return {
            level: 'all',
            query: '',
            follow: true
        };
    },
    computed: {
        levels() {
            return LEVELS.map(option => ({
                ...option,
                count: option.id === 'all' ? this.logs.length : this.logs.filter(log => log.level === option.id).length
            }));
        },
        visible() {
            const query = this.query.toLowerCase();
            return this.logs.filter(log =>
                (this.level === 'all' || log.level === this.level) &&
                (!query || String(log.message).toLowerCase().includes(query))
            );
        },
        connectionClass() {
            return { live: 'ok', offline: 'bad' }[this.connection] || 'warn';
        },
        connectionLabel() {
            return { live: 'Live', offline: 'Reconnecting' }[this.connection] || 'Connecting';
        }
    },
    watch: {
        visible() {
            if (this.follow) this.$nextTick(this.scrollToEnd);
        },
        follow(value) {
            if (value) this.scrollToEnd();
        }
    },
    mounted() {
        this.scrollToEnd();
    },
    methods: {
        time(timestamp) {
            const date = new Date(timestamp);
            return `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}`;
        },
        scrollToEnd() {
            const scroller = this.$refs.scroller;
            if (scroller) scroller.scrollTop = scroller.scrollHeight;
        },
        // Scrolling up to read stops following, scrolling back to the end starts again
        onScroll() {
            const scroller = this.$refs.scroller;
            const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
            if (this.follow !== atEnd) this.follow = atEnd;
        },
        download() {
            const text = this.visible.map(log => `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`).join('\n');
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `streamify-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
            link.click();
            URL.revokeObjectURL(url);
        }
    }
};
</script>

<style scoped>
.toolbar {
    margin-bottom: 0;
    padding-bottom: 16px;
}

.search {
    flex: 1 1 200px;
    max-width: 320px;
}

.follow {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-muted);
    font-size: 0.88rem;
    cursor: pointer;
    user-select: none;
}

.follow input {
    accent-color: var(--accent);
}

.logs {
    height: min(64vh, 640px);
    overflow-y: auto;
    margin: 0 -20px -20px;
    padding: 8px 0;
    border-top: 1px solid var(--card-line);
    background: rgba(0, 0, 0, 0.3);
    border-radius: 0 0 16px 16px;
    font-family: var(--mono);
    font-size: 0.8rem;
    line-height: 1.55;
}

.line {
    display: grid;
    grid-template-columns: max-content 52px minmax(0, 1fr);
    gap: 12px;
    padding: 2px 20px;
}

.line:hover {
    background: var(--row-hover);
}

.time {
    color: var(--text-faint);
    white-space: nowrap;
}

.level {
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-faint);
}

.message {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}

.line.info .level { color: var(--info); }
.line.log .level { color: var(--ok); }
.line.warn .level { color: var(--warn); }
.line.error .level { color: var(--bad); }
.line.error .message { color: #f5b5b0; }
.line.error { background: rgba(239, 122, 114, 0.05); }

@media (max-width: 640px) {
    .line {
        grid-template-columns: max-content minmax(0, 1fr);
    }

    .time {
        display: none;
    }
}
</style>
