/**
 * Pakke H — nr. 72, 83, 84, 85, 95 og 96 (fundliste 2, november 2026).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Nr. 72: YouTube-kvoten indlæses kun én gang ----------

test('72: indlaes() to gange (opstarten prøver igen) fordobler ikke forbruget', async () => {
    const masterDb = require('../../config/masterDatabase');
    const kvote = require('../../config/youtubeKvote');
    const gemt = { vaerdi: null };
    const original = masterDb.query;
    let laesninger = 0;
    masterDb.query = async (sql, params) => {
        if (/^SELECT/i.test(sql)) { laesninger++; return gemt.vaerdi ? [{ vaerdi: gemt.vaerdi }] : []; }
        gemt.vaerdi = params[1];   // INSERT … ON DUPLICATE KEY UPDATE
        return [];
    };
    try {
        kvote.nulstil({ gem: false });
        const nu = Date.now();
        const dag = kvote.googleDag(nu);
        // Gemt fra før genstarten: 300 enheder i dag
        gemt.vaerdi = JSON.stringify({ dage: { [dag]: { enheder: 300, kald: 3, opbrugt: null, klubber: { lyngby: 300 } } }, graense: 10000 });
        // Et kald talt, før tallene var læst — det skal lægges oven i én gang
        kvote.tael(50, { klub: 'lyngby', nu });
        await kvote.indlaes();
        assert.equal(kvote.status(nu).enheder, 350);
        await kvote.gem();                       // tallene gemmes (som efter 5 s)
        await kvote.indlaes();                   // opstarten prøver igen
        await kvote.indlaes();
        assert.equal(kvote.status(nu).enheder, 350, 'forbruget må ikke vokse ved gentagen indlæsning');
        assert.equal(kvote.status(nu).klubber[0].enheder, 350);
        assert.equal(laesninger, 1, 'de gemte tal læses kun én gang');

        // To samtidige indlæsninger (opstart + gemning) lægger kun tallene til én gang
        kvote.nulstil({ gem: false });
        kvote.tael(50, { klub: 'lyngby', nu });
        laesninger = 0;
        await Promise.all([kvote.indlaes(), kvote.indlaes(), kvote.gem()]);
        assert.equal(laesninger, 1);
        assert.equal(kvote.status(nu).enheder, 400);   // 350 gemt + 50
    } finally {
        masterDb.query = original;
        kvote.nulstil({ gem: false });
    }
});

test('72: fejler læsningen, kan den prøves igen bagefter', async () => {
    const masterDb = require('../../config/masterDatabase');
    const kvote = require('../../config/youtubeKvote');
    const original = masterDb.query;
    let forsoeg = 0;
    masterDb.query = async () => {
        forsoeg++;
        if (forsoeg === 1) throw new Error('databasen er ikke klar');
        return [];
    };
    try {
        kvote.nulstil({ gem: false });
        kvote.tael(10, { nu: Date.now() });
        await assert.rejects(kvote.indlaes(), /ikke klar/);
        await kvote.indlaes();
        await kvote.indlaes();
        assert.equal(forsoeg, 2);
        assert.equal(kvote.status().enheder, 10);
    } finally {
        masterDb.query = original;
        kvote.nulstil({ gem: false });
    }
});

// ---------- Nr. 84: migrationer også for deaktiverede klubber ----------

test('84: migrationerne tager alle klubber, også de deaktiverede', async () => {
    const { klubberTilMigration } = require('../../config/migrationRunner');
    let sql = null;
    const klubber = [{ db_name: 'aktiv', is_active: 1 }, { db_name: 'sovende', is_active: 0 }];
    const r = await klubberTilMigration({ query: async (s) => { sql = s; return klubber; } });
    assert.deepEqual(r, klubber);
    assert.doesNotMatch(sql, /is_active\s*=/i, 'ingen filtrering på is_active');
    assert.match(sql, /FROM clubs/);
});

// ---------- Nr. 85: klub-puljerne lukker ledige forbindelser ----------

test('85: oprydningen er slået til (maxIdle < connectionLimit), ledige lukkes efter 60 s', () => {
    const { poolIndstillinger } = require('../../config/tenantPools');
    const gem = { ...process.env };
    try {
        for (const k of ['DB_POOL_SIZE', 'DB_QUEUE_LIMIT', 'DB_POOL_IDLE_MS']) delete process.env[k];
        const o = poolIndstillinger('lyngby');
        assert.equal(o.database, 'lyngby');
        assert.equal(o.connectionLimit, 15, 'uændret under belastning');
        assert.equal(o.queueLimit, 60);
        assert.equal(o.maxIdle, 14, 'under connectionLimit — ellers kører mysql2 aldrig oprydningen');
        assert.equal(o.idleTimeout, 60000);
        process.env.DB_POOL_SIZE = '5';
        process.env.DB_POOL_IDLE_MS = '30000';
        const p = poolIndstillinger('x');
        assert.equal(p.connectionLimit, 5);
        assert.equal(p.maxIdle, 4);
        assert.equal(p.idleTimeout, 30000);
    } finally {
        process.env = gem;
    }
});

test('85: mysql2 tager indstillingerne op og starter oprydningen', () => {
    const mysql = require('mysql2/promise');
    const { poolIndstillinger } = require('../../config/tenantPools');
    const pool = mysql.createPool(poolIndstillinger('lyngby'));
    try {
        const p = pool.pool;
        assert.equal(p.config.maxIdle, 14);
        assert.equal(p.config.idleTimeout, 60000);
        assert.equal(p.config.connectionLimit, 15);
        assert.ok(p._removeIdleTimeoutConnectionsTimer, 'oprydnings-timeren kører');
    } finally {
        pool.end().catch(() => {});
    }
});

// ---------- Nr. 95: subdomænet "error" ----------

test('95: en klub, der hedder error, vælter ikke event-hubben', () => {
    const events = require('../../events/gameStateEvents');
    const req = { clubDbName: 'error' };
    // Uden lyttere: emit('error') ville kaste
    assert.doesNotThrow(() => events.publishGameStateChange(req, 3));
    assert.doesNotThrow(() => events.publishConfigChange(req, 'settings'));
    assert.doesNotThrow(() => events.publishHoldkampChange(req));
    // Med en lytter når eventet stadig kun klubbens egne skærme
    const set = [], andre = [];
    const stop = events.subscribeGameStateChanges(req, e => set.push(e));
    const stop2 = events.subscribeGameStateChanges({ clubDbName: 'lyngby' }, e => andre.push(e));
    events.publishGameStateChange(req, 2);
    assert.deepEqual(set, [{ courtId: 2, type: 'update' }]);
    assert.deepEqual(andre, []);
    stop(); stop2();
    for (const navn of ['error', 'newListener', 'removeListener', undefined]) {
        assert.match(events.tenantKey({ clubDbName: navn }), /^klub:/);
    }
});

test('95: error, newlistener og removelistener er reserverede subdomæner', () => {
    const { validerSubdomain } = require('../../config/klubNavn');
    for (const n of ['error', 'newlistener', 'removelistener']) {
        assert.match(validerSubdomain(n) || '', /reserveret/, n);
    }
    assert.equal(validerSubdomain('error-badminton'), null, 'kun selve navnet er optaget');
});

test('95: procesnettet logger afviste promises og kører videre; kastede fejl logges og afslutter', async () => {
    const { installer } = require('../../config/procesNet');
    const proc = new EventEmitter();
    const log = { linjer: [], error(l) { this.linjer.push(l); } };
    const afslut = [];
    let gemt = 0;
    installer({ proc, log, foerAfslut: async () => { gemt++; }, afslut: (k) => afslut.push(k), ventMs: 200 });
    proc.emit('unhandledRejection', new Error('en forespørgsel fejlede'));
    assert.match(log.linjer[0], /kører videre[\s\S]*en forespørgsel fejlede/);
    assert.deepEqual(afslut, []);
    proc.emit('uncaughtException', new Error('noget kastede'), 'uncaughtException');
    await new Promise(r => setTimeout(r, 20));
    assert.match(log.linjer[1], /genstarter[\s\S]*noget kastede/);
    assert.equal(gemt, 1, 'YouTube-forbruget gemmes før afslutningen');
    assert.deepEqual(afslut, [1]);
    // En gemning, der hænger, holder ikke processen i live
    const proc2 = new EventEmitter();
    const afslut2 = [];
    installer({ proc: proc2, log, foerAfslut: () => new Promise(() => {}), afslut: (k) => afslut2.push(k), ventMs: 50 });
    proc2.emit('uncaughtException', new Error('x'));
    await new Promise(r => setTimeout(r, 120));
    assert.deepEqual(afslut2, [1]);
});

test('95: server.js installerer procesnettet', () => {
    assert.match(laes('backend/server.js'), /require\('\.\/config\/procesNet'\)\.installer\(/);
});

// ---------- Nr. 96: QR-linket er https under APP_DOMAIN ----------

test('96: QR-linket bruger https under APP_DOMAIN, ellers forbindelsens protokol', () => {
    const { linkProtokol } = require('../../routes/matchSessionTokens');
    const gem = process.env.APP_DOMAIN;
    try {
        process.env.APP_DOMAIN = 'badmintonapp.dk';
        const req = (hostname, proto, protocol = 'http') => ({ hostname, protocol, headers: proto ? { 'x-forwarded-proto': proto } : {} });
        // Bag Cloudflare siger nginx altid http — alligevel https
        assert.equal(linkProtokol(req('lyngby.badmintonapp.dk', 'http')), 'https');
        assert.equal(linkProtokol(req('app.badmintonapp.dk', 'http')), 'https');
        assert.equal(linkProtokol(req('badmintonapp.dk')), 'https');
        assert.equal(linkProtokol(req('LYNGBY.BadmintonApp.dk', 'http')), 'https');
        // Ikke under domænet: en lookalike, lokalt, en IP i hallen
        assert.equal(linkProtokol(req('evilbadmintonapp.dk', 'http')), 'http');
        assert.equal(linkProtokol(req('localhost', 'http')), 'http');
        assert.equal(linkProtokol(req('192.168.1.20')), 'http');
        assert.equal(linkProtokol(req('192.168.1.20', 'https')), 'https');
        assert.equal(linkProtokol(req('192.168.1.20', 'https, http')), 'https');
        assert.equal(linkProtokol(req('x', 'javascript')), 'http', 'kun http eller https');
        // Lokal installation uden APP_DOMAIN
        delete process.env.APP_DOMAIN;
        assert.equal(linkProtokol(req('lyngby.badmintonapp.dk', 'http')), 'http');
        assert.equal(linkProtokol(req('localhost', null, 'http')), 'http');
    } finally {
        if (gem === undefined) delete process.env.APP_DOMAIN; else process.env.APP_DOMAIN = gem;
    }
});

test('96: QR-ruten bygger linket med linkProtokol, ikke rå x-forwarded-proto', () => {
    const src = laes('backend/routes/matchSessionTokens.js');
    assert.match(src, /\$\{linkProtokol\(req\)\}:\/\/\$\{req\.hostname\}\/t\/\$\{token\}/);
    assert.doesNotMatch(src, /const protocol = req\.headers\['x-forwarded-proto'\]/);
});

// ---------- Nr. 83: store backups kan gendannes ----------

test('83: nginx lukker 101 MB igennem på gendan-ruterne — og kun dem', () => {
    const conf = laes('nginx.conf');
    const blok = (start) => {
        const i = conf.indexOf(start);
        assert.ok(i >= 0, start);
        return conf.slice(i, conf.indexOf('\n    }', i));
    };
    const klub = blok('location = /api/backup/restore {');
    assert.match(klub, /client_max_body_size 101M;/);
    assert.match(klub, /proxy_pass \$backend;/);
    const admin = blok('location ~ ^/api/super-admin/(clubs/[0-9]+/restore|logos/import-bundle)$ {');
    assert.match(admin, /client_max_body_size 101M;/);
    assert.match(admin, /proxy_pass \$backend;/);
    assert.match(admin, /X-Frame-Options "DENY"/);
    // Resten har stadig 50 MB, og der er ingen andre 101M-steder
    assert.equal((conf.match(/client_max_body_size 101M;/g) || []).length, 2);
    assert.equal((conf.match(/client_max_body_size 50M;/g) || []).length, 2);
    // Backenden tager 100 MB på samme ruter
    assert.match(laes('backend/routes/backup.js'), /KLUB_GENDAN_MAKS = 100 \* MB/);
    assert.match(laes('backend/routes/superAdmin.js'), /SUPER_UPLOAD_MAKS_MB = 100;/);
});

test('83: super-admins gendan/bundle svarer 413 med det rigtige loft, ikke "10MB"', async () => {
    const src = laes('backend/routes/superAdmin.js');
    assert.match(src, /router\.post\('\/clubs\/:id\/restore', superAdminAuth, modtagStorFil\('backup'\)/);
    assert.match(src, /router\.post\('\/logos\/import-bundle', superAdminAuth, modtagStorFil\('bundle'\)/);
    assert.match(src, /res\.status\(413\)\.json\(\{ error: `Filen er for stor \(højst \$\{SUPER_UPLOAD_MAKS_MB\} MB\)` \}\)/);
});

test('83: admin og indstillinger viser en forståelig fejl, når nginx/Cloudflare svarer 413 med HTML', async () => {
    for (const f of ['frontend/settings-script.js', 'frontend/super-admin-script.js']) {
        const src = laes(f);
        const m = src.match(/async function uploadSvar\(res\) \{[\s\S]*?\n\}/);
        assert.ok(m, f);
        // eslint-disable-next-line no-new-func
        const uploadSvar = new Function(`${m[0]}; return uploadSvar;`)();
        const html = { status: 413, json: async () => { throw new SyntaxError("Unexpected token '<'"); } };
        assert.match((await uploadSvar(html)).error, /for stor til at blive sendt \(højst 100 MB\)/);
        const backend = { status: 413, json: async () => ({ error: 'Backup-filen er for stor til demoen (højst 10 MB)' }) };
        assert.equal((await uploadSvar(backend)).error, 'Backup-filen er for stor til demoen (højst 10 MB)');
        const ok = { status: 200, json: async () => ({ files: 3 }) };
        assert.deepEqual(await uploadSvar(ok), { files: 3 });
        assert.doesNotMatch(src, /const data = await res\.json\(\);\s*\r?\n\s*if \(!res\.ok\) throw new Error\(data\.error \|\| res\.statusText\);\s*\r?\n\s*(visGendannelsesResultat|notify\(`Gendannelse|notify\(`✓ Import)/);
    }
    assert.match(laes('frontend/settings.html'), /settings-script\.js\?v=24/);
    assert.match(laes('frontend/super-admin.html'), /super-admin-script\.js\?v=39/);
});
