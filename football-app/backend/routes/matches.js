const express = require('express');
const { pool, withTransaction } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { tryAdvanceToCups, advanceCupWinner } = require('../utils/advancement');

const router = express.Router();

router.put('/pool-matches/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { home_score, away_score, clear } = req.body || {};

  try {
    await withTransaction(async (conn) => {
      if (clear) {
        await conn.query(
          `UPDATE pool_matches
              SET home_score = NULL, away_score = NULL, played = FALSE, played_at = NULL
            WHERE id = ?`,
          [id]
        );
      } else {
        if (!Number.isInteger(home_score) || !Number.isInteger(away_score)
            || home_score < 0 || away_score < 0) {
          const err = new Error('Scores must be non-negative integers');
          err.status = 400;
          throw err;
        }
        await conn.query(
          `UPDATE pool_matches
              SET home_score = ?, away_score = ?, played = TRUE, played_at = NOW()
            WHERE id = ?`,
          [home_score, away_score, id]
        );
      }

      const [[m]] = await conn.query('SELECT pool_id FROM pool_matches WHERE id = ?', [id]);
      if (m) {
        const [[p]] = await conn.query('SELECT tournament_id FROM pools WHERE id = ?', [m.pool_id]);
        if (p) {
          const [[t]] = await conn.query('SELECT status FROM tournaments WHERE id = ?', [p.tournament_id]);
          if (t && t.status === 'setup') {
            await conn.query("UPDATE tournaments SET status = 'pool_stage' WHERE id = ?", [p.tournament_id]);
          }
          await tryAdvanceToCups(conn, p.tournament_id);
        }
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('update pool match', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
});

router.put('/cup-matches/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { home_score, away_score, clear } = req.body || {};

  try {
    await withTransaction(async (conn) => {
      if (clear) {
        await conn.query(
          `UPDATE cup_matches
              SET home_score = NULL, away_score = NULL, played = FALSE, played_at = NULL
            WHERE id = ?`,
          [id]
        );
      } else {
        if (!Number.isInteger(home_score) || !Number.isInteger(away_score)
            || home_score < 0 || away_score < 0) {
          const err = new Error('Scores must be non-negative integers');
          err.status = 400;
          throw err;
        }
        if (home_score === away_score) {
          const err = new Error('Cup matches cannot end in a draw');
          err.status = 400;
          throw err;
        }
        await conn.query(
          `UPDATE cup_matches
              SET home_score = ?, away_score = ?, played = TRUE, played_at = NOW()
            WHERE id = ?`,
          [home_score, away_score, id]
        );
        await advanceCupWinner(conn, id);
      }
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('update cup match', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  }
});

module.exports = router;
