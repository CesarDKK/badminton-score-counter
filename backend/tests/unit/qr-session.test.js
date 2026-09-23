/**
 * Unit-tests af QR-tælleren — ingen server, ingen database.
 *
 * Enhver telefon må scanne QR-koden på TV'et og tælle uden login, men:
 *   - QR-koden udleveres kun til banens TV (eller en admin)
 *   - en QR-session må kun skrive til sin egen bane, og kun indtil banen ryddes/overtages
 *   - en QR-session må ikke indrapportere holdkamp- og turneringsresultater
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { kunEgenBane, ikkeQrSession, afvisQrKode, baneFraDestination } = require('../../middleware/qrSession');
const { _saetAdgangslinkOpslag } = require('../../middleware/auth');
// Adgangslink-opslaget i databasen: id 3 er et aktivt TV-link, 4 er tilbagekaldt
_saetAdgangslinkOpslag(async (id) => id === 3);

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
const qrSession = (bane, klub = 'lyngby') => ({ role: 'device', tokenType: 'match_session', tokenId: 7, destination: `court/${bane}`, clubSubdomain: klub });
const tvLink = (dest, klub = 'lyngby') => ({ role: 'device', tokenType: 'permanent', tokenId: 3, destination: dest, clubSubdomain: klub });

async function run(mw, request) {
    let status = 200, body = null, nexted = false, fejl = null;
    const res = {
        status(c) { status = c; return this; },
        json(b) { body = b; return this; }
    };
    await mw(request, res, (err) => { if (err) fejl = err; else nexted = true; });
    return { status, body, nexted, fejl };
}

const qrReq = (payload, { klub = 'lyngby' } = {}) => ({
    headers: payload ? { authorization: `Bearer ${sign(payload)}` } : {},
    clubSubdomain: klub
});

// ── Hvem får QR-koden udleveret ──────────────────────────────────────────

test('QR-kode: uden token afvises (det var hullet: alle kunne hente /api/qr-code/1)', async () => {
    assert.equal(await afvisQrKode(qrReq(null), 1), 401);
});

test('QR-kode: ugyldigt token afvises', async () => {
    assert.equal(await afvisQrKode({ headers: { authorization: 'Bearer noget-vroevl' }, clubSubdomain: 'lyngby' }, 1), 401);
});

test('QR-kode: et tilbagekaldt TV-link får den ikke', async () => {
    assert.equal(await afvisQrKode(qrReq({ ...tvLink('tv/3'), tokenId: 4 }), 3), 401);
});

test('QR-kode: banens eget TV får den', async () => {
    assert.equal(await afvisQrKode(qrReq(tvLink('tv/3')), 3), null);
});

test('QR-kode: et TV til en anden bane får den ikke', async () => {
    assert.equal(await afvisQrKode(qrReq(tvLink('tv/4')), 3), 403);
});

test('QR-kode: gamle TV-links uden bane (tv, tv-v3) får den', async () => {
    assert.equal(await afvisQrKode(qrReq(tvLink('tv')), 3), null);
    assert.equal(await afvisQrKode(qrReq(tvLink('tv-v3')), 3), null);
});

test('QR-kode: en bane-tablet eller oversigten får den ikke', async () => {
    assert.equal(await afvisQrKode(qrReq(tvLink('court/3')), 3), 403);
    assert.equal(await afvisQrKode(qrReq(tvLink('oversigt')), 3), 403);
});

test('QR-kode: en QR-session kan ikke selv hente nye QR-koder', async () => {
    assert.equal(await afvisQrKode(qrReq({ ...qrSession(3), destination: 'tv/3' }), 3), 403);
});

test('QR-kode: klubbens admin og super-admin får den', async () => {
    assert.equal(await afvisQrKode(qrReq({ role: 'club_admin', clubSubdomain: 'lyngby' }), 3), null);
    assert.equal(await afvisQrKode(qrReq({ role: 'super_admin' }), 3), null);
});

test('QR-kode: TV eller admin fra en anden klub afvises', async () => {
    assert.equal(await afvisQrKode(qrReq(tvLink('tv/3', 'gentofte')), 3), 403);
    assert.equal(await afvisQrKode(qrReq({ role: 'club_admin', clubSubdomain: 'gentofte' }), 3), 403);
});

// ── En QR-session skriver kun til sin egen bane ──────────────────────────


test('egen bane: QR-session til bane 3 må skrive til bane 3', async () => {
    const r = await run(kunEgenBane('courtId'), { user: qrSession(3), params: { courtId: '3' } });
    assert.equal(r.nexted, true);
});

test('egen bane: QR-session til bane 3 må IKKE skrive til bane 4', async () => {
    const r = await run(kunEgenBane('courtId'), { user: qrSession(3), params: { courtId: '4' } });
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('egen bane: faste adgangslinks, admins og direct-mode (ingen bruger) berøres ikke', async () => {
    for (const user of [tvLink('court/3'), tvLink('court/5'), { role: 'club_admin', clubSubdomain: 'lyngby' }, undefined]) {
        const r = await run(kunEgenBane('courtId'), { user, params: { courtId: '3' } });
        assert.equal(r.nexted, true, JSON.stringify(user));
    }
});

// ── Holdkamp- og turneringsresultater ────────────────────────────────────

test('officielle resultater: QR-session afvises', async () => {
    const r = await run(ikkeQrSession, { user: qrSession(3) });
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('officielle resultater: bane-tablet og admin må stadig', async () => {
    assert.equal((await run(ikkeQrSession, { user: tvLink('court/3') })).nexted, true);
    assert.equal((await run(ikkeQrSession, { user: { role: 'club_admin' } })).nexted, true);
    assert.equal((await run(ikkeQrSession, {})).nexted, true);
});

test('baneFraDestination', () => {
    assert.equal(baneFraDestination('court/12'), 12);
    assert.equal(baneFraDestination('tv/3'), 3);
    assert.equal(baneFraDestination('oversigt'), null);
    assert.equal(baneFraDestination('court/3x'), null);
    assert.equal(baneFraDestination(undefined), null);
});

test('egen bane: banenummeret kan også komme fra body (kamphistorik)', async () => {
    const mw = kunEgenBane((req) => req.body && req.body.courtId);
    assert.equal((await run(mw, { user: qrSession(3), params: {}, body: { courtId: 3 } })).nexted, true);
    const r = await run(mw, { user: qrSession(3), params: {}, body: { courtId: 4 } });
    assert.equal(r.status, 403);
    assert.equal((await run(mw, { user: qrSession(3), params: {}, body: {} })).status, 403);
});
