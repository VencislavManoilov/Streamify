<template>
    <div :class="styles.container" @click.self="$emit('close')">
        <div :class="styles.form">
            <h2>Register</h2>
            <form @submit.prevent="handleRegister">
                <div :class="styles.formGroup">
                    <label for="username">Username:</label>
                    <input type="text" id="username" v-model="username" required />
                </div>
                <div :class="styles.formGroup">
                    <label for="email">Email:</label>
                    <input type="email" id="email" v-model="email" required />
                </div>
                <div :class="styles.formGroup">
                    <label for="password">Password:</label>
                    <input type="password" id="password" v-model="password" required />
                </div>
                <p>Already have an account? <a v-on:click="$emit('openLogin')">Login</a></p>
                <button type="submit">Register</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

export default {
    name: "RegisterPage",
    data() {
        return {
            username: '',
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
        async handleRegister() {
            try {
                const response = await axios.post('http://localhost:8080/auth/register', {
                    username: this.username,
                    email: this.email,
                    password: this.password
                })

                if(response.status === 200) {
                    this.$emit('openLogin');
                }
            } catch (error) {
                console.error('There was an error!', error);
            }
        }
    }
};
</script>

<style src="./auth.css" scoped>
</style>