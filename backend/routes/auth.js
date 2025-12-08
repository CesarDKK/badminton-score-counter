const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../config/database');
const { generateToken } = require('../middleware/auth');

// POST /api/auth/login - Verify password and return JWT token
router.post('/login', async (req, res, next) => {
    try {
        const { password } = req.body;

        if (!password) {
            return res.status(400).json({ error: 'Adgangskode er påkrævet' });
        }

        // Get password hash from database
        const setting = await queryOne(
            'SELECT setting_value FROM settings WHERE setting_key = ?',
            ['admin_password_hash']
        );

        if (!setting) {
            return res.status(500).json({ error: 'Konfigurationsfejl' });
        }

        // Compare password with hash
        const isValid = await bcrypt.compare(password, setting.setting_value);

        if (!isValid) {
            return res.status(401).json({ error: 'Forkert adgangskode' });
        }

        // Generate JWT token
        const token = generateToken({ admin: true });

        res.json({
            success: true,
            token: token
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
