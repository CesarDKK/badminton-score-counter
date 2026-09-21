// Projektstore: projektfilen (design § 6) som rene funktioner. Ingen DOM.
// Persistens (localStorage, JSON-fil) ligger i gem/hent-hjælperne nederst og
// kan bruges fra app.js; alt andet er testbart i Node.
import { planFraTP, minutter } from './tp-reader.js';
import { foreslaaForm, byggKampe, seedTilmeldinger, minKampeSamlet, sikreKampe, formTekst } from './form.js';
import { pladsPaaDag, fordelRaekkerPaaDage, FYLDNINGSGRAD } from './kapacitet.js';
import { lavRegelmodel } from './regelmodel.js';
import { VAEGT_SKABELONER } from './kriterier.js';
import { STANDARD_PAUSE, TIDSVINDUE, STANDARD_REGLER, reglerFor } from './regler.js';

export { STANDARD_PAUSE, TIDSVINDUE, STANDARD_REGLER, reglerFor };

export const PROJEKT_VERSION = 1;
export const GEM_NOEGLE = 'planner.projekt.v1';

const klon = (x) => JSON.parse(JSON.stringify(x));

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

/**
 * Standardrækkefølge inden for en række efter U9/U11-vejledningen ("Det lægger op til denne kamprækkefølge"):
 * U9 og U11: single først, dernæst double og evt. mix. U13 og op: evt. mix først, dernæst double og til sidst single.
 * ('D' er U9's kønsblandede double.)
 */
export const STANDARD_RAEKKEFOELGE = ['MD', 'HD', 'DD', 'D', 'HS', 'DS'];
export const RAEKKEFOELGE_U9_U11 = ['HS', 'DS', 'HD', 'DD', 'D', 'MD'];
export function standardRaekkefoelge(aargang) {
    return [...(aargang === 'U09' || aargang === 'U11' ? RAEKKEFOELGE_U9_U11 : STANDARD_RAEKKEFOELGE)];
}

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
    // Rækker med halve baner (U9) får som standard TP's ekstra-vindue som eget
    // tidsrum og reserverede baner (halve baner / 2, rundet op), så deres kampe
    // ligger samlet på egne baner. Brugeren retter det i fane 1.
    const halve = model.tpGitter.baner?.halve || 0;
    const raekker = model.raekker.map((r) => {
        const rDage = kampDage.has(r.id) ? [...kampDage.get(r.id)].sort() : [...alleDage];
        const harHalvBane = model.kategorier.some((k) => k.raekke === r.id && k.halvBane);
        const ekstra = harHalvBane ? rDage.map((d) => model.tpGitter.dage.find((x) => x.dato === d)?.ekstra).find(Boolean) : null;
        return {
            id: r.id,
            aargang: r.aargang,
            raekke: r.raekke,
            pauseKlasse: r.pauseKlasse,
            dage: rDage,
            dispensationFlereDage: false,
            raekkefoelge: standardRaekkefoelge(r.aargang),
            tidligst: ekstra ? ekstra.fra : null,
            senest: ekstra ? ekstra.til : null,
            // TP's ekstra baner i vinduet er de baner, der deles i halve (Lyngby 2025:
            // 5 af 10 baner kl. 12–16:30); uden vindue gættes ud fra antal halve baner.
            reserveredeBaner: ekstra ? ekstra.baner : (harHalvBane && halve ? Math.ceil(halve / 2) : 0),
            // Hårde regler pr. række som data (rettes i fane 1; null = ingen grænse):
            minKampeSamlet: false, // reglementet stiller minimumskravet pr. kategori (single for sig, double for sig)
            // U9/U11-vejledningen: max 4 (U9) og 6 (U11) timers varighed for afviklingen af singlekampene
            maxHaltidMin: r.aargang === 'U09' ? 240 : r.aargang === 'U11' ? 360 : null,
            maxDage: ['B', 'C', 'D'].includes(r.raekke) || (r.aargang === 'U11' && r.raekke === 'A') ? 1 : null, // reglementet: én dag uden dispensation
        };
    });
    const kategorier = model.kategorier.map((k) => ({
        id: k.id, raekke: k.raekke, aargang: k.aargang, kat: k.kat, type: k.type, mix: k.mix,
        form: k.form, halvBane: k.halvBane, tilmelde: k.tilmeldte, antalKampe: k.kampe, runder: k.runder,
        prioritet: 0, // forrang i forslaget: 1 = høj, 0 = normal, -1 = lav
        swissUdenPause: false, // Swiss Ladder: runder lige efter hinanden uden pause imellem
        formValg: 'tp',        // 'tp' = TP's lodtrækning; ellers bygger planneren selv kampene (form.js)
        cupTop: 1,             // pulje + cup: 1 = vinderne, 2 = de to bedste
        swissRunder: 0,        // Swiss Ladder: valgt antal runder (0 = automatisk, skæres ned efter kapacitet)
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
            antiSamtidighed: false,  // HS/HD, DS/DD og MD i samme række ikke samtidig — fra som standard (Jesper 2026-09-08: gav rene double-spillere lange huller)
            maxVentetidMin: 90,      // Tjek advarer, når en spiller venter længere end dette mellem egne kampe
            puljerunderSynkront: false, // alle puljers runde 1 før runde 2 … (blødt mål i forslaget)
            formKriterie: 'faerrest', // 'faerrest' bane-slots eller 'flest' kampe pr. spiller (form.js)
            vaegte: { ...VAEGT_SKABELONER.standard.vaegte }, // bløde kriterier (kriterier.js) — tunes i fane 1
            vaegtSkabelon: 'standard',
            minKampeSamletV3: true,
            raekkefoelgeV2: true,
            singleVarighedV1: true,
            regler: klon(STANDARD_REGLER),
            pauseMin: { ...STANDARD_PAUSE, faelles: harM && harABCD ? STANDARD_PAUSE.faelles : null },
            dage,
        },
        raekker,
        kategorier,
        spillere: model.spillere,
        kampe: model.kampe,
        tpKampe: model.kampe,                    // TP's egne kampe — bruges når en kategori sættes tilbage til "fra TP"
        tilmeldinger: model.tilmeldinger || {},  // tilmeldinger pr. kategori — til at bygge kampe selv (form.js)
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
 * findes — eller ryddes, hvis valg.behold er false. Det gælder både TP's kampe og dem,
 * planneren selv har bygget. En tid eller lås følger kun med, når kampen stadig er DEN SAMME (overfoerPlan).
 */

/**
 * Hvad der gør en kamp til "den samme": kategori, fase, runde, gruppe og spillere. Kampe uden kendte spillere
 * (Swiss runde 2+, cupkampe) kendes på deres plads i forløbet: plannerens egne på navnet ("Semifinale: Pulje 1 #1 –
 * Pulje 2 #1", "runde 2, kamp 3"), TP's på id'et.
 */
export const kampSignatur = (k) => [k.kategori, k.fase, k.runde, k.gruppe || '', [...k.spillere].sort().join(','), k.spillere.length ? '' : (k.genereret ? k.navn : k.id)].join('|');

/**
 * Fører tider og låse over fra et sæt kampe til et nyt. Kamp-id'erne følger positionen i lodtrækningen, så efter
 * en ny puljeinddeling, et ændret cupTop eller en ny lodtrækning kan samme id dække en helt anden kamp. Derfor
 * følger tiden KAMPEN (signaturen), ikke id'et: samme kamp under nyt id beholder sin tid, og et gammelt id, der
 * nu dækker en anden kamp, mister den.
 * Returnerer { plan, laast, mistet } — mistet = antal tider, der ikke kunne føres over.
 */
export function overfoerPlan(gamleKampe, nyeKampe, plan = {}, laast = []) {
    const gamle = new Map(); // signatur → gamle id'er med tid (flere, hvis to kampe ikke kan skelnes)
    for (const k of gamleKampe) {
        if (!plan[k.id]) continue;
        const sig = kampSignatur(k);
        if (!gamle.has(sig)) gamle.set(sig, []);
        gamle.get(sig).push(k.id);
    }
    const laastSet = new Set(laast);
    const nyPlan = {}, nyLaast = [];
    // Først kampe, der har beholdt deres id, så resten — så to ens kampe ikke bytter tid uden grund
    for (const k of [...nyeKampe.filter((x) => plan[x.id]), ...nyeKampe.filter((x) => !plan[x.id])]) {
        const ids = gamle.get(kampSignatur(k));
        if (!ids?.length) continue;
        const fra = ids.includes(k.id) ? k.id : ids[0];
        ids.splice(ids.indexOf(fra), 1);
        nyPlan[k.id] = plan[fra];
        if (laastSet.has(fra)) nyLaast.push(k.id);
    }
    return { plan: nyPlan, laast: nyLaast, mistet: Object.keys(plan).length - Object.keys(nyPlan).length };
}

export function genindlaes(projekt, model, valg = { behold: true }) {
    const nyt = nytProjekt(model, { tagTiderMed: false });
    const plan = valg.behold ? { ...(projekt.plan || {}) } : {};
    const raekker = nyt.raekker.map((r) => projekt.raekker.find((x) => x.id === r.id) || r);
    const kategorier = nyt.kategorier.map((k) => {
        const gammel = projekt.kategorier.find((x) => x.id === k.id);
        if (!gammel) return k;
        // Har den nye fil en lodtrækning for kategorien, er den lavet i TP → tilbage til "fra TP"
        const harTpKampe = model.kampe.some((x) => x.kategori === k.id);
        return { ...k, halvBane: gammel.halvBane, prioritet: gammel.prioritet || 0, swissUdenPause: !!gammel.swissUdenPause, formValg: harTpKampe ? 'tp' : (gammel.formValg || 'tp'), cupTop: gammel.cupTop || 1, swissRunder: gammel.swissRunder || 0 };
    });
    const dage = nyt.opsaetning.dage.map((d) => projekt.opsaetning.dage.find((x) => x.dato === d.dato) || d);
    // Kun kampe, der stadig er de samme, beholder tid og lås (genberegnKampe fører dem over fra de gamle kampe)
    return genberegnKampe({
        ...nyt,
        opsaetning: { ...projekt.opsaetning, dage },
        raekker,
        kategorier,
        plan,
        vinduer: projekt.vinduer || [],
        kvitteret: projekt.kvitteret || [],
        laast: projekt.laast || [],
    }, { gamleKampe: projekt.kampe });
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
    const kategorier = projekt.kategorier.map((k) => {
        if (k.id !== kategoriId) return k;
        const ny = { ...k, ...aendringer };
        // Kun U9 spiller på halv bane (Jesper 2026-09-09); alle andre altid på hel bane
        if (k.aargang !== 'U09') ny.halvBane = false;
        return ny;
    });
    return { ...projekt, kategorier };
}

/** Sikrer at kun U9-kategorier har halv bane — bruges ved indlæsning af ældre projekter. */
export function normaliserHalvBane(projekt) {
    // Ældre projekter havde "min. kampe tælles samlet" slået til (først for U9, siden for alle rækker). Reglementet
    // stiller kravet pr. kategori, så rækkerne sættes én gang tilbage til det (derefter er det brugerens eget valg).
    if (projekt?.opsaetning && projekt.raekker && !projekt.opsaetning.minKampeSamletV3) {
        projekt = { ...projekt, opsaetning: { ...projekt.opsaetning, minKampeSamletV3: true }, raekker: projekt.raekker.map((r) => ({ ...r, minKampeSamlet: false })) };
    }
    // U11 havde tidligere ingen grænse for singlernes varighed; vejledningen siger 6 timer. Sættes én gang, hvor feltet er tomt.
    if (projekt?.opsaetning && projekt.raekker && !projekt.opsaetning.singleVarighedV1) {
        projekt = { ...projekt, opsaetning: { ...projekt.opsaetning, singleVarighedV1: true }, raekker: projekt.raekker.map((r) => (r.aargang === 'U11' && r.maxHaltidMin == null ? { ...r, maxHaltidMin: 360 } : r)) };
    }
    // Rækkefølgen kan ikke rettes i brugerfladen, så en gemt værdi er altid den gamle standard (mix, single, double):
    // den erstattes én gang af vejledningens rækkefølge for årgangen.
    if (projekt?.opsaetning && projekt.raekker && !projekt.opsaetning.raekkefoelgeV2) {
        projekt = { ...projekt, opsaetning: { ...projekt.opsaetning, raekkefoelgeV2: true }, raekker: projekt.raekker.map((r) => ({ ...r, raekkefoelge: standardRaekkefoelge(r.aargang) })) };
    }
    if (!projekt?.kategorier?.some((k) => k.halvBane && k.aargang !== 'U09')) return projekt;
    return { ...projekt, kategorier: projekt.kategorier.map((k) => (k.aargang !== 'U09' && k.halvBane ? { ...k, halvBane: false } : k)) };
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
    if (!Array.isArray(obj.kampe) || !Array.isArray(obj.opsaetning?.dage)) return 'Projektfilen har et uventet format.';
    // Grundig kontrol af de felter, brugerfladen regner med: en defekt (eller håndlavet) fil må hverken
    // kunne vælte siden eller smugle andet end datoer, klokkeslæt og tal ind, hvor de forventes.
    const erObjekt = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
    const DATO = /^\d{4}-\d{2}-\d{2}$/, KLOKKE = /^([01]\d|2[0-3]):[0-5]\d$/;
    const erKlokke = (x) => typeof x === 'string' && KLOKKE.test(x);
    const erTalEllerTomt = (x) => x === undefined || x === null || (typeof x === 'number' && Number.isFinite(x));
    const fejl = (hvad) => `Projektfilen har et uventet format (${hvad}).`;
    if (!erObjekt(obj.turnering) || !Array.isArray(obj.turnering.dage) || !obj.turnering.dage.every((d) => DATO.test(d))) return fejl('turnering');
    if (obj.kilde !== undefined && !erObjekt(obj.kilde)) return fejl('kilde');
    if (!Number.isFinite(obj.opsaetning.slotMin) || obj.opsaetning.slotMin < 5) return fejl('slotlængde');
    for (const d of obj.opsaetning.dage) {
        if (!erObjekt(d) || !DATO.test(d.dato) || !erKlokke(d.start) || !erKlokke(d.slut) || !erTalEllerTomt(d.baner)) return fejl('spilledage');
        for (const s of d.spaerret || []) if (!erObjekt(s) || !erKlokke(s.fra) || !erKlokke(s.til) || !erTalEllerTomt(s.baner)) return fejl('spærrede baner');
    }
    if (!Array.isArray(obj.raekker) || !Array.isArray(obj.kategorier) || !erObjekt(obj.spillere) || !erObjekt(obj.plan)) return fejl('rækker, kategorier, spillere eller plan');
    for (const r of obj.raekker) {
        if (!erObjekt(r) || typeof r.id !== 'string' || !Array.isArray(r.dage) || !r.dage.every((d) => DATO.test(d))) return fejl('række');
        if ((r.tidligst && !erKlokke(r.tidligst)) || (r.senest && !erKlokke(r.senest))) return fejl(`tidsrum for ${r.id}`);
        if (r.pauseKlasse !== undefined && !['ABCD', 'M', 'E'].includes(r.pauseKlasse)) return fejl(`pauseklasse for ${r.id}`);
        if (!erTalEllerTomt(r.reserveredeBaner) || !erTalEllerTomt(r.maxHaltidMin) || !erTalEllerTomt(r.maxDage)) return fejl(`tal for ${r.id}`);
    }
    for (const k of obj.kategorier) {
        if (!erObjekt(k) || typeof k.id !== 'string' || typeof k.raekke !== 'string') return fejl('kategori');
        if (!erTalEllerTomt(k.tilmeldte) || !erTalEllerTomt(k.kampe) || !erTalEllerTomt(k.runder) || !erTalEllerTomt(k.prioritet) || !erTalEllerTomt(k.swissRunder) || !erTalEllerTomt(k.cupTop)) return fejl(`tal for ${k.id}`);
    }
    for (const k of obj.kampe) {
        if (!erObjekt(k) || typeof k.id !== 'string' || typeof k.kategori !== 'string' || !Array.isArray(k.spillere) || !Array.isArray(k.muligeSpillere) || !Array.isArray(k.afhaengerAf) || !erObjekt(k.tpRef)) return fejl('kamp');
    }
    for (const p of Object.values(obj.plan)) if (!erObjekt(p) || !DATO.test(p.dag) || !erKlokke(p.slot)) return fejl('plan');
    if (obj.laast !== undefined && !Array.isArray(obj.laast)) return fejl('låste kampe');
    return null;
}

// ── Persistens (browser) ──────────────────────────────────────

export function gemLokalt(projekt, storage = globalThis.localStorage) {
    if (!storage) return false;
    try { storage.setItem(GEM_NOEGLE, JSON.stringify(projekt)); return true; } catch { return false; }
}

export function hentLokalt(storage = globalThis.localStorage) {
    return hentLokaltMedStatus(storage).projekt;
}

/** Som hentLokalt, men fortæller også HVORFOR et gemt projekt ikke kunne åbnes: { projekt, fejl }. */
export function hentLokaltMedStatus(storage = globalThis.localStorage) {
    if (!storage) return { projekt: null, fejl: null };
    try {
        const raa = storage.getItem(GEM_NOEGLE);
        if (!raa) return { projekt: null, fejl: null };
        const obj = JSON.parse(raa);
        const fejl = validerProjekt(obj);
        return fejl ? { projekt: null, fejl } : { projekt: normaliserHalvBane(obj), fejl: null };
    } catch (err) { return { projekt: null, fejl: `Det gemte projekt kunne ikke læses (${err.message || err}).` }; }
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

// ── Lås og forslag (fane 2, fase 3) ───────────────────────────

/** Låser eller frigiver en kamp; "Lav forslag" og "Ryd dag" rører ikke låste kampe. */
export function laasKamp(projekt, kampId, vaerdi = true) {
    const set = new Set(projekt.laast || []);
    if (vaerdi && projekt.plan[kampId]) set.add(kampId); else set.delete(kampId);
    return { ...projekt, laast: [...set] };
}

/** Låser eller frigiver alle placerede kampe i en kategori. */
export function laasKategori(projekt, kategoriId, vaerdi = true) {
    const set = new Set(projekt.laast || []);
    for (const k of projekt.kampe) {
        if (k.kategori !== kategoriId) continue;
        if (vaerdi && projekt.plan[k.id]) set.add(k.id); else set.delete(k.id);
    }
    return { ...projekt, laast: [...set] };
}

/** Lægger et forslag fra scheduler.js ind som planen. */
export function anvendForslag(projekt, forslag) {
    return { ...projekt, plan: { ...forslag.plan } };
}

// ── Turneringsform pr. kategori (form.js) ─────────────────────

/**
 * Genberegner projektets kampe: kategorier med formValg 'tp' bruger TP's
 * kampe (tpKampe); de øvrige får kampe bygget af form.js ud fra
 * tilmeldingerne. Tider og låse følger KAMPEN, ikke id'et (overfoerPlan): bygges kampene om — ny
 * puljeinddeling, ændret cupTop, færre runder — beholder de kampe, der stadig er de samme, deres tid, og
 * resten mister den. valg.gamleKampe: de kampe, planen hører til (standard: projektets nuværende).
 */
export function genberegnKampe(projekt, valg = {}) {
    const tp = projekt.tpKampe || projekt.kampe;
    const regler = reglerFor(projekt);
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kriterie = projekt.opsaetning.formKriterie || 'faerrest';
    const seedetFor = (k) => seedTilmeldinger(projekt.tilmeldinger?.[k.id] || [], projekt.spillere, k.kat);
    const byg = (k, ekstra = {}) => {
        const valg = k.formValg || 'tp';
        if (valg === 'tp') return { kampe: tp.filter((x) => x.kategori === k.id), form: null };
        const seedet = seedetFor(k);
        const form = foreslaaForm(seedet.length, k, raekkeMap.get(k.raekke), regler, { form: valg, cupTop: k.cupTop || 1, kriterie, swissRunder: k.swissRunder || 0, deltagere: seedet, ...ekstra });
        return { kampe: byggKampe(k, seedet, form), form };
    };
    // Første pas: alle kategorier uden hensyn til kapacitet
    const foerste = new Map(projekt.kategorier.map((k) => [k.id, byg(k)]));
    // Andet pas: automatiske Swiss-kandidater (formValg auto/swiss uden valgt antal runder) får den
    // kapacitet, der er tilbage, når de øvrige kategorier har fyldt. I rækker, hvor minimumskravet tælles
    // samlet (brugerens valg), får singlerne også spillernes sikre kampe i double/mix med.
    //
    // Resultatet må ikke afhænge af, hvilken rækkefølge kategorierne står i: double/mix afgøres først
    // (singlerne bygger på de endelige doubler), og inden for hver gruppe får kandidaterne FØRST hver sin
    // forholdsmæssige andel af pladsen (alle regnet fra samme udgangspunkt), og DEREFTER — i fast orden,
    // størst først — det, de andre ikke brugte.
    const aktuel = new Map(foerste);
    const autoSwiss = (k) => ['auto', 'swiss'].includes(k.formValg || 'tp') && !(k.swissRunder > 0);
    const samletSingle = (k) => (k.formValg || 'tp') !== 'tp' && k.type === 'single' && minKampeSamlet(raekkeMap.get(k.raekke));
    const kandidater = projekt.kategorier.filter((k) => autoSwiss(k) || samletSingle(k));
    if (kandidater.length) {
        const vaegt = (k) => (k.halvBane ? 0.5 : 1);
        const lastI = (tilstand, k) => tilstand.get(k.id).kampe.length * vaegt(k);
        const raekkeLast = new Map();
        for (const k of projekt.kategorier) raekkeLast.set(k.raekke, (raekkeLast.get(k.raekke) || 0) + lastI(foerste, k));
        const kap = lavKapacitetsmodel(projekt, { raekkeLast });
        const lastUden = (udeladt) => new Map(projekt.kategorier.filter((k) => !udeladt.has(k.id)).map((k) => [k.id, lastI(aktuel, k)]));
        const andreKampeFor = (k) => {
            const ud = new Map();
            for (const k2 of projekt.kategorier) {
                if (k2.id === k.id) continue;
                const r2 = aktuel.get(k2.id);
                for (const [sp, n] of sikreKampe({ ...k2, formForslag: r2.form }, r2.kampe)) ud.set(sp, (ud.get(sp) || 0) + n);
            }
            return ud;
        };
        const bygMed = (k, ledig) => byg(k, { ...(autoSwiss(k) ? { ledigeBaneSlots: ledig } : {}), andreKampe: andreKampeFor(k), samlet: minKampeSamlet(raekkeMap.get(k.raekke)) });
        const fastOrden = (a, b) => lastI(foerste, b) - lastI(foerste, a) || a.id.localeCompare(b.id);
        const resten = (k) => aktuel.set(k.id, bygMed(k, kap.ledig(k, lastUden(new Set([k.id])))));
        const grupper = [kandidater.filter((k) => k.type !== 'single').sort(fastOrden), kandidater.filter((k) => k.type === 'single').sort(fastOrden)];
        for (const gruppe of grupper) {
            // 1) Forholdsmæssig andel: pladsen efter alle ikke-kandidater deles efter behov
            const auto = gruppe.filter(autoSwiss);
            const autoIds = new Set(auto.map((k) => k.id));
            const andel = new Map();
            for (const k of auto) {
                const ialt = kap.ledig(k, lastUden(autoIds));
                const delere = auto.filter((j) => j.id === k.id || delerKapacitet(projekt, k, j));
                const behov = delere.reduce((sum, j) => sum + lastI(foerste, j), 0);
                andel.set(k.id, behov ? (ialt * lastI(foerste, k)) / behov : ialt);
            }
            const delt = new Map(auto.map((k) => [k.id, bygMed(k, andel.get(k.id))]));
            for (const [id, res] of delt) aktuel.set(id, res);
            // 2) Det, de andre ikke brugte — i fast orden
            gruppe.forEach(resten);
        }
        // 3) Til sidst én gang til for alle: double/mix blev vurderet, før singlerne var skåret til, så deres
        //    "der er ikke plads" kan være forældet — og der kan være plads til overs.
        grupper.flat().forEach(resten);
    }
    const kampe = [];
    const kategorier = projekt.kategorier.map((k) => {
        const res = aktuel.get(k.id);
        kampe.push(...res.kampe);
        return { ...k, formForslag: res.form };
    });
    const ids = new Set(kampe.map((k) => k.id));
    const { plan, laast } = overfoerPlan(valg.gamleKampe || projekt.kampe, kampe, projekt.plan || {}, projekt.laast || []);
    return {
        ...projekt,
        kategorier,
        kampe,
        plan,
        laast,
        sidsteForslag: projekt.sidsteForslag ? { ikkePlaceret: (projekt.sidsteForslag.ikkePlaceret || []).filter((x) => ids.has(x.id)) } : projekt.sidsteForslag,
    };
}

/**
 * Efter en ændring af opsætningen (dage, baner, tidsrum, rækkens dage, regler, slotlængde, halv bane): det
 * automatiske formvalg afhænger af pladsen og af reglerne, så kampene bygges på ny — ellers viser fane 1 en
 * form, der er valgt til en hal, der ikke længere findes. Tiderne følger kampene (overfoerPlan).
 * Returnerer { projekt, aendringer: [{ kategori, fra, til }], mistedeTider } så brugeren kan få at vide, hvad der skete.
 */
export function genberegnEfterOpsaetning(foer, nyt) {
    const projekt = genberegnKampe(nyt);
    const gammel = new Map((foer?.kategorier || []).map((k) => [k.id, k.formForslag]));
    const noegle = (f) => (f ? [f.form, f.runder || 0, (f.puljer || []).join(','), f.kampe].join('|') : '');
    const aendringer = projekt.kategorier
        .filter((k) => (k.formValg || 'tp') !== 'tp' && gammel.has(k.id) && noegle(gammel.get(k.id)) !== noegle(k.formForslag))
        .map((k) => ({ kategori: k.id, fra: formTekst(gammel.get(k.id)), til: formTekst(k.formForslag) }));
    const medTid = (p) => Object.keys(p?.plan || {}).length;
    return { projekt, aendringer, mistedeTider: Math.max(0, medTid(nyt) - medTid(projekt)) };
}

/** Sætter turneringsform (og evt. cupTop) for en kategori og genberegner kampene. */
export function saetForm(projekt, kategoriId, aendringer) {
    return genberegnKampe(opdaterKategori(projekt, kategoriId, aendringer));
}

/** Kriterie for automatisk form: 'faerrest' bane-slots eller 'flest' kampe. */
export function opdaterFormKriterie(projekt, kriterie) {
    return genberegnKampe(opdaterOpsaetning(projekt, { formKriterie: kriterie }));
}

// ── Kapacitet til automatisk turneringsform ───────────────────

/**
 * Kapacitet til det automatiske formvalg — bygget på den fælles pladsberegning (kapacitet.js: pladsPaaDag),
 * så formvalget ser samme hal som planlæggeren: kun de slots, hvor rækken må spille (årgangens tidsvindue
 * og rækkens eget tidsrum), rækkens egne baner, hvis den har reserverede, og kun de DAGE, rækken ender på:
 * rækker med max dage fordeles med planlæggerens egen dagfordeling (fordelRaekkerPaaDage), så en række med
 * max 1 dag og to mulige dage får én dags plads — ikke begge lagt sammen.
 *
 * raekkeLast: Map(raekkeId → bane-slots) til dagfordelingen (standard: projektets nuværende kampe).
 * ledig(kategori, andreLast): bane-slots til kategorien, når de andre kategoriers last (Map katId → bane-slots)
 * er trukket fra DAG FOR DAG: en anden række belaster kun de dage, den selv spiller (ligeligt fordelt), og kun
 * med den del af sin plads, der overlapper denne rækkes vindue.
 */
export function lavKapacitetsmodel(projekt, { raekkeLast = null, M = lavRegelmodel(projekt) } = {}) {
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    let last = raekkeLast;
    if (!last) {
        last = new Map();
        for (const k of projekt.kampe) { const kt = katMap.get(k.kategori); if (kt) last.set(kt.raekke, (last.get(kt.raekke) || 0) + (kt.halvBane ? 0.5 : 1)); }
    }
    const dagValg = fordelRaekkerPaaDage(M, projekt, { last });
    const dageFor = (r) => (r.dage || []).filter((d) => !dagValg.has(r.id) || dagValg.get(r.id).has(d)).map((d) => M.dagMap.get(d)).filter(Boolean);
    const husk = new Map();
    const plads = (r, dag, vindueRaekke = null) => {
        const n = `${r.id}|${dag.dato}|${vindueRaekke?.id || ''}`;
        if (!husk.has(n)) husk.set(n, pladsPaaDag(M, r, dag, projekt.raekker, vindueRaekke ? { vindue: M.raekkeVindue(vindueRaekke, dag) } : {}));
        return husk.get(n);
    };
    const ledig = (kategori, andreLast = new Map()) => {
        const r = raekkeMap.get(kategori.raekke);
        if (!r) return 0;
        const rDage = dageFor(r);
        const egne = r.reserveredeBaner > 0;
        const prDag = rDage.map((dag) => {
            let andre = 0;
            for (const [id, l2] of andreLast) {
                const k2 = katMap.get(id);
                if (!l2 || !k2 || id === kategori.id || !delerKapacitet(projekt, kategori, k2)) continue;
                if (k2.raekke === r.id) { andre += l2 / rDage.length; continue; }
                const r2 = raekkeMap.get(k2.raekke), d2 = dageFor(r2);
                if (!d2.includes(dag)) continue;
                const hele = plads(r2, dag).faelles;
                if (hele) andre += (l2 / d2.length) * (plads(r2, dag, r).faelles / hele);
            }
            const p = plads(r, dag);
            return Math.max(0, FYLDNINGSGRAD * (egne ? p.egne : p.faelles) - andre);
        });
        return prDag.reduce((sum, x) => sum + x, 0);
    };
    return { ledig };
}

/** Bane-slots til rådighed for en kategori, før andre kategorier er trukket fra (se lavKapacitetsmodel). */
export function kapacitetTilKategori(projekt, kategori) {
    return lavKapacitetsmodel(projekt).ledig(kategori);
}

/** Deler to kategorier baner? Samme række: ja. Ellers kun hvis ingen af rækkerne har reservation, og de har fælles dage. */
export function delerKapacitet(projekt, a, b) {
    if (a.raekke === b.raekke) return true;
    const ra = projekt.raekker.find((x) => x.id === a.raekke), rb = projekt.raekker.find((x) => x.id === b.raekke);
    if (!ra || !rb) return false;
    if (ra.reserveredeBaner > 0 || rb.reserveredeBaner > 0) return false;
    return (ra.dage || []).some((d) => (rb.dage || []).includes(d));
}

// ── Vægte for de bløde kriterier (kriterier.js) ───────────────

/** Ændrer én vægt; skabelonen markeres som "egen". */
export function opdaterVaegt(projekt, kriterieId, vaerdi) {
    const v = Math.max(0, Number(vaerdi) || 0);
    return opdaterOpsaetning(projekt, { vaegte: { ...VAEGT_SKABELONER.standard.vaegte, ...(projekt.opsaetning.vaegte || {}), [kriterieId]: v }, vaegtSkabelon: 'egen' });
}

/** Vælger en navngiven skabelon med vægte. */
export function saetVaegtSkabelon(projekt, navn) {
    const s = VAEGT_SKABELONER[navn];
    if (!s) return projekt;
    return opdaterOpsaetning(projekt, { vaegte: { ...s.vaegte }, vaegtSkabelon: navn });
}
