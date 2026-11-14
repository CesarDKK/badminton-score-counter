/**
 * Windows Hello-kameraet (Lyngby 2026-11-14): streamen sendte det infrarøde billede.
 * TV-PC'en vælger nu selv billedet (kiosk: stream, find_kamera — testet i
 * kiosk/test/test-stream.sh), melder hvilken node der sender og sine kameraer,
 * og admin kan vælge et bestemt kamera pr. PC (migration 047, camera_device).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-kamera-ir';

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

// ---------- Falsk database (før ruterne indlæses — de destrukturerer query) ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const ls = require('../../screens/livestream');
const livestream = require('../../routes/livestream');

function rute(router, metode, sti) {
    const lag = router.stack.find(l => l.route && l.route.path === sti && l.route.methods[metode]);
    assert.ok(lag, `${metode.toUpperCase()} ${sti} findes`);
    const handlers = lag.route.stack;
    return handlers[handlers.length - 1].handle;
}
async function koer(handler, req) {
    const res = { statusKode: 200, krop: null,
        status(s) { this.statusKode = s; return this; }, json(j) { this.krop = j; return this; } };
    let fejl = null;
    await handler(req, res, (e) => { fejl = e; });
    if (fejl) throw fejl;
    return res;
}

const RGB = 'usb-17ef_Lenovo_500_RGB_Camera_SN0001-if00-video-index0';
const IR = 'usb-17ef_Lenovo_500_RGB_Camera_SN0001-if02-video-index0';

test('kameraets by-id-link: kun et rigtigt link godtages', () => {
    assert.equal(ls.rensKameraEnhed(RGB), RGB);
    assert.equal(ls.rensKameraEnhed('usb-046d_HD_Pro_Webcam_C920_ABCDEF12-video-index0'), 'usb-046d_HD_Pro_Webcam_C920_ABCDEF12-video-index0');
    for (const ugyldig of ['../../etc/passwd', '/dev/video0', 'video0', 'usb-x video-index0', `${'a'.repeat(160)}-video-index0`, 7, null]) {
        assert.equal(ls.rensKameraEnhed(ugyldig), null, String(ugyldig));
    }
});

test('PC\'ens status: noden, der sender, og listen over kameraer renses', () => {
    const s = ls.rensStatus({
        kamera: 'Lenovo 500 RGB Camera: Lenovo 5', kameraInput: 'MJPEG 1920x1080', kameraNode: 'video0 · interface 00',
        kameraer: [
            { id: RGB, navn: 'Lenovo 500 RGB Camera: Lenovo 5', node: 'video0', interface: '00', format: 'MJPEG 1920x1080', billede: 'farve' },
            { id: IR, navn: 'Lenovo 500 RGB Camera: Lenovo 5\u0007', node: 'video2', interface: '02', format: 'YUYV 640x360', billede: 'graa' },
            { id: '../x', navn: 'falsk' },
            { id: 'usb-x-video-index0', node: '/dev/video9', interface: 'if', format: 'GREY 1x1', billede: 'ja' }
        ]
    });
    assert.equal(s.kameraNode, 'video0 · interface 00');
    assert.equal(s.kameraer.length, 3, 'det ugyldige link er sorteret fra');
    assert.deepEqual(s.kameraer[1], { id: IR, navn: 'Lenovo 500 RGB Camera: Lenovo 5', node: 'video2', interface: '02', format: 'YUYV 640x360', billede: 'graa' });
    assert.deepEqual(s.kameraer[2], { id: 'usb-x-video-index0', navn: '', node: null, interface: null, format: null, billede: null });
    assert.equal(ls.rensStatus({ kameraNode: 'video0; rm -rf' }).kameraNode, null);
    assert.equal(ls.rensStatus({ kameraer: 'nej' }).kameraer, null);
    assert.equal(ls.rensStatus({ kameraer: [] }).kameraer, null);
    assert.equal(ls.rensStatus({ kameraer: Array(9).fill({ id: RGB }) }).kameraer.length, 6, 'højst 6');
});

test('mørk hal: prøvebilledet "for mørkt" og et uafgjort kameravalg når frem til admin', () => {
    const s = ls.rensStatus({
        kameraValg: 'uafgjort',
        kameraer: [{ id: RGB, billede: 'moerk' }, { id: IR, billede: 'graa' }]
    });
    assert.equal(s.kameraValg, 'uafgjort');
    assert.deepEqual(s.kameraer.map(k => k.billede), ['moerk', 'graa']);
    for (const v of ['admin', 'eneste', 'proeve']) assert.equal(ls.rensStatus({ kameraValg: v }).kameraValg, v);
    assert.equal(ls.rensStatus({ kameraValg: 'lysest' }).kameraValg, null);
    assert.equal(ls.rensStatus({}).kameraValg, null);
    const admin = laes('frontend/admin-script.js');
    assert.match(admin, /s\.kameraValg === 'uafgjort'/);
    assert.match(admin, /k\.billede === 'moerk' \? 'for mørkt til prøvebillede'/);
});

test('PUT /kamera/:tokenId { enhed }: kun kameraet på PC\'en gemmes — banen røres ikke', async () => {
    const put = rute(livestream, 'put', '/kamera/:tokenId');
    nulstil(async (sql) => (/SELECT id FROM device_tokens/.test(sql) ? [{ id: 5 }] : { affectedRows: 1 }));
    let res = await koer(put, { params: { tokenId: '5' }, body: { enhed: RGB } });
    assert.equal(res.statusKode, 200);
    const opd = kald.filter(k => /^UPDATE/.test(k.sql));
    assert.equal(opd.length, 1);
    assert.match(opd[0].sql, /SET camera_device = \? WHERE id = \?/);
    assert.deepEqual(opd[0].params, [RGB, 5]);

    // Automatisk igen
    nulstil(async (sql) => (/SELECT id FROM device_tokens/.test(sql) ? [{ id: 5 }] : { affectedRows: 1 }));
    res = await koer(put, { params: { tokenId: '5' }, body: { enhed: null } });
    assert.deepEqual(kald.find(k => /camera_device/.test(k.sql)).params, [null, 5]);

    // Ugyldigt link afvises, intet gemmes
    nulstil(async (sql) => (/SELECT id FROM device_tokens/.test(sql) ? [{ id: 5 }] : { affectedRows: 1 }));
    res = await koer(put, { params: { tokenId: '5' }, body: { enhed: '/dev/video2' } });
    assert.equal(res.statusKode, 400);
    assert.equal(kald.filter(k => /^UPDATE/.test(k.sql)).length, 0);

    // Banen som før (camera_device røres ikke)
    nulstil(async (sql) => (/SELECT id FROM device_tokens/.test(sql) ? [{ id: 5 }] : { affectedRows: 1 }));
    res = await koer(put, { params: { tokenId: '5' }, body: { bane: 2 } });
    assert.equal(res.statusKode, 200);
    assert.ok(kald.every(k => !/camera_device/.test(k.sql)));
    assert.ok(kald.some(k => /SET camera_court = \?, camera_manual = 1/.test(k.sql)));
});

test('POST /pc sender admins valg med (kameraEnhed), og admin får det i listen', () => {
    const kilde = laes('backend/routes/livestream.js');
    assert.match(kilde, /SELECT id, camera_court, camera_manual, camera_device, destination, token_type/);
    assert.match(kilde, /svar\.kameraEnhed = link\.camera_device \|\| null;\s*\n\s*res\.json\(svar\);/);
    assert.match(kilde, /enhed: l\.camera_device \|\| null,/);
    assert.match(laes('backend/migrations/047_kamera_enhed.sql'), /ADD COLUMN camera_device VARCHAR\(160\) NULL/);
});
