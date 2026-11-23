/**
 * Unit-tests: "Stop for denne kamp" på tabletten under en holdkamp (migration
 * 055). Holdkampe sendes af sig selv; tabletten kan springe delkampen på banen
 * over, og den næste delkamp sendes igen af sig selv — Jesper 2026-11-21.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ls = require('../../screens/livestream');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const OPS = { enabled: 1, stream_key: 'abcd-efgh-ijkl-mnop', stream_url: ls.STANDARD_URL, overlay: 1 };
const gs = (ekstra = {}) => ({
    player1_name: 'Hansen', player1_name2: null, player1_score: 3, player1_games: 0,
    player2_name: 'Jensen', player2_name2: null, player2_score: 1, player2_games: 0,
    match_start_time: new Date(NU - 5 * MIN), match_end_time: null, match_completed: 0,
    set_scores_history: '[]', updated_at: new Date(NU - MIN), ...ekstra
});
const laes = (fil) => fs.readFileSync(path.join(__dirname, '../../..', fil), 'utf8');

// Delkamp 41 står på banen; holdkampen spilles
const iGang = { mangler: 5, igang: 1, slut: null, start: new Date(NU - 10 * MIN), roert: new Date(NU - MIN), ungdom: 0, delkamp: 41 };

test('beslutning: den sprungne delkamp sendes ikke — den næste gør', () => {
    const over = { ...OPS, holdkamp_spring_over: 41 };
    assert.deepEqual(ls.beslutning({ opsaetning: over, gs: gs(), holdkamp: iGang, nu: NU }), { send: false, grund: 'holdkamp-sprunget-over' });
    // Afgjort og ryddet: heller ikke de sidste minutter (og mellem delkampene sendes der aldrig)
    assert.equal(ls.beslutning({ opsaetning: over, gs: null, sidste: null, holdkamp: { ...iGang, igang: 0 }, nu: NU }).send, false);
    const afgjort = gs({ player1_games: 2, match_completed: 1, match_end_time: new Date(NU - MIN) });
    assert.equal(ls.beslutning({ opsaetning: over, gs: afgjort, holdkamp: { ...iGang, igang: 0 }, senderNu: true, nu: NU }).send, false);
    // Næste delkamp sat på banen: sendes igen af sig selv
    assert.equal(ls.beslutning({ opsaetning: over, gs: gs(), holdkamp: { ...iGang, delkamp: 42 }, nu: NU }).grund, 'holdkamp');
    // Tal fra databasen (streng) tæller som samme delkamp
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, holdkamp_spring_over: '41' }, gs: gs(), holdkamp: iGang, nu: NU }).send, false);
    // Intet sprunget over, eller ingen delkamp kendt: som før
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: iGang, nu: NU }).grund, 'holdkamp');
    assert.equal(ls.beslutning({ opsaetning: over, gs: gs(), holdkamp: { ...iGang, delkamp: null }, nu: NU }).grund, 'holdkamp');
    // Startet med vilje bagefter (tabletten / hele dagen) gælder stadig
    assert.equal(ls.beslutning({ opsaetning: { ...over, manual_since: new Date(NU - MIN) }, gs: gs(), holdkamp: iGang, nu: NU }).grund, 'valgt');
    assert.equal(ls.beslutning({ opsaetning: { ...over, all_day_until: new Date(NU + 60 * MIN) }, gs: gs(), holdkamp: iGang, nu: NU }).grund, 'hele-dagen');
    // "Stop for i dag" står over
    assert.equal(ls.beslutning({ opsaetning: { ...over, holdkamp_stop_until: new Date(NU + 60 * MIN) }, gs: gs(), holdkamp: iGang, nu: NU }).grund, 'holdkamp-stoppet');
});

test('tabletten og admin: kampen sendes ikke, og den kan sendes alligevel', () => {
    const over = { ...OPS, holdkamp_spring_over: 41 };
    const t = ls.tabletStatus({ opsaetning: over, kamera: true, holdkamp: iGang, nu: NU });
    assert.equal(t.holdkamp, false);
    assert.equal(t.sprunget, true);
    assert.equal(ls.tabletStatus({ opsaetning: over, kamera: true, holdkamp: { ...iGang, delkamp: 42 }, nu: NU }).sprunget, false);
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, holdkamp: iGang, nu: NU }).holdkamp, true);
    // En ungdomsholdkamp sendes alligevel ikke af sig selv — intet at "sende alligevel"
    assert.equal(ls.tabletStatus({ opsaetning: over, kamera: true, holdkamp: { ...iGang, ungdom: 1 }, nu: NU }).sprunget, false);
    const admin = ls.holdkampTilAdmin({ holdkamp: iGang, info: { hold1: 'A', hold2: 'B', delkamp: null }, opsaetning: over, nu: NU });
    assert.equal(admin.sendes, false);
    assert.equal(admin.sprunget, true);
});

test('tablettens knap: stop under holdkampen, send alligevel bagefter', () => {
    const kilde = laes('frontend/court-script-v3.js');
    const start = kilde.indexOf('function livestreamKnapTekst(');
    const slut = kilde.indexOf('\n// Bekræftelsen før', start);
    const ctx = {};
    vm.createContext(ctx);
    vm.runInContext(kilde.slice(start, slut) + '\nthis.f = livestreamKnapTekst;', ctx);
    assert.equal(ctx.f({ start: null, holdkamp: false, sprunget: true, youtube: null }).tekst, 'Livestream: kampen sendes ikke — send alligevel');
    assert.equal(ctx.f({ start: null, holdkamp: false, sprunget: true, youtube: null }).live, false);
    assert.match(kilde, /\/livestream\/bane\/\$\{courtId\}\/spring-over`, \{ method: over \? 'POST' : 'DELETE' \}/);
    assert.match(kilde, /text: 'Stop for denne kamp', style: 'danger'/);
    assert.match(laes('frontend/court-v3.html'), /court-script-v3\.js\?v=73/);
});

test('serveren: ruterne og migrationen', () => {
    const r = laes('backend/routes/livestream.js');
    assert.match(r, /router\.post\('\/bane\/:bane\/spring-over', tablet,/);
    assert.match(r, /router\.delete\('\/bane\/:bane\/spring-over', tablet,/);
    assert.match(r, /UPDATE court_streams SET holdkamp_spring_over = \?\$\{slet \? ', yt_slet = 1' : ''\} WHERE court_number = \?`, \[h\.delkamp, bane\]/);
    assert.match(r, /ORDER BY g\.status = 'active' DESC, g\.started_at DESC, g\.id DESC LIMIT 1/);
    assert.match(laes('backend/migrations/055_livestream_spring_delkamp.sql'),
        /ALTER TABLE court_streams ADD COLUMN holdkamp_spring_over INT NULL DEFAULT NULL;/);
    const a = laes('frontend/admin-script.js');
    assert.match(a, /'holdkamp-sprunget-over':/);
    assert.match(a, /if \(h\.sprunget\) \{/);
    assert.match(laes('frontend/admin.html'), /admin-script\.js\?v=131/);
});
