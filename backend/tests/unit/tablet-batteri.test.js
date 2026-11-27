/**
 * Tablets' batteri i admin — kun klubbens egne tablets (fast adgangslink til en
 * bane), aldrig en privat telefon via QR-koden (Jesper 2026-11-27).
 *
 * backend/taeller/batteri.js (registeret), POST /api/game-states/:bane/taeller
 * (batteriet med livstegnet), GET /api/screens/batterier (admin) og visningen
 * i admin (baneoversigten + Adgangslinks).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-til-batteri';
const batteri = require('../../taeller/batteri');
const { adgangslinkSession } = require('../../middleware/adgangslinkSession');

const rod = path.join(__dirname, '..', '..', '..');
const laes = (rel) => fs.readFileSync(path.join(rod, rel), 'utf8');

// Det, enheden faktisk bærer: sessionen fra /t/:token, afkodet
function session(destination, token_type = 'permanent') {
    const { sessionToken } = adgangslinkSession({ id: 11, destination, locked: 1, token_type }, 'klub');
    return jwt.verify(sessionToken, process.env.JWT_SECRET);
}

test('kun et fast adgangslink til en bane er klubbens tablet', () => {
    assert.equal(batteri.erKlubbensTablet(session('court/3')), true);
    assert.equal(batteri.erKlubbensTablet(session('court/3', 'match_session')), false, 'QR-telefonen');
    assert.equal(batteri.erKlubbensTablet({ ...session('court/3', 'match_session'), via: 'ur' }), false, 'uret');
    assert.equal(batteri.erKlubbensTablet(session('tv/3')), false, 'TV-link');
    assert.equal(batteri.erKlubbensTablet(session('oversigt')), false);
    assert.equal(batteri.erKlubbensTablet({ role: 'club_admin', clubSubdomain: 'klub' }), false, 'admin-login');
    assert.equal(batteri.erKlubbensTablet(undefined), false, 'lokal installation uden token');
});

test('batteriet renses: 0..1 fra browseren bliver til procent, skrald afvises', () => {
    assert.deepEqual(batteri.rensBatteri({ niveau: 0.64, lader: true }), { procent: 64, lader: true });
    assert.deepEqual(batteri.rensBatteri({ niveau: 1 }), { procent: 100, lader: false });
    assert.deepEqual(batteri.rensBatteri({ niveau: 0 }), { procent: 0, lader: false });
    assert.deepEqual(batteri.rensBatteri({ niveau: 37, lader: 'ja' }), { procent: 37, lader: false });
    for (const ugyldig of [null, 'x', {}, { niveau: -0.1 }, { niveau: 101 }, { niveau: 'abc' }, { niveau: NaN }]) {
        assert.equal(batteri.rensBatteri(ugyldig), null, JSON.stringify(ugyldig));
    }
});

test('registeret: pr. link og enhed, kun klubbens tablets, glemmer efter et døgn', () => {
    batteri._nulstil();
    const tablet = session('court/3');
    const nu = 1_000_000_000;
    assert.ok(batteri.registrer('klub_a', tablet, { taellerId: 'tabc12345678', bane: '3', enhed: 'Tablet i appen', batteri: { niveau: 0.5 } }, nu));
    // Samme enhed igen: opdateres, ikke en ny række
    batteri.registrer('klub_a', tablet, { taellerId: 'tabc12345678', bane: '3', enhed: 'Tablet i appen', batteri: { niveau: 0.48, lader: true } }, nu + 10000);
    // QR-telefonen og et TV-link registreres ikke
    assert.equal(batteri.registrer('klub_a', session('court/3', 'match_session'), { taellerId: 'tqr12345678', bane: '3', batteri: { niveau: 0.9 } }, nu), null);
    assert.equal(batteri.registrer('klub_a', session('tv/3'), { taellerId: 'ttv12345678', bane: '3', batteri: { niveau: 0.9 } }, nu), null);
    // Uden batteri (iPad/Firefox) registreres intet
    assert.equal(batteri.registrer('klub_a', tablet, { taellerId: 'tipad1234567', bane: '3', batteri: null }, nu), null);

    const liste = batteri.liste('klub_a', nu + 20000);
    assert.equal(liste.length, 1);
    assert.deepEqual(
        { tokenId: liste[0].tokenId, kort: liste[0].kort, bane: liste[0].bane, enhed: liste[0].enhed, procent: liste[0].procent, lader: liste[0].lader, sek: liste[0].sekunderSiden },
        { tokenId: 11, kort: 'tabc1234', bane: 3, enhed: 'Tablet i appen', procent: 48, lader: true, sek: 10 });
    assert.equal(batteri.liste('klub_b', nu).length, 0, 'klubberne er adskilt');
    assert.equal(batteri.liste('klub_a', nu + batteri.GLEM_EFTER_MS + 20000).length, 0, 'glemt efter et døgn');
});

test('GET /api/screens/batterier: admin-login kræves og svaret har kun det nødvendige', async (t) => {
    batteri._nulstil();
    batteri.registrer('direct', session('court/2'), { taellerId: 'tabc12345678', bane: '2', enhed: 'Tablet', batteri: { niveau: 0.15 } });

    const stub = (rel, exports) => {
        const sti = require.resolve(rel);
        require.cache[sti] = { id: sti, filename: sti, loaded: true, exports };
    };
    let logget = false;
    stub('../../middleware/auth', {
        authMiddleware: (req, res, next) => (logget ? next() : res.status(401).json({ error: 'Ingen autorisation token' })),
        requireWriteAuthInClubMode: (req, res, next) => next()
    });
    stub('../../config/database', { query: async () => [], queryOne: async () => null });
    delete require.cache[require.resolve('../../routes/screens')];

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/screens', require('../../routes/screens'));
    const srv = http.createServer(app).listen(0);
    t.after(() => { srv.closeAllConnections(); srv.close(); });
    const url = `http://127.0.0.1:${srv.address().port}/api/screens/batterier`;

    assert.equal((await fetch(url)).status, 401, 'uden admin-login');
    logget = true;
    const svar = await (await fetch(url)).json();
    assert.equal(svar.length, 1);
    assert.deepEqual(Object.keys(svar[0]).sort(), ['bane', 'enhed', 'kort', 'lader', 'procent', 'sekunderSiden', 'tokenId']);
    assert.equal(svar[0].procent, 15);
});

test('livstegnet: batteriet registreres fra req.user (tokenet), ikke fra noget enheden selv påstår', () => {
    const kilde = laes('backend/routes/gameStates.js');
    const rute = kilde.slice(kilde.indexOf("router.post('/:courtId/taeller'"), kilde.indexOf("router.post('/:courtId/result'"));
    assert.match(rute, /batteri\.registrer\(req\.clubDbName \|\| 'direct', req\.user, \{/);
    assert.match(rute, /taellerId: id, bane: req\.params\.courtId/);
    // Efter tjek af banen og tæller-id'et
    assert.ok(rute.indexOf('batteri.registrer') > rute.indexOf("'Bane ikke fundet'"));
});

test('tælleren sender kun batteriet fra et fast bane-adgangslink', () => {
    const c = laes('frontend/court-script-v3.js');
    assert.match(c, /function erKlubbensTablet\(\) \{[\s\S]*?p\.tokenType !== 'match_session'[\s\S]*?\/\^court\\\/\\d\+\$\/\.test/);
    assert.match(c, /function batteriNu\(\) \{\s*if \(!erKlubbensTablet\(\)\) return null;/);
    assert.match(c, /api\.taeller\(courtId, TAELLER_ID, TAELLER_NAVN, handling, batteriNu\(\)\)/);
    const a = laes('frontend/js/api.js');
    assert.match(a, /async taeller\(courtId, taellerId, taellerNavn, handling = 'ping', batteri = null\)/);
    assert.match(a, /if \(batteri\) body\.batteri = batteri;/);
    assert.match(a, /getTabletBatterier\(\) \{\s*return this\.request\('\/screens\/batterier'/);
});

test('admin: mærke på banekortet og linjer under adgangslinket', () => {
    const a = laes('frontend/admin-script.js');
    assert.match(a, /const batteriHtml = baneBatteriHtml\(courtNumber\);/);
    assert.equal((a.match(/<span class="court-header__hoejre">\$\{batteriHtml\}/g) || []).length, 3, 'alle tre udgaver af banekortet');
    assert.match(a, /renderTabletBatterier\(tablets\.filter\(b => b\.tokenId === id\)\)/);
    assert.match(a, /b\.lader \? 'vundet' : b\.procent <= 10 \? 'fare' : b\.procent <= 20 \? 'afventer' : 'neutral'/);
    // Hentes hvert 30. sekund, ikke i hvert 2,5 s-tick
    assert.match(a, /if \(Date\.now\(\) - _batterierHentet > BATTERI_HENT_MS\) hentTabletBatterier\(\);/);
    assert.match(laes('frontend/admin.html'), /admin-script\.js\?v=135/);
    assert.match(laes('frontend/js/ikoner.js'), /batteri: +'M4 7h13/);
});
