/**
 * Nr. 58c: hver upload-rute med multer 2.x mod den rigtige backend.
 *
 * Pr. rute:
 *  - en gyldig fil går igennem
 *  - en for stor fil afvises med samme statuskode og besked som med multer 1.x
 *  - en forkert filtype afvises (400)
 *  - en ødelagt multipart-krop (afkortet, uden boundary, tomt feltnavn) giver
 *    en pæn 4xx, og en upload, klienten afbryder midtvejs, vælter ikke
 *    processen: backenden svarer stadig bagefter, og der ligger ingen halve
 *    filer tilbage i klubbens upload-mappe
 *
 * Ruterne: sponsorbilleder, livestream-logo, super-admins logo-bibliotek og
 * logo-pakke, gendan fra fil (klub, demo og super-admin).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { kald, superToken, opretKlub, ADMIN_HOST } = require('./faelles');

const PORT = Number(process.env.TEST_PORT || 3999);
const MB = 1024 * 1024;
let K, superT, demoT, png, backupK;

// Send en multipart-krop i bidder: dele = [{ felt, filnavn, type, data | stoerrelse }, ...].
// slutgraense: false giver en afkortet krop. afbrydEfter: luk forbindelsen efter så mange bytes.
// Stopper med at skrive, så snart serveren har svaret (som en browser).
function send(sti, { host, token, dele = [], contentType, slutgraense = true, afbrydEfter = null }) {
    return new Promise((resolve, reject) => {
        const graense = '----up' + crypto.randomBytes(8).toString('hex');
        const headers = { Host: host, 'Content-Type': contentType || `multipart/form-data; boundary=${graense}`, Connection: 'close' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const bidder = [];
        for (const d of dele) {
            const navn = d.felt === null ? '' : `; name="${d.felt}"`;
            bidder.push(Buffer.from(`--${graense}\r\nContent-Disposition: form-data${navn}; filename="${d.filnavn}"\r\nContent-Type: ${d.type}\r\n\r\n`));
            if (d.data) bidder.push(Buffer.isBuffer(d.data) ? d.data : Buffer.from(d.data));
            // Store filer i bidder á 1 MB (ingen 100 MB-buffer i testen)
            for (let rest = d.stoerrelse || 0; rest > 0; rest -= MB) bidder.push(Buffer.alloc(Math.min(MB, rest), 0x61));
            bidder.push(Buffer.from('\r\n'));
        }
        if (slutgraense) bidder.push(Buffer.from(`--${graense}--\r\n`));

        let svaret = false;
        const r = http.request({ host: '127.0.0.1', port: PORT, path: sti, method: 'POST', headers }, (res) => {
            svaret = true;
            const ud = [];
            res.on('data', d => ud.push(d));
            res.on('end', () => {
                const tekst = Buffer.concat(ud).toString('utf8');
                let body = tekst;
                try { body = JSON.parse(tekst); } catch { /* ikke JSON */ }
                resolve({ status: res.statusCode, body });
            });
        });
        r.on('error', (e) => {
            if (afbrydEfter !== null) return resolve({ afbrudt: true });
            if (!svaret) reject(e);
        });
        (async () => {
            let sendt = 0;
            for (const b of bidder) {
                if (svaret || r.destroyed) return;
                if (afbrydEfter !== null && sendt + b.length >= afbrydEfter) {
                    r.write(b.subarray(0, Math.max(0, afbrydEfter - sendt)));
                    await new Promise(ok => setTimeout(ok, 100));
                    r.destroy();
                    return;
                }
                sendt += b.length;
                if (!r.write(b)) await new Promise(ok => r.once('drain', ok));
            }
            r.end();
        })().catch(() => {});
    });
}

async function lever() {
    const r = await kald('/health');
    assert.equal(r.status, 200, 'backenden svarer stadig');
}

const klubFiler = () => {
    const mappe = path.join(process.env.UPLOAD_DIR, K.db);
    return fs.existsSync(mappe) ? fs.readdirSync(mappe).sort() : [];
};

before(async () => {
    superT = await superToken();
    K = await opretKlub('uploadk', 'Upload K');
    png = await require('sharp')({ create: { width: 80, height: 40, channels: 4, background: '#336699' } }).png().toBuffer();
    const l = await kald('/api/auth/login', { method: 'POST', body: { password: process.env.TEST_ADMIN_PASSWORD || 'admin123' } });
    assert.equal(l.status, 200, 'demoens admin-login');
    demoT = l.body.token;
    const b = await kald(`/api/super-admin/clubs/${K.id}/backup`, { host: ADMIN_HOST, token: superT });
    assert.equal(b.status, 200);
    backupK = JSON.stringify(b.body);
});

after(lever);

// Ruterne. ok: en gyldig del; stor: { del, status, fejl }; forkert: dele med forkert type → status/fejl
const RUTER = [
    {
        navn: 'sponsorbilleder', sti: '/api/sponsors/upload', host: () => K.host, token: () => K.adminToken,
        ok: () => [{ felt: 'images', filnavn: 'sponsor.png', type: 'image/png', data: png }], okStatus: [200, 201],
        stor: { del: { felt: 'images', filnavn: 'stor.png', type: 'image/png', stoerrelse: 10 * MB + 1024 }, status: 400, fejl: 'Filen er for stor. Maksimum 10MB.' },
        forkert: [
            { del: { felt: 'images', filnavn: 'x.html', type: 'text/html', data: '<script>1</script>' }, status: 400, fejl: 'Kun JPEG, PNG, GIF eller WebP er tilladt' },
            { del: { felt: 'images', filnavn: 'x.png', type: 'image/png', data: '<html><script>1</script></html>' }, status: 400, fejl: 'Filen er ikke et gyldigt billede' },
        ],
        felt: 'images', disk: true,
    },
    {
        navn: 'livestream-logo', sti: '/api/livestream/logo', host: () => K.host, token: () => K.adminToken,
        ok: () => [{ felt: 'logo', filnavn: 'logo.png', type: 'image/png', data: png }], okStatus: [200],
        stor: { del: { felt: 'logo', filnavn: 'stor.png', type: 'image/png', stoerrelse: 10 * MB + 1024 }, status: 400, fejl: 'Filen er for stor. Maksimum 10MB.' },
        forkert: [
            { del: { felt: 'logo', filnavn: 'x.svg', type: 'image/svg+xml', data: '<svg/>' }, status: 400, fejl: 'Kun JPEG, PNG, GIF eller WebP er tilladt' },
            { del: { felt: 'logo', filnavn: 'x.png', type: 'image/png', data: 'ikke et billede, bare tekst' }, status: 400, fejl: 'Filen er ikke et gyldigt billede' },
        ],
        felt: 'logo', disk: true,
    },
    {
        // Loftet er 5 MB, men beskeden har altid sagt 10MB (den fælles fejlhåndtering) — uændret
        navn: 'super-admins logo-bibliotek', sti: '/api/super-admin/logos', host: () => ADMIN_HOST, token: () => superT,
        ok: () => [{ felt: 'image', filnavn: 'klub.png', type: 'image/png', data: png }], ekstraFelt: { clubName: 'Upload-test Klub' }, okStatus: [201],
        stor: { del: { felt: 'image', filnavn: 'stor.png', type: 'image/png', stoerrelse: 5 * MB + 1024 }, status: 400, fejl: 'Filen er for stor. Maksimum 10MB.' },
        forkert: [
            { del: { felt: 'image', filnavn: 'x.gif', type: 'application/octet-stream', data: 'GIF89a' }, status: 400, fejl: 'Kun JPEG, PNG, GIF eller WebP er tilladt' },
        ],
        felt: 'image',
    },
    {
        navn: 'gendan fra fil (klub)', sti: '/api/backup/restore', host: () => K.host, token: () => K.adminToken,
        ok: () => [{ felt: 'backup', filnavn: 'backup.json', type: 'application/json', data: backupK }], okStatus: [200],
        stor: { del: { felt: 'backup', filnavn: 'stor.json', type: 'application/json', stoerrelse: 100 * MB + 1024 }, status: 413, fejl: 'Backup-filen er for stor (højst 100 MB)' },
        forkert: [
            { del: { felt: 'backup', filnavn: 'x.png', type: 'image/png', data: png }, status: 400, fejl: 'Ugyldig backup-fil — kunne ikke parse JSON' },
        ],
        felt: 'backup',
    },
    {
        navn: 'gendan fra fil (demoen)', sti: '/api/backup/restore', host: () => '127.0.0.1', token: () => demoT,
        stor: { del: { felt: 'backup', filnavn: 'stor.json', type: 'application/json', stoerrelse: 10 * MB + 1024 }, status: 413, fejl: 'Backup-filen er for stor til demoen (højst 10 MB)' },
        forkert: [
            { del: { felt: 'backup', filnavn: 'x.txt', type: 'text/plain', data: 'ikke json' }, status: 400, fejl: 'Ugyldig backup-fil — kunne ikke parse JSON' },
        ],
        felt: 'backup',
    },
    {
        navn: 'gendan (super-admin)', sti: () => `/api/super-admin/clubs/${K.id}/restore`, host: () => ADMIN_HOST, token: () => superT,
        ok: () => [{ felt: 'backup', filnavn: 'backup.json', type: 'application/json', data: backupK }], okStatus: [200],
        stor: { del: { felt: 'backup', filnavn: 'stor.json', type: 'application/json', stoerrelse: 100 * MB + 1024 }, status: 413, fejl: 'Filen er for stor (højst 100 MB)' },
        forkert: [
            { del: { felt: 'backup', filnavn: 'x.txt', type: 'text/plain', data: 'ikke json' }, status: 400, fejl: 'Ugyldig backup-fil — kunne ikke parse JSON' },
        ],
        felt: 'backup',
    },
    {
        navn: 'logo-pakke (super-admin)', sti: '/api/super-admin/logos/import-bundle', host: () => ADMIN_HOST, token: () => superT,
        ok: () => {
            const AdmZip = require('adm-zip');
            const z = new AdmZip();
            z.addFile('Pakkeklubben.png', png);
            return [{ felt: 'bundle', filnavn: 'logoer.zip', type: 'application/zip', data: z.toBuffer() }];
        }, okStatus: [200],
        stor: { del: { felt: 'bundle', filnavn: 'stor.zip', type: 'application/zip', stoerrelse: 100 * MB + 1024 }, status: 413, fejl: 'Filen er for stor (højst 100 MB)' },
        forkert: [
            { del: { felt: 'bundle', filnavn: 'x.zip', type: 'application/zip', data: 'ikke en zip' }, status: 400, fejl: 'Ugyldig eller beskadiget zip-fil' },
        ],
        felt: 'bundle',
    },
];

const stiFor = (r) => typeof r.sti === 'function' ? r.sti() : r.sti;

// Tekstfelter (clubName) som ekstra dele uden filnavn
function medFelter(r, dele) {
    if (!r.ekstraFelt) return dele;
    return [...Object.entries(r.ekstraFelt).map(([k, v]) => ({ tekst: true, felt: k, v })), ...dele];
}

// send() kender kun fil-dele; med tekstfelter (clubName) bygges kroppen her
async function sendMed(r, dele) {
    const alle = medFelter(r, dele);
    if (!alle.some(d => d.tekst)) return send(stiFor(r), { host: r.host(), token: r.token(), dele });
    const graense = '----upf' + crypto.randomBytes(6).toString('hex');
    const bidder = [];
    for (const d of alle) {
        if (d.tekst) bidder.push(Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="${d.felt}"\r\n\r\n${d.v}\r\n`));
        else bidder.push(Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="${d.felt}"; filename="${d.filnavn}"\r\nContent-Type: ${d.type}\r\n\r\n`), Buffer.from(d.data), Buffer.from('\r\n'));
    }
    bidder.push(Buffer.from(`--${graense}--\r\n`));
    return rawKald(stiFor(r), r, Buffer.concat(bidder), graense);
}

function rawKald(sti, r, krop, graense) {
    return new Promise((resolve, reject) => {
        const headers = { Host: r.host(), Authorization: `Bearer ${r.token()}`, 'Content-Type': `multipart/form-data; boundary=${graense}`, 'Content-Length': krop.length };
        const q = http.request({ host: '127.0.0.1', port: PORT, path: sti, method: 'POST', headers }, (res) => {
            const ud = [];
            res.on('data', d => ud.push(d));
            res.on('end', () => { const t = Buffer.concat(ud).toString('utf8'); let b = t; try { b = JSON.parse(t); } catch { /* */ } resolve({ status: res.statusCode, body: b }); });
        });
        q.on('error', reject);
        q.end(krop);
    });
}

for (const r of RUTER) {
    if (r.ok) {
        test(`${r.navn}: en gyldig fil går igennem`, async () => {
            const s = await sendMed(r, r.ok());
            assert.ok(r.okStatus.includes(s.status), `${s.status} ${JSON.stringify(s.body).slice(0, 300)}`);
        });
    }

    test(`${r.navn}: en for stor fil afvises (${r.stor.status}, samme besked som før)`, async () => {
        const foer = r.disk ? klubFiler() : null;
        const s = await send(stiFor(r), { host: r.host(), token: r.token(), dele: [r.stor.del] });
        assert.equal(s.status, r.stor.status, JSON.stringify(s.body).slice(0, 300));
        assert.equal(s.body.error, r.stor.fejl);
        if (r.disk) assert.deepEqual(klubFiler(), foer, 'den for store fil er ikke efterladt på disken');
        await lever();
    });

    for (const f of r.forkert) {
        test(`${r.navn}: forkert filtype (${f.del.type}, ${f.del.filnavn}) afvises med ${f.status}`, async () => {
            const foer = r.disk ? klubFiler() : null;
            const s = await sendMed(r, [f.del]);
            assert.equal(s.status, f.status, JSON.stringify(s.body).slice(0, 300));
            assert.equal(s.body.error, f.fejl);
            if (r.disk) assert.deepEqual(klubFiler(), foer, 'den afviste fil er ikke efterladt på disken');
        });
    }

    test(`${r.navn}: ødelagte multipart-kroppe giver en pæn 4xx, og backenden lever`, async () => {
        const foer = r.disk ? klubFiler() : null;
        const godDel = { felt: r.felt, filnavn: 'a.png', type: 'image/png', data: png };
        const tilfaelde = {
            'afkortet krop (ingen slutgrænse)': { dele: [godDel], slutgraense: false },
            'Content-Type uden boundary': { dele: [godDel], contentType: 'multipart/form-data' },
            'del uden feltnavn': { dele: [{ ...godDel, felt: null }] },
            'uventet felt': { dele: [{ ...godDel, felt: 'noget_andet' }] },
        };
        for (const [navn, t] of Object.entries(tilfaelde)) {
            const s = await send(stiFor(r), { host: r.host(), token: r.token(), ...t });
            assert.ok(s.status >= 400 && s.status < 500, `${navn}: ${s.status} ${JSON.stringify(s.body).slice(0, 200)}`);
            assert.equal(typeof s.body.error, 'string', `${navn}: en fejlbesked`);
            assert.doesNotMatch(s.body.error, /Unexpected end|Boundary not found|Malformed|Field name missing/, `${navn}: dansk besked, ikke busboys`);
            await lever();
        }
        if (r.disk) assert.deepEqual(klubFiler(), foer, 'ingen halve filer efter de ødelagte kroppe');
    });

    test(`${r.navn}: en upload, klienten afbryder midtvejs, vælter ikke backenden`, async () => {
        const foer = r.disk ? klubFiler() : null;
        const s = await send(stiFor(r), { host: r.host(), token: r.token(), dele: [{ felt: r.felt, filnavn: 'halv.png', type: 'image/png', stoerrelse: 3 * MB }], afbrydEfter: 1 * MB });
        assert.ok(s.afbrudt || s.status >= 400, JSON.stringify(s));
        await new Promise(ok => setTimeout(ok, 300));
        await lever();
        if (r.disk) assert.deepEqual(klubFiler(), foer, 'den halve fil er ryddet op');
    });
}

test('upload efter alle fejlene: en ny gyldig sponsorfil går stadig igennem i den rigtige klub', async () => {
    const s = await send('/api/sponsors/upload', { host: K.host, token: K.adminToken, dele: [{ felt: 'images', filnavn: 'til-sidst.png', type: 'image/png', data: png }] });
    assert.ok([200, 201].includes(s.status), JSON.stringify(s.body));
    assert.ok(klubFiler().length >= 1);
});
