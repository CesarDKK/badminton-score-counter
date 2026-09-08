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

/**
 * Reserverede baner i et slot: rækker med `reserveredeBaner` > 0, der spiller
 * den dag, og hvis eget tidsrum (tidligst–senest, ellers hele dagen) dækker
 * slottet. En række med reservation bruger KUN sine egne baner i tidsrummet
 * (fx U9 på 5 delte baner kl. 12–16), og de øvrige rækker deler resten.
 * Returnerer Map(raekkeId → baner).
 */
export function reservationerISlot(raekker, dag, slot) {
    const m = minutter(slot);
    const ud = new Map();
    for (const r of raekker) {
        if (!(r.reserveredeBaner > 0) || !r.dage?.includes(dag.dato)) continue;
        const fra = minutter(r.tidligst || dag.start), til = minutter(r.senest || dag.slut);
        if (m >= fra && m < til) ud.set(r.id, r.reserveredeBaner);
    }
    return ud;
}

/** Kapacitet pr. pulje i et slot: { faelles, reserveret: Map(raekkeId → baner) }. */
export function puljeKapacitet(dag, slot, raekker) {
    const reserveret = reservationerISlot(raekker, dag, slot);
    let sum = 0;
    for (const b of reserveret.values()) sum += b;
    return { faelles: Math.max(0, banerISlot(dag, slot) - sum), reserveret };
}

/** Hvilken pulje en kamp hører til i et slot: rækkens id (reserveret) eller 'faelles'. */
export function puljeFor(raekkeId, reserveret) {
    return reserveret.has(raekkeId) ? raekkeId : 'faelles';
}

/**
 * Anti-samtidighed (fra Jespers gamle prompt, regel A3): i samme række må
 * HS og HD ikke ligge samtidig, DS og DD ikke, og MD ikke sammen med nogen af
 * dem. U9's kønsblandede double ("D") regnes som både HD og DD.
 * Samme kategori konflikter aldrig (puljekampe spilles parallelt).
 */
export function katKonflikt(katA, katB) {
    if (!katA || !katB || katA === katB) return false;
    const mix = (k) => k === 'MD' || k === 'D';
    if (mix(katA) || mix(katB)) return true;
    const par = [['HS', 'HD'], ['DS', 'DD']];
    return par.some(([a, b]) => (katA === a && katB === b) || (katA === b && katB === a));
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
