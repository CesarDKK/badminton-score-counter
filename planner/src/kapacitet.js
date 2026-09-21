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
 * Banebrug i ét slot, fordelt på puljer — DEN regel, Tjek og planlæggeren deler.
 * En række med reserverede baner bruger sine egne først. Har den flere kampe, end de rækker til,
 * "løber de over" på de fælles baner: står en fælles bane fri, bruger man den. Først når også de
 * fælles baner er fulde, er der for mange kampe i slottet.
 *   kampe: [{ raekkeId, halv }]
 * Returnerer { faellesBrugt, faellesBaner, overloeb: Map(raekkeId → baner), prPulje: Map(pulje → { hele, halve, brugt, baner }), forMange }.
 */
export function banebrugISlot(kampe, kapacitet) {
    const prPulje = new Map();
    for (const k of kampe) {
        const pulje = puljeFor(k.raekkeId, kapacitet.reserveret);
        if (!prPulje.has(pulje)) prPulje.set(pulje, { hele: 0, halve: 0 });
        const p = prPulje.get(pulje);
        if (k.halv) p.halve += 1; else p.hele += 1;
    }
    const overloeb = new Map();
    let faellesBrugt = 0;
    for (const [pulje, p] of prPulje) {
        p.brugt = p.hele + Math.ceil(p.halve / 2);
        p.baner = pulje === 'faelles' ? kapacitet.faelles : kapacitet.reserveret.get(pulje);
        if (pulje === 'faelles') faellesBrugt += p.brugt;
        else if (p.brugt > p.baner) { overloeb.set(pulje, p.brugt - p.baner); faellesBrugt += p.brugt - p.baner; }
    }
    return { faellesBrugt, faellesBaner: kapacitet.faelles, overloeb, prPulje, forMange: faellesBrugt > kapacitet.faelles };
}

/**
 * Hvor meget af banerne planlæggeren i praksis kan fylde: pauser, rækkefølge og Swiss-runder giver huller.
 * DET ene sted tallet står — bruges af formvalget (store.js), dagfordelingen (scheduler.js) og fane 1.
 */
export const FYLDNINGSGRAD = 0.85;

/**
 * Bane-slots til rådighed for en række på én dag — DEN ene kapacitetsberegning (formvalg, dagfordeling
 * og kapacitetsregnskab bygger alle på den). Kun slots, hvor rækken må spille: årgangens tidsvindue og
 * rækkens eget tidsrum (M = regelmodellen). `vindue` kan snævre yderligere ind (fx en anden rækkes vindue).
 * Returnerer { faelles, egne }: de fælles baner og rækkens egne reserverede baner. Uden fyldningsgrad.
 */
export function pladsPaaDag(M, raekke, dag, raekker, { vindue = null, kapFor = null } = {}) {
    const v = M.raekkeVindue(raekke, dag);
    let faelles = 0, egne = 0;
    for (const slot of slotsForDag(dag, M.slotMin)) {
        const m = minutter(slot);
        if (!M.iVindue(v, m) || (vindue && !M.iVindue(vindue, m))) continue;
        const kap = kapFor ? kapFor(dag.dato, slot) : puljeKapacitet(dag, slot, raekker);
        faelles += kap.faelles;
        egne += kap.reserveret.get(raekke.id) || 0;
    }
    return { faelles, egne };
}

/**
 * Dagfordeling: rækker, der må spille færre dage, end de har at vælge imellem, fordeles på dagene.
 * DEN ene fordeling — planlæggeren lægger kampene efter den, og formvalget regner sin kapacitet ud fra den.
 * Rækkerne fordeles efter belastning, størst først: til den første dag, hvor rækken kan være, uden at dagen
 * fyldes over fyldningsgraden, ellers til den dag, der har mest plads tilbage. Rækker uden grænse breder sig
 * over deres dage. Rækker med reserverede baner vurderes mod deres EGNE baner og belaster ikke de fælles.
 *   last: Map(raekkeId → bane-slots) · fasteDage: Map(raekkeId → Set(dato)) med dage, rækken allerede har
 *   låste kampe på · dagTvang: { raekkeId: [dato] } fastlægger dagene · muligeDage(r): rækkens dage (objekter).
 * Returnerer Map(raekkeId → Set(dato)) for de rækker, der er bundet.
 */
export function fordelRaekkerPaaDage(M, projekt, { last, muligeDage = null, fasteDage = new Map(), dagTvang = null, kapFor = null } = {}) {
    const dage = projekt.opsaetning.dage;
    const mulige = muligeDage || ((r) => dage.filter((d) => (r.dage || []).includes(d.dato)));
    const dagMap = new Map(dage.map((d) => [d.dato, d]));
    const plads = (r, d) => pladsPaaDag(M, r, d, projekt.raekker, { kapFor });
    const harEgne = (r) => r.reserveredeBaner > 0;
    const brugt = new Map(dage.map((d) => [d.dato, 0]));
    const rest = (dato, r) => (harEgne(r) ? FYLDNINGSGRAD * plads(r, dagMap.get(dato)).egne : FYLDNINGSGRAD * plads(r, dagMap.get(dato)).faelles - brugt.get(dato));
    const valg = new Map();
    const bundne = projekt.raekker.filter((r) => M.maxDageFor(r) && mulige(r).length > M.maxDageFor(r));
    for (const r of projekt.raekker) {
        if (bundne.includes(r) || !last.has(r.id) || harEgne(r)) continue;
        const md = mulige(r);
        for (const d of md) brugt.set(d.dato, brugt.get(d.dato) + last.get(r.id) / md.length);
    }
    const foretruk = (a, b) => a.dato.localeCompare(b.dato);
    for (const r of [...bundne].sort((a, b) => (last.get(b.id) || 0) - (last.get(a.id) || 0) || a.id.localeCompare(b.id))) {
        const maxDage = M.maxDageFor(r);
        const tvang = (dagTvang?.[r.id] || []).filter((d) => mulige(r).some((x) => x.dato === d));
        const valgte = new Set([...(fasteDage.get(r.id) || []), ...tvang].slice(0, maxDage));
        const behov = (last.get(r.id) || 0) / maxDage;
        const kandidater = mulige(r).filter((d) => !valgte.has(d.dato)).sort(foretruk);
        while (valgte.size < maxDage && kandidater.length) {
            const passer = kandidater.find((d) => rest(d.dato, r) >= behov);
            const dag = passer || [...kandidater].sort((a, b) => rest(b.dato, r) - rest(a.dato, r) || foretruk(a, b))[0];
            kandidater.splice(kandidater.indexOf(dag), 1);
            valgte.add(dag.dato);
        }
        if (!harEgne(r)) for (const d of valgte) brugt.set(d, brugt.get(d) + (last.get(r.id) || 0) / valgte.size);
        valg.set(r.id, valgte);
    }
    return valg;
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
