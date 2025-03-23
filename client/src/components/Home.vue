<template>
    <div class="adminPanel" v-if="admin">
        <button @click="goToAdmin()">Go to Admin</button>
    </div>
    <div>
        <div v-if="loading">Loading...</div>
        <Welcome v-else-if="!auth" />
        <MovieCatalog v-else />
    </div>
</template>

<script>
import axios from 'axios';
import Welcome from './Welcome.vue';
import MovieCatalog from './MovieCatalog.vue';

const URL = process.env.VUE_APP_BACKEND_URL || 'http://localhost:8080';

export default {
    name: 'HomePage',
    data() {
        return {
            auth: false,
            loading: true,
            admin: false
        };
    },
    components: {
        Welcome,
        MovieCatalog
    },
    mounted() {
        try {
            const token = localStorage.getItem('token');
            if (token) {
                axios.get(URL+'/auth/me', {
                    headers: {
                        Authorization: `${token}`
                    }
                }).then((response) => {
                    this.auth = true;
                    this.admin = response.data.user.role === 'admin' ? response.data.user.username : false;
                }).catch(() => {
                    this.auth = false;
                }).finally(() => {
                    this.loading = false;
                });
            } else {
                this.loading = false;
                this.auth = false;
            }
        } catch (error) {
            console.error('There was an error!', error);
            this.loading = false;
        }
    },
    methods: {
        goToAdmin() {
            this.$router.push('/admin');
        }
    }
};
</script>

<style scoped>
.home {
    padding: 0;
}

.adminPanel {
    padding: 10px;
    background-color: #333;
    color: white;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.adminPanel button {
    padding: 5px 10px;
    background-color: #555;
    color: white;
    border: none;
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.3s ease;
}

.adminPanel button:hover {
    background-color: #777;
}
</style>