const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

// GET /api/player-info/search?q=searchTerm - Search players by name (public)
router.get('/search', async (req, res, next) => {
    try {
        const searchTerm = req.query.q || '';

        if (searchTerm.length < 1) {
            return res.json([]);
        }

        const players = await query(
            `SELECT id, name, club, gender, age_group
             FROM player_info
             WHERE name LIKE ?
             ORDER BY name ASC
             LIMIT 10`,
            [`%${searchTerm}%`]
        );

        res.json(players);
    } catch (error) {
        next(error);
    }
});

// GET /api/player-info - Get all players (public)
router.get('/', async (req, res, next) => {
    try {
        const players = await query(
            `SELECT id, name, club, gender, age_group, created_at, updated_at
             FROM player_info
             ORDER BY name ASC`
        );

        res.json(players);
    } catch (error) {
        next(error);
    }
});

// GET /api/player-info/:id - Get specific player (public)
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const player = await queryOne(
            `SELECT id, name, club, gender, age_group, created_at, updated_at
             FROM player_info
             WHERE id = ?`,
            [id]
        );

        if (!player) {
            return res.status(404).json({ error: 'Spiller ikke fundet' });
        }

        res.json(player);
    } catch (error) {
        next(error);
    }
});

// POST /api/player-info - Create new player (requires auth)
router.post('/', authMiddleware, async (req, res, next) => {
    try {
        const { name, club, gender, ageGroup } = req.body;

        // Validate input
        if (!name || !club || !gender || !ageGroup) {
            return res.status(400).json({ error: 'Navn, klub, køn og årgang er påkrævet' });
        }

        // Validate gender
        const validGenders = ['Herre', 'Dame'];
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Ugyldigt køn. Vælg mellem Herre eller Dame' });
        }

        // Validate age group
        const validAgeGroups = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'];
        if (!validAgeGroups.includes(ageGroup)) {
            return res.status(400).json({ error: 'Ugyldig årgang. Vælg mellem U9, U11, U13, U15, U17, U19' });
        }

        // Insert new player
        const result = await query(
            `INSERT INTO player_info (name, club, gender, age_group)
             VALUES (?, ?, ?, ?)`,
            [name, club, gender, ageGroup]
        );

        res.json({
            success: true,
            id: result.insertId,
            message: 'Spiller oprettet succesfuldt'
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/player-info/:id - Update player (requires auth)
router.put('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, club, gender, ageGroup } = req.body;

        // Validate input
        if (!name || !club || !gender || !ageGroup) {
            return res.status(400).json({ error: 'Navn, klub, køn og årgang er påkrævet' });
        }

        // Validate gender
        const validGenders = ['Herre', 'Dame'];
        if (!validGenders.includes(gender)) {
            return res.status(400).json({ error: 'Ugyldigt køn. Vælg mellem Herre eller Dame' });
        }

        // Validate age group
        const validAgeGroups = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'];
        if (!validAgeGroups.includes(ageGroup)) {
            return res.status(400).json({ error: 'Ugyldig årgang. Vælg mellem U9, U11, U13, U15, U17, U19' });
        }

        // Check if player exists
        const player = await queryOne('SELECT id FROM player_info WHERE id = ?', [id]);
        if (!player) {
            return res.status(404).json({ error: 'Spiller ikke fundet' });
        }

        // Update player
        await query(
            `UPDATE player_info
             SET name = ?, club = ?, gender = ?, age_group = ?
             WHERE id = ?`,
            [name, club, gender, ageGroup, id]
        );

        res.json({
            success: true,
            message: 'Spiller opdateret succesfuldt'
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/player-info/:id - Delete player (requires auth)
router.delete('/:id', authMiddleware, async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if player exists
        const player = await queryOne('SELECT id FROM player_info WHERE id = ?', [id]);
        if (!player) {
            return res.status(404).json({ error: 'Spiller ikke fundet' });
        }

        // Delete player
        await query('DELETE FROM player_info WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Spiller slettet succesfuldt'
        });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/player-info/age-group/:ageGroup - Delete all players in age group (requires auth)
router.delete('/age-group/:ageGroup', authMiddleware, async (req, res, next) => {
    try {
        const { ageGroup } = req.params;

        // Validate age group
        const validAgeGroups = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'];
        if (!validAgeGroups.includes(ageGroup)) {
            return res.status(400).json({ error: 'Ugyldig årgang' });
        }

        // Count players in this age group
        const countResult = await queryOne(
            'SELECT COUNT(*) as count FROM player_info WHERE age_group = ?',
            [ageGroup]
        );

        if (countResult.count === 0) {
            return res.status(404).json({ error: 'Ingen spillere fundet i denne årgang' });
        }

        // Delete all players in age group
        await query('DELETE FROM player_info WHERE age_group = ?', [ageGroup]);

        res.json({
            success: true,
            deletedCount: countResult.count,
            message: `${countResult.count} spiller(e) i ${ageGroup} slettet succesfuldt`
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/player-info/import - Import multiple players (requires auth)
router.post('/import', authMiddleware, async (req, res, next) => {
    try {
        const { players } = req.body;

        if (!Array.isArray(players) || players.length === 0) {
            return res.status(400).json({ error: 'Ingen spillere at importere' });
        }

        // Validate age groups and genders
        const validAgeGroups = ['U9', 'U11', 'U13', 'U15', 'U17', 'U19'];
        const validGenders = ['Herre', 'Dame'];

        let imported = 0;
        let skipped = 0;
        const errors = [];

        for (const player of players) {
            const { name, club, gender, ageGroup } = player;

            // Validate data
            if (!name || !club || !gender || !ageGroup) {
                skipped++;
                continue;
            }

            if (!validGenders.includes(gender)) {
                skipped++;
                errors.push(`Ugyldigt køn for ${name}: ${gender}`);
                continue;
            }

            if (!validAgeGroups.includes(ageGroup)) {
                skipped++;
                errors.push(`Ugyldig årgang for ${name}: ${ageGroup}`);
                continue;
            }

            // Check if player already exists (same name and age group)
            const existing = await queryOne(
                'SELECT id FROM player_info WHERE name = ? AND age_group = ?',
                [name, ageGroup]
            );

            if (existing) {
                skipped++;
                continue; // Skip duplicates
            }

            // Insert player
            try {
                await query(
                    'INSERT INTO player_info (name, club, gender, age_group) VALUES (?, ?, ?, ?)',
                    [name, club, gender, ageGroup]
                );
                imported++;
            } catch (err) {
                skipped++;
                errors.push(`Fejl ved import af ${name}: ${err.message}`);
            }
        }

        res.json({
            success: true,
            imported,
            skipped,
            total: players.length,
            message: `${imported} spillere importeret, ${skipped} sprunget over`,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
