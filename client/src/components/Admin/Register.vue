<template>
    <div class="register-container">
        <h2>Admin Registration</h2>
        <p v-if="error" style="color: red;">{{ error }}</p>
        <form @submit.prevent="register">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" v-model="username" required />
            </div>
            <div class="form-group">
                <label for="email">Email</label>
                <input type="email" id="email" v-model="email" required />
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" v-model="password" required />
            </div>
            <button type="submit">Register</button>
        </form>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'AuthRegister',
    data() {
        return {
            username: '',
            email: '',
            password: '',
            error: ''
        };
    },
    methods: {
        async register() {
            try {
                const response = await axios.post(URL + "/admin/register", {
                    username: this.username,
                    email: this.email,
                    password: this.password
                });
                if(response.data.token) {
                    localStorage.setItem('token', response.data.token);
                    this.$router.push('/admin/panel');
                } else {
                    this.error = response.data.message;
                }
            } catch(error) {
                this.error = error.response.data.message;
            }
        }
    }
};
</script>

<style scoped>
.register-container {
    max-width: 400px;
    margin: 0 auto;
    margin-top: 72px;
    padding: 20px;
    border: 1px solid #ccc;
    border-radius: 10px;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
}

h2 {
    text-align: center;
    margin-bottom: 20px;
}

.form-group {
    margin-bottom: 15px;
}

label {
    display: block;
    margin-bottom: 5px;
}

input {
    width: 100%;
    padding: 8px;
    box-sizing: border-box;
}

button {
    width: 100%;
    padding: 10px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
}

button:hover {
    background-color: #0056b3;
}
</style>