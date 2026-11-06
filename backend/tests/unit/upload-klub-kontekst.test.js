/**
 * Unit-tests af bevarKlub (config/tenantPools.js): klubben må ikke gå tabt efter
 * en upload.
 *
 * multer kalder next() uden for den kontekst, tenant-middlewaren satte, når
 * filen kommer i flere bidder. Uden bevarKlub gendannede "Gendan fra fil" på et
 * klub-subdomæne derfor i demoens database.
 *
 * Ingen database: en lille Express-server på localhost efterligner
 * tenant-middlewaren (asynkront opslag → runWithTenant) med begge slags
 * multer-lager, som ruterne bruger.
 *
 * Kør: npm run test:unit
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { runWithTenant, bevarKlub, currentTenant } = require('../../config/tenantPools');

const KB = 1024;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'upload-klub-'));
const hukommelse = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * KB * KB } });
const disk = multer({ dest: TMP });

const app = express();
// Som middleware/tenant.js: klubben slås op og sættes som kontekst. Uden
// X-Klub er kaldet uden klub (demoen/lokal installation)
app.use(async (req, res, next) => {
    await new Promise(r => setTimeout(r, 2));
    const klub = req.headers['x-klub'];
    if (!klub) return next();
    req.clubDbName = klub;
    runWithTenant(klub, next);
});
const svar = (req, res) => res.json({ tenant: currentTenant(), bytes: req.file ? req.file.size : null });
app.post('/hukommelse', bevarKlub(hukommelse.single('backup')), svar);
app.post('/disk', bevarKlub(disk.single('backup')), svar);
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => res.status(400).json({ fejl: err.code || err.message, tenant: currentTenant() }));

let server;
let port;
before(() => new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => { port = server.address().port; resolve(); });
}));
after(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(TMP, { recursive: true, force: true });
});

// Send en fil som multipart. iBidder: 32 KB ad gangen med en lille pause, som
// en langsom forbindelse
function send(sti, bytes, { klub = null, iBidder = false } = {}) {
    return new Promise((resolve, reject) => {
        const graense = '----test' + Math.random().toString(16).slice(2);
        const krop = Buffer.concat([
            Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="backup"; filename="b.json"\r\nContent-Type: application/json\r\n\r\n`),
            Buffer.alloc(bytes, 97),
            Buffer.from(`\r\n--${graense}--\r\n`)
        ]);
        const headers = { 'Content-Type': `multipart/form-data; boundary=${graense}`, 'Content-Length': krop.length, Connection: 'close' };
        if (klub) headers['X-Klub'] = klub;
        const req = http.request({ host: '127.0.0.1', port, path: sti, method: 'POST', headers }, (res) => {
            let d = '';
            res.on('data', c => { d += c; });
            res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(d) }));
        });
        req.on('error', reject);
        if (!iBidder) return req.end(krop);
        let i = 0;
        const t = setInterval(() => {
            if (i >= krop.length) { clearInterval(t); return req.end(); }
            req.write(krop.subarray(i, i + 32 * KB));
            i += 32 * KB;
        }, 2);
    });
}

test('backup-upload (i hukommelsen): klubben er den samme efter en lille og en stor fil', async () => {
    for (const bytes of [1 * KB, 50 * KB, 400 * KB, 1500 * KB]) {
        const r = await send('/hukommelse', bytes, { klub: 'klub_a' });
        assert.deepEqual(r, { status: 200, tenant: 'klub_a', bytes }, `${bytes / KB} KB`);
    }
});

test('billed-upload (på disk): klubben er den samme, også når filen kommer i bidder', async () => {
    for (const iBidder of [false, true]) {
        const r = await send('/disk', 400 * KB, { klub: 'klub_a', iBidder });
        assert.deepEqual(r, { status: 200, tenant: 'klub_a', bytes: 400 * KB }, iBidder ? 'i bidder' : 'på én gang');
    }
    const r = await send('/hukommelse', 400 * KB, { klub: 'klub_a', iBidder: true });
    assert.equal(r.tenant, 'klub_a');
});

test('to klubber uploader samtidig: hver får sin egen', async () => {
    const svarene = await Promise.all(['klub_a', 'klub_b', 'klub_a', 'klub_b'].map((klub, i) =>
        send(i % 2 ? '/disk' : '/hukommelse', 300 * KB, { klub, iBidder: i > 1 })));
    assert.deepEqual(svarene.map(r => r.tenant), ['klub_a', 'klub_b', 'klub_a', 'klub_b']);
});

test('uden klub (demoen/lokal installation): stadig standard-databasen', async () => {
    const r = await send('/hukommelse', 400 * KB);
    assert.deepEqual(r, { status: 200, tenant: 'direct', bytes: 400 * KB });
});

test('en fejl fra upload-middlewaren går videre til fejlhåndteringen — i klubbens kontekst', async () => {
    const r = await send('/hukommelse', 3 * KB * KB, { klub: 'klub_a' });
    assert.deepEqual(r, { status: 400, fejl: 'LIMIT_FILE_SIZE', tenant: 'klub_a' });
});

test('alle ruter bruger multer gennem bevarKlub', () => {
    const dir = path.join(__dirname, '..', '..', 'routes');
    const brug = /(\w*(?:upload|multer)\w*)\.(single|array|fields|any|none)\(/gi;
    let fundet = 0;
    for (const fil of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        const tekst = fs.readFileSync(path.join(dir, fil), 'utf8');
        for (const m of tekst.matchAll(brug)) {
            fundet++;
            const linje = tekst.slice(0, m.index).split('\n').length;
            assert.ok(tekst.slice(0, m.index).endsWith('bevarKlub('),
                `routes/${fil}:${linje} — ${m[0]}…) skal stå inde i bevarKlub(…), ellers kan klubben gå tabt efter upload`);
        }
    }
    // Sikrer at mønsteret stadig finder ruterne (backup, sponsorer, livestream-logo, super-admin)
    assert.ok(fundet >= 6, `fandt kun ${fundet} upload-ruter`);
});
