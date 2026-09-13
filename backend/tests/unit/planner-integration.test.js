/**
 * Unit-tests af de rene dele af badmintonplanner-integrationen:
 * "kamp i gang"-reglen og previous-blokken i svaret.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { kampIGang, tidligereTilstand } = require('../../routes/plannerIntegration');

const single = (over = {}) => ({
    player1_name: 'Jens Holm', player1_name2: 'Makker 1', player1_score: 0, player1_games: 0,
    player2_name: 'Kim Lund', player2_name2: 'Makker 2', player2_score: 0, player2_games: 0,
    set_scores_history: null, match_completed: 0, ...over
});

test('kampIGang: navne alene er IKKE en kamp i gang', () => {
    assert.equal(kampIGang(null), false);
    assert.equal(kampIGang(single()), false);
});

test('kampIGang: point eller sæt = i gang; færdigspillet = ikke i gang', () => {
    assert.equal(kampIGang(single({ player1_score: 1 })), true);
    assert.equal(kampIGang(single({ player2_games: 1 })), true);
    assert.equal(kampIGang(single({ player1_games: 2, match_completed: 1 })), false);
});

test('tidligereTilstand: single uden tælling → navne, 0-0, ikke talt', () => {
    const p = tidligereTilstand(single(), { is_doubles: 0 });
    assert.deepEqual(p, { side1: 'Jens Holm', side2: 'Kim Lund', sets: '0-0', score: '', completed: false, counted: false });
    assert.equal(tidligereTilstand(null, { is_doubles: 0 }), null);
});

test('tidligereTilstand: double med færdige sæt og igangværende sæt', () => {
    const gs = single({
        player1_name2: 'Bo Nielsen', player2_name2: 'Dan Petersen',
        player1_games: 1, player2_games: 0, player1_score: 7, player2_score: 3,
        set_scores_history: JSON.stringify([{ score: '21-15' }])
    });
    const p = tidligereTilstand(gs, { is_doubles: 1 });
    assert.equal(p.side1, 'Jens Holm / Bo Nielsen');
    assert.equal(p.side2, 'Kim Lund / Dan Petersen');
    assert.equal(p.sets, '1-0');
    assert.equal(p.score, '21-15, 7-3');
    assert.equal(p.completed, false);
    assert.equal(p.counted, true);
});

test('tidligereTilstand: færdig kamp viser kun de færdige sæt', () => {
    const gs = single({
        player1_games: 2, player2_games: 0, player1_score: 21, player2_score: 18, match_completed: 1,
        set_scores_history: JSON.stringify([{ score: '21-15' }, { score: '21-18' }])
    });
    const p = tidligereTilstand(gs, { is_doubles: 0 });
    assert.equal(p.score, '21-15, 21-18');
    assert.equal(p.completed, true);
    assert.equal(p.counted, true);
});
