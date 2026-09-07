// Projektstore: projektfilen (design § 6) som rene funktioner. Ingen DOM.
// Persistens (localStorage, JSON-fil) ligger i gem/hent-hjælperne nederst og
// kan bruges fra app.js; alt andet er testbart i Node.
import { planFraTP, minutter } from './tp-reader.js';

export const PROJEKT_VERSION = 1;
export const GEM_NOEGLE = 'planner.projekt.v1';

/** Reglementets standardpauser (§ 4 stk. 5). "faelles" bruges når M og ABCD spiller i samme turnering. */
export const STANDARD_PAUSE = { ABCD: 10, M: 15, E: 20, faelles: 12 };

/** Tidsvinduer i programmet pr. årgang (§ 4 stk. 5.1): start–slut. */
export const TIDSVINDUE = {
    U09: ['09:00', '19:00'], U11: ['09:00', '19:00'],
    U13: ['09:00', '20:00'], U15: ['09:00', '20:00'],
    U17: ['09:00', '21:00'], U19: ['09:00', '21:00'], SEN: ['09:00', '21:00'],
};

/**
 * Reglementets grænser som parametre (design § 5: "alle grænser er parametre med
 * reglementets værdi som standard"). Ligger i projekt.opsaetning.regler og kan
 * ændres i fane 1; manglende felter i ældre projekter falder tilbage på disse.
 */
export const STANDARD_REGLER = {
    tidsvindue: TIDSVINDUE,          // pr. årgang: [start, slut]
    foerSkoledagTimer: 2,            // så mange timer tidligere slutter vinduet dagen før en skoledag
    maxKampePrDag: 10,               // ved flere dage
    maxKampePrDagEnDag: 12,          // ved én dag
    minKampMin: { ungdomABCD: 20, ungdomEM: 25, seniorABCD: 25, seniorEM: 30 },
    eFinale: ['10:00', '13:00'],       // E-finaler skal ligge i dette vindue
    seniorMaxPrKategori: 3,          // senior E/M: max kampe pr. kategori pr. dag
    minKampe: { MA: 2, BCDSingle: 3, BCDDouble: 2, U9U11Single: 4, swissRunder: 4 },
};

const klon = (x) => JSON.parse(JSON.stringify(x));

/** Reglerne for et projekt: standard med projektets ændringer lagt ovenpå. */
export function reglerFor(projekt) {
    const egne = projekt?.opsaetning?.regler || {};
    return {
        ...STANDARD_REGLER,
        ...egne,
        tidsvindue: { ...STANDARD_REGLER.tidsvindue, ...(egne.tidsvindue || {}) },
        minKampMin: { ...STANDARD_REGLER.minKampMin, ...(egne.minKampMin || {}) },
        minKampe: { ...STANDARD_REGLER.minKampe, ...(egne.minKampe || {}) },
    };
}

/** Ændrer én grænse: sti som "maxKampePrDag", "minKampMin.ungdomABCD" eller "tidsvindue.U11.1". */
export function opdaterRegler(projekt, sti, vaerdi) {
    const regler = reglerFor(projekt);
    const dele = sti.split('.');
    let m = regler;
    for (const d of dele.slice(0, -1)) { m[d] = Array.isArray(m[d]) ? [...m[d]] : { ...m[d] }; m = m[d]; }
    m[dele.at(-1)] = vaerdi;
    return { ...projekt, opsaetning: { ...projekt.opsaetning, regler } };
}

/** Sætter alle grænser og pauser tilbage til reglementet. */
export function nulstilRegler(projekt) {
    const harM = projekt.raekker.some((r) => r.raekke === 'M');
    const harABCD = projekt.raekker.some((r) => r.pauseKlasse === 'ABCD');
    return { ...projekt, opsaetning: { ...projekt.opsaetning, regler: klon(STANDARD_REGLER), pauseMin: { ...STANDARD_PAUSE, faelles: harM && harABCD ? STANDARD_PAUSE.faelles : null } } };
}

/** Standardrækkefølge inden for en række: mix, single, double (Jespers ønske). */
export const STANDARD_RAEKKEFOELGE = ['MD', 'HS', 'DS', 'HD', 'DD'];

function senesteSlut(aargange) {
    let slut = '19:00';
    for (const a of aargange) {
        const v = TIDSVINDUE[a] || TIDSVINDUE.SEN;
        if (minutter(v[1]) > minutter(slut)) slut = v[1];
    }
    return slut;
}

/**
 * Bygger et nyt projekt fra en læst TP-model.
 * @param {object} model  fra laesTP()
 * @param {{tagTiderMed: boolean}} valg  "tag tidsplanen med" eller "kun spillere og kampe"
 */
export function nytProjekt(model, valg = { tagTiderMed: false }) {
    const aargange = new Set(model.raekker.map((r) => r.aargang));
    const slutStandard = senesteSlut(aargange);
    const dage = model.turnering.dage.map((dato) => {
        const g = model.tpGitter.dage.find((d) => d.dato === dato) || {};
        return {
            dato,
            start: g.start || '09:00',
            slut: g.slut || slutStandard,
            baner: g.baner || model.tpGitter.baner.hele || 10,
            spaerret: [],
        };
    });
    const plan = valg.tagTiderMed ? planFraTP(model) : {};

    // Rækkens dage: fra TP's tider hvis de tages med, ellers alle dage (brugeren vælger).
    const kampDage = new Map();
    for (const k of model.kampe) {
        if (!plan[k.id]) continue;
        const kat = model.kategorier.find((x) => x.id === k.kategori);
        if (!kat) continue;
        if (!kampDage.has(kat.raekke)) kampDage.set(kat.raekke, new Set());
        kampDage.get(kat.raekke).add(plan[k.id].dag);
    }
    const alleDage = dage.map((d) => d.dato);
    const raekker = model.raekker.map((r) => ({
        id: r.id,
        aargang: r.aargang,
        raekke: r.raekke,
        pauseKlasse: r.pauseKlasse,
        dage: kampDage.has(r.id) ? [...kampDage.get(r.id)].sort() : [...alleDage],
        dispensationFlereDage: false,
        raekkefoelge: [...STANDARD_RAEKKEFOELGE],
    }));
    const kategorier = model.kategorier.map((k) => ({
        id: k.id, raekke: k.raekke, aargang: k.aargang, kat: k.kat, type: k.type, mix: k.mix,
        form: k.form, halvBane: k.halvBane, tilmelde: k.tilmeldte, antalKampe: k.kampe, runder: k.runder,
    }));

    const harM = model.raekker.some((r) => r.raekke === 'M');
    const harABCD = model.raekker.some((r) => r.pauseKlasse === 'ABCD');

    return {
        version: PROJEKT_VERSION,
        kilde: { ...model.kilde, tagTiderMed: !!valg.tagTiderMed },
        turnering: { navn: model.turnering.navn, hal: model.turnering.hal, dage: alleDage },
        opsaetning: {
            slotMin: model.tpGitter.slotMin || 30,
            kampVarighed: 'minimum', // 'minimum' = reglementets minimumstid (som TP), 'slot' = et helt slot
            regler: klon(STANDARD_REGLER),
            pauseMin: { ...STANDARD_PAUSE, faelles: harM && harABCD ? STANDARD_PAUSE.faelles : null },
            dage,
        },
        raekker,
        kategorier,
        spillere: model.spillere,
        kampe: model.kampe,
        plan,
        vinduer: [],
        kvitteret: [],
        laast: [],
        tpGitter: model.tpGitter,
        bemaerkninger: model.bemaerkninger || [],
    };
}

/**
 * Genindlæser en (nyere) TP-fil i et eksisterende projekt: opsætning og
 * rækker bevares, kampe udskiftes, og planen beholdes for de kampe der stadig
 * findes (tpRef) — eller ryddes, hvis valg.behold er false.
 */
export function genindlaes(projekt, model, valg = { behold: true }) {
    const nyt = nytProjekt(model, { tagTiderMed: false });
    const gamleIds = new Set(projekt.kampe.map((k) => k.id));
    const plan = {};
    if (valg.behold) {
        for (const k of model.kampe) if (gamleIds.has(k.id) && projekt.plan[k.id]) plan[k.id] = { ...projekt.plan[k.id] };
    }
    const raekker = nyt.raekker.map((r) => projekt.raekker.find((x) => x.id === r.id) || r);
    const kategorier = nyt.kategorier.map((k) => {
        const gammel = projekt.kategorier.find((x) => x.id === k.id);
        return gammel ? { ...k, halvBane: gammel.halvBane } : k;
    });
    const dage = nyt.opsaetning.dage.map((d) => projekt.opsaetning.dage.find((x) => x.dato === d.dato) || d);
    return {
        ...nyt,
        opsaetning: { ...projekt.opsaetning, dage },
        raekker,
        kategorier,
        plan,
        vinduer: projekt.vinduer || [],
        kvitteret: projekt.kvitteret || [],
        laast: (projekt.laast || []).filter((id) => plan[id]),
    };
}

/** Sætter slotlængden (5-min trin, mindst 5). */
export function saetSlotMin(projekt, slotMin) {
    const v = Math.max(5, Math.round(Number(slotMin) / 5) * 5);
    return { ...projekt, opsaetning: { ...projekt.opsaetning, slotMin: v } };
}

export function opdaterDag(projekt, dato, aendringer) {
    const dage = projekt.opsaetning.dage.map((d) => (d.dato === dato ? { ...d, ...aendringer } : d));
    return { ...projekt, opsaetning: { ...projekt.opsaetning, dage } };
}

export function opdaterRaekke(projekt, raekkeId, aendringer) {
    const raekker = projekt.raekker.map((r) => (r.id === raekkeId ? { ...r, ...aendringer } : r));
    return { ...projekt, raekker };
}

export function opdaterKategori(projekt, kategoriId, aendringer) {
    const kategorier = projekt.kategorier.map((k) => (k.id === kategoriId ? { ...k, ...aendringer } : k));
    return { ...projekt, kategorier };
}

/** Generel ændring af opsætningen (fx kampVarighed). */
export function opdaterOpsaetning(projekt, aendringer) {
    return { ...projekt, opsaetning: { ...projekt.opsaetning, ...aendringer } };
}

export function opdaterPause(projekt, klasse, min) {
    const v = min === null || min === '' ? null : Math.max(0, Number(min) || 0);
    return { ...projekt, opsaetning: { ...projekt.opsaetning, pauseMin: { ...projekt.opsaetning.pauseMin, [klasse]: v } } };
}

/** Kontrollerer at et JSON-objekt ligner en projektfil. Returnerer fejlbesked eller null. */
export function validerProjekt(obj) {
    if (!obj || typeof obj !== 'object') return 'Filen er ikke et planner-projekt.';
    if (obj.version !== PROJEKT_VERSION) return `Projektfilen har version ${obj.version}; denne udgave forstår version ${PROJEKT_VERSION}.`;
    for (const felt of ['turnering', 'opsaetning', 'raekker', 'kategorier', 'spillere', 'kampe', 'plan']) {
        if (!(felt in obj)) return `Projektfilen mangler "${felt}".`;
    }
    if (!Array.isArray(obj.kampe) || !Array.isArray(obj.opsaetning.dage)) return 'Projektfilen har et uventet format.';
    return null;
}

// ── Persistens (browser) ──────────────────────────────────────

export function gemLokalt(projekt, storage = globalThis.localStorage) {
    if (!storage) return false;
    try { storage.setItem(GEM_NOEGLE, JSON.stringify(projekt)); return true; } catch { return false; }
}

export function hentLokalt(storage = globalThis.localStorage) {
    if (!storage) return null;
    try {
        const raa = storage.getItem(GEM_NOEGLE);
        if (!raa) return null;
        const obj = JSON.parse(raa);
        return validerProjekt(obj) ? null : obj;
    } catch { return null; }
}

export function rydLokalt(storage = globalThis.localStorage) {
    try { storage?.removeItem(GEM_NOEGLE); } catch { /* ignorer */ }
}

/** Filnavn til eksport af projektfilen. */
export function projektFilnavn(projekt) {
    const navn = (projekt.turnering.navn || 'turnering').replace(/[^\wæøåÆØÅ -]+/g, '').trim() || 'turnering';
    const dag = projekt.turnering.dage[0] || '';
    return `${navn}${dag ? ' ' + dag : ''}.planner.json`;
}

// ── Planen (fane 2) ───────────────────────────────────────────

/** Lægger en kamp i et slot (eller flytter den). */
export function flytKamp(projekt, kampId, dag, slot) {
    return { ...projekt, plan: { ...projekt.plan, [kampId]: { dag, slot } } };
}

/** Fjerner kampens tid, så den ligger i "ikke placeret". */
export function fjernFraPlan(projekt, kampId) {
    const plan = { ...projekt.plan };
    delete plan[kampId];
    return { ...projekt, plan, laast: (projekt.laast || []).filter((id) => id !== kampId) };
}

/** Rydder alle tider på en dag (låste kampe bliver). */
export function rydDag(projekt, dag) {
    const laast = new Set(projekt.laast || []);
    const plan = {};
    for (const [id, p] of Object.entries(projekt.plan)) if (p.dag !== dag || laast.has(id)) plan[id] = p;
    return { ...projekt, plan };
}

/** Kvitterer en advarsel (noegle fra rules.js), eller fjerner kvitteringen igen. */
export function kvitter(projekt, noegle, vaerdi = true) {
    const set = new Set(projekt.kvitteret || []);
    if (vaerdi) set.add(noegle); else set.delete(noegle);
    return { ...projekt, kvitteret: [...set] };
}
