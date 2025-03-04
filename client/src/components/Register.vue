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
                <button type="submit">Register</button>
            </form>
        </div>
    </div>
</template>

<script>
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
        handleRegister() {
            console.log('Username:', this.username);
            console.log('Email:', this.email);
            console.log('Password:', this.password);
        }
    }
};
</script>

<style src="./auth.css" scoped>
</style>