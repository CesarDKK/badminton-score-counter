const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/courts - Get all courts (public)
router.get('/', async (req, res, next) => {
    try {
        const courts = await query(
            'SELECT id, court_number, is_active, is_doubles, game_mode, created_at, updated_at FROM courts ORDER BY court_number'
        );

        // Convert MySQL booleans (0/1) to JavaScript booleans (true/false)
        const courtsWithBooleans = courts.map(court => ({
            ...court,
            is_active: !!court.is_active,
            is_doubles: !!court.is_doubles
        }));

        res.json(courtsWithBooleans);
    } catch (error) {
        next(error);
    }
});

// GET /api/courts/:id - Get specific court (public)
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const court = await queryOne(
            'SELECT id, court_number, is_active, is_doubles, game_mode, created_at, updated_at FROM courts WHERE court_number = ?',
            [id]
        );

        if (!court) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        // Convert MySQL booleans (0/1) to JavaScript booleans (true/false)
        res.json({
            ...court,
            is_active: !!court.is_active,
            is_doubles: !!court.is_doubles
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/courts/:id - Update court settings (requires auth)
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { isActive, isDoubles, gameMode } = req.body;

        // Validate inputs
        if (typeof isActive !== 'boolean' && isActive !== undefined) {
            return res.status(400).json({ error: 'isActive skal være boolean' });
        }

        if (typeof isDoubles !== 'boolean' && isDoubles !== undefined) {
            return res.status(400).json({ error: 'isDoubles skal være boolean' });
        }

        if (gameMode && !['15', '21'].includes(gameMode)) {
            return res.status(400).json({ error: 'gameMode skal være "15" eller "21"' });
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (isActive !== undefined) {
            updates.push('is_active = ?');
            values.push(isActive);
        }

        if (isDoubles !== undefined) {
            updates.push('is_doubles = ?');
            values.push(isDoubles);
        }

        if (gameMode !== undefined) {
            updates.push('game_mode = ?');
            values.push(gameMode);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'Ingen opdateringer angivet' });
        }

        values.push(id);

        // Update court using court_number
        const result = await query(
            `UPDATE courts SET ${updates.join(', ')} WHERE court_number = ?`,
            values
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
