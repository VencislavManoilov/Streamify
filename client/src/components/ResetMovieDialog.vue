<template>
    <div class="backdrop" @click.self="close">
        <!-- Keys stay in here, so the player behind doesn't pause or seek while the dialog is open -->
        <div
            ref="dialog"
            class="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-title"
            aria-describedby="reset-lead"
            tabindex="-1"
            @keydown.stop="onKeydown"
        >
            <span class="glyph" :class="{ done: !!result, spinning: busy }" aria-hidden="true">
                <svg v-if="result" viewBox="0 0 24 24"><path d="M5.5 12.5l4.2 4.2L18.5 8" /></svg>
                <svg v-else viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></svg>
            </span>

            <template v-if="result">
                <h2 id="reset-title">Movie reset</h2>
                <p id="reset-lead" class="lead">{{ resultText }}</p>

                <ul v-if="versions.length" class="versions">
                    <li v-for="version in versions" :key="version.hash" :class="{ added: version.added }">
                        {{ version.label }}
                        <span v-if="version.added" class="badge">New</span>
                    </li>
                </ul>
                <p v-if="removedText" class="fine">{{ removedText }}</p>

                <div class="actions">
                    <button ref="primary" type="button" class="button primary" @click="close">Done</button>
                </div>
            </template>

            <template v-else>
                <h2 id="reset-title">Reset this movie?</h2>
                <p id="reset-lead" class="lead">
                    Streamify looks <strong>{{ movie.title }}</strong> up on YTS again and swaps its details and
                    torrent list for the latest ones. A newer or better torrent may turn up.
                </p>

                <div class="reasons">
                    <p class="reasons-title">It can help when</p>
                    <ul>
                        <li>the video doesn't start or keeps buffering</li>
                        <li>a quality you want is missing</li>
                        <li>a newer release with more seeders is out</li>
                    </ul>
                </div>

                <p class="fine">Your watch progress and watchlist stay as they are. Each movie can be reset once an hour.</p>

                <p v-if="error" class="status error" role="alert">{{ error }}</p>
                <p v-else-if="statusText" class="status" :class="{ blocked: !!waitUntil }">{{ statusText }}</p>

                <div class="actions">
                    <button ref="cancel" type="button" class="button" :disabled="busy" @click="close">Cancel</button>
                    <button type="button" class="button primary" :disabled="!canReset" @click="reset">
                        <span v-if="busy" class="spinner" aria-hidden="true"></span>
                        {{ busy ? 'Resetting…' : waitUntil ? `Available in ${waitText}` : 'Reset movie' }}
                    </button>
                </div>
            </template>
        </div>
    </div>
</template>

<script>
import api from '../api';

const MINUTE = 60 * 1000;

function describe(torrent) {
    return [torrent.quality, torrent.type === 'web' ? 'WEB' : torrent.type === 'bluray' ? 'BluRay' : torrent.type, torrent.video_codec]
        .filter(Boolean)
        .join(' ');
}

function plural(count, word) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// "3 minutes", "1 hour 5 minutes"
function duration(ms) {
    const minutes = Math.max(1, Math.ceil(ms / MINUTE));
    const hours = Math.floor(minutes / 60);
    if (!hours) return plural(minutes, 'minute');
    return minutes % 60 ? `${plural(hours, 'hour')} ${plural(minutes % 60, 'minute')}` : plural(hours, 'hour');
}

function ago(time) {
    const ms = Date.now() - time;
    if (ms < MINUTE) return 'just now';
    if (ms < 24 * 60 * MINUTE) return `${duration(ms)} ago`;
    return `on ${new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
}

export default {
    name: 'ResetMovieDialog',
    props: {
        movie: {
            type: Object,
            required: true
        }
    },
    emits: ['close', 'reset'],
    data() {
        return {
            // { resetAt, availableAt, reason, remaining } from the server
            status: null,
            busy: false,
            error: '',
            result: null,
            now: Date.now()
        };
    },
    computed: {
        waitUntil() {
            const until = this.status && this.status.availableAt ? new Date(this.status.availableAt).getTime() : 0;
            return until > this.now ? until : 0;
        },
        waitText() {
            return duration(this.waitUntil - this.now);
        },
        canReset() {
            return !!this.status && !this.busy && !this.waitUntil;
        },
        statusText() {
            if (!this.status) return 'Checking the movie…';
            const resetAt = this.status.resetAt ? new Date(this.status.resetAt).getTime() : 0;
            if (this.waitUntil && this.status.reason === 'movie') {
                return `This movie was reset ${ago(resetAt)}, so its torrents are already up to date. You can reset it again in ${this.waitText}.`;
            }
            if (this.waitUntil) {
                return `You've reset a lot of movies in the last hour. You can reset again in ${this.waitText}.`;
            }
            const parts = [];
            if (resetAt) parts.push(`Last reset ${ago(resetAt)}.`);
            if (this.status.remaining !== null && this.status.remaining <= 2) {
                parts.push(`You can reset ${plural(this.status.remaining, 'more movie')} this hour.`);
            }
            return parts.join(' ');
        },
        versions() {
            if (!this.result) return [];
            const added = new Set(this.result.changes.added.map(torrent => String(torrent.hash).toLowerCase()));
            return (this.result.movie.torrents || []).map(torrent => ({
                hash: torrent.hash,
                label: describe(torrent),
                added: added.has(String(torrent.hash).toLowerCase())
            }));
        },
        resultText() {
            const { added } = this.result.changes;
            if (added.length) {
                return `Found ${plural(added.length, 'new version')} on YTS. The details and the torrent list are up to date now.`;
            }
            return 'The details are refreshed. YTS has no newer torrents for this movie right now.';
        },
        removedText() {
            const { removed } = this.result.changes;
            return removed.length ? `YTS doesn't list ${removed.map(describe).join(', ')} anymore, so ${removed.length === 1 ? 'it was' : 'they were'} removed.` : '';
        }
    },
    async mounted() {
        this.previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        this.previousFocus = document.activeElement;
        this.$refs.cancel.focus({ preventScroll: true });
        this.clock = setInterval(() => {
            this.now = Date.now();
        }, 15 * 1000);

        try {
            const response = await api.get(`/movies/${this.movie.imdb_code}/reset`);
            this.status = response.data;
        } catch (err) {
            // The reset itself still answers with the right reason when it isn't allowed
            this.status = { resetAt: null, availableAt: null, reason: null, remaining: null };
        }
    },
    beforeUnmount() {
        clearInterval(this.clock);
        document.body.style.overflow = this.previousOverflow;
        if (this.previousFocus && this.previousFocus.focus) {
            this.previousFocus.focus({ preventScroll: true });
        }
    },
    methods: {
        close() {
            if (!this.busy) this.$emit('close');
        },
        async reset() {
            if (!this.canReset) return;
            this.busy = true;
            this.error = '';

            try {
                const response = await api.post(`/movies/${this.movie.imdb_code}/reset`);
                this.result = response.data;
                this.$emit('reset', response.data);
                this.busy = false;
                await this.$nextTick();
                if (this.$refs.primary) this.$refs.primary.focus({ preventScroll: true });
            } catch (err) {
                this.busy = false;
                const data = err.response && err.response.data;
                if (err.response && err.response.status === 429 && data) {
                    this.now = Date.now();
                    this.status = data;
                } else if (!err.response || err.response.status !== 401) {
                    this.error = (data && data.error) || "The movie couldn't be reset. Check your connection and try again.";
                }
            }
        },
        // Escape closes the dialog and Tab stays inside it
        onKeydown(event) {
            if (event.key === 'Escape') {
                this.close();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = [...this.$refs.dialog.querySelectorAll('button:not(:disabled)')];
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }
};
</script>

<style scoped>
.backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(3, 4, 9, 0.66);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    animation: fade 0.2s ease-out;
}

.dialog {
    position: relative;
    width: 100%;
    max-width: 480px;
    max-height: calc(100dvh - 48px);
    box-sizing: border-box;
    overflow-y: auto;
    padding: 28px 28px 24px;
    border: 1px solid var(--line);
    border-radius: 22px;
    background:
        radial-gradient(ellipse 90% 55% at 50% 0%, rgba(125, 108, 240, 0.16), transparent 70%),
        var(--bg-elevated);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 30px 80px rgba(0, 0, 0, 0.6);
    color: var(--text);
    outline: none;
    animation: rise 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.glyph {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    margin-bottom: 16px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(125, 108, 240, 0.32), rgba(22, 108, 138, 0.3));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 10px 26px rgba(76, 60, 190, 0.3);
    color: #e3defd;
}

.glyph.done {
    background: linear-gradient(135deg, rgba(31, 201, 154, 0.35), rgba(4, 119, 90, 0.4));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14), 0 10px 26px rgba(5, 150, 105, 0.3);
    color: #c9f7e6;
}

.glyph svg {
    width: 26px;
    height: 26px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.1;
    stroke-linecap: round;
    stroke-linejoin: round;
}

.glyph.spinning svg {
    animation: spin 0.9s linear infinite;
}

h2 {
    margin: 0 0 10px;
    font-size: 1.5rem;
    font-weight: 800;
    font-stretch: 112%;
    line-height: 1.15;
}

.lead {
    margin: 0;
    color: #cdd0dc;
    line-height: 1.6;
}

.lead strong {
    color: var(--text);
}

.reasons {
    margin-top: 18px;
    padding: 14px 16px;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.04);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

.reasons-title {
    margin: 0 0 8px;
    color: var(--text-faint);
    font-size: 0.85rem;
    font-weight: 650;
    letter-spacing: 0.02em;
}

.reasons ul {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
}

.reasons li {
    position: relative;
    padding-left: 18px;
    line-height: 1.45;
}

.reasons li::before {
    content: '';
    position: absolute;
    left: 2px;
    top: 0.6em;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
}

.fine {
    margin: 14px 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.5;
}

.status {
    margin: 14px 0 0;
    color: var(--text-muted);
    font-size: 0.9rem;
    line-height: 1.5;
}

.status.blocked {
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(233, 195, 123, 0.1);
    box-shadow: inset 0 0 0 1px rgba(233, 195, 123, 0.25);
    color: #f1dcb4;
}

.status.error {
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(229, 115, 107, 0.12);
    box-shadow: inset 0 0 0 1px rgba(229, 115, 107, 0.3);
    color: #f3b4ae;
}

.versions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 16px 0 0;
    padding: 0;
    list-style: none;
}

.versions li {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 17px;
    background: var(--surface);
    font-size: 0.9rem;
}

.versions li.added {
    border-color: rgba(31, 201, 154, 0.45);
    background: rgba(31, 201, 154, 0.1);
}

.badge {
    padding: 1px 7px;
    border-radius: 8px;
    background: #1fc99a;
    color: #04241b;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}

.actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 24px;
}

.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 44px;
    padding: 0 20px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    font-size: 1rem;
    font-weight: 650;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease, transform 0.15s ease;
}

.button:hover:not(:disabled) {
    background: var(--surface-hover);
}

.button:active:not(:disabled) {
    transform: scale(0.97);
}

.button.primary {
    border-color: #f2f2f4;
    background: #f2f2f4;
    color: #0b0b10;
    font-weight: 700;
}

.button.primary:hover:not(:disabled) {
    background: #fff;
}

.button:disabled {
    cursor: default;
    opacity: 0.5;
}

.spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(11, 11, 16, 0.25);
    border-top-color: #0b0b10;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@keyframes fade {
    from { opacity: 0; }
}

@keyframes rise {
    from {
        opacity: 0;
        transform: translateY(16px) scale(0.98);
    }
}

@media (max-width: 640px) {
    .backdrop {
        place-items: end center;
        padding: 0;
    }

    .dialog {
        max-width: none;
        max-height: 92dvh;
        padding: 24px 20px calc(20px + env(safe-area-inset-bottom));
        border-radius: 22px 22px 0 0;
        border-bottom: none;
    }

    .actions {
        flex-direction: column-reverse;
    }

    .button {
        width: 100%;
    }
}

@media (prefers-reduced-motion: reduce) {
    .backdrop,
    .dialog,
    .glyph.spinning svg,
    .spinner {
        animation: none;
    }
}
</style>
