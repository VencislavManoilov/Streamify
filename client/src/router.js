import { createRouter, createWebHistory } from 'vue-router';
import Movie from '@/components/Movie.vue';
import Home from './components/Home.vue';
import Search from './components/Search.vue';
import Auth from './components/Admin/Auth.vue';
import Panel from './components/Admin/Panel.vue';

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
    },
    {
        path: '/admin',
        redirect: '/admin/panel'
    },
    {
        path: '/admin/auth',
        name: 'Admin',
        component: Auth
    },
    {
        path: '/admin/panel',
        name: 'AdminPanel',
        component: Panel
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

export default router;