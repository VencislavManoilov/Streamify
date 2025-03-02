const express = require('express');
const app = express();
const dotenv = require('dotenv');
const ensureSchema = require('./schema');

const PORT = 8080;

dotenv.config();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ 
        version: '1.0.0',
        message: "Welcome to Streamify API!"
    });
})

ensureSchema().then(() => {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});