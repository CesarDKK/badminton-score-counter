/**
 * Unit-tests af klubbernes backup — formatet og gendannelsen (config/klubBackup.js)
 * og den automatiske ugentlige backup (config/autoBackup.js). Ingen database:
 * forbindelsen er en falsk, der husker sine SQL-kald.
 *
 * Kør: npm run test:unit
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'klub-backup-'));
process.env.CLUB_BACKUP_DIR = path.join(TMP, 'backups');
process.env.UPLOAD_DIR = path.join(TMP, 'uploads');

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { BACKUP_TABLES, lavBackup, validerBackup, gendanBackup, BackupFejl } = require('../../config/klubBackup');
const autoBackup = require('../../config/autoBackup');

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Falsk mysql2-forbindelse: SELECT giver data fra `tabeller`, alt huskes i `kald`
function falskForbindelse(tabeller = {}, { fejlVed } = {}) {
    const kald = [];
    return {
        kald,
        async query(sql, vals) {
            kald.push(sql);
            if (fejlVed && sql.includes(fejlVed)) throw new Error('INSERT fejlede');
            const m = /^SELECT \* FROM `(\w+)`/.exec(sql);
            return [m ? (tabeller[m[1]] || []) : { affectedRows: 0 }];
        },
        async beginTransaction() { kald.push('BEGIN'); },
        async commit() { kald.push('COMMIT'); },
        async rollback() { kald.push('ROLLBACK'); },
    };
}

const KLUB = { id: 1, name: 'Lyngby', subdomain: 'lyngby', db_name: 'lyngby' };

// ── Indholdet ─────────────────────────────────────────────────────────────

test('turneringer og spiller-logoer er med; klub-admins er ikke', () => {
    for (const t of ['tournaments', 'tournament_matches', 'tournament_player_clubs', 'player_logos']) {
        assert.ok(BACKUP_TABLES.includes(t), t);
    }
    assert.ok(!BACKUP_TABLES.includes('club_admins'));
    // Forældre før børn (gendannelsen sletter og indsætter i den rækkefølge)
    assert.ok(BACKUP_TABLES.indexOf('tournaments') < BACKUP_TABLES.indexOf('tournament_matches'));
    assert.ok(BACKUP_TABLES.indexOf('courts') < BACKUP_TABLES.indexOf('game_states'));
});

test('lavBackup: alle tabellerne, klubbens navn og subdomæne', async () => {
    const conn = falskForbindelse({ tournaments: [{ id: 3, name: 'Klubmesterskab' }] });
    const b = await lavBackup(conn, { mappe: 'lyngby', clubSubdomain: 'lyngby', clubName: 'Lyngby' });
    assert.equal(b.version, '1.0');
    assert.equal(b.clubSubdomain, 'lyngby');
    assert.equal(b.clubName, 'Lyngby');
    assert.deepEqual(Object.keys(b.tables), BACKUP_TABLES);
    assert.equal(b.tables.tournaments[0].name, 'Klubmesterskab');
});

// ── Validering og gendannelse ─────────────────────────────────────────────

test('validerBackup: farlige kolonne- og filnavne afvises', () => {
    assert.match(validerBackup({}), /mangler version/);
    assert.match(validerBackup({ version: '1.0', tables: { courts: [{ 'id`; DROP': 1 }] } }), /kolonnenavn/);
    assert.match(validerBackup({ version: '1.0', tables: {}, files: { '../../server.js': 'x' } }), /filnavn/);
    assert.match(validerBackup({ version: '1.0', tables: { courts: 'ikke en liste' } }), /ikke en liste/);
    assert.equal(validerBackup({ version: '1.0', tables: { courts: [{ id: 1 }] } }), null);
});

test('gendanBackup: ugyldig backup → BackupFejl, og databasen røres ikke', async () => {
    const conn = falskForbindelse();
    await assert.rejects(
        gendanBackup(conn, { version: '1.0', tables: { courts: [{ 'x y': 1 }] } }, 'lyngby'),
        (e) => e instanceof BackupFejl
    );
    assert.deepEqual(conn.kald, []);
});

test('gendanBackup: tabeller i backuppen erstattes (også tomme); manglende røres ikke', async () => {
    const conn = falskForbindelse();
    await gendanBackup(conn, {
        version: '1.0',
        tables: { courts: [{ id: 1, court_number: 1 }], tournaments: [] }, // ingen player_info
    }, 'lyngby');
    assert.ok(conn.kald.includes('DELETE FROM `courts`'));
    assert.ok(conn.kald.includes('DELETE FROM `tournaments`'), 'tom tabel i backuppen tømmes');
    assert.ok(!conn.kald.includes('DELETE FROM `player_info`'), 'tabel uden for backuppen røres ikke');
    assert.ok(!conn.kald.some(s => s.includes('club_admins')));
    assert.equal(conn.kald.at(-1), 'COMMIT');
});

test('gendanBackup: fejl midtvejs → rul tilbage', async () => {
    const conn = falskForbindelse({}, { fejlVed: 'INSERT INTO `courts`' });
    await assert.rejects(gendanBackup(conn, { version: '1.0', tables: { courts: [{ id: 1 }] } }, 'lyngby'));
    assert.equal(conn.kald.at(-1), 'ROLLBACK');
    assert.ok(!conn.kald.includes('COMMIT'));
});

// ── Automatisk backup: filer, oprydning, læsning ──────────────────────────

test('filnavne: kun auto-/foer-gendannelse-filer med gyldigt tidspunkt', () => {
    const fil = autoBackup.filnavnFor('auto', new Date(Date.UTC(2026, 9, 19, 0, 0, 5)));
    assert.equal(fil, 'auto-20261019-000005.json.gz');
    assert.equal(autoBackup.fortolkFilnavn(fil).tidspunkt.toISOString(), '2026-10-19T00:00:05.000Z');
    for (const ondt of ['../auto-20261019-000005.json.gz', 'auto-20261019-000005.json', 'x.json.gz', '']) {
        assert.equal(autoBackup.fortolkFilnavn(ondt), null, ondt);
    }
    assert.throws(() => autoBackup.klubDir('../master'));
});

test('tagBackup: gemmer gzippet JSON og beholder kun de 4 nyeste', async () => {
    const dir = autoBackup.klubDir(KLUB.db_name);
    fs.mkdirSync(dir, { recursive: true });
    // Fem ældre ugentlige backups og én "før gendannelse"
    for (let uge = 1; uge <= 5; uge++) {
        fs.writeFileSync(path.join(dir, autoBackup.filnavnFor('auto', new Date(Date.UTC(2026, 8, uge * 7, 0)))), 'x');
    }
    fs.writeFileSync(path.join(dir, 'foer-gendannelse-20260901-120000.json.gz'), 'x');

    const fil = await autoBackup.tagBackup(falskForbindelse({ courts: [{ id: 1 }] }), KLUB, 'auto');
    const auto = autoBackup.listBackups(KLUB.db_name).filter(b => b.type === 'auto');
    assert.equal(auto.length, 4);
    assert.equal(auto[0].fil, fil, 'den nye er nyest');
    assert.ok(!fs.existsSync(path.join(dir, autoBackup.filnavnFor('auto', new Date(Date.UTC(2026, 8, 7, 0))))), 'ældste slettet');
    assert.equal(autoBackup.listBackups(KLUB.db_name).filter(b => b.type === 'foer-gendannelse').length, 1, 'andre slags røres ikke');

    const b = autoBackup.laesBackup(KLUB.db_name, fil);
    assert.equal(b.clubSubdomain, 'lyngby');
    assert.deepEqual(b.tables.courts, [{ id: 1 }]);
    assert.ok(zlib.gunzipSync(fs.readFileSync(path.join(dir, fil))).length > 0);
    assert.ok(!fs.readdirSync(dir).some(f => f.endsWith('.part')));
});

test('"før gendannelse": kun den nyeste gemmes', async () => {
    const klub = { ...KLUB, db_name: 'holte' };
    const dir = autoBackup.klubDir(klub.db_name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'foer-gendannelse-20260101-120000.json.gz'), 'x');
    await autoBackup.tagBackup(falskForbindelse(), klub, 'foer-gendannelse');
    assert.equal(autoBackup.listBackups(klub.db_name).length, 1);
});

test('laesBackup: ukendt eller ugyldigt filnavn giver null', () => {
    assert.equal(autoBackup.laesBackup(KLUB.db_name, 'auto-20200101-000000.json.gz'), null);
    assert.equal(autoBackup.laesBackup(KLUB.db_name, '../../../etc/passwd'), null);
});

// ── Næste kørsel: mandag kl. 02.00 dansk tid ──────────────────────────────

test('næste kørsel: mandag kl. 02.00 dansk tid, sommer og vinter', () => {
    // Lørdag 17. okt. 2026 (sommertid, UTC+2) → mandag 19. okt. 00:00 UTC
    assert.equal(autoBackup.naesteKoersel(new Date('2026-10-17T12:00:00Z')).toISOString(), '2026-10-19T00:00:00.000Z');
    // Lørdag 31. okt. 2026, efter skiftet til vintertid (UTC+1) → mandag 2. nov. 01:00 UTC
    assert.equal(autoBackup.naesteKoersel(new Date('2026-10-31T12:00:00Z')).toISOString(), '2026-11-02T01:00:00.000Z');
    // Mandag 19. okt. kl. 02.30 dansk tid → næste mandag (26. okt., nu vintertid)
    assert.equal(autoBackup.naesteKoersel(new Date('2026-10-19T00:30:00Z')).toISOString(), '2026-10-26T01:00:00.000Z');
    // Natten til mandag kl. 01.30 dansk tid → samme nat
    assert.equal(autoBackup.naesteKoersel(new Date('2026-10-18T23:30:00Z')).toISOString(), '2026-10-19T00:00:00.000Z');
});
