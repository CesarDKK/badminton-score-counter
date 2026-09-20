// Klient til CP-SAT-løseren (planner/solver, Google OR-Tools).
//
// bygProblem() oversætter projektet til et rent planlægningsproblem: kamp-id'er,
// spillere som løbenumre, tilladte starttider, kapacitet pr. slot, konfliktpar
// og vægte. Der sendes INGEN navne, klubber, fødselsdatoer eller e-mails —
// løseren har ikke brug for dem. Al regelkendskab (tidsvinduer, pauser, hvem der
// kan dele spillere) ligger her i JS, så løseren kun kender tal og par.
import { minutter, klokkeFraMinutter } from './tp-reader.js';
import { slotsForDag, puljeKapacitet, puljeFor, katKonflikt } from './kapacitet.js';
import { lavRegelmodel } from './regelmodel.js';
import { vaegteFor } from './kriterier.js';

const DAG_MIN = 1440;

/**
 * Bygger problemet til løseren. Tiden er global: T = dagIndex * 1440 + startminut,
 * så "afstand mellem to kampe" virker på tværs af dage uden særbehandling.
 * @param {object} projekt
 * @param {object} [hintPlan]  en lovlig plan (fra lavForslag) som startløsning
 */
export function bygProblem(projekt, hintPlan = null) {
    // Reglernes byggesten kommer fra regelmodellen — de samme, som Tjek og planlæggeren bruger
    const M = lavRegelmodel(projekt);
    const { slotMin, dage, kampMap, kat, raekke, kanDeleSpillere, alleForfaedre, maxPrDag } = M;
    const laast = new Set(projekt.laast || []);
    const dagIndex = new Map(dage.map((d, i) => [d.dato, i]));

    // Puljer: rækker med reserverede baner har egen pulje (altid), resten deler 'faelles'
    const puljeForRaekke = (r) => (r?.reserveredeBaner > 0 ? r.id : 'faelles');
    const kapacitet = {}; // pulje → [{ t, baner }]
    dage.forEach((dag, di) => {
        for (const slot of slotsForDag(dag, slotMin)) {
            const t = di * DAG_MIN + minutter(slot);
            const kap = puljeKapacitet(dag, slot, projekt.raekker);
            (kapacitet.faelles = kapacitet.faelles || []).push({ t, baner: kap.faelles });
            for (const r of projekt.raekker) {
                if (!(r.reserveredeBaner > 0)) continue;
                (kapacitet[r.id] = kapacitet[r.id] || []).push({ t, baner: kap.reserveret.get(r.id) || 0 });
            }
        }
    });

    // Spillere som løbenumre (ingen persondata forlader browseren)
    const spillerNr = new Map();
    const nr = (id) => { if (!spillerNr.has(id)) spillerNr.set(id, spillerNr.size); return spillerNr.get(id); };

    const kampe = [];
    const indeks = new Map();
    for (const k of projekt.kampe) {
        const r = raekke(k);
        if (!r) continue;
        let tilladte = [];
        const p = projekt.plan[k.id];
        if (laast.has(k.id) && p && dagIndex.has(p.dag)) {
            tilladte = [dagIndex.get(p.dag) * DAG_MIN + minutter(p.slot)];
        } else {
            for (const dato of r.dage || []) {
                const dag = dage.find((d) => d.dato === dato);
                if (!dag) continue;
                const v = M.raekkeVindue(r, dag);
                for (const slot of slotsForDag(dag, slotMin)) {
                    const m = minutter(slot);
                    if (M.iVindue(v, m) && !M.kampForbud(k, dato, m)) tilladte.push(dagIndex.get(dato) * DAG_MIN + m); // inkl. E- og senior-reglerne for dagen
                }
            }
        }
        // En låst kamp uden for rækkens tidsrum ligger på de fælles baner (rækkens egne findes kun i tidsrummet)
        let pulje = puljeForRaekke(r);
        if (pulje !== 'faelles' && laast.has(k.id) && p && dagIndex.has(p.dag)) pulje = puljeFor(r.id, puljeKapacitet(dage[dagIndex.get(p.dag)], p.slot, projekt.raekker).reserveret);
        indeks.set(k.id, kampe.length);
        kampe.push({
            id: k.id, raekke: r.id, pulje, halv: !!kat(k)?.halvBane, tilladte,
            spillere: k.spillere.map(nr), erFinale: k.rundeNavn === 'Finale',
            hint: hintPlan?.[k.id] && dagIndex.has(hintPlan[k.id].dag) ? dagIndex.get(hintPlan[k.id].dag) * DAG_MIN + minutter(hintPlan[k.id].slot) : null,
        });
    }

    // Til diagnosen ("hvorfor findes der ingen plan?"): hvad rækken måtte, hvis dens eget tidsrum eller dens
    // dage ikke gjaldt. Løseren holder begge dele hårdt, mens Tjek kun advarer — så de skal kunne udpeges.
    // Rækker med reserverede baner er ikke med: deres egne baner findes kun i tidsrummet på rækkens dage.
    const alternativer = [];
    for (const r of projekt.raekker) {
        if (r.reserveredeBaner > 0) continue;
        const egne = kampe.map((k, i) => (k.raekke === r.id ? i : -1)).filter((i) => i >= 0);
        if (!egne.length) continue;
        const tider = (datoer, medTidsrum) => {
            const ud = [];
            for (const dag of dage) {
                if (!datoer.includes(dag.dato)) continue;
                const v = medTidsrum ? M.raekkeVindue(r, dag) : M.aargangsVindue(r, dag);
                for (const slot of slotsForDag(dag, slotMin)) { const m = minutter(slot); if (M.iVindue(v, m)) ud.push(dagIndex.get(dag.dato) * DAG_MIN + m); }
            }
            return ud;
        };
        if (r.tidligst || r.senest) alternativer.push({ regel: 'tidsrum', raekke: r.id, kampe: egne, tilladte: tider(r.dage || [], false) });
        if ((r.dage || []).length < dage.length) alternativer.push({ regel: 'dage', raekke: r.id, kampe: egne, tilladte: tider(dage.map((d) => d.dato), true) });
    }

    // Afhængigheder: efterfølger skal starte mindst ét slot senere
    const foer = [];
    for (const k of projekt.kampe) for (const dep of k.afhaengerAf) if (indeks.has(k.id) && indeks.has(dep)) foer.push([indeks.get(dep), indeks.get(k.id), slotMin]);

    // Konfliktpar: to kampe med en fælles (mulig) spiller skal ligge mindst varighed + pause fra hinanden
    const prSpiller = new Map();
    for (const k of projekt.kampe) {
        if (!indeks.has(k.id)) continue;
        for (const s of k.muligeSpillere) { if (!prSpiller.has(s)) prSpiller.set(s, []); prSpiller.get(s).push(k); }
    }
    const par = new Map(); // "i|j" → gab (minutter)
    for (const liste of prSpiller.values()) {
        for (let i = 0; i < liste.length; i += 1) for (let j = i + 1; j < liste.length; j += 1) {
            const a = liste[i], b = liste[j];
            if (!kanDeleSpillere(a, b)) continue;
            const udenPause = a.fase === 'swiss' && b.fase === 'swiss' && a.tpRef.draw === b.tpRef.draw && kat(a)?.swissUdenPause;
            const mr = M.mellemrum(a, b);
            const gab = udenPause ? slotMin : Math.max(slotMin, mr.varighed + mr.pause);
            const ia = indeks.get(a.id), ib = indeks.get(b.id);
            const n = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
            if (!par.has(n) || par.get(n) < gab) par.set(n, gab);
        }
    }
    const konflikter = [];
    for (const [n, gab] of par) {
        const [i, j] = n.split('|').map(Number);
        const a = kampMap.get(kampe[i].id), b = kampMap.get(kampe[j].id);
        // Ordnet par: den ene bygger på den anden → ingen valgfri rækkefølge
        if (alleForfaedre(b.id).has(a.id)) konflikter.push([i, j, gab, 1]);
        else if (alleForfaedre(a.id).has(b.id)) konflikter.push([j, i, gab, 1]);
        else konflikter.push([i, j, gab, 0]);
    }

    // Anti-samtidighed (valgfri): HS/HD, DS/DD, MD i samme række ikke i samme slot
    const ikkeSamtidig = [];
    if (M.antiSamtidighed) {
        const prRaekke = new Map();
        for (const k of projekt.kampe) { if (!indeks.has(k.id)) continue; const rid = kat(k)?.raekke; if (!prRaekke.has(rid)) prRaekke.set(rid, []); prRaekke.get(rid).push(k); }
        for (const liste of prRaekke.values()) for (let i = 0; i < liste.length; i += 1) for (let j = i + 1; j < liste.length; j += 1) {
            if (katKonflikt(kat(liste[i])?.kat, kat(liste[j])?.kat)) ikkeSamtidig.push([indeks.get(liste[i].id), indeks.get(liste[j].id)]);
        }
    }

    // Max haltid: grupper af kampe, hvis første-til-sidste samme dag højst må være graense minutter.
    // Kendte spillere i rækker med grænse, og Swiss Ladder-lodtrækninger (alle er med i hver runde).
    const haltid = [];
    const prKendt = new Map();
    for (const k of projekt.kampe) { if (!indeks.has(k.id)) continue; for (const s of k.spillere) { if (!prKendt.has(s)) prKendt.set(s, []); prKendt.get(s).push(k); } }
    // Samme regel som Tjek: på en dag, hvor spilleren har en kamp i en række MED grænse, gælder
    // grænsen for alle spillerens kampe den dag. Kampene i rækken "udløser" grænsen; spillerens
    // kampe i andre rækker er kun bundet de dage, hvor en udløser også ligger. (Før blev den
    // mindste grænse lagt på alle dage — U9 om lørdagen begrænsede også søndagen.)
    // Med i spillerens haltid: de kendte kampe OG Swiss-runde 2+ i spillerens lodtrækninger
    const prHaltid = new Map();
    for (const [s, liste] of prKendt) prHaltid.set(s, [...liste]);
    for (const k of projekt.kampe) {
        if (k.fase !== 'swiss' || k.spillere.length || !indeks.has(k.id)) continue;
        for (const s of k.muligeSpillere) { if (!prHaltid.has(s)) prHaltid.set(s, []); prHaltid.get(s).push(k); }
    }
    for (const liste of prHaltid.values()) {
        if (liste.length < 2) continue;
        if (liste.every((k) => k.fase === 'swiss' && k.tpRef.draw === liste[0].tpRef.draw)) continue; // kun ét Swiss-forløb: dækket af gruppen for lodtrækningen nedenfor
        const prRaekke = new Map(); // rækker med grænse → spillerens kampe i rækken
        for (const k of liste) { const r = raekke(k); if (r?.maxHaltidMin) { if (!prRaekke.has(r.id)) prRaekke.set(r.id, { r, kampe: [] }); prRaekke.get(r.id).kampe.push(k); } }
        for (const { r, kampe: egne } of prRaekke.values()) {
            // rækken følger med, så løserens diagnose kan sige, HVIS grænse der spærrer
            const h = { kampe: liste.map((k) => indeks.get(k.id)), graense: r.maxHaltidMin, raekke: r.id };
            if (egne.length < liste.length) h.udloesere = egne.map((k) => indeks.get(k.id));
            haltid.push(h);
        }
    }
    const prSwiss = new Map();
    for (const k of projekt.kampe) { if (k.fase !== 'swiss' || !indeks.has(k.id) || !raekke(k)?.maxHaltidMin) continue; if (!prSwiss.has(k.tpRef.draw)) prSwiss.set(k.tpRef.draw, []); prSwiss.get(k.tpRef.draw).push(k); }
    for (const liste of prSwiss.values()) haltid.push({ kampe: liste.map((k) => indeks.get(k.id)), graense: raekke(liste[0]).maxHaltidMin, raekke: raekke(liste[0]).id });

    // Ventetid (blødt): kendte spilleres kampe som grupper; Swiss-lodtrækninger vægtes med antal spillere
    const spillerGrupper = [];
    for (const liste of prKendt.values()) if (liste.length > 1) spillerGrupper.push({ kampe: liste.map((k) => indeks.get(k.id)), vaegt: 1 });
    const swissAlle = new Map();
    for (const k of projekt.kampe) { if (k.fase !== 'swiss' || !indeks.has(k.id)) continue; if (!swissAlle.has(k.tpRef.draw)) swissAlle.set(k.tpRef.draw, []); swissAlle.get(k.tpRef.draw).push(k); }
    for (const liste of swissAlle.values()) {
        const antalSpillere = Math.max(...liste.map((k) => k.muligeSpillere.length), 2);
        if (liste.length > 1) spillerGrupper.push({ kampe: liste.map((k) => indeks.get(k.id)), vaegt: antalSpillere });
    }

    // Max dage pr. række
    const maxDage = projekt.raekker.filter((r) => M.maxDageFor(r) && (r.dage || []).length > M.maxDageFor(r))
        .map((r) => ({ raekke: r.id, max: M.maxDageFor(r), kampe: kampe.map((k, i) => (k.raekke === r.id ? i : -1)).filter((i) => i >= 0) }));

    // Max kampe pr. spiller pr. dag
    // Spillere med en strengere grænse end turneringens (senior på én dag: 10 i stedet for 12) får deres egen gruppe
    const mangeKampe = [], egenGraense = [];
    for (const l of prKendt.values()) {
        const graense = M.maxPrDagForKampe(l);
        if (l.length <= graense) continue;
        if (graense === maxPrDag) mangeKampe.push(l.map((k) => indeks.get(k.id)));
        else egenGraense.push({ kampe: l.map((k) => indeks.get(k.id)), max: graense });
    }

    // Senior E/M: max kampe pr. kategori pr. spiller pr. dag, og kvartfinalen ikke samme dag som kategoriens
    // semifinale eller finale (de to må gerne dele dag)
    const maxPrGruppe = [], ikkeSammeDag = [];
    {
        const prSpillerKat = new Map();
        const finaler = new Map(); // kategori → { Kvartfinale: [i], Semifinale: [i], Finale: [i] }
        for (const k of projekt.kampe) {
            if (!indeks.has(k.id) || !M.seniorEM(raekke(k))) continue;
            for (const s of k.spillere) { const n = `${s}|${k.kategori}`; if (!prSpillerKat.has(n)) prSpillerKat.set(n, []); prSpillerKat.get(n).push(indeks.get(k.id)); }
            if (M.erFinalerunde(k)) {
                if (!finaler.has(k.kategori)) finaler.set(k.kategori, { Kvartfinale: [], Semifinale: [], Finale: [] });
                finaler.get(k.kategori)[k.rundeNavn].push(indeks.get(k.id));
            }
        }
        maxPrGruppe.push(...egenGraense);
        for (const liste of prSpillerKat.values()) if (liste.length > M.regler.seniorMaxPrKategori) maxPrGruppe.push({ kampe: liste, max: M.regler.seniorMaxPrKategori });
        for (const f of finaler.values()) for (const a of f.Kvartfinale) for (const b of [...f.Semifinale, ...f.Finale]) ikkeSammeDag.push([a, b]);
    }

    return {
        version: 1,
        slotMin,
        dage: dage.map((d, i) => ({ index: i, start: minutter(d.start), slut: minutter(d.slut), baner: d.baner })),
        kapacitet, kampe, foer, konflikter, ikkeSamtidig, haltid, spillerGrupper, maxDage,
        maxKampePrDag: maxPrDag, mangeKampe, maxPrGruppe, ikkeSammeDag, alternativer,
        vaegte: vaegteFor(projekt),
    };
}

/** Oversætter løserens svar (kamp-id → global tid) til en plan. */
export function planFraSvar(projekt, svar) {
    const dage = projekt.opsaetning.dage;
    const plan = {};
    for (const [id, t] of Object.entries(svar.tider || {})) {
        const dag = dage[Math.floor(t / DAG_MIN)];
        if (dag) plan[id] = { dag: dag.dato, slot: klokkeFraMinutter(t % DAG_MIN) };
    }
    return plan;
}

/**
 * Oversætter løserens diagnose ("hvorfor findes der ingen lovlig plan?") til tekst og til
 * handlinger, brugeren kan vælge: { tekst, handlinger: [{ tekst, raekke, aendring }] }.
 * aendring er felter til opdaterRaekke (fx { maxHaltidMin: 300 }).
 */
export function diagnoseTekst(diagnose, alleDage = []) {
    const linjer = [], handlinger = [];
    for (const d of diagnose || []) {
        if (d.regel === 'haltid') {
            if (d.forslag) {
                linjer.push(`${d.raekke}: max haltid på ${d.graense} min kan ikke overholdes — med ${d.forslag} min findes der en lovlig plan.`);
                handlinger.push({ tekst: `Sæt ${d.raekke} til max ${d.forslag} min i hallen, og optimér igen`, raekke: d.raekke, aendring: { maxHaltidMin: d.forslag } });
            } else {
                linjer.push(`${d.raekke}: max haltid på ${d.graense} min kan ikke overholdes, heller ikke med 3 timer mere — kun helt uden grænsen findes der en plan.`);
                handlinger.push({ tekst: `Fjern grænsen for haltid i ${d.raekke}, og optimér igen`, raekke: d.raekke, aendring: { maxHaltidMin: null } });
            }
        } else if (d.regel === 'maxDage') {
            linjer.push(`${d.raekke}: kampene kan ikke være på én dag inden for rækkens tidsrum og baner. Over flere dage findes der en lovlig plan (kræver dispensation) — eller giv rækken et længere tidsrum, flere baner eller færre kampe.`);
            handlinger.push({ tekst: `Giv ${d.raekke} dispensation til flere dage, og optimér igen`, raekke: d.raekke, aendring: { dispensationFlereDage: true } });
        } else if (d.regel === 'tidsrum') {
            linjer.push(`${d.raekke}: rækkens eget tidsrum er for snævert til kampene — uden det (kun årgangens tidsvindue) findes der en lovlig plan.`);
            handlinger.push({ tekst: `Fjern tidsrummet for ${d.raekke}, og optimér igen`, raekke: d.raekke, aendring: { tidligst: null, senest: null } });
        } else if (d.regel === 'dage') {
            linjer.push(`${d.raekke}: kampene kan ikke være på de dage, rækken er sat til — må rækken bruge alle turneringens dage, findes der en lovlig plan.`);
            if (alleDage.length) handlinger.push({ tekst: `Lad ${d.raekke} spille alle turneringens dage, og optimér igen`, raekke: d.raekke, aendring: { dage: [...alleDage] } });
        } else if (d.regel === 'maxKampePrDag') {
            linjer.push('Grænsen for antal kampe pr. spiller pr. dag kan ikke overholdes — hæv den under "Reglementets grænser" i fane 1, eller fordel kategorierne på flere dage.');
        } else if (d.regel === 'flere') {
            linjer.push('Ingen enkelt regel er årsagen: først når max haltid, max dage og max kampe pr. dag lempes samtidig, findes der en plan. Brug "Find forslag, der får kabalen til at gå op".');
        } else if (d.regel === 'plads') {
            linjer.push('Der er ikke plads: hverken max haltid, max dage, max kampe pr. dag eller en enkelt rækkes tidsrum eller dage er årsagen — kampene kan ikke være på banerne inden for tidsvinduerne (eller låste kampe står i vejen). Brug "Find forslag, der får kabalen til at gå op", eller giv flere baner, længere dage eller flere spilledage.');
        }
    }
    if (!linjer.length) linjer.push('Løseren kunne ikke pege på én bestemt regel inden for tiden.');
    return { tekst: linjer.join(' '), handlinger };
}

/**
 * Hvad er der sket med projektet, mens løseren regnede?
 *   'uaendret'       — intet af betydning (kvitteringer tæller ikke)
 *   'aendret'        — samme kampe, men plan, låse eller opsætning er rettet → spørg, før resultatet lægges ind
 *   'andet-projekt'  — andre kampe eller en anden fil → resultatet hører ikke til her
 *   'lukket'         — projektet er lukket
 */
export function aendretUnderOptimering(start, nu) {
    if (!nu) return 'lukket';
    if (nu === start) return 'uaendret';
    const sammeKampe = (nu.kilde?.filnavn || '') === (start.kilde?.filnavn || '') && nu.kampe.length === start.kampe.length
        && nu.kampe.every((x, i) => x.id === start.kampe[i].id && x.spillere.join() === start.kampe[i].spillere.join());
    if (!sammeKampe) return 'andet-projekt';
    const del = (p) => JSON.stringify([p.plan, [...(p.laast || [])].sort(), p.opsaetning, p.raekker, p.kategorier]);
    return del(nu) === del(start) ? 'uaendret' : 'aendret';
}

/** Løserens plan lagt ind i projektet, som det er NU: kampe, der er låst, beholder deres nuværende tid. */
export function flettetPlan(nu, loeserPlan) {
    const plan = { ...loeserPlan };
    for (const id of nu.laast || []) if (nu.plan[id]) plan[id] = nu.plan[id];
    return plan;
}

/** Tilfældigt job-id, så en igangværende løsning kan stoppes med stopLoeser(). */
export function nytJobId() {
    const b = new Uint8Array(12);
    // Ældre Node (CI kører 18) har ikke crypto som global; id'et er kun et håndtag til "Stop", ikke en hemmelighed
    if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b);
    else for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Beder løseren stoppe nu og aflevere den bedste plan hidtil (svaret kommer i det oprindelige optimer()-kald). */
/** Som stopLoeser, men til når siden lukkes: sendBeacon overlever, at fanen forsvinder. */
export function stopVedLukning(job, url = '/api/solve/stop') {
    try { return !!globalThis.navigator?.sendBeacon?.(url, new Blob([JSON.stringify({ job })], { type: 'application/json' })); } catch { return false; }
}

export async function stopLoeser(job, url = '/api/solve/stop') {
    const svar = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job }) });
    return svar.ok;
}

/**
 * Kalder løseren. Returnerer { status, plan, sekunder, maal, graense } eller kaster ved netværksfejl.
 * status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'UNKNOWN'
 */
export async function optimer(projekt, { sekunder = 30, hintPlan = null, url = '/api/solve', signal, job = null, pollMs = 3000, vedStatus = null } = {}) {
    const problem = bygProblem(projekt, hintPlan);
    // Jobbet startes og hentes med korte kald (start → status hvert par sekunder), så ingen
    // forbindelse står åben i flere minutter — proxyer som Cloudflare afbryder dem efter ca. 100 s.
    const svar = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ problem, sekunder, asynkron: true, ...(job ? { job } : {}) }), signal });
    if (!svar.ok) throw new Error(svar.status === 429 ? 'Løseren er optaget — prøv igen om lidt.' : `Løseren svarede ${svar.status}`);
    let data = await svar.json();
    const jobId = data.job || job;
    let fejlIRap = 0;
    const frist = Date.now() + (sekunder + 90) * 1000;
    while (data.status === 'REGNER') {
        if (Date.now() > frist) throw new Error('Løseren svarede ikke inden for tiden.');
        await new Promise((r) => setTimeout(r, pollMs));
        if (signal?.aborted) throw new Error('Afbrudt.');
        try {
            const s = await fetch(`${url}/status?job=${encodeURIComponent(jobId)}`, { signal });
            if (s.status === 404) throw Object.assign(new Error('Løseren kender ikke længere jobbet (den er måske blevet genstartet).'), { endelig: true });
            if (s.status >= 500 || s.status === 429) throw new Error(`Løseren svarede ${s.status}`); // forbigående: prøv igen
            data = await s.json();
            if (s.ok && data.status === 'REGNER' && vedStatus) vedStatus(data);
            if (!s.ok) throw Object.assign(new Error(data.fejl || `Løseren svarede ${s.status}`), { endelig: true });
            fejlIRap = 0;
        } catch (err) {
            fejlIRap += 1;
            if (err.endelig || fejlIRap >= 5) throw err;
            data = { status: 'REGNER' };
        }
    }
    return { ...data, plan: planFraSvar(projekt, data) };
}
