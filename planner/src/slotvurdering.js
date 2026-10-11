// Hvor må en kamp ligge? Når brugeren vælger en kamp for at flytte den, farves hvert slot på dagen: grønt (ingen nye
// problemer), gult (kun advarsler, fx en mulig spiller i cuppen eller uden for rækkens eget tidsrum) eller rødt (en ny
// fejl). Gennemgangen 2026-10-11 (U4/A8), inspireret af R2 Sports' turneringsgitter. Bygger på regelmodellens byggesten
// (samme regler som Tjek), men vurderer kun den valgte kamp — hurtigt nok til at regne alle dagens slots ved hvert valg.
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, banebrugISlot } from './kapacitet.js';

/**
 * Vurderer dagens slots for de valgte kampe (én kamp eller en Swiss-runde som blok).
 * Returnerer Map(slot → { niveau: 'ok' | 'advarsel' | 'fejl', grunde: [tekst] }).
 */
export function vurderSlots(projekt, M, ids, dag) {
    const { slotMin } = M;
    const valgte = ids.map((id) => M.kampMap.get(id)).filter(Boolean);
    const ud = new Map();
    if (!valgte.length || !dag) return ud;
    const k0 = valgte[0];
    const r = M.raekke(k0);
    const egne = new Set(valgte.map((k) => k.id));
    const kendte = new Set(valgte.flatMap((k) => k.spillere));
    const mulige = new Set(valgte.flatMap((k) => k.muligeSpillere));
    // Dagens øvrige kampe pr. slot
    const prSlot = new Map();
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (!p || egne.has(k.id) || p.dag !== dag.dato) continue;
        if (!prSlot.has(p.slot)) prSlot.set(p.slot, []);
        prSlot.get(p.slot).push(k);
    }
    const tidFor = (id) => { const p = projekt.plan[id]; return p ? { dag: p.dag, min: minutter(p.slot) } : null; };
    for (const slot of slotsForDag(dag, slotMin)) {
        const m = minutter(slot);
        const fejl = [], advarsler = [];
        if (!r || !(r.dage || []).includes(dag.dato)) fejl.push('rækken spiller ikke den dag');
        if (r) {
            if (!M.iVindue(M.aargangsVindue(r, dag), m)) fejl.push(`uden for ${r.aargang}'s tidsvindue`);
            else if (!M.iVindue(M.raekkeVindue(r, dag), m)) advarsler.push('uden for rækkens eget tidsrum');
            const forbud = M.kampForbud(k0, dag.dato, m);
            if (forbud) fejl.push(forbud);
        }
        // Baner
        const her = prSlot.get(slot) || [];
        const brug = banebrugISlot([...her, ...valgte].map((k) => ({ raekkeId: M.kat(k)?.raekke, halv: !!M.kat(k)?.halvBane })), puljeKapacitet(dag, slot, projekt.raekker, slotMin));
        if (brug.forMange) fejl.push('ingen ledig bane');
        // Spillere: samme tid eller for kort pause
        for (const [s2, liste] of prSlot) {
            const m2 = minutter(s2);
            for (const x of liste) {
                if (!valgte.some((k) => M.kanDeleSpillere(k, x))) continue;
                const begge = x.spillere.some((s) => kendte.has(s));
                const muligt = begge || x.muligeSpillere.some((s) => mulige.has(s));
                if (!muligt) continue;
                const { varighed, pause } = M.mellemrum(k0, x);
                const gab = Math.abs(m2 - m);
                if (gab === 0) (begge ? fejl : advarsler).push(begge ? 'en spiller har en anden kamp i slottet' : 'en mulig spiller har en anden kamp i slottet');
                else if (gab < varighed + pause) (begge ? fejl : advarsler).push(begge ? 'for kort pause for en spiller' : 'måske for kort pause for en mulig spiller');
            }
        }
        // Rækkefølge: efter de kampe, den bygger på, og før dem, der bygger på den
        for (const k of valgte) {
            for (const d of k.afhaengerAf) {
                const t = tidFor(d);
                if (t && !egne.has(d) && (t.dag > dag.dato || (t.dag === dag.dato && t.min + slotMin > m))) { fejl.push('før en kamp, den bygger på'); break; }
            }
        }
        for (const x of projekt.kampe) {
            if (egne.has(x.id) || !x.afhaengerAf.some((d) => egne.has(d))) continue;
            const t = tidFor(x.id);
            if (t && (t.dag < dag.dato || (t.dag === dag.dato && m + slotMin > t.min))) { fejl.push('efter en kamp, der bygger på den'); break; }
        }
        const grunde = [...new Set([...fejl, ...advarsler])];
        ud.set(slot, { niveau: fejl.length ? 'fejl' : advarsler.length ? 'advarsel' : 'ok', grunde });
    }
    return ud;
}
