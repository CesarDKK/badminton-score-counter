// Kontrakt-test JS ↔ Python (gennemgang 2026-09-20, punkt 21).
//
//   node tests/kontrakt/kontrakt.mjs byg  <mappe>   → skriver problem-*.json (bygProblem) og projekt-*.json
//   python solver/kontrakt.py <mappe>               → løser hvert problem, skriver svar-*.json
//   node tests/kontrakt/kontrakt.mjs tjek <mappe>   → lægger svaret ind og kører tjekPlan: 0 fejl kræves
//
// Projekterne er syntetiske (ingen persondata) og dækker det, de to sider skal være enige om:
// Swiss Ladder, pulje + cup, doubler med spillere fra singlerne, halve baner med reserverede baner og
// tidsrum, max haltid, én-dags-rækker over to dage, låste kampe, "før skoledag" og streng kampvarighed.
import fs from 'node:fs';
import path from 'node:path';
import { nytProjekt, saetForm, opdaterDag, opdaterRaekke, opdaterOpsaetning, flytKamp, laasKamp } from '../../src/store.js';
import { lavForslag } from '../../src/scheduler.js';
import { bygProblem, planFraSvar } from '../../src/solver-klient.js';
import { tjekPlan } from '../../src/rules.js';

function model(raekker, dage) {
    const spillere = {}, kategorier = [], tilmeldinger = {};
    let ev = 0;
    const sp = (id) => { spillere[id] = spillere[id] || { id, fornavn: id, efternavn: 'Test', koen: 'H', foedt: null, klub: 'K', memberid: null, niveau: {}, point: {} }; return id; };
    for (const r of raekker) for (const k of r.kategorier) {
        const id = `${r.id} ${k.kat}`;
        ev += 1;
        kategorier.push({ id, eventId: ev, raekke: r.id, aargang: r.aargang, kat: k.kat, type: k.type, mix: false, form: 'ingen lodtrækning', tilmeldte: 0, kampe: 0, runder: 0, halvBane: !!k.halv });
        tilmeldinger[id] = k.spillere.map((ids, i) => ({ entry: ev * 100 + i, spillere: ids.map(sp) }));
    }
    return {
        version: 1, kilde: { filnavn: 'kontrakt.tp', laestUtc: '', tpVersion: null }, turnering: { navn: 'Kontrakt', hal: '', dage },
        tpGitter: { slotMin: 30, dage: [], baner: { hele: 6, halve: 0, navne: [] }, harTider: false, advarsler: 0 },
        raekker: raekker.map((r) => ({ id: r.id, aargang: r.aargang, raekke: r.raekke, pauseKlasse: r.raekke === 'E' ? 'E' : r.raekke === 'M' ? 'M' : 'ABCD', kategorier: r.kategorier.map((k) => `${r.id} ${k.kat}`) })),
        kategorier, spillere, kampe: [], tilmeldinger, bemaerkninger: [],
    };
}
const enkelt = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${i + 1}`]);
const par = (praefiks, n) => Array.from({ length: n }, (_, i) => [`${praefiks}${2 * i + 1}`, `${praefiks}${2 * i + 2}`]);

function grundprojekt() {
    const dage = ['2026-11-21', '2026-11-22']; // lørdag og søndag (søndag er "før skoledag")
    let p = nytProjekt(model([
        { id: 'U09 D', aargang: 'U09', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', halv: true, spillere: enkelt('u9-', 8) }, { kat: 'HD', type: 'double', spillere: par('u9-', 4) }] },
        { id: 'U11 D', aargang: 'U11', raekke: 'D', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('u11d-', 11) }, { kat: 'HD', type: 'double', spillere: par('u11d-', 5) }] },
        { id: 'U13 M', aargang: 'U13', raekke: 'M', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('u13-', 12) }, { kat: 'DS', type: 'single', spillere: enkelt('u13d-', 6) }] },
    ], dage));
    for (const d of dage) p = opdaterDag(p, d, { baner: 6, start: '09:00', slut: '19:00' });
    p = saetForm(p, 'U09 D HS', { formValg: 'swiss' });
    p = saetForm(p, 'U09 D HD', { formValg: 'pulje' });
    p = saetForm(p, 'U11 D HS', { formValg: 'swiss' });
    p = saetForm(p, 'U11 D HD', { formValg: 'pulje' });
    p = saetForm(p, 'U13 M HS', { formValg: 'pulje-cup' });
    p = saetForm(p, 'U13 M DS', { formValg: 'dobbelt-pulje' });
    // Pause som i Jespers turneringer: 10 min (ABCD) uden fælles pause, så en spiller kan spille i naboslots
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    return opdaterRaekke(p, 'U09 D', { dage: ['2026-11-21'], tidligst: '10:00', senest: '16:00', reserveredeBaner: 2, maxHaltidMin: 300 });
}

/** Senior: E-række med kvart-, semi- og finale (sidste dag kun semi/finale, finalen 10–13) og M-række med max 3 kampe pr. kategori pr. dag. */
function seniorprojekt() {
    const dage = ['2026-11-21', '2026-11-22'];
    let p = nytProjekt(model([
        { id: 'SEN E', aargang: 'SEN', raekke: 'E', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('se-', 12) }] },
        { id: 'SEN M', aargang: 'SEN', raekke: 'M', kategorier: [{ kat: 'HS', type: 'single', spillere: enkelt('sm-', 3) }] },
    ], dage));
    for (const d of dage) p = opdaterDag(p, d, { baner: 4, start: '09:00', slut: '20:00', foerSkoledag: false });
    p = opdaterOpsaetning(p, { pauseMin: { ...p.opsaetning.pauseMin, faelles: null } });
    p = saetForm(p, 'SEN E HS', { formValg: 'pulje-cup', cupTop: 2 });
    return saetForm(p, 'SEN M HS', { formValg: 'dobbelt-pulje' });
}

export function projekter() {
    const grund = grundprojekt();
    const laast = (() => { let p = grund; const k = p.kampe.find((x) => x.kategori === 'U13 M HS' && x.fase === 'pulje'); p = flytKamp(p, k.id, '2026-11-22', '11:00'); return laasKamp(p, k.id, true); })();
    // Med to slots mellem en spillers kampe (streng varighed eller fælles pause) skal U9 have længere tid
    // i hallen, og U11 D må spille begge dage — ellers er opgaven reelt umulig, og så tester den ikke kontrakten.
    const rummelig = (p) => opdaterRaekke(opdaterRaekke(p, 'U09 D', { senest: '18:30', maxHaltidMin: 480 }), 'U11 D', { dispensationFlereDage: true });
    return {
        grund,
        streng: rummelig(opdaterOpsaetning(grund, { kampVarighed: 'slot' })),
        anti: opdaterOpsaetning(grund, { antiSamtidighed: true }),
        laast,
        dispensation: opdaterRaekke(grund, 'U11 D', { dispensationFlereDage: true }),
        senior: seniorprojekt(),
        faellesPause: rummelig(opdaterOpsaetning(grund, { pauseMin: { ...grund.opsaetning.pauseMin, faelles: 12 } })),
    };
}

const [, , kommando, mappe = 'tests/kontrakt/_ud'] = process.argv;
if (kommando === 'byg') {
    fs.mkdirSync(mappe, { recursive: true });
    for (const [navn, p] of Object.entries(projekter())) {
        const g = lavForslag(p);
        fs.writeFileSync(path.join(mappe, `problem-${navn}.json`), JSON.stringify({ problem: bygProblem(p, g.brud.length ? null : g.plan), sekunder: 8 }));
        console.log(`${navn}: ${p.kampe.length} kampe · grådig ${g.brud.length} regelbrud`);
    }
} else if (kommando === 'tjek') {
    let fejl = 0;
    for (const [navn, p] of Object.entries(projekter())) {
        const svar = JSON.parse(fs.readFileSync(path.join(mappe, `svar-${navn}.json`), 'utf8'));
        const lovlig = svar.status === 'OPTIMAL' || svar.status === 'FEASIBLE';
        const plan = planFraSvar(p, svar);
        const t = lovlig ? tjekPlan({ ...p, plan }) : null;
        const mangler = lovlig ? p.kampe.filter((k) => !plan[k.id]).length : p.kampe.length;
        const laastFlyttet = (p.laast || []).filter((id) => JSON.stringify(plan[id]) !== JSON.stringify(p.plan[id])).length;
        const ok = lovlig && mangler === 0 && t.antal.fejl === 0 && laastFlyttet === 0;
        console.log(`${ok ? 'OK  ' : 'FEJL'} ${navn}: ${svar.status} · ${p.kampe.length - mangler}/${p.kampe.length} kampe · Tjek ${t ? t.antal.fejl : '-'} fejl${laastFlyttet ? ` · ${laastFlyttet} låste kampe flyttet` : ''}`);
        if (!ok) { fejl += 1; for (const x of (t?.problemer || []).filter((y) => y.alvor === 'fejl').slice(0, 5)) console.log(`      ${x.type}: ${x.tekst}`); if (svar.diagnose) console.log('      diagnose:', JSON.stringify(svar.diagnose)); }
    }
    if (fejl) { console.error(`${fejl} kontraktbrud: løserens plan og Tjek er uenige`); process.exit(1); }
    console.log('Kontrakten holder: løserens planer har 0 fejl i Tjek.');
} else if (kommando) {
    console.error('Brug: kontrakt.mjs byg|tjek <mappe>'); process.exit(2);
}
