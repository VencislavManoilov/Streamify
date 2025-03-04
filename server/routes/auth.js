const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Authorization = require('../middleware/Auth');

const router = express.Router();

// Register route
router.post('/register', async (req, res) => {
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
    const user = { username, email, password: hashedPassword };
    
    try {
        await req.knex('users').insert(user);
        res.status(200).send('User registered');
    } catch(err) {
        res.status(400).send('Error registering user');
    }
});

// Login route
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    await req.knex('users').where({ email }).first().then(user => {
        if (user && bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
            res.json({ token });
        } else {
            res.status(401).send('Invalid credentials');
        }
    }).catch(err => {
        res.status(500).send('Internal Server Error');
    })
});

router.get('/me', Authorization, async (req, res) => {
    if (!req.user) {
        return res.status(401).send('Unauthorized');
    }

    if (req.user) {
        delete req.user.password;
    }

    res.json({ user: req.user });
});

module.exports = router;