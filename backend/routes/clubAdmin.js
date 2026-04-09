const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../config/database');
const { clubAdminAuth, generateClubAdminToken } = require('../middleware/clubAdminAuth');

// POST /api/club-admin/login
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }

        // query() bruger automatisk den rigtige klub-database via tenant middleware
        const admin = await queryOne(
            'SELECT id, username, password_hash FROM club_admins WHERE username = ?',
            [username]
        );

        if (!admin) {
            return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
        }

        const isValid = await bcrypt.compare(password, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
        }

        const token = generateClubAdminToken(admin.id, admin.username, req.clubSubdomain);
        res.json({ success: true, token });
    } catch (error) {
        next(error);
    }
});

// PUT /api/club-admin/password — skift adgangskode
router.put('/password', clubAdminAuth, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Nuværende og ny adgangskode er påkrævet' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Ny adgangskode skal være mindst 8 tegn' });
        }

        const admin = await queryOne(
            'SELECT id, password_hash FROM club_admins WHERE id = ?',
            [req.clubAdmin.id]
        );

        const isValid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Nuværende adgangskode er forkert' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await query('UPDATE club_admins SET password_hash = ? WHERE id = ?', [newHash, admin.id]);

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
