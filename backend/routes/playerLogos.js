const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/player-logos — alle spiller-logo overrides (offentlig)
router.get('/', async (req, res, next) => {
    try {
        const rows = await query('SELECT player_name, logo_id FROM player_logos');
        res.json(rows);
    } catch (error) { next(error); }
});

// PUT /api/player-logos — upsert override for et spillernavn (auth)
router.put('/', authMiddleware, async (req, res, next) => {
    try {
        const playerName = (req.body.playerName || '').trim();
        const logoId = parseInt(req.body.logoId, 10);
        if (!playerName) return res.status(400).json({ error: 'Spillernavn er påkrævet' });
        if (!logoId) return res.status(400).json({ error: 'logoId er påkrævet' });

        await query(
            `INSERT INTO player_logos (player_name, logo_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE logo_id = VALUES(logo_id)`,
            [playerName, logoId]
        );
        res.json({ success: true });
    } catch (error) { next(error); }
});

// DELETE /api/player-logos?name=<navn> — fjern override (auth)
router.delete('/', authMiddleware, async (req, res, next) => {
    try {
        const playerName = (req.query.name || '').trim();
        if (!playerName) return res.status(400).json({ error: 'Spillernavn er påkrævet' });
        await query('DELETE FROM player_logos WHERE player_name = ?', [playerName]);
        res.json({ success: true });
    } catch (error) { next(error); }
});

module.exports = router;
