import { createRouter, createWebHistory } from 'vue-router';
import Movie from '@/components/Movie.vue';
import Home from './components/Home.vue';
import SeriesPage from './components/SeriesPage.vue';
import Search from './components/Search.vue';
import Profile from './components/Profile.vue';
import Welcome from './components/Welcome.vue';
import Auth from './components/Admin/Auth.vue';
import Panel from './components/Admin/Panel.vue';
import Register from './components/Register.vue';
import { session, safeRedirect } from './session';

const routes = [
    {
        path: '/',
        name: 'Home',
        component: Home,
        meta: { requiresAuth: true }
    },
    {
        path: '/login',
        name: 'Welcome',
        component: Welcome
    },
    {
        path: '/movie/:imdb_code',
        name: 'Movie',
        component: Movie,
        meta: { requiresAuth: true }
    },
    {
        path: '/series',
        name: 'SeriesHome',
        component: Home,
        props: { kind: 'series' },
        meta: { requiresAuth: true }
    },
    {
        // Without an episode the page opens the one to watch next
        path: '/series/:imdb_code/:season(\\d+)?/:episode(\\d+)?',
        name: 'Series',
        component: SeriesPage,
        meta: { requiresAuth: true }
    },
    {
        path: '/search',
        name: 'Search',
        component: Search,
        meta: { requiresAuth: true }
    },
    {
        path: '/profile',
        name: 'Profile',
        component: Profile,
        meta: { requiresAuth: true }
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
        component: Panel,
        meta: { requiresAdmin: true }
    },
    {
        path: '/register/:token',
        name: 'Register',
        component: Register
    }
];

const router = createRouter({
    history: createWebHistory(),
    routes
});

function loginRoute(to) {
    return { name: 'Welcome', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
}

// Every page checks the session first, so a logged out visitor always lands on the login page
router.beforeEach(async (to) => {
    let user = null;
    try {
        user = await session.ensure();
    } catch (err) {
        // The server is unreachable. Let the page load and show its own error instead of logging out.
        return true;
    }

    if (to.meta.requiresAuth && !user) {
        return loginRoute(to);
    }

    if (to.meta.requiresAdmin && (!user || user.role !== 'admin')) {
        return { name: 'Admin' };
    }

    if (to.name === 'Admin' && user && user.role === 'admin') {
        return { name: 'AdminPanel' };
    }

    if (to.name === 'Welcome' && user) {
        return safeRedirect(to.query.redirect);
    }

    return true;
});

session.onExpired(() => {
    const current = router.currentRoute.value;
    if (current.meta.requiresAdmin) {
        router.replace({ name: 'Admin' });
    } else if (current.meta.requiresAuth) {
        router.replace(loginRoute(current));
    }
});

export default router;
