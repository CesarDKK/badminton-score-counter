const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { signClubAdminToken, requireAdmin } = require('../middleware/auth');
const { requireClub } = require('../middleware/tenant');

const router = express.Router();

// POST /api/auth/login — body: { username, password }
// Kræver at request kommer fra et klub-subdomain (req.clubId sat af tenant middleware).
router.post('/login', requireClub, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username og password er påkrævet' });
  }

  try {
    const [rows] = await pool.query(
      'SELECT id, password_hash FROM football_club_admins WHERE club_id = ? AND username = ? LIMIT 1',
      [req.clubId, username]
    );
    const admin = rows[0];

    if (!admin) {
      return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
    }

    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
    }

    const token = signClubAdminToken({
      adminId: admin.id,
      clubId: req.clubId,
      clubSubdomain: req.clubSubdomain,
    });
    res.json({ token, club: { name: req.clubName, subdomain: req.clubSubdomain } });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// GET /api/auth/club-info — public, returnerer aktuel klub-kontekst.
// Bruges af frontend til at vise klubnavn i header på public + admin views.
router.get('/club-info', (req, res) => {
  if (!req.clubId) {
    return res.json({ club: null });
  }
  res.json({
    club: {
      id: req.clubId,
      name: req.clubName,
      subdomain: req.clubSubdomain,
    },
  });
});

// GET /api/auth/me — beskyttet, returnerer admin-info for indlogget bruger
router.get('/me', requireAdmin, (req, res) => {
  res.json({
    admin: {
      id: req.admin.adminId,
      clubId: req.admin.clubId,
      clubSubdomain: req.admin.clubSubdomain,
    },
  });
});

module.exports = router;
