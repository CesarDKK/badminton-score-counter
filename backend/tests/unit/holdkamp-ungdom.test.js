/**
 * Unit-tests: ungdomsholdkampe sendes ikke automatisk på livestream (migration
 * 054). Badminton Danmark følger DIF's anbefaling om som udgangspunkt ikke at
 * livestreame børn og unge under 18 — Jesper 2026-11-21.
 *
 *  - importen læser rækkens aldersgruppe på badmintonplayer.dk (U09 … U19 = ungdom)
 *  - formularen: U9-formatet er altid ungdom, ellers admins valg
 *  - livestream: en ungdomsholdkamp sendes ikke af sig selv, men kan startes med vilje
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { aldersgruppeFraHtml, parseMatchHtml } = require('../../routes/importHoldkamp');
const { erUngdom } = require('../../routes/teamMatches');
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

// Overskrifterne, som badmintonplayer.dk skriver dem (set 2026-11-21)
const side = (h2, h3) => `<a class='team'>S&#248;g andre r&#230;kker</a><br /><br />` +
    (h2 !== null ? `<h2>${h2}</h2>` : '') + `<a class='team'>Vis r&#230;kker</a><br /><br />` +
    (h3 !== null ? `<h3>${h3}</h3>` : '') + `<table class='matchinfo'><tr><td class='lbl'>Kampnr</td><td class='val'>1</td></tr></table>`;

test('importen: rækkens aldersgruppe afgør, om holdkampen er en ungdomsholdkamp', () => {
    const tilfaelde = [
        ['BADKBH U09', 'U09 D 3300 (3 spillere) BD Pulje 1', 'U09', true],
        ['BADKBH U11', 'U11 D, 4200 (4 piger) BD Pulje 1', 'U11', true],
        ['BADDAN,DGI U13', 'DMU Hold U13 (4+3) Pulje 1', 'U13', true],
        ['BADDAN,DGI U17/U19', 'EFTERSKOLETURN. U17/U19C (6.400) - 4 Spillere Pulje 1', 'U17/U19', true],
        ['BADBORN,BADKBH,BADLF,BADSJ,DGI-NSJ,DGI-MVS U17/U19', 'U17/U19 B, 6800 (2+2) Pulje 1', 'U17/U19', true],
        ['BADDAN SEN', 'Danmarksserien Kvalifikation til 3. division pulje D', 'SEN', false],
        ['BADMIDJ,BADNDRJ,BADSDRJ,BADFYN SEN', 'Serie 1 Vest (5+3) Pulje 5', 'SEN', false],
        ['BADMIDJ,BADSDRJ,DGI-MID SEN', 'Senior 4 spillere double (6 kampe) SEN V - Pulje 243', 'SEN', false]
    ];
    for (const [h2, h3, gruppe, ungdom] of tilfaelde) {
        assert.deepEqual(aldersgruppeFraHtml(side(h2, h3)), { aldersgruppe: gruppe, ungdom }, h2);
    }
    // Kun rækken (h3) kendt: U-gruppen dér tæller også
    assert.equal(aldersgruppeFraHtml(side(null, 'U15 C (2+2) Pulje 3')).ungdom, true);
    // Intet at gå efter: ikke ungdom (som før)
    assert.deepEqual(aldersgruppeFraHtml('<table></table>'), { aldersgruppe: null, ungdom: false });
    // Ord, der bare indeholder et U og et tal, er ikke en aldersgruppe
    assert.equal(aldersgruppeFraHtml(side('BADDAN SEN', 'Serie 2 Øst (4+3) Pulje U')).ungdom, false);
    assert.equal(aldersgruppeFraHtml(side('BADDAN SEN', 'Hold MU15 Pulje 1')).ungdom, false);
});

test('importen: holdsedlen bærer aldersgruppen med til "Opret Holdkamp"', () => {
    const seddel = parseMatchHtml(side('BADKBH U09', 'U09 D 3300 (3 spillere) BD Pulje 1'));
    assert.equal(seddel.aldersgruppe, 'U09');
    assert.equal(seddel.ungdom, true);
    assert.equal(parseMatchHtml(side('BADDAN SEN', 'Serie 1')).ungdom, false);
});

test('formularen: admins valg gælder — uden valg er kun U9-formatet ungdom', () => {
    assert.equal(erUngdom(true, 'liga11'), true);
    assert.equal(erUngdom(false, 'u9_3spillere'), false);
    assert.equal(erUngdom(undefined, 'u9_3spillere'), true);
    // 4 spillere spilles også af seniorer ("Senior 4 spillere double")
    assert.equal(erUngdom(undefined, '4spillere'), false);
    assert.equal(erUngdom(undefined, '2plus2'), false);
    assert.equal(erUngdom('ja', 'liga11'), false);
});

test('livestream: en ungdomsholdkamp sendes ikke af sig selv', () => {
    const iGang = { mangler: 5, igang: 1, slut: null, start: new Date(NU - 10 * MIN), roert: new Date(NU - MIN) };
    const ungdom = { ...iGang, ungdom: 1 };
    // Seniorholdkampen sendes som før
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: { ...iGang, ungdom: 0 }, nu: NU }).grund, 'holdkamp');
    // Ungdomsholdkampen ikke — heller ikke mellem delkampene
    assert.deepEqual(ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: ungdom, nu: NU }), { send: false, grund: 'holdkamp-ungdom' });
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: null, sidste: null, holdkamp: ungdom, nu: NU }).grund, 'holdkamp-ungdom');
    // Startet med vilje: tablettens start og "Send hele dagen" gælder stadig
    assert.deepEqual(ls.beslutning({ opsaetning: { ...OPS, manual_since: new Date(NU - 5 * MIN) }, gs: gs(), holdkamp: ungdom, nu: NU }),
        { send: true, grund: 'valgt', kilde: 'gs' });
    assert.equal(ls.beslutning({ opsaetning: { ...OPS, all_day_until: new Date(NU + 60 * MIN) }, gs: gs(), holdkamp: ungdom, nu: NU }).grund, 'hele-dagen');
    // "Stop for i dag" står over (samme udfald: sendes ikke)
    const stop = { ...OPS, holdkamp_stop_until: new Date(NU + 60 * MIN) };
    assert.equal(ls.beslutning({ opsaetning: stop, gs: gs(), holdkamp: ungdom, nu: NU }).grund, 'holdkamp-stoppet');
    // En forladt ungdomsholdkamp er bare en kamp, der ikke er startet
    const forladt = { ...ungdom, start: new Date(NU - 90 * MIN), roert: null };
    assert.equal(ls.beslutning({ opsaetning: OPS, gs: gs(), holdkamp: forladt, nu: NU }).grund, 'ikke-startet');
    // Tabletten skriver ikke "holdkampen sendes", og admin ser hvorfor
    assert.equal(ls.tabletStatus({ opsaetning: OPS, kamera: true, holdkamp: ungdom, nu: NU }).holdkamp, false);
    const admin = ls.holdkampTilAdmin({ holdkamp: ungdom, info: { hold1: 'Lyngby U13', hold2: 'Gentofte U13', delkamp: null }, opsaetning: OPS, nu: NU });
    assert.equal(admin.sendes, false);
    assert.equal(admin.ungdom, true);
    assert.equal(ls.erUngdomsHoldkamp({ ungdom: '1' }), true);
    assert.equal(ls.erUngdomsHoldkamp({ ungdom: null }), false);
    assert.equal(ls.erUngdomsHoldkamp(null), false);
});
