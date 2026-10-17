// Kompromiser undervejs (Jesper 2026-10-17): det, der er givet efter for at få programmet til at gå op — kortere kampe,
// pausen givet på dagen, længere dag, rækkens tidsrum, flere reserverede baner, dispensationer, Swiss i grupper, færre
// runder … — skal kunne trækkes tilbage, så løseren kan prøve igen. Løseren er stærkere end planlæggeren og finder måske
// et program uden kompromiset.
//
// Kompromiserne findes ved at sammenligne opsætningen fra før "Lav kampprogram" (kp.foer) med den nuværende — så de
// også omfatter valg på kortene og kamplængden, uden at hvert valg skal huske sig selv. Rene funktioner uden DOM.
import { genberegnKampe, saetSlotMin, opdaterOpsaetning, opdaterDag, opdaterRaekke, opdaterKategori } from './store.js';
import { VARIGHEDER } from './regelmodel.js';
import { erUdenPause } from './kamplaengde.js';
import { FORM_VALG_TEKST } from './form.js';
import { reglerFor } from './regler.js';

const ens = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const kortDato = (d) => `${d.slice(8, 10)}/${Number(d.slice(5, 7))}`;

/** Felterne på rækker og kategorier, der kan være givet efter på (beregnede felter som formForslag tæller ikke). */
const RAEKKE_FELTER = ['dage', 'tidligst', 'senest', 'reserveredeBaner', 'dispensationFlereDage', 'maxHaltidMin', 'maxDoubleMin', 'maxRaekkeMin', 'maxDage'];
const KATEGORI_FELTER = ['formValg', 'swissRunder', 'swissGrupper', 'cupTop'];
const DAG_FELTER = ['start', 'slut', 'baner'];

function raekkeTekst(id, felt, foer, nu) {
    const v = VARIGHEDER.find((x) => x.felt === felt);
    if (v) return nu == null ? `${id}: ingen grænse for ${v.kort} (før ${foer} min)` : `${id}: max ${nu} min for ${v.kort} (før ${foer ?? 'ingen grænse'})`;
    if (felt === 'senest') return `${id} må spille til ${nu || '–'} (før ${foer || '–'})`;
    if (felt === 'tidligst') return `${id} må starte ${nu || '–'} (før ${foer || '–'})`;
    if (felt === 'reserveredeBaner') return `${id}: ${nu} reserverede baner (før ${foer || 0})`;
    if (felt === 'dispensationFlereDage') return nu ? `${id}: dispensation til flere dage` : `${id}: uden dispensation til flere dage`;
    if (felt === 'dage') return `${id} spiller ${(nu || []).map(kortDato).join(' og ') || 'ingen dage'} (før ${(foer || []).map(kortDato).join(' og ') || 'ingen'})`;
    if (felt === 'maxDage') return `${id}: max ${nu ?? 'ingen grænse for'} dage (før ${foer ?? 'ingen grænse'})`;
    return `${id}: ${felt} ${nu} (før ${foer})`;
}

function kategoriTekst(id, felt, foer, nu) {
    if (felt === 'swissGrupper') return nu > 1 ? `${id} i ${nu} Swiss-grupper` : `${id} som én Swiss Ladder (før ${foer} grupper)`;
    if (felt === 'swissRunder') return `${id}: ${nu || 'automatisk antal'} runder (før ${foer || 'automatisk'})`;
    if (felt === 'formValg') return `${id}: ${FORM_VALG_TEKST[nu] || nu} (før ${FORM_VALG_TEKST[foer] || foer})`;
    if (felt === 'cupTop') return `${id}: cup for ${nu === 2 ? 'de to bedste' : 'vinderne'}`;
    return `${id}: ${felt} ${nu} (før ${foer})`;
}

/**
 * Kompromiserne fra `foer` (projektet før "Lav kampprogram") til `nu`: [{ id, tekst, sti, foer, nu }].
 * sti: { type: 'opsaetning' | 'dag' | 'raekke' | 'kategori' | 'tidsvindue', … } — det, udenKompromiser() sætter tilbage.
 */
export function kompromiser(foer, nu) {
    if (!foer || !nu) return [];
    const ud = [];
    const tilfoej = (id, tekst, sti, a, b) => ud.push({ id, tekst, sti, foer: a, nu: b });
    const o0 = foer.opsaetning, o1 = nu.opsaetning;
    if (o0.slotMin !== o1.slotMin) tilfoej('slotMin', `Kamplængde ${o1.slotMin} min (før ${o0.slotMin} min)`, { type: 'opsaetning', felt: 'slotMin' }, o0.slotMin, o1.slotMin);
    if (!ens(o0.pauseMin, o1.pauseMin)) {
        const tekst = erUdenPause(o1.pauseMin) && !erUdenPause(o0.pauseMin) ? 'Pausen gives på dagen (0 min i planen)' : 'Pausen i planen er ændret';
        tilfoej('pauseMin', tekst, { type: 'opsaetning', felt: 'pauseMin' }, o0.pauseMin, o1.pauseMin);
    }
    if (!!o0.antiSamtidighed !== !!o1.antiSamtidighed) tilfoej('antiSamtidighed', o1.antiSamtidighed ? 'Single og double må ikke ligge samtidig' : 'Single og double må ligge samtidig', { type: 'opsaetning', felt: 'antiSamtidighed' }, o0.antiSamtidighed, o1.antiSamtidighed);
    for (const d1 of o1.dage || []) {
        const d0 = (o0.dage || []).find((x) => x.dato === d1.dato);
        if (!d0) continue;
        for (const felt of DAG_FELTER) {
            if (ens(d0[felt], d1[felt])) continue;
            const tekst = felt === 'baner' ? `${kortDato(d1.dato)}: ${d1.baner} baner (før ${d0.baner})` : `${kortDato(d1.dato)}: dagen ${felt === 'slut' ? 'slutter' : 'starter'} ${d1[felt]} (før ${d0[felt]})`;
            tilfoej(`dag|${d1.dato}|${felt}`, tekst, { type: 'dag', dato: d1.dato, felt }, d0[felt], d1[felt]);
        }
    }
    // De gældende vinduer (reglementets med projektets ændringer ovenpå) — ikke de rå felter, der kan mangle
    const tv0 = reglerFor(foer).tidsvindue, tv1 = reglerFor(nu).tidsvindue;
    for (const aargang of new Set([...Object.keys(tv0), ...Object.keys(tv1)])) {
        if (ens(tv0[aargang], tv1[aargang])) continue;
        const v = tv1[aargang];
        tilfoej(`tidsvindue|${aargang}`, `${aargang}'s tidsvindue ${v[0]}–${v[1]} (før ${tv0[aargang]?.join('–') || '–'}${ens(v, reglerFor({}).tidsvindue[aargang]) ? '' : '; kræver dispensation'})`, { type: 'tidsvindue', aargang }, tv0[aargang], tv1[aargang]);
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
