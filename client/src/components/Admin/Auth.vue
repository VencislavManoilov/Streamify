<template>
    <Register v-if="status === 1" />
    <Login v-else-if="status === 0" />
    <LoadingSpinner v-else-if="loading && !error" overlay label="Loading" />
    <div v-else class="auth-container">
        <p>An error occurred: {{ error.message }}</p>
    </div>
</template>

<script>
import axios from 'axios';
import Register from './Register.vue';
import Login from './Login.vue';
import LoadingSpinner from '../LoadingSpinner.vue';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'AdminAuth',
    data() {
        return {
            loading: true,
            error: null,
            status: -1,
        };
    },
    components: {
        Register,
        Login,
        LoadingSpinner
    },
    async mounted() {
        // Check if user is already logged in
        try {
            const response = await axios.get(URL + '/admin/status');
            if(response.data.status !== 1) {
                this.status = 0;
            } else {
                this.status = 1;
            }
        } catch(error) {
            this.error = error;
        }
    },
};
</script>

<style scoped>
.auth-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
}
</style>