/**
 * Unit-tests af loftet for skærm-hændelser (screens/haendelseslog.js): tabellen
 * ligger i master-databasen, som alle klubber deler, så én klub eller ét lækket
 * adgangslink må ikke kunne fylde den. Ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const log = require('../../screens/haendelseslog');

const NU = 1_800_000_000_000;
const MIN = 60 * 1000;
const frys = (n) => Array.from({ length: n }, (_, i) => ({ type: 'frys', fra: NU - i * 1000, sek: 5 }));

beforeEach(() => log._nulstilLoft());

test('almindelig brug rammer ikke loftet', () => {
    // 12 skærme melder 3 hændelser hver i samme time
    for (let s = 0; s < 12; s++) {
        assert.equal(log.indenforLoft('lyngby', `tv-${s}`, frys(3), NU + s * MIN).length, 3);
    }
});

test('én skærm kan højst gemme 40 hændelser i timen — og får plads igen en time efter', () => {
    let gemt = 0;
    for (let i = 0; i < 10; i++) gemt += log.indenforLoft('lyngby', 'tv-1', frys(10), NU + i * 1000).length;
    assert.equal(gemt, log.MAX_PR_TIME_SKAERM);
    assert.equal(log.indenforLoft('lyngby', 'tv-1', frys(10), NU + 59 * MIN).length, 0);
    // En anden skærm i klubben er ikke ramt
    assert.equal(log.indenforLoft('lyngby', 'tv-2', frys(10), NU + 59 * MIN).length, 10);
    assert.equal(log.indenforLoft('lyngby', 'tv-1', frys(10), NU + 61 * MIN).length, 10);
});

test('skift af skærm-id hjælper ikke: klubben kan højst gemme 300 i timen', () => {
    let gemt = 0;
    for (let s = 0; s < 100; s++) gemt += log.indenforLoft('demo', `falsk-${s}`, frys(10), NU + s).length;
    assert.equal(gemt, log.MAX_PR_TIME_KLUB);
    // En anden klub er ikke ramt
    assert.equal(log.indenforLoft('lyngby', 'tv-1', frys(10), NU + 200).length, 10);
});

test('et delvist loft gemmer de ældste (første) hændelser', () => {
    assert.equal(log.indenforLoft('lyngby', 'tv-1', frys(38), NU).length, 38);
    const h = [{ type: 'net', fra: 1, til: 2 }, { type: 'net', fra: 3, til: 4 }, { type: 'net', fra: 5, til: 6 }];
    assert.deepEqual(log.indenforLoft('lyngby', 'tv-1', h, NU + 1000), h.slice(0, 2));
});

test('loguddrag (op til 32 KB hver): højst 10 pr. klub i timen — hændelsen gemmes stadig uden', () => {
    const medLog = (n) => Array.from({ length: n }, (_, i) => ({ type: 'pc-brat', fra: NU - i, tekst: 'frøs', log: 'x'.repeat(100) }));
    const foerste = log.indenforLoft('lyngby', 'pc-tv1', medLog(8), NU);
    assert.equal(foerste.filter(h => h.log).length, 8);
    const naeste = log.indenforLoft('lyngby', 'pc-tv2', medLog(8), NU + 1000);
    assert.equal(naeste.length, 8);
    assert.equal(naeste.filter(h => h.log).length, 2);
    assert.equal(naeste[7].log, null);
    assert.equal(naeste[7].tekst, 'frøs');
    assert.equal(log.indenforLoft('lyngby', 'pc-tv3', medLog(1), NU + 61 * MIN)[0].log.length, 100);
});
