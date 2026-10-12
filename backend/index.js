// Entrypoint bridge for serverless environments and module loaders
const app = require('./server');
const port = process.env.PORT || 3000;

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Backend server running on http://localhost:${port}`);
    });
}

module.exports = app;
