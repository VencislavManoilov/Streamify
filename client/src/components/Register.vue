<template>
    <div class="register">
        <h2>Register</h2>
        <p v-if="email">Registering for <strong>{{ email }}</strong></p>
        <p v-if="error" style="color: red;">{{ error }}</p>
        <form @submit.prevent="register">
            <div>
                <label for="username">Username:</label>
                <input type="text" id="username" v-model="username" required />
            </div>
            <div>
                <label for="password">Password:</label>
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
    name: 'RegisterPage',
    data() {
        return {
            username: '',
            password: '',
            token: this.$route.params.token,
            email: '',
            error: ''
        };
    },
    async mounted() {
        try {
            const response = await axios.get(URL+'/admin/check-invite?token='+this.token);
            if(!response.data.email) {
                this.error = response.data.message || response.data || 'An error occurred';
            }

            this.email = response.data.email;
        } catch(error) {
            this.error = error.response.data.message || error.response.data || 'An error occurred';
        }
    },
    methods: {
        async register() {
            try {
                const response = await axios.post(URL+'/auth/register', {
                    username: this.username,
                    password: this.password,
                    token: this.token
                });

                if(!response.data.token) {
                    this.error = response.data.message || response.data || 'An error occurred';
                    return;
                }

                localStorage.setItem('token', response.data.token);
                this.$router.push('/');
            } catch (error) {
                this.error = error.response.data.message || error.response.data || 'An error occurred';
            }
        }
    }
};
</script>

<style scoped>
.register {
    max-width: 400px;
    margin: 0 auto;
    margin-top: 72px;
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
</style>