// Kapacitet (design § 7.1 og § 8 fane 1): bane-slots til rådighed pr. dag mod
// de kampe, rækkernes dage lægger på dagen. Rene funktioner uden DOM.
import { minutter, klokkeFraMinutter } from './tp-reader.js';

/** Slot-starttider for en dag: ["09:00", "09:30", …]. */
export function slotsForDag(dag, slotMin) {
    const fra = minutter(dag.start), til = minutter(dag.slut);
    const slots = [];
    for (let m = fra; m + slotMin <= til; m += slotMin) slots.push(klokkeFraMinutter(m));
    return slots;
}

/** Antal hele baner der er ledige i et givet slot (baner minus spærringer). */
export function banerISlot(dag, slot) {
    const m = minutter(slot);
    let baner = dag.baner;
    for (const s of dag.spaerret || []) {
        if (m >= minutter(s.fra) && m < minutter(s.til)) baner -= s.baner;
    }
    return Math.max(0, baner);
}

/** Bane-slots i alt på en dag. */
export function baneSlots(dag, slotMin) {
    return slotsForDag(dag, slotMin).reduce((sum, slot) => sum + banerISlot(dag, slot), 0);
}

/**
 * Kapacitetsoversigt pr. dag.
 * - faste: kampe i rækker, der kun spiller den dag (halve baner tæller ½)
 * - fleksible: kampe i rækker, der spænder over flere dage inkl. denne
 * - fordelt: faste + fleksible delt ligeligt på rækkens dage (bedste bud før forslaget)
 * - planlagte: kampe der allerede har en tid den dag i planen
 */
export function kapacitetPrDag(projekt) {
    const { slotMin, dage } = projekt.opsaetning;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const vaegt = (kamp) => (katMap.get(kamp.kategori)?.halvBane ? 0.5 : 1);

    const pr = new Map(dage.map((d) => [d.dato, { dato: d.dato, slots: slotsForDag(d, slotMin).length, baneSlots: baneSlots(d, slotMin), faste: 0, fleksible: 0, fordelt: 0, halveKampe: 0, planlagte: 0, kampe: 0 }]));
    let udenDag = 0;
    for (const kamp of projekt.kampe) {
        const kat = katMap.get(kamp.kategori);
        const raekke = kat && raekkeMap.get(kat.raekke);
        const kampDage = (raekke?.dage || []).filter((d) => pr.has(d));
        const w = vaegt(kamp);
        if (!kampDage.length) { udenDag += 1; continue; }
        for (const d of kampDage) {
            const r = pr.get(d);
            if (kampDage.length === 1) r.faste += w; else r.fleksible += w;
            r.fordelt += w / kampDage.length;
            if (w < 1) r.halveKampe += 1;
            r.kampe += 1 / kampDage.length;
        }
    }
    for (const kamp of projekt.kampe) {
        const p = projekt.plan[kamp.id];
        if (p && pr.has(p.dag)) pr.get(p.dag).planlagte += 1;
    }
    const liste = [...pr.values()].map((r) => ({
        ...r,
        kampe: Math.round(r.kampe * 100) / 100,
        udnyttelse: r.baneSlots ? r.fordelt / r.baneSlots : Infinity,
    }));
    return { dage: liste, udenDag, kampeIAlt: projekt.kampe.length };
}

/** Kampe pr. kategori fordelt på fase — til tabellen på fane 1. */
export function kampePrKategori(projekt) {
    const pr = new Map(projekt.kategorier.map((k) => [k.id, { pulje: 0, cup: 0, swiss: 0, ialt: 0, medTid: 0 }]));
    for (const kamp of projekt.kampe) {
        const r = pr.get(kamp.kategori);
        if (!r) continue;
        r[kamp.fase] = (r[kamp.fase] || 0) + 1;
        r.ialt += 1;
        if (projekt.plan[kamp.id]) r.medTid += 1;
    }
    return pr;
}
