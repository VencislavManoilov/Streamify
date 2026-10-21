const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const axios = require('axios');
const fs = require('fs');
const os = require('os');
const logger = require('../utils/logger');
const { sendMail, checkMail, getMailStatus } = require('../utils/mailer');
const { YTS_API_URL } = require('../utils/yts');
const { addonUrls, addonName } = require('../utils/streamSources');
const { signSessionToken } = require('../middleware/Auth');
const TorrentManager = require('../utils/torrentManager');

const router = express.Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['user', 'admin'];
const DAY = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT = 8000;

const Authorization = async (req, res, next) => {
    const token = req.headers.authorization;

    if(!token) {
        return res.status(401).send('Unauthorized');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await req.knex('users').where({ email: decoded.email }).first();
        if(!user) {
            return res.status(401).send('Unauthorized');
        }

        // 403, not 401: the session is fine, it just isn't an admin one
        if(user.role !== 'admin') {
            return res.status(403).json({ message: 'You have to be admin for god sake!' });
        }

        req.user = user;

        next();
    } catch(err) {
        res.status(401).send('Unauthorized');
    }
}

// The password hash never leaves the server
function publicUser(user) {
    const { password, ...rest } = user;
    return rest;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const toNumber = value => Number(value) || 0;

function newestFirst(rows, column) {
    return rows.sort((a, b) => new Date(b[column]) - new Date(a[column]));
}

function errorMessage(err) {
    return (err && err.message) || String(err);
}

router.get('/status', async (req, res) => {
    const users = await req.knex('users').select("id").limit(1);

    if(!users || users.length === 0) {
        res.status(200).json({ status: 1, message: "Needs admin account" });
    } else {
        res.status(200).json({ status: 0, message: "Admin account exists" });
    }
});

router.post('/register', async (req, res) => {
    const users = await req.knex('users').select("id").limit(1);
    if(users && users.length > 0) {
        return res.status(400).send('Admin account already exists');
    }

    const { username, email, password } = req.body;

    if(!username || !password || !email) {
        return res.status(400).send('Username, email and password are required');
    }

    // Check if user already exists
    const existingUser = await req.knex('users').where({ email });

    if(existingUser.length) {
        return res.status(400).send('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { username, email, password: hashedPassword, role: 'admin' };

    try {
        const token = signSessionToken(user.email);
        await req.knex('users').insert(user);
        res.status(200).json({ token });
    } catch(err) {
        res.status(400).send('Error registering user');
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await req.knex('users').where({ email }).first();
        if (!user || !password || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).send('Invalid credentials');
        }

        if(user.role !== 'admin') {
            return res.status(401).json({ message: 'You have to be admin for god sake!' });
        }

        res.json({ token: signSessionToken(user.email) });
    } catch(err) {
        res.status(500).send('Internal Server Error');
    }
});

router.get('/me', Authorization, async (req, res) => {
    res.json({ user: publicUser(req.user) });
});

// Every user with how much they watch
router.get('/users', Authorization, async (req, res) => {
    const knex = req.knex;

    try {
        const history = knex('watch_history')
            .select('user_id')
            .count('* as movies')
            .sum('watched_seconds as seconds')
            .max('last_watched_at as last_watched_at')
            .groupBy('user_id')
            .as('h');
        const episodes = knex('episode_history')
            .select('user_id')
            .count('* as episodes')
            .sum('watched_seconds as seconds')
            .max('last_watched_at as last_watched_at')
            .groupBy('user_id')
            .as('e');
        const saved = knex('watchlist').select('user_id').count('* as saved').groupBy('user_id').as('w');

        const rows = await knex('users as u')
            .leftJoin(history, 'h.user_id', 'u.id')
            .leftJoin(episodes, 'e.user_id', 'u.id')
            .leftJoin(saved, 'w.user_id', 'u.id')
            .select('u.id', 'u.username', 'u.email', 'u.role', 'u.created_at', 'h.movies', 'h.seconds', 'h.last_watched_at',
                'e.episodes', 'e.seconds as episode_seconds', 'e.last_watched_at as episode_watched_at', 'w.saved')
            .orderBy('u.id');

        res.status(200).json(rows.map(({ episode_seconds, episode_watched_at, ...row }) => ({
            ...row,
            movies: toNumber(row.movies),
            episodes: toNumber(row.episodes),
            seconds: Math.round(toNumber(row.seconds) + toNumber(episode_seconds)),
            last_watched_at: [row.last_watched_at, episode_watched_at].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null,
            saved: toNumber(row.saved)
        })));
    } catch(err) {
        logger.error('Error fetching users: ' + errorMessage(err));
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// One user with what they watched and saved most recently
router.get('/user/:id', Authorization, async (req, res) => {
    try {
        const user = await req.knex('users').where({ id: req.params.id }).first();
        if(!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const [movies, episodes] = await Promise.all([
            req.knex('watch_history as h')
                .join('movies as m', 'm.imdb_code', 'h.imdb_code')
                .where('h.user_id', user.id)
                .orderBy('h.last_watched_at', 'desc')
                .limit(12)
                .select('m.imdb_code', 'm.title', 'm.year', 'm.small_cover_image', 'h.position', 'h.duration', 'h.watched_seconds', 'h.completed', 'h.last_watched_at'),
            req.knex('episode_history as h')
                .join('series as s', 's.imdb_code', 'h.imdb_code')
                .where('h.user_id', user.id)
                .orderBy('h.last_watched_at', 'desc')
                .limit(12)
                .select('s.imdb_code', 's.title', 's.year', 's.small_cover_image', 'h.season', 'h.episode', 'h.position', 'h.duration', 'h.watched_seconds', 'h.completed', 'h.last_watched_at')
        ]);
        const history = newestFirst([...movies, ...episodes], 'last_watched_at').slice(0, 12);

        const [savedMovies, savedSeries] = await Promise.all([
            req.knex('watchlist as w')
                .join('movies as m', 'm.imdb_code', 'w.imdb_code')
                .where('w.user_id', user.id)
                .select('m.imdb_code', 'm.title', 'm.year', 'm.small_cover_image', 'w.created_at'),
            req.knex('watchlist as w')
                .join('series as s', 's.imdb_code', 'w.imdb_code')
                .where('w.user_id', user.id)
                .select('s.imdb_code', 's.title', 's.year', 's.small_cover_image', 'w.created_at')
        ]);
        const watchlist = newestFirst([...savedMovies, ...savedSeries], 'created_at').slice(0, 12);

        res.json({ user: publicUser(user), history, watchlist });
    } catch(err) {
        logger.error('Error fetching user: ' + errorMessage(err));
        res.status(500).json({ message: 'Error fetching the user' });
    }
});

router.patch('/user/:id', Authorization, async (req, res) => {
    const { role } = req.body;

    if(!ROLES.includes(role)) {
        return res.status(400).json({ message: `Role must be one of: ${ROLES.join(', ')}` });
    }

    try {
        const user = await req.knex('users').where({ id: req.params.id }).first();
        if(!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Taking away your own admin role would lock you out of this panel
        if(user.id === req.user.id) {
            return res.status(400).json({ message: 'You can not change your own role' });
        }

        await req.knex('users').where({ id: user.id }).update({ role });
        logger.info(`${req.user.username} changed the role of ${user.username} to ${role}`);
        res.json({ user: publicUser({ ...user, role }) });
    } catch(err) {
        logger.error('Error changing role: ' + errorMessage(err));
        res.status(500).json({ message: 'Error changing the role' });
    }
});

router.delete('/user/:id', Authorization, async (req, res) => {
    const id = req.params.id;

    if(!id) {
        return res.status(400).send('User ID not found');
    }

    if(String(req.user.id) === String(id)) {
        return res.status(400).json({ message: 'You can not delete your own account' });
    }

    try {
        const user = await req.knex('users').where({ id }).first();
        if(!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await req.knex('users').where({ id }).delete();
        logger.info(`${req.user.username} deleted the user ${user.username} (${user.email})`);
        res.status(200).send('User deleted');
    } catch(err) {
        res.status(500).send('Error deleting user');
    }
});

async function diskUsage(folder) {
    if (!folder || !fs.promises.statfs) return null;
    try {
        const stats = await fs.promises.statfs(folder);
        return { path: folder, total: stats.blocks * stats.bsize, free: stats.bavail * stats.bsize };
    } catch (err) {
        return null;
    }
}

// Everything the overview page shows in one request
router.get('/stats', Authorization, async (req, res) => {
    const knex = req.knex;

    try {
        const count = (query) => query.count('* as count').first().then(row => toNumber(row && row.count));
        const weekAgo = new Date(Date.now() - 7 * DAY);
        const monthAgo = new Date(Date.now() - 30 * DAY);

        const [users, admins, newUsers, movies, categories, plays, finished, watched, activeUsers, saved, requests,
            series, seriesCategories, episodePlays, episodesFinished, episodeSeconds] = await Promise.all([
            count(knex('users')),
            count(knex('users').where({ role: 'admin' })),
            count(knex('users').where('created_at', '>', monthAgo)),
            count(knex('movies')),
            count(knex('categories')),
            count(knex('watch_history')),
            count(knex('watch_history').where({ completed: true })),
            knex('watch_history').sum('watched_seconds as seconds').first(),
            // Users who watched a movie or an episode
            knex.from(knex('watch_history').select('user_id').where('last_watched_at', '>', weekAgo)
                .union(knex('episode_history').select('user_id').where('last_watched_at', '>', weekAgo)).as('a'))
                .countDistinct('user_id as count').first(),
            count(knex('watchlist')),
            count(knex('access_requests').whereNull('invited_at')),
            count(knex('series')),
            count(knex('series_categories')),
            count(knex('episode_history')),
            count(knex('episode_history').where({ completed: true })),
            knex('episode_history').sum('watched_seconds as seconds').first()
        ]);

        const torrents = req.torrentManager ? req.torrentManager.getStats() : null;
        const memory = process.memoryUsage();
        const mail = getMailStatus();

        res.status(200).json({
            users: { count: users, admins, newThisMonth: newUsers, activeThisWeek: toNumber(activeUsers && activeUsers.count) },
            movies: { count: movies },
            series: { count: series, categories: seriesCategories },
            categories: { count: categories, nextRefresh: req.nextRefresh ? req.nextRefresh() : null },
            watching: {
                plays,
                finished,
                episodePlays,
                episodesFinished,
                seconds: Math.round(toNumber(watched && watched.seconds) + toNumber(episodeSeconds && episodeSeconds.seconds)),
                saved
            },
            conversions: req.playback ? { ...req.playback.hls.stats(), ...req.playback.abilities } : null,
            requests: { pending: requests },
            torrents,
            mail: { configured: mail.configured, current: mail.current, uptime: mail.uptime, checking: mail.checking },
            server: {
                uptime: Math.round(process.uptime()),
                startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
                node: process.version,
                platform: `${os.type()} ${os.release()} (${os.arch()})`,
                hostname: os.hostname(),
                cpus: os.cpus().length,
                load: os.loadavg(),
                memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
                system: { total: os.totalmem(), free: os.freemem() },
                disk: await diskUsage(torrents && torrents.downloadPath)
            }
        });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching stats', error: err.message || err });
    }
});

// What people watched lately and the most watched movies
router.get('/activity', Authorization, async (req, res) => {
    try {
        const [recentMovies, recentEpisodes] = await Promise.all([
            req.knex('watch_history as h')
                .join('users as u', 'u.id', 'h.user_id')
                .join('movies as m', 'm.imdb_code', 'h.imdb_code')
                .orderBy('h.last_watched_at', 'desc')
                .limit(15)
                .select('u.id as user_id', 'u.username', 'm.imdb_code', 'm.title', 'm.year', 'm.small_cover_image',
                    'h.position', 'h.duration', 'h.completed', 'h.last_watched_at'),
            req.knex('episode_history as h')
                .join('users as u', 'u.id', 'h.user_id')
                .join('series as s', 's.imdb_code', 'h.imdb_code')
                .orderBy('h.last_watched_at', 'desc')
                .limit(15)
                .select('u.id as user_id', 'u.username', 's.imdb_code', 's.title', 's.year', 's.small_cover_image',
                    'h.season', 'h.episode', 'h.position', 'h.duration', 'h.completed', 'h.last_watched_at')
        ]);
        const recent = newestFirst([...recentMovies, ...recentEpisodes], 'last_watched_at').slice(0, 15);

        const [topMovies, topSeries] = await Promise.all([
            req.knex('watch_history as h')
                .join('movies as m', 'm.imdb_code', 'h.imdb_code')
                .groupBy('m.imdb_code', 'm.title', 'm.year', 'm.small_cover_image')
                .select('m.imdb_code', 'm.title', 'm.year', 'm.small_cover_image')
                .countDistinct('h.user_id as viewers')
                .sum('h.watched_seconds as seconds')
                .orderBy([{ column: 'viewers', order: 'desc' }, { column: 'seconds', order: 'desc' }])
                .limit(8),
            req.knex('episode_history as h')
                .join('series as s', 's.imdb_code', 'h.imdb_code')
                .groupBy('s.imdb_code', 's.title', 's.year', 's.small_cover_image')
                .select('s.imdb_code', 's.title', 's.year', 's.small_cover_image')
                .countDistinct('h.user_id as viewers')
                .sum('h.watched_seconds as seconds')
                .orderBy([{ column: 'viewers', order: 'desc' }, { column: 'seconds', order: 'desc' }])
                .limit(8)
        ]);
        const top = [
            ...topMovies.map(movie => ({ ...movie, type: 'movie' })),
            ...topSeries.map(series => ({ ...series, type: 'series' }))
        ]
            .map(item => ({ ...item, viewers: toNumber(item.viewers), seconds: Math.round(toNumber(item.seconds)) }))
            .sort((a, b) => b.viewers - a.viewers || b.seconds - a.seconds)
            .slice(0, 8);

        res.json({ recent, top });
    } catch(err) {
        logger.error('Error fetching activity: ' + errorMessage(err));
        res.status(500).json({ message: 'Error fetching the activity' });
    }
});

async function timed(check) {
    const started = Date.now();
    try {
        const detail = await check();
        return { ok: true, latency: Date.now() - started, detail: detail || null };
    } catch (err) {
        return { ok: false, latency: Date.now() - started, error: errorMessage(err) };
    }
}

// Checks every service the server depends on. The mail server is only logged in to, nothing is sent.
router.get('/health', Authorization, async (req, res) => {
    const mailCheck = getMailStatus().current ? Promise.resolve() : checkMail();

    const [database, tmdb, yts, addons] = await Promise.all([
        timed(() => req.knex.raw('select 1')),
        timed(async () => {
            if (!process.env.TMDB_API_KEY) throw new Error('TMDB_API_KEY is not set');
            await req.tmdb.get('/configuration', { timeout: CHECK_TIMEOUT });
        }),
        timed(async () => {
            const response = await axios.get(`${YTS_API_URL}/list_movies.json`, { params: { limit: 1 }, timeout: CHECK_TIMEOUT });
            if (!response.data || response.data.status !== 'ok') throw new Error('Unexpected answer from the YTS API');
            return YTS_API_URL;
        }),
        // The torrent add-ons that find episodes. Working means at least one of them answers.
        timed(async () => {
            const urls = addonUrls();
            if (!urls.length) throw new Error('No torrent add-on is set (STREAM_ADDONS)');
            const answers = await Promise.allSettled(urls.map(url => axios.get(`${url}/manifest.json`, { timeout: CHECK_TIMEOUT })));
            const working = urls.filter((url, index) => answers[index].status === 'fulfilled').map(addonName);
            if (!working.length) throw new Error(`${urls.map(addonName).join(', ')} can't be reached`);
            return working.length === urls.length ? working.join(', ') : `${working.join(', ')} (${urls.length - working.length} not answering)`;
        }),
        mailCheck
    ]);

    const torrentStats = req.torrentManager ? req.torrentManager.getStats() : null;
    const torrentClient = req.torrentManager && req.torrentManager.client;
    const torrents = torrentClient && !torrentClient.destroyed
        ? { ok: true, detail: `${torrentStats.totalTorrents} of ${torrentStats.maxTorrents} torrents loaded` }
        : { ok: false, error: 'The torrent client is not running' };

    const mail = getMailStatus();
    const tools = req.playback ? req.playback.tools : { available: false };
    const converting = req.playback ? req.playback.hls.stats() : { jobs: 0 };
    const ffmpeg = tools.available
        ? { ok: true, detail: `ffmpeg ${tools.version || ''}, ${converting.jobs} ${converting.jobs === 1 ? 'conversion' : 'conversions'} running` }
        : { ok: false, error: "ffmpeg isn't installed, episodes in formats the browser can't play won't work" };

    res.json({
        checkedAt: new Date().toISOString(),
        services: [
            { id: 'database', name: 'Database', ...database, detail: database.ok ? 'PostgreSQL answers queries' : null },
            { id: 'mail', name: 'Mail server', ok: !!(mail.current && mail.current.ok), latency: mail.current && mail.current.latency, error: mail.current && mail.current.error, detail: mail.host ? `${mail.host}:${mail.port}` : null, checkedAt: mail.current && mail.current.at },
            { id: 'tmdb', name: 'TMDB API', ...tmdb, detail: tmdb.ok ? 'Movie lists and metadata' : null },
            { id: 'yts', name: 'YTS API', ...yts },
            { id: 'addons', name: 'Torrent add-ons', ...addons },
            { id: 'torrents', name: 'Torrent client', ...torrents },
            { id: 'ffmpeg', name: 'Video conversion', ...ffmpeg }
        ],
        mail
    });
});

router.get('/mail', Authorization, (req, res) => {
    res.json(getMailStatus());
});

// Logs in to the mail server right now to see if it works. No email is sent.
router.post('/mail/check', Authorization, async (req, res) => {
    await checkMail();
    res.json(getMailStatus());
});

router.get("/next-refresh", Authorization, async (req, res) => {
    try {
        const date = await req.nextRefresh();
        res.status(200).json({ date: date });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching time until next reset', error: err.message || err });
    }
});

// Only one refresh at a time, it takes a few minutes and hits TMDB and YTS hard
let refreshing = null;

router.get('/categories', Authorization, async (req, res) => {
    try {
        const rows = await req.knex('categories').select('id', 'name', 'movies', 'created_at').orderBy('id');
        const categories = rows.map(row => {
            const movies = typeof row.movies === 'string' ? JSON.parse(row.movies) : row.movies;
            return { id: row.id, name: row.name, movies: Array.isArray(movies) ? movies.length : 0, created_at: row.created_at };
        });
        const seriesRows = await req.knex('series_categories').select('id', 'name', 'series', 'created_at').orderBy('id');
        const seriesCategories = seriesRows.map(row => ({
            id: row.id,
            name: row.name,
            series: Array.isArray(row.series) ? row.series.length : 0,
            created_at: row.created_at
        }));

        res.json({
            categories,
            seriesCategories,
            seriesRefreshedAt: seriesRows.length ? seriesRows[0].created_at : null,
            refreshedAt: rows.length ? rows[0].created_at : null,
            nextRefresh: req.nextRefresh ? req.nextRefresh() : null,
            refreshing: !!refreshing
        });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching categories' });
    }
});

router.post("/reset-categories", Authorization, async (req, res) => {
    if (refreshing) {
        return res.status(409).json({ message: 'The categories are already being refreshed' });
    }

    try {
        logger.info(`${req.user.username} started a manual refresh of the categories`);
        refreshing = req.fetchTrendingMovies();
        await refreshing;

        res.status(200).json({ message: 'Categories reset' });
    } catch(err) {
        res.status(500).json({ message: 'Error resetting categories', error: err.message || err });
    } finally {
        refreshing = null;
    }
});

router.get('/torrents', Authorization, (req, res) => {
    if (!req.torrentManager) {
        return res.status(503).json({ message: 'The torrent client is not running' });
    }
    res.json(req.torrentManager.getStats());
});

// Drops a torrent and its downloaded data. Anyone streaming it is cut off.
router.delete('/torrents/:hash', Authorization, (req, res) => {
    if (!req.torrentManager) {
        return res.status(503).json({ message: 'The torrent client is not running' });
    }

    let hash;
    try {
        hash = TorrentManager.normalizeHash(req.params.hash);
    } catch (err) {
        return res.status(400).json({ message: 'Invalid torrent hash' });
    }

    const entry = req.torrentManager.entries.get(hash);
    if (!entry) {
        return res.status(404).json({ message: 'Torrent not found' });
    }

    logger.info(`${req.user.username} removed the torrent "${entry.name}"`);
    req.torrentManager.remove(hash);
    res.json({ message: 'Torrent removed' });
});

router.post("/shutdown", Authorization, async (req, res) => {
    try {
        res.status(200).json({ message: 'Server is shutting down' });
        logger.log('Server is shutting down...');
        process.exit(0);
    } catch (err) {
        res.status(500).json({ message: 'Error shutting down server', error: err.message || err });
        logger.log('Error shutting down server', err);
    }
});

router.get('/check-invite', (req, res) => {
    const token = req.query.token;

    if(!token) {
        return res.status(400).json({ message: 'Token is required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if(!decoded) {
            return res.status(400).json({ message: 'Invalid token' });
        }

        res.status(200).json({ email: decoded.email });
    } catch(err) {
        res.status(400).json({ message: 'Invalid token' });
    }
})

// Creates an invitation link and emails it, unless `send` is false. The link is always returned,
// so it can be shared by hand when the mail server is down.
router.post('/invite', Authorization, async (req, res) => {
    const { email, send = true } = req.body;

    if(!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Invalid email' });
    }

    const user = await req.knex('users').where({ email }).first();
    if(user) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1d' });

    const URL = process.env.FRONTEND_URL || 'http://localhost:3000';
    const link = `${URL}/register/${token}`;
    const inviter = escapeHtml(req.user.username);

    await req.knex('access_requests').where({ email }).update({ invited_at: new Date() }).catch(() => {});

    if (!send) {
        logger.info(`${req.user.username} created an invitation link for ${email}`);
        return res.status(200).json({ message: 'Invitation link created. It works for 24 hours.', link });
    }

    // Send email using nodemailer
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Invitation to join Streamify',
        text: `Please accept the invitation from ${req.user.username} and join our platform. Open this link ${link}`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2 style="color: #333;">You're Invited to Join Streamify!</h2>
                <p>
                    Hello,
                </p>
                <p>
                    You have been invited by <strong>${inviter}</strong> to join our platform. We are excited to have you on board!
                </p>
                <p>
                    Please click the button below to accept the invitation and complete your registration.
                </p>
                <p style="text-align: center;">
                    <a href="${link}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: #fff; background-color: #007bff; text-decoration: none; border-radius: 5px;">Join Streamify</a>
                </p>
                <p>
                    If the button above does not work, please copy and paste the following link into your web browser:
                </p>
                <p>
                    <a href="${link}">${link}</a>
                </p>
                <p>
                    Best regards,<br>
                    The Streamify Team
                </p>
            </div>
        `
    };

    try {
        await sendMail(mailOptions);
        logger.info(`${req.user.username} invited ${email}`);
        return res.status(200).json({ message: 'Email sent', link });
    } catch(error) {
        logger.error(`Error sending the invitation to ${email}: ${errorMessage(error)}`);
        return res.status(502).json({ message: 'The email could not be sent. You can copy the link and send it yourself.', link });
    }
});

router.post("/request-access", async (req, res) => {
    const { email } = req.body;

    if(!email) {
        return res.status(400).send('Email is required');
    }

    if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ message: 'Invalid email' });
    }

    const URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    const adminUser = await req.knex('users').where({ role: 'admin' }).first();
    if (!adminUser) {
        logger.warn("No admin user found. Please create an admin account.");
        return res.status(503).json({ message: 'Requests are not accepted yet. Please try again later.' });
    }

    // Saved first, so the request shows up in the admin panel even when the email below fails
    try {
        await req.knex('access_requests')
            .insert({ email, created_at: new Date() })
            .onConflict('email')
            .merge({ created_at: new Date(), invited_at: null });
    } catch(err) {
        logger.error('Error saving the access request: ' + errorMessage(err));
    }

    const safeEmail = escapeHtml(email);

    // Send email using nodemailer
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: adminUser.email,
        subject: 'Request Access to Streamify',
        text: `User has requested access to join Streamify. To accept the the request open this link ${URL}/admin/panel and invite user with this email "${email}"`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2 style="color: #333;">Request Access to Streamify</h2>
                <p>
                    User has requested access to join Streamify.
                </p>
                <p>
                    To accept the the request click on the button below and invite the user with this email:
                </p>
                <p>
                    <strong>${safeEmail}</strong>
                </p>
                <p style="text-align: center;">
                    <a href="${URL}/admin/panel" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: #fff; background-color: #007bff; text-decoration: none; border-radius: 5px;">Open Admin</a>
                </p>
                <p>
                    Best regards,<br>
                    The Streamify's Email Bot
                </p>
            </div>
        `
    };

    try {
        await sendMail(mailOptions);
    } catch(error) {
        // The request is saved, the admin still sees it in the panel
        logger.error(`Error emailing the access request of ${email}: ${errorMessage(error)}`);
    }

    return res.status(200).json({ message: "Request sent! Please, don't send multiple times!" });
});

router.get('/requests', Authorization, async (req, res) => {
    try {
        const requests = await req.knex('access_requests')
            .select('id', 'email', 'invited_at', 'created_at')
            .orderByRaw('invited_at is not null, created_at desc');
        res.json({ requests });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching the access requests' });
    }
});

router.delete('/requests/:id', Authorization, async (req, res) => {
    try {
        await req.knex('access_requests').where({ id: req.params.id }).del();
        res.json({ message: 'Request dismissed' });
    } catch(err) {
        res.status(500).json({ message: 'Error dismissing the request' });
    }
});

router.get("/logs", Authorization, async (req, res) => {
    const { level, count } = req.query;
    
    try {
        let logs;
        
        if (level) {
            logs = logger.getLogsByLevel(level);
        } else if (count) {
            logs = logger.getRecentLogs(parseInt(count));
        } else {
            logs = logger.getLogs();
        }
        
        res.json({ logs });
    } catch (err) {
        logger.error("Error retrieving logs: " + err);
        res.status(500).json({ error: "Failed to retrieve logs" });
    }
});

router.ws = function(app) {
    // Access the WebSocket server from the main app
    const wss = app.wss;
    
    // Handle WebSocket connections for logs
    wss.on('connection', (ws, req) => {
        // Check URL path to see if this is a logs request
        const url = new URL(req.url, `http://${req.headers.host}`);
        
        if (url.pathname === '/admin/logs-ws') {
            // Extract the auth token from query parameters
            const token = url.searchParams.get('token');
            
            // Verify the token asynchronously
            jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
                if (err) {
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Unauthorized' 
                    }));
                    return ws.close();
                }
                
                try {
                    // Verify the user is an admin
                    const user = await app.locals.knex('users')
                        .where({ email: decoded.email })
                        .first();
                    
                    if (!user || user.role !== 'admin') {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: 'Unauthorized' 
                        }));
                        return ws.close();
                    }
                    
                    // Handle filter params if provided
                    const level = url.searchParams.get('level');
                    const count = url.searchParams.get('count');
                    
                    // Send initial logs based on filters
                    let initialLogs;
                    if (level) {
                        initialLogs = logger.getLogsByLevel(level);
                    } else if (count) {
                        initialLogs = logger.getRecentLogs(parseInt(count));
                    } else {
                        initialLogs = logger.getLogs();
                    }
                    
                    // Send initial logs
                    ws.send(JSON.stringify({
                        type: 'initialLogs',
                        logs: initialLogs
                    }));
                    
                    // Subscribe this socket to new logs
                    logger.subscribe(ws);
                    
                    // Handle WebSocket messages (not required for this implementation)
                    ws.on('message', (message) => {
                        try {
                            const data = JSON.parse(message);
                            // Handle client messages if needed
                        } catch (e) {
                            // Invalid message format
                        }
                    });
                    
                } catch (err) {
                    logger.error("WebSocket error: " + err);
                    ws.send(JSON.stringify({ 
                        type: 'error', 
                        message: 'Server error' 
                    }));
                    ws.close();
                }
            });
        }
    });
};

module.exports = router;