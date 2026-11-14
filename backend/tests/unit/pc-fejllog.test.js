/**
 * "Hent fejllog" fra admin (admin → TV-PC → serveren): bestillingen, PC'ens
 * spørgsmål, zip'en på disken og selve ruterne (adgangslinket tjekkes, før
 * kroppen læses; en zip tages kun imod, når admin har bedt om den).
 *
 * Databasen erstattes af en optager, FØR ruterne indlæses. Filerne ligger i en
 * midlertidig mappe (PC_FEJLLOG_DIR).
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const MAPPE = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-fejllog-'));
process.env.PC_FEJLLOG_DIR = MAPPE;
after(() => fs.rmSync(MAPPE, { recursive: true, force: true }));

const db = require('../../config/database');
const AKTIVT = 'abcdefgh12345678';
db.queryOne = async (sql, params) => (/FROM device_tokens/.test(sql) && params[0] === AKTIVT
    ? { id: 7, destination: 'tv/2' } : null);

const fl = require('../../screens/pcFejllog');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const pc = (ekstra = {}) => ({ navn: 'badminton-tv2', kioskVersion: '2026.11.4', status: null, tekst: '', ...ekstra });

// En lille, gyldig zip med én fil (lokal header + central directory + slutpost)
function zip(navn = 'OVERSIGT.txt', indhold = 'hej\r\n') {
    const data = Buffer.from(indhold);
    const navnB = Buffer.from(navn);
    const crc = zlib.crc32(data);
    const lokal = Buffer.alloc(30);
    lokal.writeUInt32LE(0x04034b50, 0); lokal.writeUInt16LE(20, 4);
    lokal.writeUInt32LE(crc, 14); lokal.writeUInt32LE(data.length, 18); lokal.writeUInt32LE(data.length, 22);
    lokal.writeUInt16LE(navnB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(navnB.length, 28);
    const forCentral = lokal.length + navnB.length + data.length;
    const slut = Buffer.alloc(22);
    slut.writeUInt32LE(0x06054b50, 0); slut.writeUInt16LE(1, 8); slut.writeUInt16LE(1, 10);
    slut.writeUInt32LE(central.length + navnB.length, 12); slut.writeUInt32LE(forCentral, 16);
    return Buffer.concat([lokal, navnB, data, central, navnB, slut]);
}

beforeEach(() => {
    fl._nulstil();
    fs.rmSync(MAPPE, { recursive: true, force: true });
    fs.mkdirSync(MAPPE, { recursive: true });
});

// ---------- Bestilling og spørgsmål ----------

test('knappen kun for en PC, der har spurgt de seneste minutter', () => {
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU), null);
    assert.equal(fl.bestil('lyngby', 7, 'badminton-tv2', NU), 'kan-ikke');
    assert.deepEqual(fl.spoerg('lyngby', 7, pc(), NU), { hent: false });
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + MIN).kan, true);
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + fl.KAN_MS + 1).kan, false);
    assert.equal(fl.bestil('lyngby', 7, 'badminton-tv2', NU + fl.KAN_MS + 1), 'kan-ikke');
    // Andet link / anden klub
    assert.equal(fl.forSkaerm('lyngby', 8, 'badminton-tv2', NU), null);
    assert.equal(fl.forSkaerm('virum', 7, 'badminton-tv2', NU), null);
});

test('bestilt → PC\'en får besked og samler → zip modtaget → klar og kan hentes', () => {
    fl.spoerg('lyngby', 7, pc(), NU);
    assert.equal(fl.venterPaaLog('lyngby', 7, 'badminton-tv2', NU), false, 'ingen zip uden bestilling');
    assert.equal(fl.bestil('lyngby', 7, 'badminton-tv2', NU + MIN), 'ok');
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + MIN).status, 'bestilt');

    assert.deepEqual(fl.spoerg('lyngby', 7, pc(), NU + 2 * MIN), { hent: true });
    fl.spoerg('lyngby', 7, pc({ status: 'samler', tekst: 'Samler loggen …' }), NU + 2 * MIN);
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + 2 * MIN).status, 'samler');
    assert.equal(fl.venterPaaLog('lyngby', 7, 'badminton-tv2', NU + 3 * MIN), true);

    const meta = fl.gem('lyngby', 7, 'badminton-tv2', zip(), { opstarter: '15', kioskVersion: '2026.11.4' }, NU + 3 * MIN);
    assert.equal(meta.opstarter, 15);
    const s = fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + 4 * MIN);
    assert.equal(s.status, null, '"klar" vises som filen, ikke som en status');
    assert.equal(s.fil.stoerrelse, zip().length);
    assert.deepEqual(fl.spoerg('lyngby', 7, pc(), NU + 4 * MIN), { hent: false }, 'ikke igen');
    assert.equal(fl.venterPaaLog('lyngby', 7, 'badminton-tv2', NU + 4 * MIN), false, 'en zip mere tages ikke imod');
    const fil = fl.hentFil('lyngby', 7, 'badminton-tv2', NU + 4 * MIN);
    assert.deepEqual(fs.readFileSync(fil.sti), zip());
    // Klubbens mappe, og kun læsbar for serveren
    assert.equal(path.dirname(fil.sti), path.join(MAPPE, 'lyngby'));
});

test('PC\'en melder fejl → bestillingen er slut, og fejlen vises', () => {
    fl.spoerg('lyngby', 7, pc(), NU);
    fl.bestil('lyngby', 7, 'badminton-tv2', NU);
    fl.spoerg('lyngby', 7, pc({ status: 'fejl', tekst: 'loggen fylder 12000 KB' }), NU + MIN);
    const s = fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + MIN);
    assert.equal(s.status, 'fejl');
    assert.match(s.tekst, /12000 KB/);
    assert.deepEqual(fl.spoerg('lyngby', 7, pc(), NU + 2 * MIN), { hent: false });
});

test('en bestilling, PC\'en ikke henter inden for en time, udløber', () => {
    fl.spoerg('lyngby', 7, pc(), NU);
    fl.bestil('lyngby', 7, 'badminton-tv2', NU);
    assert.equal(fl.venterPaaLog('lyngby', 7, 'badminton-tv2', NU + fl.BESTILT_MAX_MS + 1), false);
    assert.equal(fl.forSkaerm('lyngby', 7, 'badminton-tv2', NU + fl.BESTILT_MAX_MS + 1).status, 'fejl');
});

test('rensMelding: navn og status valideres', () => {
    assert.equal(fl.rensMelding(null), null);
    assert.equal(fl.rensMelding({ navn: '../etc' }), null);
    assert.equal(fl.rensMelding({ navn: 'badminton-tv2', status: 'klar' }), null, 'kun PC\'ens egne statusser');
    assert.deepEqual(fl.rensMelding({ navn: 'badminton-tv2', kioskVersion: 'x', status: 'samler', tekst: 'a\nb' }),
        { navn: 'badminton-tv2', kioskVersion: '', status: 'samler', tekst: 'a b' });
});

// ---------- Filerne ----------

test('gem: kun zip, højst 10 MB, sikre stier — og den forrige erstattes', () => {
    assert.throws(() => fl.gem('lyngby', 7, 'badminton-tv2', Buffer.from('ikke en zip, men lang nok til tjekket')), /Ikke en zip/);
    const stor = Buffer.concat([zip(), Buffer.alloc(fl.MAX_BYTES)]);
    assert.throws(() => fl.gem('lyngby', 7, 'badminton-tv2', stor), /for stor/);
    assert.throws(() => fl.gem('lyngby', 7, '../x', zip()), /Ugyldigt navn/);
    assert.throws(() => fl.gem('../demo', 7, 'badminton-tv2', zip()), /Ugyldig klub/);

    fl.gem('lyngby', 7, 'badminton-tv2', zip('a.txt'), {}, NU);
    fl.gem('lyngby', 7, 'badminton-tv2', zip('b.txt'), {}, NU + MIN);
    assert.deepEqual(fs.readdirSync(path.join(MAPPE, 'lyngby')).sort(), ['7-badminton-tv2.json', '7-badminton-tv2.zip']);
    assert.deepEqual(fs.readFileSync(fl.hentFil('lyngby', 7, 'badminton-tv2', NU + MIN).sti), zip('b.txt'));
});

test('logs over 7 dage hentes ikke og slettes ved næste gemning', () => {
    fl.gem('lyngby', 7, 'badminton-tv1', zip(), {}, NU);
    assert.ok(fl.hentFil('lyngby', 7, 'badminton-tv1', NU + fl.BEHOLD_MS));
    assert.equal(fl.hentFil('lyngby', 7, 'badminton-tv1', NU + fl.BEHOLD_MS + 1), null);
    fl.gem('lyngby', 7, 'badminton-tv2', zip(), {}, NU + fl.BEHOLD_MS + 1);
    assert.deepEqual(fs.readdirSync(path.join(MAPPE, 'lyngby')).sort(), ['7-badminton-tv2.json', '7-badminton-tv2.zip']);
});

test('filnavnet til admin er i dansk tid', () => {
    // 2026-11-14 14:04 UTC = 15:04 dansk tid
    assert.equal(fl.downloadNavn('badminton-tv2', Date.UTC(2026, 10, 14, 14, 4)), 'badminton-tv2-fejllog-2026-11-14-1504.zip');
});

// ---------- Ruterne (Express, uden login: PC'ens adgangslink) ----------

async function medServer(fn) {
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.accessMode = 'direct'; next(); });
    app.use('/api/screens', require('../../routes/screens'));
    const server = app.listen(0);
    await new Promise(r => server.once('listening', r));
    try {
        await fn(`http://127.0.0.1:${server.address().port}/api/screens`);
    } finally {
        await new Promise(r => server.close(r));
    }
}

test('ruterne: spørg, upload kun efter bestilling, adgangslinket kræves', async () => {
    await medServer(async (url) => {
        const spoerg = (token, body) => fetch(`${url}/pc-fejllog/spoerg`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Adgangslink': token },
            body: JSON.stringify(body)
        });
        const upload = (token, buf) => fetch(`${url}/pc-fejllog?navn=badminton-tv2&opstarter=5`, {
            method: 'POST', headers: { 'Content-Type': 'application/zip', 'X-Adgangslink': token }, body: buf
        });

        assert.equal((await spoerg('forkert-kode-1234', pc())).status, 403);
        assert.equal((await spoerg('x', pc())).status, 401);
        let r = await spoerg(AKTIVT, pc());
        assert.deepEqual(await r.json(), { hent: false });

        // Ingen bestilling: zip'en afvises, før den læses
        assert.equal((await upload(AKTIVT, zip())).status, 409);

        assert.equal(fl.bestil('direct', 7, 'badminton-tv2'), 'ok');
        r = await spoerg(AKTIVT, pc());
        assert.deepEqual(await r.json(), { hent: true });
        assert.equal((await upload('forkert-kode-1234', zip())).status, 403);
        assert.equal((await upload(AKTIVT, Buffer.from('ikke en zip, men lang nok til tjekket'))).status, 400);
        r = await upload(AKTIVT, zip());
        assert.equal(r.status, 200);
        assert.equal(fl.hentFil('direct', 7, 'badminton-tv2').meta.opstarter, 5);
        assert.equal((await upload(AKTIVT, zip())).status, 409, 'kun én zip pr. bestilling');
    });
});

test('ruterne: admins knap og download kræver admin-login', () => {
    const kilde = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'screens.js'), 'utf8');
    assert.match(kilde, /router\.post\('\/:klientId\/fejllog', skaermAdmin,/);
    assert.match(kilde, /router\.get\('\/:klientId\/fejllog', skaermAdmin,/);
    // Adgangslinket tjekkes, før kroppen læses — og kroppen læses med bevarKlub
    assert.match(kilde, /router\.post\('\/pc-fejllog', fejllogAdgang, laesZip,/);
    assert.match(kilde, /const laesZip = bevarKlub\(express\.raw\(/);
});
