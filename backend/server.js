const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { startMidnightReset, startExpirationCheck } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Tenant middleware kører på alle requests og sætter req.accessMode
app.use(require('./middleware/tenant'));

// Mode endpoint — frontend bruger dette til at kende adgangskonteksten
// qrCounter: kun tilgængelig i klub-mode (kræver at server og telefon ikke deler lokalt netværk)
app.get('/api/mode', (req, res) => {
    res.json({
        mode: req.accessMode || 'direct',
        qrCounter: req.accessMode === 'club'
    });
});

// Health check
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
        res.status(503).json({ status: 'unhealthy', error: error.message, database: 'disconnected' });
    }
});

// Routes
const { loginLimiter } = require('./middleware/rateLimiter');

app.use('/api/super-admin', require('./routes/superAdmin'));
app.use('/api/auth', loginLimiter, require('./routes/auth'));
app.use('/api/club-admin/login', loginLimiter);
app.use('/api/club-admin', require('./routes/clubAdmin'));
app.use('/api/device-tokens', require('./routes/deviceTokens'));

// Device token entry point — tablet/TV åbner dette bogmærke-link
app.get('/t/:token', async (req, res, next) => {
    try {
        const { query, queryOne } = require('./config/database');
        const jwt = require('jsonwebtoken');

        const deviceToken = await queryOne(
            'SELECT id, name, destination, locked, token_type, consumed_at, show_qr_on_tv FROM device_tokens WHERE token = ? AND is_active = 1',
            [req.params.token]
        );

        if (!deviceToken) {
            return res.status(401).send('Ugyldigt eller deaktiveret adgangslink');
        }

        // Sæt consumed_at første gang en match-session token bruges (sporing)
        if (deviceToken.token_type === 'match_session' && !deviceToken.consumed_at) {
            await query('UPDATE device_tokens SET last_used_at = NOW(), consumed_at = NOW() WHERE id = ?', [deviceToken.id]);
        } else {
            await query('UPDATE device_tokens SET last_used_at = NOW() WHERE id = ?', [deviceToken.id]);
        }

        const sessionToken = jwt.sign(
            {
                role: 'device',
                tokenId: deviceToken.id,
                destination: deviceToken.destination,
                locked: deviceToken.locked,
                tokenType: deviceToken.token_type || 'permanent',
                clubSubdomain: req.clubSubdomain
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // Byg destination URL — slår version op fra settings så versionsvalget er centralt
        const { queryOne: settingsQueryOne } = require('./config/database');
        let targetUrl;

        if (deviceToken.destination.startsWith('tv/')) {
            const courtNum = deviceToken.destination.split('/')[1];
            const tvVersionRow = await settingsQueryOne(
                "SELECT setting_value FROM settings WHERE setting_key = 'tv_version'"
            );
            const tvVersion = tvVersionRow?.setting_value || 'v3';
            const tvPage = tvVersion === 'v2' ? 'tv.html' : 'tv-v3.html';
            // QR-flag per-token: tilladelsen kombineres med klub-mode på TV-siden
            const qrFlag = deviceToken.show_qr_on_tv ? '1' : '0';
            targetUrl = `/${tvPage}?court=${courtNum}&dt=${sessionToken}&qr=${qrFlag}`;
        } else if (deviceToken.destination.startsWith('court/')) {
            const courtNum = deviceToken.destination.split('/')[1];
            const courtVersionRow = await settingsQueryOne(
                "SELECT setting_value FROM settings WHERE setting_key = 'court_version'"
            );
            const courtVersion = courtVersionRow?.setting_value || 'v3';
            const courtPage = courtVersion === 'v2' ? 'court.html' : 'court-v3.html';
            targetUrl = `/${courtPage}?court=${courtNum}&dt=${sessionToken}`;
        } else {
            // Legacy destinations
            const legacyMap = { tv: '/tv.html', 'tv-v3': '/tv-v3.html', oversigt: '/oversigt.html' };
            targetUrl = `${legacyMap[deviceToken.destination] || '/' + deviceToken.destination}?dt=${sessionToken}`;
        }

        res.redirect(targetUrl);
    } catch (error) {
        next(error);
    }
});

app.use('/api/qr-code', require('./routes/matchSessionTokens'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/player-info', require('./routes/playerInfo'));
app.use('/api/courts', require('./routes/courts'));
app.use('/api/game-states', require('./routes/gameStates'));
app.use('/api/match-history', require('./routes/matchHistory'));
app.use('/api/sponsors', require('./routes/sponsors'));
app.use('/api/team-matches', require('./routes/teamMatches'));
app.use('/api/import', require('./routes/importHoldkamp'));
app.use('/api/backup', require('./routes/backup'));

app.use(notFoundHandler);
app.use(errorHandler);

// Venter på databasen er klar — retrier med eksponentiel backoff
async function waitForDatabase(maxRetries = 10, initialDelayMs = 2000) {
    const db = require('./config/database');
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            await db.query('SELECT 1');
            return;
        } catch (error) {
            if (attempt === maxRetries) throw error;
            const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt - 1), 15000);
            console.log(`⏳ Database ikke klar (forsøg ${attempt}/${maxRetries}) — prøver igen om ${Math.round(delay / 1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

const server = app.listen(PORT, '0.0.0.0', async () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`✓ APP_DOMAIN: ${process.env.APP_DOMAIN || '(ikke sat — lokal mode)'}`);
    console.log(`✓ Health check: http://localhost:${PORT}/health`);

    try {
        await waitForDatabase();
        console.log('✓ Database connection successful');

        const masterDb = require('./config/masterDatabase');
        await masterDb.initialize();

        const { runMigrationsForAllDatabases } = require('./config/migrationRunner');
        await runMigrationsForAllDatabases();

        startMidnightReset();
        startExpirationCheck();
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
    }
});

const gracefulShutdown = async (signal) => {
    console.log(`${signal} signal received: starting graceful shutdown`);
    server.close(async () => {
        console.log('✓ HTTP server closed');
        try {
            const { closeAll } = require('./config/tenantPools');
            await closeAll();
            console.log('✓ Database pools lukket');
        } catch (error) {
            console.error('✗ Fejl ved lukning af database pools:', error);
        }
        console.log('✓ Graceful shutdown complete');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('✗ Graceful shutdown timeout, forcing exit');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
