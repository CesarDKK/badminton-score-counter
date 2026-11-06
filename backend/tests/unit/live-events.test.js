/**
 * Unit-tests af events/gameStateEvents.js — de "pokes", TV, oversigt og admin
 * får over live-forbindelsen (SSE), så de ikke skal spørge serveren hele tiden.
 *
 * Oversigten spørger kun hvert 5. sekund, når live-forbindelsen virker. Det
 * forudsætter, at også holdkamp-ændringer uden bane giver et event.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const events = require('../../events/gameStateEvents');

function lyt(req) {
    const set = [];
    const stop = events.subscribeGameStateChanges(req, e => set.push(e));
    return { set, stop };
}

test('holdkamp-event: uden bane, så TV\'er med bane-filter ikke får det', () => {
    const a = lyt({ clubDbName: 'lyngby' });
    events.publishHoldkampChange({ clubDbName: 'lyngby' });
    assert.deepEqual(a.set, [{ courtId: null, type: 'holdkamp' }]);
    a.stop();
});

test('events når kun klubbens egne skærme', () => {
    const lyngby = lyt({ clubDbName: 'lyngby' });
    const gladsaxe = lyt({ clubDbName: 'gladsaxe' });
    const demo = lyt({});
    events.publishHoldkampChange({ clubDbName: 'lyngby' });
    events.publishGameStateChange({ clubDbName: 'gladsaxe' }, '3', 'reset');
    assert.equal(lyngby.set.length, 1);
    assert.deepEqual(gladsaxe.set, [{ courtId: 3, type: 'reset' }]);
    assert.deepEqual(demo.set, []);
    for (const l of [lyngby, gladsaxe, demo]) l.stop();
});

test('baggrundsjob uden klub (currentTenant() = "direct") rammer demoens skærme', () => {
    const demo = lyt({});                                  // en skærm på demoen: ingen clubDbName
    events.publishHoldkampChange({ clubDbName: 'direct' });   // som scheduleren og den automatiske hentning sender
    events.publishGameStateChange({ clubDbName: 'direct' }, 2, 'reset');
    assert.deepEqual(demo.set, [{ courtId: null, type: 'holdkamp' }, { courtId: 2, type: 'reset' }]);
    demo.stop();
});

test('efter stop får lytteren ikke flere events', () => {
    const a = lyt({ clubDbName: 'lyngby' });
    a.stop();
    events.publishHoldkampChange({ clubDbName: 'lyngby' });
    assert.deepEqual(a.set, []);
});

// Oversigtens 5-sekunders sikkerhedspoll hviler på disse kald — fjernes et af
// dem, kommer ændringen først på oversigten ved næste poll.
test('holdkamp-ændringer og frigivelse af baner udsender events', () => {
    const laes = (fil) => fs.readFileSync(path.join(__dirname, '..', '..', fil), 'utf8');
    const holdkamp = laes('routes/teamMatches.js');
    assert.match(holdkamp, /router\.use\(\(req, res, next\) => \{[\s\S]{0,300}publishHoldkampChange\(req\)/,
        'alle vellykkede ændringer i routes/teamMatches.js skal give et holdkamp-event');
    assert.match(holdkamp, /async function afslutHoldkamp[\s\S]*?publishHoldkampChange\(req\);\s*\}\s*\/\/ Automatisk lukning/,
        'også den automatiske lukning');
    assert.match(laes('routes/importHoldkamp.js'), /opretHoldkamp\(\{[\s\S]{0,400}publishHoldkampChange\(/,
        'en automatisk hentet holdkamp');
    assert.match(laes('scheduler.js'), /DELETE FROM game_states WHERE court_id = \?[\s\S]{0,500}publishGameStateChange\([^)]*'reset'\)/,
        'en bane, der frigives efter 10 minutter');
});
