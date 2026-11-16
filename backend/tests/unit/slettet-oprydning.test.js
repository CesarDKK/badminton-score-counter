/**
 * En slettet klubs gemte filer (club-backups/slettet-*) slettes automatisk efter
 * 60 dage (Jesper 2026-11-16, tillæg til pakke Q nr. 57).
 * config/slettedeKlubber.js rydGamle + scheduler.js startSlettetOprydning.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slettet-oprydning-'));
process.env.CLUB_BACKUP_DIR = path.join(TMP, 'club-backups');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');

const slettedeKlubber = require('../../config/slettedeKlubber');
const { BACKUP_DIR } = require('../../config/autoBackup');
const { UPLOAD_DIR } = require('../../config/sponsorFiler');

const ROD = path.join(__dirname, '..', '..', '..');
const DAG = 24 * 60 * 60 * 1000;
const NU = new Date('2026-11-16T03:45:00Z');
// Ingen klubber i master-databasen: kun navnereglen og de andre tjek gælder
const INGEN = new Set();

function ryd() {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// En mappe med en backup og evt. slettet.json ({ flyttet } eller rå tekst)
function lagMappe(navn, info) {
    const sti = path.join(BACKUP_DIR, navn);
    fs.mkdirSync(path.join(sti, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(sti, 'backups', 'auto-x.json.gz'), 'x');
    if (info !== undefined) {
        fs.writeFileSync(path.join(sti, 'slettet.json'), typeof info === 'string' ? info : JSON.stringify(info));
    }
    return sti;
}

function stille() {
    const linjer = { log: [], warn: [], error: [] };
    return {
        linjer,
        log: (...a) => linjer.log.push(a.join(' ')),
        warn: (...a) => linjer.warn.push(a.join(' ')),
        error: (...a) => linjer.error.push(a.join(' ')),
    };
}

const findes = (navn) => fs.existsSync(path.join(BACKUP_DIR, navn));

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('60 dage, og slettet.json fortæller fristen (slettes = flyttet + 60 dage)', () => {
    ryd();
    assert.equal(slettedeKlubber.SLETTET_BEHOLD_DAGE, 60);
    fs.mkdirSync(path.join(BACKUP_DIR, 'holte'), { recursive: true });
    const navn = slettedeKlubber.flytTilSide({ name: 'Holte', subdomain: 'holte', db_name: 'holte' },
        { nu: new Date('2026-11-16T10:20:30Z') });
    const info = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, navn, 'slettet.json'), 'utf8'));
    assert.equal(info.flyttet, '2026-11-16T10:20:30.000Z');
    assert.equal(info.slettes, '2027-01-15T10:20:30.000Z');
    // ... og mapperne laves ellers som før
    assert.deepEqual(Object.keys(info), ['klub', 'subdomain', 'db_name', 'oprettet', 'flyttet', 'slettes', 'grund']);
});

test('ældre end 60 dage efter slettet.json slettes og logges med navn, klub og alder; yngre beholdes', () => {
    ryd();
    lagMappe('slettet-20260901-100000-gammel', { klub: 'Gammel BK', db_name: 'gammel', flyttet: '2026-09-01T10:00:00.000Z' });
    lagMappe('slettet-20261001-100000-ung', { klub: 'Ung BK', db_name: 'ung', flyttet: '2026-10-01T10:00:00.000Z' });
    // Præcis 60 dage: slettes; 1 s før: beholdes
    lagMappe('slettet-20260917-034500-grænse', undefined);   // ugyldigt navn (æ) → røres aldrig
    lagMappe('slettet-20260917-034500-paa', { flyttet: new Date(NU.getTime() - 60 * DAG).toISOString() });
    lagMappe('slettet-20260917-034501-lige', { flyttet: new Date(NU.getTime() - 60 * DAG + 1000).toISOString() });
    const l = stille();
    const r = slettedeKlubber.rydGamle({ nu: NU, log: l, klubMapper: INGEN });
    assert.deepEqual(r.slettet.sort(), ['slettet-20260901-100000-gammel', 'slettet-20260917-034500-paa']);
    assert.deepEqual(r.beholdt.sort(), ['slettet-20260917-034501-lige', 'slettet-20261001-100000-ung']);
    assert.ok(!findes('slettet-20260901-100000-gammel'));
    assert.ok(findes('slettet-20261001-100000-ung'));
    assert.ok(findes('slettet-20260917-034500-grænse'));
    assert.match(l.linjer.log.join('\n'), /slettet-20260901-100000-gammel \(klub Gammel BK, 75 dage gammel efter slettet\.json\)/);
});

test('"flyttet" i slettet.json går forud for navnet; mangler/ulæselig fil → navnets tidsstempel', () => {
    ryd();
    // Navnet er gammelt, men slettet.json siger for nylig → beholdes
    lagMappe('slettet-20250101-000000-navngammel', { flyttet: '2026-11-01T00:00:00.000Z' });
    // Ingen slettet.json, gammelt navn → slettes efter navnet
    lagMappe('slettet-20260801-120000-udeninfo', undefined);
    // Ulæselig slettet.json, gammelt navn → slettes efter navnet
    lagMappe('slettet-20260801-120000-ulaeselig', '{ikke json');
    // slettet.json uden gyldig dato → navnet
    lagMappe('slettet-20261110-120000-baddato', { flyttet: 'i går' });
    const l = stille();
    const r = slettedeKlubber.rydGamle({ nu: NU, log: l, klubMapper: INGEN });
    assert.deepEqual(r.slettet.sort(), ['slettet-20260801-120000-udeninfo', 'slettet-20260801-120000-ulaeselig']);
    assert.deepEqual(r.beholdt.sort(), ['slettet-20250101-000000-navngammel', 'slettet-20261110-120000-baddato']);
    assert.match(l.linjer.log.join('\n'), /udeninfo \(klub \?, 106 dage gammel efter mappenavnet\)/);
});

test('aldrig filsystemets mtime: en gammel mtime på en ny mappe sletter den ikke', () => {
    ryd();
    const sti = lagMappe('slettet-20261110-120000-nymtime', { flyttet: '2026-11-10T12:00:00.000Z' });
    const gammel = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(sti, gammel, gammel);
    fs.utimesSync(path.join(sti, 'slettet.json'), gammel, gammel);
    const r = slettedeKlubber.rydGamle({ nu: NU, log: stille(), klubMapper: INGEN });
    assert.deepEqual(r.slettet, []);
    assert.ok(findes('slettet-20261110-120000-nymtime'));
    assert.doesNotMatch(fs.readFileSync(path.join(ROD, 'backend/config/slettedeKlubber.js'), 'utf8'), /\.mtime|mtimeMs|\.ctime|birthtime/);
});

test('kan alderen ikke afgøres, røres mappen ikke (og der advares)', () => {
    ryd();
    // Navnet matcher formen, men er ingen dato (måned 13) og slettet.json mangler
    lagMappe('slettet-20261301-120000-umulig', undefined);
    assert.equal(slettedeKlubber.navnetsTid('slettet-20261301-120000-umulig'), null);
    assert.equal(slettedeKlubber.navnetsTid('slettet-20261116-102030-holte').toISOString(), '2026-11-16T10:20:30.000Z');
    const l = stille();
    const r = slettedeKlubber.rydGamle({ nu: new Date('2030-01-01T00:00:00Z'), log: l, klubMapper: INGEN });
    assert.deepEqual(r.slettet, []);
    assert.deepEqual(r.sprunget, ['slettet-20261301-120000-umulig']);
    assert.ok(findes('slettet-20261301-120000-umulig'));
    assert.match(l.linjer.warn.join('\n'), /alderen på slettet-20261301-120000-umulig kan ikke afgøres/);
});

test('aktive klubbers mapper kan aldrig matche — heller ikke en klub, hvis db_name begynder med "slettet"', () => {
    ryd();
    const aktive = ['holte', 'slettet', 'slettet_bk', 'slettet20260101', 'slettet_20260101_000000_x', 'club_42'];
    for (const db of aktive) {
        assert.doesNotMatch(db, slettedeKlubber.SLETTET_NAVN, db);
        fs.mkdirSync(path.join(BACKUP_DIR, db, ''), { recursive: true });
        fs.writeFileSync(path.join(BACKUP_DIR, db, 'auto-2020-01-01.json.gz'), 'x');
        // selv med en gammel slettet.json i mappen
        fs.writeFileSync(path.join(BACKUP_DIR, db, 'slettet.json'), JSON.stringify({ flyttet: '2020-01-01T00:00:00Z' }));
    }
    // Andre navne, der ligner, men ikke har præcis formen
    for (const n of ['slettet-20200101-000000-', 'slettet-20200101-000000-a-b', 'slettet-2020011-000000-x',
        'slettet-20200101-000000-x-', 'slettet-20200101-000000-x.bak', 'Slettet-20200101-000000-x',
        'slettet-20200101-000000-x-2-3', 'xslettet-20200101-000000-x']) {
        assert.doesNotMatch(n, slettedeKlubber.SLETTET_NAVN, n);
        lagMappe(n, { flyttet: '2020-01-01T00:00:00Z' });
    }
    assert.match('slettet-20200101-000000-x-2', slettedeKlubber.SLETTET_NAVN);
    const r = slettedeKlubber.rydGamle({ nu: NU, log: stille(), klubMapper: INGEN });
    assert.deepEqual(r, { slettet: [], beholdt: [], sprunget: [], fejl: [] });
    for (const db of aktive) assert.ok(fs.existsSync(path.join(BACKUP_DIR, db, 'auto-2020-01-01.json.gz')), db);
    // Og en rigtig slettet klub, hvis db_name begynder med "slettet", ryddes som andre
    fs.mkdirSync(path.join(UPLOAD_DIR, 'slettet_bk'), { recursive: true });
    const navn = slettedeKlubber.flytTilSide({ name: 'Slettet BK', db_name: 'slettet_bk' }, { nu: new Date('2026-08-01T00:00:00Z') });
    assert.equal(navn, 'slettet-20260801-000000-slettet_bk');
    assert.deepEqual(slettedeKlubber.rydGamle({ nu: NU, log: stille(), klubMapper: INGEN }).slettet, [navn]);
    assert.ok(!fs.existsSync(path.join(BACKUP_DIR, 'slettet_bk')), 'flyttet til side før — derfor væk');
});

test('kun rigtige mapper: en fil eller et symlink med det rigtige navn røres ikke, og målet bevares', (t) => {
    ryd();
    // En fil med navnet
    fs.writeFileSync(path.join(BACKUP_DIR, 'slettet-20200101-000000-fil'), 'x');
    // Et symlink med navnet, der peger på en aktiv klubs mappe
    fs.mkdirSync(path.join(BACKUP_DIR, 'holte'));
    fs.writeFileSync(path.join(BACKUP_DIR, 'holte', 'auto-1.json.gz'), 'x');
    let link = true;
    try { fs.symlinkSync(path.join(BACKUP_DIR, 'holte'), path.join(BACKUP_DIR, 'slettet-20200101-000000-link'), 'dir'); }
    catch { link = false; }
    // Et symlink ud af BACKUP_DIR
    const ude = path.join(TMP, 'udenfor');
    fs.mkdirSync(ude, { recursive: true });
    fs.writeFileSync(path.join(ude, 'vigtig.txt'), 'x');
    fs.writeFileSync(path.join(ude, 'slettet.json'), JSON.stringify({ flyttet: '2020-01-01T00:00:00Z' }));
    if (link) fs.symlinkSync(ude, path.join(BACKUP_DIR, 'slettet-20200101-000000-ud'), 'dir');
    // Et symlink INDE i en gammel slettet-mappe: mappen slettes, men ikke det, linket peger på
    const gammel = lagMappe('slettet-20200101-000000-medlink', { flyttet: '2020-01-01T00:00:00Z' });
    if (link) fs.symlinkSync(ude, path.join(gammel, 'uploads'), 'dir');

    const l = stille();
    const r = slettedeKlubber.rydGamle({ nu: NU, log: l, klubMapper: INGEN });
    assert.deepEqual(r.slettet, ['slettet-20200101-000000-medlink']);
    assert.ok(fs.existsSync(path.join(BACKUP_DIR, 'slettet-20200101-000000-fil')));
    assert.ok(fs.existsSync(path.join(BACKUP_DIR, 'holte', 'auto-1.json.gz')), 'den aktive klubs backup');
    assert.ok(fs.existsSync(path.join(ude, 'vigtig.txt')), 'intet uden for mappen');
    if (link) {
        assert.ok(fs.lstatSync(path.join(BACKUP_DIR, 'slettet-20200101-000000-link')).isSymbolicLink());
        assert.deepEqual(r.sprunget.sort(), ['slettet-20200101-000000-fil', 'slettet-20200101-000000-link', 'slettet-20200101-000000-ud']);
    } else {
        t.diagnostic('symlinks kunne ikke laves her — kun fil-tilfældet afprøvet');
    }
});

test('en fejl på én mappe stopper ikke de næste', () => {
    ryd();
    for (const n of ['a', 'b', 'c']) lagMappe(`slettet-20200101-000000-${n}`, { flyttet: '2020-01-01T00:00:00Z' });
    const rm = fs.rmSync;
    fs.rmSync = (sti, ...rest) => {
        if (String(sti).endsWith('-b')) throw new Error('EBUSY: optaget');
        return rm(sti, ...rest);
    };
    let r;
    const l = stille();
    try { r = slettedeKlubber.rydGamle({ nu: NU, log: l, klubMapper: INGEN }); } finally { fs.rmSync = rm; }
    assert.deepEqual(r.slettet, ['slettet-20200101-000000-a', 'slettet-20200101-000000-c']);
    assert.deepEqual(r.fejl, ['slettet-20200101-000000-b']);
    assert.ok(findes('slettet-20200101-000000-b'));
    assert.match(l.linjer.error.join('\n'), /slettet-20200101-000000-b fejlede/);
});

test('ingen club-backups-mappe → intet sker', () => {
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
    assert.deepEqual(slettedeKlubber.rydGamle({ nu: NU, log: stille(), klubMapper: INGEN }), { slettet: [], beholdt: [], sprunget: [], fejl: [] });
});

test('natjobbet: kl. 04:45 dansk tid, i backup-køen, ikke ved opstarten', async () => {
    const scheduler = require('../../scheduler');
    assert.equal(scheduler.SLETTET_OPRYDNING_CRON, '45 4 * * *');
    const kilde = fs.readFileSync(path.join(ROD, 'backend/scheduler.js'), 'utf8');
    const fn = kilde.slice(kilde.indexOf('function startSlettetOprydning'), kilde.indexOf('function startSlettetOprydning') + 500);
    assert.match(fn, /cron\.schedule\(SLETTET_OPRYDNING_CRON[\s\S]*timezone: 'Europe\/Copenhagen'/);
    assert.doesNotMatch(fn.slice(0, fn.indexOf('cron.schedule')), /slettetOprydning\(/, 'kører ikke ved opstarten');
    // Ikke oveni 02:00-backuppen (mandag), 03:40-YouTube eller de andre natjob
    for (const [, tid] of kilde.matchAll(/cron\.schedule\('(\d+ \d+ \* \* [\d*])'/g)) {
        assert.notEqual(tid.split(' ').slice(0, 2).join(' '), '45 4', `${tid} støder sammen`);
    }
    assert.match(kilde, /cron\.schedule\('0 2 \* \* 1'/);
    assert.match(kilde, /cron\.schedule\('40 3 \* \* \*'/);
    assert.match(kilde, /return enBackupAdGangen\(async \(\) => \{[\s\S]*?rydGamle\(\{ nu: nu\(\), log, klubMapper \}\)/);
    const server = fs.readFileSync(path.join(ROD, 'backend/server.js'), 'utf8');
    assert.match(server, /startSkaermLogOprydning\(\);\s+startSlettetOprydning\(\);/);

    ryd();
    lagMappe('slettet-20200101-000000-job', { flyttet: '2020-01-01T00:00:00Z' });
    const r = await medMaster(async () => [{ db_name: 'holte' }], (kald) =>
        scheduler.slettetOprydning({ nu: () => NU, log: stille() }).then(r => {
            assert.deepEqual(kald, ['SELECT db_name FROM clubs'], 'alle klubber, også deaktiverede');
            return r;
        }));
    assert.deepEqual(r.slettet, ['slettet-20200101-000000-job']);
});

// ======================= Værnet: klublisten fra master-databasen =======================

// Kør fn med masterDatabase.query udskiftet; fn får listen af SQL-kald
async function medMaster(svar, fn) {
    const master = require('../../config/masterDatabase');
    const gammel = master.query;
    const kald = [];
    master.query = async (sql, ...rest) => { kald.push(sql); return svar(sql, ...rest); };
    try { return await fn(kald); } finally { master.query = gammel; }
}

// En klub, hvis db_name (mod konventionen) har præcis en slettet-mappes form
const KONSTRUERET = 'slettet-20260101-101010-x';

test('værn: en mappe med en klubs db_name røres aldrig — også når navnet ligner en gammel slettet-mappe', () => {
    ryd();
    assert.match(KONSTRUERET, slettedeKlubber.SLETTET_NAVN, 'navnereglen alene ville have ramt den');
    lagMappe(KONSTRUERET, { flyttet: '2026-01-01T10:10:10.000Z' });   // over 60 dage
    lagMappe('slettet-20260101-101010-y', { flyttet: '2026-01-01T10:10:10.000Z' });
    // Også deaktiverede klubber står i listen; store/små bogstaver gør ingen forskel
    lagMappe('SLETTET-20260101-101010-Z'.replace('SLETTET', 'slettet'), { flyttet: '2026-01-01T10:10:10.000Z' });
    const l = stille();
    const r = slettedeKlubber.rydGamle({ nu: NU, log: l, klubMapper: new Set([KONSTRUERET, 'holte', 'slettet-20260101-101010-z']) });
    assert.deepEqual(r.slettet, ['slettet-20260101-101010-y']);
    assert.deepEqual(r.sprunget.sort(), ['slettet-20260101-101010-Z', KONSTRUERET].sort());
    assert.ok(findes(KONSTRUERET));
    assert.ok(fs.existsSync(path.join(BACKUP_DIR, KONSTRUERET, 'backups', 'auto-x.json.gz')));
    assert.match(l.linjer.warn.join('\n'), new RegExp(`${KONSTRUERET} er en klubs egen mappe — røres ikke`));
});

test('værn: natjobbet giver alle klubbers db_name videre — den konstruerede klub bliver stående', async () => {
    ryd();
    lagMappe(KONSTRUERET, { flyttet: '2026-01-01T10:10:10.000Z' });
    lagMappe('slettet-20260101-101010-y', { flyttet: '2026-01-01T10:10:10.000Z' });
    const r = await medMaster(async () => [{ db_name: 'holte' }, { db_name: KONSTRUERET }],
        () => require('../../scheduler').slettetOprydning({ nu: () => NU, log: stille() }));
    assert.deepEqual(r.slettet, ['slettet-20260101-101010-y']);
    assert.deepEqual(r.sprunget, [KONSTRUERET]);
    assert.ok(findes(KONSTRUERET));
});

test('værn: svarer master-databasen ikke (eller svarer forkert), slettes intet den nat', async () => {
    const scheduler = require('../../scheduler');
    for (const svar of [async () => { throw new Error('connect ECONNREFUSED'); }, async () => undefined, async () => ({})]) {
        ryd();
        lagMappe('slettet-20200101-000000-gammel', { flyttet: '2020-01-01T00:00:00Z' });
        const l = stille();
        const r = await medMaster(svar, () => scheduler.slettetOprydning({ nu: () => NU, log: l }));
        assert.deepEqual(r.slettet, []);
        assert.equal(r.afvist, 'klublisten kunne ikke hentes');
        assert.ok(findes('slettet-20200101-000000-gammel'));
        assert.match(l.linjer.error.join('\n'), /klublisten kunne ikke hentes — intet slettes i nat/);
    }
});

test('værn: rydGamle uden klubliste (eller med en forkert type) sletter intet', () => {
    for (const arg of [{}, { klubMapper: undefined }, { klubMapper: null }, { klubMapper: ['holte'] }, { klubMapper: 'holte' }]) {
        ryd();
        lagMappe('slettet-20200101-000000-gammel', { flyttet: '2020-01-01T00:00:00Z' });
        const l = stille();
        const r = slettedeKlubber.rydGamle({ nu: NU, log: l, ...arg });
        assert.deepEqual(r, { slettet: [], beholdt: [], sprunget: [], fejl: [], afvist: 'klublisten mangler' });
        assert.ok(findes('slettet-20200101-000000-gammel'));
        assert.match(l.linjer.warn.join('\n'), /uden klublisten — intet slettes/);
    }
    // Og helt uden argumenter (standard-loggen) kaster den ikke
    ryd();
    lagMappe('slettet-20200101-000000-gammel', { flyttet: '2020-01-01T00:00:00Z' });
    const warn = console.warn;
    console.warn = () => {};
    try { assert.equal(slettedeKlubber.rydGamle().afvist, 'klublisten mangler'); } finally { console.warn = warn; }
    assert.ok(findes('slettet-20200101-000000-gammel'));
});
