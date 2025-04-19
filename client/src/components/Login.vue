<template>
    <div class="container" @click.self="$emit('close')">
        <div>
            <form @submit.prevent="handleLogin" class="register">
                <h2>Login</h2>
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" v-model="email" required />
                </div>
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" v-model="password" required />
                </div>
                <div class="error">
                    <p v-if="error" class="error-message">{{ error }}</p>
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
            },
            error: ''
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
            } catch (err) {
                console.error('There was an error!', err);
                this.error = err.response.data.message || err.response.data || 'An error occurred. Please try again.';
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
    background-color: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(3px);
}

.container > div {
    background-color: black;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
    width: 400px;
    max-width: 80%; 
}

.register {
    max-width: 100%;
    margin: 0 auto;
    padding: 20px;
    border: 1px solid #ccc;
    border-radius: 4px;
}

.register h2 {
    text-align: center;
}

.register div {
    margin-bottom: 15px;
}

.register label {
    display: block;
    margin-bottom: 5px;
}

.register input {
    width: 100%;
    padding: 8px;
    box-sizing: border-box;
}

.register button {
    width: 100%;
    padding: 10px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
}

.register button:hover {
    background-color: #0056b3;
}

@media (max-width: 550px) {
    .container > div {
        min-width: 100%;
    }

    .register h2 {
        font-size: 36px;
    }

    .register label {
        font-size: 24px;
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
    color: red;
}
</style>