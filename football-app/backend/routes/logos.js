const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { requireClub } = require('../middleware/tenant');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

function clubLogosLibDir(clubId) {
  const dir = path.join(UPLOAD_DIR, 'clubs', String(clubId), 'logos-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!req.clubId) return cb(new Error('Klub-kontekst mangler'));
    cb(null, clubLogosLibDir(req.clubId));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    const slug = (req.body.name || 'logo')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 40) || 'logo';
    cb(null, `${slug}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.mimetype)) {
      return cb(new Error('Kun billedfiler er tilladt'));
    }
    cb(null, true);
  },
});

const router = express.Router();

// GET /api/logos — list logoer tilgængelige for aktuel klub.
// Returnerer både klub-egne + globale (flag/sponsor med club_id=NULL).
// Query params: kind (filter), search (substring i name)
router.get('/', requireClub, async (req, res) => {
  const { kind, search } = req.query;
  const filters = ['(club_id = ? OR club_id IS NULL)'];
  const params = [req.clubId];
  if (kind) {
    filters.push('kind = ?');
    params.push(kind);
  }
  if (search) {
    filters.push('name LIKE ?');
    params.push(`%${search}%`);
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, club_id, name, url, kind, created_at
         FROM football_logos
        WHERE ${filters.join(' AND ')}
        ORDER BY kind ASC, name ASC
        LIMIT 1000`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error('list logos', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// POST /api/logos — upload nyt klub-logo til biblioteket
// Form: { name } + fil i 'logo'-felt. Kind defaultes til 'club'.
router.post('/', requireClub, requireAdmin, upload.single('logo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Ingen fil uploadet' });
  const name = (req.body.name || '').trim();
  const kind = req.body.kind || 'club';
  if (!name) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Navn er påkrævet' });
  }
  if (!['club', 'sponsor', 'other'].includes(kind)) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Ugyldig kind — flag kan ikke uploades manuelt' });
  }
  try {
    const url = `clubs/${req.clubId}/logos-library/${req.file.filename}`;
    const [result] = await pool.query(
      'INSERT INTO football_logos (club_id, name, url, kind) VALUES (?, ?, ?, ?)',
      [req.clubId, name, url, kind]
    );
    const [[logo]] = await pool.query(
      'SELECT id, club_id, name, url, kind, created_at FROM football_logos WHERE id = ?',
      [result.insertId]
    );
    res.json(logo);
  } catch (err) {
    console.error('upload logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/logos/:id — omdøb klub-eget logo
router.put('/:id', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Navn er påkrævet' });
  try {
    // Kun klub-egne logoer kan omdøbes — ikke globale flag
    const [result] = await pool.query(
      'UPDATE football_logos SET name = ? WHERE id = ? AND club_id = ?',
      [name, id, req.clubId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Logo ikke fundet (eller globalt logo — kan ikke omdøbes)' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('rename logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// DELETE /api/logos/:id — slet klub-eget logo + ryd referencer fra teams/tournaments
router.delete('/:id', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [[logo]] = await pool.query(
      'SELECT id, club_id, url FROM football_logos WHERE id = ?',
      [id]
    );
    if (!logo) return res.status(404).json({ error: 'Logo ikke fundet' });
    if (logo.club_id === null) {
      return res.status(403).json({ error: 'Globale flag kan ikke slettes' });
    }
    if (logo.club_id !== req.clubId) {
      return res.status(403).json({ error: 'Logo tilhører en anden klub' });
    }

    // Nullify referencer i teams + tournaments der peger på dette URL
    await pool.query(
      'UPDATE teams SET logo_path = NULL WHERE logo_path = ? AND club_id = ?',
      [logo.url, req.clubId]
    );
    await pool.query(
      'UPDATE tournaments SET logo_path = NULL WHERE logo_path = ? AND club_id = ?',
      [logo.url, req.clubId]
    );

    // Slet fil og DB-row
    const filePath = path.join(UPLOAD_DIR, logo.url);
    fs.promises.unlink(filePath).catch(() => {});
    await pool.query('DELETE FROM football_logos WHERE id = ?', [id]);

    res.json({ ok: true });
  } catch (err) {
    console.error('delete logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
