<template>
    <div class="welcome-container">
        <h1>Welcome to Streamify</h1>
        <div class="button-group">
            <button v-on:click="login = true">Login</button>
            <br />
            <br />
            <button v-on:click="requestAccount = true">Request Account</button>
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
    text-align: center;
    margin-top: 50px;
}

.button-group {
    margin-top: 20px;
}

button {
    margin: 0 10px;
    padding: 10px 20px;
    font-size: 16px;
    cursor: pointer;
}
</style>