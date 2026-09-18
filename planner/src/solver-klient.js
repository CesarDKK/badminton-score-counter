// Klient til CP-SAT-løseren (planner/solver, Google OR-Tools).
//
// bygProblem() oversætter projektet til et rent planlægningsproblem: kamp-id'er,
// spillere som løbenumre, tilladte starttider, kapacitet pr. slot, konfliktpar
// og vægte. Der sendes INGEN navne, klubber, fødselsdatoer eller e-mails —
// løseren har ikke brug for dem. Al regelkendskab (tidsvinduer, pauser, hvem der
// kan dele spillere) ligger her i JS, så løseren kun kender tal og par.
import { minutter, klokkeFraMinutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, katKonflikt } from './kapacitet.js';
import { reglerFor } from './store.js';
import { minKampMin, pauseForRaekke, tidsvindue } from './rules.js';
import { vaegteFor } from './kriterier.js';

const DAG_MIN = 1440;

/**
 * Bygger problemet til løseren. Tiden er global: T = dagIndex * 1440 + startminut,
 * så "afstand mellem to kampe" virker på tværs af dage uden særbehandling.
 * @param {object} projekt
 * @param {object} [hintPlan]  en lovlig plan (fra lavForslag) som startløsning
 */
export function bygProblem(projekt, hintPlan = null) {
    const { slotMin, pauseMin, dage } = projekt.opsaetning;
    const regler = reglerFor(projekt);
    const kampVarighed = projekt.opsaetning.kampVarighed || 'minimum';
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const laast = new Set(projekt.laast || []);
    const dagIndex = new Map(dage.map((d, i) => [d.dato, i]));
    const kat = (k) => katMap.get(k.kategori);
    const raekke = (k) => raekkeMap.get(kat(k)?.raekke);
    const varighedFor = (k) => { const r = raekke(k); return kampVarighed === 'slot' || !r ? slotMin : Math.min(slotMin, minKampMin(r.aargang, r.raekke, regler)); };
    const pauseFor = (k) => pauseForRaekke(pauseMin, raekke(k)?.pauseKlasse || 'ABCD');

    // Puljer: rækker med reserverede baner har egen pulje (altid), resten deler 'faelles'
    const puljeForRaekke = (r) => (r?.reserveredeBaner > 0 ? r.id : 'faelles');
    const kapacitet = {}; // pulje → [{ t, baner }]
    dage.forEach((dag, di) => {
        for (const slot of slotsForDag(dag, slotMin)) {
            const t = di * DAG_MIN + minutter(slot);
            const kap = puljeKapacitet(dag, slot, projekt.raekker);
            (kapacitet.faelles = kapacitet.faelles || []).push({ t, baner: kap.faelles });
            for (const r of projekt.raekker) {
                if (!(r.reserveredeBaner > 0)) continue;
                (kapacitet[r.id] = kapacitet[r.id] || []).push({ t, baner: kap.reserveret.get(r.id) || 0 });
            }
        }
    });

    // Spillere som løbenumre (ingen persondata forlader browseren)
    const spillerNr = new Map();
    const nr = (id) => { if (!spillerNr.has(id)) spillerNr.set(id, spillerNr.size); return spillerNr.get(id); };

    const kampe = [];
    const indeks = new Map();
    for (const k of projekt.kampe) {
        const r = raekke(k);
        if (!r) continue;
        let tilladte = [];
        const p = projekt.plan[k.id];
        if (laast.has(k.id) && p && dagIndex.has(p.dag)) {
            tilladte = [dagIndex.get(p.dag) * DAG_MIN + minutter(p.slot)];
        } else {
            for (const dato of r.dage || []) {
                const dag = dage.find((d) => d.dato === dato);
                if (!dag) continue;
                const v = tidsvindue(r.aargang, dag, regler);
                const fra = Math.max(v.fra, r.tidligst ? minutter(r.tidligst) : 0);
                const til = Math.min(v.til, r.senest ? minutter(r.senest) : 9999);
                for (const slot of slotsForDag(dag, slotMin)) {
                    const m = minutter(slot);
                    if (m >= fra && m + slotMin <= til) tilladte.push(dagIndex.get(dato) * DAG_MIN + m);
                }
            }
        }
        indeks.set(k.id, kampe.length);
        kampe.push({
            id: k.id, raekke: r.id, pulje: puljeForRaekke(r), halv: !!kat(k)?.halvBane, tilladte,
            spillere: k.spillere.map(nr), erFinale: k.rundeNavn === 'Finale',
            hint: hintPlan?.[k.id] && dagIndex.has(hintPlan[k.id].dag) ? dagIndex.get(hintPlan[k.id].dag) * DAG_MIN + minutter(hintPlan[k.id].slot) : null,
        });
    }

    // Afhængigheder: efterfølger skal starte mindst ét slot senere
    const foer = [];
    for (const k of projekt.kampe) for (const dep of k.afhaengerAf) if (indeks.has(k.id) && indeks.has(dep)) foer.push([indeks.get(dep), indeks.get(k.id), slotMin]);

    // Konfliktpar: to kampe med en fælles (mulig) spiller skal ligge mindst varighed + pause fra hinanden
    const forfaedre = new Map();
    const alleForfaedre = (id, dybde = 0) => {
        if (forfaedre.has(id)) return forfaedre.get(id);
        const set = new Set();
        for (const dep of kampMap.get(id)?.afhaengerAf || []) { set.add(dep); if (dybde < 50) for (const x of alleForfaedre(dep, dybde + 1)) set.add(x); }
        forfaedre.set(id, set);
        return set;
    };
    const kanDeleSpillere = (a, b) => {
        if (a.tpRef.draw !== b.tpRef.draw) return true;
        if (a.fase === 'swiss' && b.fase === 'swiss') return a.runde !== b.runde;
        return alleForfaedre(a.id).has(b.id) || alleForfaedre(b.id).has(a.id);
    };
    const prSpiller = new Map();
    for (const k of projekt.kampe) {
        if (!indeks.has(k.id)) continue;
        for (const s of k.muligeSpillere) { if (!prSpiller.has(s)) prSpiller.set(s, []); prSpiller.get(s).push(k); }
    }
    const par = new Map(); // "i|j" → gab (minutter)
    for (const liste of prSpiller.values()) {
        for (let i = 0; i < liste.length; i += 1) for (let j = i + 1; j < liste.length; j += 1) {
            const a = liste[i], b = liste[j];
            if (!kanDeleSpillere(a, b)) continue;
            const udenPause = a.fase === 'swiss' && b.fase === 'swiss' && a.tpRef.draw === b.tpRef.draw && kat(a)?.swissUdenPause;
            const gab = udenPause ? slotMin : Math.max(slotMin, Math.max(varighedFor(a), varighedFor(b)) + Math.max(pauseFor(a), pauseFor(b)));
            const ia = indeks.get(a.id), ib = indeks.get(b.id);
            const n = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
            if (!par.has(n) || par.get(n) < gab) par.set(n, gab);
        }
    }
    const konflikter = [];
    for (const [n, gab] of par) {
        const [i, j] = n.split('|').map(Number);
        const a = kampMap.get(kampe[i].id), b = kampMap.get(kampe[j].id);
        // Ordnet par: den ene bygger på den anden → ingen valgfri rækkefølge
        if (alleForfaedre(b.id).has(a.id)) konflikter.push([i, j, gab, 1]);
        else if (alleForfaedre(a.id).has(b.id)) konflikter.push([j, i, gab, 1]);
        else konflikter.push([i, j, gab, 0]);
    }

    // Anti-samtidighed (valgfri): HS/HD, DS/DD, MD i samme række ikke i samme slot
    const ikkeSamtidig = [];
    if (projekt.opsaetning.antiSamtidighed === true) {
        const prRaekke = new Map();
        for (const k of projekt.kampe) { if (!indeks.has(k.id)) continue; const rid = kat(k)?.raekke; if (!prRaekke.has(rid)) prRaekke.set(rid, []); prRaekke.get(rid).push(k); }
        for (const liste of prRaekke.values()) for (let i = 0; i < liste.length; i += 1) for (let j = i + 1; j < liste.length; j += 1) {
            if (katKonflikt(kat(liste[i])?.kat, kat(liste[j])?.kat)) ikkeSamtidig.push([indeks.get(liste[i].id), indeks.get(liste[j].id)]);
        }
    }

    // Max haltid: grupper af kampe, hvis første-til-sidste samme dag højst må være graense minutter.
    // Kendte spillere i rækker med grænse, og Swiss Ladder-lodtrækninger (alle er med i hver runde).
    const haltid = [];
    const prKendt = new Map();
    for (const k of projekt.kampe) { if (!indeks.has(k.id)) continue; for (const s of k.spillere) { if (!prKendt.has(s)) prKendt.set(s, []); prKendt.get(s).push(k); } }
    for (const liste of prKendt.values()) {
        const graenser = liste.map((k) => raekke(k)?.maxHaltidMin).filter(Boolean);
        if (graenser.length && liste.length > 1) haltid.push({ kampe: liste.map((k) => indeks.get(k.id)), graense: Math.min(...graenser) });
    }
    const prSwiss = new Map();
    for (const k of projekt.kampe) { if (k.fase !== 'swiss' || !indeks.has(k.id) || !raekke(k)?.maxHaltidMin) continue; if (!prSwiss.has(k.tpRef.draw)) prSwiss.set(k.tpRef.draw, []); prSwiss.get(k.tpRef.draw).push(k); }
    for (const liste of prSwiss.values()) haltid.push({ kampe: liste.map((k) => indeks.get(k.id)), graense: raekke(liste[0]).maxHaltidMin });

    // Ventetid (blødt): kendte spilleres kampe som grupper; Swiss-lodtrækninger vægtes med antal spillere
    const spillerGrupper = [];
    for (const liste of prKendt.values()) if (liste.length > 1) spillerGrupper.push({ kampe: liste.map((k) => indeks.get(k.id)), vaegt: 1 });
    const swissAlle = new Map();
    for (const k of projekt.kampe) { if (k.fase !== 'swiss' || !indeks.has(k.id)) continue; if (!swissAlle.has(k.tpRef.draw)) swissAlle.set(k.tpRef.draw, []); swissAlle.get(k.tpRef.draw).push(k); }
    for (const liste of swissAlle.values()) {
        const antalSpillere = Math.max(...liste.map((k) => k.muligeSpillere.length), 2);
        if (liste.length > 1) spillerGrupper.push({ kampe: liste.map((k) => indeks.get(k.id)), vaegt: antalSpillere });
    }

    // Max dage pr. række
    const maxDage = projekt.raekker.filter((r) => r.maxDage && !r.dispensationFlereDage && (r.dage || []).length > r.maxDage)
        .map((r) => ({ raekke: r.id, max: r.maxDage, kampe: kampe.map((k, i) => (k.raekke === r.id ? i : -1)).filter((i) => i >= 0) }));

    // Max kampe pr. spiller pr. dag
    const maxPrDag = dage.length === 1 ? regler.maxKampePrDagEnDag : regler.maxKampePrDag;
    const mangeKampe = [...prKendt.values()].filter((l) => l.length > maxPrDag).map((l) => l.map((k) => indeks.get(k.id)));

    return {
        version: 1,
        slotMin,
        dage: dage.map((d, i) => ({ index: i, start: minutter(d.start), slut: minutter(d.slut), baner: d.baner })),
        kapacitet, kampe, foer, konflikter, ikkeSamtidig, haltid, spillerGrupper, maxDage,
        maxKampePrDag: maxPrDag, mangeKampe,
        vaegte: vaegteFor(projekt),
    };
}

/** Oversætter løserens svar (kamp-id → global tid) til en plan. */
export function planFraSvar(projekt, svar) {
    const dage = projekt.opsaetning.dage;
    const plan = {};
    for (const [id, t] of Object.entries(svar.tider || {})) {
        const dag = dage[Math.floor(t / DAG_MIN)];
        if (dag) plan[id] = { dag: dag.dato, slot: klokkeFraMinutter(t % DAG_MIN) };
    }
    return plan;
}

/** Tilfældigt job-id, så en igangværende løsning kan stoppes med stopLoeser(). */
export function nytJobId() {
    const b = new Uint8Array(12);
    // Ældre Node (CI kører 18) har ikke crypto som global; id'et er kun et håndtag til "Stop", ikke en hemmelighed
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Beder løseren stoppe nu og aflevere den bedste plan hidtil (svaret kommer i det oprindelige optimer()-kald). */
/** Som stopLoeser, men til når siden lukkes: sendBeacon overlever, at fanen forsvinder. */
export function stopVedLukning(job, url = '/api/solve/stop') {
    try { return !!globalThis.navigator?.sendBeacon?.(url, new Blob([JSON.stringify({ job })], { type: 'application/json' })); } catch { return false; }
}

export async function stopLoeser(job, url = '/api/solve/stop') {
    const svar = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job }) });
    return svar.ok;
}

/**
 * Kalder løseren. Returnerer { status, plan, sekunder, maal, graense } eller kaster ved netværksfejl.
 * status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
 */
export async function optimer(projekt, { sekunder = 30, hintPlan = null, url = '/api/solve', signal, job = null, pollMs = 3000 } = {}) {
    const problem = bygProblem(projekt, hintPlan);
    // Jobbet startes og hentes med korte kald (start → status hvert par sekunder), så ingen
    // forbindelse står åben i flere minutter — proxyer som Cloudflare afbryder dem efter ca. 100 s.
    const svar = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ problem, sekunder, asynkron: true, ...(job ? { job } : {}) }), signal });
    if (!svar.ok) throw new Error(svar.status === 429 ? 'Løseren er optaget — prøv igen om lidt.' : `Løseren svarede ${svar.status}`);
    let data = await svar.json();
    const jobId = data.job || job;
    let fejlIRap = 0;
    const frist = Date.now() + (sekunder + 90) * 1000;
    while (data.status === 'REGNER') {
        if (Date.now() > frist) throw new Error('Løseren svarede ikke inden for tiden.');
        await new Promise((r) => setTimeout(r, pollMs));
        if (signal?.aborted) throw new Error('Afbrudt.');
        try {
            const s = await fetch(`${url}/status?job=${encodeURIComponent(jobId)}`, { signal });
            if (s.status === 404) throw Object.assign(new Error('Løseren kender ikke længere jobbet (den er måske blevet genstartet).'), { endelig: true });
            if (s.status >= 500 || s.status === 429) throw new Error(`Løseren svarede ${s.status}`); // forbigående: prøv igen
            data = await s.json();
            if (!s.ok) throw Object.assign(new Error(data.fejl || `Løseren svarede ${s.status}`), { endelig: true });
            fejlIRap = 0;
        } catch (err) {
            fejlIRap += 1;
            if (err.endelig || fejlIRap >= 5) throw err;
            data = { status: 'REGNER' };
        }
    }
    return { ...data, plan: planFraSvar(projekt, data) };
}
