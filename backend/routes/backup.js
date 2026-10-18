const express = require('express');
const router = express.Router();
const multer = require('multer');
const db = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const { requireFuldAdgang } = require('../middleware/pagePermission');
const { klubMappe } = require('../config/sponsorFiler');
const { lavBackup, validerBackup, gendanBackup, BackupFejl } = require('../config/klubBackup');
const autoBackup = require('../config/autoBackup');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Indstillinger → Backup & Gendannelse. Selve backup-formatet og gendannelsen
// ligger i config/klubBackup.js (fælles med super-admin og den automatiske backup).

const tidsstempel = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-').slice(0, 19);

// Kør fn med en forbindelse til den aktuelle klubs database (db.pool er en
// getter, der giver den aktuelle tenants pool — læses i request-konteksten)
async function medForbindelse(fn) {
    const conn = await db.pool.getConnection();
    try { return await fn(conn); } finally { conn.release(); }
}

// Klubben bag et klub-subdomæne (null på demoen/lokal installation, hvor der
// ikke tages automatiske backups)
async function aktuelKlub(req) {
    if (req.accessMode !== 'club' || !req.clubDbName) return null;
    const masterDb = require('../config/masterDatabase');
    return masterDb.queryOne('SELECT id, name, subdomain, db_name FROM clubs WHERE db_name = ?', [req.clubDbName]);
}

// Gendan og svar. På et klub-subdomæne tages der først en "før gendannelse"-
// backup, så gendannelsen kan fortrydes; fejler den, gendannes der ikke. En
// ugyldig fil afvises inden — ellers erstattede den den gode "før"-backup.
async function gendanOgSvar(req, res, next, backup) {
    const fejl = validerBackup(backup);
    if (fejl) return res.status(400).json({ error: fejl });
    try {
        const klub = await aktuelKlub(req);
        const resultat = await medForbindelse(async (conn) => {
            const foer = klub ? await autoBackup.tagBackup(conn, klub, 'foer-gendannelse') : null;
            const r = await gendanBackup(conn, backup, klubMappe(req));
            return { ...r, foerGendannelse: foer };
        });
        res.json({ success: true, ...resultat });
    } catch (error) {
        if (error instanceof BackupFejl) return res.status(400).json({ error: error.message });
        next(error);
    }
}

// GET /api/backup — hent en backup af klubbens data som fil
router.get('/', authMiddleware, requireFuldAdgang, async (req, res, next) => {
    try {
        const backup = await medForbindelse(conn =>
            lavBackup(conn, { mappe: klubMappe(req), clubSubdomain: req.clubSubdomain || null }));
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${req.clubSubdomain || 'lokal'}_${tidsstempel()}.json"`);
        res.send(JSON.stringify(backup, null, 2));
    } catch (error) {
        next(error);
    }
});

// POST /api/backup/restore — gendan fra en uploadet backup-fil
router.post('/restore', authMiddleware, requireFuldAdgang, upload.single('backup'), async (req, res, next) => {
    let backup;
    try {
        backup = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Ugyldig backup-fil — kunne ikke parse JSON' });
    }
    return gendanOgSvar(req, res, next, backup);
});

// GET /api/backup/automatisk — klubbens automatiske backups og næste kørsel
router.get('/automatisk', authMiddleware, requireFuldAdgang, async (req, res, next) => {
    try {
        const klub = await aktuelKlub(req);
        if (!klub) return res.json({ aktiv: false, backups: [] });
        const naeste = autoBackup.naesteKoersel();
        res.json({
            aktiv: true,
            naeste: naeste ? naeste.toISOString() : null,
            behold: autoBackup.BEHOLD.auto,
            backups: autoBackup.listBackups(klub.db_name),
        });
    } catch (error) {
        next(error);
    }
});

// Den gemte backup, filnavnet peger på — kun klubbens egne (ellers 404)
async function gemtBackup(req, res) {
    const klub = await aktuelKlub(req);
    const backup = klub ? autoBackup.laesBackup(klub.db_name, req.params.fil) : null;
    if (!backup) res.status(404).json({ error: 'Backuppen findes ikke' });
    return backup;
}

// GET /api/backup/automatisk/:fil — hent en gemt backup som fil
router.get('/automatisk/:fil', authMiddleware, requireFuldAdgang, async (req, res, next) => {
    try {
        const backup = await gemtBackup(req, res);
        if (!backup) return;
        const info = autoBackup.fortolkFilnavn(req.params.fil);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="backup_${req.clubSubdomain}_${tidsstempel(info.tidspunkt)}.json"`);
        res.send(JSON.stringify(backup, null, 2));
    } catch (error) {
        next(error);
    }
});

// POST /api/backup/automatisk/:fil/gendan — gendan en gemt backup
router.post('/automatisk/:fil/gendan', authMiddleware, requireFuldAdgang, async (req, res, next) => {
    let backup;
    try {
        backup = await gemtBackup(req, res);
    } catch (error) {
        return next(error);
    }
    if (!backup) return;
    return gendanOgSvar(req, res, next, backup);
});

module.exports = router;
