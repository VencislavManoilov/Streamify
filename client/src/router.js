import { createRouter, createWebHistory } from 'vue-router';
import Movie from '@/components/Movie.vue';
import Home from './components/Home.vue';

const routes = [
    {
        path: '/',
        name: 'Home',
        component: Home
    },
    {
        path: '/movie/:imdb_code',
        name: 'Movie',
        component: Movie
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;