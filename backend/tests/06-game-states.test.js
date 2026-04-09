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

test('GameStates: PUT manglende spillerdata returnerer 400', async () => {
    const courtNum = await getFirstCourt();
    const { status } = await req(`/api/game-states/${courtNum}`, {
        method: 'PUT',
        body: { timerSeconds: 0 }
    });
    assert.equal(status, 400);
});
