const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/settings - Get all settings (public)
router.get('/', async (req, res, next) => {
    try {
        const courtCountSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['court_count']
        );

        const showResetButtonSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['show_reset_button']
        );

        const courtVersionSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['court_version']
        );

        const tvVersionSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['tv_version']
        );

        const defaultGameModeSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['default_game_mode']
        );

        res.json({
            courtCount: parseInt(courtCountSetting?.setting_value || '4'),
            showResetButton: showResetButtonSetting?.setting_value !== 'false',
            courtVersion: courtVersionSetting?.setting_value || 'v2',
            tvVersion: tvVersionSetting?.setting_value || 'v2',
            defaultGameMode: defaultGameModeSetting?.setting_value || '21'
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/password - Change admin password (requires auth)
router.put('/password', authMiddleware, async (req, res, next) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 4) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 4 tegn' });
        }

        // Hash new password
        const hash = await bcrypt.hash(newPassword, 10);

        // Update in database
        await query(
            'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
            [hash, 'admin_password_hash']
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/court-count - Update court count (requires auth)
router.put('/court-count', authMiddleware, async (req, res, next) => {
    try {
        const { courtCount } = req.body;

        if (!courtCount || courtCount < 1 || courtCount > 20) {
            return res.status(400).json({ error: 'Antal baner skal være mellem 1 og 20' });
        }

        // Update court count
        await query(
            'UPDATE settings SET setting_value = ? WHERE setting_key = ?',
            [courtCount.toString(), 'court_count']
        );

        // Get current courts
        const currentCourts = await query('SELECT court_number FROM courts ORDER BY court_number');
        const currentCourtNumbers = currentCourts.map(c => c.court_number);

        // Add new courts if needed
        for (let i = 1; i <= courtCount; i++) {
            if (!currentCourtNumbers.includes(i)) {
                await query('INSERT INTO courts (court_number) VALUES (?)', [i]);
            }
        }

        // Remove courts if needed (courts beyond courtCount)
        if (courtCount < currentCourts.length) {
            await query('DELETE FROM courts WHERE court_number > ?', [courtCount]);
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/reset-button - Toggle reset button visibility (requires auth)
router.put('/reset-button', authMiddleware, async (req, res, next) => {
    try {
        const { showResetButton } = req.body;

        if (typeof showResetButton !== 'boolean') {
            return res.status(400).json({ error: 'showResetButton skal være true eller false' });
        }

        // Update setting (insert if not exists)
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['show_reset_button', showResetButton.toString(), showResetButton.toString()]
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/court-version - Update court page version (requires auth)
router.put('/court-version', authMiddleware, async (req, res, next) => {
    try {
        const { courtVersion } = req.body;

        if (courtVersion !== 'v2' && courtVersion !== 'v3') {
            return res.status(400).json({ error: 'Court version skal være v2 eller v3' });
        }

        // Update setting (insert if not exists)
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['court_version', courtVersion, courtVersion]
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/tv-version - Update TV view version (requires auth)
router.put('/tv-version', authMiddleware, async (req, res, next) => {
    try {
        const { tvVersion } = req.body;

        // Validate input
        if (tvVersion !== 'v2' && tvVersion !== 'v3') {
            return res.status(400).json({
                error: 'TV version skal være v2 eller v3'
            });
        }

        // Update database
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['tv_version', tvVersion, tvVersion]
        );

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/game-mode - Update default game mode (requires auth)
router.put('/game-mode', authMiddleware, async (req, res, next) => {
    try {
        const { gameMode } = req.body;
        if (gameMode !== '21' && gameMode !== '15') {
            return res.status(400).json({ error: 'Ugyldig kamptilstand — brug "21" eller "15"' });
        }
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['default_game_mode', gameMode, gameMode]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// GET /api/settings/theme - Get theme colors (public)
router.get('/theme', async (req, res, next) => {
    try {
        const themeSettings = await query(
            'SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE "theme_%" OR setting_key LIKE "color_%"'
        );

        const theme = {};
        themeSettings.forEach(row => {
            theme[row.setting_key] = row.setting_value;
        });

        res.json(theme);
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/theme - Update theme colors (requires auth)
router.put('/theme', authMiddleware, async (req, res, next) => {
    try {
        const {
            themeName,
            colorPrimary,
            colorAccent,
            colorBgDark,
            colorBgContainer,
            colorBgCard
        } = req.body;

        // Validate hex colors
        const hexRegex = /^#[0-9A-Fa-f]{6}$/;
        const colors = [colorPrimary, colorAccent, colorBgDark, colorBgContainer, colorBgCard];

        if (!colors.every(color => hexRegex.test(color))) {
            return res.status(400).json({ error: 'Ugyldige farveværdier. Brug formatet #RRGGBB' });
        }

        // Update all color settings (insert if not exists)
        const updates = [
            ['theme_name', themeName],
            ['color_primary', colorPrimary],
            ['color_accent', colorAccent],
            ['color_bg_dark', colorBgDark],
            ['color_bg_container', colorBgContainer],
            ['color_bg_card', colorBgCard]
        ];

        for (const [key, value] of updates) {
            await query(
                'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, value]
            );
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
