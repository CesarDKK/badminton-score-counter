const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { query, queryOne } = require('../config/database');
const { authMiddleware } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const BACKUP_VERSION = '1.0';

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
router.get('/', authMiddleware, async (req, res, next) => {
    try {
        const tables = {};
        for (const table of BACKUP_TABLES) {
            tables[table] = await query(`SELECT * FROM \`${table}\``);
        }

        // Embed sponsor image files as base64
        const files = {};
        const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
        const clubDir = req.clubSubdomain
            ? path.join(uploadDir, `badminton_counter_${req.clubSubdomain}`)
            : uploadDir;

        if (tables.sponsor_images && tables.sponsor_images.length > 0) {
            for (const img of tables.sponsor_images) {
                const filePath = path.join(clubDir, img.filename);
                if (fs.existsSync(filePath)) {
                    const data = fs.readFileSync(filePath);
                    files[img.filename] = data.toString('base64');
                }
            }
        }

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
router.post('/restore', authMiddleware, upload.single('backup'), async (req, res, next) => {
    let backup;
    try {
        backup = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Ugyldig backup-fil — kunne ikke parse JSON' });
    }

    if (!backup.version || !backup.tables) {
        return res.status(400).json({ error: 'Ugyldig backup-fil — mangler version eller tabeller' });
    }

    try {
        // Restore tables in FK-safe order
        for (const table of BACKUP_TABLES) {
            const rows = backup.tables[table];
            if (!rows || rows.length === 0) continue;

            await query(`DELETE FROM \`${table}\``);

            for (const row of rows) {
                const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
                const placeholders = Object.keys(row).map(() => '?').join(', ');
                const vals = Object.values(row).map(v =>
                    v instanceof Object && !Buffer.isBuffer(v) ? JSON.stringify(v) : v
                );
                await query(
                    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
                    vals
                );
            }
        }

        // Restore image files
        if (backup.files && Object.keys(backup.files).length > 0) {
            const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
            const clubDir = req.clubSubdomain
                ? path.join(uploadDir, `badminton_counter_${req.clubSubdomain}`)
                : uploadDir;

            if (!fs.existsSync(clubDir)) fs.mkdirSync(clubDir, { recursive: true });

            for (const [filename, b64] of Object.entries(backup.files)) {
                const filePath = path.join(clubDir, filename);
                fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
            }
        }

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
