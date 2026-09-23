const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database');
const { query, queryOne } = db;
const { authMiddleware } = require('../middleware/auth');
const { requireFuldAdgang } = require('../middleware/pagePermission');
const { klubMappe, backupFilnavn, tilpasSponsorRaekker, hentSponsorFiler, skrivSponsorFiler } = require('../config/sponsorFiler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Filnavne, filstier og kolonnenavne i en backup-fil er angriberkontrollerede:
// filnavnet ender i fs.writeFileSync (path traversal), file_path blev før brugt,
// når et billede blev slettet (vilkårlig filsletning), og kolonnenavnet står i
// backticks i SQL (identifier injection). Alt valideres FØR noget skrives, og
// sponsorbillederne peges ind i klubbens egen mappe (config/sponsorFiler.js).
const SIKKERT_KOLONNENAVN = /^[A-Za-z0-9_]+$/;

const BACKUP_VERSION = '1.0';

// Convert ISO 8601 timestamps to MySQL DATETIME format and handle JSON objects
function normalizeValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        // "2026-04-09T18:34:24.000Z" → "2026-04-09 18:34:24"
        return v.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    if (v instanceof Object && !Buffer.isBuffer(v)) return JSON.stringify(v);
    return v;
}

// Tables to include in backup, in restoration order (respects FK constraints)
const BACKUP_TABLES = [
    'settings',
    'sponsor_settings',
    'courts',
    'sponsor_images',
    'sponsor_image_courts',
    'game_states',
    'match_history',
    'team_matches',
    'team_match_games',
    'device_tokens',
    'player_info',
];

// GET /api/backup — create and download a JSON backup of this club's data
router.get('/', authMiddleware, requireFuldAdgang, async (req, res, next) => {
    try {
        const tables = {};
        for (const table of BACKUP_TABLES) {
            tables[table] = await query(`SELECT * FROM \`${table}\``);
        }

        // Sponsorbillederne som base64 — fra klubbens egen mappe. (Før blev de ledt
        // efter i en mappe, der ikke findes, så de kom aldrig med.)
        const files = hentSponsorFiler(tables.sponsor_images, klubMappe(req));

        const backup = {
            version: BACKUP_VERSION,
            timestamp: new Date().toISOString(),
            clubSubdomain: req.clubSubdomain || null,
            tables,
            files,
        };

        const json = JSON.stringify(backup, null, 2);
        const filename = `backup_${req.clubSubdomain || 'lokal'}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(json);
    } catch (error) {
        next(error);
    }
});

// POST /api/backup/restore — restore from a JSON backup
router.post('/restore', authMiddleware, requireFuldAdgang, upload.single('backup'), async (req, res, next) => {
    let backup;
    try {
        backup = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Ugyldig backup-fil — kunne ikke parse JSON' });
    }

    if (!backup.version || !backup.tables) {
        return res.status(400).json({ error: 'Ugyldig backup-fil — mangler version eller tabeller' });
    }

    // Validér ALT før noget skrives: én dårlig kolonne/filnavn må ikke føre til
    // at tabeller allerede er slettet, når vi opdager problemet.
    for (const table of BACKUP_TABLES) {
        const rows = backup.tables[table];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
            for (const col of Object.keys(row)) {
                if (!SIKKERT_KOLONNENAVN.test(col)) {
                    return res.status(400).json({ error: `Ugyldigt kolonnenavn i backup: ${col}` });
                }
            }
        }
    }
    if (backup.files && typeof backup.files === 'object') {
        for (const filename of Object.keys(backup.files)) {
            if (!backupFilnavn(filename)) {
                return res.status(400).json({ error: `Ugyldigt filnavn i backup: ${filename}` });
            }
        }
    }

    const filFejl = tilpasSponsorRaekker(backup.tables.sponsor_images, klubMappe(req));
    if (filFejl) return res.status(400).json({ error: filFejl });

    // Gendannelse i én transaktion: fejler et INSERT, rulles alt tilbage, så
    // klubbens data ikke efterlades halvt slettet. Filerne skrives først bagefter.
    // db.pool er en getter der returnerer den aktuelle tenants pool — læses her
    // (i request-konteksten), ikke ved modul-load hvor tenanten ikke er sat.
    const conn = await db.pool.getConnection();
    try {
        await conn.beginTransaction();

        // Restore tables in FK-safe order
        for (const table of BACKUP_TABLES) {
            const rows = backup.tables[table];
            if (!rows || rows.length === 0) continue;

            await conn.query(`DELETE FROM \`${table}\``);

            for (const row of rows) {
                const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
                const placeholders = Object.keys(row).map(() => '?').join(', ');
                const vals = Object.values(row).map(normalizeValue);
                await conn.query(
                    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
                    vals
                );
            }
        }

        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch {}
        conn.release();
        return next(error);
    }
    conn.release();

    try {
        // Billedfilerne (efter commit — kun validerede filnavne, i klubbens egen mappe)
        skrivSponsorFiler(backup.files, klubMappe(req));

        res.json({
            success: true,
            restored: Object.fromEntries(
                BACKUP_TABLES.map(t => [t, backup.tables[t]?.length ?? 0])
            ),
            files: Object.keys(backup.files || {}).length,
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
