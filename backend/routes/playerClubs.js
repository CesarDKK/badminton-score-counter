const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

// GET /api/player-clubs — samlet navn->klub (offentlig).
// Union af player_info og tournament_player_clubs. Ved navnekonflikt vinder
// player_info (manuelt kurateret).
router.get('/', async (req, res, next) => {
    try {
        const [info, tpc] = await Promise.all([
            query('SELECT name, club FROM player_info'),
            query('SELECT player_name AS name, club FROM tournament_player_clubs')
        ]);
        const byName = new Map();
        for (const r of tpc) if (r.name && r.club) byName.set(r.name, r.club);
        for (const r of info) if (r.name && r.club) byName.set(r.name, r.club); // player_info vinder
        res.json([...byName.entries()].map(([name, club]) => ({ name, club })));
    } catch (error) { next(error); }
});

module.exports = router;
