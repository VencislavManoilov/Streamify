import { createRouter, createWebHistory } from 'vue-router';
import Movie from '@/components/Movie.vue';
import Home from './components/Home.vue';
import Search from './components/Search.vue';

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
    },
    {
        path: '/search',
        name: 'Search',
        component: Search
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;