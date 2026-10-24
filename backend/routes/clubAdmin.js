const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, queryOne } = require('../config/database');
const { clubAdminAuth, generateClubAdminToken } = require('../middleware/clubAdminAuth');
const { forkertLogin } = require('../middleware/rateLimiter');
const masterDb = require('../config/masterDatabase');
const { lignerMail } = require('../config/adminMail');

// Hvornår klubben og admin'en sidst loggede ind — vises på super-admin-siden.
// Klubbens seneste login står i master-databasen, så klublisten ikke skal åbne
// hver klubs database. updated_at = updated_at: et login er ikke en ændring af
// klubben eller admin'en. Fejler det, logges der stadig ind.
async function registrerLogin(admin, subdomain) {
    try {
        await query('UPDATE club_admins SET last_login_at = NOW(), updated_at = updated_at WHERE id = ?', [admin.id]);
        if (subdomain) {
            await masterDb.query(
                'UPDATE clubs SET last_login_at = NOW(), last_login_user = ?, updated_at = updated_at WHERE subdomain = ?',
                [admin.username, subdomain]
            );
        }
    } catch (e) {
        console.error('Sidste login kunne ikke gemmes:', e.message);
    }
}

// POST /api/club-admin/login
router.post('/login', async (req, res, next) => {
    try {
        const { password } = req.body;
        const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';

        if (!username || !password) {
            return res.status(400).json({ error: 'Brugernavn og adgangskode er påkrævet' });
        }

        // Man kan logge ind med sit brugernavn ELLER sin mailadresse (hvis den er
        // sat på brugeren). Brugernavnet prøves først. Super-admin sikrer, at en
        // mail kun står på én bruger i klubben; skulle to alligevel dele den,
        // afgør adgangskoden, hvem det er.
        // query() bruger automatisk den rigtige klub-database via tenant middleware
        const kandidater = await query(
            `SELECT id, username, password_hash, page_permissions FROM club_admins
             WHERE username = ? OR (? = 1 AND email = ?)
             ORDER BY (username = ?) DESC, id ASC
             LIMIT 5`,
            [username, lignerMail(username) ? 1 : 0, username, username]
        );

        let admin = null;
        for (const k of kandidater) {
            if (await bcrypt.compare(password, k.password_hash)) { admin = k; break; }
        }
        if (!admin) {
            return res.status(401).json({ error: forkertLogin(req, 'Forkert brugernavn eller adgangskode') });
        }

        // page_permissions: NULL = fuld adgang. Ellers JSON-array af side-noegler.
        let permissions = null;
        if (admin.page_permissions) {
            try { permissions = JSON.parse(admin.page_permissions); } catch { permissions = null; }
        }

        const token = generateClubAdminToken(admin.id, admin.username, req.clubSubdomain, permissions, admin.password_hash);
        await registrerLogin(admin, req.clubSubdomain);
        res.json({ success: true, token });
    } catch (error) {
        next(error);
    }
});

// PUT /api/club-admin/password — skift adgangskode
router.put('/password', clubAdminAuth, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Nuværende og ny adgangskode er påkrævet' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Ny adgangskode skal være mindst 8 tegn' });
        }

        const admin = await queryOne(
            'SELECT id, password_hash FROM club_admins WHERE id = ?',
            [req.clubAdmin.id]
        );

        const isValid = await bcrypt.compare(currentPassword, admin.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Nuværende adgangskode er forkert' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        await query('UPDATE club_admins SET password_hash = ? WHERE id = ?', [newHash, admin.id]);

        // Den nye adgangskode gør alle admin'ens gamle sessioner ugyldige (også
        // denne) — send et nyt token med, så man ikke bliver logget ud selv
        const token = generateClubAdminToken(admin.id, req.clubAdmin.username, req.clubSubdomain, req.clubAdmin.permissions, newHash);
        res.json({ success: true, token });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
