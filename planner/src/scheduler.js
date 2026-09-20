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
import { lavRegelmodel, banerBrugt, pauseForRaekke } from './regelmodel.js';
import { scorePlan } from './kriterier.js';

const AARGANG_ORDEN = ['U09', 'U11', 'U13', 'U15', 'U17', 'U19', 'SEN'];

// Hvilken årsag der vises for en kamp, der ikke kunne placeres: den mest sigende vinder.
const AARSAG_RANG = {
    'ingen ledig bane': 6, 'ingen ledig reserveret bane': 6,
    'spiller mangler pause': 5, 'spiller over max haltid': 5, 'rækken må ikke spille flere dage': 3, 'spiller er i en anden kamp i slottet': 5, 'spiller har max kampe den dag': 5,
    'uden for tidsvinduet': 4, 'E-række: kun semifinaler og finaler på sidste dag': 4, 'E-finale uden for finalevinduet': 4, 'senior A/B: kun kvart-, semi- og finaler på finaledagen': 4,
    'kvart-, semi- og finale samme dag': 4, 'spiller har max kampe i kategorien den dag': 5, 'rækken er lagt på en anden dag': 3,
    'før rækkens tidligste start': 4, 'efter rækkens seneste slut': 4,
    'rækken spiller ikke den dag': 3, 'single og double samtidig i rækken': 3,
    'bygger på en senere kamp': 2, 'bygger på en kamp uden tid': 1,
};

/**
 * @param {object} projekt
 * @param {{ kunDage?: string[] }} [valg]  begræns forslaget til bestemte dage (andre dage røres ikke)
 */
export function lavForslag(projekt, valg = {}) {
    let bedst = lavForslagEnGang(projekt, valg);
    const mangler = (f) => f.brud.length + f.ikkePlaceret.length;
    if (!mangler(bedst) || valg.dagTvang || valg.udenDagforsoeg) return bedst;
    // Dagfordelingen af én-dags-rækker er et skøn. Giver den regelbrud, prøves de ramte rækker på deres
    // andre mulige dage (de øvrige rækker holdes fast), og det bedste resultat vinder. Højst 6 ekstra forsøg.
    const katRaekke = new Map(projekt.kategorier.map((k) => [k.id, k.raekke]));
    const kampKat = new Map(projekt.kampe.map((k) => [k.id, k.kategori]));
    const prRaekke = new Map();
    for (const x of [...bedst.brud, ...bedst.ikkePlaceret]) { const rid = katRaekke.get(kampKat.get(x.id)); prRaekke.set(rid, (prRaekke.get(rid) || 0) + 1); }
    const kunDage = valg.kunDage ? new Set(valg.kunDage) : null;
    const ramte = [...prRaekke].sort((a, b) => b[1] - a[1]).map(([rid]) => projekt.raekker.find((r) => r.id === rid)).filter((r) => r && bedst.dagValg[r.id]);
    let forsoeg = 0;
    for (const r of ramte.slice(0, 3)) {
        const andre = r.dage.filter((d) => !bedst.dagValg[r.id].includes(d) && projekt.opsaetning.dage.some((x) => x.dato === d) && (!kunDage || kunDage.has(d)));
        for (const dato of andre) {
            if (forsoeg >= 6) return bedst;
            forsoeg += 1;
            const f = lavForslagEnGang(projekt, { ...valg, dagTvang: { ...bedst.dagValg, [r.id]: [dato] } });
            if (mangler(f) < mangler(bedst)) bedst = f;
            if (!mangler(bedst)) return bedst;
        }
    }
    return bedst;
}

/** Ét gennemløb af planlæggeren. valg.dagTvang = { raekkeId: [datoer] } fastlægger én-dags-rækkers dage. */
function lavForslagEnGang(projekt, valg = {}) {
    // Reglernes byggesten kommer fra regelmodellen — de samme, som Tjek og løseren bruger
    const M = lavRegelmodel(projekt);
    const { slotMin, dage, raekkeMap, kat, raekke, varighedFor, kanDeleSpillere, maxPrDag } = M;
    const laast = new Set(projekt.laast || []);
    const kunDage = valg.kunDage ? new Set(valg.kunDage) : null;


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

    // ── Tilstand ──
    const plan = {};                 // kampId → { dag, slot }
    const tidFor = new Map();        // kampId → { dag, min }
    const historik = new Map();      // spillerId → [{ kamp, dag, min, kendt }]
    const kendteKampePrDag = new Map(); // `${spiller}|${dag}` → antal
    const katKampePrDag = new Map();    // `${spiller}|${kategori}|${dag}` → antal (senior E/M: max pr. kategori pr. dag)
    const finalerunderPrDag = new Map(); // `${kategori}|${dag}` → Set(rundeNavn) for cup-finalerunder
    const slotBrug = new Map();      // `${dag}|${slot}|${pulje}` → { hele, halve, kampe: [] }
    const swissSpaend = new Map();   // `${draw}|${dag}` → { foerste, sidste } — Swiss-rundernes spænd til max haltid
    const raekkeDage = new Map();    // raekkeId → Set(dage rækken allerede spiller på) — til maxDage
    const slotKampe = new Map();     // `${dag}|${slot}` → [kampe] på tværs af puljer (til anti-samtidighed)
    const antiSamtidighed = M.antiSamtidighed;
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
        // Rækker med reserverede baner bruger deres egne først; er de fulde, løber kampen over på de
        // fælles baner og bogføres dér (samme regel som Tjek: kapacitet.js banebrugISlot)
        let pulje = puljeForKamp(k, dag, slot);
        const erHalv = !!kat(k)?.halvBane;
        if (pulje !== 'faelles') {
            const egen = brugFor(dag, slot, pulje);
            if (banerBrugt(egen.hele + (erHalv ? 0 : 1), egen.halve + (erHalv ? 1 : 0)) > (banerIPulje(dag, slot, pulje) || 0)) pulje = 'faelles';
        }
        const brug = brugFor(dag, slot, pulje);
        if (erHalv) brug.halve += 1; else brug.hele += 1;
        brug.kampe.push(k);
        const sn = `${dag}|${slot}`;
        if (!slotKampe.has(sn)) slotKampe.set(sn, []);
        slotKampe.get(sn).push(k);
        if (k.fase === 'swiss') {
            const n = `${k.tpRef.draw}|${dag}`;
            const x = swissSpaend.get(n) || { foerste: min, sidste: min };
            x.foerste = Math.min(x.foerste, min); x.sidste = Math.max(x.sidste, min);
            swissSpaend.set(n, x);
        }
        if (M.erFinalerunde(k)) { const fn = `${k.kategori}|${dag}`; if (!finalerunderPrDag.has(fn)) finalerunderPrDag.set(fn, new Set()); finalerunderPrDag.get(fn).add(k.rundeNavn); }
        const rid = kat(k)?.raekke;
        if (rid) { if (!raekkeDage.has(rid)) raekkeDage.set(rid, new Set()); raekkeDage.get(rid).add(dag); }
        const kendte = new Set(k.spillere);
        for (const s of k.muligeSpillere) {
            if (!historik.has(s)) historik.set(s, []);
            historik.get(s).push({ kamp: k, dag, min, kendt: kendte.has(s) });
            if (kendte.has(s)) {
                const n = `${s}|${dag}`;
                kendteKampePrDag.set(n, (kendteKampePrDag.get(n) || 0) + 1);
                const kn = `${s}|${k.kategori}|${dag}`;
                katKampePrDag.set(kn, (katKampePrDag.get(kn) || 0) + 1);
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

    // ── Dagfordeling: rækker med max dage fordeles på dagene, FØR kampene lægges ──
    // Den grådige placering fylder op forfra, så uden en fordeling ender alle én-dags-rækker
    // på første dag, mens de øvrige dage står tomme. Rækkerne fordeles efter belastning, størst
    // først: til den første dag, hvor rækken kan være uden at dagen fyldes over 85 %, ellers til
    // den dag, der har mest plads tilbage. Dage, rækken allerede har faste kampe på, tæller med.
    // Rækker med reserverede baner vurderes mod deres EGNE baner. valg.dagTvang fastlægger dagene.
    const raekkeDagValg = new Map(); // raekkeId → Set(dato)
    {
        const muligeDage = (r) => dage.filter((d) => r.dage.includes(d.dato) && (!kunDage || kunDage.has(d.dato)));
        const FYLD = 0.85; // samme pakkefaktor som kapacitetTilKategori i store.js
        // Plads til rækken på en dag: fælles bane-slots inden for årgangens tidsvindue og rækkens eget tidsrum
        const pladsFor = (r, d) => {
            const v = M.raekkeVindue(r, d);
            return FYLD * slotsForDag(d, slotMin).reduce((sum, slot) => (M.iVindue(v, minutter(slot)) ? sum + kapFor(d.dato, slot).faelles : sum), 0);
        };
        const brugt = new Map(dage.map((d) => [d.dato, 0]));
        const egenPladsFor = (r, d) => {
            const v = M.raekkeVindue(r, d);
            return FYLD * slotsForDag(d, slotMin).reduce((sum, slot) => (M.iVindue(v, minutter(slot)) ? sum + (kapFor(d.dato, slot).reserveret.get(r.id) || 0) : sum), 0);
        };
        const harEgne = (r) => r.reserveredeBaner > 0;
        const rest = { get: (dato, r) => (harEgne(r) ? egenPladsFor(r, dagMap.get(dato)) : pladsFor(r, dagMap.get(dato)) - brugt.get(dato)) };
        const last = new Map(); // raekkeId → bane-slots (på de fælles baner, eller på rækkens egne)
        for (const k of projekt.kampe) {
            const r = raekke(k);
            if (!r) continue;
            last.set(r.id, (last.get(r.id) || 0) + (kat(k)?.halvBane ? 0.5 : 1));
        }
        const bundne = projekt.raekker.filter((r) => M.maxDageFor(r) && muligeDage(r).length > M.maxDageFor(r));
        // Rækker uden grænse breder sig over deres dage
        for (const r of projekt.raekker) {
            if (bundne.includes(r) || !last.has(r.id) || harEgne(r)) continue; // rækker med egne baner belaster ikke de fælles
            const md = muligeDage(r);
            for (const d of md) brugt.set(d.dato, brugt.get(d.dato) + last.get(r.id) / md.length);
        }
        const foretruk = (a, b) => a.dato.localeCompare(b.dato);
        for (const r of [...bundne].sort((a, b) => (last.get(b.id) || 0) - (last.get(a.id) || 0) || a.id.localeCompare(b.id))) {
            const maxDage = M.maxDageFor(r);
            const tvang = (valg.dagTvang?.[r.id] || []).filter((d) => muligeDage(r).some((x) => x.dato === d));
            const valgte = new Set([...(raekkeDage.get(r.id) || []), ...tvang].slice(0, maxDage));
            const behov = (last.get(r.id) || 0) / maxDage;
            const kandidater = muligeDage(r).filter((d) => !valgte.has(d.dato)).sort(foretruk);
            while (valgte.size < maxDage && kandidater.length) {
                const passer = kandidater.find((d) => rest.get(d.dato, r) >= behov);
                const dag = passer || [...kandidater].sort((a, b) => rest.get(b.dato, r) - rest.get(a.dato, r) || foretruk(a, b))[0];
                kandidater.splice(kandidater.indexOf(dag), 1);
                valgte.add(dag.dato);
            }
            if (!harEgne(r)) for (const d of valgte) brugt.set(d, brugt.get(d) + (last.get(r.id) || 0) / valgte.size);
            raekkeDagValg.set(r.id, valgte);
        }
    }

    // ── Kan kampen ligge i dette slot? Returnerer null eller årsag ──
    // lemp = lempelser i fase 2 (se nedenfor): hvilke regler der må brydes for
    // at få kampen placeret. sidsteGab sættes, når pausen brydes, til det
    // faktiske mellemrum (minutter efter kampens varighed) — bruges i forslagene.
    let sidsteGab = null;
    const aarsagFor = (k, dag, slot, slotStart, baner, lemp = {}) => {
        const r = raekke(k);
        if (!r) return 'ingen række';
        if (!lemp.dag && !r.dage.includes(dag.dato)) return 'rækken spiller ikke den dag';
        // Max dage pr. række (hård regel som data): en ny dag må kun tages i brug, hvis grænsen ikke er nået
        if (!lemp.dag && raekkeDagValg.has(r.id) && !raekkeDagValg.get(r.id).has(dag.dato)) return 'rækken er lagt på en anden dag';
        if (!lemp.dag && M.maxDageFor(r)) {
            const brugte = raekkeDage.get(r.id);
            if (brugte && !brugte.has(dag.dato) && brugte.size >= M.maxDageFor(r)) return 'rækken må ikke spille flere dage';
        }
        // Rækkens eget tidsrum (valgfrit, fx U9 kun 12–17)
        if (!lemp.tidsrum) {
            if (r.tidligst && slotStart < minutter(r.tidligst)) return 'før rækkens tidligste start';
            if (r.senest && slotStart + slotMin > minutter(r.senest)) return 'efter rækkens seneste slut';
        }
        const v = M.aargangsVindue(r, dag);
        if (!lemp.tidsvindue && (slotStart < v.fra || slotStart + slotMin > v.til)) return 'uden for tidsvinduet';
        // E-rækker og senior: hvilken dag og tid kampen må ligge (samme byggesten som Tjek og løseren)
        if (!lemp.tidsvindue) {
            const forbud = M.kampForbud(k, dag.dato, slotStart);
            if (forbud) return forbud;
            // Senior E/M: kvart-, semi- og finale ikke alle samme dag = finalen ikke samme dag som en kvartfinale
            if (M.seniorEM(r) && k.rundeNavn === 'Finale' && (finalerunderPrDag.get(`${k.kategori}|${dag.dato}`) || new Set()).has('Kvartfinale')) return 'kvart-, semi- og finale samme dag';
        }
        // Max haltid for Swiss Ladder: alle er med i hver runde, så rundernes samlede spænd tæller
        if (!lemp.maxHaltid && k.fase === 'swiss' && r.maxHaltidMin) {
            const x = swissSpaend.get(`${k.tpRef.draw}|${dag.dato}`);
            if (x && Math.max(x.sidste, slotStart) - Math.min(x.foerste, slotStart) + slotMin > r.maxHaltidMin) return 'spiller over max haltid';
        }
        // Anti-samtidighed: HS/HD, DS/DD og MD i samme række ikke i samme slot
        if (antiSamtidighed && !lemp.antiSamtidighed) {
            const egenKat = kat(k);
            for (const x of slotKampe.get(`${dag.dato}|${slot}`) || []) {
                const xk = kat(x);
                if (xk && egenKat && xk.raekke === egenKat.raekke && katKonflikt(egenKat.kat, xk.kat)) return 'single og double samtidig i rækken';
            }
        }
        if (!lemp.afhaengighed) for (const dep of k.afhaengerAf) {
            const t = tidFor.get(dep);
            if (!t) return 'bygger på en kamp uden tid';
            if (t.dag > dag.dato || (t.dag === dag.dato && t.min >= slotStart)) return 'bygger på en senere kamp';
        }
        if (!lemp.kapacitet) {
            const pulje = puljeForKamp(k, dag.dato, slot);
            const halv = !!kat(k)?.halvBane;
            if (lemp.reserveret) {
                // Overløb: egne reserverede baner først, ellers en fri fælles bane (aldrig andre rækkers reserverede)
                const puljer = [...new Set([pulje, 'faelles'])];
                const plads = puljer.some((pl) => {
                    const b = brugFor(dag.dato, slot, pl);
                    return banerBrugt(b.hele + (halv ? 0 : 1), b.halve + (halv ? 1 : 0)) <= (banerIPulje(dag.dato, slot, pl) || 0);
                });
                if (!plads) return 'ingen ledig bane';
            } else {
                const brug = brugFor(dag.dato, slot, pulje);
                const hele = brug.hele + (halv ? 0 : 1);
                const halve = brug.halve + (halv ? 1 : 0);
                if (banerBrugt(hele, halve) > banerIPulje(dag.dato, slot, pulje)) return pulje === 'faelles' ? 'ingen ledig bane' : 'ingen ledig reserveret bane';
            }
        }
        const kendte = new Set(k.spillere);
        let mindsteGab = null;
        for (const s of k.muligeSpillere) {
            if (!lemp.maxHaltid && (kendte.has(s) || k.fase === 'swiss')) {
                // Max haltid (hård regel som data, fx U9 240 min): første til sidste kamp samme dag —
                // de kendte kampe og Swiss-runderne i spillerens lodtrækninger (alle er med i hver runde)
                let graense = r.maxHaltidMin || null, foerste = slotStart, sidste = slotStart;
                for (const x of historik.get(s) || []) {
                    if (x.dag !== dag.dato || !(x.kendt || x.kamp.fase === 'swiss')) continue;
                    const g = raekke(x.kamp)?.maxHaltidMin;
                    if (g && (!graense || g < graense)) graense = g;
                    if (x.min < foerste) foerste = x.min;
                    if (x.min > sidste) sidste = x.min;
                }
                if (graense && sidste - foerste + slotMin > graense) return 'spiller over max haltid';
            }
            if (!lemp.maxKampe && kendte.has(s) && (kendteKampePrDag.get(`${s}|${dag.dato}`) || 0) >= maxPrDag) return 'spiller har max kampe den dag';
            if (!lemp.maxKampe && kendte.has(s) && M.seniorEM(r) && (katKampePrDag.get(`${s}|${k.kategori}|${dag.dato}`) || 0) >= M.regler.seniorMaxPrKategori) return 'spiller har max kampe i kategorien den dag';
            const h = historik.get(s);
            if (!h) continue;
            for (const x of h) {
                if (x.dag !== dag.dato || !kanDeleSpillere(k, x.kamp)) continue;
                if (x.min === slotStart) { if (lemp.samtidig) continue; return 'spiller er i en anden kamp i slottet'; }
                // Swiss Ladder med "runder lige efter hinanden": ingen pause mellem rundens kampe, kun et senere slot
                if (k.fase === 'swiss' && x.kamp.fase === 'swiss' && k.tpRef.draw === x.kamp.tpRef.draw && kat(k)?.swissUdenPause) continue;
                const { varighed: v2, pause: p2 } = M.mellemrum(k, x.kamp);
                const gab = Math.abs(x.min - slotStart) - v2;
                if (gab < p2) {
                    if (!lemp.pause) return 'spiller mangler pause';
                    if (mindsteGab === null || gab < mindsteGab) mindsteGab = gab;
                }
            }
        }
        sidsteGab = mindsteGab;
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
        return r.senest ? minutter(r.senest) : M.aargangsVindue(r, dagObj).til;
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
                const fuld = banerBrugt(brug.hele, brug.halve) >= banerIPulje(dag.dato, slot, pulje);
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

    // ── Fase 2: alle kampe SKAL placeres (Jespers krav). Resten placeres med
    // gradvist lempede regler; bruddet registreres, så Tjek viser det og
    // løsningsforslagene kan sige, hvad der skal ændres. Rækkefølgen af
    // lempelser: det mindst alvorlige først.
    // Hver lempelse inkluderer alle de foregående (kumulativt), mindst alvorlige først.
    const LEMPELSE_ORDEN = [
        // 'reserveret' står først: at låne en FRI fælles bane er lovligt (Tjek melder det ikke), så det prøves,
        // før nogen regel brydes, og registreres ikke som regelbrud.
        // Derefter det, Tjek kun regner for ADVARSLER (anti-samtidighed, rækkens tidsrum, rækkens dage/max dage),
        // og først til sidst det, Tjek regner for FEJL.
        ['reserveret', 'reserveret'], ['anti-samtidighed', 'antiSamtidighed'], ['tidsrum', 'tidsrum'], ['dag', 'dag'],
        ['pause', 'pause'], ['max-haltid', 'maxHaltid'], ['tidsvindue', 'tidsvindue'], ['max-kampe', 'maxKampe'], ['kapacitet', 'kapacitet'],
        ['raekkefoelge', 'afhaengighed'],  // sidste udvej: fx en finale, hvis semifinalen ligger i dagens sidste slot
        ['dobbeltbooket', 'samtidig'],     // allersidste udvej: kun når dagene slet ikke rækker
    ];
    // Først brydes ÉN regel ad gangen (plus lovligt lån af en fri fælles bane), i rækkefølge efter hvor lidt
    // det koster. Først når ingen enkelt lempelse giver plads, lempes reglerne samlet (kumulativt). Ellers
    // kunne en kamp, der blot skulle over på rækkens anden dag, ende uden for tidsvinduet på den første.
    const enkeltvis = LEMPELSE_ORDEN.map(([brudNavn, n]) => ({ brud: brudNavn, lemp: { reserveret: true, [n]: true } }));
    const samlet = LEMPELSE_ORDEN.map(([brudNavn], i) => ({ brud: brudNavn, lemp: Object.fromEntries(LEMPELSE_ORDEN.slice(0, i + 1).map(([, n]) => [n, true])) }));
    const LEMPELSER = [...enkeltvis, ...samlet.slice(1)];
    const brud = [];
    const rest = ventende.filter((k) => !plan[k.id]);
    // Afhængigheder først (færrest forfædre først), så kæderne kan placeres i rækkefølge
    rest.sort((a, b) => M.alleForfaedre(a.id).size - M.alleForfaedre(b.id).size || a.id.localeCompare(b.id));
    const dageTilFase2 = dage.filter((d) => !kunDage || kunDage.has(d.dato));
    for (const k of rest) {
        let placeret = false;
        for (const trin of [{ brud: null, lemp: {} }, ...LEMPELSER]) {
            for (const dag of dageTilFase2) {
                for (const slot of slotsForDag(dag, slotMin)) {
                    const slotStart = minutter(slot);
                    if (aarsagFor(k, dag, slot, slotStart, 0, trin.lemp)) continue;
                    registrer(k, dag.dato, slot);
                    if (trin.brud && trin.brud !== 'reserveret') brud.push({ id: k.id, brud: trin.brud, aarsag: aarsager.get(k.id) || trin.brud, detalje: trin.brud === 'pause' ? { gab: sidsteGab } : { dag: dag.dato, slot } });
                    placeret = true;
                    break;
                }
                if (placeret) break;
            }
            if (placeret) break;
        }
    }
    const ikkePlaceret = ventende.filter((k) => !plan[k.id]).map((k) => ({ id: k.id, aarsag: aarsager.get(k.id) || 'ingen turneringsdage' }));
    // Kampe på dage uden for kunDage, som ikke var låst, beholder også deres tid
    if (kunDage) for (const k of projekt.kampe) if (!plan[k.id] && projekt.plan[k.id] && !kunDage.has(projekt.plan[k.id].dag)) plan[k.id] = projekt.plan[k.id];

    const dagValg = Object.fromEntries([...raekkeDagValg].map(([rid, set]) => [rid, [...set]]));
    return { plan, ikkePlaceret, brud, dagValg, statistik: bedoemPlan({ ...projekt, plan }) };
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
            const x = prSpillerDag.get(n) || { foerste: min, sidste: min, kampe: 0, tider: [] };
            x.foerste = Math.min(x.foerste, min);
            x.sidste = Math.max(x.sidste, min);
            x.kampe += 1;
            x.tider.push(min);
            prSpillerDag.set(n, x);
        }
    }
    const maxVent = projekt.opsaetning.maxVentetidMin ?? 90;
    let haltidMin = 0, spillerDage = 0, ventetid = 0, langeHuller = 0;
    for (const x of prSpillerDag.values()) {
        haltidMin += x.sidste - x.foerste + slotMin;
        ventetid += x.sidste - x.foerste + slotMin - x.kampe * slotMin;
        spillerDage += 1;
        x.tider.sort((a, b) => a - b);
        if (maxVent > 0) for (let i = 1; i < x.tider.length; i += 1) if (x.tider[i] - x.tider[i - 1] - slotMin > maxVent) { langeHuller += 1; break; }
    }
    return {
        haltidMin,
        haltidGnsMin: spillerDage ? Math.round(haltidMin / spillerDage) : 0,
        ventetidGnsMin: spillerDage ? Math.round(ventetid / spillerDage) : 0,
        spillerDage,
        slutPrDag: Object.fromEntries([...slutPrDag.entries()].map(([d, m]) => [d, `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`])),
        udenTid,
        langeHuller,       // spillerdage med et hul på maxVentetidMin eller mere mellem egne kampe
        maxVentetidMin: maxVent,
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
        ud.push({ navn: v.navn, beskrivelse: v.beskrivelse, plan: f.plan, ikkePlaceret: f.ikkePlaceret, brud: f.brud, statistik: f.statistik, score: scorePlan({ ...projekt, plan: f.plan }).total });
    }
    const slutSum = (s) => Object.values(s.slutPrDag).reduce((sum, t) => sum + minutter(t), 0);
    // Bedst først: færrest regelbrud, dernæst lavest score (vægtede kriterier), dernæst tidligst slut
    ud.sort((a, b) => (a.ikkePlaceret.length + a.brud.length) - (b.ikkePlaceret.length + b.brud.length) || a.score - b.score || slutSum(a.statistik) - slutSum(b.statistik));
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
    if (ikkePlaceret.some((x) => x.brud)) return forslagFraBrud(projekt, ikkePlaceret);
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

/**
 * Løsningsforslag ud fra regelbrud i fase 2: pr. brudtype og række siges,
 * hvad der skal ændres, for at kampene kan ligge lovligt.
 */
function forslagFraBrud(projekt, liste) {
    const { slotMin, pauseMin, dage } = projekt.opsaetning;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const grupper = new Map();
    for (const x of liste) {
        const k = kampMap.get(x.id);
        if (!k) continue;
        const n = `${x.brud || x.aarsag}|${katMap.get(k.kategori)?.raekke || ''}`;
        if (!grupper.has(n)) grupper.set(n, []);
        grupper.get(n).push({ ...x, k });
    }
    const ud = [];
    const senesteSlot = (xs) => xs.map((x) => x.detalje?.slot).filter(Boolean).sort().at(-1);
    for (const [n, xs] of grupper) {
        const [brud, raekkeId] = n.split('|');
        const r = raekkeMap.get(raekkeId);
        const antal = xs.length;
        const hvem = `${antal} ${antal === 1 ? 'kamp' : 'kampe'} i ${raekkeId}`;
        if (brud === 'anti-samtidighed') {
            ud.push({ tekst: `${hvem} ligger samtidig med en anden kategori i rækken (single/double). Slå "undgå single og double samtidig" fra i fane 1, eller forlæng dagen.` });
        } else if (brud === 'tidsrum') {
            const s = senesteSlot(xs);
            ud.push({ tekst: `${hvem} ligger uden for rækkens eget tidsrum (${r?.tidligst || '–'}–${r?.senest || '–'}). Udvid tidsrummet${s ? ` til ${klokkeFraMin(minutter(s) + slotMin)}` : ''}, eller giv rækken flere reserverede baner.` });
        } else if (brud === 'reserveret') {
            ud.push({ tekst: `${hvem} bruger andre baner end rækkens ${r?.reserveredeBaner || 0} reserverede. Giv rækken flere reserverede baner, eller udvid dens tidsrum.` });
        } else if (brud === 'pause') {
            const gab = Math.min(...xs.map((x) => (x.detalje?.gab ?? 0)));
            const klasse = r?.pauseKlasse || 'ABCD';
            const nu = pauseMin.faelles != null && klasse !== 'E' ? pauseMin.faelles : pauseMin[klasse];
            ud.push({ tekst: `${hvem} har kortere pause end de ${nu} min (ned til ${Math.max(0, gab)} min). Sæt pausen for ${klasse === 'ABCD' ? 'A–D' : klasse} til ${Math.max(0, gab)} min, forlæng dagen, eller lad rækken spille over flere dage.` });
        } else if (brud === 'max-haltid') {
            ud.push({ tekst: `${hvem} giver spillere længere haltid end rækkens ${r?.maxHaltidMin || '?'} min. Giv rækken flere (reserverede) baner, saml dens kampe i et kortere tidsrum, skær i antal kampe/runder, eller hæv grænsen i fane 1.` });
        } else if (brud === 'tidsvindue') {
            const s = senesteSlot(xs);
            ud.push({ tekst: `${hvem} ligger uden for ${r?.aargang || 'årgangens'} tidsvindue${s ? ` (senest kl. ${s})` : ''}. Kræver dispensation: ret tidsvinduet under "Reglementets grænser", eller flyt kampe til en anden dag.` });
        } else if (brud === 'max-kampe') {
            ud.push({ tekst: `${hvem} giver spillere flere kampe pr. dag end tilladt. Lad rækken spille over flere dage, eller ret grænsen under "Reglementets grænser" (kræver dispensation).` });
        } else if (brud === 'dag') {
            ud.push({ tekst: `${hvem} er lagt på en dag, rækken ikke har valgt. Vælg dagen for rækken i fane 1, eller forlæng rækkens egne dage.` });
        } else if (brud === 'kapacitet') {
            const prDag = new Map();
            for (const x of xs) { const d = x.detalje?.dag; if (d) prDag.set(d, (prDag.get(d) || 0) + 1); }
            for (const [d, antalDag] of prDag) {
                const dag = dage.find((x) => x.dato === d);
                const slots = dag ? Math.ceil(antalDag / Math.max(1, dag.baner)) : 1;
                ud.push({ tekst: `${antalDag} ${antalDag === 1 ? 'kamp' : 'kampe'} i ${raekkeId} har ingen ledig bane ${d}. Forlæng dagen${dag ? ` til ${klokkeFraMin(minutter(dag.slut) + slots * slotMin)}` : ''}, tilføj ${Math.ceil(antalDag / Math.max(1, dag ? baneSlots(dag, slotMin) / dag.baner : 1)) || 1} bane, eller flyt rækken til en anden dag.` });
            }
        } else if (brud === 'dobbeltbooket') {
            ud.push({ tekst: `${hvem} sætter en spiller i to kampe samtidig — dagene rækker slet ikke. Tilføj en dag, forlæng dagene markant, eller skær i turneringsformen i TP.` });
        } else if (brud === 'raekkefoelge') {
            ud.push({ tekst: `${hvem} ligger før de kampe, de bygger på (der var ingen senere slots). Forlæng sidste dag, eller tilføj baner.` });
        } else {
            ud.push({ tekst: `${hvem}: ${brud}.` });
        }
    }
    return ud;
}
