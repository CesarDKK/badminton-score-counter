#!/usr/bin/env node
/**
 * Integrationstestene mod en rigtig MySQL (nr. 56) — samme fil i CI og lokalt.
 *
 *   Lokalt (Docker, én kommando, fra repoets rod — frisk MySQL hver gang):
 *     docker compose -f backend/tests/integration/compose.yml up --force-recreate --renew-anon-volumes --abort-on-container-exit --exit-code-from tests --attach tests
 *   og ryd op bagefter (valgfrit):
 *     docker compose -f backend/tests/integration/compose.yml down -v
 *
 * Gør dette, i rækkefølge:
 *   1. venter på, at MySQL svarer (spørger igen hvert sekund, højst 2 min)
 *   2. kræver en TOM MySQL (ingen badminton_master) — så den aldrig kan køre
 *      mod en rigtig installation — og bygger master + standarddatabasen fra
 *      init.master.sql / init.sql, som MySQL-containeren gør ved første start
 *   3. starter backenden (server.js) med opdigtede hemmeligheder og venter på,
 *      at /health svarer 200 (opstarten har kørt alle migrationerne)
 *   4. kører tests/0*.test.js (de gamle integrationstest) og
 *      tests/integration/*.test.js (skema, klub-isolation, backup → gendan)
 *   5. stopper backenden og afslutter med testenes kode (loggen vises ved fejl)
 *
 * Miljø: DB_HOST, DB_PORT, MYSQL_ROOT_PASSWORD (påkrævet). Resten er opdigtet her.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const BACKEND = path.join(__dirname, '..', '..');
const mysql = require(path.join(BACKEND, 'node_modules', 'mysql2', 'promise'));

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.DB_PORT || 3306);
const ROOT_PW = process.env.MYSQL_ROOT_PASSWORD;
if (!ROOT_PW) { console.error('MYSQL_ROOT_PASSWORD mangler'); process.exit(2); }

const PORT = Number(process.env.TEST_PORT || 3999);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'badminton-it-'));
// Opdigtede værdier — kun til denne testkørsel
const MILJOE = {
    NODE_ENV: 'test',
    PORT: String(PORT),
    DB_HOST, DB_PORT: String(DB_PORT),
    DB_USER: 'badminton_user',
    DB_PASSWORD: 'it-bruger-opdigtet',
    DB_NAME: 'badminton_counter',
    MYSQL_ROOT_PASSWORD: ROOT_PW,
    JWT_SECRET: 'integrationstest-opdigtet-hemmelighed-0123456789abcdef',
    APP_DOMAIN: 'test.local',
    UPLOAD_DIR: path.join(tmp, 'uploads'),
    CLUB_BACKUP_DIR: path.join(tmp, 'club-backups'),
    FULD_BACKUP_DIR: path.join(tmp, 'fuld-backup'),
    FOOTBALL_DB_USER: 'football_user',
    FOOTBALL_DB_PASSWORD: 'football-opdigtet',
    YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: '',
};
for (const d of ['UPLOAD_DIR', 'CLUB_BACKUP_DIR', 'FULD_BACKUP_DIR']) fs.mkdirSync(MILJOE[d], { recursive: true });

const vent = (ms) => new Promise(r => setTimeout(r, ms));
const rootForbindelse = () => mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: 'root', password: ROOT_PW, multipleStatements: true
});

async function ventPaaMysql() {
    const slut = Date.now() + 120000;
    for (let i = 1; ; i++) {
        try {
            const c = await rootForbindelse();
            await c.query('SELECT 1');
            await c.end();
            console.log(`✓ MySQL svarer (forsøg ${i})`);
            return;
        } catch (e) {
            if (Date.now() > slut) throw new Error(`MySQL svarede ikke inden for 2 min: ${e.message}`);
            await vent(1000);   // spørg igen — ikke en fast ventetid
        }
    }
}

async function bygDatabaser() {
    const c = await rootForbindelse();
    try {
        const [findes] = await c.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'badminton_master'");
        if (findes.length) {
            throw new Error('MySQL er ikke tom (badminton_master findes) — integrationstestene kører kun mod en frisk test-MySQL');
        }
        // Som MySQL-containerens første start: MYSQL_USER + MYSQL_DATABASE, derefter initdb-filerne
        await c.query("CREATE USER 'badminton_user'@'%' IDENTIFIED BY ?", [MILJOE.DB_PASSWORD]);
        await c.query(fs.readFileSync(path.join(BACKEND, 'init.sql'), 'utf8'));
        await c.query("GRANT ALL PRIVILEGES ON badminton_counter.* TO 'badminton_user'@'%'");
        await c.query(fs.readFileSync(path.join(BACKEND, 'init.master.sql'), 'utf8'));
        await c.query('FLUSH PRIVILEGES');
        console.log('✓ master + standarddatabasen bygget fra init.master.sql / init.sql');
    } finally {
        await c.end();
    }
}

function hent(sti) {
    return new Promise((resolve) => {
        const r = http.get({ host: '127.0.0.1', port: PORT, path: sti }, (res) => { res.resume(); resolve(res.statusCode); });
        r.on('error', () => resolve(0));
        r.setTimeout(2000, () => { r.destroy(); resolve(0); });
    });
}

async function main() {
    const t0 = Date.now();
    await ventPaaMysql();
    await bygDatabaser();

    const logSti = path.join(tmp, 'backend.log');
    const log = fs.openSync(logSti, 'a');
    const server = spawn(process.execPath, ['server.js'], {
        cwd: BACKEND, env: { ...process.env, ...MILJOE }, stdio: ['ignore', log, log]
    });
    let serverKode = null;
    server.on('exit', (k) => { serverKode = k; });
    const visLog = () => {
        console.log('──── backendens log (sidste 80 linjer) ────');
        console.log(fs.readFileSync(logSti, 'utf8').split('\n').slice(-80).join('\n'));
    };

    try {
        const slut = Date.now() + 120000;
        while ((await hent('/health')) !== 200) {
            if (serverKode !== null) throw new Error(`backenden stoppede under opstarten (kode ${serverKode})`);
            if (Date.now() > slut) throw new Error('backenden blev ikke klar inden for 2 min');
            await vent(500);   // spørg igen
        }
        console.log(`✓ backenden er klar (${Math.round((Date.now() - t0) / 1000)} s efter start)`);

        // Den gamle device-token-test (08) kræver en klub med en klub-admin
        Object.assign(process.env, MILJOE, { TEST_PORT: String(PORT), INTEGRATION_DB: '1' });
        const enheder = await require('./faelles').opretKlub('enheder', 'Enhedsklub');
        console.log(`✓ testklubben ${enheder.host} er oprettet til 08-device-tokens`);

        const filer = [
            ...fs.readdirSync(path.join(BACKEND, 'tests')).filter(f => /^\d\d-.*\.test\.js$/.test(f)).map(f => `tests/${f}`),
            ...fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort().map(f => `tests/integration/${f}`),
        ];
        const kode = await new Promise((resolve) => {
            const t = spawn(process.execPath, ['--test', '--test-concurrency=1', ...filer], {
                cwd: BACKEND, stdio: 'inherit',
                env: {
                    ...process.env, TEST_ADMIN_PASSWORD: 'admin123',   // init.sql's standardkode (kun standarddatabasen)
                    TEST_CLUB_HOST: enheder.host, TEST_CLUB_ADMIN_USER: enheder.bruger, TEST_CLUB_ADMIN_PASS: enheder.kode
                }
            });
            t.on('exit', (k) => resolve(k ?? 1));
        });
        if (kode !== 0) visLog();
        console.log(`${kode === 0 ? '✓' : '✗'} integrationstestene: kode ${kode}, i alt ${Math.round((Date.now() - t0) / 1000)} s`);
        return kode;
    } catch (e) {
        console.error('✗', e.message);
        visLog();
        return 1;
    } finally {
        server.kill('SIGTERM');
        if (serverKode === null) await new Promise(r => { server.on('exit', r); setTimeout(r, 10000); });
    }
}

main().then((k) => process.exit(k), (e) => { console.error('✗', e.message); process.exit(1); });
