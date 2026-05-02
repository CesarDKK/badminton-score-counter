const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { query, queryOne } = require('../config/database');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');

// Gyldige destinations — frontend sider en device token kan pege på.
// 'tv' og 'tv-v3' er legacy uden bane-nummer; 'tv/N' og 'court/N' bruges af
// det nuværende admin-UI og understøtter baner 1–20.
const VALID_DESTINATIONS = (() => {
    const list = ['oversigt', 'tv', 'tv-v3'];
    for (let i = 1; i <= 20; i++) {
        list.push(`tv/${i}`);
        list.push(`court/${i}`);
    }
    return list;
})();

// GET /t/:token — valider device token og returner JWT
// (dette endpoint bruges af frontend når tabletten åbner sit bogmærke-link)
router.get('/validate/:token', async (req, res, next) => {
    try {
        const deviceToken = await queryOne(
            'SELECT id, name, destination, locked FROM device_tokens WHERE token = ? AND is_active = 1',
            [req.params.token]
        );

        if (!deviceToken) {
            return res.status(401).json({ error: 'Ugyldigt eller deaktiveret adgangslink' });
        }

        // Opdater last_used_at
        await query(
            'UPDATE device_tokens SET last_used_at = NOW() WHERE id = ?',
            [deviceToken.id]
        );

        // Udsted et kortlivet JWT til denne session
        const sessionToken = jwt.sign(
            {
                role: 'device',
                tokenId: deviceToken.id,
                destination: deviceToken.destination,
                locked: deviceToken.locked,
                clubSubdomain: req.clubSubdomain
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            success: true,
            token: sessionToken,
            destination: deviceToken.destination,
            locked: deviceToken.locked
        });
    } catch (error) {
        next(error);
    }
});

// --- Klub admin endpoints (kræver club admin JWT) ---

// GET /api/device-tokens — list alle tokens for denne klub
router.get('/', clubAdminAuth, async (req, res, next) => {
    try {
        const tokens = await query(
            `SELECT id, token, name, destination, locked, show_qr_on_tv, is_active, created_at, last_used_at
             FROM device_tokens ORDER BY created_at DESC`
        );
        res.json(tokens);
    } catch (error) {
        next(error);
    }
});

// POST /api/device-tokens — opret nyt device token
router.post('/', clubAdminAuth, async (req, res, next) => {
    try {
        const { name, destination, locked, showQrOnTv } = req.body;

        if (!name || !destination) {
            return res.status(400).json({ error: 'Navn og destination er påkrævet' });
        }

        if (!VALID_DESTINATIONS.includes(destination)) {
            return res.status(400).json({
                error: 'Ugyldig destination',
                validDestinations: VALID_DESTINATIONS
            });
        }

        const token = crypto.randomBytes(32).toString('hex');
        // Default TRUE — matcher DB default så eksisterende flow bevares
        const qrFlag = showQrOnTv === undefined ? 1 : (showQrOnTv ? 1 : 0);

        const result = await query(
            'INSERT INTO device_tokens (token, name, destination, locked, show_qr_on_tv) VALUES (?, ?, ?, ?, ?)',
            [token, name, destination, locked ? 1 : 0, qrFlag]
        );

        const created = await queryOne(
            'SELECT id, token, name, destination, locked, show_qr_on_tv, is_active, created_at FROM device_tokens WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json(created);
    } catch (error) {
        next(error);
    }
});

// PUT /api/device-tokens/:id — opdater navn, destination, locked eller show_qr_on_tv
router.put('/:id', clubAdminAuth, async (req, res, next) => {
    try {
        const { name, destination, locked, showQrOnTv } = req.body;

        const existing = await queryOne('SELECT id FROM device_tokens WHERE id = ?', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ error: 'Token ikke fundet' });
        }

        if (destination && !VALID_DESTINATIONS.includes(destination)) {
            return res.status(400).json({ error: 'Ugyldig destination' });
        }

        await query(
            `UPDATE device_tokens
             SET name = COALESCE(?, name),
                 destination = COALESCE(?, destination),
                 locked = COALESCE(?, locked),
                 show_qr_on_tv = COALESCE(?, show_qr_on_tv)
             WHERE id = ?`,
            [
                name || null,
                destination || null,
                locked !== undefined ? (locked ? 1 : 0) : null,
                showQrOnTv !== undefined ? (showQrOnTv ? 1 : 0) : null,
                req.params.id
            ]
        );

        const updated = await queryOne(
            'SELECT id, token, name, destination, locked, show_qr_on_tv, is_active, created_at, last_used_at FROM device_tokens WHERE id = ?',
            [req.params.id]
        );

        res.json(updated);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/device-tokens/:id — deaktiver token (soft delete)
router.delete('/:id', clubAdminAuth, async (req, res, next) => {
    try {
        const existing = await queryOne('SELECT id FROM device_tokens WHERE id = ?', [req.params.id]);
        if (!existing) {
            return res.status(404).json({ error: 'Token ikke fundet' });
        }

        await query('UPDATE device_tokens SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/device-tokens/:id/permanent — slet token permanent (kun tilbagekaldte)
router.delete('/:id/permanent', clubAdminAuth, async (req, res, next) => {
    try {
        const existing = await queryOne(
            'SELECT id, is_active FROM device_tokens WHERE id = ?',
            [req.params.id]
        );
        if (!existing) {
            return res.status(404).json({ error: 'Token ikke fundet' });
        }
        if (existing.is_active) {
            return res.status(400).json({ error: 'Tilbagekald linket først inden det slettes permanent' });
        }
        await query('DELETE FROM device_tokens WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
