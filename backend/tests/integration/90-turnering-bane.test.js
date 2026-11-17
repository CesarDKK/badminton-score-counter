/**
 * Pakke U (før Lyngby): turneringskampe og banen, gennem databasen.
 *   104  en ny kamp på en bane, hvor forrige kamp er slut, men ikke ryddet
 *   105  tabletten er bundet til en kamp, admin har byttet ud
 *
 * "Tabletten" her er en enhed med adgangslink court/N, der sender det samme som
 * den uændrede court-script-v3 (tilstand med PUT /api/game-states/N, resultat
 * med PUT /api/tournaments/:id/matches/:matchId).
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { kald, rodQuery, opretKlub, enhedsToken } = require('./faelles');

let K, T;
const tablet = {};

const admin = (sti, method = 'GET', body) => kald(sti, { method, host: K.host, token: K.adminToken, body });
const enhed = (bane, sti, method = 'GET', body) => kald(sti, { method, host: K.host, token: tablet[bane], body });
const kampRaekke = async (id) => (await rodQuery(K.db, 'SELECT * FROM tournament_matches WHERE id = ?', [id]))[0];
const baneRaekke = async (bane) => (await rodQuery(K.db,
    'SELECT gs.* FROM courts c JOIN game_states gs ON gs.court_id = c.id WHERE c.court_number = ?', [bane]))[0] || null;

async function nyKamp(s1, s2, { doubles = false, m1 = null, m2 = null } = {}) {
    const r = await admin(`/api/tournaments/${T}/matches`, 'POST',
        { doubles, side1Player1: s1, side1Player2: m1, side2Player1: s2, side2Player2: m2 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.id;
}
const saetPaaBane = (id, bane, ekstra = {}) =>
    admin(`/api/tournaments/${T}/matches/${id}`, 'PUT', { courtNumber: bane, status: 'active', ...ekstra });

// Tabletten tæller kampen færdig: 2-0 til side 1 (navnene, som tabletten har dem)
function afsluttetKamp(p1, p2, { isDoubles = false, p1b = 'Makker 1', p2b = 'Makker 2' } = {}) {
    const start = new Date(Date.now() + 1000).toISOString();
    return {
        player1: { name: p1, name2: p1b, score: 21, games: 2 },
        player2: { name: p2, name2: p2b, score: 15, games: 0 },
        isDoubles, matchStartTime: start, matchEndTime: new Date(Date.now() + 2000).toISOString(),
        matchCompleted: true, timerSeconds: 900,
        setScoresHistory: [`${p1} 21-10 ${p2}`, `${p1} 21-15 ${p2}`]
    };
}

before(async () => {
    K = await opretKlub('lyngby', 'Lyngby-test');
    for (const b of [1, 2, 3, 4, 5, 6]) tablet[b] = await enhedsToken(K, `court/${b}`);
    const t = await admin('/api/tournaments', 'POST', { name: 'Lyngby Swiss' });
    assert.equal(t.status, 200);
    T = t.body.id;
});

// ======================= Nr. 104 =======================

test('104: næste kamp sat på en bane med forrige kamps slutstilling — banen ryddes, B starter fra 0-0, A beholder sit resultat', async () => {
    const A = await nyKamp('Anna', 'Berit');
    const B = await nyKamp('Carl', 'Dorte');
    assert.equal((await saetPaaBane(A, 3)).status, 200);
    // Tabletten tæller A færdig; serveren melder A ind
    const g = await enhed(3, '/api/game-states/3', 'PUT', afsluttetKamp('Anna', 'Berit'));
    assert.equal(g.status, 200, JSON.stringify(g.body));
    assert.equal((await kampRaekke(A)).status, 'finished');
    assert.equal((await baneRaekke(3)).match_completed, 1, 'ingen har trykket "Ryd banen"');

    // Admin sætter B på bane 3 inden for de 5 min før auto-rydning
    const r = await saetPaaBane(B, 3);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(await baneRaekke(3), null, 'A\'s slutstilling er væk fra banen');
    const tv = await rodQuery(K.db,
        'SELECT l.player1_name, l.player2_name, l.player1_games FROM last_finished_matches l JOIN courts c ON c.id = l.court_id WHERE c.court_number = 3');
    assert.deepEqual(tv.map(x => [x.player1_name, x.player2_name, x.player1_games]), [['Anna', 'Berit', 2]], 'TV-et viser A\'s resultat et par minutter');

    // Tabletten henter banen (efter 'reset') og ser en tom bane — B fra 0-0
    const s = await enhed(3, '/api/game-states/3');
    assert.equal(s.status, 200);
    assert.equal(s.body.matchCompleted, false);
    assert.deepEqual([s.body.player1.score, s.body.player2.score, s.body.player1.games, s.body.player2.games], [0, 0, 0, 0]);
    assert.equal(s.body.matchStartTime, null);
    const paaBanen = await enhed(3, '/api/tournaments/court/3');
    assert.equal(paaBanen.body.tournament.matches[0].id, B);

    const a = await kampRaekke(A);
    assert.equal(a.status, 'finished');
    assert.equal(a.winner_team, 1);
    const b = await kampRaekke(B);
    assert.equal(b.status, 'active');
    assert.equal(b.winner_team, null);
});

test('104: slutstillingen hører til en kamp, serveren ikke kunne melde ind — 409, intet ryddes, kampen bevarer sin stilling', async () => {
    // Double, men tabletten stod i single (serverens melding genkender den ikke)
    const A = await nyKamp('Erik', 'Frida', { doubles: true, m1: 'Gitte', m2: 'Hans' });
    const B = await nyKamp('Ida', 'Jens');
    assert.equal((await saetPaaBane(A, 4)).status, 200);
    assert.equal((await enhed(4, '/api/game-states/4', 'PUT', afsluttetKamp('Erik', 'Frida'))).status, 200);
    assert.equal((await kampRaekke(A)).status, 'active', 'forudsætning: serveren meldte ikke A ind');

    const r = await saetPaaBane(B, 4);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'bane_resultat_mangler');
    assert.match(r.body.error, /Erik \/ Gitte – Frida \/ Hans/);
    assert.equal((await kampRaekke(A)).status, 'active');
    assert.equal((await kampRaekke(A)).court_number, 4);
    assert.equal((await kampRaekke(B)).status, 'pending');
    assert.equal((await baneRaekke(4)).match_completed, 1);

    // Admin taster A's resultat fra listen (banen ryddes) — så kan B sættes på
    const ind = await admin(`/api/tournaments/${T}/matches/${A}`, 'PUT',
        { status: 'finished', winnerTeam: 1, setScores: 'Erik / Gitte 21-10 Frida / Hans, Erik / Gitte 21-15 Frida / Hans' });
    assert.equal(ind.status, 200);
    await enhed(4, '/api/game-states/4', 'DELETE');
    assert.equal((await saetPaaBane(B, 4)).status, 200);
});

test('104: en kamp, der skubbes af banen eller frigives, mister sin starttid — og får en frisk, når den sættes på igen', async () => {
    const B = await nyKamp('Kim', 'Lone');
    const C = await nyKamp('Mads', 'Nina');
    assert.equal((await saetPaaBane(B, 5)).status, 200);
    await rodQuery(K.db, "UPDATE tournament_matches SET started_at = '2026-11-21 08:00:00' WHERE id = ?", [B]);
    // C tager bane 5 (B er ikke startet) → B tilbage til afventer uden starttid
    assert.equal((await saetPaaBane(C, 5)).status, 200);
    let b = await kampRaekke(B);
    assert.equal(b.status, 'pending');
    assert.equal(b.started_at, null);

    // Tabletten frigiver selv sin kamp (clearCourt: status pending, ingen bane)
    const f = await enhed(5, `/api/tournaments/${T}/matches/${C}`, 'PUT', { status: 'pending', courtNumber: null });
    assert.equal(f.status, 200);
    const c = await kampRaekke(C);
    assert.equal(c.status, 'pending');
    assert.equal(c.court_number, null);
    assert.equal(c.started_at, null);

    // B sættes på igen: ny starttid — ikke den gamle kl. 08:00
    assert.equal((await saetPaaBane(B, 6)).status, 200);
    b = await kampRaekke(B);
    assert.ok(Date.now() - new Date(b.started_at).getTime() < 5 * 60 * 1000, `frisk starttid (${b.started_at})`);
});

// ======================= Nr. 105 =======================

test('105: admin bytter en ikke-startet kamp ud — tablettens resultat på den gamle kamp ændrer intet, den nye meldes ind af serveren', async () => {
    const B = await nyKamp('Ole', 'Pia');
    const C = await nyKamp('Rasmus', 'Sara');
    assert.equal((await saetPaaBane(B, 1)).status, 200);
    // Tabletten binder sig til B; admin sætter C på bane 1 (B er ikke startet)
    assert.equal((await saetPaaBane(C, 1)).status, 200);
    assert.equal((await kampRaekke(B)).status, 'pending');

    // Tabletten tæller C færdig under C's navne — serveren melder C ind
    assert.equal((await enhed(1, '/api/game-states/1', 'PUT', afsluttetKamp('Rasmus', 'Sara'))).status, 200);
    const c = await kampRaekke(C);
    assert.equal(c.status, 'finished');
    assert.equal(c.winner_team, 1);

    // ...og melder så resultatet ind på B, som den uændrede tablet gør (winnerTeam 2: B findes ikke i dens kopi)
    const r = await enhed(1, `/api/tournaments/${T}/matches/${B}`, 'PUT',
        { status: 'finished', winnerTeam: 2, setScores: 'Rasmus 21-10 Sara, Rasmus 21-15 Sara' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { success: true, uaendret: true });
    const b = await kampRaekke(B);
    assert.equal(b.status, 'pending');
    assert.equal(b.winner_team, null);
    assert.equal(b.set_scores, null);
    assert.equal(b.finished_at, null);

    // Normalforløbet: tablettens melding af en kamp, serveren allerede har meldt ind, ændrer intet
    const igen = await enhed(1, `/api/tournaments/${T}/matches/${C}`, 'PUT',
        { status: 'finished', winnerTeam: 1, setScores: 'noget andet' });
    assert.deepEqual(igen.body, { success: true, uaendret: true });
    const c2 = await kampRaekke(C);
    assert.equal(c2.set_scores, c.set_scores);
    assert.equal(String(c2.finished_at), String(c.finished_at));
});

test('105: reserven — serveren kunne ikke melde kampen ind (single/double), tablettens resultat på sin egen bane gælder', async () => {
    const D = await nyKamp('Tom', 'Ulla', { doubles: true, m1: 'Vera', m2: 'Willy' });
    assert.equal((await saetPaaBane(D, 2)).status, 200);
    assert.equal((await enhed(2, '/api/game-states/2', 'PUT', afsluttetKamp('Tom', 'Ulla'))).status, 200);
    assert.equal((await kampRaekke(D)).status, 'active', 'forudsætning: serverens melding sprang over');

    // En anden banes tablet kan ikke melde den ind
    const fremmed = await enhed(1, `/api/tournaments/${T}/matches/${D}`, 'PUT', { status: 'finished', winnerTeam: 2, setScores: 'x' });
    assert.deepEqual(fremmed.body, { success: true, uaendret: true });
    assert.equal((await kampRaekke(D)).status, 'active');

    const r = await enhed(2, `/api/tournaments/${T}/matches/${D}`, 'PUT',
        { status: 'finished', winnerTeam: 1, setScores: 'Tom 21-10 Ulla, Tom 21-15 Ulla' });
    assert.deepEqual(r.body, { success: true });
    const d = await kampRaekke(D);
    assert.equal(d.status, 'finished');
    assert.equal(d.winner_team, 1);

    // En gammel binding på bane 1 kan ikke trække en kamp af bane 2
    const E = await nyKamp('Xenia', 'Yrsa');
    assert.equal((await saetPaaBane(E, 2)).status, 200, 'D er meldt ind, så banen ryddes');
    const f = await enhed(1, `/api/tournaments/${T}/matches/${E}`, 'PUT', { status: 'pending', courtNumber: null });
    assert.deepEqual(f.body, { success: true, uaendret: true });
    assert.equal((await kampRaekke(E)).court_number, 2);
});
