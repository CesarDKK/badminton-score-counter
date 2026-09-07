// Planlæggeren (design § 7.4): grådig listeplanlægning slot for slot.
// Ren funktion: lavForslag(projekt) → { plan, ikkePlaceret, statistik }.
//
// Hårde regler (§ 7.3) håndhæves under placeringen: kapacitet med hele og
// halve baner, én kamp pr. spiller pr. slot, pause (kendte og mulige
// spillere, samme fortolkning som rules.js), afhængigheder, tidsvindue,
// max kampe pr. dag og rækkens dage. Låste kampe (projekt.laast) beholder
// deres tid; alt andet placeres forfra.
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, puljeFor } from './kapacitet.js';
import { reglerFor } from './store.js';
import { minKampMin, pauseForRaekke, tidsvindue } from './rules.js';

const AARGANG_ORDEN = ['U09', 'U11', 'U13', 'U15', 'U17', 'U19', 'SEN'];

// Hvilken årsag der vises for en kamp, der ikke kunne placeres: den mest sigende vinder.
const AARSAG_RANG = {
    'ingen ledig bane': 6, 'ingen ledig reserveret bane': 6,
    'spiller mangler pause': 5, 'spiller er i en anden kamp i slottet': 5, 'spiller har max kampe den dag': 5,
    'uden for tidsvinduet': 4, 'før rækkens tidligste start': 4, 'efter rækkens seneste slut': 4,
    'rækken spiller ikke den dag': 3,
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
    const noegler = {
        frist: (k, dagSet, dagDato, dagObj) => fristFor(k, dagObj),
        rang: (k) => rang.get(k.kategori) ?? 999,
        spillet: (k, dagSet, dagDato) => -spilletAndel(k, dagSet, dagDato),
        dybde: (k) => -dybde(k.id),
        runde: (k) => k.runde || 0,
        gruppe: (k) => k.gruppe || '',
        id: (k) => k.id,
    };
    const prioritet = valg.prioritet || ['frist', 'spillet', 'dybde', 'rang', 'runde', 'gruppe', 'id'];

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
