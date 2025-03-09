<template>
    <div class="welcome-container">
        <h1>Welcome to Streamify</h1>
        <div class="button-group">
            <button v-on:click="login = true">Login</button>
        </div>
    </div>
    <Login v-if="login" @close="handleOutsideClick" />
</template>

<script>
import Login from './Login.vue';

export default {
    name: 'WelcomePage',
    components: {
        Login,
    },
    data() {
        return {
            login: false,
            register: false
        }
    },
    methods: {
        handleOutsideClick() {
            if (this.login || this.register) {
                this.login = false;
                this.register = false;
            }
        },
        openLogin() {
            this.register = false;
            this.login = true;
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