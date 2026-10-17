// Jesper 2026-10-17: Tjek meldte "venter 260 min" for U11 D-spillere, der spillede Swiss-runde 1 kl. 9, runde 2–5 i
// løbet af formiddagen og så en double kl. 13:40. Swiss-runder efter runde 1 har ingen kendte spillere, så Tjek så kun
// runde 1 og doublen. Nu tæller hver Swiss-runde for alle i lodtrækningen — i det mest gunstige tilfælde, da man ikke
// ved, hvornår i runden spilleren spiller.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nytProjekt, saetForm, opdaterDag, opdaterOpsaetning, flytKamp } from '../../src/store.js';
import { tjekPlan } from '../../src/rules.js';
import { scorePlan } from '../../src/kriterier.js';
import { bygProblem } from '../../src/solver-klient.js';
import { spillerOphold } from '../../src/regelmodel.js';
import { bedoemPlan } from '../../src/scheduler.js';
import { model } from '../hjaelp/model.js';

const LOER = '2026-11-21';

/** s1–s6 i single (Swiss, 4 runder á 3 kampe) og s1–s4 som to doublepar (én kamp). */
function projekt() {
    let p = nytProjekt(model([{ id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [
        { kat: 'HS', type: 'single', spillere: [['s1'], ['s2'], ['s3'], ['s4'], ['s5'], ['s6']] },
        { kat: 'HD', type: 'double', spillere: [['s1', 's2'], ['s3', 's4']] },
    ] }]));
    p = opdaterDag(p, LOER, { baner: 6, start: '09:00', slut: '19:00' });
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    return saetForm(saetForm(p, 'U11 D HS', { formValg: 'swiss', swissRunder: 4 }), 'U11 D HD', { formValg: 'pulje' });
}
/** Lægger Swiss-runderne (runde 1 i første slot osv.; en runde må fylde to slots) og doublen. */
function laeg(runder, double) {
    let p = projekt();
    for (const k of p.kampe.filter((x) => x.fase === 'swiss')) {
        const t = runder[k.runde - 1];
        p = flytKamp(p, k.id, LOER, Array.isArray(t) ? t[(k.tpRef.swissKamp || 1) % t.length] : t);
    }
    for (const k of p.kampe.filter((x) => x.kategori === 'U11 D HD')) p = flytKamp(p, k.id, LOER, double);
    return p;
}
const ventetid = (p) => tjekPlan(p).problemer.filter((x) => x.type === 'lang-ventetid');
const huller = (p) => scorePlan(p).dele.find((d) => d.id === 'langeHuller').vaerdi;

describe('lang ventetid tæller Swiss-runderne med', () => {
    test('Swiss-runder hele formiddagen og så doublen: ingen ventetid (som på Jespers billede)', () => {
        const p = laeg(['09:00', '10:00', '11:00', '12:00'], '13:00');
        assert.deepEqual(ventetid(p), []);
        assert.equal(huller(p), 0);
    });
    test('et reelt hul efter sidste runde giver stadig en advarsel — og teksten nævner runden', () => {
        const p = laeg(['09:00', '09:30', '10:00', '10:30'], '14:00');
        const v = ventetid(p);
        assert.equal(v.length, 4, 's1–s4 spiller double');
        assert.match(v[0].tekst, /venter 180 min mellem U11 D HS runde 4 kl\. 10:30 og U11 D HD.* kl\. 14:00/);
        assert.equal(huller(p), 4);
    });
    test('en runde, der fylder to slots, regnes i det mest gunstige tilfælde (spilleren spiller sidst i runden)', () => {
        // Runde 4 spilles kl. 10:30 og 12:00: spilleren kan have spillet kl. 12:00 → kun 30 min til doublen kl. 13:00
        const p = laeg(['09:00', '09:30', '10:00', ['10:30', '12:00']], '13:00');
        assert.deepEqual(ventetid(p), []);
        const o = spillerOphold(p.kampe, p.plan).get(`s5|${LOER}`);
        assert.equal(o.length, 4, 'én kendt kamp (runde 1) + runde 2, 3 og 4');
        assert.deepEqual([o.at(-1).fra, o.at(-1).til], [10 * 60 + 30, 12 * 60]);
    });
    test('planens statistik ("venter over 90 min", tid i hallen) tæller også Swiss-runderne (prod-test 2026-10-17)', () => {
        const tæt = bedoemPlan(laeg(['09:00', '10:00', '11:00', '12:00'], '13:00'));
        assert.equal(tæt.langeHuller, 0);
        // s5/s6: 09:00–12:30 (Swiss), s1–s4: 09:00–13:30 (Swiss + double)
        assert.equal(tæt.haltidMin, 2 * 210 + 4 * 270);
        assert.equal(bedoemPlan(laeg(['09:00', '09:30', '10:00', '10:30'], '14:00')).langeHuller, 4);
    });
    test('løseren straffer ikke lange huller for spillere, der også spiller Swiss-runder', () => {
        const pr = bygProblem(laeg(['09:00', '10:00', '11:00', '12:00'], '13:00'));
        assert.ok(pr.traek.length > 0, 'kampe i træk regnes stadig for de kendte kampe');
        assert.deepEqual(pr.huller, [], 's1–s4 spiller Swiss — ingen grupper til lange huller');
    });
});
