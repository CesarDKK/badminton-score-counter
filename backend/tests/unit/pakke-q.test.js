/**
 * Pakke Q — backup og drift (gennemgangen nov. 2026):
 *   57   en slettet klubs backups arves ikke, og en sprunget ugentlig backup indhentes
 *   86   backuppen er et øjebliksbillede
 *   87   backuppen ved, hvilke migrationer den er fra
 *   54   deploy: hurtig nedlukning, sundhedstjek i deploy.sh, versionen i super-admin
 *   53   offentlig helbredsadresse
 *   55   databasens forbindelser og cache af klub-opslaget
 *
 * Ingen database: master-databasen og klub-puljerne erstattes af falske.
 * Backup- og upload-mapperne er midlertidige mapper.
 *
 * Kør: npm run test:unit
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pakke-q-'));
process.env.CLUB_BACKUP_DIR = path.join(TMP, 'club-backups');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-q-mindst-32-tegn';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// ---------- Falsk master-database ----------
const masterDb = require('../../config/masterDatabase');
let masterSvar = async () => [];
const masterKald = [];
masterDb.query = async (sql, params) => { masterKald.push({ sql, params }); return masterSvar(sql, params); };
masterDb.queryOne = async (sql, params) => (await masterDb.query(sql, params))[0] || null;

// ---------- Falske klub-forbindelser (lavBackup/gendanBackup) ----------
// tabeller: { navn: rækker }; log: fælles liste over SQL-kald
function falskForbindelse(tabeller = {}, { log = [], vent = 0, aktive = null } = {}) {
    return {
        log,
        async query(sql, vals) {
            log.push(sql);
            if (aktive) { aktive.nu++; aktive.max = Math.max(aktive.max, aktive.nu); }
            try {
                if (vent) await new Promise(r => setTimeout(r, vent));
                const m = /^SELECT \* FROM `(\w+)`/.exec(sql);
                if (m) return [tabeller[m[1]] || []];
                if (/FROM `?migrations`?/.test(sql)) return [tabeller.migrations || []];
                return [{ affectedRows: 0 }];
            } finally {
                if (aktive) aktive.nu--;
            }
        },
        async beginTransaction() { log.push('BEGIN'); },
        async commit() { log.push('COMMIT'); },
        async rollback() { log.push('ROLLBACK'); },
        release() {},
    };
}

const autoBackup = require('../../config/autoBackup');
const klubBackup = require('../../config/klubBackup');
const slettedeKlubber = require('../../config/slettedeKlubber');
const { UPLOAD_DIR } = require('../../config/sponsorFiler');
const BACKUP_DIR = autoBackup.BACKUP_DIR;

function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode.toUpperCase()} ${sti} findes`);
    const handlers = lag.route.stack;
    return handlers[handlers.length - 1].handle;
}
async function koer(handler, req) {
    const res = { statusKode: 200, krop: null, headers: {},
        status(s) { this.statusKode = s; return this; }, json(j) { this.krop = j; return this; },
        set(k, v) { if (typeof k === 'string') this.headers[k] = v; else Object.assign(this.headers, k); return this; },
        setHeader(k, v) { this.headers[k] = v; }, send(b) { this.krop = b; return this; } };
    let fejl = null;
    await handler({ params: {}, query: {}, body: {}, ...req }, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

// Læg en backup-fil i klubbens mappe (som tagBackup gør)
function lagBackupFil(dbName, type, dato, indhold) {
    const dir = path.join(BACKUP_DIR, dbName);
    fs.mkdirSync(dir, { recursive: true });
    const fil = autoBackup.filnavnFor(type, dato);
    fs.writeFileSync(path.join(dir, fil), zlib.gzipSync(JSON.stringify(indhold)));
    return fil;
}
function lagUpload(dbName, navn = 'sponsor.png') {
    const dir = path.join(UPLOAD_DIR, dbName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, navn), 'billede');
}
const ryd = () => {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
};

const MIN = 60 * 1000;
const DAG = 24 * 60 * MIN;

// ======================= Nr. 57 a: en slettet klubs filer =======================

test('57: flytTilSide flytter backups og upload-mappe til en slettet-mappe uden for listningen', () => {
    ryd();
    lagBackupFil('holte', 'auto', new Date('2026-11-09T01:00:00Z'), { tables: {} });
    lagUpload('holte');
    const navn = slettedeKlubber.flytTilSide({ name: 'Holte', subdomain: 'holte', db_name: 'holte' },
        { nu: new Date('2026-11-16T10:20:30Z') });
    assert.equal(navn, 'slettet-20261116-102030-holte');
    assert.ok(!fs.existsSync(path.join(BACKUP_DIR, 'holte')), 'backup-mappen er væk');
    assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, 'holte')), 'upload-mappen (offentlig under /uploads) er væk');
    assert.equal(fs.readdirSync(path.join(BACKUP_DIR, navn, 'backups')).length, 1, 'backuppen er bevaret');
    assert.ok(fs.existsSync(path.join(BACKUP_DIR, navn, 'uploads', 'sponsor.png')), 'billedet er bevaret');
    const info = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, navn, 'slettet.json'), 'utf8'));
    assert.equal(info.klub, 'Holte');
    assert.equal(info.db_name, 'holte');
    // Mappenavnet kan aldrig være en klubs (et databasenavn har aldrig '-')
    assert.throws(() => autoBackup.klubDir(navn));
    assert.deepEqual(autoBackup.listBackups('holte'), []);
    assert.equal(slettedeKlubber.liste()[0].navn, navn);
    // Intet at flytte → null; to sletninger samme sekund overskriver ikke hinanden
    assert.equal(slettedeKlubber.flytTilSide({ db_name: 'holte' }), null);
    lagUpload('holte');
    assert.equal(slettedeKlubber.flytTilSide({ db_name: 'holte' }, { nu: new Date('2026-11-16T10:20:30Z') }),
        'slettet-20261116-102030-holte-2');
    assert.throws(() => slettedeKlubber.flytTilSide({ db_name: '../x' }));
});

const superAdmin = require('../../routes/superAdmin');

test('57: "Slet klub" flytter klubbens backups og billeder til side; databasen droppes som før', async () => {
    ryd();
    lagBackupFil('holte', 'auto', new Date('2026-11-09T01:00:00Z'), { tables: {} });
    lagUpload('holte');
    const ddl = [];
    const gammelAdmin = masterDb.createAdminConnection;
    masterDb.createAdminConnection = async () => ({ execute: async (s) => ddl.push(s), end: async () => {} });
    masterSvar = async (sql) => (/^SELECT id, name, subdomain, db_name, is_active, created_at FROM clubs/.test(sql)
        ? [{ id: 4, name: 'Holte', subdomain: 'holte', db_name: 'holte', is_active: 0, created_at: new Date('2026-01-01T00:00:00Z') }]
        : { affectedRows: 1 });
    try {
        const r = await koer(rute(superAdmin, 'delete', '/clubs/:id'), { params: { id: '4' } });
        assert.equal(r.statusKode, 200);
        assert.match(r.krop.filerFlyttet, /^slettet-\d{8}-\d{6}-holte$/);
        assert.match(ddl.join(), /DROP DATABASE IF EXISTS `holte`/);
        assert.ok(!fs.existsSync(path.join(BACKUP_DIR, 'holte')));
        assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, 'holte')));
        assert.ok(fs.existsSync(path.join(BACKUP_DIR, r.krop.filerFlyttet, 'uploads', 'sponsor.png')));
    } finally {
        masterDb.createAdminConnection = gammelAdmin;
    }
});

test('57: en ny klub med samme subdomæne starter uden den gamles backups og billeder (rester fra før rettelsen)', async () => {
    ryd();
    // Rester fra en klub, der blev slettet før rettelsen
    lagBackupFil('holte', 'auto', new Date('2026-11-09T01:00:00Z'), { clubDbName: 'holte', tables: {} });
    lagUpload('holte');
    const gammelOpret = masterDb.createClubDatabase;
    masterDb.createClubDatabase = async () => ({ fejl: [] });
    masterSvar = async (sql) => {
        if (/^SELECT id FROM clubs WHERE subdomain/.test(sql)) return [];
        if (/^INSERT INTO clubs/.test(sql)) return { insertId: 9 };
        if (/^SELECT id, name, subdomain, db_name, is_active, created_at FROM clubs WHERE id/.test(sql)) {
            return [{ id: 9, name: 'Holte', subdomain: 'holte', db_name: 'holte', is_active: 1, created_at: new Date() }];
        }
        return [];
    };
    try {
        const r = await koer(rute(superAdmin, 'post', '/clubs'), { body: { name: 'Holte', subdomain: 'holte' } });
        assert.equal(r.statusKode, 201);
        assert.ok(!fs.existsSync(path.join(BACKUP_DIR, 'holte')), 'de gamle backups er flyttet');
        assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, 'holte')), 'de gamle billeder er flyttet');
        assert.equal(slettedeKlubber.liste().length, 1);
        assert.match(slettedeKlubber.liste()[0].grund, /ny klub med samme subdomæne/);
    } finally {
        masterDb.createClubDatabase = gammelOpret;
    }
});

test('57: backupFraAndenKlub — samme navn er ikke nok, oprettelsen skiller klubberne ad', () => {
    const ny = { db_name: 'holte', subdomain: 'holte', created_at: new Date('2026-11-16T09:00:00Z') };
    const gammel = { clubName: 'Holte', clubSubdomain: 'holte', clubDbName: 'holte', timestamp: '2026-11-09T01:00:00.000Z' };
    // Ældre backup uden clubCreatedAt: taget før klubben blev oprettet → den tidligere klubs
    assert.match(klubBackup.backupFraAndenKlub(gammel, ny), /tidligere, slettet klub/);
    // Med clubCreatedAt: kun samme oprettelse er samme klub
    assert.match(klubBackup.backupFraAndenKlub({ ...gammel, timestamp: '2026-11-17T00:00:00Z', clubCreatedAt: '2025-03-01T10:00:00.000Z' }, ny),
        /tidligere/);
    assert.equal(klubBackup.backupFraAndenKlub({ ...gammel, timestamp: '2026-11-17T00:00:00Z', clubCreatedAt: '2026-11-16T09:00:00.000Z' }, ny), null);
    // Taget efter oprettelsen, uden clubCreatedAt (backups fra før pakke Q): klubbens egen
    assert.equal(klubBackup.backupFraAndenKlub({ ...gammel, timestamp: '2026-11-16T12:00:00Z' }, ny), null);
    // Uden created_at (fx demoen) og uden klub i backuppen: som før
    assert.equal(klubBackup.backupFraAndenKlub(gammel, { db_name: 'holte', subdomain: 'holte' }), null);
    assert.equal(klubBackup.backupFraAndenKlub({ timestamp: '2020-01-01T00:00:00Z' }, ny), null);
    // Anden klub: som før
    assert.equal(klubBackup.backupFraAndenKlub(gammel, { ...ny, db_name: 'lyngby', subdomain: 'lyngby' }), 'Holte (holte)');
});

test('57: lavBackup og tagBackup gemmer klubbens oprettelse', async () => {
    ryd();
    const b = await klubBackup.lavBackup(falskForbindelse(), { mappe: 'holte', clubDbName: 'holte', clubCreatedAt: new Date('2026-11-16T09:00:00Z') });
    assert.equal(b.clubCreatedAt, '2026-11-16T09:00:00.000Z');
    const klub = { id: 1, name: 'Holte', subdomain: 'holte', db_name: 'holte', created_at: new Date('2026-11-16T09:00:00Z') };
    const fil = await autoBackup.tagBackup(falskForbindelse(), klub, 'auto');
    const gemt = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(BACKUP_DIR, 'holte', fil))).toString());
    assert.equal(gemt.clubCreatedAt, '2026-11-16T09:00:00.000Z');
    assert.equal(klubBackup.backupFraAndenKlub(gemt, klub), null);
});

const backupRuter = require('../../routes/backup');

test('57: klubbens egen side viser og gendanner aldrig en slettet klubs backups', async () => {
    ryd();
    const oprettet = new Date('2026-11-16T09:00:00Z');
    const gammel = lagBackupFil('holte', 'auto', new Date('2026-11-09T01:00:00Z'),
        { version: '1.0', clubDbName: 'holte', clubSubdomain: 'holte', timestamp: '2026-11-09T01:00:00.000Z', tables: { courts: [] } });
    const egen = lagBackupFil('holte', 'foer-gendannelse', new Date('2026-11-16T10:00:00Z'),
        { version: '1.0', clubDbName: 'holte', clubSubdomain: 'holte', timestamp: '2026-11-16T10:00:00.000Z', tables: { courts: [] } });
    masterSvar = async (sql) => (/FROM clubs WHERE db_name/.test(sql)
        ? [{ id: 9, name: 'Holte', subdomain: 'holte', db_name: 'holte', created_at: oprettet }] : []);
    const req = { accessMode: 'club', clubDbName: 'holte', clubSubdomain: 'holte' };

    const liste = await koer(rute(backupRuter, 'get', '/automatisk'), req);
    assert.deepEqual(liste.krop.backups.map(b => b.fil), [egen], 'kun klubbens egen');

    const hent = await koer(rute(backupRuter, 'get', '/automatisk/:fil'), { ...req, params: { fil: gammel } });
    assert.equal(hent.statusKode, 404);
    const gendan = await koer(rute(backupRuter, 'post', '/automatisk/:fil/gendan'), { ...req, params: { fil: gammel } });
    assert.equal(gendan.statusKode, 404, 'den slettede klubs backup kan ikke gendannes');
    const egenHent = await koer(rute(backupRuter, 'get', '/automatisk/:fil'), { ...req, params: { fil: egen } });
    assert.equal(egenHent.statusKode, 200);

    // Super-admins klubliste tæller kun klubbens egne ugentlige
    lagBackupFil('holte', 'auto', new Date('2026-11-16T11:00:00Z'), {});
    masterSvar = async () => [{ id: 9, name: 'Holte', subdomain: 'holte', db_name: 'holte', created_at: oprettet }];
    const klubber = await koer(rute(superAdmin, 'get', '/clubs'), {});
    assert.equal(klubber.krop[0].auto_backups, 1);
});

test('57: "Gendan fra fil" og super-admin afviser en slettet klubs backup (super-admin kan bekræfte)', () => {
    const g = laes('backend/routes/backup.js');
    assert.match(g, /SELECT id, name, subdomain, db_name, created_at FROM clubs WHERE db_name/);
    const s = laes('backend/routes/superAdmin.js');
    assert.match(s, /SELECT id, name, db_name, subdomain, created_at FROM clubs WHERE id = \?/);
    assert.match(s, /fra && req\.query\.andenKlub !== '1'/);
});

// ======================= Nr. 57 b: indhent den ugentlige backup =======================

test('57: senesteKoersel — den seneste mandag kl. 02.00 dansk tid, sommer og vinter', () => {
    const s = (iso) => autoBackup.senesteKoersel(new Date(iso)).toISOString();
    // Mandag 16. nov. 2026 (vintertid, kl. 02.00 = 01.00 UTC)
    assert.equal(s('2026-11-16T00:59:59Z'), '2026-11-09T01:00:00.000Z', 'lige før — forrige mandag');
    assert.equal(s('2026-11-16T01:00:00Z'), '2026-11-16T01:00:00.000Z');
    assert.equal(s('2026-11-22T23:00:00Z'), '2026-11-16T01:00:00.000Z', 'søndag aften');
    // Sommertid: mandag 15. juni 2026 kl. 02.00 = 00.00 UTC
    assert.equal(s('2026-06-17T12:00:00Z'), '2026-06-15T00:00:00.000Z');
    // Ugen over skiftet til vintertid (søndag 25. okt. 2026)
    assert.equal(s('2026-10-26T00:30:00Z'), '2026-10-19T00:00:00.000Z');
    assert.equal(s('2026-10-26T01:00:00Z'), '2026-10-26T01:00:00.000Z');
});

test('57: manglerUgentlig — kun aktive klubber uden backup siden mandag, og ikke nye klubber', () => {
    ryd();
    const nu = new Date('2026-11-18T12:00:00Z');   // onsdag; seneste mandag 16/11 01.00 UTC
    const klub = (db, oprettet = '2026-01-01T00:00:00Z') => ({ db_name: db, created_at: new Date(oprettet) });
    lagBackupFil('har', 'auto', new Date('2026-11-16T01:00:05Z'), {});
    lagBackupFil('gammel', 'auto', new Date('2026-11-09T01:00:05Z'), {});
    lagBackupFil('kunfoer', 'foer-gendannelse', new Date('2026-11-17T10:00:00Z'), {});
    assert.equal(autoBackup.manglerUgentlig(klub('har'), nu), false);
    assert.equal(autoBackup.manglerUgentlig(klub('gammel'), nu), true);
    assert.equal(autoBackup.manglerUgentlig(klub('ingen'), nu), true);
    assert.equal(autoBackup.manglerUgentlig(klub('kunfoer'), nu), true, 'en "før gendannelse" er ikke den ugentlige');
    assert.equal(autoBackup.manglerUgentlig(klub('ny', '2026-11-17T08:00:00Z'), nu), false, 'oprettet efter mandag');
    // En backup fra en slettet klub med samme navn tæller ikke
    assert.equal(autoBackup.manglerUgentlig(klub('har', '2026-11-17T00:00:00Z'), nu), false, 'ny klub efter mandag mangler intet');
    assert.equal(autoBackup.manglerUgentlig(klub('har', '2026-11-16T05:00:00Z'), new Date('2026-11-24T12:00:00Z')), true);
});

const db = require('../../config/database');
const scheduler = require('../../scheduler');

// Klub-puljen: én falsk forbindelse pr. getConnection; aktive tæller samtidige forespørgsler
function falskPulje(aktive) {
    Object.defineProperty(db, 'pool', {
        configurable: true,
        get: () => ({ getConnection: async () => falskForbindelse({ courts: [{ id: 1 }] }, { vent: 5, aktive }) })
    });
}

test('57: indhentning ved opstart tager kun de manglende — én ad gangen, også mens den ugentlige kører', async () => {
    ryd();
    const nu = new Date();
    const forrigeMandag = autoBackup.senesteKoersel(nu);
    lagBackupFil('har_den', 'auto', new Date(forrigeMandag.getTime() + 5000), {});
    const klubber = [
        { id: 1, name: 'A', subdomain: 'a', db_name: 'mangler_a', created_at: new Date('2026-01-01T00:00:00Z') },
        { id: 2, name: 'B', subdomain: 'b', db_name: 'har_den', created_at: new Date('2026-01-01T00:00:00Z') },
        { id: 3, name: 'C', subdomain: 'c', db_name: 'mangler_c', created_at: new Date('2026-01-01T00:00:00Z') },
        { id: 4, name: 'D', subdomain: 'd', db_name: 'ny_klub', created_at: new Date(forrigeMandag.getTime() + DAG / 2) },
    ].filter(k => k.created_at <= nu);
    masterKald.length = 0;
    masterSvar = async (sql) => (/FROM clubs WHERE is_active = 1/.test(sql) ? klubber : { affectedRows: 1 });
    const aktive = { nu: 0, max: 0 };
    falskPulje(aktive);

    const taget = await scheduler.indhentUgentligBackup({ pauseMs: 1 });
    assert.equal(taget, 2);
    assert.equal(autoBackup.listBackups('mangler_a').length, 1);
    assert.equal(autoBackup.listBackups('mangler_c').length, 1);
    assert.equal(autoBackup.listBackups('har_den').length, 1, 'ikke en gang til');
    assert.equal(autoBackup.listBackups('ny_klub').length, 0, 'oprettet efter mandag');
    assert.ok(masterKald.some(k => /last_auto_backup_at = NOW\(\)/.test(k.sql)), 'udfaldet skrives på klubben');

    // Igen: intet mangler → intet tages
    assert.equal(await scheduler.indhentUgentligBackup({ pauseMs: 1 }), 0);

    // Den ugentlige og indhentningen samtidig: aldrig to backups på én gang
    ryd();
    aktive.max = 0;
    await Promise.all([scheduler.ugentligBackup(), scheduler.indhentUgentligBackup({ pauseMs: 0 })]);
    assert.equal(aktive.max, 1, 'højst én backup ad gangen');
    assert.equal(autoBackup.listBackups('mangler_a').length, 1, 'indhentningen så, at den ugentlige havde taget den');
});

test('57: startUgentligBackup sætter indhentningen i gang efter opstarten', () => {
    const s = laes('backend/scheduler.js');
    const start = s.slice(s.indexOf('function startUgentligBackup('), s.indexOf('function startSkaermLogOprydning('));
    assert.match(start, /setTimeout\(\(\) => \{\s*indhentUgentligBackup\(\)/);
    assert.match(start, /\.unref\(\)/);
    assert.match(s, /return enBackupAdGangen\(async \(\) => \{/);
});

// ======================= Nr. 86: backuppen er et øjebliksbillede =======================

test('86: alle tabeller læses i én CONSISTENT SNAPSHOT-transaktion på samme forbindelse', async () => {
    const conn = falskForbindelse({ courts: [{ id: 1 }] });
    await klubBackup.lavBackup(conn, { mappe: 'holte' });
    const log = conn.log;
    const start = log.findIndex(s => /^START TRANSACTION WITH CONSISTENT SNAPSHOT/.test(s));
    const selects = log.map((s, i) => [s, i]).filter(([s]) => /^SELECT \* FROM/.test(s)).map(([, i]) => i);
    assert.ok(log.indexOf('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ') < start, 'REPEATABLE READ først');
    assert.equal(selects.length, klubBackup.BACKUP_TABLES.length);
    assert.ok(start >= 0 && start < selects[0], 'snapshottet tages før første tabel');
    const commit = log.indexOf('COMMIT');
    assert.ok(commit > selects[selects.length - 1], 'og afsluttes efter sidste tabel');
    assert.equal(log.filter(s => s === 'COMMIT').length, 1);
});

test('86: fejler en tabel, afsluttes transaktionen alligevel (forbindelsen går tilbage til puljen ren)', async () => {
    const log = [];
    const conn = falskForbindelse({}, { log });
    const query = conn.query.bind(conn);
    conn.query = async (sql) => { if (/FROM `match_history`/.test(sql)) { log.push(sql); throw new Error('Lost connection'); } return query(sql); };
    await assert.rejects(klubBackup.lavBackup(conn, { mappe: 'holte' }), /Lost connection/);
    assert.equal(log[log.length - 1], 'COMMIT');
});

test('86: en billedfil, der mangler på disken, vælter ikke backuppen — den noteres i manglendeFiler', async () => {
    ryd();
    lagUpload('holte', 'findes.png');
    const conn = falskForbindelse({
        sponsor_images: [{ id: 1, filename: 'holte/findes.png' }, { id: 2, filename: 'holte/vaek.png' }, { id: 3, filename: 'lyngby/anden.png' }],
        settings: [{ setting_key: 'livestream', setting_value: JSON.stringify({ logo: 'livestream-logo-0123456789abcdef.png' }) }],
    });
    const b = await klubBackup.lavBackup(conn, { mappe: 'holte', clubDbName: 'holte' });
    assert.deepEqual(Object.keys(b.files), ['findes.png']);
    assert.equal(Buffer.from(b.files['findes.png'], 'base64').toString(), 'billede');
    assert.deepEqual(b.manglendeFiler, ['vaek.png', 'livestream-logo-0123456789abcdef.png'], 'en anden klubs fil er ikke "manglende" — den er bare ikke vores');
    assert.equal(b.tables.sponsor_images.length, 3, 'rækkerne er med, som snapshottet gav dem');
    // Uden manglende filer: intet felt
    const ren = await klubBackup.lavBackup(falskForbindelse(), { mappe: 'holte' });
    assert.ok(!('manglendeFiler' in ren));
    // Og en sådan backup kan gendannes
    assert.equal(klubBackup.validerBackup(b), null);
});

test('86/90: pakning og læsning sker uden at holde processen (ingen gzipSync/gunzipSync)', async () => {
    const kilde = laes('backend/config/autoBackup.js');
    assert.doesNotMatch(kilde, /gzipSync\(|gunzipSync\(/);
    // To "før gendannelse"-backups samtidig får hver sit navn (navnet reserveres før pakningen)
    ryd();
    const klub = { id: 1, name: 'Holte', subdomain: 'holte', db_name: 'holte' };
    const [a, b] = await Promise.all([
        autoBackup.tagBackup(falskForbindelse({ courts: [{ id: 1 }] }), klub, 'foer-gendannelse'),
        autoBackup.tagBackup(falskForbindelse({ courts: [{ id: 2 }] }), klub, 'foer-gendannelse'),
    ]);
    assert.notEqual(a, b);
    assert.equal(autoBackup.listBackups('holte').length, 2);
    assert.ok(!fs.readdirSync(path.join(BACKUP_DIR, 'holte')).some(f => f.endsWith('.part')));
    const ids = (await Promise.all([a, b].map(f => autoBackup.laesBackup('holte', f)))).map(x => x.tables.courts[0].id).sort();
    assert.deepEqual(ids, [1, 2]);
});

test('86: Download backup, super-admin og den automatiske går alle gennem lavBackup', () => {
    for (const f of ['backend/routes/backup.js', 'backend/routes/superAdmin.js', 'backend/config/autoBackup.js']) {
        assert.match(laes(f), /lavBackup\(conn, \{/, f);
        assert.doesNotMatch(laes(f), /SELECT \* FROM \`\$\{table\}\`/, `${f} læser ikke selv tabellerne`);
    }
    // Den fulde backup (mysqldump) er allerede ét snapshot
    assert.match(laes('scripts/backup-loop.sh'), /--all-databases --single-transaction/);
});
