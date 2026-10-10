<template>
    <div class="container" @click.self="$emit('close')">
        <div>
            <form @submit.prevent="handleLogin" class="register">
                <h2>Login</h2>
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" v-model="email" autocomplete="email" required />
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" v-model="password" autocomplete="current-password" required />
                </div>
                <div class="error">
                    <p v-if="error" class="error-message">{{ error }}</p>
                </div>
                <button type="submit" :disabled="submitting">Login</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';
import { API_URL } from '../config';
import { session, safeRedirect } from '../session';

export default {
    name: "LoginPage",
    emits: ['close'],
    data() {
        return {
            email: '',
            password: '',
            error: '',
            submitting: false
        };
    },
    methods: {
        async handleLogin() {
            this.submitting = true;
            this.error = '';
            try {
                const response = await axios.post(API_URL + '/auth/login', {
                    email: this.email,
                    password: this.password
                });

                await session.login(response.data.token);
                // Back to the page that asked for the login
                this.$router.replace(safeRedirect(this.$route.query.redirect));
            } catch (err) {
                console.error('There was an error!', err);
                const data = err.response && err.response.data;
                this.error = (data && (data.message || data)) || 'The server could not be reached. Please try again.';
            } finally {
                this.submitting = false;
            }
        }
    }
};
</script>

<style scoped>

.container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
    background-color: rgba(3, 4, 9, 0.6);
    backdrop-filter: blur(6px);
}

.container > div {
    width: 400px;
    max-width: calc(100% - 32px);
}

.register {
    max-width: 100%;
    margin: 0 auto;
    padding: 28px;
    box-sizing: border-box;
    background-color: var(--bg-elevated);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
}

.register h2 {
    margin-top: 0;
    text-align: center;
    font-stretch: 112%;
}

.register div {
    margin-bottom: 15px;
}

.register label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
}

.register input {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    font-size: 1rem;
}

.register input:focus {
    outline: none;
    border-color: rgba(233, 195, 123, 0.6);
    box-shadow: 0 0 0 3px rgba(233, 195, 123, 0.14);
}

.register button {
    width: 100%;
    height: 46px;
    background-color: #f2f2f4;
    color: #0b0b10;
    border: none;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
}

.register button:hover {
    background-color: #ffffff;
}

.register button:disabled {
    opacity: 0.6;
    cursor: default;
}

@media (max-width: 550px) {
    .register h2 {
        font-size: 30px;
    }

    .register label {
        font-size: 18px;
    }

    .register input {
        font-size: 18px;
    }

    .register button {
        font-size: 18px;
        margin-top: 5px;
    }
}

.error {
    color: var(--danger);
}

.error-message {
    margin: 0;
}
</style>
