/**
 * Pakke O — Jespers beslutninger i nr. 12–14 (gennemgangen nov. 2026):
 *   12B  bekræftelse på tabletten før "Start livestream"
 *   12C  appens egne udsendelser bliver "kun med linket" efter 60 dage
 *   13   spillerlisten (player-info) kræver admin
 *   14A  TV- og oversigt-links kan kun læse (plus skærmens egne ruter)
 * (12A — titlen uden spillernavne — står i livestream-youtube.test.js.)
 *
 * Ingen database og ingen Google: config/database.js og config/youtube.js
 * erstattes af falske, før ruterne indlæses. Frontend-funktioner hentes ud af
 * kildefilerne og køres i en vm-sandkasse.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-pakke-o-mindst-32-tegn';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();   // routes/livestream.js indlæser multer

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

function udsnit(kilde, fra, til) {
    const a = kilde.indexOf(fra);
    assert.ok(a >= 0, `markøren findes: ${fra}`);
    const b = kilde.indexOf(til, a + fra.length);
    assert.ok(b > a, `slutmarkøren findes: ${til}`);
    return kilde.slice(a, b);
}

const ls = require('../../screens/livestream');

// ======================= 12B: bekræftelse før "Start livestream" =======================

function tabletSandkasse(l) {
    const kilde = laes('frontend/court-script-v3.js');
    const fn = udsnit(kilde, '// Bekræftelsen før "Start livestream"', 'function swapPlayers(team)');
    const sb = {
        dialoger: [], kald: [], menu: 0, courtId: 3,
        showMessage(titel, tekst, knapper, opt) { sb.dialoger.push({ titel, tekst, knapper, opt }); },
        closeSettingsMenu() { sb.menu++; },
        api: { request: async (sti, o) => { sb.kald.push(`${o.method} ${sti}`); await new Promise(r => setTimeout(r, 5)); return { start: 'klar', efterMin: 2 }; } }
    };
    vm.createContext(sb);
    vm.runInContext('let livestream = null; const livestreamStopTekst = () => "2 minutter efter kampen er afgjort";\n' + fn +
        '\nthis.livestreamKnap = livestreamKnap; this.livestreamBekraeftTekst = livestreamBekraeftTekst; ' +
        'this.saet = (v) => { livestream = v; };', sb);
    sb.saet(l);
    return sb;
}

test('12B: teksten følger klubbens synlighed — "offentlig", når den er public eller ukendt (indtastet nøgle)', () => {
    const sb = tabletSandkasse(null);
    const slut = ' og bliver liggende. Spillerne skal være indforstået.';
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'public' }), 'Udsendelsen er offentlig på klubbens YouTube-kanal' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: null }), 'Udsendelsen er offentlig på klubbens YouTube-kanal' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'unlisted' }), 'Udsendelsen lægges på klubbens YouTube-kanal (kun med linket)' + slut);
    assert.equal(sb.livestreamBekraeftTekst({ synlighed: 'private' }), 'Udsendelsen lægges på klubbens YouTube-kanal (privat)' + slut);
});

test('12B: "Start livestream" spørger først (hver gang); Fortryd starter intet, og knapperne er spærret et øjeblik', async () => {
    const sb = tabletSandkasse({ kan: true, start: null, synlighed: 'unlisted' });
    await sb.livestreamKnap();
    assert.equal(sb.kald.length, 0, 'intet startes, før der svares');
    assert.equal(sb.dialoger.length, 1);
    const d = sb.dialoger[0];
    assert.equal(d.titel, 'Start livestream?');
    assert.match(d.tekst, /kun med linket/);
    assert.deepEqual([...d.knapper.map(k => k.text)], ['Start livestream', 'Fortryd']);
    assert.equal(d.knapper[1].callback, null, 'Fortryd lukker bare dialogen');
    assert.ok(d.opt && d.opt.spaerMs >= 500, 'dobbelttryk-værn: knapperne virker først efter et øjeblik');
    // Ja: ét kald, også ved dobbelttryk på knappen
    const a = d.knapper[0].callback();
    const b = d.knapper[0].callback();
    await Promise.all([a, b]);
    assert.deepEqual(sb.kald, ['POST /livestream/bane/3/start']);
    assert.equal(sb.dialoger[1].titel, 'Livestream startet');
    // Næste gang spørges der igen (intet "husk mit valg")
    sb.saet({ kan: true, start: null, synlighed: 'public' });
    await sb.livestreamKnap();
    assert.equal(sb.dialoger[2].titel, 'Start livestream?');
    assert.equal(sb.kald.length, 1);
});

test('12B: stop spørger ikke', async () => {
    const sb = tabletSandkasse({ kan: true, start: 'valgt' });
    await sb.livestreamKnap();
    assert.deepEqual(sb.kald, ['POST /livestream/bane/3/stop']);
    assert.equal(sb.dialoger[0].titel, 'Livestream stoppet');
});

test('12B: showMessage spærrer knapperne med spaerMs; tabletStatus giver synligheden kun med forbundet kanal', () => {
    const kilde = laes('frontend/court-script-v3.js');
    assert.match(udsnit(kilde, 'function showMessage(', 'function hideMessage()'), /options\.spaerMs > 0[\s\S]*btn\.disabled = true/);
    const ops = { enabled: 1, stream_key: 'k' };
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: true, ytSynlighed: 'unlisted' }).synlighed, 'unlisted');
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: false, ytSynlighed: 'unlisted' }).synlighed, null);
    assert.equal(ls.tabletStatus({ opsaetning: ops, kamera: true, youtube: true, ytSynlighed: 'noget' }).synlighed, null);
    assert.match(laes('frontend/court-v3.html'), /court-script-v3\.js\?v=69/);
});
