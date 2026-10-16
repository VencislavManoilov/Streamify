const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Authorization = require('../middleware/Auth');
const { signSessionToken } = require('../middleware/Auth');
const logger = require('../utils/logger');

const router = express.Router();

// Register route
router.post('/register', async (req, res) => {
    const { token, username, password } = req.body;
    if(!username || !password || !token) {
        return res.status(400).json({ message: 'Username, email and token are required' });
    }

    let email;
    try {
        ({ email } = jwt.verify(token, process.env.JWT_SECRET));
    } catch(err) {
        return res.status(400).json({ message: 'This invitation link is invalid or has expired' });
    }

    if(!email) {
        return res.status(400).json({ message: 'Invalid token' });
    }

    // Check if user already exists
    const existingUser = await req.knex('users').where({ email });

    if(existingUser.length) {
        return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = { username, email, password: hashedPassword, role: 'user' };

    try {
        await req.knex('users').insert(user);
    } catch(err) {
        return res.status(400).json({ message: 'Error registering user' });
    }

    // Their access request is answered now
    await req.knex('access_requests').where({ email }).del().catch(() => {});

    try {
        res.status(200).json({ token: signSessionToken(user.email) });
    } catch(err) {
        logger.log("Error creating jwt token: " + err);
        res.status(400).json({ message: 'Error generating token' });
    }
});

// Login route
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await req.knex('users').where({ email }).first();

        if (!user || !password) {
            return res.status(401).send('Invalid credentials');
        }

        const passwordMatch = await bcrypt.compare(password, user.password);

        if (passwordMatch) {
            return res.json({ token: signSessionToken(user.email) });
        } else {
            return res.status(401).send('Invalid credentials');
        }
    } catch (err) {
        return res.status(500).send('Internal Server Error');
    }
});

router.get('/me', Authorization, async (req, res) => {
    if (!req.user) {
        return res.status(401).send('Unauthorized');
    }

    const { password, ...user } = req.user;
    const response = { user };

    // Tokens from before sessions became permanent still expire, so swap them for a permanent one
    if (req.tokenPayload && req.tokenPayload.exp) {
        response.token = signSessionToken(user.email);
    }

    res.json(response);
});

module.exports = router;
