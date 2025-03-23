const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const Authorization = require('../middleware/Auth');

const router = express.Router();

// Register route
router.post('/register', async (req, res) => {
    const { token, username, password } = req.body;
    if(!username || !password || !token) {
        return res.status(400).json({ message: 'Username, email and token are required' });
    }

    const { email } = jwt.verify(token, process.env.JWT_SECRET);

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

    try {
        const token = jwt.sign({ email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(200).json({ token });
    } catch(err) {
        logger.log("Error creating jwt token: " + err);
        res.status(400).json({ message: 'Error generating token' });
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