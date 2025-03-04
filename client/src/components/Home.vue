<template>
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
                }).then(() => {
                    this.auth = true;
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
    }
};
</script>

<style scoped>
.home {
    padding: 20px;
}
</style>