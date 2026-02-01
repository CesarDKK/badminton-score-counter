const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startMidnightReset, startExpirationCheck } = require('./scheduler');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - required when behind nginx/reverse proxy for rate limiting and IP detection
app.set('trust proxy', true);

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(compression()); // Gzip compression
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve frontend files statically
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const db = require('./config/database');
        await db.query('SELECT 1');

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            database: 'connected'
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            database: 'disconnected'
        });
    }
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/player-info', require('./routes/playerInfo'));
app.use('/api/courts', require('./routes/courts'));
app.use('/api/game-states', require('./routes/gameStates'));
app.use('/api/match-history', require('./routes/matchHistory'));
app.use('/api/sponsors', require('./routes/sponsors'));

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Start server and store reference for graceful shutdown
const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ Health check: http://localhost:${PORT}/health`);

    // Test database connection before starting scheduler
    try {
        const db = require('./config/database');
        await db.query('SELECT 1');
        console.log('✓ Database connection successful');

        // Start midnight reset scheduler
        startMidnightReset();

        // Start sponsor expiration checker
        startExpirationCheck();
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
        console.error('✗ Midnight reset scheduler not started');
    }
});

// Graceful shutdown - handle SIGTERM and SIGINT
const gracefulShutdown = async (signal) => {
    console.log(`${signal} signal received: starting graceful shutdown`);

    // Close HTTP server first (stop accepting new connections)
    server.close(async () => {
        console.log('✓ HTTP server closed');

        try {
            // Close database connection pool
            const db = require('./config/database');
            if (db.pool) {
                await db.pool.end();
                console.log('✓ Database pool closed');
            }
        } catch (error) {
            console.error('✗ Error closing database pool:', error);
        }

        console.log('✓ Graceful shutdown complete');
        process.exit(0);
    });

    // Force shutdown after 10 seconds if graceful shutdown hangs
    setTimeout(() => {
        console.error('✗ Graceful shutdown timeout, forcing exit');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT')); // Handle Ctrl+C
