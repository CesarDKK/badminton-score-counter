'use strict';
/**
 * Unit-tests: resultater til badmintonplayer.dk som kladde (holdkampe) —
 * Jesper 2026-11-25, Badminton Danmark har sagt god for det. Knappen
 * "Overfør resultater" viser først, hvad der skrives, og gemmer kun de valgte.
 *
 * Modellen har samme form som badmintonplayers svar (GET LeagueMatch/{kampnr});
 * spillernavnene er opdigtede. Der sendes intet til badmintonplayer.dk — fetch
 * er stubbet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');

const bpr = require('../../config/bpResultat');

const HJ = 100, UD = 200;
const sp = (navn, i) => ({ playerId: 1000 + navn.length * 10 + i, playerIndex: i, player: { name: navn, clubId: 1 } });
const ctm = (id, nr, hj, ud, saet = []) => ({
    leagueMatchIndividualMatchId: id, matchIndex: nr, winnerWo: null,
    teamPlayers: { [HJ]: hj.map(sp), [UD]: ud.map(sp) },
    leagueMatchSet: saet.map(([a, b], i) => ({ leagueMatchIndividualMatch: null, leagueMatchIndividualMatchId: id, setIndex: i, points1: a, points2: b, teamIndex1: 0, teamIndex2: 1 })),
});
function model(ekstra = {}) {
    return {
        match: {
            leagueMatchId: 999001, leagueGroupTeamId1: HJ, leagueGroupTeamId2: UD, matchTime: '2026-11-28T13:00:00',
            liveScore: true, resultCompleted: false, matchResultRegistrationOpen: true, ...ekstra,
        },
        isDraft: false,
        combinedTeamMatches: [
            ctm(11, 1, ['Hans Hjemme', 'Hanne Hjemme'], ['Ulla Ude', 'Uffe Ude']),
            ctm(12, 2, ['Hilde Hjemme'], ['Ulrikke Ude']),
            ctm(13, 3, ['Henrik Hjemme'], ['Ulrik Ude'], [[15, 10], [15, 8]]),
            ctm(14, 4, ['Holger Hjemme'], ['Uwe Ude'], [[15, 3], [15, 4]]),
        ],
    };
}
// Vores holdkamp har udeholdet som hold 1 — sættene skal vendes
const delkampe = () => [
    { id: 1, game_number: 1, category: 'MD', team1_player1: 'Ulla Ude', team1_player2: 'Uffe Ude', team2_player1: 'Hans Hjemme', team2_player2: 'Hanne Hjemme',
      status: 'finished', winner_team: 2, set_scores: 'Hans Hjemme & Hanne Hjemme 15-12 Ulla Ude & Uffe Ude, Ulla Ude & Uffe Ude 10-15 Hans Hjemme & Hanne Hjemme' },
    { id: 2, game_number: 2, category: 'DS', team1_player1: 'Ulrikke Ude', team2_player1: 'Hilde Hjemme',
      status: 'finished', winner_team: 1, set_scores: '15-9 13-15 15-11' },
    { id: 3, game_number: 3, category: 'HS', team1_player1: 'Ulrik Ude', team2_player1: 'Henrik Hjemme',
      status: 'finished', winner_team: 2, set_scores: '10-15 8-15' },
    { id: 4, game_number: 4, category: 'HS', team1_player1: 'Uwe Ude', team2_player1: 'Holger Hjemme',
      status: 'finished', winner_team: 1, set_scores: '15-13 15-13' },
    { id: 5, game_number: 5, category: 'HS', team1_player1: 'Ukendt Ude', team2_player1: 'Ukendt Hjemme',
      status: 'pending', winner_team: null, set_scores: null },
];

test('sætcifrene i alle tre former, hold 1 først', () => {
    const g = { status: 'finished', team1_player1: 'Anna', team1_player2: 'Bo', team2_player1: 'Cy', team2_player2: 'Di' };
    // Tabletten: siderne byttet i 2. sæt
    assert.deepEqual(bpr.saetFraDelkamp({ ...g, winner_team: 1, set_scores: 'Anna & Bo 15-12 Cy & Di, Cy & Di 9-15 Anna & Bo' }).saet, [[15, 12], [15, 9]]);
    // "A / B" og andre store/små bogstaver
    assert.deepEqual(bpr.saetFraDelkamp({ ...g, winner_team: 2, set_scores: 'bo / anna 12-15 Di / Cy, Cy & Di 15-10 Anna & Bo' }).saet, [[12, 15], [10, 15]]);
    // Manuel og golden set
    assert.deepEqual(bpr.saetFraDelkamp({ ...g, winner_team: 1, set_scores: '15-9 13-15 15-11' }).saet, [[15, 9], [13, 15], [15, 11]]);
    assert.deepEqual(bpr.saetFraDelkamp({ ...g, winner_team: 2, set_scores: '12-15' }).saet, [[12, 15]]);
});

test('sætcifrene: det, der ikke skrives', () => {
    const g = { status: 'finished', winner_team: 1, team1_player1: 'Anna', team2_player1: 'Cy' };
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: 'W.O.' }).grund, /walkover/);
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: 'Anna 15-3 Cy (afsluttet før tid)' }).grund, /før tid/);
    assert.match(bpr.saetFraDelkamp({ ...g, status: 'active', set_scores: '15-3' }).grund, /ikke færdigspillet/);
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: 'Anna 15-3 Bent 15-4' }).grund, /navnene/);
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: 'Anna 15-3 Bent' }).grund, /navnene/);
    // Vinderen passer ikke med sættene
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: '3-15 4-15' }).grund, /vinderen/);
    assert.match(bpr.saetFraDelkamp({ ...g, set_scores: '15-15' }).grund, /lige/);
    assert.equal(bpr.saetFraDelkamp({ ...g, set_scores: '' }).ok, false);
});

test('planen: skriv, findes, spring — hjemmeholdet først', () => {
    const p = bpr.planKladde(delkampe(), model());
    assert.equal(p.spaerret, null);
    const l = Object.fromEntries(p.linjer.map(x => [x.gameId, x]));
    assert.equal(l[1].handling, 'skriv');
    assert.equal(l[1].bpKampId, 11);
    assert.deepEqual(l[1].saet, [[15, 12], [15, 10]]);       // vendt: hjemme vandt
    assert.equal(l[1].hold1, 'Hans Hjemme & Hanne Hjemme');  // navnene vendt med
    assert.equal(l[5].hold1, 'Ukendt Ude');                   // ikke fundet: som hos os
    assert.equal(l[2].handling, 'skriv');
    assert.deepEqual(l[2].saet, [[9, 15], [15, 13], [11, 15]]);
    assert.equal(l[3].handling, 'findes');                     // samme tal står der
    assert.equal(l[4].handling, 'spring');                     // andet resultat står der — røres ikke
    assert.match(l[4].grund, /15-3 15-4/);
    assert.equal(l[5].handling, 'spring');
});

test('planen: kun navne på begge hold — intet gæt på nummeret', () => {
    const g = delkampe();
    g[1].team2_player1 = 'Hilde Hjemmme';   // stavet forkert
    const l = bpr.planKladde(g, model()).linjer.find(x => x.gameId === 2);
    assert.equal(l.handling, 'spring');
    assert.match(l.grund, /holdsedlen/);
    // Walkover registreret på badmintonplayer
    const m = model();
    m.combinedTeamMatches[0].winnerWo = 1;
    assert.equal(bpr.planKladde(delkampe(), m).linjer[0].handling, 'spring');
});

test('planen: spærret kamp skriver intet', () => {
    for (const [ekstra, tekst] of [
        [{ resultCompleted: true }, /allerede indberettet/],
        [{ matchResultRegistrationOpen: false }, /ikke åben/],
        [{ liveScore: false }, /lukket for Live Score/],
    ]) {
        const p = bpr.planKladde(delkampe(), model(ekstra));
        assert.match(p.spaerret, tekst);
        assert.ok(p.linjer.every(x => x.handling !== 'skriv'));
    }
});

test('kladden: som badmintonplayers egen tæller, og intet andet ændres', () => {
    const m = model();
    m.combinedTeamMatches[1].leagueMatchSet = [{ leagueMatchIndividualMatch: null, leagueMatchIndividualMatchId: 12, setIndex: 0, points1: 0, points2: 0, teamIndex1: 0, teamIndex2: 1, ekstra: 'bevares' }];
    const foer = JSON.stringify(m);
    const p = bpr.planKladde(delkampe(), m);
    const ny = bpr.anvendKladde(m, p.linjer);
    assert.equal(JSON.stringify(m), foer, 'den hentede model er urørt');
    assert.equal(ny.IsDraft, true);
    assert.equal(ny.match.matchTime, '2026-11-28T13:00:00.000Z');
    assert.deepEqual(ny.combinedTeamMatches[0].leagueMatchSet, [
        { leagueMatchIndividualMatchId: 11, points1: 15, points2: 12, setIndex: 0, teamIndex1: 0, teamIndex2: 1 },
        { leagueMatchIndividualMatchId: 11, points1: 15, points2: 10, setIndex: 1, teamIndex1: 0, teamIndex2: 1 },
    ]);
    // Et eksisterende 0-0-sæt genbruges med sine felter
    assert.equal(ny.combinedTeamMatches[1].leagueMatchSet[0].ekstra, 'bevares');
    assert.deepEqual(ny.combinedTeamMatches[1].leagueMatchSet.map(s => [s.points1, s.points2]), [[9, 15], [15, 13], [11, 15]]);
    // Delkampe, der ikke skrives, er som før
    assert.deepEqual(ny.combinedTeamMatches[2], m.combinedTeamMatches[2]);
    assert.deepEqual(ny.combinedTeamMatches[3], m.combinedTeamMatches[3]);
    assert.equal(bpr.utcKlokkeslaet('2026-11-28T13:00'), '2026-11-28T13:00:00.000Z');
});

test('kaldene: koden som adgangskode ved hentning, i adressen ved gemning', async () => {
    const kald = [];
    const fetchFn = async (url, opt) => { kald.push({ url, opt }); return { ok: true, json: async () => model() }; };
    await bpr.hentMedKode(999001, 'ab12', { fetchFn });
    assert.equal(kald[0].url, `https://badmintonplayer.dk/api/LeagueMatch/999001?password=${encodeURIComponent(Buffer.from('ab12').toString('base64'))}&isLiveScore=true`);
    await bpr.gemKladde(999001, 'ab 12', { x: 1 }, { fetchFn });
    assert.equal(kald[1].url, 'https://badmintonplayer.dk/api/LeagueMatch/999001/ab%2012?regionId=2');
    assert.equal(kald[1].opt.method, 'PUT');
    assert.equal(kald[1].opt.body, '{"x":1}');
    await assert.rejects(bpr.gemKladde(999001, 'k', {}, { fetchFn: async () => ({ ok: false, status: 400, text: async () => 'Forkert kode' }) }), /HTTP 400.*Forkert kode/);
    await assert.rejects(bpr.hentMedKode('1;drop', 'k', { fetchFn }), /Ugyldigt kampnummer/);
});

// ── Ruterne, med stubbet database, login og badmintonplayer ─────────────────

function stub(rel, exports) {
    const sti = require.resolve(rel);
    require.cache[sti] = { id: sti, filename: sti, loaded: true, exports };
}

test('ruterne: vis, gem kun de valgte, læs efter — og ingen kode, ingen kladde', async (t) => {
    const db = { tm: { id: 7, aktiv_kilde_id: 999001, bp_livescore_kode: 'ab12' }, games: delkampe() };
    stub('../../config/database', {
        query: async (sql) => (/FROM team_match_games/.test(sql) ? db.games : []),
        queryOne: async (sql) => (/FROM team_matches/.test(sql) ? db.tm : null),
    });
    stub('../../middleware/auth', { authMiddleware: (req, res, next) => next() });
    stub('../../middleware/pagePermission', { requirePage: () => (req, res, next) => next() });

    let bp = model();
    const gemt = [];
    const rigtigFetch = global.fetch;
    global.fetch = async (url, opt = {}) => {
        if (opt.method === 'PUT') {
            gemt.push({ url, body: JSON.parse(opt.body) });
            bp = JSON.parse(opt.body);            // badmintonplayer gemmer kladden
            return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => JSON.parse(JSON.stringify(bp)) };
    };
    t.after(() => { global.fetch = rigtigFetch; });

    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use('/api/bp-livescore', require('../../routes/bpLivescore'));
    app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
    const srv = http.createServer(app).listen(0);
    t.after(() => srv.close());
    const url = `http://127.0.0.1:${srv.address().port}/api/bp-livescore/7/kladde`;
    const post = (body) => rigtigFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    // Visningen sender aldrig noget
    const vis = await (await rigtigFetch(url)).json();
    assert.deepEqual(vis.linjer.map(l => l.handling), ['skriv', 'skriv', 'findes', 'spring', 'spring']);
    assert.equal(gemt.length, 0);
    assert.doesNotMatch(JSON.stringify(vis), /ab12/, 'koden sendes ikke til admin');

    // Kun delkamp 1 valgt
    const r = await post({ gameIds: [1] });
    assert.equal(r.status, 200);
    const svar = await r.json();
    assert.equal(svar.skrevet, 1);
    assert.equal(svar.bekraeftet, 1);
    assert.equal(gemt.length, 1);
    assert.equal(gemt[0].url, 'https://badmintonplayer.dk/api/LeagueMatch/999001/ab12?regionId=2');
    assert.equal(gemt[0].body.IsDraft, true);
    assert.equal(gemt[0].body.combinedTeamMatches[1].leagueMatchSet.length, 0, 'delkamp 2 var ikke valgt');

    // Nu står delkamp 1 der — den skrives ikke igen
    const igen = await post({ gameIds: [1] });
    assert.equal(igen.status, 409);
    assert.equal(gemt.length, 1);

    // Indberettet kamp: intet gemmes
    bp.match.resultCompleted = true;
    const indb = await post({ gameIds: [2] });
    assert.equal(indb.status, 409);
    assert.match((await indb.json()).error, /allerede indberettet/);
    assert.equal(gemt.length, 1);

    // Ingen kode gemt: knappen virker ikke
    db.tm = { ...db.tm, bp_livescore_kode: null };
    const uden = await rigtigFetch(url);
    assert.equal(uden.status, 409);
    assert.match((await uden.json()).error, /livescore-koden/);
});

test('admin: knappen kun med en kode, også i Kamphistorik', () => {
    const laes = (fil) => fs.readFileSync(path.join(__dirname, '../../..', fil), 'utf8');
    const a = laes('frontend/admin-script.js');
    assert.match(a, /const overfoer = s\.kodeSat\s*\?/);
    assert.match(a, /Number\(tm\.bp_kladde\) \?/);
    assert.match(a, /async function visBpKladde\(id\)/);
    assert.match(laes('backend/routes/teamMatches.js'), /\$\{KLADDE_MULIG\} AS bp_kladde/);
    assert.equal(bpr.KLADDE_MULIG, '(aktiv_kilde_id IS NOT NULL AND bp_livescore_kode IS NOT NULL)');
    const r = laes('backend/routes/bpLivescore.js');
    assert.match(r, /router\.get\('\/:id\/kladde', authMiddleware, requirePage\('holdkamp'\)/);
    assert.match(r, /router\.post\('\/:id\/kladde', authMiddleware, requirePage\('holdkamp'\)/);
    assert.ok(Number((laes('frontend/admin.html').match(/admin-script\.js\?v=(\d+)/) || [])[1]) >= 134);
    // POST gentages aldrig af api.js (kunne gemme to gange)
    assert.match(laes('frontend/js/api.js'), /gemBpKladde\(teamMatchId, gameIds\) \{[\s\S]*?method: 'POST'/);
});
