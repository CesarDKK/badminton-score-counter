// Løseren på én dag (Jesper 2026-10-18): "når jeg kommer til søndag og kan se, at jeg ikke selv kan få den til at blive
// rigtig god, vil jeg gerne kunne sætte løseren i gang med at fixe kun søndag" — lørdag (rettet i hånden) røres ikke.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, anvendForslag } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem } from '../../src/solver-klient.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21', SOEN = '2026-11-22';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);

function projekt() {
    let p = nytProjekt(model([
        { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('d', 8) }] },
        { id: 'U13 C', aargang: 'U13', raekke: 'C', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('c', 8) }] },
        { id: 'U15 B', aargang: 'U15', raekke: 'B', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', 8) }] },
    ], [LOER, SOEN]));
    for (const d of [LOER, SOEN]) p = opdaterDag(p, d, { baner: 4, start: '09:00', slut: '17:00' });
    p = opdaterRaekke(p, 'U11 D', { dage: [LOER] });
    p = opdaterRaekke(p, 'U13 C', { dage: [SOEN] });
    // U15 B må spille begge dage
    for (const k of p.kategorier) p = saetForm(p, k.id, { formValg: 'swiss' });
    return anvendForslag(p, lavForslag(p));
}

test('kun søndag: lørdagens kampe holdes på deres tid, søndagens og dem uden tid må kun ligge søndag', () => {
    const p = projekt();
    const lavTid = (dato, slot) => (dato === LOER ? 0 : 1440) + Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3));
    const uden = p.kampe.find((k) => k.kategori === 'U15 B HS' && p.plan[k.id]);
    const q = { ...p, plan: Object.fromEntries(Object.entries(p.plan).filter(([id]) => id !== uden.id)) };
    const pr = bygProblem(q, null, { kunDag: SOEN });
    let loer = 0;
    for (const [i, k] of pr.kampe.entries()) {
        const pl = q.plan[k.id];
        if (pl && pl.dag === LOER) {
            loer += 1;
            assert.deepEqual(k.tilladte, [lavTid(pl.dag, pl.slot)], `${k.id} beholder sin lørdagstid`);
        } else {
            assert.ok(k.tilladte.length > 1 && k.tilladte.every((t) => t >= 1440), `${k.id} (${i}) kan kun flyttes søndag`);
        }
    }
    assert.ok(loer > 0, 'der er lørdagskampe i problemet — løseren kender dem (fælles spillere, pauser)');
    assert.ok(pr.kampe.find((k) => k.id === uden.id).tilladte.every((t) => t >= 1440), 'U15 B-kampen uden tid lægges søndag');
    // Uden kunDag: alt kan flyttes som før
    assert.ok(bygProblem(q).kampe.filter((k) => q.plan[k.id]?.dag === LOER).every((k) => k.tilladte.length > 1));
});
