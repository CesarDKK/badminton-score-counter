// Pakke 4: gemte projekter opgraderes i nummererede trin (version N → N + 1) i stedet for løse flag i opsætningen.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, opgraderProjekt, validerProjekt, gemLokalt, hentLokaltMedStatus, standardRaekkefoelge, PROJEKT_VERSION, GEM_NOEGLE } from '../../src/store.js';
import { model } from '../hjaelp/model.js';

const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const nyt = () => nytProjekt(model([
    { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('a', 4) }] },
    { id: 'U13 D', aargang: 'U13', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 4) }] },
]));
/** Et projekt, som version 1 gemte det: uden nogen af flagene (det ældste) eller med dem alle (det nyeste v1). */
const v1 = (flag) => {
    const p = nyt();
    return { ...p, version: 1, opsaetning: { ...p.opsaetning, ...flag }, raekker: p.raekker.map((r) => ({ ...r, minKampeSamlet: true, maxHaltidMin: null, raekkefoelge: ['MD', 'HS', 'DS', 'HD', 'DD'] })) };
};
const lager = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };

describe('opgradering af gemte projekter', () => {
    test('et nyt projekt er i den aktuelle version og har ingen løse flag', () => {
        const p = nyt();
        assert.equal(p.version, PROJEKT_VERSION);
        assert.deepEqual(Object.keys(p.opsaetning).filter((k) => /V\d$/.test(k)), []);
        assert.equal(opgraderProjekt(p), p, 'intet at gøre');
    });
    test('det ældste version 1-projekt får alle tre rettelser', () => {
        const p = opgraderProjekt(v1({}));
        assert.equal(p.version, 2);
        assert.deepEqual(p.raekker.map((r) => r.minKampeSamlet), [false, false]);
        assert.deepEqual(p.raekker.map((r) => r.maxHaltidMin), [360, null]);
        assert.deepEqual(p.raekker.map((r) => r.raekkefoelge), [standardRaekkefoelge('U11'), standardRaekkefoelge('U13')]);
    });
    test('et version 1-projekt, der allerede havde fået rettelserne, får dem ikke igen — brugerens valg bevares', () => {
        const p = opgraderProjekt(v1({ minKampeSamletV3: true, singleVarighedV1: true, raekkefoelgeV2: true }));
        assert.equal(p.version, 2);
        assert.deepEqual(p.raekker.map((r) => r.minKampeSamlet), [true, true]);
        assert.deepEqual(p.raekker.map((r) => r.maxHaltidMin), [null, null]);
        assert.deepEqual(Object.keys(p.opsaetning).filter((k) => /V\d$/.test(k)), [], 'flagene er fjernet');
    });
    test('et gemt version 1-projekt åbnes og opgraderes ved start; et projekt fra en NYERE udgave giver en klar besked', () => {
        const l = lager();
        gemLokalt(v1({}), l);
        const r = hentLokaltMedStatus(l);
        assert.equal(r.fejl, null);
        assert.equal(r.projekt.version, 2);
        assert.equal(validerProjekt(r.projekt), null);
        l.setItem(GEM_NOEGLE, JSON.stringify({ ...nyt(), version: PROJEKT_VERSION + 1 }));
        const nyere = hentLokaltMedStatus(l);
        assert.equal(nyere.projekt, null);
        assert.match(nyere.fejl, /nyere udgave af planneren/);
        assert.ok(l.getItem(GEM_NOEGLE), 'projektet bliver liggende — det slettes ikke');
    });
});
