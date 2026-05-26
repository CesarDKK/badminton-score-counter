const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
const LOGO_DIR = path.join(UPLOAD_DIR, 'logos');

if (!fs.existsSync(LOGO_DIR)) {
  fs.mkdirSync(LOGO_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, LOGO_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '') || '.png';
    const teamId = req.params.id;
    cb(null, `team_${teamId}_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|svg\+xml|gif)$/.test(file.mimetype)) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.put('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    await pool.query('UPDATE teams SET name = ? WHERE id = ?', [name, id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('update team', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.post('/:id/logo', requireAdmin, upload.single('logo'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const [[existing]] = await pool.query('SELECT logo_path FROM teams WHERE id = ?', [id]);
    if (existing && existing.logo_path) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    const relPath = `logos/${req.file.filename}`;
    await pool.query('UPDATE teams SET logo_path = ? WHERE id = ?', [relPath, id]);
    res.json({ ok: true, logo_path: relPath });
  } catch (err) {
    console.error('upload logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/:id/logo', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [[existing]] = await pool.query('SELECT logo_path FROM teams WHERE id = ?', [id]);
    if (existing && existing.logo_path) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    await pool.query('UPDATE teams SET logo_path = NULL WHERE id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('delete logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
