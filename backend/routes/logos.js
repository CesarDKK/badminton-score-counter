const express = require('express');
const router = express.Router();
const masterDb = require('../config/masterDatabase');

// GET /api/logos — offentlig liste over centrale klub-logoer (master-DB)
router.get('/', async (req, res, next) => {
    try {
        const rows = await masterDb.query(
            `SELECT id, club_name, aliases, filename, width, height
             FROM club_logos ORDER BY club_name ASC`
        );
        res.json(rows.map(r => ({
            id: r.id,
            club_name: r.club_name,
            aliases: r.aliases,
            width: r.width,
            height: r.height,
            url: `/uploads/${r.filename}`
        })));
    } catch (error) { next(error); }
});

module.exports = router;
