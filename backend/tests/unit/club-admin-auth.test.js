/**
 * Unit-tests af clubAdminAuth (adgangslinks og eget kodeord) — ingen server, ingen database.
 *
 * Tokenet skal være et club_admin-token udstedt til DENNE klub. Før tjekkede
 * middlewaren kun rollen, så en admin fra klub A kunne se, oprette og slette
 * klub B's adgangslinks — og dermed få tæller-adgang hos B.
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { clubAdminAuth, generateClubAdminToken } = require('../../middleware/clubAdminAuth');
const { requirePage } = require('../../middleware/pagePermission');

const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });

function run(mw, { token, accessMode = 'club', clubSubdomain = 'lyngby', user } = {}) {
    let status = 200, body = null, nexted = false;
    const req = { headers: token ? { authorization: `Bearer ${token}` } : {}, accessMode, clubSubdomain, user };
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    mw(req, res, () => { nexted = true; });
    return { status, body, nexted, req };
}

test('klubbens egen admin får adgang, og req.clubAdmin/req.user sættes', () => {
    const r = run(clubAdminAuth, { token: generateClubAdminToken(1, 'anna', 'lyngby') });
    assert.equal(r.nexted, true);
    assert.equal(r.req.clubAdmin.clubSubdomain, 'lyngby');
    assert.equal(r.req.user.role, 'club_admin');
});

test('admin fra en ANDEN klub afvises (det var hullet)', () => {
    const r = run(clubAdminAuth, { token: generateClubAdminToken(1, 'bo', 'gentofte') });
    assert.equal(r.status, 403);
    assert.equal(r.nexted, false);
});

test('club_admin-token uden klub afvises', () => {
    const r = run(clubAdminAuth, { token: sign({ role: 'club_admin', id: 1 }) });
    assert.equal(r.status, 403);
});

test('uden for club-mode (app., admin., IP) afvises club_admin-tokens', () => {
    for (const accessMode of ['direct', 'admin']) {
        const r = run(clubAdminAuth, { token: generateClubAdminToken(1, 'anna', 'lyngby'), accessMode, clubSubdomain: undefined });
        assert.equal(r.status, 403, accessMode);
    }
});

test('device-, super-admin- og simple admin-tokens afvises', () => {
    for (const payload of [{ role: 'device', clubSubdomain: 'lyngby' }, { role: 'super_admin' }, { admin: true }]) {
        const r = run(clubAdminAuth, { token: sign(payload) });
        assert.equal(r.status, 403, JSON.stringify(payload));
    }
});

test('manglende og ugyldigt token giver 401', () => {
    assert.equal(run(clubAdminAuth, {}).status, 401);
    assert.equal(run(clubAdminAuth, { token: 'noget.vroevl.her' }).status, 401);
});

test('adgangslinks kræver side-rettigheden devicetokens', () => {
    const med = generateClubAdminToken(1, 'anna', 'lyngby', ['devicetokens', 'history']);
    const uden = generateClubAdminToken(2, 'carl', 'lyngby', ['history']);
    const alle = generateClubAdminToken(3, 'dora', 'lyngby', null);
    const kaede = (token) => {
        const a = run(clubAdminAuth, { token });
        if (!a.nexted) return a.status;
        return run(requirePage('devicetokens'), { user: a.req.user }).nexted ? 200 : 403;
    };
    assert.equal(kaede(med), 200);
    assert.equal(kaede(alle), 200);
    assert.equal(kaede(uden), 403);
});
