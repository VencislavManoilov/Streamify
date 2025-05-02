<template>
    <div class="container" @click.self="$emit('close')">
        <div>
            <form @submit.prevent="handleRequest" class="register">
                <h2>Request Account Access</h2>
                <div class="form-group">
                    <label for="email">Email</label>
                    <input type="email" id="email" v-model="email" required />
                </div>
                <div class="message" :class="{ 'error': error, 'success': success }">
                    <p v-if="error || success">{{ message }}</p>
                </div>
                <div v-if="loading" class="loading-container">
                    <div class="loading-spinner"></div>
                </div>
                <button v-if="!loading && !success" type="submit">Submit Request</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: "RequestAccess",
    data() {
        return {
            email: '',
            loading: false,
            error: false,
            success: false,
            message: ''
        };
    },
    methods: {
        async handleRequest() {
            this.loading = true;
            this.error = false;
            this.success = false;
            this.message = '';
            
            try {
                const response = await axios.post(URL + '/admin/request-access', {
                    email: this.email
                });
                
                this.success = true;
                this.message = response.data.message || 'Request submitted successfully!';
            } catch (err) {
                console.error('There was an error!', err);
                this.error = true;
                this.message = err.response?.data?.message || 'An error occurred. Please try again.';
            } finally {
                this.loading = false;
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

.message {
    text-align: center;
    padding: 5px;
}

.error {
    color: red;
}

.success {
    color: green;
}

.loading-container {
    display: flex;
    justify-content: center;
    padding: 10px 0;
}

.loading-spinner {
    border: 4px solid #f3f3f3;
    border-top: 4px solid #007bff;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    animation: spin 2s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
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
</style>
