// Kamplængde: hvor lang skal turneringens ene kamplængde (slotlængde i TP) være til netop det program,
// TP-filen indeholder? Ren logik uden DOM.
//
// TP har ÉN kamplængde for hele turneringen, så anbefalingen er et vægtet gennemsnit af programmets
// kampe. Hver kamp får en forventet varighed ud fra sæsondata (årgang, single/double/mix og niveau),
// der lægges skifte og en margen til, og der rundes op til hele 5 min — dog aldrig under reglementets
// minimumstid for rækkerne i programmet (§ 4 stk. 5).
//
// Sæsondata: kampvarighed fra Tournament Software for 78 turneringer aug.–okt. 2026, alle spillet til
// 15 point pr. sæt (formatet fra august 2026). Ældre kampe er spillet til 21 og er markant længere — de
// må ikke bruges her. Varighederne på Tournament Software er de samme som i TP-filens PlayerMatch.duration.
import { minutter, klokkeFraMinutter } from './tp-reader.js';
import { reglerFor, reglementetsPause, INGEN_PAUSE } from './regler.js';
import { minKampMin, erSenior, pauseForRaekke } from './regelmodel.js';
import { banerISlot } from './kapacitet.js';
import { saetSlotMin, genberegnKampe, opdaterOpsaetning } from './store.js';
import { lavForslag } from './scheduler.js';
import { tjekPlan } from './rules.js';

export const SAESONDATA = {
    tekst: 'sæsondata aug.–okt. 2026 (78 turneringer, 15 point pr. sæt)',
    kampe: 15520,
};

/** Gennemsnitlig kampvarighed i minutter pr. årgang og type (sæsondata). */
export const VARIGHED = {
    U09: { single: 19.3, double: 22.1, mix: 22.1 },
    U11: { single: 18.7, double: 23.0, mix: 24.4 },
    U13: { single: 21.0, double: 26.3, mix: 27.8 },
    U15: { single: 23.0, double: 27.5, mix: 26.8 },
    U17: { single: 25.0, double: 27.5, mix: 26.0 },
    U19: { single: 28.3, double: 29.5, mix: 31.5 },
    SEN: { single: 27.4, double: 26.7, mix: 25.2 },
};

/** Tillæg i minutter efter niveau, i forhold til årgangens og typens gennemsnit (sæsondata). */
export const NIVEAU_TILLAEG = { D: -3.5, C: -2.0, B: -0.4, A: 1.5, M: 2.3, E: 4.7 };

/** Tid til at skifte kamp på banen (spillere ud og ind, opvarmning er med i varigheden). */
export const SKIFTE_MIN = 2;

/** Margen oven i gennemsnittet. Sæsondata: dage med kamplængde mindst ca. 5–15 % over gennemsnit + skifte holdt tiden. */
export const MARGEN = 1.10;

const UNGDOM = ['U09', 'U11', 'U13', 'U15', 'U17', 'U19'];

/** Årgangen som nøgle i VARIGHED: 'U07' → 'U09', 'U12' → 'U13', senior og +35 → 'SEN'. */
export function varighedsAargang(aargang) {
    if (!aargang || erSenior(aargang)) return 'SEN';
    const m = /^U(\d{1,2})$/i.exec(aargang);
    if (!m) return 'SEN';
    const n = Number(m[1]);
    return UNGDOM.find((u) => Number(u.slice(1)) >= n) || 'SEN';
}

/** Single, double eller mix for en kategori fra projektet. */
export function kampType(kategori) {
    if (!kategori) return 'single';
    if (kategori.mix || kategori.kat === 'MD') return 'mix';
    return kategori.type === 'double' ? 'double' : 'single';
}

/** Niveau-tillæg for fx 'B', 'CD' (gennemsnit af C og D) eller ukendt (0). */
export function niveauTillaeg(niveau) {
    const bogstaver = String(niveau || '').toUpperCase().split('').filter((b) => b in NIVEAU_TILLAEG);
    if (!bogstaver.length) return 0;
    return bogstaver.reduce((s, b) => s + NIVEAU_TILLAEG[b], 0) / bogstaver.length;
}

/** Forventet varighed (min, uden skifte) for en kamp i en given årgang, niveau og type. */
export function forventetVarighed(aargang, niveau, type) {
    const tabel = VARIGHED[varighedsAargang(aargang)];
    const basis = tabel[type] ?? tabel.single;
    return Math.round((basis + niveauTillaeg(niveau)) * 10) / 10;
}

/** Funktion kamp → forventet varighed (min, uden skifte) for et projekt. */
export function varighedForProjekt(projekt) {
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    return (kamp) => {
        const kat = katMap.get(kamp.kategori);
        const r = raekkeMap.get(kat?.raekke);
        return forventetVarighed(r?.aargang ?? kat?.aargang, r?.raekke, kampType(kat));
    };
}

/**
 * Programmets forventede kamptid: vægtet gennemsnit over alle kampe i projektet, og pr. kategori
 * (til at vise, hvordan gennemsnittet er regnet ud).
 */
export function programVarighed(projekt) {
    const varighed = varighedForProjekt(projekt);
    const prKat = new Map();
    for (const k of projekt.kampe) {
        const x = prKat.get(k.kategori) || { id: k.kategori, antal: 0, minutter: varighed(k) };
        x.antal += 1;
        prKat.set(k.kategori, x);
    }
    const kategorier = [...prKat.values()].sort((a, b) => a.id.localeCompare(b.id, 'da'));
    const antal = kategorier.reduce((s, x) => s + x.antal, 0);
    const sum = kategorier.reduce((s, x) => s + x.antal * x.minutter, 0);
    return { antal, gennemsnit: antal ? Math.round((sum / antal) * 10) / 10 : 0, kategorier };
}

/** Reglementets minimumstid (§ 4 stk. 5) for den strengeste række med kampe i programmet. */
export function reglementMinimum(projekt) {
    const regler = reglerFor(projekt);
    const brugte = new Set(projekt.kampe.map((k) => k.kategori));
    const raekker = new Set(projekt.kategorier.filter((k) => brugte.has(k.id)).map((k) => k.raekke));
    let min = 0;
    for (const r of projekt.raekker) if (raekker.has(r.id)) min = Math.max(min, minKampMin(r.aargang, r.raekke, regler));
    return min;
}

/**
 * Anbefalet kamplængde for hele turneringen: (gennemsnit + skifte) × margen, rundet op til hele
 * 5 min, men aldrig under reglementets minimum for programmets rækker.
 */
export function anbefaletKamplaengde(projekt) {
    const prog = programVarighed(projekt);
    const reglement = reglementMinimum(projekt);
    const ud = prog.antal ? Math.ceil(((prog.gennemsnit + SKIFTE_MIN) * MARGEN) / 5) * 5 : 0;
    return { minutter: Math.max(ud, reglement), fraData: ud, reglement, gennemsnit: prog.gennemsnit, antal: prog.antal, kategorier: prog.kategorier };
}

/** De kamplængder, sammenligningen viser: anbefalet ± 5 og den nuværende, aldrig under reglementets minimum. */
export function kandidatLaengder(projekt) {
    const a = anbefaletKamplaengde(projekt);
    const kandidater = [a.minutter - 5, a.minutter, a.minutter + 5, projekt.opsaetning.slotMin]
        .filter((m) => m >= Math.max(5, a.reglement));
    return [...new Set(kandidater)].sort((x, y) => x - y);
}

/**
 * Simulerer en dag med de forventede kamptider: kampene tages i planens rækkefølge og starter på
 * deres planlagte tid, eller når en bane er ledig og spillerne har haft deres pause — og den kamp, der kan
 * starte tidligst, får den ledige bane (kampene sættes løbende i gang). Pausen er ALTID
 * reglementets (§ 3 stk. 8: spillerne har krav på den), også når planen er lagt med kortere eller ingen
 * pause — på dagen venter kampen så, til spilleren har haft den (Jesper 2026-10-09). Kampen tager
 * den bane, der bliver ledig først (som i hallen). Halve baner (U9-single) deler en hel bane.
 * Returnerer { planSlut, forventetSlut, forsinkelseMax } (klokkeslæt / minutter) eller null.
 */
export function simulerDag(projekt, dato, varighed = varighedForProjekt(projekt)) {
    const dag = projekt.opsaetning.dage.find((d) => d.dato === dato);
    if (!dag) return null;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampe = projekt.kampe
        .filter((k) => projekt.plan[k.id]?.dag === dato)
        .map((k) => ({ k, t: minutter(projekt.plan[k.id].slot), slot: projekt.plan[k.id].slot }))
        .sort((a, b) => a.t - b.t || String(a.k.id).localeCompare(String(b.k.id)));
    if (!kampe.length) return null;
    const slotMin = projekt.opsaetning.slotMin;
    const pauseMin = reglementetsPause(projekt.raekker);
    // Hver hel bane har to halvdele; en hel kamp kræver begge
    const baner = Array.from({ length: Math.max(1, dag.baner) }, () => [0, 0]);
    const spillerFri = new Map();
    const slutPaa = new Map(); // kamp-id → sluttid (til kampe, der bygger på den, fx en finale)
    const ventende = kampe.map((x) => {
        const kat = katMap.get(x.k.kategori);
        return { ...x, kat, pause: pauseForRaekke(pauseMin, raekkeMap.get(kat?.raekke)?.pauseKlasse), ledige: Math.max(1, Math.min(baner.length, banerISlot(dag, x.slot))) };
    });
    // Som i hallen: kampene sættes løbende i gang. Hver gang vælges den kamp, der kan starte tidligst —
    // tidligst på sin planlagte tid, når spillerne har haft deres pause, kampe den bygger på er slut, og en
    // bane (eller halv bane) er ledig. Venter en kamp på en spiller, kan en anden kamp tage banen imens.
    const baneTil = (x) => {
        let valgt = null, halv = 0, fri = Infinity;
        for (let i = 0; i < x.ledige; i += 1) {
            if (x.kat?.halvBane) {
                for (const h of [0, 1]) if (baner[i][h] < fri) { valgt = i; halv = h; fri = baner[i][h]; }
            } else {
                const b = Math.max(baner[i][0], baner[i][1]);
                if (b < fri) { valgt = i; fri = b; }
            }
        }
        return { valgt, halv, fri };
    };
    const klar = (x) => {
        let t = x.t;
        for (const sp of x.k.spillere) if (spillerFri.has(sp)) t = Math.max(t, spillerFri.get(sp) + x.pause);
        for (const id of x.k.afhaengerAf || []) if (slutPaa.has(id)) t = Math.max(t, slutPaa.get(id) + x.pause);
        return t;
    };
    let slut = 0, forsinkelseMax = 0, planSlut = 0;
    while (ventende.length) {
        let bedst = -1, bedstStart = Infinity, bedstBane = null;
        for (let i = 0; i < ventende.length; i += 1) {
            const x = ventende[i];
            if (x.t > bedstStart) break; // listen er sorteret efter planlagt tid — senere kampe kan ikke starte før
            const bane = baneTil(x);
            const start = Math.max(klar(x), bane.fri);
            if (start < bedstStart) { bedst = i; bedstStart = start; bedstBane = bane; }
        }
        const [x] = ventende.splice(bedst, 1);
        const ende = bedstStart + varighed(x.k) + SKIFTE_MIN;
        if (x.kat?.halvBane) baner[bedstBane.valgt][bedstBane.halv] = ende; else baner[bedstBane.valgt] = [ende, ende];
        for (const sp of x.k.spillere) spillerFri.set(sp, ende - SKIFTE_MIN);
        slutPaa.set(x.k.id, ende - SKIFTE_MIN);
        slut = Math.max(slut, ende - SKIFTE_MIN);
        forsinkelseMax = Math.max(forsinkelseMax, bedstStart - x.t);
        planSlut = Math.max(planSlut, x.t + slotMin);
    }
    return { planSlut: klokkeFraMinutter(planSlut), forventetSlut: klokkeFraMinutter(Math.round(slut)), forsinkelseMax: Math.round(forsinkelseMax) };
}

/** Forsinkelse (min), der regnes som "af betydning" i sammenligningen. */
export const FORSINKELSE_GRAENSE = 15;

/** Tjek-advarsler, der er mulige regelbrud: reglen brydes, hvis bestemte spillere går videre (fx cup-finalister). */
export const MULIGE_BRUD = new Set(['pause']);

/**
 * Den kamplængde i en sammenligning, der giver den bedste plan (aftalt med Jesper 2026-10-09):
 * 1) færrest kampe uden tid, 2) færrest regelbrud (Tjeks fejl), 3) mindst forsinkelse ud over
 * FORSINKELSE_GRAENSE, 4) færrest mulige brud (Tjeks pause-advarsler — fx 5 min for lidt pause før
 * en finale, hvis bestemte spillere vinder), 5) kortest tid i hallen. Kan afvige fra anbefalingen,
 * fordi pausereglerne spiller ind (20 min kamp + 10 min pause = 30: med 25-min slots skal en spiller
 * vente to slots mellem sine kampe).
 */
export function bedsteKamplaengde(resultater) {
    // Ved lige: med reglementets pause i planen før uden (den er pænest), så den korteste kamplængde
    // Forsinkelse op til grænsen er ligegyldig; over den tæller hvert minut (104 min er værre end 23)
    const noegle = (r) => [r.udenTid, r.fejl, Math.max(0, r.forsinkelseMax - FORSINKELSE_GRAENSE), r.muligeBrud, r.haltidGnsMin, r.udenPause ? 1 : 0, r.minutter];
    return [...resultater].sort((a, b) => {
        const x = noegle(a), y = noegle(b);
        for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
        return 0;
    })[0] ?? null;
}

/** Er planens pause sat til 0 for alle klasser? */
export function erUdenPause(pauseMin) {
    return !pauseMin.ABCD && !pauseMin.M && !pauseMin.E && !pauseMin.faelles;
}

/**
 * Sammenligner kamplængder: for hver længde bygges kampene på ny (formvalget afhænger af pladsen),
 * planlæggeren laver et forslag, og hver dag simuleres med de forventede kamptider. Hver længde
 * afprøves både med reglementets pause i planen og uden pause (mange klubber fjerner pausen i TP, fordi
 * flowet i hallen giver den) — simuleringen giver altid spillerne reglementets pause, så forsinkelsen
 * viser, hvad det koster på dagen.
 */
export function sammenlignKamplaengder(projekt, laengder = kandidatLaengder(projekt)) {
    const varianter = [];
    for (const min of laengder) for (const udenPause of [false, true]) varianter.push({ min, udenPause });
    const resultater = varianter.map(({ min, udenPause }) => {
        const pauseMin = udenPause ? { ...INGEN_PAUSE } : reglementetsPause(projekt.raekker);
        const p = genberegnKampe(opdaterOpsaetning(saetSlotMin(projekt, min), { pauseMin }));
        const f = lavForslag(p);
        const planlagt = { ...p, plan: f.plan };
        const varighed = varighedForProjekt(planlagt);
        // Regelbrud tælles som Tjek viser dem: fejl er sikre brud, pause-advarsler er mulige brud
        const problemer = tjekPlan(planlagt).problemer;
        const dage = p.opsaetning.dage
            .map((d) => ({ dato: d.dato, ...(simulerDag(planlagt, d.dato, varighed) || {}) }))
            .filter((d) => d.planSlut);
        return {
            minutter: min,
            udenPause,
            pauseMin,
            kampe: p.kampe.length,
            udenTid: f.ikkePlaceret.length,
            fejl: problemer.filter((x) => x.alvor === 'fejl').length,
            muligeBrud: problemer.filter((x) => x.alvor === 'advarsel' && MULIGE_BRUD.has(x.type)).length,
            haltidGnsMin: f.statistik.haltidGnsMin,
            dage,
            forsinkelseMax: dage.reduce((m, d) => Math.max(m, d.forsinkelseMax), 0),
        };
    });
    // Giver "uden pause" præcis samme resultat som "med pause" (fx 30 min: 20 + 10 = 30, pausen er allerede
    // i slottet), vises kun én række — markeret som gældende for begge
    const noegle = (r) => JSON.stringify([r.kampe, r.udenTid, r.fejl, r.muligeBrud, r.haltidGnsMin, r.forsinkelseMax, r.dage]);
    return resultater.filter((r) => {
        if (!r.udenPause) return true;
        const med = resultater.find((x) => x.minutter === r.minutter && !x.udenPause);
        if (med && noegle(med) === noegle(r)) { med.ogsaaUdenPause = true; return false; }
        return true;
    });
}
