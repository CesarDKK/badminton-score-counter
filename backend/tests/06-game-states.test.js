const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req } = require('./helpers');

let testCourtNumber;

async function getFirstCourt() {
    if (testCourtNumber) return testCourtNumber;
    const { body } = await req('/api/courts');
    testCourtNumber = body[0].court_number;
    return testCourtNumber;
}

test('GameStates: GET alle returnerer array via batch endpoint', async () => {
    const { status, body } = await req('/api/game-states/batch/all');
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
    assert.ok(body.length > 0);
});

test('GameStates: hvert element har player1/player2 struktur', async () => {
    const { body } = await req('/api/game-states/batch/all');
    const state = body[0];
    assert.ok(typeof state.player1 === 'object');
    assert.ok(typeof state.player2 === 'object');
    assert.ok(typeof state.player1.score === 'number');
    assert.ok(typeof state.player2.score === 'number');
});

test('GameStates: GET enkelt bane returnerer korrekt struktur', async () => {
    const courtNum = await getFirstCourt();
    const { status, body } = await req(`/api/game-states/${courtNum}`);
    assert.equal(status, 200);
    assert.ok(typeof body.player1 === 'object');
    assert.ok(typeof body.player2 === 'object');
    assert.ok(typeof body.isActive === 'boolean');
});

test('GameStates: GET ikke-eksisterende bane returnerer 404', async () => {
    const { status } = await req('/api/game-states/9999');
    assert.equal(status, 404);
});

test('GameStates: PUT opdaterer score', async () => {
    const courtNum = await getFirstCourt();

    const { status } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Test 1', name2: '', score: 3, games: 0 },
            player2: { name: 'Test 2', name2: '', score: 2, games: 0 },
            timerSeconds: 0,
            setScoresHistory: []
        }
    });
    assert.equal(status, 200);

    const { body: after } = await req(`/api/game-states/${courtNum}`);
    assert.equal(after.player1.score, 3);
    assert.equal(after.player2.score, 2);

    // Ryd op — nulstil
    await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Spiller 1', name2: '', score: 0, games: 0 },
            player2: { name: 'Spiller 2', name2: '', score: 0, games: 0 },
            timerSeconds: 0,
            setScoresHistory: []
        }
    });
});

test('GameStates: PUT svarer med version og GET returnerer samme', async () => {
    const courtNum = await getFirstCourt();
    const { status, body } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Version Test 1', name2: '', score: 1, games: 0 },
            player2: { name: 'Version Test 2', name2: '', score: 0, games: 0 },
            timerSeconds: 0,
            setScoresHistory: []
        }
    });
    assert.equal(status, 200);
    assert.ok(typeof body.version === 'number');

    const { body: after } = await req(`/api/game-states/${courtNum}`);
    assert.equal(after.version, body.version);
});

test('GameStates: partiel PUT bevarer ikke-medsendte felter (merge-semantik)', async () => {
    const courtNum = await getFirstCourt();

    // Sæt en tilstand med score og sæthistorik
    await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Merge Test 1', name2: '', score: 7, games: 1 },
            player2: { name: 'Merge Test 2', name2: '', score: 4, games: 0 },
            timerSeconds: 300,
            servingPlayer: 1,
            setScoresHistory: [{ player1: 15, player2: 12 }]
        }
    });

    // Opdater KUN navne (som admin-redigering gør)
    const { status } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Nyt Navn 1' },
            player2: { name: 'Nyt Navn 2' }
        }
    });
    assert.equal(status, 200);

    // Score, sæthistorik og servestatus skal være urørt
    const { body: after } = await req(`/api/game-states/${courtNum}`);
    assert.equal(after.player1.name, 'Nyt Navn 1');
    assert.equal(after.player1.score, 7);
    assert.equal(after.player1.games, 1);
    assert.equal(after.player2.score, 4);
    assert.equal(after.servingPlayer, 1);
    assert.equal(after.setScoresHistory.length, 1);
    assert.equal(after.setScoresHistory[0].player1, 15);
});

test('GameStates: PUT med forældet expectedVersion returnerer 409 med aktuel tilstand', async () => {
    const courtNum = await getFirstCourt();
    const { body: current } = await req(`/api/game-states/${courtNum}`);

    const { status, body } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Konflikt 1', score: 99 },
            player2: { name: 'Konflikt 2' },
            expectedVersion: current.version + 1000
        }
    });
    assert.equal(status, 409);
    assert.equal(body.conflict, true);
    assert.equal(body.version, current.version);
    assert.ok(body.state);
    assert.equal(body.state.player1.score, current.player1.score);

    // Tilstanden må ikke være ændret af det afviste PUT
    const { body: after } = await req(`/api/game-states/${courtNum}`);
    assert.equal(after.player1.score, current.player1.score);
    assert.equal(after.version, current.version);
});

test('GameStates: PUT med korrekt expectedVersion opdaterer og bumper version', async () => {
    const courtNum = await getFirstCourt();
    const { body: current } = await req(`/api/game-states/${courtNum}`);

    const { status, body } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { score: 8 },
            expectedVersion: current.version
        }
    });
    assert.equal(status, 200);
    assert.equal(body.version, current.version + 1);

    const { body: after } = await req(`/api/game-states/${courtNum}`);
    assert.equal(after.player1.score, 8);
});

test('GameStates: PUT med expectedVersion mod slettet række returnerer 409 med state=null', async () => {
    const courtNum = await getFirstCourt();
    const { body: current } = await req(`/api/game-states/${courtNum}`);

    // Nulstil banen (sletter rækken) — som admin "Ryd bane"
    await req(`/api/game-states/${courtNum}`, { method: 'DELETE' });

    // En forsinket gemning fra tælleren med gammel version må ikke genskabe kampen
    const { status, body } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Genopstået 1', score: 5 },
            player2: { name: 'Genopstået 2', score: 3 },
            expectedVersion: current.version
        }
    });
    assert.equal(status, 409);
    assert.equal(body.conflict, true);
    assert.equal(body.state, null);
});

test('GameStates: PUT manglende spillerdata på nulstillet bane returnerer 400', async () => {
    const courtNum = await getFirstCourt();
    // Banen er nulstillet af forrige test — oprettelse kræver spillerdata
    const { status } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: { timerSeconds: 0 }
    });
    assert.equal(status, 400);

    // Ryd op — genskab default-tilstand som resten af suiten forventer
    await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: {
            player1: { name: 'Spiller 1', name2: '', score: 0, games: 0 },
            player2: { name: 'Spiller 2', name2: '', score: 0, games: 0 },
            timerSeconds: 0,
            setScoresHistory: []
        }
    });
});
