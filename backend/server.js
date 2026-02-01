const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startMidnightReset, startExpirationCheck } = require('./scheduler');
const { loginLimiter, uploadLimiter, adminLimiter, publicLimiter } = require('./middleware/rateLimiter');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(compression()); // Gzip compression
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Apply baseline rate limiting to all API routes
app.use('/api/', publicLimiter);

// Serve uploaded images statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// API Routes with rate limiting
// Auth routes - strict rate limit to prevent brute force
app.use('/api/auth', loginLimiter, require('./routes/auth'));

// Admin routes - moderate rate limiting
app.use('/api/settings', adminLimiter, require('./routes/settings'));
app.use('/api/player-info', adminLimiter, require('./routes/playerInfo'));

// Public + Admin routes - use baseline public limiter (more specific limits in route files)
app.use('/api/courts', require('./routes/courts'));
app.use('/api/game-states', require('./routes/gameStates'));
app.use('/api/match-history', require('./routes/matchHistory'));
app.use('/api/sponsors', require('./routes/sponsors'));

// 404 handler
app.use(notFoundHandler);

// Error handler (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, '0.0.0.0', async () => {
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

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
