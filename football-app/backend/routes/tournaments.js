const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool, withTransaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { generateRoundRobin, computeStandings } = require('../utils/standings');
const { buildBracketStructure, buildSeedsFromConfig } = require('../utils/bracket');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
const LOGO_DIR = path.join(UPLOAD_DIR, 'logos');
if (!fs.existsSync(LOGO_DIR)) fs.mkdirSync(LOGO_DIR, { recursive: true });

const tournamentLogoUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, LOGO_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
      cb(null, `tournament_${req.params.id}_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, logo_path, status, num_pools, teams_per_pool, created_at
         FROM tournaments
        ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('list tournaments', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[tournament]] = await pool.query('SELECT * FROM tournaments WHERE id = ?', [id]);
    if (!tournament) return res.status(404).json({ error: 'Not found' });

    const [pools] = await pool.query(
      'SELECT id, name, pool_index FROM pools WHERE tournament_id = ? ORDER BY pool_index',
      [id]
    );
    const poolIds = pools.map((p) => p.id);
    const teams = poolIds.length
      ? (await pool.query(
          'SELECT id, pool_id, name, logo_path, team_index FROM teams WHERE pool_id IN (?) ORDER BY team_index',
          [poolIds]
        ))[0]
      : [];
    const cups = (await pool.query(
      'SELECT id, name, cup_index, source_placements, total_teams FROM cups WHERE tournament_id = ? ORDER BY cup_index',
      [id]
    ))[0];

    res.json({ tournament, pools, teams, cups });
  } catch (err) {
    console.error('get tournament', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/', requireAdmin, async (req, res) => {
  const { name, num_pools, pools: poolsInput, cups: cupsInput, points_win, points_draw, points_loss } = req.body || {};
  if (!name || !Array.isArray(poolsInput) || poolsInput.length === 0) {
    return res.status(400).json({ error: 'Missing name or pools' });
  }
  if (!Array.isArray(cupsInput)) {
    return res.status(400).json({ error: 'Cups configuration required (can be empty array)' });
  }

  try {
    const result = await withTransaction(async (conn) => {
      const teamsPerPool = poolsInput[0].teams.length;
      const [tRes] = await conn.query(
        `INSERT INTO tournaments (name, num_pools, teams_per_pool, points_win, points_draw, points_loss)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          name,
          num_pools || poolsInput.length,
          teamsPerPool,
          points_win ?? 3,
          points_draw ?? 1,
          points_loss ?? 0,
        ]
      );
      const tournamentId = tRes.insertId;

      for (let pi = 0; pi < poolsInput.length; pi += 1) {
        const poolDef = poolsInput[pi];
        const poolName = poolDef.name || `Pool ${String.fromCharCode(65 + pi)}`;
        const [pRes] = await conn.query(
          'INSERT INTO pools (tournament_id, name, pool_index) VALUES (?, ?, ?)',
          [tournamentId, poolName, pi]
        );
        const poolId = pRes.insertId;

        const insertedTeams = [];
        for (let ti = 0; ti < poolDef.teams.length; ti += 1) {
          const teamName = poolDef.teams[ti].name || `Team ${ti + 1}`;
          const [teamRes] = await conn.query(
            'INSERT INTO teams (pool_id, name, team_index) VALUES (?, ?, ?)',
            [poolId, teamName, ti]
          );
          insertedTeams.push({ id: teamRes.insertId, name: teamName });
        }

        const matches = generateRoundRobin(insertedTeams);
        for (const m of matches) {
          await conn.query(
            `INSERT INTO pool_matches (pool_id, match_order, home_team_id, away_team_id)
             VALUES (?, ?, ?, ?)`,
            [poolId, m.match_order, m.home_team_id, m.away_team_id]
          );
        }
      }

      for (let ci = 0; ci < cupsInput.length; ci += 1) {
        const cup = cupsInput[ci];
        const placements = Array.isArray(cup.source_placements) ? cup.source_placements : [];
        if (placements.length === 0) continue;
        const totalTeams = placements.length * poolsInput.length;
        const [cRes] = await conn.query(
          `INSERT INTO cups (tournament_id, name, cup_index, source_placements, total_teams)
           VALUES (?, ?, ?, ?, ?)`,
          [tournamentId, cup.name || `Cup ${ci + 1}`, ci, JSON.stringify(placements), totalTeams]
        );
        const cupId = cRes.insertId;

        const seeds = buildSeedsFromConfig({ source_placements: placements }, poolsInput.length);
        const structure = buildBracketStructure(seeds);

        const matchIdsByRound = [];
        for (let r = 0; r < structure.length; r += 1) {
          const round = structure[r];
          const ids = [];
          for (const m of round) {
            const [mRes] = await conn.query(
              `INSERT INTO cup_matches (cup_id, round, bracket_position, home_seed, away_seed)
               VALUES (?, ?, ?, ?, ?)`,
              [
                cupId,
                r + 1,
                m.bracket_position,
                m.home_seed ? JSON.stringify(m.home_seed) : null,
                m.away_seed ? JSON.stringify(m.away_seed) : null,
              ]
            );
            ids.push(mRes.insertId);
          }
          matchIdsByRound.push(ids);
        }

        for (let r = 0; r < matchIdsByRound.length - 1; r += 1) {
          const current = matchIdsByRound[r];
          const next = matchIdsByRound[r + 1];
          for (let i = 0; i < current.length; i += 1) {
            const nextIdx = Math.floor(i / 2);
            const slot = i % 2 === 0 ? 'home' : 'away';
            await conn.query(
              'UPDATE cup_matches SET next_match_id = ?, next_match_slot = ? WHERE id = ?',
              [next[nextIdx], slot, current[i]]
            );
          }
        }
      }

      return { id: tournamentId };
    });

    res.status(201).json(result);
  } catch (err) {
    console.error('create tournament', err);
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM tournaments WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete tournament', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/:id/standings', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [[tournament]] = await pool.query('SELECT * FROM tournaments WHERE id = ?', [id]);
    if (!tournament) return res.status(404).json({ error: 'Not found' });

    const [pools] = await pool.query(
      'SELECT id, name, pool_index FROM pools WHERE tournament_id = ? ORDER BY pool_index',
      [id]
    );
    const poolIds = pools.map((p) => p.id);
    const allTeams = poolIds.length
      ? (await pool.query(
          'SELECT id, pool_id, name, logo_path, team_index FROM teams WHERE pool_id IN (?)',
          [poolIds]
        ))[0]
      : [];
    const allMatches = poolIds.length
      ? (await pool.query(
          'SELECT * FROM pool_matches WHERE pool_id IN (?)',
          [poolIds]
        ))[0]
      : [];

    const result = pools.map((p) => {
      const teams = allTeams.filter((t) => t.pool_id === p.id);
      const matches = allMatches.filter((m) => m.pool_id === p.id);
      const standings = computeStandings(teams, matches, tournament);
      const allPlayed = matches.length > 0 && matches.every((m) => m.played);
      return { pool: p, standings, matches, all_played: allPlayed };
    });

    res.json(result);
  } catch (err) {
    console.error('standings', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.get('/:id/cups', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [cups] = await pool.query(
      'SELECT id, name, cup_index, source_placements, total_teams FROM cups WHERE tournament_id = ? ORDER BY cup_index',
      [id]
    );
    const cupIds = cups.map((c) => c.id);
    const matches = cupIds.length
      ? (await pool.query(
          'SELECT * FROM cup_matches WHERE cup_id IN (?) ORDER BY round, bracket_position',
          [cupIds]
        ))[0]
      : [];
    const teamIds = new Set();
    matches.forEach((m) => {
      if (m.home_team_id) teamIds.add(m.home_team_id);
      if (m.away_team_id) teamIds.add(m.away_team_id);
    });
    const teams = teamIds.size
      ? (await pool.query(
          'SELECT id, name, logo_path FROM teams WHERE id IN (?)',
          [Array.from(teamIds)]
        ))[0]
      : [];
    const teamMap = new Map(teams.map((t) => [t.id, t]));

    const result = cups.map((c) => {
      const cupMatches = matches
        .filter((m) => m.cup_id === c.id)
        .map((m) => ({
          ...m,
          home_team: m.home_team_id ? teamMap.get(m.home_team_id) : null,
          away_team: m.away_team_id ? teamMap.get(m.away_team_id) : null,
        }));
      return { cup: c, matches: cupMatches };
    });

    res.json(result);
  } catch (err) {
    console.error('cups', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/:id/logo', requireAdmin, tournamentLogoUpload.single('logo'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const [[existing]] = await pool.query('SELECT logo_path FROM tournaments WHERE id = ?', [id]);
    if (existing && existing.logo_path) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    const relPath = `logos/${req.file.filename}`;
    await pool.query('UPDATE tournaments SET logo_path = ? WHERE id = ?', [relPath, id]);
    res.json({ ok: true, logo_path: relPath });
  } catch (err) {
    console.error('upload tournament logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/:id/logo', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [[existing]] = await pool.query('SELECT logo_path FROM tournaments WHERE id = ?', [id]);
    if (existing && existing.logo_path) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    await pool.query('UPDATE tournaments SET logo_path = NULL WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete tournament logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
