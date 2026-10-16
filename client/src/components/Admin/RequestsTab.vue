<template>
    <section>
        <div class="page-title">
            <div>
                <h2>Access requests</h2>
                <p>People who asked to join from the login page. They are kept here even when the email to you fails.</p>
            </div>
            <div class="actions">
                <button type="button" class="btn primary" @click="openInvite('')">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    Invite user
                </button>
            </div>
        </div>

        <div v-if="mailOk === false" class="notice warn mail-notice">
            <span class="dot warn"></span>
            <div>
                <strong>The mail server is not reachable</strong>
                <p>New requests don't reach your inbox and invitation emails will fail. Use "Create link only" in the invite dialog and send the link yourself.</p>
            </div>
        </div>

        <div class="card">
            <div class="card-head">
                <h3>Waiting</h3>
                <span class="sub">{{ pending.length }}</span>
            </div>
            <LoadingSpinner v-if="loading" :size="32" label="Loading the requests" />
            <p v-else-if="loadError" class="empty error-text">{{ loadError }}</p>
            <ul v-else-if="pending.length" class="list">
                <li v-for="request in pending" :key="request.id">
                    <div class="request">
                        <span class="email">{{ request.email }}</span>
                        <span class="faint when" :title="dateTime(request.created_at)">asked {{ ago(request.created_at) }}</span>
                    </div>
                    <div class="actions">
                        <button type="button" class="btn small primary" @click="openInvite(request.email)">Invite</button>
                        <button type="button" class="btn small ghost" @click="dismiss(request)">Dismiss</button>
                    </div>
                </li>
            </ul>
            <p v-else class="empty">No one is waiting for an invitation.</p>
        </div>

        <div v-if="invited.length" class="card">
            <div class="card-head">
                <h3>Invited, not registered yet</h3>
                <span class="sub">invitations expire after 24 hours</span>
            </div>
            <ul class="list">
                <li v-for="request in invited" :key="request.id">
                    <div class="request">
                        <span class="email">{{ request.email }}</span>
                        <span class="faint when">invited {{ ago(request.invited_at) }}
                            <span v-if="expired(request)" class="pill warn">expired</span>
                        </span>
                    </div>
                    <div class="actions">
                        <button type="button" class="btn small" @click="openInvite(request.email)">Invite again</button>
                        <button type="button" class="btn small ghost" @click="dismiss(request)">Remove</button>
                    </div>
                </li>
            </ul>
        </div>

        <InviteDialog v-if="inviteEmail !== null" :initial-email="inviteEmail" :mail-ok="mailOk" @close="inviteEmail = null" @invited="onInvited" />
    </section>
</template>

<script>
import api from '../../api';
import LoadingSpinner from '../LoadingSpinner.vue';
import InviteDialog from './InviteDialog.vue';
import { errorText, formatDateTime, timeAgo } from './format';

const INVITE_LIFETIME = 24 * 60 * 60 * 1000;

export default {
    name: 'RequestsTab',
    components: {
        LoadingSpinner,
        InviteDialog
    },
    inject: ['confirmAction', 'notify'],
    props: {
        mailOk: { default: null }
    },
    emits: ['changed'],
    data() {
        return {
            requests: [],
            loading: true,
            loadError: '',
            inviteEmail: null
        };
    },
    computed: {
        pending() {
            return this.requests.filter(request => !request.invited_at);
        },
        invited() {
            return this.requests.filter(request => request.invited_at);
        }
    },
    mounted() {
        this.load();
    },
    methods: {
        ago: timeAgo,
        dateTime: formatDateTime,
        expired(request) {
            return Date.now() - new Date(request.invited_at).getTime() > INVITE_LIFETIME;
        },
        async load() {
            try {
                const response = await api.get('/admin/requests');
                this.requests = response.data.requests;
                this.loadError = '';
            } catch (error) {
                this.loadError = errorText(error, 'The requests could not be loaded');
            } finally {
                this.loading = false;
            }
        },
        openInvite(email) {
            this.inviteEmail = email;
        },
        onInvited() {
            this.load();
            this.$emit('changed');
        },
        async dismiss(request) {
            const ok = await this.confirmAction({
                title: `Remove the request from ${request.email}?`,
                message: 'They are not told about it and can ask again from the login page.',
                confirmLabel: 'Remove'
            });
            if (!ok) return;

            try {
                await api.delete(`/admin/requests/${request.id}`);
                this.requests = this.requests.filter(other => other.id !== request.id);
                this.$emit('changed');
            } catch (error) {
                this.notify(errorText(error, 'The request could not be removed'), 'bad');
            }
        }
    }
};
</script>

<style scoped>
.mail-notice {
    margin-bottom: 16px;
}

.request {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.email {
    font-weight: 600;
    overflow-wrap: anywhere;
}

.when {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
}
</style>
