const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const router = express.Router();

// Updated transporter configuration for SendGrid SMTP
const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: process.env.MAIL_PORT,
    secure: process.env.MAIL_SECURE, // true - for 465, false - for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        rejectUnauthorized: process.env.MAIL_TLS_REJECT_UNAUTHORIZED,
    },
});

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

        if(user.role !== 'admin') {
            return res.status(401).json({ message: 'You have to be admin for god sake!' });
        }

        req.user = user;

        next();
    } catch(err) {
        res.status(401).send('Unauthorized');
    }
}

router.get('/status', async (req, res) => {
    const users = await req.knex('users').select("*");

    if(!users || users.length === 0) {
        res.status(200).json({ status: 1, message: "Needs admin account" });
    } else {
        res.status(200).json({ status: 0, message: "Admin account exists" });
    }
});

router.post('/register', async (req, res) => {
    const users = req.knex('users').select("*");
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
        const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        await req.knex('users').insert(user);
        res.status(200).json({ token });
    } catch(err) {
        res.status(400).send('Error registering user');
    }
});

router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    await req.knex('users').where({ email }).first().then(user => {
        if (user && bcrypt.compare(password, user.password)) {
            if(user.role !== 'admin') {
                return res.status(401).json({ message: 'You have to be admin for god sake!' });
            }

            const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.json({ token });
        } else {
            res.status(401).send('Invalid credentials');
        }
    }).catch(err => {
        res.status(500).send('Internal Server Error');
    })
});

router.get('/users', Authorization, async (req, res) => {
    const users = await req.knex('users').select("*");
    res.status(200).json(users);
});

router.get('/me', Authorization, async (req, res) => {
    if (!req.user) {
        return res.status(401).send('Unauthorized');
    }

    res.json({ user: req.user });
});

router.get('/stats', Authorization, async (req, res) => {
    try {
        const users = await req.knex('users').count('id as count').first();
        const movies = await req.knex('movies').count('id as count').first();
        const categories = await req.knex('categories').count('id as count').first();
        const torrents = req.torrentManager.getStats();

        res.status(200).json({ users, movies, categories, torrents });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching stats', error: err.message || err });
    }
});

router.get("/next-refresh", Authorization, async (req, res) => {
    try {
        const date = await req.nextRefresh();
        res.status(200).json({ date: date });
    } catch(err) {
        res.status(500).json({ message: 'Error fetching time until next reset', error: err.message || err });
    }
});

router.post("/reset-categories", Authorization, async (req, res) => {
    try {
        await req.fetchTrendingMovies();

        res.status(200).json({ message: 'Categories reset' });
    } catch(err) {
        res.status(500).json({ message: 'Error resetting categories', error: err.message || err });
    }
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

router.delete('/user/:id', Authorization, async (req, res) => {
    const id = req.params.id;

    if(!id) {
        return res.status(400).send('User ID not found');
    }

    try {
        await req.knex('users').where({ id }).delete();
        res.status(200).send('User deleted');
    } catch(err) {
        res.status(500).send('Error deleting user');
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

router.post('/invite', Authorization, async (req, res) => {
    const { email } = req.body;

    if(!email) {
        return res.status(400).send('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email' });
    }

    const user = req.knex('users').where({ email }).first();
    if(user.length > 0) {
        return res.status(400).json({ message: 'User already exists' });
    }

    const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '1d' });

    const URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    // Send email using nodemailer
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Invitation to join Streamify',
        text: `Please accept the invitation from ${req.user.username} and join our platform. Open this link ${URL}/register/${token}`,
        html: `
            <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                <h2 style="color: #333;">You're Invited to Join Streamify!</h2>
                <p>
                    Hello,
                </p>
                <p>
                    You have been invited by <strong>${req.user.username}</strong> to join our platform. We are excited to have you on board!
                </p>
                <p>
                    Please click the button below to accept the invitation and complete your registration.
                </p>
                <p style="text-align: center;">
                    <a href="${URL}/register/${token}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: #fff; background-color: #007bff; text-decoration: none; border-radius: 5px;">Join Streamify</a>
                </p>
                <p>
                    If the button above does not work, please copy and paste the following link into your web browser:
                </p>
                <p>
                    <a href="${URL}/register/${token}">${URL}/register/${token}</a>
                </p>
                <p>
                    Best regards,<br>
                    The Streamify Team
                </p>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if(error){
            logger.error(error);
            return res.status(500).json({ message: 'Error sending email' });
        }
        return res.status(200).json({ message: 'Email sent' });
    });
});

router.post("/request-access", async (req, res) => {
    const { email } = req.body;

    if(!email) {
        return res.status(400).send('Email is required');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(email)) {
        return res.status(400).json({ message: 'Invalid email' });
    }

    const URL = process.env.FRONTEND_URL || 'http://localhost:3000';

    const adminUser = await req.knex('users').where({ role: 'admin' }).first();
    if (!adminUser) {
        return logger.warn("No admin user found. Please create an admin account.");
    }

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
                    <strong>${email}</strong>
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

    transporter.sendMail(mailOptions, (error, info) => {
        if(error){
            logger.error(error);
            return res.status(500).json({ message : 'Error sending email' });
        }

        return res.status(200).json({ message: "Email sent! Please, don't send multiple times!" });
    });
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