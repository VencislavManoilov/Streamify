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
                <LoadingSpinner v-if="loading" :size="36" label="Sending your request" />
                <button v-if="!loading && !success" type="submit">Submit Request</button>
            </form>
        </div>
    </div>
</template>

<script>
import axios from 'axios';
import { API_URL } from '../config';
import LoadingSpinner from './LoadingSpinner.vue';

export default {
    name: "RequestAccess",
    components: {
        LoadingSpinner
    },
    emits: ['close'],
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
                const response = await axios.post(API_URL + '/admin/request-access', {
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
    background-color: rgba(3, 4, 9, 0.6);
    backdrop-filter: blur(6px);
}

.container > div {
    width: 400px;
    max-width: calc(100% - 32px);
}

.register {
    max-width: 100%;
    margin: 0 auto;
    padding: 28px;
    box-sizing: border-box;
    background-color: var(--bg-elevated);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.5);
}

.register h2 {
    margin-top: 0;
    text-align: center;
    font-stretch: 112%;
}

.register div {
    margin-bottom: 15px;
}

.register label {
    display: block;
    margin-bottom: 6px;
    color: var(--text-muted);
}

.register input {
    width: 100%;
    height: 44px;
    padding: 0 12px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text);
    font-size: 1rem;
}

.register input:focus {
    outline: none;
    border-color: rgba(233, 195, 123, 0.6);
    box-shadow: 0 0 0 3px rgba(233, 195, 123, 0.14);
}

.register button {
    width: 100%;
    height: 46px;
    background-color: #f2f2f4;
    color: #0b0b10;
    border: none;
    border-radius: 10px;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
}

.register button:hover {
    background-color: #ffffff;
}

.message {
    text-align: center;
    padding: 5px;
}

.message p {
    margin: 0;
}

.error {
    color: var(--danger);
}

.success {
    color: #7fd18b;
}

@media (max-width: 550px) {
    .register h2 {
        font-size: 30px;
    }

    .register label {
        font-size: 18px;
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
