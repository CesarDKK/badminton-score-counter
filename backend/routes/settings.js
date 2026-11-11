const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { requirePage } = require('../middleware/pagePermission');
const { publishConfigChange } = require('../events/gameStateEvents');
const { nedsaettelseAfvist, MAKS_BANER } = require('../config/baner');

// Efter enhver vellykket settings-mutation pushes et config-event, så TV/
// oversigt henter de nye værdier straks. Tema-ændringer får scope 'theme'
// (så tema-loaderen kan gen-anvende farverne), resten 'settings'. Kodeord-
// ændringen pusher også, men det er harmløst (skærmene henter blot settings).
router.use((req, res, next) => {
    if (req.method !== 'GET') {
        res.on('finish', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                publishConfigChange(req, req.path === '/theme' ? 'theme' : 'settings');
            }
        });
    }
    next();
});

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

        const defaultGameModeSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['default_game_mode']
        );

        const hideTvQrSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['hide_tv_qr']
        );

        const urTaellingSetting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['ur_taelling']
        );

        res.json({
            courtCount: parseInt(courtCountSetting?.setting_value || '4'),
            showResetButton: showResetButtonSetting?.setting_value !== 'false',
            defaultGameMode: defaultGameModeSetting?.setting_value || '15',
            hideTvQr: hideTvQrSetting?.setting_value === 'true',
            urTaelling: urTaellingSetting?.setting_value === 'true'
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/password - Change admin password (requires auth)
router.put('/password', authMiddleware, requirePage('settings'), async (req, res, next) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
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
router.put('/court-count', authMiddleware, requirePage('settings'), async (req, res, next) => {
    try {
        const courtCount = Number(req.body.courtCount);

        if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > MAKS_BANER) {
            return res.status(400).json({ error: 'Antal baner skal være mellem 1 og 20' });
        }

        // En bane, der skjules, må ikke være i brug: en kamp i gang, en aktiv
        // delkamp fra en holdkamp eller en aktiv turneringskamp ville ellers
        // forsvinde fra tabletten, TV'et og oversigten midt i spillet.
        const optaget = [
            ...(await query(
                `SELECT c.court_number, 'kamp i gang' AS grund
                   FROM courts c JOIN game_states gs ON gs.court_id = c.id
                  WHERE c.court_number > ? AND gs.match_completed = FALSE
                    AND (gs.match_start_time IS NOT NULL
                         OR gs.player1_score > 0 OR gs.player2_score > 0
                         OR gs.player1_games > 0 OR gs.player2_games > 0 OR gs.timer_seconds > 0)`,
                [courtCount])),
            ...(await query(
                `SELECT g.court_number, 'delkamp fra en holdkamp' AS grund
                   FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
                  WHERE g.court_number > ? AND g.status = 'active' AND tm.status = 'active'`,
                [courtCount])),
            ...(await query(
                `SELECT m.court_number, 'turneringskamp' AS grund
                   FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
                  WHERE m.court_number > ? AND m.status = 'active' AND t.status = 'active'`,
                [courtCount]))
        ];
        const afvist = nedsaettelseAfvist(courtCount, optaget);
        if (afvist) return res.status(409).json({ error: afvist });

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

        // Baner ud over antallet SLETTES IKKE: match_history hænger på courts(id)
        // med ON DELETE CASCADE, så sletningen tog hele banens kamphistorik med
        // sig. Rækkerne bliver liggende og skjules af court_count (se
        // config/baner.js), og de kommer tilbage, når antallet hæves igen.
        // Kun banens øjebliksbillede ryddes, så den kommer tilbage som en tom
        // bane — som en ny række gjorde før — i stedet for med en gammel stilling.
        await query(
            `DELETE gs FROM game_states gs JOIN courts c ON c.id = gs.court_id WHERE c.court_number > ?`,
            [courtCount]);
        await query(
            `DELETE lf FROM last_finished_matches lf JOIN courts c ON c.id = lf.court_id WHERE c.court_number > ?`,
            [courtCount]);
        await query('UPDATE courts SET is_active = FALSE WHERE court_number > ?', [courtCount]);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/reset-button - Toggle reset button visibility (requires auth)
router.put('/reset-button', authMiddleware, requirePage('settings'), async (req, res, next) => {
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

// PUT /api/settings/tv-qr - Skjul/vis QR-kode på TV-siden (requires auth)
router.put('/tv-qr', authMiddleware, requirePage('settings'), async (req, res, next) => {
    try {
        const { hideTvQr } = req.body;
        if (typeof hideTvQr !== 'boolean') {
            return res.status(400).json({ error: 'hideTvQr skal være true eller false' });
        }
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['hide_tv_qr', hideTvQr.toString(), hideTvQr.toString()]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/ur-taelling - Tæl fra uret: ur-koden vises på TV'et under
// QR-koden, og uret kan koble sig på med den (routes/urTaeller.js)
router.put('/ur-taelling', authMiddleware, requirePage('settings'), async (req, res, next) => {
    try {
        const { urTaelling } = req.body;
        if (typeof urTaelling !== 'boolean') {
            return res.status(400).json({ error: 'urTaelling skal være true eller false' });
        }
        await query(
            'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['ur_taelling', urTaelling.toString(), urTaelling.toString()]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/settings/game-mode - Update default game mode (requires auth)
router.put('/game-mode', authMiddleware, requirePage('settings'), async (req, res, next) => {
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
router.put('/theme', authMiddleware, requirePage('settings'), async (req, res, next) => {
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
