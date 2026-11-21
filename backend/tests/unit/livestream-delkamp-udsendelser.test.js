/**
 * Unit-tests: én YouTube-udsendelse pr. delkamp, og en kamp, der stoppes
 * undervejs, slettes på YouTube (migration 056) — Jesper 2026-11-21: "så det
 * er nemmere at finde kampene bagefter … så der ikke ligger halve kampe".
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ls = require('../../screens/livestream');

const NU = 1_800_000_000_000;   // 15. jan. 2027
const MIN = 60 * 1000;
const OPS = { enabled: 1, stream_key: 'abcd-efgh-ijkl-mnop', stream_url: ls.STANDARD_URL, overlay: 1 };
const gs = (ekstra = {}) => ({
    player1_name: 'Hansen', player1_name2: null, player1_score: 3, player1_games: 0,
    player2_name: 'Jensen', player2_name2: null, player2_score: 1, player2_games: 0,
    match_start_time: new Date(NU - 5 * MIN), match_end_time: null, match_completed: 0,
    set_scores_history: '[]', updated_at: new Date(NU - MIN), ...ekstra
});
const laes = (fil) => fs.readFileSync(path.join(__dirname, '../../..', fil), 'utf8');

test('beslutningen bærer delkampen med — og udsendelsen skifter, når en ny delkamp står på banen', () => {
    const hk = { mangler: 4, igang: 1, slut: new Date(NU - 3 * MIN), start: new Date(NU - MIN), roert: new Date(NU - MIN), delkamp: 42 };
    const b = ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: hk, nu: NU });
    assert.equal(b.delkamp, 42);
    // Udsendelsen til delkamp 41 er stadig åben (minutterne efter den): afslut, så en ny oprettes
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: 'b1', yt_delkamp: 41 }, b), true);
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: 'b1', yt_delkamp: '42' }, b), false);
    // Ingen udsendelse, en udsendelse uden delkamp (tabletten, før migrationen) eller send ikke: intet skift
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: null, yt_delkamp: 41 }, b), false);
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: 'b1', yt_delkamp: null }, b), false);
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: 'b1', yt_delkamp: 41 }, { send: false, delkamp: 42 }), false);
    assert.equal(ls.ytSkiftDelkamp({ yt_broadcast_id: 'b1', yt_delkamp: 41 }, { send: true, grund: 'afgjort' }), false);
    // ytHandling: skiftet afslutter den gamle; den nye oprettes ved næste forespørgsel
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek: new Date(NU), skift: true, nu: NU }), 'afslut');
    assert.equal(ls.ytHandling({ send: true, udsendelse: null, skift: true, nu: NU }), 'opret');
    assert.equal(ls.ytHandling({ send: true, udsendelse: 'b1', tjek: new Date(NU), nu: NU }), null);
});

test('titlen: delkampen først — "HD1: Lyngby 2 – Gentofte (bane 3, dato)"', () => {
    assert.equal(ls.delkampNavn('HD', 1), 'HD1');
    assert.equal(ls.delkampNavn('MD', 2), 'MD2');
    assert.equal(ls.delkampNavn('Single', 3), 'Single 3');
    assert.equal(ls.delkampNavn('GS', 1), 'Golden set');
    assert.equal(ls.delkampNavn('DS', 0), 'DS');
    assert.equal(ls.delkampNavn(null, 1), null);
    const t = ls.ytTitel({ grund: 'holdkamp', bane: 3, hold: ['Lyngby 2', 'Gentofte'], delkamp: 'HD1', nu: NU });
    assert.match(t, /^HD1: Lyngby 2 – Gentofte \(bane 3, 15\. jan\. 2027\)$/);
    // Uden delkamp som før
    assert.match(ls.ytTitel({ grund: 'holdkamp', bane: 3, hold: ['Lyngby 2', 'Gentofte'], nu: NU }), /^Lyngby 2 – Gentofte \(bane 3/);
    // Højst 100 tegn
    assert.ok(ls.ytTitel({ grund: 'holdkamp', bane: 3, hold: ['A'.repeat(60), 'B'.repeat(60)], delkamp: 'HD1', nu: NU }).length <= 100);
});

test('slet ved stop: kun en åben udsendelse til en kamp, der ikke er afgjort', () => {
    const o = { yt_broadcast_id: 'b1', yt_delkamp: 41 };
    assert.equal(ls.sletVedStop(o, { delkamp: 41, faerdig: false }), true);
    // Afgjort: kampen er hel og bliver liggende
    assert.equal(ls.sletVedStop(o, { delkamp: 41, faerdig: true }), false);
    // Udsendelsen hører til en anden delkamp (eller ingen): røres ikke
    assert.equal(ls.sletVedStop(o, { delkamp: 42, faerdig: false }), false);
    assert.equal(ls.sletVedStop({ yt_broadcast_id: 'b1', yt_delkamp: null }, { delkamp: 41, faerdig: false }), false);
    // Ingen udsendelse: intet at slette
    assert.equal(ls.sletVedStop({ yt_broadcast_id: null }, { faerdig: false }), false);
    assert.equal(ls.sletVedStop(null, { faerdig: false }), false);
    // En kamp startet på tabletten (ingen delkamp)
    assert.equal(ls.sletVedStop({ yt_broadcast_id: 'b2', yt_delkamp: null }, { faerdig: false }), true);
});

test('serveren: stoppene sætter yt_slet, skiftet og sletningen i ytStyr, og migrationen', () => {
    const r = laes('backend/routes/livestream.js');
    // Tablettens stop, "Stop for denne kamp", admins "Stop for i dag" og admins Stop af tablettens kamp
    assert.equal((r.match(/\$\{slet \? ', yt_slet = 1' : ''\}/g) || []).length, 4);
    // Fortrydes stoppet, før sletningen er nået, fortsætter udsendelsen
    assert.match(r, /SET holdkamp_spring_over = NULL, yt_slet = 0 WHERE/);
    assert.match(r, /SET holdkamp_stop_until = NULL, yt_slet = 0 WHERE/);
    assert.match(r, /skift: ls\.ytSkiftDelkamp\(o, b\)/);
    assert.match(r, /const hvad = sletIt \? await youtube\.slet\(token, o\.yt_broadcast_id\) : await youtube\.afslut\(token, o\.yt_broadcast_id\);/);
    assert.match(r, /yt_delkamp = \?, yt_slet = 0, yt_broadcast_tjek = \?/);
    // Hver rydning af udsendelsen rydder også delkampen og sletningen
    assert.equal((r.match(/yt_broadcast_id = NULL, yt_broadcast_start = NULL/g) || []).length,
        (r.match(/yt_broadcast_id = NULL, yt_broadcast_start = NULL, yt_delkamp = NULL, yt_slet = 0/g) || []).length);
    const m = laes('backend/migrations/056_yt_delkamp.sql');
    assert.match(m, /ALTER TABLE court_streams ADD COLUMN yt_delkamp INT NULL DEFAULT NULL;/);
    assert.match(m, /ALTER TABLE court_streams ADD COLUMN yt_slet TINYINT\(1\) NOT NULL DEFAULT 0;/);
});
