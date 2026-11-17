/**
 * Klub-isolation (nr. 56): to klubber på samme server. Data i A kan ikke læses
 * eller ændres via B, og et token fra A afvises på B — admin, adgangslink
 * (device) og QR-kamp-session (match_session).
 */
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { kald, rodQuery, opretKlub, enhedsToken, qrSession } = require('./faelles');

let A, B, kampIdA;
const MAERKE = 'Kun-i-klub-A';

before(async () => {
    A = await opretKlub('isola', 'Isolation A');
    B = await opretKlub('isolb', 'Isolation B');
    const r = await rodQuery(A.db,
        `INSERT INTO match_history (court_id, winner_name, loser_name, games_won, duration, set_scores)
         VALUES (1, ?, 'Modstander A', '2-0', '20:00', ?)`,
        [MAERKE, `${MAERKE} 15-3 Modstander A, ${MAERKE} 15-4 Modstander A`]);
    kampIdA = r.insertId;
});

test('Isolation: A ser sin egen kamp — B gør ikke', async () => {
    const a = await kald('/api/match-history/all', { host: A.host, token: A.adminToken });
    assert.equal(a.status, 200);
    assert.ok(JSON.stringify(a.body).includes(MAERKE), 'A skal se sin kamp (kontrol)');

    const b = await kald('/api/match-history/all', { host: B.host, token: B.adminToken });
    assert.equal(b.status, 200);
    assert.ok(!JSON.stringify(b.body).includes(MAERKE), 'B må ikke se A\'s kamp');
});

test('Isolation: B kan hverken rette eller slette A\'s kamp (samme id)', async () => {
    const ret = await kald(`/api/match-history/${kampIdA}`, {
        method: 'PUT', host: B.host, token: B.adminToken,
        body: { side1: 'Hacker', side2: 'Offer', gameMode: '15', winner: 1, sets: [[15, 0], [15, 0]] }
    });
    assert.equal(ret.status, 404);
    const slet = await kald(`/api/match-history/${kampIdA}`, { method: 'DELETE', host: B.host, token: B.adminToken });
    assert.equal(slet.status, 404);

    const [raekke] = await rodQuery(A.db, 'SELECT winner_name FROM match_history WHERE id = ?', [kampIdA]);
    assert.equal(raekke && raekke.winner_name, MAERKE, 'A\'s kamp er urørt');
});

test('Isolation: en bane talt op i A ses ikke på B\'s bane med samme nummer', async () => {
    const put = await kald('/api/game-states/1', {
        method: 'PUT', host: A.host, token: A.adminToken,
        body: { player1: { name: MAERKE, name2: '', score: 7, games: 0 }, player2: { name: 'Modstander A', name2: '', score: 3, games: 0 } }
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const a = await kald('/api/game-states/1', { host: A.host });
    assert.equal(a.body.player1.name, MAERKE, 'kontrol: A\'s bane har navnet');
    const b = await kald('/api/game-states/1', { host: B.host });
    assert.notEqual(b.body && b.body.player1 && b.body.player1.name, MAERKE);
});

// Det værste tilfælde: B har en række med samme id (og samme adgangskode-hash /
// samme link) som A. Så består opslaget i B's database, og KUN tokenets
// klub-binding (clubSubdomain) kan afvise det. Uden kopien ville testen også
// bestå, hvis bindingen forsvandt (opslaget i B ville fejle) — det er prøvet.
async function kopierTilB(tabel, id) {
    await rodQuery(B.db, `DELETE FROM \`${tabel}\` WHERE id = ?`, [id]);
    await rodQuery(B.db, `INSERT INTO \`${tabel}\` SELECT * FROM \`${A.db}\`.\`${tabel}\` WHERE id = ?`, [id]);
}

test('Isolation: A\'s admin-token afvises på B — også når B har en admin med samme id og adgangskode', async () => {
    const [admin] = await rodQuery(A.db, 'SELECT id FROM club_admins WHERE username = ?', [A.bruger]);
    await kopierTilB('club_admins', admin.id);
    const læs = await kald('/api/match-history/all', { host: B.host, token: A.adminToken });
    assert.ok([401, 403].includes(læs.status), `læs: ${læs.status}`);
    const skriv = await kald('/api/settings/court-count', { method: 'PUT', host: B.host, token: A.adminToken, body: { courtCount: 2 } });
    assert.ok([401, 403].includes(skriv.status), `skriv: ${skriv.status}`);
    const links = await kald('/api/device-tokens', { host: B.host, token: A.adminToken });
    assert.ok([401, 403].includes(links.status), `adgangslinks: ${links.status}`);
});

test('Isolation: A\'s adgangslink (tablet, device) afvises på B', async () => {
    const tablet = await enhedsToken(A, 'court/1');
    await kopierTilB('device_tokens', JSON.parse(Buffer.from(tablet.split('.')[1], 'base64url')).tokenId);
    const krop = { player1: { name: 'Tablet', name2: '', score: 1, games: 0 }, player2: { name: 'X', name2: '', score: 0, games: 0 } };
    const iA = await kald('/api/game-states/1', { method: 'PUT', host: A.host, token: tablet, body: krop });
    assert.equal(iA.status, 200, `kontrol i A: ${iA.status} ${JSON.stringify(iA.body)}`);
    const iB = await kald('/api/game-states/1', { method: 'PUT', host: B.host, token: tablet, body: krop });
    assert.ok([401, 403].includes(iB.status), `på B: ${iB.status}`);
});

test('Isolation: A\'s QR-kamp-session (match_session) afvises på B', async () => {
    const qr = await qrSession(A, 2);
    await kopierTilB('device_tokens', JSON.parse(Buffer.from(qr.split('.')[1], 'base64url')).tokenId);
    const krop = { player1: { name: 'QR', name2: '', score: 1, games: 0 }, player2: { name: 'Y', name2: '', score: 0, games: 0 } };
    const iA = await kald('/api/game-states/2', { method: 'PUT', host: A.host, token: qr, body: krop });
    assert.equal(iA.status, 200, `kontrol i A: ${iA.status} ${JSON.stringify(iA.body)}`);
    const iB = await kald('/api/game-states/2', { method: 'PUT', host: B.host, token: qr, body: krop });
    assert.ok([401, 403].includes(iB.status), `på B: ${iB.status}`);
    const [b2] = await rodQuery(B.db, 'SELECT player1_name FROM game_states WHERE court_id = (SELECT id FROM courts WHERE court_number = 2)');
    assert.notEqual(b2 && b2.player1_name, 'QR');
});
