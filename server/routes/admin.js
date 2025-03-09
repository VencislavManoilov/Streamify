const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const router = express.Router();

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

module.exports = router;