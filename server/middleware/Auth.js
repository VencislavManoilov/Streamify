const jwt = require('jsonwebtoken');

const Authorization = async (req, res, next) => {
    const token = req.headers.authorization;
    if (!token) {
        return res.status(401).send('Unauthorized');
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await req.knex('users').where({ email: decoded.email }).first();
        if (!user) {
            return res.status(401).send('Unauthorized');
        }

        req.user = user;
        return next();
    } catch (err) {
        res.status(401).send('Unauthorized');
    }
};

module.exports = Authorization;