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
        handleLogin() {
            // Handle login logic here
            console.log('Email:', this.email);
            console.log('Password:', this.password);
        }
    }
};
</script>

<style src="./auth.css" scoped>
</style>