// Regler (design § 5): tjekker en plan og returnerer problemer. Rene
// funktioner uden DOM.
//
// Et problem: { type, alvor: 'fejl'|'advarsel'|'info', tekst, kampe: [id],
//               dag?, slot?, noegle? }
// `noegle` sættes på advarsler, brugeren kan kvittere (projekt.kvitteret).
import { minutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, puljeFor, katKonflikt } from './kapacitet.js';
import { reglerFor, STANDARD_REGLER } from './store.js';

/** Min. tid pr. kamp (§ 4 stk. 5): standard ungdom ABCD 20, EM 25; senior ABCD 25, EM 30. */
export function minKampMin(aargang, raekke, regler = STANDARD_REGLER) {
    const senior = aargang === 'SEN' || /^\+/.test(aargang);
    const em = raekke === 'E' || raekke === 'M';
    const m = regler.minKampMin;
    if (senior) return em ? m.seniorEM : m.seniorABCD;
    return em ? m.ungdomEM : m.ungdomABCD;
}

/** Rækkens pause i minutter ud fra opsætningen (fælles pause erstatter ABCD/M). */
export function pauseForRaekke(pauseMin, pauseKlasse) {
    if (pauseKlasse === 'E') return pauseMin.E ?? 20;
    if (pauseMin.faelles != null) return pauseMin.faelles;
    return pauseMin[pauseKlasse] ?? 10;
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

const FINALERUNDER = new Set(['Kvartfinale', 'Semifinale', 'Finale']);

/**
 * Tjekker planen. Returnerer { problemer, prKamp: Map, prSlot: Map, antal: {fejl, advarsel, info} }.
 */
export function tjekPlan(projekt) {
    const { slotMin, pauseMin, dage } = projekt.opsaetning;
    const regler = reglerFor(projekt);
    // Hvor lang en kamp regnes for i pausetjekket: et helt slot (streng) eller
    // reglementets minimumstid (som TP — så to 20-min-kampe kan ligge i naboslots ved 30-min slots).
    const kampVarighed = projekt.opsaetning.kampVarighed || 'minimum';
    const varighedFor = (k) => { const r = raekke(k); return kampVarighed === 'slot' || !r ? slotMin : Math.min(slotMin, minKampMin(r.aargang, r.raekke, regler)); };
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const raekkeMap = new Map(projekt.raekker.map((r) => [r.id, r]));
    const dagMap = new Map(dage.map((d) => [d.dato, d]));
    const kvitteret = new Set(projekt.kvitteret || []);
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const problemer = [];
    const tilfoej = (p) => { if (!p.noegle || !kvitteret.has(p.noegle)) problemer.push(p); };
    const navn = (k) => `${k.kategori}: ${k.navn}`;
    const spillerNavn = (id) => { const s = projekt.spillere[id]; return s ? `${s.fornavn} ${s.efternavn}`.trim() : id; };
    const kat = (k) => katMap.get(k.kategori);
    const raekke = (k) => raekkeMap.get(kat(k)?.raekke);
    const tidMin = (p) => minutter(p.slot);
    const enDag = dage.length === 1;
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
        // Kapacitet pr. pulje: rækker med reserverede baner i tidsrummet har egen
        // pulje; alle andre deler de fælles baner.
        const { faelles, reserveret } = puljeKapacitet(dag, slot, projekt.raekker);
        const prPulje = new Map();
        for (const k of kampe) {
            const pulje = puljeFor(kat(k)?.raekke, reserveret);
            if (!prPulje.has(pulje)) prPulje.set(pulje, []);
            prPulje.get(pulje).push(k);
        }
        for (const [pulje, liste] of prPulje) {
            const halve = liste.filter((k) => kat(k)?.halvBane).length;
            const hele = liste.length - halve;
            const brugt = hele + Math.ceil(halve / 2);
            const baner = pulje === 'faelles' ? faelles : reserveret.get(pulje);
            if (brugt > baner) {
                const hvor = pulje === 'faelles' ? (reserveret.size ? ' på de fælles baner' : '') : ` på ${pulje}'s reserverede baner`;
                tilfoej({ type: 'kapacitet', alvor: 'fejl', tekst: `Kl. ${slot}: ${liste.length} kampe${halve ? ` (${halve} på halv bane)` : ''} kræver ${brugt} baner, men der er ${baner}${hvor}.`, kampe: liste.map((k) => k.id), dag: dato, slot });
            }
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
    // Swiss-pladsholdere (runde 2+) har ingen spillere; de tjekkes samlet pr. runde nedenfor.
    const prSpiller = new Map(); // spillerId → [{ k, p, min, kendt }]
    for (const { k, p, min } of placerede) {
        if (k.fase === 'swiss' && !k.spillere.length) continue;
        const kendte = new Set(k.spillere);
        for (const s of k.muligeSpillere) {
            if (!prSpiller.has(s)) prSpiller.set(s, []);
            prSpiller.get(s).push({ k, p, min, kendt: kendte.has(s) });
        }
    }
    const forfaedre = new Map(); // kampId → Set af alle kampe den bygger på (transitivt)
    const alleForfaedre = (id, set = new Set(), dybde = 0) => {
        if (forfaedre.has(id)) { for (const x of forfaedre.get(id)) set.add(x); return set; }
        const egen = new Set();
        for (const dep of kampMap.get(id)?.afhaengerAf || []) {
            egen.add(dep);
            if (dybde < 50) alleForfaedre(dep, egen, dybde + 1);
        }
        forfaedre.set(id, egen);
        for (const x of egen) set.add(x);
        return set;
    };
    const kanDeleSpillere = (a, b) => {
        if (a.tpRef.draw !== b.tpRef.draw) return true;
        if (a.fase === 'swiss' && b.fase === 'swiss') return a.runde !== b.runde;
        return alleForfaedre(a.id).has(b.id) || alleForfaedre(b.id).has(a.id);
    };
    const set = new Set();
    const parNoegle = (a, b, type) => [type, ...[a, b].sort()].join('|');
    const maxPrDag = enDag ? regler.maxKampePrDagEnDag : regler.maxKampePrDag;

    for (const [s, liste] of prSpiller) {
        liste.sort((a, b) => a.p.dag.localeCompare(b.p.dag) || a.min - b.min);
        for (let i = 0; i < liste.length; i += 1) {
            for (let j = i + 1; j < liste.length; j += 1) {
                const a = liste[i], b = liste[j];
                if (a.p.dag !== b.p.dag) break;
                if (!kanDeleSpillere(a.k, b.k)) continue;
                const begge = a.kendt && b.kendt;
                const pause = Math.max(pauseForRaekke(pauseMin, raekke(a.k)?.pauseKlasse), pauseForRaekke(pauseMin, raekke(b.k)?.pauseKlasse));
                const gab = b.min - a.min;
                const varighed = Math.max(varighedFor(a.k), varighedFor(b.k));
                if (gab === 0) {
                    const n = parNoegle(a.k.id, b.k.id, 'dobbelt');
                    if (set.has(n)) continue;
                    set.add(n);
                    tilfoej({ type: 'dobbeltbooket', alvor: begge ? 'fejl' : 'advarsel', tekst: `${spillerNavn(s)} ${begge ? 'er' : 'kan være'} i to kampe kl. ${a.p.slot}: ${navn(a.k)} og ${navn(b.k)}.`, kampe: [a.k.id, b.k.id], dag: a.p.dag, slot: a.p.slot });
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
            if (n > maxPrDag) tilfoej({ type: 'max-kampe', alvor: 'fejl', tekst: `${spillerNavn(s)} har ${n} kampe ${datoKort(dag)} (max ${maxPrDag}).`, kampe: liste.filter((x) => x.kendt && x.p.dag === dag).map((x) => x.k.id), dag });
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
            const pause = pauseForRaekke(pauseMin, raekke(k0)?.pauseKlasse);
            const forSent = forrige.sidsteDag > r.dag || (forrige.sidsteDag === r.dag && r.foersteMin < forrige.sidsteMin + varighedFor(k0) + pause);
            if (forSent) tilfoej({ type: 'swiss-runde', alvor: 'fejl', tekst: `${k0.kategori}: runde ${runde} begynder kl. ${r.foerste.slice(11)}, men runde ${runde - 1} slutter først kl. ${klokke(forrige.sidsteMin + varighedFor(k0))} (plus ${pause} min pause).`, kampe: [...r.kampe, ...forrige.kampe], dag: r.dag, slot: r.foerste.slice(11) });
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
        const kraeverDisp = ['B', 'C', 'D'].includes(r.raekke) || (r.aargang === 'U11' && r.raekke === 'A');
        if (kraeverDisp && m.size > 1 && !r.dispensationFlereDage) {
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
                if (dag === sidsteDag) {
                    const forkerte = kampe.filter((k) => !(k.fase === 'cup' && (k.rundeNavn === 'Semifinale' || k.rundeNavn === 'Finale')));
                    if (forkerte.length) tilfoej({ type: 'e-sidste-dag', alvor: 'fejl', tekst: `${r.id}: ${forkerte.length} kampe på sidste dag er hverken semifinaler eller finaler.`, kampe: forkerte.map((k) => k.id), dag });
                }
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
                for (const [katId, runder] of prKat) if (runder.size > 1) tilfoej({ type: 'senior-finalerunder', alvor: 'fejl', tekst: `${katId}: ${[...runder].join(' og ')} ligger samme dag (${datoKort(dag)}); senior E/M må ikke spille kvart-, semi- og finale samme dag.`, kampe: kampe.filter((k) => k.kategori === katId && FINALERUNDER.has(k.rundeNavn)).map((k) => k.id), dag });
            }
        }
        if (senior && (r.raekke === 'A' || r.raekke === 'B') && m.size > 1 && m.has(sidsteDag)) {
            const forkerte = m.get(sidsteDag).filter((k) => !(k.fase === 'cup' && FINALERUNDER.has(k.rundeNavn)));
            if (forkerte.length) tilfoej({ type: 'senior-finaledag', alvor: 'fejl', tekst: `${r.id}: ${forkerte.length} kampe på finaledagen er hverken kvart-, semi- eller finaler.`, kampe: forkerte.map((k) => k.id), dag: sidsteDag });
        }
    }

    // ── Anti-samtidighed (advarsel): HS/HD, DS/DD og MD i samme række i samme slot ──
    if (projekt.opsaetning.antiSamtidighed !== false) {
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
    for (const k of projekt.kategorier) {
        const r = raekkeMap.get(k.raekke);
        if (!r) continue;
        const ungdom = /^U/.test(r.aargang);
        const kampe = projekt.kampe.filter((x) => x.kategori === k.id);
        if (!kampe.length) continue;
        if (k.form === 'swiss' && k.runder < regler.minKampe.swissRunder) tilfoej({ type: 'form', alvor: 'advarsel', noegle: `${k.id}:swiss-runder`, tekst: `${k.id}: Swiss Ladder med ${k.runder} runder — reglementet kræver mindst ${regler.minKampe.swissRunder}.`, kampe: [] });
        // sikre kampe pr. spiller = puljekampe (cup afhænger af resultatet)
        const prSpillerAntal = new Map();
        for (const x of kampe) if (x.fase !== 'cup' || x.spillere.length) for (const s of x.spillere) prSpillerAntal.set(s, (prSpillerAntal.get(s) || 0) + 1);
        if (k.form === 'swiss') for (const s of prSpillerAntal.keys()) prSpillerAntal.set(s, k.runder);
        if (!prSpillerAntal.size) continue;
        const faerrest = Math.min(...prSpillerAntal.values());
        let krav = 0;
        if (ungdom && (r.raekke === 'M' || r.raekke === 'A')) krav = regler.minKampe.MA;
        else if (ungdom && ['B', 'C', 'D'].includes(r.raekke)) krav = k.type === 'single' ? regler.minKampe.BCDSingle : regler.minKampe.BCDDouble;
        if (ungdom && ['U09', 'U11'].includes(r.aargang) && k.type === 'single') krav = Math.max(krav, regler.minKampe.U9U11Single);
        if (krav && faerrest < krav) {
            const ramte = [...prSpillerAntal].filter(([, n]) => n < krav).map(([s]) => spillerNavn(s));
            tilfoej({ type: 'form', alvor: 'advarsel', noegle: `${k.id}:min-kampe`, tekst: `${k.id}: ${ramte.length} spillere er kun sikret ${faerrest} kampe (krav ${krav}): ${ramte.slice(0, 4).join(', ')}${ramte.length > 4 ? ' …' : ''}. Rettes i TP.`, kampe: [] });
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
