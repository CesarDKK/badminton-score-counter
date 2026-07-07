const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { requireClub } = require('../middleware/tenant');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';

// TheSportsDB — gratis test-nøgle '123' virker for klubsøgning (30 kald/min).
// Sæt THESPORTSDB_KEY i miljøet for at bruge en premium-nøgle.
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || '123';
const THESPORTSDB_HOST_SUFFIX = 'thesportsdb.com';

function clubLogosLibDir(clubId) {
  const dir = path.join(UPLOAD_DIR, 'clubs', String(clubId), 'logos-library');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const CONTENT_TYPE_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
};

function slugify(s) {
  return (s || 'logo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 40) || 'logo';
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
    filters.push('(name LIKE ? OR aliases LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  try {
    const [rows] = await pool.query(
      `SELECT id, club_id, name, aliases, url, kind, created_at
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

// GET /api/logos/search-external?q=<navn> — søg klubber i TheSportsDB.
// Returnerer forenklede resultater (kun fodbold, kun med badge). Selve
// billedet importeres først når brugeren vælger et resultat.
router.get('/search-external', requireClub, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const url = `https://www.thesportsdb.com/api/v1/json/${THESPORTSDB_KEY}/searchteams.php?t=${encodeURIComponent(q)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error('TheSportsDB HTTP ' + resp.status);
    const data = await resp.json();
    const teams = Array.isArray(data.teams) ? data.teams : [];
    const results = teams
      .filter((t) => t.strSport === 'Soccer' && t.strBadge)
      .slice(0, 24)
      .map((t) => ({
        name: t.strTeam,
        league: t.strLeague || null,
        country: t.strCountry || null,
        aliases: t.strTeamAlternate || null,
        badge: t.strBadge,
        thumb: t.strBadge + '/tiny',
      }));
    res.json(results);
  } catch (err) {
    console.error('search external logos', err.message);
    res.status(502).json({ error: 'Kunne ikke søge i TheSportsDB' });
  }
});

// POST /api/logos/import-external — hent en valgt badge fra TheSportsDB,
// gem den i klubbens eget bibliotek og opret en football_logos-række.
// Body: { name, badge, aliases? }. Kun URLs fra thesportsdb.com accepteres.
router.post('/import-external', requireClub, requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  const badge = (req.body.badge || '').trim();
  const aliases = (req.body.aliases || '').trim() || null;
  if (!name || !badge) {
    return res.status(400).json({ error: 'Navn og badge er påkrævet' });
  }
  // SSRF-værn: kun billeder fra TheSportsDB må hentes
  let host;
  try { host = new URL(badge).hostname; } catch (_) { host = ''; }
  if (host !== THESPORTSDB_HOST_SUFFIX && !host.endsWith('.' + THESPORTSDB_HOST_SUFFIX)) {
    return res.status(400).json({ error: 'Ugyldig badge-kilde' });
  }
  try {
    const resp = await fetch(badge, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error('badge HTTP ' + resp.status);
    const contentType = (resp.headers.get('content-type') || '').split(';')[0].trim();
    const ext = CONTENT_TYPE_EXT[contentType];
    if (!ext) return res.status(400).json({ error: 'Badge er ikke et gyldigt billede' });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length === 0 || buf.length > 3 * 1024 * 1024) {
      return res.status(400).json({ error: 'Badge er for stor eller tom' });
    }
    const filename = `${slugify(name)}_${Date.now()}${ext}`;
    const dir = clubLogosLibDir(req.clubId);
    await fs.promises.writeFile(path.join(dir, filename), buf);
    const url = `clubs/${req.clubId}/logos-library/${filename}`;
    const [result] = await pool.query(
      'INSERT INTO football_logos (club_id, name, aliases, url, kind) VALUES (?, ?, ?, ?, ?)',
      [req.clubId, name, aliases, url, 'club']
    );
    const [[logo]] = await pool.query(
      'SELECT id, club_id, name, aliases, url, kind, created_at FROM football_logos WHERE id = ?',
      [result.insertId]
    );
    res.json(logo);
  } catch (err) {
    console.error('import external logo', err.message);
    res.status(502).json({ error: 'Kunne ikke importere logo' });
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
  const aliases = (req.body.aliases || '').trim() || null;
  try {
    const url = `clubs/${req.clubId}/logos-library/${req.file.filename}`;
    const [result] = await pool.query(
      'INSERT INTO football_logos (club_id, name, aliases, url, kind) VALUES (?, ?, ?, ?, ?)',
      [req.clubId, name, aliases, url, kind]
    );
    const [[logo]] = await pool.query(
      'SELECT id, club_id, name, aliases, url, kind, created_at FROM football_logos WHERE id = ?',
      [result.insertId]
    );
    res.json(logo);
  } catch (err) {
    console.error('upload logo', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// PUT /api/logos/:id — omdøb klub-eget logo (navn og/eller aliasser)
router.put('/:id', requireClub, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Navn er påkrævet' });
  const aliases = req.body.aliases !== undefined ? ((req.body.aliases || '').trim() || null) : undefined;
  try {
    // Kun klub-egne logoer kan omdøbes — ikke globale flag
    const [result] = aliases !== undefined
      ? await pool.query(
          'UPDATE football_logos SET name = ?, aliases = ? WHERE id = ? AND club_id = ?',
          [name, aliases, id, req.clubId]
        )
      : await pool.query(
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
