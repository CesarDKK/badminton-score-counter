const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const masterDb = require('../config/masterDatabase');
const { superAdminAuth, generateSuperAdminToken } = require('../middleware/superAdminAuth');
const fs = require('fs');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const logoUpload = require('../config/logoUpload');

// Gyldige side-noegler for klub-admins per-side adgangsstyring.
const VALID_PAGE_KEYS = ['holdkamp', 'tournament', 'history', 'playerinfo', 'settings', 'sponsors', 'devicetokens'];

// Normaliserer pagePermissions fra request til en gemt vaerdi.
// null/undefined eller "alle valgt" -> null (= fuld adgang). Ellers JSON-array
// med kun gyldige, unikke noegler. Returnerer { value } eller { error }.
function normalizePagePermissions(input) {
    if (input === null || input === undefined) return { value: null };
    if (!Array.isArray(input)) return { error: 'pagePermissions skal være en liste' };
    const filtered = [...new Set(input)].filter(k => VALID_PAGE_KEYS.includes(k));
    // Alle sider valgt -> fuld adgang (null). Tom liste -> ingen af de 6 sider.
    if (filtered.length === VALID_PAGE_KEYS.length) return { value: null };
    return { value: JSON.stringify(filtered) };
}

// POST /api/super-admin/login
router.post('/login', async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }

        const admin = await masterDb.queryOne(
            'SELECT id, username, password_hash FROM super_admins WHERE username = ?',
            [username]
        );

        if (!admin) {
            return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
        }

        const isValid = await bcrypt.compare(password, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Forkert brugernavn eller adgangskode' });
        }

        const token = generateSuperAdminToken(admin.id, admin.username);
        res.json({ success: true, token });
    } catch (error) {
        next(error);
    }
});

// PUT /api/super-admin/change-password — skift super admin's egen adgangskode
router.put('/change-password', superAdminAuth, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Nuværende og ny adgangskode er påkrævet' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Ny adgangskode skal være mindst 8 tegn' });
        }

        const admin = await masterDb.queryOne(
            'SELECT id, password_hash FROM super_admins WHERE id = ?',
            [req.superAdmin.id]
        );
        if (!admin) return res.status(404).json({ error: 'Admin ikke fundet' });

        const isValid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Nuværende adgangskode er forkert' });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await masterDb.query(
            'UPDATE super_admins SET password_hash = ? WHERE id = ?',
            [hash, admin.id]
        );

        res.json({ success: true });
    } catch (error) { next(error); }
});

// GET /api/super-admin/clubs
router.get('/clubs', superAdminAuth, async (req, res, next) => {
    try {
        const clubs = await masterDb.query(
            'SELECT id, name, subdomain, db_name, is_active, created_at FROM clubs ORDER BY created_at DESC'
        );
        res.json(clubs);
    } catch (error) {
        next(error);
    }
});

// POST /api/super-admin/clubs — opret ny klub
router.post('/clubs', superAdminAuth, async (req, res, next) => {
    try {
        const { name, subdomain } = req.body;

        if (!name || !subdomain) {
            return res.status(400).json({ error: 'Navn og subdomain er påkrævet' });
        }

        // Valider subdomain: kun bogstaver, tal og bindestreger
        if (!/^[a-z0-9-]+$/.test(subdomain)) {
            return res.status(400).json({
                error: 'Subdomain må kun indeholde små bogstaver, tal og bindestreger'
            });
        }

        // Tjek om subdomain allerede er i brug
        const existing = await masterDb.queryOne(
            'SELECT id FROM clubs WHERE subdomain = ?',
            [subdomain]
        );
        if (existing) {
            return res.status(409).json({ error: 'Subdomain er allerede i brug' });
        }

        // Generer database navn ud fra subdomain (fx aarhus-badminton → aarhus_badminton)
        const dbName = subdomain.replace(/-/g, '_');

        // Opret klub-database
        await masterDb.createClubDatabase(dbName);

        // Gem klub i master databasen
        const result = await masterDb.query(
            'INSERT INTO clubs (name, subdomain, db_name) VALUES (?, ?, ?)',
            [name, subdomain, dbName]
        );

        const club = await masterDb.queryOne(
            'SELECT id, name, subdomain, db_name, is_active, created_at FROM clubs WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json(club);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/super-admin/clubs/:id — slet klub og dens database permanent
router.delete('/clubs/:id', superAdminAuth, async (req, res, next) => {
    try {
        const club = await masterDb.queryOne(
            'SELECT id, name, db_name, is_active FROM clubs WHERE id = ?',
            [req.params.id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });
        if (club.is_active) {
            return res.status(400).json({ error: 'Klub skal deaktiveres før den kan slettes' });
        }

        // Drop klub-databasen med root-adgang
        const adminConn = await masterDb.createAdminConnection();
        try {
            await adminConn.execute(`DROP DATABASE IF EXISTS \`${club.db_name}\``);
        } finally {
            await adminConn.end();
        }

        // Fjern klub fra master
        await masterDb.query('DELETE FROM clubs WHERE id = ?', [req.params.id]);

        res.json({ success: true });
    } catch (error) { next(error); }
});

// PUT /api/super-admin/clubs/:id/toggle — aktiver/deaktiver klub
router.put('/clubs/:id/toggle', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;

        const club = await masterDb.queryOne('SELECT id, is_active FROM clubs WHERE id = ?', [id]);
        if (!club) {
            return res.status(404).json({ error: 'Klub ikke fundet' });
        }

        await masterDb.query(
            'UPDATE clubs SET is_active = ?, updated_at = NOW() WHERE id = ?',
            [!club.is_active, id]
        );

        res.json({ success: true, is_active: !club.is_active });
    } catch (error) {
        next(error);
    }
});

// Hjælper: opret direkte forbindelse til en klubs database
async function clubConn(dbName) {
    return mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'badminton_user',
        password: process.env.DB_PASSWORD || '',
        database: dbName
    });
}

// GET /api/super-admin/clubs/:id/admins — hent klub admins
router.get('/clubs/:id/admins', superAdminAuth, async (req, res, next) => {
    try {
        const club = await masterDb.queryOne('SELECT db_name FROM clubs WHERE id = ?', [req.params.id]);
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        try {
            const [rows] = await conn.execute(
                'SELECT id, username, email, page_permissions, created_at FROM club_admins ORDER BY created_at ASC'
            );
            // Parse page_permissions til array (eller null = fuld adgang) til frontend
            const admins = rows.map(r => {
                let permissions = null;
                if (r.page_permissions) {
                    try { permissions = JSON.parse(r.page_permissions); } catch { permissions = null; }
                }
                return { ...r, page_permissions: permissions };
            });
            res.json(admins);
        } finally {
            await conn.end();
        }
    } catch (error) { next(error); }
});

// POST /api/super-admin/clubs/:id/admins — opret klub admin
router.post('/clubs/:id/admins', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { username, password, email, pagePermissions } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
        }

        const perms = normalizePagePermissions(pagePermissions);
        if (perms.error) return res.status(400).json({ error: perms.error });

        const club = await masterDb.queryOne(
            'SELECT id, db_name FROM clubs WHERE id = ?',
            [id]
        );

        if (!club) {
            return res.status(404).json({ error: 'Klub ikke fundet' });
        }

        const conn = await clubConn(club.db_name);
        try {
            const hash = await bcrypt.hash(password, 10);
            const [result] = await conn.execute(
                'INSERT INTO club_admins (username, password_hash, email, page_permissions) VALUES (?, ?, ?, ?)',
                [username, hash, email || null, perms.value]
            );
            res.status(201).json({
                id: result.insertId,
                username,
                email: email || null,
                page_permissions: perms.value ? JSON.parse(perms.value) : null
            });
        } finally {
            await conn.end();
        }
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Brugernavn er allerede i brug i denne klub' });
        }
        next(error);
    }
});

// DELETE /api/super-admin/clubs/:id/admins/:adminId — slet klub admin
router.delete('/clubs/:id/admins/:adminId', superAdminAuth, async (req, res, next) => {
    try {
        const club = await masterDb.queryOne('SELECT db_name FROM clubs WHERE id = ?', [req.params.id]);
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        try {
            const [result] = await conn.execute(
                'DELETE FROM club_admins WHERE id = ?', [req.params.adminId]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Admin ikke fundet' });
            res.json({ success: true });
        } finally {
            await conn.end();
        }
    } catch (error) { next(error); }
});

// PUT /api/super-admin/clubs/:id/admins/:adminId/password — skift adgangskode
router.put('/clubs/:id/admins/:adminId/password', superAdminAuth, async (req, res, next) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
        }

        const club = await masterDb.queryOne('SELECT db_name FROM clubs WHERE id = ?', [req.params.id]);
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        try {
            const hash = await bcrypt.hash(password, 10);
            const [result] = await conn.execute(
                'UPDATE club_admins SET password_hash = ? WHERE id = ?', [hash, req.params.adminId]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Admin ikke fundet' });
            res.json({ success: true });
        } finally {
            await conn.end();
        }
    } catch (error) { next(error); }
});

// PUT /api/super-admin/clubs/:id/admins/:adminId/permissions — opdater side-adgang
router.put('/clubs/:id/admins/:adminId/permissions', superAdminAuth, async (req, res, next) => {
    try {
        const perms = normalizePagePermissions(req.body.pagePermissions);
        if (perms.error) return res.status(400).json({ error: perms.error });

        const club = await masterDb.queryOne('SELECT db_name FROM clubs WHERE id = ?', [req.params.id]);
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        try {
            const [result] = await conn.execute(
                'UPDATE club_admins SET page_permissions = ? WHERE id = ?',
                [perms.value, req.params.adminId]
            );
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Admin ikke fundet' });
            res.json({ success: true, page_permissions: perms.value ? JSON.parse(perms.value) : null });
        } finally {
            await conn.end();
        }
    } catch (error) { next(error); }
});

// ==================== BACKUP / RESTORE (super admin — per klub) ====================

function saNormalizeValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        return v.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    if (v instanceof Object && !Buffer.isBuffer(v)) return JSON.stringify(v);
    return v;
}

const backupFs = require('fs');
const backupPath = require('path');
const backupMulter = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const BACKUP_TABLES = [
    'settings', 'sponsor_settings', 'courts',
    'sponsor_images', 'sponsor_image_courts',
    'game_states', 'match_history',
    'team_matches', 'team_match_games',
    'device_tokens', 'player_info',
];

// GET /api/super-admin/clubs/:id/backup — download backup for one club
router.get('/clubs/:id/backup', superAdminAuth, async (req, res, next) => {
    try {
        const club = await masterDb.queryOne(
            'SELECT name, subdomain, db_name FROM clubs WHERE id = ?',
            [req.params.id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        const tables = {};
        try {
            for (const table of BACKUP_TABLES) {
                const [rows] = await conn.execute(`SELECT * FROM \`${table}\``);
                tables[table] = rows;
            }
        } finally {
            await conn.end();
        }

        const files = {};
        const uploadDir = process.env.UPLOAD_DIR || backupPath.join(__dirname, '..', 'uploads');
        const clubDir = backupPath.join(uploadDir, club.db_name);
        if (tables.sponsor_images?.length) {
            for (const img of tables.sponsor_images) {
                const fp = backupPath.join(clubDir, img.filename);
                if (backupFs.existsSync(fp)) {
                    files[img.filename] = backupFs.readFileSync(fp).toString('base64');
                }
            }
        }

        const backup = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            clubSubdomain: club.subdomain,
            clubName: club.name,
            tables,
            files,
        };

        const filename = `backup_${club.subdomain}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(backup, null, 2));
    } catch (error) { next(error); }
});

// POST /api/super-admin/clubs/:id/restore — restore backup for one club
router.post('/clubs/:id/restore', superAdminAuth, backupMulter.single('backup'), async (req, res, next) => {
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
        const club = await masterDb.queryOne(
            'SELECT db_name, subdomain FROM clubs WHERE id = ?',
            [req.params.id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const conn = await clubConn(club.db_name);
        try {
            for (const table of BACKUP_TABLES) {
                const rows = backup.tables[table];
                if (!rows || rows.length === 0) { await conn.execute(`DELETE FROM \`${table}\``); continue; }
                await conn.execute(`DELETE FROM \`${table}\``);
                for (const row of rows) {
                    const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
                    const ph = Object.keys(row).map(() => '?').join(', ');
                    const vals = Object.values(row).map(saNormalizeValue);
                    await conn.execute(`INSERT INTO \`${table}\` (${cols}) VALUES (${ph})`, vals);
                }
            }
        } finally {
            await conn.end();
        }

        if (backup.files && Object.keys(backup.files).length > 0) {
            const uploadDir = process.env.UPLOAD_DIR || backupPath.join(__dirname, '..', 'uploads');
            const clubDir = backupPath.join(uploadDir, club.db_name);
            if (!backupFs.existsSync(clubDir)) backupFs.mkdirSync(clubDir, { recursive: true });
            for (const [filename, b64] of Object.entries(backup.files)) {
                backupFs.writeFileSync(backupPath.join(clubDir, filename), Buffer.from(b64, 'base64'));
            }
        }

        res.json({
            success: true,
            restored: Object.fromEntries(BACKUP_TABLES.map(t => [t, backup.tables[t]?.length ?? 0])),
            files: Object.keys(backup.files || {}).length,
        });
    } catch (error) { next(error); }
});

// ─────────────────────────────────────────────────────────────────────────
// FOOTBALL CLUB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────
// Super admin styrer football-klubber + per-klub admins. Football bruger
// shared DB med club_id-kolonne (anderledes end badminton's per-klub DB),
// så her queryer vi direkte mod football_tournament-DB via footballDb.
const footballDb = require('../config/footballDatabase');

const FOOTBALL_SUBDOMAIN_REGEX = /^[a-z0-9-]+$/;
const FOOTBALL_RESERVED_SUBDOMAINS = ['www', 'admin', 'api'];

// GET /api/super-admin/football/clubs — list alle football-klubber
router.get('/football/clubs', superAdminAuth, async (req, res, next) => {
    try {
        // Inkluderer antal admins som JOIN så UI kan vise count uden ekstra round-trip
        const clubs = await footballDb.query(`
            SELECT c.id, c.name, c.subdomain, c.is_active, c.created_at,
                   (SELECT COUNT(*) FROM football_club_admins WHERE club_id = c.id) AS admin_count
            FROM football_clubs c
            ORDER BY c.created_at DESC
        `);
        res.json(clubs);
    } catch (error) {
        next(error);
    }
});

// POST /api/super-admin/football/clubs — opret klub
router.post('/football/clubs', superAdminAuth, async (req, res, next) => {
    try {
        const { name, subdomain } = req.body;
        if (!name || !subdomain) {
            return res.status(400).json({ error: 'Navn og subdomain er påkrævet' });
        }
        const sub = subdomain.trim().toLowerCase();
        if (!FOOTBALL_SUBDOMAIN_REGEX.test(sub)) {
            return res.status(400).json({
                error: 'Subdomain må kun indeholde små bogstaver, tal og bindestreger'
            });
        }
        if (FOOTBALL_RESERVED_SUBDOMAINS.includes(sub)) {
            return res.status(400).json({ error: `Subdomain '${sub}' er reserveret` });
        }

        const existing = await footballDb.queryOne(
            'SELECT id FROM football_clubs WHERE subdomain = ?',
            [sub]
        );
        if (existing) {
            return res.status(409).json({ error: `Subdomain '${sub}' er allerede i brug` });
        }

        const result = await footballDb.query(
            'INSERT INTO football_clubs (name, subdomain) VALUES (?, ?)',
            [name.trim(), sub]
        );
        const club = await footballDb.queryOne(
            'SELECT id, name, subdomain, is_active, created_at FROM football_clubs WHERE id = ?',
            [result.insertId]
        );
        res.json({ ...club, admin_count: 0 });
    } catch (error) {
        next(error);
    }
});

// PUT /api/super-admin/football/clubs/:id/toggle — aktiver/deaktiver
router.put('/football/clubs/:id/toggle', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const club = await footballDb.queryOne(
            'SELECT is_active FROM football_clubs WHERE id = ?',
            [id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });
        const newState = !club.is_active;
        await footballDb.query(
            'UPDATE football_clubs SET is_active = ? WHERE id = ?',
            [newState, id]
        );
        res.json({ success: true, is_active: newState });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/super-admin/football/clubs/:id — slet klub
// Kræver at klub er deaktiveret først, så vi ikke ved et uheld sletter en aktiv klub
router.delete('/football/clubs/:id', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const club = await footballDb.queryOne(
            'SELECT id, name, is_active FROM football_clubs WHERE id = ?',
            [id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });
        if (club.is_active) {
            return res.status(400).json({
                error: 'Klub skal være deaktiveret før den kan slettes'
            });
        }
        // CASCADE rydder admins, turneringer, kampe osv.
        await footballDb.query('DELETE FROM football_clubs WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// GET /api/super-admin/football/clubs/:id/admins — list admins for klub
router.get('/football/clubs/:id/admins', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const admins = await footballDb.query(
            'SELECT id, username, email, created_at FROM football_club_admins WHERE club_id = ? ORDER BY created_at',
            [id]
        );
        res.json(admins);
    } catch (error) {
        next(error);
    }
});

// POST /api/super-admin/football/clubs/:id/admins — opret admin
router.post('/football/clubs/:id/admins', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { username, password, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
        }

        const club = await footballDb.queryOne(
            'SELECT id FROM football_clubs WHERE id = ?',
            [id]
        );
        if (!club) return res.status(404).json({ error: 'Klub ikke fundet' });

        const existing = await footballDb.queryOne(
            'SELECT id FROM football_club_admins WHERE club_id = ? AND username = ?',
            [id, username]
        );
        if (existing) {
            return res.status(409).json({ error: `Brugernavnet '${username}' eksisterer allerede i denne klub` });
        }

        const hash = await footballDb.hashPassword(password);
        const result = await footballDb.query(
            'INSERT INTO football_club_admins (club_id, username, password_hash, email) VALUES (?, ?, ?, ?)',
            [id, username, hash, email || null]
        );
        const admin = await footballDb.queryOne(
            'SELECT id, username, email, created_at FROM football_club_admins WHERE id = ?',
            [result.insertId]
        );
        res.json(admin);
    } catch (error) {
        next(error);
    }
});

// DELETE /api/super-admin/football/clubs/:id/admins/:adminId
router.delete('/football/clubs/:id/admins/:adminId', superAdminAuth, async (req, res, next) => {
    try {
        const { id, adminId } = req.params;
        await footballDb.query(
            'DELETE FROM football_club_admins WHERE id = ? AND club_id = ?',
            [adminId, id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/super-admin/football/clubs/:id/admins/:adminId/password — reset password
router.put('/football/clubs/:id/admins/:adminId/password', superAdminAuth, async (req, res, next) => {
    try {
        const { id, adminId } = req.params;
        const { password } = req.body;
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
        }
        const hash = await footballDb.hashPassword(password);
        const result = await footballDb.query(
            'UPDATE football_club_admins SET password_hash = ? WHERE id = ? AND club_id = ?',
            [hash, adminId, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Admin ikke fundet' });
        }
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// ==================== KLUB-LOGO-BIBLIOTEK (centralt, master-DB) ====================

// POST /api/super-admin/logos — upload nyt logo
router.post('/logos', superAdminAuth, logoUpload.single('image'), async (req, res, next) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Billede er påkrævet' });

        const clubName = (req.body.clubName || '').trim();
        const aliases = (req.body.aliases || '').trim();
        if (!clubName) {
            try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
            return res.status(400).json({ error: 'Klubnavn er påkrævet' });
        }

        let width = null, height = null;
        try {
            const meta = await sharp(req.file.path).metadata();
            width = meta.width || null;
            height = meta.height || null;
        } catch (e) { /* metadata valgfri */ }

        const storedFilename = `central_logos/${req.file.filename}`;
        const result = await masterDb.query(
            `INSERT INTO club_logos
             (club_name, aliases, filename, original_name, file_path, file_size, width, height, mime_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [clubName, aliases || null, storedFilename, req.file.originalname,
             req.file.path, req.file.size, width, height, req.file.mimetype]
        );

        res.status(201).json({
            id: result.insertId,
            club_name: clubName,
            aliases: aliases || null,
            original_name: req.file.originalname,
            url: `/uploads/${storedFilename}`
        });
    } catch (error) { next(error); }
});

// GET /api/super-admin/logos — list alle logoer
router.get('/logos', superAdminAuth, async (req, res, next) => {
    try {
        const rows = await masterDb.query(
            `SELECT id, club_name, aliases, filename, original_name, upload_date
             FROM club_logos ORDER BY club_name ASC`
        );
        res.json(rows.map(r => ({ ...r, url: `/uploads/${r.filename}` })));
    } catch (error) { next(error); }
});

// GET /api/super-admin/known-club-names — distinkte klubnavne fra alle tenants
// (turnering + holdkamp + spillere) til "mangler logo"-listen. Frontend filtrerer
// dem der ikke auto-matcher et logo.
router.get('/known-club-names', superAdminAuth, async (req, res, next) => {
    try {
        const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
        const agg = new Map(); // navn -> { name, sources:Set, count }
        const add = (name, source) => {
            const n = (name || '').trim();
            if (!n || n === '?') return;
            let e = agg.get(n);
            if (!e) { e = { name: n, sources: new Set(), count: 0 }; agg.set(n, e); }
            e.sources.add(source); e.count++;
        };

        await Promise.all(clubs.map(async (c) => {
            let conn;
            try {
                conn = await clubConn(c.db_name);
                const q = async (sql) => {
                    try { const [rows] = await conn.execute(sql); return rows; }
                    catch (e) { return []; } // tabel findes evt. ikke i ældre klub-DB
                };
                (await q('SELECT DISTINCT club FROM tournament_player_clubs')).forEach(r => add(r.club, 'turnering'));
                (await q('SELECT DISTINCT team1_name FROM team_matches')).forEach(r => add(r.team1_name, 'holdkamp'));
                (await q('SELECT DISTINCT team2_name FROM team_matches')).forEach(r => add(r.team2_name, 'holdkamp'));
                (await q('SELECT DISTINCT club FROM player_info')).forEach(r => add(r.club, 'spiller'));
            } catch (e) {
                console.error(`known-club-names: tenant ${c.db_name} sprunget over:`, e.message);
            } finally {
                if (conn) { try { await conn.end(); } catch (e) { /* ignore */ } }
            }
        }));

        const out = [...agg.values()]
            .map(e => ({ name: e.name, sources: [...e.sources], count: e.count }))
            .sort((a, b) => b.count - a.count);
        res.json(out);
    } catch (error) { next(error); }
});

// GET /api/super-admin/logos/seed-bundle — download hele biblioteket som seed-zip
// (billeder navngivet efter klub + aliases.json). Udpakkes i backend/assets/seed_logos.
router.get('/logos/seed-bundle', superAdminAuth, async (req, res, next) => {
    try {
        const logos = await masterDb.query(
            'SELECT club_name, aliases, filename, file_path FROM club_logos ORDER BY club_name ASC'
        );
        const zip = new AdmZip();
        const used = new Set();
        const aliasesManifest = {};
        for (const l of logos) {
            if (!l.file_path || !backupFs.existsSync(l.file_path)) {
                console.error('seed-bundle: fil mangler paa disk:', l.file_path);
                continue;
            }
            const ext = backupPath.extname(l.filename) || '.png';
            const base = (String(l.club_name || '').trim()) || 'logo';
            let name = `${base}${ext}`;
            let i = 2;
            while (used.has(name.toLowerCase())) { name = `${base}_${i}${ext}`; i++; }
            used.add(name.toLowerCase());
            zip.addLocalFile(l.file_path, '', name);
            if (l.aliases) aliasesManifest[name] = l.aliases;
        }
        zip.addFile('aliases.json', Buffer.from(JSON.stringify(aliasesManifest, null, 2), 'utf8'));
        const buf = zip.toBuffer();
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="seed_logos_bundle.zip"');
        res.send(buf);
    } catch (error) { next(error); }
});

// PUT /api/super-admin/logos/:id — ret klubnavn/aliasser
router.put('/logos/:id', superAdminAuth, async (req, res, next) => {
    try {
        const clubName = (req.body.clubName || '').trim();
        const aliases = (req.body.aliases || '').trim();
        if (!clubName) return res.status(400).json({ error: 'Klubnavn er påkrævet' });

        const result = await masterDb.query(
            'UPDATE club_logos SET club_name = ?, aliases = ? WHERE id = ?',
            [clubName, aliases || null, req.params.id]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Logo ikke fundet' });
        res.json({ success: true });
    } catch (error) { next(error); }
});

// DELETE /api/super-admin/logos/:id — slet række + fil
router.delete('/logos/:id', superAdminAuth, async (req, res, next) => {
    try {
        const logo = await masterDb.queryOne('SELECT file_path FROM club_logos WHERE id = ?', [req.params.id]);
        if (!logo) return res.status(404).json({ error: 'Logo ikke fundet' });

        await masterDb.query('DELETE FROM club_logos WHERE id = ?', [req.params.id]);
        try { fs.unlinkSync(logo.file_path); } catch (e) { console.error('Kunne ikke slette logo-fil:', e.message); }

        res.json({ success: true });
    } catch (error) { next(error); }
});

module.exports = router;
