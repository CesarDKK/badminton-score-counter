// Nedskæringsforslag: når der er flere kampe, end hallen kan rumme, kan planneren
// foreslå færre Swiss Ladder-runder, så kabalen går op. En plan der holder er
// vigtigere end at alle når reglementets minimum — men valget skal træffes på
// oplyst grundlag: hvert forslag viser, hvilke kategorier der skæres, og hvor
// mange spillere der kommer under kravet.
//
// Fremgangsmåden er afprøvning, ikke skøn: hvert trin bygger kampene og lader
// den rigtige planlægger (lavForslag) lægge dem. Et forslag er først "løst", når
// planlæggeren kan placere alle kampe uden et eneste regelbrud.
import { genberegnKampe, opdaterKategori, opdaterRaekke, reglerFor, delerKapacitet, anvendForslag } from './store.js';
import { lavForslag } from './scheduler.js';
import { effektivForm, minKampeSamlet, sikreKampe, minKampeKrav } from './form.js';
import { tidsvindue } from './rules.js';
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet } from './kapacitet.js';

/** Swiss Ladder skæres aldrig under 2 runder. */
export const MIN_RUNDER = 2;

export const STRATEGIER = [
    { id: 'jaevnt', navn: 'Jævnt fordelt', beskrivelse: 'De kategorier, der har flest runder, mister én runde ad gangen, til alle kampe har lovlig plads. Bagefter gives runder tilbage, hvor der alligevel er plads.' },
    { id: 'skaanSingle', navn: 'Skån singlerne', beskrivelse: 'Double og mix skæres først (ned til 2 runder), og singlerne røres kun, hvis det ikke er nok.' },
    { id: 'toDage', navn: 'To dage i stedet for færre kampe', beskrivelse: 'De rækker, der ikke kan være på én dag, får lov at spille over to dage. Det kræver dispensation efter reglementet, og spillerne skal møde begge dage. Der skæres kun i runderne, hvis det stadig ikke er nok.' },
];

/** Kategorier planneren selv kan skære i: egne Swiss Ladder-kategorier (ikke TP's lodtrækning). */
export function swissKandidater(projekt) {
    return projekt.kategorier.filter((k) => (k.formValg || 'tp') !== 'tp' && effektivForm(k).form === 'swiss');
}

const runderFor = (projekt) => new Map(swissKandidater(projekt).map((k) => [k.id, effektivForm(k).runder]));

function medRunder(projekt, runder) {
    let p = projekt;
    for (const [id, r] of runder) p = opdaterKategori(p, id, { swissRunder: r });
    return genberegnKampe(p);
}

function afproev(projekt) {
    const f = lavForslag(projekt);
    return { f, brud: f.brud.length + f.ikkePlaceret.length };
}

/**
 * Spillere under minimumskravet pr. kategori (samme tælling som Tjek: sikre kampe,
 * og samlet på tværs af kategorier i rækker, hvor kravet tælles samlet).
 * Returnerer Map katId → { krav, faerrest, spillere: [id] }.
 */
export function underKrav(projekt) {
    const regler = reglerFor(projekt);
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const sikre = new Map(projekt.kategorier.map((k) => [k.id, sikreKampe(k, projekt.kampe.filter((x) => x.kategori === k.id))]));
    const ud = new Map();
    for (const k of projekt.kategorier) {
        const r = raekkeMap.get(k.raekke);
        const egne = sikre.get(k.id);
        if (!r || !egne.size) continue;
        const krav = minKampeKrav(k, r, regler);
        const antal = new Map(egne);
        if (minKampeSamlet(r)) for (const [id, andre] of sikre) if (id !== k.id) for (const s of antal.keys()) if (andre.has(s)) antal.set(s, antal.get(s) + andre.get(s));
        ud.set(k.id, { krav, faerrest: Math.min(...antal.values()), spillere: [...antal].filter(([, n]) => n < krav).map(([s]) => s) });
    }
    return ud;
}

/** Hvem der står for tur til at miste en runde. Returnerer [] når der ikke er mere at skære. */
function naesteNed(projekt, runder, brudKategorier, strategi) {
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const ramte = [...brudKategorier].map((id) => katMap.get(id)).filter(Boolean);
    // Kun kategorier, der deler baner (eller række) med de kampe, der ikke fik lovlig plads
    const relevante = [...runder.keys()].map((id) => katMap.get(id)).filter((k) => runder.get(k.id) > MIN_RUNDER
        && ramte.some((x) => x.id === k.id || x.raekke === k.raekke || delerKapacitet(projekt, k, x)));
    const pulje = relevante.length ? relevante : [...runder.keys()].map((id) => katMap.get(id)).filter((k) => runder.get(k.id) > MIN_RUNDER);
    if (!pulje.length) return [];
    let gruppe = pulje;
    if (strategi === 'skaanSingle') { const dobbelt = pulje.filter((k) => k.type !== 'single'); if (dobbelt.length) gruppe = dobbelt; }
    const flest = Math.max(...gruppe.map((k) => runder.get(k.id)));
    return gruppe.filter((k) => runder.get(k.id) === flest).map((k) => k.id);
}

/**
 * Finder en nedskæring efter den givne strategi.
 * Returnerer null, når planlæggeren allerede kan lægge alt uden regelbrud.
 * Ellers: { strategi, navn, beskrivelse, loest, brudFoer, brudEfter, kampeFoer, kampeEfter,
 *           aendringer: [{ kategori, fra, til, kampeFoer, kampeEfter, krav, faerrestFoer, faerrestEfter, underKravFoer, underKravEfter }],
 *           spillereUnderKravFoer, spillereUnderKravEfter, runder: { katId: runder }, ingenKandidater }
 */
export function nedskaeringsForslag(projekt, { strategi = 'jaevnt', maxAfproevninger = 60 } = {}) {
    const info = STRATEGIER.find((s) => s.id === strategi) || STRATEGIER[0];
    const oprindeligt = projekt;
    const foer = afproev(projekt);
    if (!foer.brud) return null;
    const katFor = new Map(projekt.kampe.map((k) => [k.id, k.kategori]));
    // "To dage": de rækker, hvis kampe ikke fik lovlig plads, og som er bundet til færre dage end de har, får dispensation
    let raekkerToDage = [];
    let efterDage = foer;
    if (info.id === 'toDage') {
        const katMap0 = new Map(projekt.kategorier.map((k) => [k.id, k]));
        const ramte = new Set([...foer.f.brud, ...foer.f.ikkePlaceret].map((x) => katMap0.get(katFor.get(x.id))?.raekke));
        raekkerToDage = projekt.raekker.filter((r) => ramte.has(r.id) && r.maxDage && !r.dispensationFlereDage && r.dage.length > r.maxDage).map((r) => r.id);
        if (!raekkerToDage.length) return null; // intet at hente ad den vej
        for (const id of raekkerToDage) projekt = opdaterRaekke(projekt, id, { dispensationFlereDage: true });
        efterDage = afproev(projekt);
    }
    const start = runderFor(projekt);
    const basis = { strategi: info.id, navn: info.navn, beskrivelse: info.beskrivelse, brudFoer: foer.brud, kampeFoer: projekt.kampe.length, raekkerToDage };
    if (efterDage.brud && ![...start.values()].some((r) => r > MIN_RUNDER)) {
        return { ...basis, ingenKandidater: true, loest: false, brudEfter: efterDage.brud, kampeEfter: projekt.kampe.length, aendringer: [], runder: {}, spillereUnderKravFoer: 0, spillereUnderKravEfter: 0 };
    }
    let runder = new Map(start);
    let p = projekt;
    let nu = efterDage;
    let afproevninger = 1;

    // 1) Ned: én runde ad gangen fra dem, der står for tur, til alt har lovlig plads
    while (nu.brud && afproevninger < maxAfproevninger) {
        const brudKat = new Set([...nu.f.brud, ...nu.f.ikkePlaceret].map((x) => katFor.get(x.id) || p.kampe.find((k) => k.id === x.id)?.kategori));
        const ned = naesteNed(p, runder, brudKat, info.id);
        if (!ned.length) break;
        for (const id of ned) runder.set(id, runder.get(id) - 1);
        p = medRunder(projekt, runder);
        nu = afproev(p);
        afproevninger += 1;
    }

    // 2) Giv tilbage: nedskæringen sker i hele trin, så der kan være luft. Prøv at give én runde
    //    tilbage ad gangen (singler først, store kategorier først), så længe planen stadig holder.
    if (!nu.brud) {
        const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
        const orden = [...runder.keys()].filter((id) => runder.get(id) < start.get(id))
            .sort((a, b) => (katMap.get(a).type === 'single' ? 0 : 1) - (katMap.get(b).type === 'single' ? 0 : 1) || (start.get(b) - runder.get(b)) - (start.get(a) - runder.get(a)));
        let aendret = true;
        while (aendret && afproevninger < maxAfproevninger) {
            aendret = false;
            for (const id of orden) {
                if (runder.get(id) >= start.get(id) || afproevninger >= maxAfproevninger) continue;
                const proeve = new Map(runder).set(id, runder.get(id) + 1);
                const p2 = medRunder(projekt, proeve);
                const r2 = afproev(p2);
                afproevninger += 1;
                if (!r2.brud) { runder = proeve; p = p2; nu = r2; aendret = true; }
            }
        }
    }

    const uFoer = underKrav(oprindeligt), uEfter = underKrav(p);
    const aendringer = [...runder].filter(([id, r]) => r !== start.get(id)).map(([id, r]) => ({
        kategori: id, fra: start.get(id), til: r,
        kampeFoer: projekt.kampe.filter((k) => k.kategori === id).length, kampeEfter: p.kampe.filter((k) => k.kategori === id).length,
        krav: uEfter.get(id)?.krav ?? 0, faerrestFoer: uFoer.get(id)?.faerrest ?? 0, faerrestEfter: uEfter.get(id)?.faerrest ?? 0,
        underKravFoer: uFoer.get(id)?.spillere.length ?? 0, underKravEfter: uEfter.get(id)?.spillere.length ?? 0,
    }));
    const alleUnder = (u) => new Set([...u.values()].flatMap((x) => x.spillere)).size;
    return {
        ...basis, loest: nu.brud === 0, brudEfter: nu.brud, kampeEfter: p.kampe.length, aendringer,
        spillereUnderKravFoer: alleUnder(uFoer), spillereUnderKravEfter: alleUnder(uEfter),
        runder: Object.fromEntries(aendringer.map((a) => [a.kategori, a.til])), afproevninger,
    };
}

/** Alle strategier; ens resultater slås sammen. De løste først, derefter færrest spillere under kravet. */
export function alleNedskaeringer(projekt) {
    const ud = [];
    for (const s of STRATEGIER) {
        const f = nedskaeringsForslag(projekt, { strategi: s.id });
        if (!f && s.id !== 'toDage') return [];
        if (s.id === 'toDage' && !f) continue;
        if (!ud.some((x) => JSON.stringify([x.runder, x.raekkerToDage]) === JSON.stringify([f.runder, f.raekkerToDage]))) ud.push(f);
    }
    return ud.sort((a, b) => (b.loest - a.loest) || a.brudEfter - b.brudEfter || a.spillereUnderKravEfter - b.spillereUnderKravEfter || b.kampeEfter - a.kampeEfter);
}

/** Tager forslaget i brug: rundetallene bliver kategoriernes eget valg (kan ses og rettes i fane 1), og planen lægges på ny. */
export function anvendNedskaering(projekt, forslag) {
    let basis = projekt;
    for (const id of forslag.raekkerToDage || []) basis = opdaterRaekke(basis, id, { dispensationFlereDage: true });
    const p = medRunder(basis, new Map(Object.entries(forslag.runder)));
    const f = lavForslag(p);
    return { projekt: anvendForslag(p, f), forslag: f };
}

/**
 * Kapacitetsregnskab i bane-slots (en kamp på hel bane = 1, på halv bane = ½): hvad kampene
 * kræver, og hvad der er af lovlig plads — på de fælles baner og på rækkernes reserverede baner.
 * Pladsen er et loft: i praksis kan planlæggeren bruge ca. 85 %, fordi pauser, rækkefølge og
 * Swiss-runder giver huller.
 * Returnerer { faelles: { behov, plads }, reserveret: [{ raekke, behov, plads, ubrugt }] }.
 */
export function kapacitetsRegnskab(projekt) {
    const { slotMin, dage } = projekt.opsaetning;
    const regler = reglerFor(projekt);
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const egen = (r) => r && r.reserveredeBaner > 0;
    const behov = new Map([['faelles', 0]]);
    for (const k of projekt.kampe) {
        const kat = katMap.get(k.kategori), r = raekkeMap.get(kat?.raekke);
        if (!r) continue;
        const n = egen(r) ? r.id : 'faelles';
        behov.set(n, (behov.get(n) || 0) + (kat.halvBane ? 0.5 : 1));
    }
    const plads = new Map([['faelles', 0]]);
    const faelles = projekt.raekker.filter((r) => !egen(r));
    for (const dag of dage) {
        // Fælles baner tæller i de slots, hvor mindst én række uden egne baner må spille
        const vinduer = faelles.filter((r) => r.dage.includes(dag.dato)).map((r) => {
            const v = tidsvindue(r.aargang, dag, regler);
            return { fra: Math.max(v.fra, r.tidligst ? minutter(r.tidligst) : 0), til: Math.min(v.til, r.senest ? minutter(r.senest) : 9999) };
        });
        for (const slot of slotsForDag(dag, slotMin)) {
            const m = minutter(slot);
            const kap = puljeKapacitet(dag, slot, projekt.raekker);
            if (vinduer.some((v) => m >= v.fra && m + slotMin <= v.til)) plads.set('faelles', plads.get('faelles') + kap.faelles);
            for (const [rid, baner] of kap.reserveret) plads.set(rid, (plads.get(rid) || 0) + baner);
        }
    }
    return {
        faelles: { behov: behov.get('faelles'), plads: plads.get('faelles') },
        reserveret: projekt.raekker.filter(egen).map((r) => ({ raekke: r.id, behov: behov.get(r.id) || 0, plads: plads.get(r.id) || 0, ubrugt: Math.max(0, (plads.get(r.id) || 0) - (behov.get(r.id) || 0)) })),
    };
}
