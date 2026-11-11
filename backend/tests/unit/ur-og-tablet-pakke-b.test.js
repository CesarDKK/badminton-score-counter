/**
 * Unit-tests af pakke B (uret og tabletten i hallen) og nr. 31 (TV'ets QR-kode):
 *
 *  - adgangslink-vagt.js fornyer enhedens session, før den udløber, uden at
 *    genindlæse siden (nr. 27) — køres i en lille falsk browser (vm)
 *  - ur-script.js: dobbelttryk-værn, timeout på kald, køen hænger ikke ved 4xx,
 *    linket med en gammel kode bruger den gemte kobling (nr. 22–24)
 *  - court-script-v3.js: mærket vises ved første fejl eller en hængende gemning
 *    og ligger over dialogerne (nr. 25); fortryd i dialogerne (nr. 26)
 *  - tv-script-v3.js: QR-koden hentes igen ved 'reset' (nr. 31)
 *
 * Skærm-scripts har ingen moduler, så de sidste tre tjekkes på kildeteksten —
 * som live-events.test.js gør det. Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const laes = (fil) => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', fil), 'utf8');

// Et JWT-payload uden signatur er nok til decodeJwtPayload (api.js verificerer ikke)
function falskJwt(payload) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

// Den falske browser, adgangslink-vagt.js kører i
function browser({ token, svar }) {
    const lager = { deviceToken: token };
    const kald = [];
    const api = {
        token,
        async request(sti, opt = {}) {
            kald.push(`${(opt.method || 'GET')} ${sti}`);
            const s = svar[sti];
            if (s instanceof Error) throw s;
            return s;
        }
    };
    const window = {
        BadmintonAPI: api,
        decodeJwtPayload: (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()),
        location: { search: '', origin: 'https://lyngby.badmintonapp.dk', replace: (u) => { window.skiftetTil = u; } },
        addEventListener() {}
    };
    const sandbox = {
        window, console: { log() {} },
        sessionStorage: { getItem: (k) => lager[k] ?? null, setItem: (k, v) => { lager[k] = v; } },
        document: { hidden: false, addEventListener() {} },
        setInterval() {}, setTimeout() {}, URL, URLSearchParams, Date
    };
    vm.runInNewContext(laes('js/adgangslink-vagt.js'), sandbox);
    return { window, api, lager, kald };
}

const dag = 24 * 3600;
const nu = Math.floor(Date.now() / 1000);
const tablet = (exp) => falskJwt({ role: 'device', tokenId: 7, destination: 'court/2', locked: 1, tokenType: 'permanent', iat: nu - 11 * dag, exp });
const mit = { destination: 'court/2', locked: 1, showQrOnTv: 0 };

test('nr. 27: under 3 dage tilbage → ny session tages i brug uden genindlæsning', async () => {
    const gammel = tablet(nu + 2 * dag);
    const ny = tablet(nu + 14 * dag);
    const b = browser({ token: gammel, svar: { '/device-tokens/mit': mit, '/device-tokens/mit/skift': { url: `/court-v3.html?court=2&dt=${ny}` } } });
    assert.equal(b.window.AdgangslinkVagt.skalFornys(b.window.decodeJwtPayload(gammel)), true);
    await b.window.AdgangslinkVagt.tjek();
    assert.deepEqual(b.kald, ['GET /device-tokens/mit', 'POST /device-tokens/mit/skift']);
    assert.equal(b.lager.deviceToken, ny, 'sessionStorage har den nye session');
    assert.equal(b.api.token, ny, 'api.js bruger den nye session');
    assert.equal(b.window.skiftetTil, undefined, 'siden genindlæses ikke midt i en kamp');
});

// Nr. 63: en tablet, der sover mellem de ugentlige træninger, nåede sjældent
// 3-dages-vinduet. Nu fornys sessionen, når den er over et døgn gammel (iat).
const session = (iat, exp) => falskJwt({ role: 'device', tokenId: 7, destination: 'court/2', locked: 1, tokenType: 'permanent', iat, exp });

test('nr. 63: en session over et døgn gammel fornys, selv med 11 dage tilbage', async () => {
    const t = tablet(nu + 11 * dag); // udstedt for 11 dage siden, 11 dage tilbage
    const ny = session(nu, nu + 14 * dag);
    const b = browser({ token: t, svar: { '/device-tokens/mit': mit, '/device-tokens/mit/skift': { url: `/court-v3.html?court=2&dt=${ny}` } } });
    assert.equal(b.window.AdgangslinkVagt.skalFornys(b.window.decodeJwtPayload(t)), true);
    await b.window.AdgangslinkVagt.tjek();
    assert.deepEqual(b.kald, ['GET /device-tokens/mit', 'POST /device-tokens/mit/skift']);
    assert.equal(b.lager.deviceToken, ny);
    assert.equal(b.window.skiftetTil, undefined, 'siden genindlæses ikke');
});

test('nr. 63: en ugentlig træning holder tabletten logget ind — 25 timer gammel fornys, 23 timer ikke', () => {
    const b = browser({ token: tablet(nu + 13 * dag), svar: {} });
    const { skalFornys } = b.window.AdgangslinkVagt;
    assert.equal(skalFornys({ iat: nu - 25 * 3600, exp: nu + 13 * dag }), true);
    assert.equal(skalFornys({ iat: nu - 23 * 3600, exp: nu + 13 * dag }), false);
});

test('nr. 63: en frisk session (under et døgn) → intet skift, kun det sædvanlige tjek', async () => {
    const t = session(nu - 3600, nu + 14 * dag);
    const b = browser({ token: t, svar: { '/device-tokens/mit': mit } });
    assert.equal(b.window.AdgangslinkVagt.skalFornys(b.window.decodeJwtPayload(t)), false);
    await b.window.AdgangslinkVagt.tjek();
    assert.deepEqual(b.kald, ['GET /device-tokens/mit']);
    assert.equal(b.lager.deviceToken, t);
});

test('nr. 63: uden iat gælder 3-dages-reglen stadig som reserve', () => {
    const b = browser({ token: tablet(nu + 13 * dag), svar: {} });
    const { skalFornys } = b.window.AdgangslinkVagt;
    assert.equal(skalFornys({ exp: nu + 2 * dag }), true);
    assert.equal(skalFornys({ exp: nu + 11 * dag }), false);
    assert.equal(skalFornys({}), false);
});

test('nr. 27: et ændret link skifter stadig side (som før) — også med kort tid tilbage', async () => {
    const t = tablet(nu + 1 * dag);
    const ny = falskJwt({ role: 'device', tokenId: 7, destination: 'court/5', exp: nu + 14 * dag });
    const b = browser({ token: t, svar: {
        '/device-tokens/mit': { ...mit, destination: 'court/5' },
        '/device-tokens/mit/skift': { url: `/court-v3.html?court=5&dt=${ny}` }
    } });
    await b.window.AdgangslinkVagt.tjek();
    assert.equal(b.window.skiftetTil, `/court-v3.html?court=5&dt=${ny}`);
});

test('nr. 27: et svar uden session (eller et net, der er væk) ændrer intet', async () => {
    const t = tablet(nu + 1 * dag);
    const b = browser({ token: t, svar: { '/device-tokens/mit': mit, '/device-tokens/mit/skift': { url: '/court-v3.html?court=2' } } });
    await b.window.AdgangslinkVagt.tjek();
    assert.equal(b.lager.deviceToken, t);
    assert.equal(b.window.AdgangslinkVagt.sessionFraAdresse('ikke en adresse %%%'), null);
    const nede = browser({ token: t, svar: { '/device-tokens/mit': new Error('Failed to fetch') } });
    await nede.window.AdgangslinkVagt.tjek();
    assert.equal(nede.lager.deviceToken, t);
});

test('nr. 27: auth-guard forklarer på login-siden, at enhedens adgang er udløbet', () => {
    const src = laes('js/auth-guard.js');
    assert.match(src, /isExpired\(deviceToken\)[\s\S]{0,400}loginBesked/);
});

test('nr. 22: uret afviser dobbelttryk på samme side og spærrer de store knapper lige efter et skærmskift', () => {
    const src = laes('ur-script.js');
    assert.match(src, /const DOBBELTTRYK_MS = \d+/);
    assert.match(src, /sidstePoint\.side === side && nu - sidstePoint\.tid < DOBBELTTRYK_MS\) return/);
    assert.match(src, /const SKIFT_SPAERRING_MS = \d+/);
    // "Fortsæt", "Ny kamp" og "Færdig" tjekker spærringen
    for (const id of ['naeste', 'nyKamp', 'faerdig']) {
        assert.match(src, new RegExp(`\\$\\('${id}'\\)\\.addEventListener\\('click', \\(\\) => \\{[^\\n]*storKnapSpaerret\\(\\)`), id);
    }
    // Skiftet registreres, når pausen/kampslut kommer frem
    assert.match(src, /skaermSkiftTid = Date\.now\(\)/);
});

test('nr. 23: kald har timeout, 4xx tømmer køen med besked, 404 logger uret ud, fortryd uden virkning siges', () => {
    const src = laes('ur-script.js');
    assert.match(src, /const KALD_TIMEOUT_MS = \d+/);
    assert.match(src, /new AbortController\(\)[\s\S]{0,200}signal: styring\.signal/);
    assert.match(src, /status === 404 && data && data\.error\)[\s\S]{0,300}sessionSlut\(data\.error\)/);
    assert.match(src, /status >= 400 && status < 500 && status !== 429 && status !== 409\) \{[\s\S]{0,400}gemt\.ko = \[\];[\s\S]{0,300}visBesked/);
    assert.match(src, /t\.handling === 'U' && data\.afvist\) visBesked\('Intet at fortryde'\)/);
    // Usendte tryk vises nedtonet
    assert.match(src, /classList\.toggle\('venter', gemt\.ko\.length > 0\)/);
    assert.match(laes('ur.html'), /#kampSide\.venter \.spiller \.point \{ opacity/);
});

test('nr. 24: linkets kode fejler → den gemte kobling bruges; samme bane beholder køen; tastaturet er låst under kobling', () => {
    const src = laes('ur-script.js');
    assert.match(src, /kobl\(k, true\)/);
    assert.match(src, /if \(fraLink && gemt\.token\) return brugGemtKobling\(/);
    assert.match(src, /const ko = gemt\.token && data\.bane === gemt\.bane \? gemt\.ko : \[\]/);
    assert.match(src, /if \(koblerPaa\) return;/);
});

test('nr. 25: tablettens mærke vises ved første fejl eller en hængende gemning, og ligger over dialogerne', () => {
    const src = laes('court-script-v3.js');
    // Ingen tæller på to fejl længere: mærket følger ok/ikke ok direkte
    assert.match(src, /badge\.style\.display = ok \? 'none' : 'flex'/);
    assert.doesNotMatch(src, /_saveFailCount/);
    assert.match(src, /const SYNC_LANGSOM_MS = 5000/);
    assert.match(src, /lastSaveStartedAt = Date\.now\(\);\s*\n\s*syncGemningBegyndt\(\);/);
    const css = laes('court-v3-styles.css');
    const z = css.match(/#syncStatusBadge \{[^}]*z-index:\s*(\d+)/)[1];
    assert.ok(Number(z) > 10000, `z-index ${z} skal ligge over beskedoverlayet (10000)`);
    assert.match(laes('court-v3.html'), /Ingen forbindelse — tæl videre, genindlæs ikke/);
});

test('nr. 26: fortryd i "Sæt Vundet!", pausen og kampslut; "Ny kamp" rydder direkte; kampslut vises igen ved indlæsning', () => {
    const src = laes('court-script-v3.js');
    assert.match(src, /'Sæt Vundet!',[\s\S]{0,700}text: 'Fortryd sidste point', callback: \(\) => undoLastAction\(\)/);
    assert.match(src, /getElementById\('undoInRestBreak'\)\.addEventListener\('click', undoLastAction\)/);
    assert.match(laes('court-v3.html'), /id="undoInRestBreak"/);
    assert.match(src, /\{ text: 'Ny kamp', callback: \(\) => performClearCourtNow\(\), style: 'primary' \}/);
    // (nr. 67: og kun når der er noget at fortryde)
    assert.match(src, /outcome \|\| !\(gameState\.history && gameState\.history\.length > 0\) \? \[\]\s*: \[\{ text: 'Fortryd sidste point'/);
    // Fast tablet med afsluttet kamp: dialogen igen i stedet for en død tavle
    assert.match(src, /if \(!isMatchSessionToken\(\)\) \{\s*\n\s*showMatchWonMessage\(!!\(assignedHoldkampGameId \|\| assignedTournamentMatchId\)\)/);
});

test('nr. 31: TV\'et henter QR-koden igen ved reset og i sikkerhedsnettet, og prøver /api/mode igen', () => {
    const src = laes('tv-script-v3.js');
    // (nr. 68: hentes igen i baggrunden — den viste kode står, til den nye er der)
    assert.match(src, /event\.type === 'reset'\) qrGenhent = true/);
    assert.match(src, /_tvByCourtDirty = true;[^\n]*\n\s*qrGenhent = true;/);
    assert.match(src, /function hentQrTilladelseIgen\(/);
    assert.match(src, /qrCounterEnabled = false;\s*\n[\s\S]{0,300}hentQrTilladelseIgen\(qrAllowedByToken\)/);
});
