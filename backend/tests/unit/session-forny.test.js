/**
 * Unit-tests af "Jeg er her stadig" (POST /api/session/forny) — ingen server,
 * ingen database.
 *
 * Kør: npm run test:unit
 */
process.env.JWT_SECRET = 'unit-test-secret-mindst-32-tegn-aaaaaaaa';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { fornyetToken, MAKS_SESSION_SEK } = require('../../middleware/sessionForny');
const { authMiddleware } = require('../../middleware/auth');
const { clubAdminAuth } = require('../../middleware/clubAdminAuth');
const { superAdminAuth } = require('../../middleware/superAdminAuth');

const NU = 2_000_000_000;
const sign = (payload, sek) => jwt.sign({ iat: NU - 3600, ...payload }, process.env.JWT_SECRET, { expiresIn: sek });
const laes = (token) => jwt.verify(token, process.env.JWT_SECRET, { clockTimestamp: NU });

async function run(mw, token) {
    let status = 200, body = null, nexted = false;
    const res = {
        status(c) { status = c; return this; },
        json(b) { body = b; return this; }
    };
    await mw({ headers: { authorization: `Bearer ${token}` }, path: '/x', accessMode: 'direct' }, res, () => { nexted = true; });
    return { status, body, nexted };
}

test('fornyet token: samme indhold og samme levetid, regnet fra nu', () => {
    const gammel = jwt.decode(sign({ role: 'club_admin', id: 1, clubSubdomain: 'lyngby', permissions: ['admin'], pv: 'abc' }, '24h'));
    const ny = laes(fornyetToken(gammel, NU));
    assert.equal(ny.role, 'club_admin');
    assert.equal(ny.clubSubdomain, 'lyngby');
    assert.deepEqual(ny.permissions, ['admin']);
    assert.equal(ny.pv, 'abc');
    assert.equal(ny.iat, NU);
    assert.equal(ny.exp - ny.iat, 24 * 3600);
});

test('fornyet token: husker tidspunktet for det oprindelige login', () => {
    const foerste = jwt.decode(sign({ role: 'super_admin', id: 1 }, '8h'));
    const ny = laes(fornyetToken(foerste, NU));
    assert.equal(ny.loggetInd, foerste.iat);
    // Fornyes igen senere: loggetInd flytter sig ikke
    const igen = jwt.verify(fornyetToken(ny, NU + 7200), process.env.JWT_SECRET, { clockTimestamp: NU + 7200 });
    assert.equal(igen.loggetInd, foerste.iat);
});

test('fornyet token: efter en uge skal man logge ind igen', () => {
    const t = jwt.decode(sign({ role: 'club_admin', id: 1, loggetInd: NU - MAKS_SESSION_SEK - 1 }, '24h'));
    assert.equal(fornyetToken(t, NU), null);
});

test('fornyet token: levetiden kappes ved ugegrænsen', () => {
    const t = jwt.decode(sign({ role: 'club_admin', id: 1, loggetInd: NU - MAKS_SESSION_SEK + 3600 }, '24h'));
    const ny = laes(fornyetToken(t, NU));
    assert.equal(ny.exp, NU + 3600);
});

test('fornyet token: must-change følger med (super-admin)', () => {
    const t = jwt.decode(sign({ role: 'super_admin', id: 1, mustChange: true }, '8h'));
    assert.equal(laes(fornyetToken(t, NU)).mustChange, true);
});

// Udløbne tokens: siden skal kunne se, at det er sessionen der er slut
for (const [navn, mw] of [['authMiddleware', authMiddleware], ['clubAdminAuth', clubAdminAuth], ['superAdminAuth', superAdminAuth]]) {
    test(`${navn}: udløbet token giver 401 med sessionExpired`, async () => {
        const udloebet = jwt.sign({ role: 'super_admin', admin: true }, process.env.JWT_SECRET, { expiresIn: -10 });
        const r = await run(mw, udloebet);
        assert.equal(r.status, 401);
        assert.equal(r.body.sessionExpired, true);
        assert.equal(r.nexted, false);
    });
}
