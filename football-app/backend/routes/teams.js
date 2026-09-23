const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { requireClub } = require('../middleware/tenant');
const { billedFilter, tjekUploadetBillede, endelseFraType, erGyldigtBillede } = require('../utils/billedUpload');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

function clubLogoDir(clubId) {
  const dir = path.join(UPLOAD_DIR, 'clubs', String(clubId), 'logos');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!req.clubId) return cb(new Error('Klub-kontekst mangler'));
    cb(null, clubLogoDir(req.clubId));
  },
  // Endelsen udledes af typen, ikke af klientens filnavn (utils/billedUpload.js)
  filename: (req, file, cb) => {
    cb(null, `team_${req.params.id}_${Date.now()}${endelseFraType(file.mimetype)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: billedFilter,
});

const router = express.Router();

router.put('/:id', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const [result] = await pool.query(
      'UPDATE teams SET name = ? WHERE id = ? AND club_id = ?',
      [name, id, req.clubId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('update team', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Kun filer fra holdets egen upload-mappe må slettes fra disken —
// biblioteks-logoer og flag er delte og må ALDRIG unlinkes her.
function isTeamOwnUpload(logoPath, clubId) {
  return typeof logoPath === 'string' && logoPath.startsWith(`clubs/${clubId}/logos/`);
}

router.post('/:id/logo', requireClub, requireAdmin, upload.single('logo'), tjekUploadetBillede, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const [[existing]] = await pool.query(
      'SELECT logo_path FROM teams WHERE id = ? AND club_id = ?',
      [id, req.clubId]
    );
    if (!existing) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: 'Team not found' });
    }
    if (isTeamOwnUpload(existing.logo_path, req.clubId)) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    const relPath = `clubs/${req.clubId}/logos/${req.file.filename}`;
    await pool.query(
      'UPDATE teams SET logo_path = ? WHERE id = ? AND club_id = ?',
      [relPath, id, req.clubId]
    );
    res.json({ ok: true, logo_path: relPath });
  } catch (err) {
    console.error('upload logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/teams/:id/logo — tildel logo fra biblioteket (uden upload).
// Specialværdier: logoPath = null → automatisk match på holdnavn,
// logoPath = 'none' → tvunget intet logo (vis initial).
router.put('/:id/logo', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { logoPath } = req.body || {};
  const isAuto = logoPath === null || logoPath === '';
  const isNone = logoPath === 'none';
  if (!isAuto && !isNone && (!logoPath || typeof logoPath !== 'string')) {
    return res.status(400).json({ error: 'logoPath er påkrævet' });
  }
  try {
    if (!isAuto && !isNone) {
      const [[logo]] = await pool.query(
        'SELECT id FROM football_logos WHERE url = ? AND (club_id = ? OR club_id IS NULL) LIMIT 1',
        [logoPath, req.clubId]
      );
      if (!logo) {
        return res.status(404).json({ error: 'Logo ikke fundet i biblioteket' });
      }
    }
    const newValue = isAuto ? null : (isNone ? 'none' : logoPath);
    const [result] = await pool.query(
      'UPDATE teams SET logo_path = ? WHERE id = ? AND club_id = ?',
      [newValue, id, req.clubId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ ok: true, logo_path: newValue });
  } catch (err) {
    console.error('assign team logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

router.delete('/:id/logo', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [[existing]] = await pool.query(
      'SELECT logo_path FROM teams WHERE id = ? AND club_id = ?',
      [id, req.clubId]
    );
    if (existing && isTeamOwnUpload(existing.logo_path, req.clubId)) {
      const oldPath = path.join(UPLOAD_DIR, existing.logo_path);
      fs.promises.unlink(oldPath).catch(() => {});
    }
    await pool.query(
      'UPDATE teams SET logo_path = NULL WHERE id = ? AND club_id = ?',
      [id, req.clubId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('delete logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
