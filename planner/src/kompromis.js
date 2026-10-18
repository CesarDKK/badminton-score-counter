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
import { genberegnKampe, saetSlotMin, opdaterOpsaetning, opdaterDag, opdaterRaekke, opdaterKategori, anvendForslag } from './store.js';
import { lavForslag, lavAlternativer, bedoemPlan } from './scheduler.js';
import { tjekPlan } from './rules.js';
import { VARIGHEDER } from './regelmodel.js';
import { erUdenPause } from './kamplaengde.js';
import { FORM_VALG_TEKST } from './form.js';
import { reglerFor } from './regler.js';
import { minutter } from './tp-reader.js';

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
        const alle = [];
        for (let m = o1.slotMin + retning; retning > 0 ? m <= o0.slotMin : m >= o0.slotMin; m += retning) alle.push(m);
        // Låste kampe beholder deres tid: en kamplængde, hvor de ikke passer i gitteret, gør programmet umuligt og gav falsk
        // "kunne bevise, at der ingen plan findes" (gennemgangen 2026-10-17) — de længder tilbydes ikke
        const valg = alle.filter((m) => !laasteUdenForGitter(nu, m));
        const maal = valg.includes(o0.slotMin) ? o0.slotMin : valg.at(-1);
        if (valg.length) {
            tilfoej('slotMin', maal === o0.slotMin ? `Tilbage til ${o0.slotMin} min kampe (nu ${o1.slotMin} min)` : `Kampe på ${maal} min igen (nu ${o1.slotMin} min)`, { type: 'opsaetning', felt: 'slotMin' }, maal, o1.slotMin);
            ud.at(-1).valg = valg;
            ud.at(-1).som = o0.slotMin;
        } else {
            const n = laasteUdenForGitter(nu, o0.slotMin);
            tilfoej('slotMin', `Tilbage til ${o0.slotMin} min kampe (nu ${o1.slotMin} min) — kræver, at ${n} ${n === 1 ? 'låst kamp låses op: den ligger på en tid' : 'låste kampe låses op: de ligger på tider'}, der ikke findes med ${o0.slotMin} min`, { type: 'opsaetning', felt: 'slotMin' }, o0.slotMin, o1.slotMin);
            ud.at(-1).blokeret = true;
        }
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

/** Antal låste kampe, hvis tid ikke findes i gitteret med `slotMin` (fra dagens start i trin på slotMin). */
export function laasteUdenForGitter(projekt, slotMin) {
    const dage = new Map(projekt.opsaetning.dage.map((d) => [d.dato, d]));
    let n = 0;
    for (const id of projekt.laast || []) {
        const p = projekt.plan[id];
        const d = p && dage.get(p.dag);
        if (d && (minutter(p.slot) - minutter(d.start)) % slotMin !== 0) n += 1;
    }
    return n;
}

/** Projektet med de valgte kompromiser trukket tilbage (opsætningen fra før) og kampene bygget igen. Tider følger kampene. */
export function udenKompromiser(projekt, valgte) {
    let p = projekt;
    // Ekstra kampe fra middelvejen (U9/U11) blev kun lagt ind, fordi der var plads med kamplængden og pausen, som de er
    // nu — trækkes de tilbage, prøves programmet med minimum (gennemgangen 2026-10-17)
    if (valgte.some((k) => k.sti.type === 'opsaetning' && ['slotMin', 'pauseMin'].includes(k.sti.felt))) {
        p = { ...p, kategorier: p.kategorier.map((k) => (k.middelvej ? { ...k, middelvej: false } : k)) };
    }
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

const noegleFor = (valgte) => valgte.map((k) => `${k.id}=${JSON.stringify(k.foer)}`).join('&');
const enkel = (valgte, tekst) => ({ noegle: noegleFor(valgte), valgte: valgte.map((k) => ({ id: k.id, foer: k.foer })), tekst, kompromiser: valgte });

/**
 * Programmerne uden kompromiserne, før de er lavet (rækkerne i panelet): ét pr. kompromis — hvert trin for kamplængden
 * ("Kampe på 25 min", "Kampe på 30 min som før") — og "Alt som før", når der er flere. [{ noegle, valgte, tekst, kompromiser }]
 */
export function variantValg(foer, nu) {
    const liste = kompromiser(foer, nu).filter((k) => !k.blokeret);
    const ud = [];
    for (const k of liste) {
        if (k.valg?.length > 1) for (const m of k.valg) ud.push(enkel([{ ...k, foer: m }], `Kampe på ${m} min${m === k.som ? ' som før' : ''} (nu ${k.nu} min)`));
        else ud.push(enkel([k], k.tekst));
    }
    if (liste.length > 1) ud.push(enkel(liste, 'Alt som før'));
    return ud;
}

/**
 * Programmer uden kompromiserne (Jesper 2026-10-17: "vise de planer, der ikke går op, men som er tæt på, og give mulighed
 * for at vælge dem"). For hver række fra variantValg laver planlæggeren et program med kompromiset trukket tilbage, som
 * "Lav kampprogram" gør (det bedste af de alternative forslag). Går flere hver for sig op, prøves de også sammen. Et
 * program med regelbrud kan godt bruges — Tjek viser, hvor reglerne brydes, og løseren kan måske få det til at gå op.
 * Tager ca. et sekund pr. række på en stor turnering, så det regnes i baggrundstråden (kampprogram-worker.js).
 * Returnerer [{ noegle, valgte, tekst, fejl, udenTid, typer: [[type, antal]], slut: { dato: 'tt:mm' }, haltidGnsMin, projekt }],
 * færrest fejl først. Sluttiden og tiden i hallen viser, hvad et program uden kompromiset koster på dagen.
 */
export function lavVarianter(foer, nu) {
    const lav = ({ noegle, valgte, tekst, kompromiser: ks }) => {
        const q = udenKompromiser(nu, ks);
        let bedst = null;
        for (const f of [lavAlternativer(q)[0], lavForslag(q)].filter(Boolean)) {
            const p = anvendForslag(q, f);
            const t = tjekPlan(p);
            if (!bedst || t.antal.fejl < bedst.fejl) bedst = { p, t, fejl: t.antal.fejl, udenTid: f.ikkePlaceret.length };
        }
        const typer = new Map();
        for (const x of bedst.t.problemer) if (x.alvor === 'fejl') typer.set(x.type, (typer.get(x.type) || 0) + 1);
        const s = bedoemPlan(bedst.p);
        return { noegle, valgte, tekst, fejl: bedst.fejl, udenTid: bedst.udenTid, typer: [...typer].sort((a, b) => b[1] - a[1]), slut: s.slutPrDag, haltidGnsMin: s.haltidGnsMin, projekt: bedst.p };
    };
    const valg = variantValg(foer, nu);
    const ud = valg.map(lav);
    // De kompromiser, der hver for sig går op (højst ét trin pr. kompromis), prøves sammen
    const gaarOp = [];
    for (const [i, v] of ud.entries()) if (valg[i].kompromiser.length === 1 && !v.fejl && !v.udenTid && !gaarOp.some((x) => x.kompromiser[0].id === valg[i].kompromiser[0].id)) gaarOp.push(valg[i]);
    if (gaarOp.length > 1) {
        const ks = gaarOp.map((x) => x.kompromiser[0]);
        ud.push(lav(enkel(ks, gaarOp.map((x) => x.tekst.replace(/ \(nu [^)]*\)$/, '')).join(' + '))));
    }
    const set = new Set();
    return ud.filter((v) => !set.has(v.noegle) && set.add(v.noegle)).sort((a, b) => a.fejl - b.fejl || a.udenTid - b.udenTid);
}
