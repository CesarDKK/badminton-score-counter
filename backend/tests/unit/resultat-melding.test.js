/**
 * Unit-tests af serverens indmelding af en afgjort holdkamp-/turneringskamp
 * (taeller/resultatMelding.js) — den rene del: hvem vandt set fra kampens hold,
 * sættene som tekst, og hvornår serveren lader være. Ingen database.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resultatFraBane, saetTekst, holdPaaPlads, holdkampNavne, startetFoerTildeling } = require('../../taeller/resultatMelding');

// Et sæt, som reglerne gemmer det (frontend/js/taeller-regler.js)
const saet = (p1, p2, score, p1b = null, p2b = null) =>
    ({ player1Name: p1, player1Name2: p1b, player2Name: p2, player2Name2: p2b, score });

// Banens række efter en afgjort kamp
const bane = (felter) => ({
    match_completed: 1, result_outcome: null,
    player1_name: 'Anna', player1_name2: 'Makker 1', player1_games: 2,
    player2_name: 'Berit', player2_name2: 'Makker 2', player2_games: 0,
    set_scores_history: JSON.stringify([saet('Anna', 'Berit', '15-9'), saet('Berit', 'Anna', '11-15')]),
    ...felter
});
const single = { erDouble: false, hold1: ['Anna', 'Hjemme makker'], hold2: ['Berit', 'Ude makker'] };

test('single vundet 2-0: hold 1 står stadig på plads 1', () => {
    const r = resultatFraBane(bane(), single);
    assert.equal(r.winnerTeam, 1);
    assert.equal(r.setScores, 'Anna 15-9 Berit, Berit 11-15 Anna');
});

test('efter sideskift står hold 1 på plads 2 — vinderen følger navnet, ikke pladsen', () => {
    // Tre sæt: spillerne har byttet plads, så Berit (hold 2) står på plads 1 med 2 sæt
    const gs = bane({
        player1_name: 'Berit', player1_games: 2, player2_name: 'Anna', player2_games: 1,
        set_scores_history: JSON.stringify([
            saet('Anna', 'Berit', '15-9'), saet('Berit', 'Anna', '15-12'), saet('Anna', 'Berit', '10-15')])
    });
    const r = resultatFraBane(gs, single);
    assert.equal(r.winnerTeam, 2);
    assert.equal(r.setScores, 'Anna 15-9 Berit, Berit 15-12 Anna, Anna 10-15 Berit');
});

test('double: makkerne står i teksten som på tabletten, og holdet findes på begge navne', () => {
    const gs = bane({
        player1_name: 'Dorte', player1_name2: 'Eva', player1_games: 2,
        player2_name: 'Anna', player2_name2: 'Clara', player2_games: 1,
        set_scores_history: JSON.stringify([
            saet('Anna', 'Dorte', '15-13', 'Clara', 'Eva'),
            saet('Dorte', 'Anna', '15-10', 'Eva', 'Clara'),
            saet('Dorte', 'Anna', '15-14', 'Eva', 'Clara')])
    });
    const r = resultatFraBane(gs, { erDouble: true, hold1: ['Anna', 'Clara'], hold2: ['Dorte', 'Eva'] });
    assert.equal(r.winnerTeam, 2);
    assert.equal(r.setScores, 'Anna & Clara 15-13 Dorte & Eva, Dorte & Eva 15-10 Anna & Clara, Dorte & Eva 15-14 Anna & Clara');
});

test('golden set (ét sæt): 1-0 er en afgjort kamp', () => {
    const gs = bane({ player1_games: 0, player2_games: 1,
        set_scores_history: JSON.stringify([saet('Anna', 'Berit', '13-15')]) });
    assert.equal(resultatFraBane(gs, single).winnerTeam, 2);
});

test('manglende spillernavn: tablettens pladsholder ("<hold> spiller") genkendes', () => {
    const n = holdkampNavne({ team1_name: 'Lyngby 2', team2_name: null,
        team1_player1: null, team1_player2: null, team2_player1: 'Berit', team2_player2: null });
    assert.deepEqual(n.hold1, ['Lyngby 2 spiller', 'Lyngby 2 makker']);
    assert.deepEqual(n.hold2, ['Berit', 'Hold 2 makker']);
    const gs = bane({ player1_name: 'Lyngby 2 spiller' });
    assert.equal(resultatFraBane(gs, { erDouble: false, ...n }).winnerTeam, 1);
});

test('serveren melder IKKE ind, når stillingen ikke med sikkerhed er kampens', () => {
    // En anden kamp står på banen (kun den ene side er kampens spiller)
    assert.equal(resultatFraBane(bane({ player2_name: 'Gitte' }), single), null);
    // Ingen af navnene er kampens
    assert.equal(resultatFraBane(bane({ player1_name: 'Spiller 1', player2_name: 'Spiller 2' }), single), null);
    // Begge sider peger på samme hold
    assert.equal(resultatFraBane(bane({ player2_name: 'Hjemme makker' }), single), null);
    // Kampen er ikke afgjort, eller sættene står lige
    assert.equal(resultatFraBane(bane({ match_completed: 0 }), single), null);
    assert.equal(resultatFraBane(bane({ player1_games: 1, player2_games: 1 }), single), null);
    // Et indtastet resultat (badmintonplanner) er ikke talt
    assert.equal(resultatFraBane(bane({ result_outcome: 'ended_early' }), single), null);
    assert.equal(resultatFraBane(null, single), null);
});

test('single: en gammel makker på rækken tæller ikke med', () => {
    // name2 fra en tidligere double må ikke gøre en single til "begge hold"
    assert.equal(resultatFraBane(bane({ player1_name2: 'Berit' }), single).winnerTeam, 1);
    assert.equal(holdPaaPlads(['Anna', 'Berit'], single.hold1, single.hold2), null);
    assert.equal(holdPaaPlads(['Makker 1', null], single.hold1, single.hold2), null);
});

test('sæt gemt som tekst (ældre rækker) og ødelagt historik tåles', () => {
    assert.equal(saetTekst(['Anna 15-9 Berit'], false), 'Anna 15-9 Berit');
    const r = resultatFraBane(bane({ set_scores_history: '{ikke json' }), single);
    assert.deepEqual(r, { winnerTeam: 1, setScores: '' });
    // mysql2 kan give JSON-kolonnen som et array
    assert.equal(resultatFraBane(bane({ set_scores_history: [saet('Anna', 'Berit', '15-9')] }), single).setScores, 'Anna 15-9 Berit');
});

test('en kamp, der begyndte før den blev sat på banen, er ikke den kamp', () => {
    const t = (min) => new Date(Date.UTC(2026, 10, 7, 10, min));
    assert.equal(startetFoerTildeling({ match_start_time: t(5) }, t(10)), true);
    assert.equal(startetFoerTildeling({ match_start_time: t(12) }, t(10)), false);
    assert.equal(startetFoerTildeling({ match_start_time: null }, t(10)), false);
    assert.equal(startetFoerTildeling({ match_start_time: t(5) }, null), false);
});
