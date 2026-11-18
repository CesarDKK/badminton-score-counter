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

// ======================= Nr. 87: backuppen ved, hvilke migrationer den er fra =======================

const dataMigrationer = require('../../config/dataMigrationer');
const ALLE_MIGRATIONER = fs.readdirSync(path.join(ROD, 'backend/migrations')).filter(f => f.endsWith('.sql')).sort();
const migrationsRaekker = (filer) => filer.map(filename => ({ filename }));

test('87: backuppen har den nyeste kørte migration og hele listen — læst i samme snapshot', async () => {
    const conn = falskForbindelse({ migrations: migrationsRaekker(['001_a.sql', '043_ny_standard_skifer.sql', '052_yt_status.sql']) });
    const b = await klubBackup.lavBackup(conn, { mappe: 'holte' });
    assert.equal(b.migration, '052_yt_status.sql');
    assert.deepEqual(b.migrationer, ['001_a.sql', '043_ny_standard_skifer.sql', '052_yt_status.sql']);
    const i = conn.log.findIndex(s => /FROM `migrations`/.test(s));
    assert.ok(i > conn.log.findIndex(s => /^START TRANSACTION/.test(s)) && i < conn.log.indexOf('COMMIT'), 'inde i snapshottet');
    // Uden migrations-tabel: ingen felter (som en ældre backup)
    const uden = falskForbindelse();
    uden.query = async (sql) => { if (/migrations/.test(sql)) throw new Error("Table 'migrations' doesn't exist"); return [[]]; };
    const b2 = await klubBackup.lavBackup(uden, { mappe: 'holte' });
    assert.ok(!('migrationer' in b2) && !('migration' in b2));
});

// Gendan backup i en database, der har kørt alle migrationer; giver SQL-loggen
async function gendanOgLog(backup, { koert = ALLE_MIGRATIONER } = {}) {
    const conn = falskForbindelse({ migrations: migrationsRaekker(koert) });
    const r = await klubBackup.gendanBackup(conn, backup, 'holte');
    return { log: conn.log, r };
}
const LILLA = [['color_primary', '#533483'], ['color_accent', '#e94560'], ['color_bg_dark', '#1a1a2e'],
    ['color_bg_container', '#16213e'], ['color_bg_card', '#252347'], ['theme_name', 'default']]
    .map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

test('87: en backup fra før 043 får Skifer-migrationen kørt på de gendannede data, i samme transaktion', async () => {
    const foer043 = ALLE_MIGRATIONER.filter(f => f < '043');
    const { log, r } = await gendanOgLog({ version: '1.0', timestamp: '2026-11-20T10:00:00Z', migrationer: foer043, tables: { settings: LILLA } });
    assert.deepEqual(r.dataMigrationer, ['043_ny_standard_skifer.sql']);
    const sidsteInsert = log.map((s, i) => [s, i]).filter(([s]) => /^INSERT INTO `settings`/.test(s)).pop()[1];
    const skifer = log.findIndex(s => /SET @gammel_standard/.test(s));
    assert.ok(skifer > sidsteInsert && skifer < log.indexOf('COMMIT'), 'efter indsættelsen, før commit');
    assert.ok(log.some(s => /UPDATE settings SET setting_value = CASE setting_key/.test(s)));
    assert.ok(!log.some(s => /^USE\b/.test(s)));
});

test('87: en backup, der allerede har migrationen, får den ikke igen (aldrig to gange)', async () => {
    const { log, r } = await gendanOgLog({ version: '1.0', timestamp: '2026-11-20T10:00:00Z', migrationer: ALLE_MIGRATIONER, tables: { settings: LILLA } });
    assert.deepEqual(r.dataMigrationer, []);
    assert.ok(!log.some(s => /@gammel_standard/.test(s)));
    // Migrations-tabellen er ikke i backuppen og røres aldrig af gendannelsen
    assert.ok(!klubBackup.BACKUP_TABLES.includes('migrations'));
    assert.ok(!log.some(s => /(INSERT INTO|DELETE FROM) `migrations`/.test(s)));
});

test('87: ældre backups uden listen — afgøres af tidspunktet; uden tidspunkt som i dag', async () => {
    const gammel = await gendanOgLog({ version: '1.0', timestamp: '2026-10-20T10:00:00Z', tables: { settings: LILLA, court_streams: [] } });
    assert.deepEqual(gammel.r.dataMigrationer, ['037_livestream_logo_standard.sql', '043_ny_standard_skifer.sql']);
    const ny = await gendanOgLog({ version: '1.0', timestamp: '2026-11-10T10:00:00Z', tables: { settings: LILLA } });
    assert.deepEqual(ny.r.dataMigrationer, [], 'taget efter 043 kom');
    const ukendt = await gendanOgLog({ version: '1.0', tables: { settings: LILLA } });
    assert.deepEqual(ukendt.r.dataMigrationer, []);
});

test('87: kun hvis backuppen har tabellen, og kun hvis klubbens database selv har kørt migrationen', async () => {
    const uden043 = ALLE_MIGRATIONER.filter(f => f < '043');
    const ingenSettings = await gendanOgLog({ version: '1.0', migrationer: uden043, tables: { courts: [] } });
    assert.deepEqual(ingenSettings.r.dataMigrationer, []);
    const ikkeKoert = await gendanOgLog({ version: '1.0', migrationer: uden043, tables: { settings: LILLA } }, { koert: uden043 });
    assert.deepEqual(ikkeKoert.r.dataMigrationer, [], 'databasen mangler selv 043 (migrationsfejl) — kør den ikke her');
});

test('87: 044 — en ældre backups dubletter får en unik kilde før indsættelsen', async () => {
    const tm = [
        { id: 5, tournament_id: 1, source_match_id: 'K1' }, { id: 3, tournament_id: 1, source_match_id: 'K1' },
        { id: 7, tournament_id: 2, source_match_id: 'K1' }, { id: 8, tournament_id: 1, source_match_id: null },
    ];
    const { r } = await gendanOgLog({ version: '1.0', migrationer: ALLE_MIGRATIONER.filter(f => f < '044'), tables: { tournament_matches: tm } });
    assert.deepEqual(r.dataMigrationer, ['044_unik_turneringskamp_kilde.sql']);
    assert.deepEqual(tm.map(t => t.source_match_id), ['K1~d5', 'K1', 'K1', null], 'den laveste id beholder kilden, som migrationen gør');
});

test('87: listen er ærlig — hver migration, der ændrer data i en backup-tabel, er med eller bevidst fravalgt', () => {
    const dm = new Set(dataMigrationer.DATA_MIGRATIONER.map(m => m.fil));
    for (const fil of ALLE_MIGRATIONER) {
        const sql = laes(`backend/migrations/${fil}`).replace(/--[^\n]*/g, '');
        const tabeller = [...sql.matchAll(/^\s*(?:UPDATE|INSERT(?:\s+IGNORE)?\s+INTO|DELETE\s+FROM|REPLACE\s+INTO)\s+`?(\w+)/gim)].map(m => m[1]);
        const iBackup = tabeller.filter(t => klubBackup.BACKUP_TABLES.includes(t) || t === 'device_tokens');
        if (!iBackup.length) continue;
        assert.ok(dm.has(fil) || dataMigrationer.IKKE_RELEVANTE.has(fil),
            `${fil} ændrer ${iBackup.join(', ')} — tilføj den til DATA_MIGRATIONER i config/dataMigrationer.js (eller IKKE_RELEVANTE med en begrundelse)`);
    }
    for (const m of dataMigrationer.DATA_MIGRATIONER) {
        assert.ok(ALLE_MIGRATIONER.includes(m.fil), `${m.fil} findes`);
        assert.match(m.indfoert, /^\d{4}-\d{2}-\d{2}$/);
        if (!m.sql) assert.ok(dataMigrationer.statements(m).length > 0);
    }
});

// ======================= Nr. 54: deploy =======================

const http = require('http');
const nedlukning = require('../../config/nedlukning');

// En lille server med en live-strøm (som SSE-endpointet) og en langsom forespørgsel
function testServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/stroem') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
            res.write('retry: 2000\n\n');
            const glem = nedlukning.huskStroem(res);
            req.on('close', glem);
        } else if (req.url === '/langsom') {
            setTimeout(() => res.end('svar'), 60000).unref();
        } else {
            res.end('ok');
        }
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}
const aabn = (server, sti) => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: server.address().port, path: sti, agent: false }, (res) => {
        res.resume();
        resolve({ res, slut: new Promise(r => { res.on('end', r); res.on('close', r); res.on('error', r); }) });
    });
    req.on('error', () => resolve({ res: null, slut: Promise.resolve() }));
});

test('54: SIGTERM med åbne live-strømme — lukket, ryddet op og ude på under et sekund', async () => {
    nedlukning._nulstil();
    const server = await testServer();
    const stroemme = await Promise.all([aabn(server, '/stroem'), aabn(server, '/stroem'), aabn(server, '/stroem')]);
    assert.equal(nedlukning.antalStroemme(), 3);
    const raekkefoelge = [];
    let udKode = null;
    const nedluk = nedlukning.lavNedlukning({
        server, log: { log() {}, error() {} },
        oprydning: [async () => raekkefoelge.push('youtube'), async () => { throw new Error('pulje'); }, async () => raekkefoelge.push('puljer')],
        exit: (k) => { udKode = k; }
    });
    const t0 = Date.now();
    const p = nedluk('SIGTERM');
    assert.equal(nedluk('SIGINT'), p, 'et signal mere starter ikke forfra');
    assert.equal(nedlukning.erLukkende(), true);
    await p;
    const tid = Date.now() - t0;
    await Promise.all(stroemme.map(s => s.slut));
    assert.equal(udKode, 0);
    assert.ok(tid < 1000, `ude efter ${tid} ms (før: Dockers 10 s og SIGKILL)`);
    assert.deepEqual(raekkefoelge, ['youtube', 'puljer'], 'en fejl i ét trin stopper ikke de næste');
    assert.equal(nedlukning.antalStroemme(), 0);
    nedlukning._nulstil();
});

test('54: en forespørgsel, der hænger, lukkes efter grace — og et hængende oprydningstrin giver exit(1) til tiden', async () => {
    nedlukning._nulstil();
    const server = await testServer();
    const langsom = aabn(server, '/langsom');
    await new Promise(r => setTimeout(r, 50));
    let udKode = null;
    const t0 = Date.now();
    await nedlukning.lavNedlukning({ server, graceMs: 150, log: { log() {}, error() {} }, exit: (k) => { udKode = k; } })('SIGTERM');
    assert.equal(udKode, 0);
    assert.ok(Date.now() - t0 < 1000);
    await (await langsom).slut;

    nedlukning._nulstil();
    const server2 = await testServer();
    let kode2 = null;
    nedlukning.lavNedlukning({ server: server2, maksMs: 200, log: { log() {}, error() {} },
        oprydning: [() => new Promise(() => {})], exit: (k) => { kode2 = k; } })('SIGTERM');
    await new Promise(r => setTimeout(r, 350));
    assert.equal(kode2, 1, 'loftet under Dockers 10 s holder');
    nedlukning._nulstil();
});

test('54: live-strømmen melder sig til nedlukningen og afviser nye under nedlukning (503)', async () => {
    const gs = laes('backend/routes/gameStates.js');
    const sse = gs.slice(gs.indexOf("router.get('/events/stream'"), gs.indexOf("router.get('/:courtId'"));
    assert.match(sse, /if \(nedlukning\.erLukkende\(\)\) return res\.status\(503\)/);
    assert.match(sse, /const glem = nedlukning\.huskStroem\(res\);/);
    assert.match(sse, /glem\(\);/);
    assert.match(sse, /if \(res\.writableEnded\) return;/, 'ingen write after end fra hjerteslaget');
    const server = laes('backend/server.js');
    assert.match(server, /require\('\.\/config\/nedlukning'\)\.lavNedlukning\(\{/);
    assert.match(server, /masterDatabase'\)\.pool\.end\(\)/);
    assert.match(server, /footballDatabase'\)\.pool\.end\(\)/);
    assert.match(server, /process\.on\('SIGTERM', \(\) => gracefulShutdown\('SIGTERM'\)\)/);
    assert.ok(nedlukning.MAKS_MS < 10000, 'under Dockers stop-timeout');
});

test('54: deploy.sh venter på en sund backend, siger tydeligt fra og rydder kun dangling images', () => {
    const d = laes('deploy.sh');
    const { spawnSync } = require('child_process');
    const syntaks = spawnSync('sh', ['-n', path.join(ROD, 'deploy.sh')]);
    assert.equal(syntaks.status, 0, `sh -n deploy.sh: ${syntaks.stderr}`);
    assert.match(d, /set -eu/);
    assert.match(d, /sh scripts\/ensure-env\.sh/, 'hemmelighederne som før');
    assert.match(d, /http:\/\/127\.0\.0\.1:3000\/health/);
    assert.match(d, /MAKS_VENT=120\n/);
    assert.match(d, /while \[ "\$VENTET" -lt "\$MAKS_VENT" \]/);
    assert.match(d, /\$\(\(VENTET % 10\)\) -eq 0[\s\S]*venter stadig/, 'en livstegn-linje hvert 10. sekund');
    assert.match(d, /FEJL: backenden svarer ikke sundt efter \$MAKS_VENT s[\s\S]*docker compose logs --tail 40 backend[\s\S]*exit 1/);
    assert.doesNotMatch(d, /højst 60 s/);
    assert.match(d, /docker image prune -f/);
    assert.doesNotMatch(d, /prune -a|--all|volume prune|system prune|--volumes|down -v/, 'aldrig noget, der kan slette data');
    // Versionen skrives i deploy-info/ (nr. 110 — før build-args: GIT_SHA/BUILD_TIME)
    assert.match(d, /deploy-info\/version\.json/);
    assert.doesNotMatch(d, /export GIT_SHA|BUILD_TIME/);
    assert.match(d, /rev-parse --short=12 HEAD/);
});

test('54: versionen vises i super-admins helbredskort (nr. 110: fra deploy-info/, ikke bygget ind)', () => {
    // Imaget og deploy-info/ testes i deploy-version.test.js
    const { deployVersion } = require('../../config/hetzner');
    assert.deepEqual(deployVersion('/findes/ikke/version.json'), { sha: 'ukendt', deployet: null });
    const sa = laes('frontend/super-admin-script.js');
    assert.match(sa, /version \$\{escapeHtml\(v\.sha\)\}/);
    assert.match(sa, /v\.deployet \? ` · deployet \$\{escapeHtml\(formatDate\(v\.deployet\)\)\}`/);
    assert.ok(Number(/super-admin-script\.js\?v=(\d+)/.exec(laes('frontend/super-admin.html'))[1]) >= 46, 'versionen er skruet op');
    assert.doesNotMatch(laes('backend/config/hetzner.js'), /child_process|execSync|git rev-parse/, 'backenden kalder ikke git');
});

test('54: et oprydningstrin, der hænger (databasen svarer ikke), springes over efter sit loft — de næste kører', async () => {
    nedlukning._nulstil();
    const server = await testServer();
    const koert = [];
    const hold = setInterval(() => {}, 20);   // i serveren holder andet processen i live; her gør denne
    let udKode = null;
    const t0 = Date.now();
    await nedlukning.lavNedlukning({ server, trinMs: 100, log: { log() {}, error() {} },
        oprydning: [() => new Promise(() => {}), async () => koert.push('puljer')], exit: (k) => { udKode = k; } })('SIGTERM');
    assert.equal(udKode, 0);
    assert.deepEqual(koert, ['puljer']);
    assert.ok(Date.now() - t0 < 1000);
    clearInterval(hold);
    assert.ok(nedlukning.GRACE_MS + 2 * nedlukning.TRIN_MS < nedlukning.MAKS_MS, 'grace + to trin når inden loftet');
    nedlukning._nulstil();
});

// ======================= Nr. 53: offentlig helbredsadresse =======================

const { lavHelbred } = require('../../config/offentligHelbred');

test('53: /api/health — 200 kun når opstarten er færdig og master-databasen svarer; ingen detaljer', async () => {
    let dbKald = 0;
    const ok = lavHelbred({ master: async () => { dbKald++; return [{ 1: 1 }]; }, klar: () => true });
    const r = await koer(ok.rute, {});
    assert.equal(r.statusKode, 200);
    assert.deepEqual(r.krop, { status: 'ok' });
    assert.equal(r.headers['Cache-Control'], 'no-store');

    const nede = lavHelbred({ master: async () => { throw new Error('connect ECONNREFUSED 172.18.0.2:3306 (badminton_user)'); }, klar: () => true });
    const r2 = await koer(nede.rute, {});
    assert.equal(r2.statusKode, 503);
    assert.deepEqual(r2.krop, { status: 'fejl' }, 'ingen adresse, bruger eller fejltekst');

    const starter = lavHelbred({ master: async () => [], klar: () => false });
    assert.equal((await koer(starter.rute, {})).statusKode, 503, 'opstarten er ikke færdig');

    const haenger = lavHelbred({ master: () => new Promise(() => {}), klar: () => true, loftMs: 50 });
    const t0 = Date.now();
    assert.equal((await koer(haenger.rute, {})).statusKode, 503);
    assert.ok(Date.now() - t0 < 1000, 'en database, der ikke svarer, giver 503 efter loftet');
});

test('53: svaret huskes i 5 s, og samtidige kald deler ét tjek — adressen kan ikke belaste databasen', async () => {
    let dbKald = 0;
    let klokke = 1_000_000;
    const h = lavHelbred({ master: async () => { dbKald++; await new Promise(r => setTimeout(r, 10)); }, klar: () => true, nu: () => klokke });
    await Promise.all(Array.from({ length: 50 }, () => h.tjek()));
    assert.equal(dbKald, 1, '50 samtidige kald → ét tjek');
    for (let i = 0; i < 20; i++) { klokke += 200; await h.tjek(); }
    assert.equal(dbKald, 1, 'inden for 5 s → fra hukommelsen');
    klokke += 1000;
    await h.tjek();
    assert.equal(dbKald, 2, 'efter 5 s → nyt tjek');
});

test('53: ruten står før klub-opslaget og nås gennem nginx\' /api/ på app.-domænet', () => {
    const s = laes('backend/server.js');
    const rute = s.indexOf("app.get('/api/health', require('./config/offentligHelbred').rute)");
    assert.ok(rute > 0 && rute < s.indexOf("app.use(require('./middleware/tenant'))"), 'før tenant-middlewaren');
    assert.match(s, /app\.get\('\/health'/, 'Dockers interne /health er uændret');
    const nginx = laes('nginx.conf');
    const app = nginx.slice(nginx.indexOf('listen 80 default_server'));
    assert.match(app, /location \/api\/ \{[\s\S]*?proxy_pass \$backend;/);
    assert.match(laes('deploy.sh'), /wget -q -O \/dev\/null http:\/\/127\.0\.0\.1\/api\/health/);
});

// ======================= Nr. 55: databasens forbindelser og klub-opslaget =======================

const dbForbindelser = require('../../config/dbForbindelser');
const klubOpslag = require('../../config/klubOpslag');

test('55: forbindelserne — åbne, loftet, puljerne, og advarsel over 80 %', async () => {
    assert.equal(dbForbindelser.vurder({ aabne: 120, maks: 300, klubPuljer: 4, puljeStoerrelse: 15 }).niveau, null);
    const v = dbForbindelser.vurder({ aabne: 241, maks: 300, klubPuljer: 12, puljeStoerrelse: 15 });
    assert.equal(v.niveau, 'advarsel');
    assert.match(v.besked, /80 %/);
    assert.equal(dbForbindelser.vurder({ aabne: 290, maks: 300 }).niveau, 'kritisk');

    const sql = [];
    const pool = { query: async (s) => { sql.push(s); return /Threads_connected/.test(s)
        ? [[{ Variable_name: 'Threads_connected', Value: '37' }]] : [[{ maks: 300 }]]; } };
    const s = await dbForbindelser.status({ masterPool: () => pool, klubPuljer: () => 6 });
    assert.deepEqual({ aabne: s.aabne, maks: s.maks, klubPuljer: s.klubPuljer, puljeStoerrelse: s.puljeStoerrelse }, { aabne: 37, maks: 300, klubPuljer: 6, puljeStoerrelse: 15 });
    assert.equal(s.niveau, null);
    assert.deepEqual(sql, ["SHOW GLOBAL STATUS LIKE 'Threads_connected'", 'SELECT @@GLOBAL.max_connections AS maks']);
    assert.equal(typeof require('../../config/tenantPools').antalPuljer(), 'number');
});

test('55: helbredskortet viser forbindelserne (og kan undvære dem)', async () => {
    const h = laes('backend/config/hetzner.js');
    assert.match(h, /try \{ svar\.lokal\.database = await require\('\.\/dbForbindelser'\)\.status\(\); \} catch \{ svar\.lokal\.database = null; \}/);
    const sa = laes('frontend/super-admin-script.js');
    assert.match(sa, /shFlise\('Databaseforbindelser'/);
    assert.match(sa, /db\.andel, db\.niveau \|\| ''/);
});

test('55: max_connections hæves i MySQL\'s opsætning — volumes og porte er uændrede', () => {
    const c = laes('docker-compose.yml');
    const mysqlDel = c.slice(c.indexOf('  mysql:'), c.indexOf('  backend:'));
    assert.match(mysqlDel, /command: \["--max-connections=\$\{MYSQL_MAX_CONNECTIONS:-300\}"\]/);
    assert.match(mysqlDel, /stop_grace_period: 60s/, 'MySQL lukker rent, når compose genskaber den');
    const backendDel = c.slice(c.indexOf('\n  backend:'), c.indexOf('\n  frontend:'));
    assert.ok(backendDel.length > 100);
    assert.doesNotMatch(backendDel, /stop_grace_period/, 'backenden beholder Dockers 10 s');
    assert.match(mysqlDel, /- "127\.0\.0\.1:3306:3306"/);
    assert.match(mysqlDel, /- mysql_data:\/var\/lib\/mysql/);
    for (const v of ['mysql_data', 'uploads_data', 'football_uploads', 'stats_cache', 'club_backups', 'backups']) {
        assert.match(c.slice(c.lastIndexOf('\nvolumes:')), new RegExp(`\n  ${v}:\r?\n    driver: local`), v);
    }
});

const tenant = require('../../middleware/tenant');
async function viaTenant(host) {
    const req = { hostname: host };
    const res = { statusKode: 200, status(s) { this.statusKode = s; return this; }, send() { return this; }, json() { return this; } };
    let videre = false;
    await tenant(req, res, () => { videre = true; });
    return { status: videre ? 200 : res.statusKode, db: req.clubDbName };
}

test('55: klub-opslaget huskes 30 s — og en deaktivering lukker klubben med det samme', async () => {
    process.env.APP_DOMAIN = 'badmintonapp.dk';
    klubOpslag.glemKlubber();
    let aktiv = 1;
    let opslag = 0;
    masterSvar = async (sql) => {
        if (/SELECT db_name, is_active FROM clubs WHERE subdomain/.test(sql)) { opslag++; return [{ db_name: 'holte', is_active: aktiv }]; }
        if (/SELECT id, is_active FROM clubs WHERE id/.test(sql)) return [{ id: 4, is_active: aktiv }];
        if (/^UPDATE clubs SET is_active/.test(sql)) { aktiv = 0; return { affectedRows: 1 }; }
        return [];
    };
    try {
        for (let i = 0; i < 20; i++) assert.deepEqual(await viaTenant('holte.badmintonapp.dk'), { status: 200, db: 'holte' });
        assert.equal(opslag, 1, '20 forespørgsler → ét opslag i master-databasen');

        // Super-admin deaktiverer: næste forespørgsel afvises — uden at vente 30 s
        await koer(rute(superAdmin, 'put', '/clubs/:id/toggle'), { params: { id: '4' } });
        assert.equal((await viaTenant('holte.badmintonapp.dk')).status, 403);
        assert.equal(opslag, 2);
    } finally {
        delete process.env.APP_DOMAIN;
        klubOpslag.glemKlubber();
    }
});

test('55: cachen udløber efter 30 s, husker "findes ikke", men aldrig en fejl — og vokser ikke uden loft', async () => {
    klubOpslag.glemKlubber();
    let opslag = 0;
    let fejl = false;
    masterSvar = async (sql, params) => {
        opslag++;
        if (fejl) throw new Error('master nede');
        return params[0] === 'holte' ? [{ db_name: 'holte', is_active: 1 }] : [];
    };
    const t = 5_000_000;
    await klubOpslag.slaaOp('holte', t);
    await klubOpslag.slaaOp('holte', t + 29_000);
    assert.equal(opslag, 1);
    await klubOpslag.slaaOp('holte', t + 31_000);
    assert.equal(opslag, 2, 'efter 30 s slås den op igen');
    assert.equal(await klubOpslag.slaaOp('ukendt', t), null);
    assert.equal(await klubOpslag.slaaOp('ukendt', t + 1000), null);
    assert.equal(opslag, 3, '"findes ikke" huskes også');
    fejl = true;
    await assert.rejects(klubOpslag.slaaOp('ny', t));
    fejl = false;
    assert.deepEqual(await klubOpslag.slaaOp('ny', t), null);
    assert.equal(opslag, 5, 'fejlen blev ikke husket');
    for (let i = 0; i < klubOpslag.MAKS + 10; i++) await klubOpslag.slaaOp(`tilfaeldig${i}`, t);
    assert.ok(klubOpslag._antal() <= klubOpslag.MAKS);
    // Oprettelse og sletning tømmer også cachen
    const s = laes('backend/routes/superAdmin.js');
    assert.ok((s.match(/klubOpslag\.glemKlubber\(\);/g) || []).length >= 3);
    klubOpslag.glemKlubber();
});
