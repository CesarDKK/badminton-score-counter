// Kompromiser undervejs (Jesper 2026-10-17): det, der er givet efter for at få programmet til at gå op — kortere kampe,
// pausen givet på dagen, længere dag, rækkens tidsrum, flere reserverede baner, dispensationer, Swiss i grupper, færre
// runder … — skal kunne trækkes tilbage, så løseren kan prøve igen. Løseren er stærkere end planlæggeren og finder måske
// et program uden kompromiset.
//
// Kompromiserne findes ved at sammenligne opsætningen fra før "Lav kampprogram" (kp.foer) med den nuværende — så de
// også omfatter valg på kortene og kamplængden, uden at hvert valg skal huske sig selv. Rene funktioner uden DOM.
//
// Teksten beskriver det, der sker, hvis man trækker kompromiset tilbage ("Tilbage til 30 min kampe (nu 20 min)") — den
// står ud for et flueben, og et flueben betyder "prøv det" (Jesper 2026-10-17: "svært at gennemskue, hvad det betyder,
// når jeg sætter eller fjerner et flueben").
import { genberegnKampe, saetSlotMin, opdaterOpsaetning, opdaterDag, opdaterRaekke, opdaterKategori } from './store.js';
import { VARIGHEDER } from './regelmodel.js';
import { erUdenPause } from './kamplaengde.js';
import { FORM_VALG_TEKST } from './form.js';
import { reglerFor } from './regler.js';

const ens = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const kortDato = (d) => `${d.slice(8, 10)}/${Number(d.slice(5, 7))}`;
const datoer = (liste) => (liste || []).map(kortDato).join(' og ') || 'ingen dage';

/** Felterne på rækker og kategorier, der kan være givet efter på (beregnede felter som formForslag tæller ikke). */
const RAEKKE_FELTER = ['dage', 'tidligst', 'senest', 'reserveredeBaner', 'dispensationFlereDage', 'maxHaltidMin', 'maxDoubleMin', 'maxRaekkeMin', 'maxDage'];
const KATEGORI_FELTER = ['formValg', 'swissRunder', 'swissGrupper', 'cupTop'];
const DAG_FELTER = ['start', 'slut', 'baner'];

function raekkeTekst(id, felt, foer, nu) {
    const v = VARIGHEDER.find((x) => x.felt === felt);
    if (v) return foer == null ? `${id}: ingen grænse for ${v.kort} igen (nu max ${nu} min)` : `${id}: max ${foer} min for ${v.kort} igen (nu ${nu == null ? 'ingen grænse' : `${nu} min`})`;
    if (felt === 'senest') return `${id} spiller igen senest til ${foer || 'dagens slut'} (nu ${nu || 'dagens slut'})`;
    if (felt === 'tidligst') return `${id} starter igen tidligst ${foer || 'ved dagens start'} (nu ${nu || 'ved dagens start'})`;
    if (felt === 'reserveredeBaner') return `${id}: ${foer || 0} reserverede baner igen (nu ${nu || 0})`;
    if (felt === 'dispensationFlereDage') return foer ? `${id}: dispensation til flere dage igen` : `${id}: uden dispensation til flere dage igen (nu med)`;
    if (felt === 'dage') return `${id} spiller igen ${datoer(foer)} (nu ${datoer(nu)})`;
    if (felt === 'maxDage') return `${id}: max ${foer ?? 'ingen grænse for'} dage igen (nu ${nu ?? 'ingen grænse'})`;
    return `${id}: ${felt} ${foer} igen (nu ${nu})`;
}

function kategoriTekst(id, felt, foer, nu) {
    if (felt === 'swissGrupper') return (foer || 1) > 1 ? `${id} i ${foer} Swiss-grupper igen (nu ${nu || 1})` : `${id} som én Swiss Ladder igen (nu ${nu} grupper)`;
    if (felt === 'swissRunder') return `${id}: ${foer || 'automatisk antal'} runder igen (nu ${nu || 'automatisk'})`;
    if (felt === 'formValg') return `${id}: ${FORM_VALG_TEKST[foer] || foer} igen (nu ${FORM_VALG_TEKST[nu] || nu})`;
    if (felt === 'cupTop') return `${id}: cup for ${foer === 2 ? 'de to bedste' : 'vinderne'} igen`;
    return `${id}: ${felt} ${foer} igen (nu ${nu})`;
}

/**
 * Kompromiserne fra `foer` (projektet før "Lav kampprogram") til `nu`: [{ id, tekst, sti, foer, nu }].
 * tekst: hvad der sker, når kompromiset trækkes tilbage ("Tilbage til 30 min kampe (nu 20 min)").
 * sti: { type: 'opsaetning' | 'dag' | 'raekke' | 'kategori' | 'tidsvindue', … } — det, udenKompromiser() sætter tilbage.
 */
export function kompromiser(foer, nu) {
    if (!foer || !nu) return [];
    const ud = [];
    const tilfoej = (id, tekst, sti, a, b) => ud.push({ id, tekst, sti, foer: a, nu: b });
    const o0 = foer.opsaetning, o1 = nu.opsaetning;
    if (o0.slotMin !== o1.slotMin) {
        // Kamplængden kan også gå et mellemtrin tilbage (Jesper 2026-10-17: "hvorfor ikke 25?"): alle trin på 5 min fra den
        // nuværende hen mod den fra før — standard er den fra før
        const retning = o0.slotMin > o1.slotMin ? 5 : -5;
        const valg = [];
        for (let m = o1.slotMin + retning; retning > 0 ? m <= o0.slotMin : m >= o0.slotMin; m += retning) valg.push(m);
        tilfoej('slotMin', `Tilbage til ${o0.slotMin} min kampe (nu ${o1.slotMin} min)`, { type: 'opsaetning', felt: 'slotMin' }, o0.slotMin, o1.slotMin);
        ud.at(-1).valg = valg;
    }
    if (!ens(o0.pauseMin, o1.pauseMin)) {
        const tekst = erUdenPause(o1.pauseMin) && !erUdenPause(o0.pauseMin) ? 'Pausen tilbage i planen (nu gives den på dagen)' : 'Pausen i planen som før';
        tilfoej('pauseMin', tekst, { type: 'opsaetning', felt: 'pauseMin' }, o0.pauseMin, o1.pauseMin);
    }
    if (!!o0.antiSamtidighed !== !!o1.antiSamtidighed) tilfoej('antiSamtidighed', o0.antiSamtidighed ? 'Single og double må igen ikke ligge samtidig i en række (nu må de)' : 'Single og double må igen ligge samtidig', { type: 'opsaetning', felt: 'antiSamtidighed' }, o0.antiSamtidighed, o1.antiSamtidighed);
    for (const d1 of o1.dage || []) {
        const d0 = (o0.dage || []).find((x) => x.dato === d1.dato);
        if (!d0) continue;
        for (const felt of DAG_FELTER) {
            if (ens(d0[felt], d1[felt])) continue;
            const tekst = felt === 'baner' ? `${kortDato(d1.dato)}: ${d0.baner} baner igen (nu ${d1.baner})` : `${kortDato(d1.dato)}: dagen ${felt === 'slut' ? 'slutter' : 'starter'} igen ${d0[felt]} (nu ${d1[felt]})`;
            tilfoej(`dag|${d1.dato}|${felt}`, tekst, { type: 'dag', dato: d1.dato, felt }, d0[felt], d1[felt]);
        }
    }
    // De gældende vinduer (reglementets med projektets ændringer ovenpå) — ikke de rå felter, der kan mangle
    const tv0 = reglerFor(foer).tidsvindue, tv1 = reglerFor(nu).tidsvindue;
    for (const aargang of new Set([...Object.keys(tv0), ...Object.keys(tv1)])) {
        if (ens(tv0[aargang], tv1[aargang])) continue;
        const v = tv1[aargang];
        const disp = !ens(v, reglerFor({}).tidsvindue[aargang]);
        tilfoej(`tidsvindue|${aargang}`, `${aargang}'s tidsvindue tilbage til ${tv0[aargang]?.join('–') || '–'} (nu ${v?.join('–')}${disp ? ', kræver dispensation' : ''})`, { type: 'tidsvindue', aargang }, tv0[aargang], tv1[aargang]);
    }
    for (const r1 of nu.raekker) {
        const r0 = foer.raekker.find((x) => x.id === r1.id);
        if (!r0) continue;
        for (const felt of RAEKKE_FELTER) if (!ens(r0[felt], r1[felt])) tilfoej(`raekke|${r1.id}|${felt}`, raekkeTekst(r1.id, felt, r0[felt], r1[felt]), { type: 'raekke', id: r1.id, felt }, r0[felt], r1[felt]);
    }
    for (const k1 of nu.kategorier) {
        const k0 = foer.kategorier.find((x) => x.id === k1.id);
        if (!k0) continue;
        for (const felt of KATEGORI_FELTER) {
            if (ens(k0[felt] ?? (felt === 'swissGrupper' ? 1 : undefined), k1[felt] ?? (felt === 'swissGrupper' ? 1 : undefined))) continue;
            // Et fastlåst antal runder, der er det samme, som planneren valgte automatisk før (fx når en Swiss deles i
            // grupper), er ikke givet efter på noget
            if (felt === 'swissRunder' && !(k0.swissRunder > 0) && k1.swissRunder === k0.formForslag?.runder) continue;
            tilfoej(`kategori|${k1.id}|${felt}`, kategoriTekst(k1.id, felt, k0[felt], k1[felt]), { type: 'kategori', id: k1.id, felt }, k0[felt], k1[felt]);
        }
    }
    return ud;
}

/** Projektet med de valgte kompromiser trukket tilbage (opsætningen fra før) og kampene bygget igen. Tider følger kampene. */
export function udenKompromiser(projekt, valgte) {
    let p = projekt;
    for (const k of valgte) {
        const s = k.sti;
        if (s.type === 'opsaetning' && s.felt === 'slotMin') p = saetSlotMin(p, k.foer);
        else if (s.type === 'opsaetning') p = opdaterOpsaetning(p, { [s.felt]: k.foer });
        else if (s.type === 'dag') p = opdaterDag(p, s.dato, { [s.felt]: k.foer });
        else if (s.type === 'raekke') p = opdaterRaekke(p, s.id, { [s.felt]: k.foer });
        else if (s.type === 'kategori') p = opdaterKategori(p, s.id, { [s.felt]: k.foer });
        else if (s.type === 'tidsvindue') {
            const regler = p.opsaetning.regler || {};
            const tidsvindue = { ...(regler.tidsvindue || {}) };
            if (k.foer) tidsvindue[s.aargang] = k.foer; else delete tidsvindue[s.aargang];
            p = opdaterOpsaetning(p, { regler: { ...regler, tidsvindue } });
        }
    }
    return genberegnKampe(p);
}
