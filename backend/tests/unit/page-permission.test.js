/**
 * Unit-tests af side-rettighederne (middleware/pagePermission.js).
 *
 * Før blev de kun brugt til at skjule menupunkter: en klub-admin med adgang til
 * fx kun Holdkamp kunne ændre indstillinger, sponsorer og spillere og gendanne
 * en backup med direkte kald til API'et.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requirePage, requireFuldAdgang } = require('../../middleware/pagePermission');

function run(mw, user) {
    let status = 200, body = null, nexted = false;
    const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
    mw({ user }, res, () => { nexted = true; });
    return { status, body, nexted };
}

const kunHoldkamp = { role: 'club_admin', clubSubdomain: 'lyngby', permissions: ['holdkamp'] };
const alleSider = { role: 'club_admin', clubSubdomain: 'lyngby', permissions: null };

test('requirePage: admin med siden får adgang', () => {
    assert.equal(run(requirePage('holdkamp'), kunHoldkamp).nexted, true);
});

test('requirePage: admin uden siden afvises med 403', () => {
    for (const side of ['settings', 'sponsors', 'playerinfo', 'tournament', 'history']) {
        const r = run(requirePage(side), kunHoldkamp);
        assert.equal(r.status, 403, side);
        assert.equal(r.nexted, false, side);
    }
});

test('requirePage: fuld adgang (permissions = null), super-admin, adgangslinks og direct-mode berøres ikke', () => {
    for (const user of [alleSider, { role: 'super_admin' }, { role: 'device', destination: 'court/3' }, { admin: true }, undefined]) {
        assert.equal(run(requirePage('settings'), user).nexted, true, JSON.stringify(user));
    }
});

test('requirePage: en tom liste betyder ingen sider', () => {
    assert.equal(run(requirePage('holdkamp'), { role: 'club_admin', permissions: [] }).status, 403);
});

test('requireFuldAdgang: backup kræver adgang til alle sider', () => {
    const r = run(requireFuldAdgang, { ...kunHoldkamp, permissions: ['holdkamp', 'tournament', 'history', 'playerinfo', 'settings', 'sponsors', 'devicetokens'] });
    assert.equal(r.status, 403);
    assert.match(r.body.error, /alle sider/);
    assert.equal(run(requireFuldAdgang, alleSider).nexted, true);
    assert.equal(run(requireFuldAdgang, { role: 'super_admin' }).nexted, true);
    assert.equal(run(requireFuldAdgang, { admin: true }).nexted, true);
});
