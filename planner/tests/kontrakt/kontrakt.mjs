// Kontrakt-test JS ↔ Python (gennemgang 2026-09-20, punkt 21).
//
//   node tests/kontrakt/kontrakt.mjs byg  <mappe>   → skriver problem-*.json (bygProblem) og projekt-*.json
//   python solver/kontrakt.py <mappe>               → løser hvert problem, skriver svar-*.json
//   node tests/kontrakt/kontrakt.mjs tjek <mappe>   → lægger svaret ind og kører tjekPlan: 0 fejl kræves
//
// Og omvendt (Fable-gennemgangen 2026-10-10, K1): et program, Tjek godkender, skal løseren også godkende. Planlæggerens
// program låses helt (problem-omvendt-*.json), og løseren skal svare, at det er lovligt. Mindst ét af dem bruger
// "overløb" (en række med egne baner låner en fri fælles bane), som løseren tidligere afviste.
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
import { lavRegelmodel } from '../../src/regelmodel.js';
import { puljeKapacitet, banebrugISlot } from '../../src/kapacitet.js';

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

/** Antal slots, hvor en række med egne baner låner fælles baner (banebrugISlot). */
function antalOverloeb(p) {
    const { dagMap, kat } = lavRegelmodel(p);
    const prSlot = new Map();
    for (const k of p.kampe) {
        const t = p.plan[k.id];
        if (!t) continue;
        const n = `${t.dag}|${t.slot}`;
        if (!prSlot.has(n)) prSlot.set(n, []);
        prSlot.get(n).push({ raekkeId: kat(k)?.raekke, halv: !!kat(k)?.halvBane });
    }
    let antal = 0;
    for (const [n, kampe] of prSlot) {
        const [dato, slot] = n.split('|');
        if (banebrugISlot(kampe, puljeKapacitet(dagMap.get(dato), slot, p.raekker)).overloeb.size) antal += 1;
    }
    return antal;
}

const [, , kommando, mappe = 'tests/kontrakt/_ud'] = process.argv;
if (kommando === 'byg') {
    fs.mkdirSync(mappe, { recursive: true });
    const omvendte = [];
    for (const [navn, p] of Object.entries(projekter())) {
        const g = lavForslag(p);
        fs.writeFileSync(path.join(mappe, `problem-${navn}.json`), JSON.stringify({ problem: bygProblem(p, g.brud.length ? null : g.plan), sekunder: 8 }));
        // Omvendt: planlæggerens program, låst helt, når Tjek godkender det
        const lp = { ...p, plan: { ...p.plan, ...g.plan }, laast: p.kampe.map((k) => k.id) };
        const lovligt = !g.brud.length && p.kampe.every((k) => lp.plan[k.id]) && tjekPlan(lp).antal.fejl === 0;
        const overloeb = lovligt ? antalOverloeb(lp) : 0;
        if (lovligt) {
            fs.writeFileSync(path.join(mappe, `problem-omvendt-${navn}.json`), JSON.stringify({ problem: bygProblem(lp), sekunder: 8 }));
            omvendte.push({ navn, overloeb });
        }
        console.log(`${navn}: ${p.kampe.length} kampe · grådig ${g.brud.length} regelbrud${lovligt ? ` · omvendt (${overloeb} slots med overløb)` : ''}`);
    }
    // Overløb: grundprojektets program, men U9 har nu kun 1 reserveret bane — det, der lå på den anden, låner en fri
    // fælles bane. Tjek godkender det; det skal løseren også (den afviste det før, K1).
    const grund = projekter().grund;
    const op = opdaterRaekke({ ...grund, plan: { ...grund.plan, ...lavForslag(grund).plan }, laast: grund.kampe.map((k) => k.id) }, 'U09 D', { reserveredeBaner: 1 });
    const overloeb = antalOverloeb(op);
    if (tjekPlan(op).antal.fejl === 0) {
        fs.writeFileSync(path.join(mappe, 'problem-omvendt-overloeb.json'), JSON.stringify({ problem: bygProblem(op), sekunder: 8 }));
        omvendte.push({ navn: 'overloeb', overloeb });
    }
    console.log(`overloeb: Tjek ${tjekPlan(op).antal.fejl} fejl · ${overloeb} slots med overløb`);
    fs.writeFileSync(path.join(mappe, 'omvendt.json'), JSON.stringify(omvendte));
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
    const omvendte = JSON.parse(fs.readFileSync(path.join(mappe, 'omvendt.json'), 'utf8'));
    for (const { navn, overloeb } of omvendte) {
        const svar = JSON.parse(fs.readFileSync(path.join(mappe, `svar-omvendt-${navn}.json`), 'utf8'));
        const ok = svar.status === 'OPTIMAL' || svar.status === 'FEASIBLE';
        console.log(`${ok ? 'OK  ' : 'FEJL'} omvendt ${navn}: Tjek godkender programmet${overloeb ? ` (${overloeb} slots med overløb)` : ''} · løseren ${svar.status}`);
        if (!ok) { fejl += 1; if (svar.diagnose) console.log('      diagnose:', JSON.stringify(svar.diagnose)); }
    }
    if (!omvendte.some((x) => x.overloeb)) { fejl += 1; console.log('FEJL omvendt: intet program bruger overløb — testen dækker ikke længere K1'); }
    if (fejl) { console.error(`${fejl} kontraktbrud: løseren og Tjek er uenige`); process.exit(1); }
    console.log('Kontrakten holder begge veje: løserens planer har 0 fejl i Tjek, og løseren godkender de programmer, Tjek godkender.');
} else if (kommando) {
    console.error('Brug: kontrakt.mjs byg|tjek <mappe>'); process.exit(2);
}
