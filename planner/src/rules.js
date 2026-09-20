// Regler (design § 5): tjekker en plan og returnerer problemer. Rene
// funktioner uden DOM.
//
// Et problem: { type, alvor: 'fejl'|'advarsel'|'info', tekst, kampe: [id],
//               dag?, slot?, noegle? }
// `noegle` sættes på advarsler, brugeren kan kvittere (projekt.kvitteret).
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, puljeFor, katKonflikt, banebrugISlot, banerISlot } from './kapacitet.js';
import { lavRegelmodel, minKampMin, pauseForRaekke, foerSkoledag, tidsvindue, banerBrugt } from './regelmodel.js';
import { effektivForm, minKampeSamlet, sikreKampe, minKampeKrav } from './form.js';

// Byggestenene (kampvarighed, pause, tidsvindue, hvem der kan dele spillere …) ligger i regelmodel.js,
// så Tjek, planlæggeren og løseren bruger de samme. De eksporteres videre herfra af hensyn til eksisterende import.
export { minKampMin, pauseForRaekke, foerSkoledag, tidsvindue };

const FINALERUNDER = new Set(['Kvartfinale', 'Semifinale', 'Finale']);

/**
 * Tjekker planen. Returnerer { problemer, prKamp: Map, prSlot: Map, antal: {fejl, advarsel, info} }.
 */
export function tjekPlan(projekt) {
    const M = lavRegelmodel(projekt);
    const { slotMin, dage, regler, katMap, raekkeMap, dagMap, kampMap, kat, raekke, varighedFor, kanDeleSpillere, maxPrDag } = M;
    const kvitteret = new Set(projekt.kvitteret || []);
    const problemer = [];
    const tilfoej = (p) => { if (!p.noegle || !kvitteret.has(p.noegle)) problemer.push(p); };
    const navn = (k) => `${k.kategori}: ${k.navn}`;
    const spillerNavn = (id) => { const s = projekt.spillere[id]; return s ? `${s.fornavn} ${s.efternavn}`.trim() : id; };
    const tidMin = (p) => minutter(p.slot);
    const sidsteDag = dage.map((d) => d.dato).sort().at(-1);

    // Placerede kampe
    const placerede = [];
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (!p) continue;
        if (!dagMap.has(p.dag)) {
            tilfoej({ type: 'ukendt-dag', alvor: 'fejl', tekst: `${navn(k)} ligger på ${p.dag}, som ikke er en turneringsdag.`, kampe: [k.id] });
            continue;
        }
        placerede.push({ k, p, min: tidMin(p) });
    }

    // ── Slotlængde mod reglementets minimum ──
    for (const r of projekt.raekker) {
        const min = minKampMin(r.aargang, r.raekke, regler);
        if (slotMin < min) tilfoej({ type: 'slot-for-kort', alvor: 'fejl', tekst: `Slotlængden er ${slotMin} min, men ${r.id} kræver mindst ${min} min pr. kamp.`, kampe: [] });
    }

    // ── Kapacitet pr. slot (hele og halve baner) ──
    const prSlotKampe = new Map();
    for (const { k, p } of placerede) {
        const n = `${p.dag}|${p.slot}`;
        if (!prSlotKampe.has(n)) prSlotKampe.set(n, []);
        prSlotKampe.get(n).push(k);
    }
    for (const [n, kampe] of prSlotKampe) {
        const [dato, slot] = n.split('|');
        const dag = dagMap.get(dato);
        const gyldige = new Set(slotsForDag(dag, slotMin));
        if (!gyldige.has(slot)) {
            tilfoej({ type: 'uden-for-dagen', alvor: 'fejl', tekst: `${kampe.length} ${kampe.length === 1 ? 'kamp' : 'kampe'} kl. ${slot} ligger uden for dagens slots (${dag.start}–${dag.slut}).`, kampe: kampe.map((k) => k.id), dag: dato, slot });
        }
        // Rækker med reserverede baner bruger deres egne først og løber over på de fælles, hvis de ikke
        // rækker. Først når de fælles baner også er fulde, er der for mange kampe (banebrugISlot).
        const kapacitet = puljeKapacitet(dag, slot, projekt.raekker);
        const brug = banebrugISlot(kampe.map((k) => ({ raekkeId: kat(k)?.raekke, halv: !!kat(k)?.halvBane })), kapacitet);
        if (brug.forMange) {
            const halve = kampe.filter((k) => kat(k)?.halvBane).length;
            const iAlt = banerISlot(dag, slot);
            const brugtIAlt = [...brug.prPulje].reduce((sum, [pulje, p]) => sum + (pulje === 'faelles' ? p.brugt : Math.min(p.brugt, p.baner)), 0) + [...brug.overloeb.values()].reduce((x, y) => x + y, 0);
            const reserveret = [...brug.prPulje].filter(([pulje]) => pulje !== 'faelles').map(([pulje, p]) => `${pulje}: ${Math.min(p.brugt, p.baner)} af ${p.baner} reserverede baner${brug.overloeb.has(pulje) ? ` + ${brug.overloeb.get(pulje)} fælles` : ''}`);
            // Kampene på de fælles baner (og dem, der løber over) er dem, der kan flyttes
            const beroerte = kampe.filter((k) => { const pulje = puljeFor(kat(k)?.raekke, kapacitet.reserveret); return pulje === 'faelles' || brug.overloeb.has(pulje); });
            tilfoej({ type: 'kapacitet', alvor: 'fejl', tekst: `Kl. ${slot}: ${kampe.length} kampe${halve ? ` (${halve} på halv bane)` : ''} kræver ${brugtIAlt} baner, men der er ${iAlt}${reserveret.length ? ` — de fælles baner er fulde (${reserveret.join('; ')})` : ''}.`, kampe: beroerte.map((k) => k.id), dag: dato, slot });
        }
    }

    // ── Tidsvindue pr. årgang ──
    for (const { k, p, min } of placerede) {
        const r = raekke(k);
        if (!r) continue;
        const v = tidsvindue(r.aargang, dagMap.get(p.dag), regler);
        if (min < v.fra || min + slotMin > v.til) {
            tilfoej({ type: 'tidsvindue', alvor: 'fejl', tekst: `${navn(k)} kl. ${p.slot} ligger uden for ${r.aargang}'s tidsvindue ${klokke(v.fra)}–${klokke(v.til)}${foerSkoledag(dagMap.get(p.dag)) ? ' (dagen før en skoledag)' : ''}.`, kampe: [k.id], dag: p.dag, slot: p.slot });
        }
    }

    // ── Spillere: dobbeltbooking, pause, max kampe pr. dag ──
    // Kendte spillere giver fejl; mulige spillere (cup) giver advarsel.
    // To kampe i samme lodtrækning, hvor den ene ikke bygger på den anden, kan
    // aldrig have fælles spillere (positionerne er forskellige) — de springes over.
    // Swiss-pladsholdere (runde 2+) har ingen kendte spillere; de tjekkes samlet pr. runde nedenfor —
    // både mod forrige runde og mod spillernes kampe i ANDRE kategorier.
    const prSpiller = new Map(); // spillerId → [{ k, p, min, kendt }]
    for (const { k, p, min } of placerede) {
        if (k.fase === 'swiss' && !k.spillere.length) continue;
        const kendte = new Set(k.spillere);
        for (const s of k.muligeSpillere) {
            if (!prSpiller.has(s)) prSpiller.set(s, []);
            prSpiller.get(s).push({ k, p, min, kendt: kendte.has(s) });
        }
    }
    const set = new Set();
    const parNoegle = (a, b, type) => [type, ...[a, b].sort()].join('|');

    for (const [s, liste] of prSpiller) {
        liste.sort((a, b) => a.p.dag.localeCompare(b.p.dag) || a.min - b.min);
        for (let i = 0; i < liste.length; i += 1) {
            for (let j = i + 1; j < liste.length; j += 1) {
                const a = liste[i], b = liste[j];
                if (a.p.dag !== b.p.dag) break;
                if (!kanDeleSpillere(a.k, b.k)) continue;
                const begge = a.kendt && b.kendt;
                const { varighed, pause } = M.mellemrum(a.k, b.k);
                const gab = b.min - a.min;
                if (gab === 0) {
                    const n = parNoegle(a.k.id, b.k.id, 'dobbelt');
                    if (set.has(n)) continue;
                    set.add(n);
                    // Altid fejl — også for mulige spillere (cup): samme spiller kan nå begge finaler,
                    // og ingen må nogensinde skulle spille to steder samtidig (Jesper 2026-09-08).
                    tilfoej({ type: 'dobbeltbooket', alvor: 'fejl', tekst: `${spillerNavn(s)} ${begge ? 'er' : 'kan være'} i to kampe kl. ${a.p.slot}: ${navn(a.k)} og ${navn(b.k)}.`, kampe: [a.k.id, b.k.id], dag: a.p.dag, slot: a.p.slot });
                } else if (gab < varighed + pause) {
                    const n = parNoegle(a.k.id, b.k.id, 'pause');
                    if (set.has(n)) continue;
                    set.add(n);
                    tilfoej({ type: 'pause', alvor: begge ? 'fejl' : 'advarsel', tekst: `${spillerNavn(s)} ${begge ? 'har' : 'kan have'} kun ${gab - varighed} min pause mellem ${navn(a.k)} kl. ${a.p.slot} og ${navn(b.k)} kl. ${b.p.slot} (krav ${pause} min).`, kampe: [a.k.id, b.k.id], dag: b.p.dag, slot: b.p.slot });
                }
            }
        }
        // Max kampe pr. dag (kun kendte)
        const prDag = new Map();
        for (const x of liste) if (x.kendt) prDag.set(x.p.dag, (prDag.get(x.p.dag) || 0) + 1);
        for (const [dag, n] of prDag) {
            const graense = M.maxPrDagForKampe(liste.filter((x) => x.kendt && x.p.dag === dag).map((x) => x.k)); // senior: 10 også på én dag
            if (n > graense) tilfoej({ type: 'max-kampe', alvor: 'fejl', tekst: `${spillerNavn(s)} har ${n} kampe ${datoKort(dag)} (max ${graense}).`, kampe: liste.filter((x) => x.kendt && x.p.dag === dag).map((x) => x.k.id), dag });
        }
    }

    // ── Swiss Ladder runde 2+ mod spillernes øvrige kampe ──
    // Alle i lodtrækningen spiller (eller sidder over) i hver runde, så en runde i et slot optager dem
    // alle. Samme tid som en anden kamp = dobbeltbooket (fejl); for tæt på = pause (advarsel, da
    // parringen ikke kendes endnu). Én melding pr. runde-slot og anden kamp, ikke én pr. spiller.
    const swissEnheder = new Map(); // draw|runde|dag|min → { k0, ids, dag, min, slot, spillere }
    for (const { k, p, min } of placerede) {
        if (k.fase !== 'swiss' || k.spillere.length) continue;
        const n = `${k.tpRef.draw}|${k.runde}|${p.dag}|${min}`;
        if (!swissEnheder.has(n)) swissEnheder.set(n, { k0: k, ids: [], dag: p.dag, min, slot: p.slot, spillere: new Set() });
        const e = swissEnheder.get(n);
        e.ids.push(k.id);
        for (const s of k.muligeSpillere) e.spillere.add(s);
    }
    for (const e of swissEnheder.values()) {
        const fund = new Map(); // anden kamp-id + type → { x, type, gab, spillere }
        for (const s of e.spillere) {
            for (const x of prSpiller.get(s) || []) {
                if (x.p.dag !== e.dag || x.k.tpRef.draw === e.k0.tpRef.draw) continue;
                const gab = Math.abs(x.min - e.min);
                const { varighed, pause } = M.mellemrum(x.k, e.k0);
                const type = gab === 0 ? 'dobbeltbooket' : gab < varighed + pause ? 'pause' : null;
                if (!type) continue;
                const n = `${x.k.id}|${type}`;
                if (!fund.has(n)) fund.set(n, { x, type, gab, varighed, pause, kendt: false, spillere: [] });
                if (x.kendt) fund.get(n).kendt = true;
                fund.get(n).spillere.push(s);
            }
        }
        for (const f of fund.values()) {
            const hvem = `${f.spillere.slice(0, 3).map(spillerNavn).join(', ')}${f.spillere.length > 3 ? ` og ${f.spillere.length - 3} andre` : ''}`;
            const runde = `${e.k0.kategori} runde ${e.k0.runde}`;
            if (f.type === 'dobbeltbooket') tilfoej({ type: 'dobbeltbooket', alvor: 'fejl', tekst: `${hvem} skal spille ${runde} kl. ${e.slot} (alle er med i hver Swiss-runde), men ${f.kendt ? 'er samtidig sat til' : 'kan samtidig skulle spille'} ${navn(f.x.k)}.`, kampe: [f.x.k.id, ...e.ids], dag: e.dag, slot: e.slot });
            else tilfoej({ type: 'pause', alvor: 'advarsel', tekst: `${hvem} kan have kun ${f.gab - f.varighed} min pause mellem ${runde} kl. ${e.slot} og ${navn(f.x.k)} kl. ${f.x.p.slot} (krav ${f.pause} min).`, kampe: [f.x.k.id, ...e.ids], dag: e.dag, slot: f.x.min > e.min ? f.x.p.slot : e.slot });
        }
    }

    // ── Swiss Ladder: runde r+1 tidligst når runde r er slut plus pause ──
    const swissRunder = new Map(); // draw → runde → { foerste, sidste, kampe }
    for (const { k, p, min } of placerede) {
        if (k.fase !== 'swiss') continue;
        if (!swissRunder.has(k.tpRef.draw)) swissRunder.set(k.tpRef.draw, new Map());
        const m = swissRunder.get(k.tpRef.draw);
        const t = `${p.dag}T${p.slot}`;
        if (!m.has(k.runde)) m.set(k.runde, { foerste: t, sidste: t, foersteMin: min, sidsteMin: min, dag: p.dag, sidsteDag: p.dag, kampe: [] });
        const r = m.get(k.runde);
        if (t < r.foerste) { r.foerste = t; r.foersteMin = min; r.dag = p.dag; }
        if (t > r.sidste) { r.sidste = t; r.sidsteMin = min; r.sidsteDag = p.dag; }
        r.kampe.push(k.id);
    }
    for (const [, m] of swissRunder) {
        for (const [runde, r] of m) {
            const forrige = m.get(runde - 1);
            if (!forrige) continue;
            const k0 = kampMap.get(r.kampe[0]);
            // "Runder lige efter hinanden" (pr. Swiss-kategori): ingen pause, næste runde blot i et senere slot
            const udenPause = !!kat(k0)?.swissUdenPause;
            const pause = udenPause ? 0 : M.pauseFor(k0);
            const varighed = udenPause ? slotMin : varighedFor(k0);
            const forSent = forrige.sidsteDag > r.dag || (forrige.sidsteDag === r.dag && r.foersteMin < forrige.sidsteMin + varighed + pause);
            if (forSent) tilfoej({ type: 'swiss-runde', alvor: 'fejl', tekst: `${k0.kategori}: runde ${runde} begynder kl. ${r.foerste.slice(11)}, men runde ${runde - 1} slutter først kl. ${klokke(forrige.sidsteMin + varighed)}${pause ? ` (plus ${pause} min pause)` : ''}.`, kampe: [...r.kampe, ...forrige.kampe], dag: r.dag, slot: r.foerste.slice(11) });
        }
    }

    // ── Max haltid pr. række (hård regel som data, fx U9: 240 min): første til sidste kamp samme dag ──
    // Tiden i hallen går fra spillerens første til sidste kamp samme dag. Det er de kendte kampe OG
    // Swiss-runderne i de lodtrækninger, spilleren er med i (alle er med i hver runde). Double kl. 9 og
    // Swiss kl. 12–16 er altså 7 timer — ikke 4. Hele Swiss-forløbets egen længde meldes samlet nedenfor.
    const swissPrSpiller = new Map(); // spillerId → [{ k, p, min }] for Swiss-runde 2+ (pladsholdere)
    for (const x of placerede) {
        if (x.k.fase !== 'swiss' || x.k.spillere.length) continue;
        for (const s of x.k.muligeSpillere) { if (!swissPrSpiller.has(s)) swissPrSpiller.set(s, []); swissPrSpiller.get(s).push(x); }
    }
    for (const s of new Set([...prSpiller.keys(), ...swissPrSpiller.keys()])) {
        const prDag = new Map();
        const med = (x, erSwissRunde) => {
            const graense = raekke(x.k)?.maxHaltidMin;
            if (!prDag.has(x.p.dag)) prDag.set(x.p.dag, { foerste: x, sidste: x, graense: null, kampe: [], andet: false, swissLodtraekninger: new Set() });
            const d = prDag.get(x.p.dag);
            if (x.min < d.foerste.min) d.foerste = x;
            if (x.min > d.sidste.min) d.sidste = x;
            if (graense && (d.graense === null || graense < d.graense)) d.graense = graense;
            if (erSwissRunde) d.swissLodtraekninger.add(x.k.tpRef.draw); else d.andet = true;
            d.kampe.push(x.k.id);
        };
        for (const x of prSpiller.get(s) || []) if (x.kendt) med(x, x.k.fase === 'swiss');
        for (const x of swissPrSpiller.get(s) || []) med(x, true);
        for (const [dag, d] of prDag) {
            if (!d.graense || (!d.andet && d.swissLodtraekninger.size < 2)) continue; // kun ét Swiss-forløb den dag: dækket af den samlede melding nedenfor
            const haltid = d.sidste.min - d.foerste.min + slotMin;
            if (haltid > d.graense) tilfoej({ type: 'max-haltid', alvor: 'fejl', tekst: `${spillerNavn(s)} er i hallen ${haltid} min ${datoKort(dag)} (kl. ${d.foerste.p.slot}–${klokke(d.sidste.min + slotMin)}); rækken tillader højst ${d.graense} min.`, kampe: d.kampe, dag, slot: d.sidste.p.slot });
        }
    }

    // Swiss Ladder: alle spillere er med i hver runde, så haltiden er fra første rundes første
    // kamp til sidste rundes sidste kamp samme dag — også selvom runde 2+ ikke har kendte spillere.
    {
        const prDrawDag = new Map();
        for (const { k, p, min } of placerede) {
            if (k.fase !== 'swiss') continue;
            const graense = raekke(k)?.maxHaltidMin;
            if (!graense) continue;
            const n = `${k.tpRef.draw}|${p.dag}`;
            if (!prDrawDag.has(n)) prDrawDag.set(n, { foerste: min, sidste: min, graense, kampe: [], kategori: k.kategori, dag: p.dag });
            const d = prDrawDag.get(n);
            d.foerste = Math.min(d.foerste, min);
            d.sidste = Math.max(d.sidste, min);
            d.kampe.push(k.id);
        }
        for (const d of prDrawDag.values()) {
            const haltid = d.sidste - d.foerste + slotMin;
            if (haltid > d.graense) tilfoej({ type: 'max-haltid', alvor: 'fejl', tekst: `${d.kategori}: Swiss Ladder-runderne strækker sig over ${haltid} min ${datoKort(d.dag)} (kl. ${klokke(d.foerste)}–${klokke(d.sidste + slotMin)}); rækken tillader højst ${d.graense} min i hallen.`, kampe: d.kampe, dag: d.dag, slot: klokke(d.sidste) });
        }
    }

    // ── Lang ventetid: en spiller venter længere end grænsen mellem egne (kendte) kampe ──
    const maxVent = projekt.opsaetning.maxVentetidMin ?? 90;
    if (maxVent > 0) {
        for (const [s, liste] of prSpiller) {
            const kendte = liste.filter((x) => x.kendt).sort((a, b) => a.p.dag.localeCompare(b.p.dag) || a.min - b.min);
            for (let i = 1; i < kendte.length; i += 1) {
                const a = kendte[i - 1], b = kendte[i];
                if (a.p.dag !== b.p.dag) continue;
                const vent = b.min - a.min - slotMin;
                if (vent > maxVent) tilfoej({ type: 'lang-ventetid', alvor: 'advarsel', noegle: `${s}:${b.p.dag}:${b.k.id}:ventetid`, tekst: `${spillerNavn(s)} venter ${vent} min mellem ${navn(a.k)} kl. ${a.p.slot} og ${navn(b.k)} kl. ${b.p.slot} (grænse ${maxVent} min).`, kampe: [a.k.id, b.k.id], dag: b.p.dag, slot: b.p.slot });
            }
        }
    }

    // ── Rækkefølge: afhængigheder ──
    for (const { k, p, min } of placerede) {
        if (k.fase === 'swiss' && !k.spillere.length) continue; // dækket af Swiss-runde-tjekket
        for (const dep of k.afhaengerAf) {
            const d = kampMap.get(dep);
            const pd = projekt.plan[dep];
            if (!d) continue;
            if (!pd) {
                tilfoej({ type: 'afhaengighed-uden-tid', alvor: 'advarsel', tekst: `${navn(k)} har tid, men ${navn(d)}, som den bygger på, har ingen.`, kampe: [k.id, dep], dag: p.dag, slot: p.slot });
                continue;
            }
            const foer = pd.dag < p.dag || (pd.dag === p.dag && tidMin(pd) < min);
            if (!foer) tilfoej({ type: 'raekkefoelge', alvor: 'fejl', tekst: `${navn(k)} (${datoKort(p.dag)} ${p.slot}) ligger ikke efter ${navn(d)} (${datoKort(pd.dag)} ${pd.slot}).`, kampe: [k.id, dep], dag: p.dag, slot: p.slot });
        }
    }

    // ── Rækker og dage ──
    const dagePrRaekke = new Map();
    for (const { k, p } of placerede) {
        const r = raekke(k);
        if (!r) continue;
        if (!dagePrRaekke.has(r.id)) dagePrRaekke.set(r.id, new Map());
        const m = dagePrRaekke.get(r.id);
        if (!m.has(p.dag)) m.set(p.dag, []);
        m.get(p.dag).push(k);
    }
    for (const r of projekt.raekker) {
        const m = dagePrRaekke.get(r.id);
        if (!m) continue;
        // Max dage pr. række som data (r.maxDage); dispensation og ældre projekter håndteres i regelmodellen
        const maxDage = M.maxDageFor(r);
        if (maxDage && m.size > maxDage) {
            tilfoej({ type: 'flere-dage', alvor: 'advarsel', noegle: `${r.id}:flere-dage`, tekst: `${r.id} spiller over ${m.size} dage (${[...m.keys()].sort().map(datoKort).join(', ')}). B-, C- og D-rækker og U11 A skal afvikles på én dag, medmindre der er givet dispensation.`, kampe: [...m.values()].flat().map((k) => k.id) });
        }
        for (const [dag, kampe] of m) {
            // Rækkens eget tidsrum (valgfrit) — brugerens ønske, ikke reglementet: advarsel
            if (r.tidligst || r.senest) {
                const udenfor = kampe.filter((k) => {
                    const min = tidMin(projekt.plan[k.id]);
                    return (r.tidligst && min < minutter(r.tidligst)) || (r.senest && min + slotMin > minutter(r.senest));
                });
                if (udenfor.length) tilfoej({ type: 'raekke-tidsrum', alvor: 'advarsel', noegle: `${r.id}:${dag}:tidsrum`, tekst: `${udenfor.length} kampe i ${r.id} ligger ${datoKort(dag)} uden for rækkens eget tidsrum ${r.tidligst || dagMap.get(dag).start}–${r.senest || dagMap.get(dag).slut}.`, kampe: udenfor.map((k) => k.id), dag });
            }
            const uPlaceret = kampe.filter((k) => !r.dage.includes(dag));
            if (uPlaceret.length) tilfoej({ type: 'uden-for-raekkens-dage', alvor: 'advarsel', noegle: `${r.id}:${dag}:uden-for-dage`, tekst: `${uPlaceret.length} kampe i ${r.id} ligger ${datoKort(dag)}, som ikke er valgt som rækkens dag.`, kampe: uPlaceret.map((k) => k.id), dag });
        }
        const senior = r.aargang === 'SEN' || /^\+/.test(r.aargang);
        if (r.raekke === 'E') {
            for (const [dag, kampe] of m) {
                if (dag === sidsteDag && dage.length > 1) { // en endagsturnering kan ikke have "kun semi og finale sidste dag"
                    const forkerte = kampe.filter((k) => !(k.fase === 'cup' && (k.rundeNavn === 'Semifinale' || k.rundeNavn === 'Finale')));
                    if (forkerte.length) tilfoej({ type: 'e-sidste-dag', alvor: 'fejl', tekst: `${r.id}: ${forkerte.length} kampe på sidste dag er hverken semifinaler eller finaler.`, kampe: forkerte.map((k) => k.id), dag });
                }
                // § 4 stk. 5.1: i E-rækker må ingen kampe programsættes før kl. 10
                const forTidlige = kampe.filter((k) => tidMin(projekt.plan[k.id]) < minutter(regler.eTidligst));
                if (forTidlige.length) tilfoej({ type: 'e-tidligst', alvor: 'fejl', tekst: `${r.id}: ${forTidlige.length} ${forTidlige.length === 1 ? 'kamp' : 'kampe'} ${datoKort(dag)} ligger før kl. ${regler.eTidligst}; i E-rækker må kampe tidligst programsættes fra kl. ${regler.eTidligst}.`, kampe: forTidlige.map((k) => k.id), dag });
                for (const k of kampe) {
                    if (k.rundeNavn !== 'Finale') continue;
                    const min = tidMin(projekt.plan[k.id]);
                    if (min < minutter(regler.eFinale[0]) || min > minutter(regler.eFinale[1])) tilfoej({ type: 'e-finale-tid', alvor: 'fejl', tekst: `${navn(k)} kl. ${projekt.plan[k.id].slot}: E-finaler skal ligge mellem ${regler.eFinale[0]} og ${regler.eFinale[1]}.`, kampe: [k.id], dag, slot: projekt.plan[k.id].slot });
                }
            }
        }
        if (senior && (r.raekke === 'E' || r.raekke === 'M')) {
            for (const [dag, kampe] of m) {
                const prKatSpiller = new Map();
                for (const k of kampe) for (const s of k.spillere) {
                    const n = `${k.kategori}|${s}`;
                    prKatSpiller.set(n, (prKatSpiller.get(n) || 0) + 1);
                }
                for (const [n, antal] of prKatSpiller) {
                    if (antal > regler.seniorMaxPrKategori) { const [katId, s] = n.split('|'); tilfoej({ type: 'senior-max-3', alvor: 'fejl', tekst: `${spillerNavn(s)} har ${antal} kampe i ${katId} ${datoKort(dag)} (senior E/M: max ${regler.seniorMaxPrKategori} pr. kategori pr. dag).`, kampe: kampe.filter((k) => k.kategori === katId && k.spillere.includes(s)).map((k) => k.id), dag }); }
                }
                const prKat = new Map();
                for (const k of kampe) if (k.fase === 'cup' && FINALERUNDER.has(k.rundeNavn)) { if (!prKat.has(k.kategori)) prKat.set(k.kategori, new Set()); prKat.get(k.kategori).add(k.rundeNavn); }
                // Jesper 2026-09-20: semifinale og finale må gerne spilles samme dag, men kvartfinalen skal ligge
                // en tidligere dag — altså må en kvartfinale ikke dele dag med kategoriens semifinale eller finale.
                for (const [katId, runder] of prKat) if (runder.has('Kvartfinale') && runder.size > 1) tilfoej({ type: 'senior-finalerunder', alvor: 'fejl', tekst: `${katId}: ${[...runder].join(', ')} ligger samme dag (${datoKort(dag)}); i senior E/M må semifinale og finale spilles samme dag, men kvartfinalen skal ligge en tidligere dag.`, kampe: kampe.filter((k) => k.kategori === katId && FINALERUNDER.has(k.rundeNavn)).map((k) => k.id), dag });
            }
        }
        if (M.kunFinalerunderPaaFinaledagen(r) && m.size > 1 && m.has(sidsteDag)) { // Senior A/B og Senior+ E/A
            const forkerte = m.get(sidsteDag).filter((k) => !(k.fase === 'cup' && FINALERUNDER.has(k.rundeNavn)));
            if (forkerte.length) tilfoej({ type: 'senior-finaledag', alvor: 'fejl', tekst: `${r.id}: ${forkerte.length} kampe på finaledagen er hverken kvart-, semi- eller finaler.`, kampe: forkerte.map((k) => k.id), dag: sidsteDag });
        }
    }

    // ── Anti-samtidighed (advarsel): HS/HD, DS/DD og MD i samme række i samme slot ──
    if (M.antiSamtidighed) {
        const prRaekkeDag = new Map(); // `${raekke}|${dag}` → Map(slot → [kampe])
        for (const [n, kampe] of prSlotKampe) {
            const [dato, slot] = n.split('|');
            for (const k of kampe) {
                const r = raekke(k);
                if (!r) continue;
                const rn = `${r.id}|${dato}`;
                if (!prRaekkeDag.has(rn)) prRaekkeDag.set(rn, new Map());
                const m = prRaekkeDag.get(rn);
                if (!m.has(slot)) m.set(slot, []);
                m.get(slot).push(k);
            }
        }
        for (const [rn, m] of prRaekkeDag) {
            const [raekkeId, dato] = rn.split('|');
            const ramte = new Set();
            const slots = [];
            for (const [slot, kampe] of m) {
                let konflikt = false;
                for (let i = 0; i < kampe.length && !konflikt; i += 1) for (let j = i + 1; j < kampe.length; j += 1) {
                    if (katKonflikt(kat(kampe[i])?.kat, kat(kampe[j])?.kat)) { konflikt = true; break; }
                }
                if (konflikt) { slots.push(slot); for (const k of kampe) ramte.add(k.id); }
            }
            if (slots.length) tilfoej({ type: 'anti-samtidighed', alvor: 'advarsel', noegle: `${raekkeId}:${dato}:samtidig`, tekst: `${raekkeId}: single og double (eller mix) ligger samtidig ${datoKort(dato)} kl. ${slots.sort().join(', ')}. Spillere i flere kategorier får kortere pauser, og programmet bliver sværere at følge.`, kampe: [...ramte], dag: dato, slot: slots.sort()[0] });
        }
    }

    // ── Kampe uden tid ──
    const udenTid = projekt.kampe.filter((k) => !projekt.plan[k.id]);
    if (udenTid.length) tilfoej({ type: 'uden-tid', alvor: 'info', tekst: `${udenTid.length} kampe har ingen tid endnu.`, kampe: udenTid.map((k) => k.id) });

    // ── Turneringsform (§ 5.2) — regnes fra lodtrækningen ──
    // Sikre kampe pr. spiller pr. kategori (puljekampe og Swiss-runder; cup afhænger af resultatet)
    const sikrePrKat = new Map(projekt.kategorier.map((k) => [k.id, sikreKampe(k, projekt.kampe.filter((x) => x.kategori === k.id))]));
    for (const k of projekt.kategorier) {
        const r = raekkeMap.get(k.raekke);
        if (!r) continue;
        const ungdom = /^U/.test(r.aargang);
        const kampe = projekt.kampe.filter((x) => x.kategori === k.id);
        if (!kampe.length) continue;
        const ef = effektivForm(k);
        if (ef.form === 'swiss' && ef.runder < regler.minKampe.swissRunder) tilfoej({ type: 'form', alvor: 'advarsel', noegle: `${k.id}:swiss-runder`, tekst: `${k.id}: Swiss Ladder med ${ef.runder} ${ef.runder === 1 ? 'runde' : 'runder'} — reglementet kræver mindst ${regler.minKampe.swissRunder}.`, kampe: [] });
        // Tælles kravet samlet for rækken (U9), regnes spillerens sikre kampe i andre kategorier med
        const samlet = minKampeSamlet(r);
        const prSpillerAntal = new Map(sikrePrKat.get(k.id));
        if (samlet) for (const [id, andre] of sikrePrKat) if (id !== k.id) for (const s of prSpillerAntal.keys()) if (andre.has(s)) prSpillerAntal.set(s, prSpillerAntal.get(s) + andre.get(s));
        if (!prSpillerAntal.size) continue;
        const faerrest = Math.min(...prSpillerAntal.values());
        const krav = minKampeKrav(k, r, regler);
        if (krav && faerrest < krav) {
            const ramte = [...prSpillerAntal].filter(([, n]) => n < krav).map(([s]) => spillerNavn(s));
            tilfoej({ type: 'form', alvor: 'advarsel', noegle: `${k.id}:min-kampe`, tekst: `${k.id}: ${ramte.length} spillere er kun sikret ${faerrest} ${faerrest === 1 ? 'kamp' : 'kampe'}${samlet ? ' i alt (single + double/mix)' : ''} (krav ${krav}): ${ramte.slice(0, 4).join(', ')}${ramte.length > 4 ? ' …' : ''}. ${(k.formValg || 'tp') === 'tp' ? 'Rettes i TP.' : 'Vælg en anden form i fane 1.'}`, kampe: [] });
        }
    }

    // ── Indeks ──
    const prKamp = new Map();
    const prSlot = new Map();
    const antal = { fejl: 0, advarsel: 0, info: 0 };
    const rang = { fejl: 0, advarsel: 1, info: 2 };
    problemer.sort((a, b) => rang[a.alvor] - rang[b.alvor] || (a.dag || '').localeCompare(b.dag || '') || (a.slot || '').localeCompare(b.slot || ''));
    for (const p of problemer) {
        antal[p.alvor] += 1;
        for (const id of p.kampe) { if (!prKamp.has(id)) prKamp.set(id, []); prKamp.get(id).push(p); }
        if (p.dag && p.slot) { const n = `${p.dag}|${p.slot}`; if (!prSlot.has(n)) prSlot.set(n, []); prSlot.get(n).push(p); }
    }
    return { problemer, prKamp, prSlot, antal };
}

/** Værste alvorlighed for en kamp: 'fejl' | 'advarsel' | 'info' | null */
export function alvorForKamp(tjek, kampId) {
    const liste = tjek.prKamp.get(kampId);
    if (!liste) return null;
    if (liste.some((p) => p.alvor === 'fejl')) return 'fejl';
    if (liste.some((p) => p.alvor === 'advarsel')) return 'advarsel';
    return 'info';
}

function klokke(min) {
    return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

function datoKort(iso) {
    const [, md, d] = iso.split('-').map(Number);
    return `${d}/${md}`;
}
