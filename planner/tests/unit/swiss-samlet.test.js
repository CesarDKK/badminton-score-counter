// Swiss-runden spilles samlet (Jesper 2026-11-13: "runderne strækkes over flere runder, så spillerne kommer til at
// sidde stille MEGET længe, det må ikke ske"): alle rundens kampe i samme slot — flere slots kun, når runden har flere
// kampe, end dagen har baner.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, opdaterDag, saetForm, anvendForslag, flytKamp } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { tjekPlan } from '../../src/rules.js';
import { swissMaxSpaend } from '../../src/regelmodel.js';
import { bygProblem } from '../../src/solver-klient.js';
import { model } from '../hjaelp/model.js';

const DAG = '2026-11-21';
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
function projekt(baner, spillere = 8) {
    let p = nytProjekt(model([{ id: 'U11 B', aargang: 'U11', raekke: 'B', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('b', spillere) }, { kat: 'DS', type: 'single', spillere: enkelt('d', 6) }] }], [DAG]));
    p = opdaterDag(p, DAG, { baner, start: '09:00', slut: '17:00', foerSkoledag: false });
    p = saetForm(p, 'U11 B HS', { formValg: 'swiss' });
    return saetForm(p, 'U11 B DS', { formValg: 'pulje' });
}
const runder = (p) => {
    const ud = new Map();
    for (const k of p.kampe) if (k.fase === 'swiss' && p.plan[k.id]) { const n = k.runde; if (!ud.has(n)) ud.set(n, new Set()); ud.get(n).add(p.plan[k.id].slot); }
    return ud;
};

describe('Swiss-runden samlet', () => {
    test('swissMaxSpaend: ét slot, når runden er der baner til; ellers de få slots, det kræver', () => {
        assert.equal(swissMaxSpaend(4, false, 10, 30), 0);
        assert.equal(swissMaxSpaend(10, false, 10, 30), 0);
        assert.equal(swissMaxSpaend(12, false, 8, 30), 30);
        assert.equal(swissMaxSpaend(10, true, 5, 30), 0, 'halve baner tæller ½');
    });
    test('planlæggeren lægger hver runde i ét slot, også ved siden af en anden kategori', () => {
        const p = projekt(5);
        const f = lavForslag(p);
        assert.equal(f.brud.length + f.ikkePlaceret.length, 0);
        const q = anvendForslag(p, f);
        for (const [runde, slots] of runder(q)) assert.equal(slots.size, 1, `runde ${runde}: ${[...slots]}`);
        assert.equal(tjekPlan(q).problemer.filter((x) => x.type === 'swiss-samlet').length, 0);
    });
    test('Tjek melder en spredt runde som fejl', () => {
        const p = projekt(5);
        let q = anvendForslag(p, lavForslag(p));
        const r1 = q.kampe.filter((k) => k.fase === 'swiss' && k.runde === 1);
        const andet = q.plan[r1[0].id].slot === '09:00' ? '16:30' : '09:00';
        q = flytKamp(q, r1[0].id, DAG, andet);
        const fejl = tjekPlan(q).problemer.filter((x) => x.type === 'swiss-samlet');
        assert.equal(fejl.length, 1);
        assert.equal(fejl[0].alvor, 'fejl');
    });
    test('løseren får reglen: én gruppe pr. runde med det tilladte spænd', () => {
        const p = projekt(3, 10); // 5 kampe pr. runde på 3 baner → højst 2 slots
        const pr = bygProblem(p);
        assert.ok(pr.swissSamlet.length >= 3, String(pr.swissSamlet.length));
        assert.ok(pr.swissSamlet.every((g) => g.kampe.length === 5 && g.spaend === 30));
    });
});
