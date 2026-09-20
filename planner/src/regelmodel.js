// Regelmodellen: det ENE sted, hvor reglernes byggesten er defineret.
//
// Tjek (rules.js), den hurtige planlægger (scheduler.js) og oversættelsen til løseren
// (solver-klient.js) skal være enige om, hvad en kamp varer, hvilken pause der gælder, hvem der
// kan dele spillere, hvornår en række må spille, og hvor mange baner en håndfuld kampe fylder.
// Før stod de ting tre steder og var gledet fra hinanden (gennemgang 2026-09-20, pakke 2).
// Alt her er rene funktioner uden DOM.
import { minutter } from './tp-reader.js';
import { reglerFor, STANDARD_REGLER } from './store.js';

/** Min. tid pr. kamp (§ 4 stk. 5): standard ungdom ABCD 20, EM 25; senior ABCD 25, EM 30. */
export function minKampMin(aargang, raekke, regler = STANDARD_REGLER) {
    const senior = erSenior(aargang);
    const em = raekke === 'E' || raekke === 'M';
    const m = regler.minKampMin;
    if (senior) return em ? m.seniorEM : m.seniorABCD;
    return em ? m.ungdomEM : m.ungdomABCD;
}

export function erSenior(aargang) {
    return aargang === 'SEN' || /^\+/.test(aargang || '');
}

/** Rækkens pause i minutter ud fra opsætningen (fælles pause erstatter ABCD/M). Ukendt klasse regnes som ABCD. */
export function pauseForRaekke(pauseMin, pauseKlasse) {
    const klasse = pauseKlasse || 'ABCD';
    if (klasse === 'E') return pauseMin.E ?? 20;
    if (pauseMin.faelles != null) return pauseMin.faelles;
    return pauseMin[klasse] ?? (klasse === 'M' ? 15 : 10);
}

/** Er datoen (ISO) dagen før en skoledag? Søndag–torsdag, medmindre andet er sat. */
export function foerSkoledag(dag) {
    if (typeof dag.foerSkoledag === 'boolean') return dag.foerSkoledag;
    const [aar, md, d] = dag.dato.split('-').map(Number);
    const ugedag = new Date(Date.UTC(aar, md - 1, d)).getUTCDay();
    return ugedag !== 5 && ugedag !== 6; // fredag og lørdag er ikke før en skoledag
}

/** Tidsvinduet for en årgang på en dag: { fra, til } i minutter. */
export function tidsvindue(aargang, dag, regler = STANDARD_REGLER) {
    const [fra, til] = regler.tidsvindue[aargang] || regler.tidsvindue.SEN;
    return { fra: minutter(fra), til: minutter(til) - (foerSkoledag(dag) ? Math.round(regler.foerSkoledagTimer * 60) : 0) };
}

/** Reglementets rækker, der kun må spille én dag uden dispensation (B, C, D og U11 A). */
export function standardMaxDage(raekke) {
    return ['B', 'C', 'D'].includes(raekke.raekke) || (raekke.aargang === 'U11' && raekke.raekke === 'A') ? 1 : null;
}

export const FINALERUNDER = new Set(['Kvartfinale', 'Semifinale', 'Finale']);

/** Baner, en gruppe kampe fylder: to kampe på halv bane deler én bane. */
export function banerBrugt(hele, halve) {
    return hele + Math.ceil(halve / 2);
}

/**
 * Bygger regelmodellen for et projekt. Alle tre regel-brugere kalder denne og bruger de samme svar.
 */
export function lavRegelmodel(projekt) {
    const { slotMin, pauseMin, dage } = projekt.opsaetning;
    const regler = reglerFor(projekt);
    const kampVarighed = projekt.opsaetning.kampVarighed || 'minimum';
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const dagMap = new Map(dage.map((d) => [d.dato, d]));
    const kat = (k) => katMap.get(k.kategori);
    const raekke = (k) => raekkeMap.get(kat(k)?.raekke);

    // Hvor lang en kamp regnes for i pausetjekket: et helt slot (streng) eller reglementets
    // minimumstid (som TP — så to 20-min-kampe kan ligge i naboslots ved 30-min slots).
    const varighedFor = (k) => { const r = raekke(k); return kampVarighed === 'slot' || !r ? slotMin : Math.min(slotMin, minKampMin(r.aargang, r.raekke, regler)); };
    const pauseFor = (k) => pauseForRaekke(pauseMin, raekke(k)?.pauseKlasse);
    /** Mindste afstand mellem to kampes STARTTIDER for en fælles spiller: den længste varighed + den længste pause. */
    const mellemrum = (a, b) => ({ varighed: Math.max(varighedFor(a), varighedFor(b)), pause: Math.max(pauseFor(a), pauseFor(b)) });

    // "Bygger på" transitivt. To kampe i samme lodtrækning, hvor den ene ikke bygger på den anden,
    // kan aldrig have fælles spillere (positionerne er forskellige).
    const forfaedre = new Map();
    const alleForfaedre = (id, dybde = 0) => {
        if (forfaedre.has(id)) return forfaedre.get(id);
        const set = new Set();
        forfaedre.set(id, set); // værn mod cyklusser
        for (const dep of kampMap.get(id)?.afhaengerAf || []) {
            set.add(dep);
            if (dybde < 50) for (const x of alleForfaedre(dep, dybde + 1)) set.add(x);
        }
        return set;
    };
    const kanDeleSpillere = (a, b) => {
        if (a.tpRef.draw !== b.tpRef.draw) return true;
        if (a.fase === 'swiss' && b.fase === 'swiss') return a.runde !== b.runde;
        return alleForfaedre(a.id).has(b.id) || alleForfaedre(b.id).has(a.id);
    };

    /** Hvornår rækken må spille en dag: årgangens tidsvindue og (valgfrit) rækkens eget tidsrum. */
    const aargangsVindue = (r, dag) => tidsvindue(r.aargang, dag, regler);
    const raekkeVindue = (r, dag) => {
        const v = aargangsVindue(r, dag);
        return { fra: Math.max(v.fra, r.tidligst ? minutter(r.tidligst) : 0), til: Math.min(v.til, r.senest ? minutter(r.senest) : 24 * 60) };
    };
    /** Kan en kamp starte kl. `min` — hele slottet skal ligge inden for vinduet. */
    const iVindue = (v, min) => min >= v.fra && min + slotMin <= v.til;

    /** Rækkens grænse for antal spilledage: null = ingen (også ved dispensation). Ældre projekter uden feltet får reglementets standard. */
    const maxDageFor = (r) => {
        if (r.dispensationFlereDage) return null;
        const max = r.maxDage !== undefined ? r.maxDage : standardMaxDage(r);
        return max || null;
    };

    // ── E-rækker og senior: regler om, HVILKEN dag og tid en kamp må ligge ──
    const sidsteDag = dage.map((d) => d.dato).sort().at(-1);
    const erFinalerunde = (k) => k.fase === 'cup' && FINALERUNDER.has(k.rundeNavn);
    /** Senior E/M: max kampe pr. kategori pr. dag; semifinale og finale må dele dag, men kvartfinalen skal ligge en tidligere dag. */
    const seniorEM = (r) => !!r && erSenior(r.aargang) && (r.raekke === 'E' || r.raekke === 'M');
    /** Kan rækken komme til at spille over flere dage? (bruges af planlægger og løser; Tjek ser på den faktiske plan) */
    const kanSpilleFlereDage = (r) => (r.dage || []).length > 1 && maxDageFor(r) !== 1;
    /**
     * Må kampen ligge på denne dag (og starte kl. min)? Returnerer null eller årsagen.
     *  - E-rækker: på turneringens sidste dag kun semifinaler og finaler (når turneringen har flere dage),
     *    og E-finaler skal starte i finalevinduet (regler.eFinale).
     *  - Senior A/B over flere dage: på finaledagen kun kvart-, semi- og finaler.
     */
    const kampForbud = (k, dato, min = null, { flereDage } = {}) => {
        const r = raekke(k);
        if (!r) return null;
        if (r.raekke === 'E') {
            if (dage.length > 1 && dato === sidsteDag && !(k.fase === 'cup' && (k.rundeNavn === 'Semifinale' || k.rundeNavn === 'Finale'))) return 'E-række: kun semifinaler og finaler på sidste dag';
            if (k.rundeNavn === 'Finale' && min !== null && (min < minutter(regler.eFinale[0]) || min > minutter(regler.eFinale[1]))) return 'E-finale uden for finalevinduet';
        }
        if (erSenior(r.aargang) && (r.raekke === 'A' || r.raekke === 'B') && (flereDage ?? kanSpilleFlereDage(r)) && dato === sidsteDag && !erFinalerunde(k)) return 'senior A/B: kun kvart-, semi- og finaler på finaledagen';
        return null;
    };

    return {
        sidsteDag, erFinalerunde, seniorEM, kanSpilleFlereDage, kampForbud,
        regler, slotMin, pauseMin, dage, dagMap, katMap, raekkeMap, kampMap, kat, raekke,
        enDag: dage.length === 1,
        maxPrDag: dage.length === 1 ? regler.maxKampePrDagEnDag : regler.maxKampePrDag,
        // Valgfri regel; ældre projekter uden feltet har den slået fra (som nye projekter)
        antiSamtidighed: projekt.opsaetning.antiSamtidighed === true,
        varighedFor, pauseFor, mellemrum, alleForfaedre, kanDeleSpillere,
        aargangsVindue, raekkeVindue, iVindue, maxDageFor,
    };
}
