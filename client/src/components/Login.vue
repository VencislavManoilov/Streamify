<template>
    <div :class="styles.container" @click.self="$emit('close')">
        <div :class="styles.form">
            <h2>Login</h2>
            <form @submit.prevent="handleLogin">
                <div :class="styles.formGroup">
                    <label for="email">Email:</label>
                    <input type="email" id="email" v-model="email" required />
                </div>
                <div :class="styles.formGroup">
                    <label for="password">Password:</label>
                    <input type="password" id="password" v-model="password" required />
                </div>
                <button type="submit">Login</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: "LoginPage",
    data() {
        return {
            email: '',
            password: '',
            styles: {
                container: 'container',
                form: 'form',
                formGroup: 'formGroup'
            }
        };
    },
    methods: {
        async handleLogin() {
            try {
                const response = await axios.post(URL+'/auth/login', {
                    email: this.email,
                    password: this.password
                })

                localStorage.setItem('token', response.data.token);
                window.location.reload();
            } catch (error) {
                console.error('There was an error!', error);
            }
        }
    }
};
</script>

<style src="./auth.css" scoped>
</style>