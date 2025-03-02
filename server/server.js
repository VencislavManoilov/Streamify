const express = require('express');
const app = express();
const PORT = 8080;

app.get('/', (req, res) => {
    res.json({ 
        version: '1.0.0',
        message: "Welcome to Streamify API!"
    });
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});