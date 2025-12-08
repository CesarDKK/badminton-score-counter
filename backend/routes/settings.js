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

        res.json({
            courtCount: parseInt(courtCountSetting?.setting_value || '4')
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

module.exports = router;
