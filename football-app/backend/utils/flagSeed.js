// Seed landeflag i football_logos-tabellen ved backend startup.
//
// Køres idempotent: hvis der allerede er flag-rækker, gør den intet.
// Ellers:
//   1. Læser SVG'er fra /app/static-flags/ (bagt ind i image af Dockerfile)
//   2. Kopierer dem til /app/uploads/flags/ (volume → persisterer mellem deploys)
//   3. Udleder ISO-2 koden fra filnavnet og slår dansk landenavn op via Intl.DisplayNames
//   4. Batch-INSERT i football_logos med kind='flag', club_id=NULL (globalt)

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

const STATIC_FLAGS_DIR = '/app/static-flags';
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/app/uploads';
const FLAGS_DIR = path.join(UPLOAD_DIR, 'flags');

// Intl.DisplayNames bruger CLDR i Node 20+ — dækker alle ISO 3166-1 alpha-2 koder
let regionNames;
let regionNamesEn;
try {
  regionNames = new Intl.DisplayNames(['da'], { type: 'region' });
  regionNamesEn = new Intl.DisplayNames(['en'], { type: 'region' });
} catch (err) {
  console.warn('Intl.DisplayNames not available, falling back to ISO codes', err);
  regionNames = null;
  regionNamesEn = null;
}

function displayName(names, iso) {
  if (names) {
    try {
      const n = names.of(iso.toUpperCase());
      // Intl returnerer ISO-koden uændret hvis ingen mapping findes — vi nøjes med det
      if (n && n !== iso.toUpperCase()) return n;
    } catch (_) {}
  }
  return iso.toUpperCase();
}

function nameForIso(iso) { return displayName(regionNames, iso); }

// Engelsk navn som alias, så både "Danmark" og "Denmark" matcher flaget
function aliasForIso(iso) {
  const en = displayName(regionNamesEn, iso);
  const da = nameForIso(iso);
  return en !== da ? en : null;
}

// Sørg for at aliases-kolonnen findes (idempotent — eksisterende installationer
// er oprettet af init.sql uden kolonnen)
async function ensureAliasesColumn() {
  try {
    await pool.query('ALTER TABLE football_logos ADD COLUMN aliases VARCHAR(255) NULL AFTER name');
    console.log('[flagSeed] aliases-kolonne tilføjet til football_logos');
  } catch (err) {
    if (err.code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

// Backfill: giv eksisterende flag-rækker deres engelske navn som alias
async function backfillFlagAliases() {
  const [rows] = await pool.query(
    "SELECT id, url FROM football_logos WHERE kind = 'flag' AND aliases IS NULL"
  );
  if (rows.length === 0) return;
  let updated = 0;
  for (const row of rows) {
    const iso = path.basename(row.url, '.svg');
    const alias = aliasForIso(iso);
    if (!alias) continue;
    await pool.query('UPDATE football_logos SET aliases = ? WHERE id = ?', [alias, row.id]);
    updated += 1;
  }
  if (updated > 0) console.log(`[flagSeed] ✓ ${updated} flag fik engelsk alias`);
}

async function seedFlags() {
  await ensureAliasesColumn();
  // Skip hvis der allerede er flag-rækker
  const [[{ count }]] = await pool.query(
    "SELECT COUNT(*) AS count FROM football_logos WHERE kind = 'flag'"
  );
  if (count > 0) {
    console.log(`[flagSeed] ${count} flag findes allerede — skipper seed`);
    await backfillFlagAliases();
    return;
  }

  // Tjek at static-flags findes
  if (!fs.existsSync(STATIC_FLAGS_DIR)) {
    console.warn(`[flagSeed] ${STATIC_FLAGS_DIR} findes ikke — skipper seed`);
    return;
  }

  // Sørg for at upload-mappen findes
  if (!fs.existsSync(FLAGS_DIR)) fs.mkdirSync(FLAGS_DIR, { recursive: true });

  const files = fs.readdirSync(STATIC_FLAGS_DIR).filter(f => f.endsWith('.svg'));
  if (files.length === 0) {
    console.warn('[flagSeed] ingen SVG-filer fundet i static-flags');
    return;
  }

  console.log(`[flagSeed] kopierer ${files.length} flag og indsætter i DB...`);

  const rows = [];
  for (const file of files) {
    const iso = path.basename(file, '.svg');
    const dest = path.join(FLAGS_DIR, file);
    // Kopier hvis ikke allerede på volume
    if (!fs.existsSync(dest)) {
      try {
        fs.copyFileSync(path.join(STATIC_FLAGS_DIR, file), dest);
      } catch (err) {
        console.warn(`[flagSeed] kunne ikke kopiere ${file}:`, err.message);
        continue;
      }
    }
    const name = nameForIso(iso);
    const url = `flags/${file}`; // gem som relativ — frontend prefixer /api/uploads/
    rows.push([null, name, aliasForIso(iso), url, 'flag']);
  }

  if (rows.length === 0) return;

  // Batch insert
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const values = rows.flat();
  await pool.query(
    `INSERT INTO football_logos (club_id, name, aliases, url, kind) VALUES ${placeholders}`,
    values
  );
  console.log(`[flagSeed] ✓ ${rows.length} landeflag indsat`);
}

module.exports = { seedFlags };
