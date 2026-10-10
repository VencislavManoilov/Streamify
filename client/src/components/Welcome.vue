<template>
    <div class="welcome-container">
        <h1>Welcome to Streamify</h1>
        <div class="button-group">
            <button class="primary" v-on:click="login = true">Login</button>
            <button class="secondary" v-on:click="requestAccount = true">Request Account</button>
        </div>
    </div>
    <Login v-if="login" @close="handleOutsideClick" />
    <RequestAccess v-if="requestAccount" @close="handleOutsideClick" />
</template>

<script>
import Login from './Login.vue';
import RequestAccess from './RequestAccess.vue';

export default {
    name: 'WelcomePage',
    components: {
        Login,
        RequestAccess
    },
    data() {
        return {
            login: false,
            register: false,
            requestAccount: false
        }
    },
    methods: {
        handleOutsideClick() {
            if (this.login || this.register || this.requestAccount) {
                this.login = false;
                this.register = false;
                this.requestAccount = false;
            }
        },
        openLogin() {
            this.register = false;
            this.login = true;
            this.requestAccount = false;
        }
    }
}
</script>

<style scoped>
.welcome-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    padding: 24px;
    box-sizing: border-box;
    text-align: center;
}

h1 {
    margin: 0;
    font-size: clamp(2.2rem, 7vw, 4rem);
    font-weight: 800;
    font-stretch: 120%;
    line-height: 1;
    letter-spacing: -0.015em;
}

.button-group {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 12px;
    margin-top: 36px;
}

button {
    height: 48px;
    padding: 0 28px;
    border-radius: 24px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;
}

.primary {
    border: none;
    background: #f2f2f4;
    color: #0b0b10;
}

.primary:hover {
    background: #ffffff;
}

.secondary {
    border: 1px solid rgba(255, 255, 255, 0.24);
    background: var(--surface);
    color: var(--text);
}

.secondary:hover {
    background: var(--surface-hover);
}
</style>
