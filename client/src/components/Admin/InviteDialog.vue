<template>
    <div class="admin-dialog" @click.self="$emit('close')" @keydown.esc="$emit('close')">
        <div class="card" role="dialog" aria-modal="true" aria-labelledby="invite-title">
            <div class="card-head">
                <h3 id="invite-title">Invite someone</h3>
                <button type="button" class="btn small ghost" aria-label="Close" @click="$emit('close')">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
            </div>

            <form @submit.prevent="invite(true)">
                <label class="field-label" for="invite-email">Email address</label>
                <input
                    id="invite-email"
                    ref="email"
                    v-model.trim="email"
                    class="input field"
                    type="email"
                    placeholder="name@example.com"
                    required
                    :disabled="busy"
                />

                <div v-if="mailOk === false && !link" class="notice warn mail-warning">
                    <span class="dot warn"></span>
                    <div>
                        <strong>The mail server looks down</strong>
                        <p>The email will probably not arrive. Create a link and send it yourself instead.</p>
                    </div>
                </div>

                <p v-if="error" class="error-text message">{{ error }}</p>
                <p v-else-if="message" class="ok-text message">{{ message }}</p>

                <div v-if="link" class="link-box">
                    <input class="input mono" :value="link" readonly @focus="$event.target.select()" />
                    <button type="button" class="btn small" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
                </div>
                <p v-if="link" class="faint hint">The link works for 24 hours and only for this email address.</p>

                <div class="actions dialog-actions">
                    <button type="button" class="btn" :disabled="busy || !email" @click="invite(false)">Create link only</button>
                    <button type="submit" class="btn primary" :disabled="busy || !email">
                        {{ busy ? 'Sending…' : 'Send invitation' }}
                    </button>
                </div>
            </form>
        </div>
    </div>
</template>

<script>
import api from '../../api';
import { errorText } from './format';

export default {
    name: 'InviteDialog',
    props: {
        initialEmail: { type: String, default: '' },
        // null while the mail server hasn't been checked yet
        mailOk: { default: null }
    },
    emits: ['close', 'invited'],
    data() {
        return {
            email: this.initialEmail,
            busy: false,
            error: '',
            message: '',
            link: '',
            copied: false
        };
    },
    mounted() {
        this.$refs.email.focus();
    },
    watch: {
        email() {
            this.link = '';
            this.error = '';
            this.message = '';
        }
    },
    methods: {
        async invite(send) {
            this.busy = true;
            this.error = '';
            this.message = '';
            this.link = '';
            this.copied = false;

            try {
                const response = await api.post('/admin/invite', { email: this.email, send });
                this.message = send ? `Invitation sent to ${this.email}.` : response.data.message;
                this.link = response.data.link;
                this.$emit('invited', this.email);
            } catch (error) {
                this.error = errorText(error, 'The invitation could not be created');
                // The mail failed but the link still works
                if (error.response && error.response.data && error.response.data.link) {
                    this.link = error.response.data.link;
                    this.$emit('invited', this.email);
                }
            } finally {
                this.busy = false;
            }
        },
        async copy() {
            try {
                await navigator.clipboard.writeText(this.link);
                this.copied = true;
            } catch (err) {
                // Clipboard access needs https; the field is selectable as a fallback
                this.copied = false;
            }
        }
    }
};
</script>

<style scoped>
.field-label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
    font-size: 0.88rem;
    font-weight: 600;
}

.field {
    width: 100%;
    box-sizing: border-box;
    height: 44px;
}

.mail-warning {
    margin-top: 14px;
}

.message {
    margin: 14px 0 0;
    font-size: 0.92rem;
}

.link-box {
    display: flex;
    gap: 8px;
    margin-top: 12px;
}

.link-box .input {
    flex: 1;
    height: 34px;
}

.hint {
    margin: 6px 0 0;
    font-size: 0.83rem;
}

.dialog-actions {
    justify-content: flex-end;
    margin-top: 20px;
}
</style>
