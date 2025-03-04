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
                <p>Don't have an account? <a v-on:click="$emit('openRegister')">Register</a></p>
                <button type="submit">Login</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

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
                const response = await axios.post('http://localhost:8080/auth/login', {
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