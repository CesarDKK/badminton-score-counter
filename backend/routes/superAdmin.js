const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const mysql = require('mysql2/promise');
const masterDb = require('../config/masterDatabase');
const { superAdminAuth, generateSuperAdminToken } = require('../middleware/superAdminAuth');

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
                'SELECT id, username, email, created_at FROM club_admins ORDER BY created_at ASC'
            );
            res.json(rows);
        } finally {
            await conn.end();
        }
    } catch (error) { next(error); }
});

// POST /api/super-admin/clubs/:id/admins — opret klub admin
router.post('/clubs/:id/admins', superAdminAuth, async (req, res, next) => {
    try {
        const { id } = req.params;
        const { username, password, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Adgangskode skal være mindst 8 tegn' });
        }

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
                'INSERT INTO club_admins (username, password_hash, email) VALUES (?, ?, ?)',
                [username, hash, email || null]
            );
            res.status(201).json({ id: result.insertId, username, email: email || null });
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

module.exports = router;
