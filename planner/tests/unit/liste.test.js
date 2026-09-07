// Tests af listen til indtastning i TP (fane 4) — byggListe og listeSomTekst.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { byggListe, listeSomTekst } from '../../src/ui/liste.js';

function projekt() {
    const kamp = (id, kategori, fase, runde, ekstra = {}) => ({
        id, kategori, fase, gruppe: ekstra.gruppe || 'Pulje 1', runde, navn: ekstra.navn || id, spillere: ekstra.spillere || [], muligeSpillere: [],
        afhaengerAf: [], tpRef: { draw: ekstra.draw ?? 1, planning: 0, van1: 0, van2: 0, matchnr: ekstra.matchnr || 0 }, tpTid: null, varighed: 0, ...(ekstra.rundeNavn ? { rundeNavn: ekstra.rundeNavn } : {}),
    });
    return {
        turnering: { navn: 'Test', hal: 'Hallen', dage: ['2026-11-21'] },
        opsaetning: { slotMin: 30, dage: [{ dato: '2026-11-21', start: '09:00', slut: '15:00', baner: 3, spaerret: [] }] },
        kategorier: [
            { id: 'U11 D HS', form: 'pulje-cup' },
            { id: 'U09 D HS', form: 'swiss', runder: 2 },
            { id: 'U11 D DD', form: 'pulje' },
        ],
        kampe: [
            kamp('a2', 'U11 D HS', 'pulje', 2, { navn: 'Pulje 2 #1 – #3', gruppe: 'Pulje 2', matchnr: 2 }),
            kamp('a1', 'U11 D HS', 'pulje', 1, { navn: 'Pulje 2 #1 – #2', gruppe: 'Pulje 2', matchnr: 1 }),
            kamp('b1', 'U11 D HS', 'pulje', 1, { navn: 'Pulje 1 #1 – #2', gruppe: 'Pulje 1', matchnr: 1 }),
            kamp('f', 'U11 D HS', 'cup', 2, { navn: 'Finale: Vinder kamp 1 – Vinder kamp 2', draw: 9, matchnr: 3, rundeNavn: 'Finale' }),
            kamp('sf', 'U11 D HS', 'cup', 1, { navn: 'Semifinale: Pulje 1 #1 – Pulje 2 #2', draw: 9, matchnr: 1, rundeNavn: 'Semifinale' }),
            kamp('s1', 'U09 D HS', 'swiss', 1, { draw: 5, spillere: ['x', 'y'], navn: 'U09 D HS runde 1: #1 – #2' }),
            kamp('s2', 'U09 D HS', 'swiss', 1, { draw: 5, spillere: ['z', 'w'], navn: 'U09 D HS runde 1: #3 – #4' }),
            kamp('s3', 'U09 D HS', 'swiss', 2, { draw: 5 }),
            kamp('s4', 'U09 D HS', 'swiss', 2, { draw: 5 }),
        ],
        plan: {
            a1: { dag: '2026-11-21', slot: '09:00' }, a2: { dag: '2026-11-21', slot: '10:00' }, b1: { dag: '2026-11-21', slot: '09:00' },
            sf: { dag: '2026-11-21', slot: '11:00' },
            s1: { dag: '2026-11-21', slot: '12:00' }, s2: { dag: '2026-11-21', slot: '12:30' }, s3: { dag: '2026-11-21', slot: '13:30' }, s4: { dag: '2026-11-21', slot: '13:30' },
        },
        spillere: {},
    };
}

describe('liste', () => {
    const l = byggListe(projekt());
    test('kategorier i rækkefølge, tomme udelades', () => {
        assert.deepEqual(l.map((k) => k.kategori), ['U11 D HS', 'U09 D HS']);
        assert.deepEqual(l.map((k) => [k.antal, k.medTid]), [[5, 4], [4, 4]]);
    });
    test('puljer sorteret naturligt, kampe efter TP-kampnummer, cup-runder bagefter', () => {
        const k = l[0];
        assert.deepEqual(k.grupper.map((g) => g.navn), ['Pulje 1', 'Pulje 2', 'Semifinale', 'Finale']);
        assert.deepEqual(k.grupper[1].linjer.map((x) => x.tekst), ['Kamp 1: #1 – #2 (runde 1)', 'Kamp 2: #1 – #3 (runde 2)']);
        assert.equal(k.grupper[1].linjer[0].tidTekst, 'lør. 21/11 09:00');
        assert.equal(k.grupper[3].linjer[0].tidTekst, '— ingen tid —');
        assert.equal(k.grupper[2].linjer[0].tekst, 'Kamp 1: Pulje 1 #1 – Pulje 2 #2');
    });
    test('Swiss Ladder: én linje pr. runde med rundens starttid og bemærkning ved flere slots', () => {
        const k = l[1];
        assert.deepEqual(k.grupper.map((g) => g.navn), ['Runde 1', 'Runde 2']);
        assert.equal(k.grupper[0].linjer[0].tekst, 'Runde 1 (2 kampe)');
        assert.equal(k.grupper[0].linjer[0].tidTekst, 'lør. 21/11 12:00 – 12:30');
        assert.match(k.grupper[0].linjer[0].bemaerkning, /flere slots/);
        assert.equal(k.grupper[1].linjer[0].tidTekst, 'lør. 21/11 13:30');
        assert.equal(k.grupper[1].linjer[0].bemaerkning, '');
        assert.deepEqual(k.grupper[1].linjer[0].kampe, ['s3', 's4']);
    });
    test('tekstudgave', () => {
        const t = listeSomTekst(projekt());
        assert.match(t, /^U11 D HS \(4\/5 kampe med tid\)\n  Pulje 1\n    Kamp 1: #1 – #2 \(runde 1\)/);
        assert.match(t, /Runde 2 \(2 kampe\)\s+lør\. 21\/11 13:30/);
    });
});
