// Planlæggeren (design § 7.4): grådig listeplanlægning slot for slot.
// Ren funktion: lavForslag(projekt) → { plan, ikkePlaceret, statistik }.
//
// Hårde regler (§ 7.3) håndhæves under placeringen: kapacitet med hele og
// halve baner, én kamp pr. spiller pr. slot, pause (kendte og mulige
// spillere, samme fortolkning som rules.js), afhængigheder, tidsvindue,
// max kampe pr. dag og rækkens dage. Låste kampe (projekt.laast) beholder
// deres tid; alt andet placeres forfra.
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, puljeFor, katKonflikt, baneSlots } from './kapacitet.js';
import { reglerFor } from './store.js';
import { minKampMin, pauseForRaekke, tidsvindue } from './rules.js';

const AARGANG_ORDEN = ['U09', 'U11', 'U13', 'U15', 'U17', 'U19', 'SEN'];

// Hvilken årsag der vises for en kamp, der ikke kunne placeres: den mest sigende vinder.
const AARSAG_RANG = {
    'ingen ledig bane': 6, 'ingen ledig reserveret bane': 6,
    'spiller mangler pause': 5, 'spiller er i en anden kamp i slottet': 5, 'spiller har max kampe den dag': 5,
    'uden for tidsvinduet': 4, 'før rækkens tidligste start': 4, 'efter rækkens seneste slut': 4,
    'rækken spiller ikke den dag': 3, 'single og double samtidig i rækken': 3,
    'bygger på en senere kamp': 2, 'bygger på en kamp uden tid': 1,
};

/**
 * @param {object} projekt
 * @param {{ kunDage?: string[] }} [valg]  begræns forslaget til bestemte dage (andre dage røres ikke)
 */
export function lavForslag(projekt, valg = {}) {
    const { slotMin, pauseMin, dage } = projekt.opsaetning;
    const regler = reglerFor(projekt);
    const kampVarighed = projekt.opsaetning.kampVarighed || 'minimum';
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const laast = new Set(projekt.laast || []);
    const kunDage = valg.kunDage ? new Set(valg.kunDage) : null;
    const enDag = dage.length === 1;
    const maxPrDag = enDag ? regler.maxKampePrDagEnDag : regler.maxKampePrDag;

    const kat = (k) => katMap.get(k.kategori);
    const raekke = (k) => raekkeMap.get(kat(k)?.raekke);
    const varighedFor = (k) => {
        const r = raekke(k);
        return kampVarighed === 'slot' || !r ? slotMin : Math.min(slotMin, minKampMin(r.aargang, r.raekke, regler));
    };
    const pauseFor = (k) => pauseForRaekke(pauseMin, raekke(k)?.pauseKlasse || 'ABCD');

    // ── Prioritet pr. kategori: række (årgang, bogstav) og rækkens rækkefølge (mix → single → double) ──
    const raekkeOrden = [...projekt.raekker].sort((a, b) => {
        const ia = AARGANG_ORDEN.indexOf(a.aargang), ib = AARGANG_ORDEN.indexOf(b.aargang);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.raekke.localeCompare(b.raekke);
    });
    const rang = new Map();
    for (const k of projekt.kategorier) {
        const r = raekkeMap.get(k.raekke);
        const ri = raekkeOrden.findIndex((x) => x.id === k.raekke);
        const orden = r?.raekkefoelge || ['MD', 'HS', 'DS', 'HD', 'DD'];
        let ki = orden.indexOf(k.kat);
        if (ki < 0) ki = orden.length;
        rang.set(k.id, (ri < 0 ? 99 : ri) * 10 + ki);
    }

    // ── Afhængigheder: "bygger på" transitivt, til kanDeleSpillere ──
    const forfaedre = new Map();
    const alleForfaedre = (id, dybde = 0) => {
        if (forfaedre.has(id)) return forfaedre.get(id);
        const set = new Set();
        for (const dep of kampMap.get(id)?.afhaengerAf || []) {
            set.add(dep);
            if (dybde < 50) for (const x of alleForfaedre(dep, dybde + 1)) set.add(x);
        }
        forfaedre.set(id, set);
        return set;
    };
    const kanDeleSpillere = (a, b) => {
        if (a.tpRef.draw !== b.tpRef.draw) return true;
        if (a.fase === 'swiss' && b.fase === 'swiss') return a.runde !== b.runde;
        return alleForfaedre(a.id).has(b.id) || alleForfaedre(b.id).has(a.id);
    };

    // ── Tilstand ──
    const plan = {};                 // kampId → { dag, slot }
    const tidFor = new Map();        // kampId → { dag, min }
    const historik = new Map();      // spillerId → [{ kamp, dag, min, kendt }]
    const kendteKampePrDag = new Map(); // `${spiller}|${dag}` → antal
    const slotBrug = new Map();      // `${dag}|${slot}|${pulje}` → { hele, halve, kampe: [] }
    const slotKampe = new Map();     // `${dag}|${slot}` → [kampe] på tværs af puljer (til anti-samtidighed)
    const antiSamtidighed = projekt.opsaetning.antiSamtidighed !== false;
    const dagMap = new Map(dage.map((d) => [d.dato, d]));
    const kapCache = new Map();      // `${dag}|${slot}` → { faelles, reserveret }
    const kapFor = (dagDato, slot) => {
        const n = `${dagDato}|${slot}`;
        if (!kapCache.has(n)) kapCache.set(n, puljeKapacitet(dagMap.get(dagDato), slot, projekt.raekker));
        return kapCache.get(n);
    };
    // Pulje for en kamp i et slot: rækkens egne reserverede baner eller de fælles
    const puljeForKamp = (k, dagDato, slot) => puljeFor(kat(k)?.raekke, kapFor(dagDato, slot).reserveret);
    const banerIPulje = (dagDato, slot, pulje) => {
        const kap = kapFor(dagDato, slot);
        return pulje === 'faelles' ? kap.faelles : kap.reserveret.get(pulje);
    };

    const brugFor = (dag, slot, pulje = 'faelles') => {
        const n = `${dag}|${slot}|${pulje}`;
        if (!slotBrug.has(n)) slotBrug.set(n, { hele: 0, halve: 0, kampe: [] });
        return slotBrug.get(n);
    };
    const registrer = (k, dag, slot) => {
        const min = minutter(slot);
        plan[k.id] = { dag, slot };
        tidFor.set(k.id, { dag, min });
        const brug = brugFor(dag, slot, puljeForKamp(k, dag, slot));
        if (kat(k)?.halvBane) brug.halve += 1; else brug.hele += 1;
        brug.kampe.push(k);
        const sn = `${dag}|${slot}`;
        if (!slotKampe.has(sn)) slotKampe.set(sn, []);
        slotKampe.get(sn).push(k);
        const kendte = new Set(k.spillere);
        for (const s of k.muligeSpillere) {
            if (!historik.has(s)) historik.set(s, []);
            historik.get(s).push({ kamp: k, dag, min, kendt: kendte.has(s) });
            if (kendte.has(s)) {
                const n = `${s}|${dag}`;
                kendteKampePrDag.set(n, (kendteKampePrDag.get(n) || 0) + 1);
            }
        }
    };

    // Låste kampe (og kampe på dage uden for kunDage) beholder deres tid
    const faste = [];
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (!p) continue;
        const behold = laast.has(k.id) || (kunDage && !kunDage.has(p.dag));
        if (behold && dage.some((d) => d.dato === p.dag)) faste.push({ k, p });
    }
    for (const { k, p } of faste) registrer(k, p.dag, p.slot);

    // ── Kan kampen ligge i dette slot? Returnerer null eller årsag ──
    const aarsagFor = (k, dag, slot, slotStart, baner) => {
        const r = raekke(k);
        if (!r) return 'ingen række';
        if (!r.dage.includes(dag.dato)) return 'rækken spiller ikke den dag';
        // Rækkens eget tidsrum (valgfrit, fx U9 kun 12–17)
        if (r.tidligst && slotStart < minutter(r.tidligst)) return 'før rækkens tidligste start';
        if (r.senest && slotStart + slotMin > minutter(r.senest)) return 'efter rækkens seneste slut';
        const v = tidsvindue(r.aargang, dag, regler);
        if (slotStart < v.fra || slotStart + slotMin > v.til) return 'uden for tidsvinduet';
        // Anti-samtidighed: HS/HD, DS/DD og MD i samme række ikke i samme slot
        if (antiSamtidighed) {
            const egenKat = kat(k);
            for (const x of slotKampe.get(`${dag.dato}|${slot}`) || []) {
                const xk = kat(x);
                if (xk && egenKat && xk.raekke === egenKat.raekke && katKonflikt(egenKat.kat, xk.kat)) return 'single og double samtidig i rækken';
            }
        }
        for (const dep of k.afhaengerAf) {
            const t = tidFor.get(dep);
            if (!t) return 'bygger på en kamp uden tid';
            if (t.dag > dag.dato || (t.dag === dag.dato && t.min >= slotStart)) return 'bygger på en senere kamp';
        }
        const pulje = puljeForKamp(k, dag.dato, slot);
        const brug = brugFor(dag.dato, slot, pulje);
        const halv = !!kat(k)?.halvBane;
        const hele = brug.hele + (halv ? 0 : 1);
        const halve = brug.halve + (halv ? 1 : 0);
        if (hele + Math.ceil(halve / 2) > banerIPulje(dag.dato, slot, pulje)) return pulje === 'faelles' ? 'ingen ledig bane' : 'ingen ledig reserveret bane';
        const varighed = varighedFor(k);
        const pause = pauseFor(k);
        const kendte = new Set(k.spillere);
        for (const s of k.muligeSpillere) {
            if (kendte.has(s) && (kendteKampePrDag.get(`${s}|${dag.dato}`) || 0) >= maxPrDag) return 'spiller har max kampe den dag';
            const h = historik.get(s);
            if (!h) continue;
            for (const x of h) {
                if (x.dag !== dag.dato || !kanDeleSpillere(k, x.kamp)) continue;
                if (x.min === slotStart) return 'spiller er i en anden kamp i slottet';
                const v2 = Math.max(varighed, varighedFor(x.kamp));
                const p2 = Math.max(pause, pauseFor(x.kamp));
                if (Math.abs(x.min - slotStart) < v2 + p2) return 'spiller mangler pause';
            }
        }
        return null;
    };

    // ── Grådig placering ──
    const ventende = projekt.kampe.filter((k) => !plan[k.id]);
    const spilletIDag = new Map(); // dag → Set(spiller) med kendt kamp
    // Andel af kampens spillere, der allerede har spillet i dag. Swiss-runder 2+
    // (uden kendte spillere) bruger de mulige spillere, så en Swiss Ladder, der er
    // i gang, holder tempoet i stedet for at blive strakt ud over dagen. Cupkampe
    // gør ikke (målt: det gav længere haltid og kampe uden plads).
    const spilletAndel = (k, dagSet, dagDato) => {
        if (k.fase === 'swiss' && !k.spillere.length) {
            // Runden er i gang, når forrige runde ligger i dag: alle spillere er i hallen
            return k.afhaengerAf.length && k.afhaengerAf.every((dep) => tidFor.get(dep)?.dag === dagDato) ? 1 : 0;
        }
        if (!k.spillere.length || !dagSet) return 0;
        let n = 0;
        for (const s of k.spillere) if (dagSet.has(s)) n += 1;
        return n / k.spillere.length;
    };
    const aarsager = new Map(); // kampId → seneste årsag

    // Dybde = længden af kæden af kampe, der bygger på denne (puljekampe, der
    // fører til en lang cup, skal tidligt i gang).
    const afhaengige = new Map();
    for (const k of projekt.kampe) for (const dep of k.afhaengerAf) { if (!afhaengige.has(dep)) afhaengige.set(dep, []); afhaengige.get(dep).push(k.id); }
    const dybdeCache = new Map();
    const dybde = (id, niveau = 0) => {
        if (dybdeCache.has(id)) return dybdeCache.get(id);
        let d = 0;
        if (niveau < 60) for (const x of afhaengige.get(id) || []) d = Math.max(d, 1 + dybde(x, niveau + 1));
        dybdeCache.set(id, d);
        return d;
    };
    // Prioritet: liste af nøgler i rækkefølge. Standarden favoriserer spillere,
    // der allerede har spillet i dag (kort haltid), dernæst lange kæder (så
    // sidste kategori ikke løber tør for dag), dernæst rækkens rækkefølge, runde.
    // Målt mod Jespers planer 2026-09-07: haltid 162/138 min mod 206/255,
    // alt placeret — varianten med rækkefølgen først efterlod 5 kampe uden plads.
    // Frist: rækkens seneste sluttid på dagen (eget tidsrum eller årgangens
    // tidsvindue) — tidligste frist først, så fx et U9-vindue 12–17 fyldes med
    // U9, mens U11 med frist 19 venter.
    const fristFor = (k, dagObj) => {
        const r = raekke(k);
        if (!r) return 9999;
        return r.senest ? minutter(r.senest) : tidsvindue(r.aargang, dagObj, regler).til;
    };
    // Fast "tilfældig" nøgle pr. kamp ud fra valg.seed — giver alternative, men
    // reproducerbare forslag (samme seed → samme plan).
    const seed = valg.seed || 0;
    const hashCache = new Map();
    const tilfaeldig = (id) => {
        if (!seed) return 0;
        if (!hashCache.has(id)) {
            let h = 2166136261 ^ seed;
            for (let i = 0; i < id.length; i += 1) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
            hashCache.set(id, h / 4294967296);
        }
        return hashCache.get(id);
    };
    const noegler = {
        frist: (k, dagSet, dagDato, dagObj) => fristFor(k, dagObj),
        prioritet: (k) => -(kat(k)?.prioritet || 0),           // kategoriens forrang (fane 1): høj = 1, lav = -1
        rundeIEvent: (k) => (k.fase === 'pulje' ? k.runde || 0 : 0), // puljerunder synkront: alle R1 før R2 …
        tilfaeldig: (k) => tilfaeldig(k.id),
        rang: (k) => rang.get(k.kategori) ?? 999,
        spillet: (k, dagSet, dagDato) => -spilletAndel(k, dagSet, dagDato),
        dybde: (k) => -dybde(k.id),
        runde: (k) => k.runde || 0,
        gruppe: (k) => k.gruppe || '',
        id: (k) => k.id,
    };
    const synkront = projekt.opsaetning.puljerunderSynkront === true;
    const prioritet = valg.prioritet
        ? ['frist', 'prioritet', ...valg.prioritet.filter((n) => n !== 'frist' && n !== 'prioritet')]
        : ['frist', 'prioritet', ...(synkront ? ['rundeIEvent'] : []), 'spillet', 'dybde', 'rang', 'runde', 'gruppe', 'id'];

    for (const dag of dage) {
        if (kunDage && !kunDage.has(dag.dato)) continue;
        const dagSet = new Set();
        spilletIDag.set(dag.dato, dagSet);
        for (const { k, p } of faste) if (p.dag === dag.dato) for (const s of k.spillere) dagSet.add(s);
        for (const slot of slotsForDag(dag, slotMin)) {
            const kap = kapFor(dag.dato, slot);
            const baner = kap.faelles + [...kap.reserveret.values()].reduce((a, b) => a + b, 0);
            if (!baner) continue;
            const slotStart = minutter(slot);
            // Kandidater i prioriteret rækkefølge
            const kandidater = ventende
                .filter((k) => !plan[k.id])
                .map((k) => ({ k, noegle: prioritet.map((n) => noegler[n](k, dagSet, dag.dato, dag)) }))
                .sort((a, b) => sammenlign(a.noegle, b.noegle));
            for (const { k } of kandidater) {
                const pulje = puljeForKamp(k, dag.dato, slot);
                const brug = brugFor(dag.dato, slot, pulje);
                const fuld = brug.hele + Math.ceil(brug.halve / 2) >= banerIPulje(dag.dato, slot, pulje);
                if (fuld && (brug.halve % 2 === 0 || !kat(k)?.halvBane)) continue; // puljen er fuld (evt. kun en halv bane ledig)
                const aarsag = aarsagFor(k, dag, slot, slotStart, baner);
                if (aarsag) {
                    // Gem den mest sigende årsag (kapacitet og pause frem for "bygger på …")
                    if ((AARSAG_RANG[aarsag] || 0) >= (AARSAG_RANG[aarsager.get(k.id)] || 0)) aarsager.set(k.id, aarsag);
                    continue;
                }
                registrer(k, dag.dato, slot);
                for (const s of k.spillere) dagSet.add(s);
            }
        }
    }

    const ikkePlaceret = ventende.filter((k) => !plan[k.id]).map((k) => ({ id: k.id, aarsag: aarsager.get(k.id) || (raekke(k)?.dage.length ? 'ingen ledig plads' : 'rækken har ingen dage') }));
    // Kampe på dage uden for kunDage, som ikke var låst, beholder også deres tid
    if (kunDage) for (const k of projekt.kampe) if (!plan[k.id] && projekt.plan[k.id] && !kunDage.has(projekt.plan[k.id].dag)) plan[k.id] = projekt.plan[k.id];

    return { plan, ikkePlaceret, statistik: bedoemPlan({ ...projekt, plan }) };
}

function sammenlign(a, b) {
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

/**
 * Bedømmelse af en plan (målfunktionen i § 7.3): haltid pr. spiller (sidste
 * kamp minus første kamp pr. dag, summeret), sluttid pr. dag og kampe uden tid.
 */
export function bedoemPlan(projekt) {
    const slotMin = projekt.opsaetning.slotMin;
    const prSpillerDag = new Map();
    const slutPrDag = new Map();
    let udenTid = 0;
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (!p) { udenTid += 1; continue; }
        const min = minutter(p.slot);
        slutPrDag.set(p.dag, Math.max(slutPrDag.get(p.dag) || 0, min + slotMin));
        for (const s of k.spillere) {
            const n = `${s}|${p.dag}`;
            const x = prSpillerDag.get(n) || { foerste: min, sidste: min, kampe: 0 };
            x.foerste = Math.min(x.foerste, min);
            x.sidste = Math.max(x.sidste, min);
            x.kampe += 1;
            prSpillerDag.set(n, x);
        }
    }
    let haltidMin = 0, spillerDage = 0, ventetid = 0;
    for (const x of prSpillerDag.values()) {
        haltidMin += x.sidste - x.foerste + slotMin;
        ventetid += x.sidste - x.foerste + slotMin - x.kampe * slotMin;
        spillerDage += 1;
    }
    return {
        haltidMin,
        haltidGnsMin: spillerDage ? Math.round(haltidMin / spillerDage) : 0,
        ventetidGnsMin: spillerDage ? Math.round(ventetid / spillerDage) : 0,
        spillerDage,
        slutPrDag: Object.fromEntries([...slutPrDag.entries()].map(([d, m]) => [d, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`])),
        udenTid,
    };
}

// ── Alternative forslag ───────────────────────────────────────

/**
 * De prioriteringer, alternativerne bygges af. Alle er lovlige planer; de
 * adskiller sig i, hvad der vægtes, når flere kampe kan spilles i et slot.
 */
export const ALTERNATIV_VARIANTER = [
    { navn: 'Kortest haltid', beskrivelse: 'Spillere, der allerede er i gang, får deres næste kamp først (standard).', prioritet: ['frist', 'spillet', 'dybde', 'rang', 'runde', 'gruppe', 'id'] },
    { navn: 'Rækkens rækkefølge', beskrivelse: 'Mix, single, double tages færdig i rækkefølge, før nye kategorier starter.', prioritet: ['frist', 'rang', 'spillet', 'dybde', 'runde', 'gruppe', 'id'] },
    { navn: 'Lange kæder først', beskrivelse: 'Puljer, der fører til lange cupper, kommer i gang først.', prioritet: ['frist', 'dybde', 'spillet', 'rang', 'runde', 'gruppe', 'id'] },
    { navn: 'Puljer samlet', beskrivelse: 'Hver pulje spilles færdig i sammenhæng.', prioritet: ['frist', 'spillet', 'gruppe', 'runde', 'rang', 'dybde', 'id'] },
    { navn: 'Puljerunder synkront', beskrivelse: 'Alle puljers runde 1 før runde 2 osv. inden for hvert event.', prioritet: ['frist', 'rundeIEvent', 'spillet', 'dybde', 'rang', 'runde', 'gruppe', 'id'] },
    { navn: 'Variation A', beskrivelse: 'Som "Kortest haltid" med anden rækkefølge blandt ligestillede kampe.', prioritet: ['frist', 'spillet', 'dybde', 'tilfaeldig', 'id'], seed: 11 },
    { navn: 'Variation B', beskrivelse: 'Som "Kortest haltid" med anden rækkefølge blandt ligestillede kampe.', prioritet: ['frist', 'spillet', 'dybde', 'tilfaeldig', 'id'], seed: 23 },
    { navn: 'Variation C', beskrivelse: 'Som "Kortest haltid" med anden rækkefølge blandt ligestillede kampe.', prioritet: ['frist', 'spillet', 'tilfaeldig', 'id'], seed: 37 },
    { navn: 'Variation D', beskrivelse: 'Rækkens rækkefølge med anden rækkefølge blandt ligestillede kampe.', prioritet: ['frist', 'rang', 'spillet', 'tilfaeldig', 'id'], seed: 53 },
];

/**
 * Laver flere forslag med forskellige prioriteringer, fjerner dubletter og
 * sorterer dem bedst først: færrest kampe uden plads, dernæst kortest haltid,
 * dernæst tidligste sluttid. Hvert forslag: { navn, beskrivelse, plan,
 * ikkePlaceret, statistik }. Låste kampe og kunDage respekteres som i lavForslag.
 */
export function lavAlternativer(projekt, valg = {}) {
    const set = new Set();
    const ud = [];
    for (const v of ALTERNATIV_VARIANTER) {
        const f = lavForslag(projekt, { ...valg, prioritet: v.prioritet, seed: v.seed || 0 });
        const noegle = JSON.stringify(Object.entries(f.plan).sort(([a], [b]) => a.localeCompare(b)));
        if (set.has(noegle)) continue;
        set.add(noegle);
        ud.push({ navn: v.navn, beskrivelse: v.beskrivelse, plan: f.plan, ikkePlaceret: f.ikkePlaceret, statistik: f.statistik });
    }
    const slutSum = (s) => Object.values(s.slutPrDag).reduce((sum, t) => sum + minutter(t), 0);
    ud.sort((a, b) => a.ikkePlaceret.length - b.ikkePlaceret.length || a.statistik.haltidMin - b.statistik.haltidMin || slutSum(a.statistik) - slutSum(b.statistik));
    return ud;
}

// ── Løsningsforslag ───────────────────────────────────────────

/**
 * Konkrete forslag ud fra kampe uden plads (fra lavForslag): pr. årsag og dag
 * regnes ud, hvor meget der mangler — flere slots, flere baner, længere
 * tidsrum for rækken eller færre kampe. Returnerer [{ tekst }].
 */
export function loesningsforslag(projekt, ikkePlaceret) {
    if (!ikkePlaceret?.length) return [];
    const { slotMin, dage } = projekt.opsaetning;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const ud = [];
    const grupper = new Map(); // `${aarsag}|${raekke}` → [kamp]
    for (const x of ikkePlaceret) {
        const k = kampMap.get(x.id);
        if (!k) continue;
        const n = `${x.aarsag}|${katMap.get(k.kategori)?.raekke || ''}`;
        if (!grupper.has(n)) grupper.set(n, []);
        grupper.get(n).push(k);
    }
    const plusMin = (klokke, min) => klokkeFraMin(minutter(klokke) + min);
    for (const [n, kampe] of grupper) {
        const [aarsag, raekkeId] = n.split('|');
        const r = raekkeMap.get(raekkeId);
        const halve = kampe.filter((k) => katMap.get(k.kategori)?.halvBane).length;
        const baneSlotsNoedvendige = (kampe.length - halve) + Math.ceil(halve / 2);
        const rDage = (r?.dage || []).map((d) => dage.find((x) => x.dato === d)).filter(Boolean);
        const sidsteDag = rDage[rDage.length - 1];
        const baner = r?.reserveredeBaner || sidsteDag?.baner || 1;
        const slots = Math.ceil(baneSlotsNoedvendige / baner);
        const hvem = `${kampe.length} ${kampe.length === 1 ? 'kamp' : 'kampe'} i ${raekkeId}`;
        if (aarsag === 'efter rækkens seneste slut' || aarsag === 'før rækkens tidligste start') {
            if (r?.senest) ud.push({ tekst: `${hvem}: udvid rækkens tidsrum til ${plusMin(r.senest, slots * slotMin)} (nu ${r.tidligst || '–'}–${r.senest}), eller giv rækken flere reserverede baner.` });
            else ud.push({ tekst: `${hvem}: rækkens tidsrum er for kort — udvid det med ca. ${slots} slots.` });
        } else if (aarsag === 'ingen ledig reserveret bane') {
            ud.push({ tekst: `${hvem}: giv rækken ${Math.ceil(baneSlotsNoedvendige / Math.max(1, rDage.length * 4))} reserverede baner mere, eller udvid dens tidsrum.` });
        } else if (aarsag === 'ingen ledig bane' || aarsag === 'ingen ledig plads' || aarsag === 'uden for tidsvinduet') {
            if (sidsteDag) ud.push({ tekst: `${hvem}: forlæng ${sidsteDag.dato} til ${plusMin(sidsteDag.slut, slots * slotMin)}, tilføj ${Math.ceil(baneSlotsNoedvendige / Math.max(1, baneSlots(sidsteDag, slotMin) / sidsteDag.baner))} bane${baneSlotsNoedvendige > 1 ? 'r' : ''} den dag, eller flyt rækken til en anden dag.` });
            else ud.push({ tekst: `${hvem}: der mangler ${baneSlotsNoedvendige} bane-slots.` });
        } else if (aarsag === 'rækken spiller ikke den dag' || aarsag === 'rækken har ingen dage') {
            ud.push({ tekst: `${hvem}: rækken har ingen dag valgt under "Rækker og kategorier".` });
        } else if (aarsag === 'spiller mangler pause' || aarsag === 'spiller er i en anden kamp i slottet' || aarsag === 'spiller har max kampe den dag') {
            ud.push({ tekst: `${hvem}: spillernes pauser og kampe pr. dag fylder dagen — forlæng dagen, sænk pausen, eller lad rækken spille over flere dage.` });
        } else if (aarsag === 'single og double samtidig i rækken') {
            ud.push({ tekst: `${hvem}: single og double i rækken må ikke ligge samtidig — forlæng dagen, eller slå "undgå single og double samtidig" fra.` });
        } else {
            ud.push({ tekst: `${hvem}: ${aarsag}.` });
        }
    }
    return ud;
}

function klokkeFraMin(min) {
    return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}
