// "Lav kampprogram" (designkritikken 2026-10-09, fase B): én handling, der kører hele kæden selv —
// kamplængde og pause, turneringsform, det bedste af flere forslag — og, når programmet ikke går op,
// beslutningskort med løsninger, der ALLEREDE er afprøvet med planlæggeren.
//
// Motorens regler ændres ikke her (Jesper 2026-10-09): planlæggeren (lavForslag/lavAlternativer) lægger
// stadig alle kampe og bryder reglerne i den aftalte rækkefølge. Kortene foreslår kun ændringer af
// opsætningen, som brugeren selv kunne have lavet, og viser, hvad hver ændring giver.
import { lavForslag, lavAlternativer } from './scheduler.js';
import { genberegnKampe, saetSlotMin, opdaterOpsaetning, opdaterRaekke, opdaterDag, opdaterPause, anvendForslag } from './store.js';
import { sammenlignKamplaengder, bedsteKamplaengde, erUdenPause } from './kamplaengde.js';
import { alleNedskaeringer, anvendNedskaering } from './nedskaering.js';
import { minutter } from './tp-reader.js';

const opremsning = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} og ${xs[xs.length - 1]}`);
const klokke = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const pauseNoegle = (p) => ['ABCD', 'M', 'E', 'faelles'].map((x) => p?.[x] ?? null).join('|');

// ── Autopilot ─────────────────────────────────────────────────

/**
 * Laver kampprogrammet: vælger kamplængde og pause ud fra sammenligningen (Jesper: autopiloten må selv vælge
 * og skal vise valget), bygger kampene og tager det bedste af de alternative forslag. Låste kampe beholder
 * deres tid — og så røres kamplængden ikke, for låste kampe ligger i det nuværende slot-gitter.
 * Returnerer { projekt, forslag, valg } — valg: { minutter, udenPause, aendret, foer: { slotMin, pauseMin }, grund }.
 */
/**
 * Hører panelet fra "Lav kampprogram" (kp) stadig til projektet? Ja, så længe kampene og opsætningen er de samme:
 * at flytte, låse eller kvittere fjerner ikke beslutningskortene (Fable-gennemgangen 2026-10-10, V5).
 * Store-funktionerne laver nye objekter for det, de ændrer, så samme objekt = uændret.
 */
export function panelGaelder(kp, projekt) {
    if (!kp || !projekt) return false;
    const a = kp.projekt;
    return a === projekt || (a.kampe === projekt.kampe && a.opsaetning === projekt.opsaetning && a.raekker === projekt.raekker && a.kategorier === projekt.kategorier);
}

export function lavKampprogram(projekt, { fastKamplaengde = false } = {}) {
    const foer = { slotMin: projekt.opsaetning.slotMin, pauseMin: projekt.opsaetning.pauseMin };
    let p = projekt;
    let grund = null;
    let bedst = null;
    if (fastKamplaengde) grund = 'fast';
    else if ((projekt.laast || []).length) grund = 'laast';
    else {
        bedst = bedsteKamplaengde(sammenlignKamplaengder(projekt));
        if (bedst) p = opdaterOpsaetning(saetSlotMin(p, bedst.minutter), { pauseMin: { ...bedst.pauseMin } });
    }
    p = genberegnKampe(p);
    const alternativer = lavAlternativer(p);
    const forslag = alternativer[0] || lavForslag(p);
    const o = p.opsaetning;
    const valg = {
        minutter: o.slotMin,
        udenPause: erUdenPause(o.pauseMin),
        aendret: o.slotMin !== foer.slotMin || pauseNoegle(o.pauseMin) !== pauseNoegle(foer.pauseMin),
        foer,
        grund,
    };
    return { projekt: anvendForslag(p, forslag), forslag, valg };
}

// ── Beslutninger ──────────────────────────────────────────────

/**
 * Hvad der må give sig, når programmet ikke går op — i den rækkefølge, løsningerne anbefales. Brugeren kan
 * ændre rækkefølgen under Avanceret (opsaetning.prisOrden). Der foreslås aldrig flere baner end dagens.
 */
// Standardrækkefølgen er Jespers (2026-10-10): pausen på dagen og færre runder før længere dag og tidsrum
export const PRIS = [
    { id: 'pause', navn: 'Pausen gives på dagen i stedet for i planen' },
    { id: 'runder', navn: 'Færre kampe (runder)' },
    { id: 'dag', navn: 'Længere spilledag' },
    { id: 'tidsrum', navn: 'Længere tidsrum for rækken' },
    { id: 'baner', navn: 'Flere af dagens baner reserveret til rækken' },
    { id: 'samtidighed', navn: 'Single og double må ligge samtidig' },
    { id: 'flyt', navn: 'Rækken flyttes til en anden dag' },
    { id: 'dispensation', navn: 'Noget, der kræver dispensation' },
];
export const STANDARD_PRIS_ORDEN = PRIS.map((x) => x.id);

export function prisOrden(projekt) {
    const valgt = (projekt.opsaetning.prisOrden || []).filter((id) => STANDARD_PRIS_ORDEN.includes(id));
    return [...valgt, ...STANDARD_PRIS_ORDEN.filter((id) => !valgt.includes(id))];
}

// Planlæggerens brud og årsager samlet i familier, der hver får ét kort pr. række
const FAMILIE = {
    'tidsrum': 'tidsrum', 'efter rækkens seneste slut': 'tidsrum', 'før rækkens tidligste start': 'tidsrum',
    'reserveret': 'tidsrum', 'ingen ledig reserveret bane': 'tidsrum',
    'pause': 'pause', 'spiller mangler pause': 'pause',
    'anti-samtidighed': 'samtidighed', 'single og double samtidig i rækken': 'samtidighed',
    'max-haltid': 'haltid',
    'dag': 'dage', 'rækken spiller ikke den dag': 'dage', 'rækken har ingen dage': 'dage',
};
const familieFor = (x) => FAMILIE[x.brud || x.aarsag] || 'plads';
const PLADS_TEKST = {
    'kapacitet': 'ingen ledig bane', 'ingen ledig bane': 'ingen ledig bane', 'ingen ledig plads': 'ingen ledig bane',
    'tidsvindue': 'uden for årgangens tidsvindue', 'uden for tidsvinduet': 'uden for årgangens tidsvindue',
    'max-kampe': 'for mange kampe pr. spiller pr. dag', 'spiller har max kampe den dag': 'for mange kampe pr. spiller pr. dag',
    'raekkefoelge': 'før de kampe, de bygger på', 'dobbeltbooket': 'spiller i to kampe samtidig',
    'spiller er i en anden kamp i slottet': 'spiller i to kampe samtidig',
};

/** Planlæggerens problemer (regelbrud + kampe uden tid) samlet pr. familie og række. */
function grupper(projekt, forslag) {
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const ud = new Map();
    for (const x of [...(forslag.brud || []), ...(forslag.ikkePlaceret || [])]) {
        const k = kampMap.get(x.id);
        if (!k) continue;
        const raekke = katMap.get(k.kategori)?.raekke || '';
        const familie = familieFor(x);
        const n = `${familie}|${raekke}`;
        if (!ud.has(n)) ud.set(n, { noegle: n, familie, raekke, kampe: [], aarsager: new Set() });
        const g = ud.get(n);
        g.kampe.push({ ...x, k, dag: x.detalje?.dag || forslag.plan?.[x.id]?.dag || null });
        g.aarsager.add(x.brud || x.aarsag);
    }
    return [...ud.values()];
}

function titelFor(projekt, g) {
    const r = projekt.raekker.find((x) => x.id === g.raekke);
    const n = g.kampe.length;
    const hvem = `${n} ${n === 1 ? 'kamp' : 'kampe'} i ${g.raekke}`;
    if (g.familie === 'tidsrum') return `${hvem} kan ikke ligge inden for rækkens tidsrum${r?.tidligst || r?.senest ? ` (${r?.tidligst || '–'}–${r?.senest || '–'})` : ''}${r?.reserveredeBaner ? ` på dens ${r.reserveredeBaner} reserverede baner` : ''}`;
    if (g.familie === 'pause') return `${hvem} får kortere pause end planens pause`;
    if (g.familie === 'samtidighed') return `${hvem}: single og double ligger samtidig`;
    if (g.familie === 'haltid') return `${g.raekke}: singlerne kan ikke afvikles inden for ${r?.maxHaltidMin || '?'} min`;
    if (g.familie === 'dage') return `${hvem} ligger på en dag, rækken ikke spiller`;
    const grunde = [...new Set([...g.aarsager].map((a) => PLADS_TEKST[a] || a))];
    return `${hvem} har ikke lovlig plads (${grunde.join(', ')})`;
}

/** Udfører en ændring på projektet. Ændringen er ren data, så den kan gemmes i UI-tilstanden. */
export function anvendAendring(projekt, a) {
    if (a.type === 'raekke') return genberegnKampe(opdaterRaekke(projekt, a.raekke, a.aendring));
    if (a.type === 'dag') return genberegnKampe(opdaterDag(projekt, a.dato, a.aendring));
    if (a.type === 'pause') return genberegnKampe(opdaterPause(projekt, a.klasse, a.minutter));
    if (a.type === 'opsaetning') return genberegnKampe(opdaterOpsaetning(projekt, a.aendring));
    if (a.type === 'nedskaering') return anvendNedskaering(projekt, a.forslag).projekt;
    return projekt;
}

const brudI = (f) => (f.brud?.length || 0) + (f.ikkePlaceret?.length || 0);

/** Sidste sluttid pr. række i en plan (klokkeslæt for sidste kamps slut). */
function raekkeSlut(projekt, plan, raekkeId) {
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    let slut = null;
    for (const k of projekt.kampe) {
        if (katMap.get(k.kategori)?.raekke !== raekkeId || !plan[k.id]) continue;
        const t = minutter(plan[k.id].slot) + projekt.opsaetning.slotMin;
        if (slut === null || t > slut) slut = t;
    }
    return slut === null ? null : klokke(slut);
}

/**
 * Afprøver en ændring: kampene bygges igen, planlæggeren laver et forslag, og resultatet sammenlignes med
 * udgangspunktet. loest: kortets egne problemer er væk; gaarOp: ingen regelbrud tilbage overhovedet.
 */
function afproev(projekt, foer, g, aendring) {
    const p = anvendAendring(projekt, aendring);
    const f = lavForslag(p);
    const brud = brudI(f);
    const tilbage = grupper(p, f).find((x) => x.noegle === g.noegle);
    const konsekvens = [];
    const slutFoer = foer.f.statistik?.slutPrDag || {};
    for (const [d, t] of Object.entries(f.statistik?.slutPrDag || {})) {
        const f0 = slutFoer[d];
        if (f0 && t !== f0) konsekvens.push(`${d.slice(8, 10)}/${Number(d.slice(5, 7))}: dagen slutter ${t} (nu ${f0})`);
    }
    const rs = raekkeSlut(p, f.plan, g.raekke);
    if (rs && (aendring.pris === 'tidsrum' || aendring.pris === 'baner')) konsekvens.unshift(`${g.raekke} slutter ${rs}`);
    return { brudEfter: brud, loest: !tilbage, gaarOp: brud === 0, bedre: brud < foer.brud, konsekvens };
}

/** Kandidat-ændringer for et kort. Hver: { tekst, pris, type, ... }. Flere trin prøves, til kortet er løst. */
function kandidater(projekt, g) {
    const o = projekt.opsaetning;
    const r = projekt.raekker.find((x) => x.id === g.raekke);
    const ud = [];
    const trin = [1, 2, 3, 4].map((n) => n * o.slotMin);
    const dage = (r?.dage || []).map((d) => o.dage.find((x) => x.dato === d)).filter(Boolean);
    const andreDage = o.dage.filter((d) => !(r?.dage || []).includes(d.dato));
    const kortDato = (d) => `${d.slice(8, 10)}/${Number(d.slice(5, 7))}`;
    const forlaengDag = () => {
        for (const d of dage) ud.push({ gruppe: `dag-${d.dato}`, trin: trin.map((m) => ({ tekst: `Forlæng ${kortDato(d.dato)} til ${klokke(minutter(d.slut) + m)}`, pris: 'dag', type: 'dag', dato: d.dato, aendring: { slut: klokke(minutter(d.slut) + m) } })) });
    };
    const flereReserverede = () => {
        const maks = Math.min(...dage.map((d) => d.baner));
        if (!r?.reserveredeBaner || !Number.isFinite(maks)) return;
        const muligt = [1, 2].map((n) => r.reserveredeBaner + n).filter((n) => n <= maks);
        if (muligt.length) ud.push({ gruppe: 'baner', trin: muligt.map((n) => ({ tekst: `Reservér ${n} af dagens baner til ${g.raekke} (nu ${r.reserveredeBaner})`, pris: 'baner', type: 'raekke', raekke: g.raekke, aendring: { reserveredeBaner: n } })) });
    };
    if (g.familie === 'tidsrum') {
        if (r?.senest) ud.push({ gruppe: 'senest', trin: trin.map((m) => ({ tekst: `Udvid ${g.raekke} til ${klokke(minutter(r.senest) + m)}`, pris: 'tidsrum', type: 'raekke', raekke: g.raekke, aendring: { senest: klokke(minutter(r.senest) + m) } })) });
        if (r?.tidligst && g.aarsager.has('før rækkens tidligste start')) ud.push({ gruppe: 'tidligst', trin: trin.map((m) => ({ tekst: `Lad ${g.raekke} starte ${klokke(Math.max(0, minutter(r.tidligst) - m))}`, pris: 'tidsrum', type: 'raekke', raekke: g.raekke, aendring: { tidligst: klokke(Math.max(0, minutter(r.tidligst) - m)) } })) });
        flereReserverede();
    } else if (g.familie === 'pause') {
        // Pause på dagen: 0 min i planen; den fælles pause (M + A–D) gælder for alle andre end E, så den nulstilles med
        const klasse = r?.pauseKlasse || 'ABCD';
        const faelles = o.pauseMin?.faelles != null && klasse !== 'E';
        if (o.pauseMin?.[klasse] || (faelles && o.pauseMin.faelles)) {
            ud.push({ gruppe: 'pause', trin: [{ tekst: `Pausen for ${klasse === 'ABCD' ? 'A–D' : klasse}${faelles ? ' (og den fælles pause)' : ''} gives på dagen, 0 min i planen`, pris: 'pause', type: 'opsaetning', aendring: { pauseMin: { ...o.pauseMin, [klasse]: 0, ...(faelles ? { faelles: 0 } : {}) } } }] });
        }
        forlaengDag();
    } else if (g.familie === 'samtidighed') {
        ud.push({ gruppe: 'samtidighed', trin: [{ tekst: 'Tillad single og double samtidig', pris: 'samtidighed', type: 'opsaetning', aendring: { antiSamtidighed: false } }] });
        forlaengDag();
    } else if (g.familie === 'haltid') {
        flereReserverede();
        if (r?.maxHaltidMin) ud.push({ gruppe: 'haltid', trin: [30, 60, 90].map((m) => ({ tekst: `Hæv max varighed for ${g.raekke}s singler til ${r.maxHaltidMin + m} min`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { maxHaltidMin: r.maxHaltidMin + m } })) });
    } else if (g.familie === 'plads') {
        forlaengDag();
        if (r && r.dage.length === 1) for (const d of andreDage) ud.push({ gruppe: `flyt-${d.dato}`, trin: [{ tekst: `Flyt ${g.raekke} til ${kortDato(d.dato)}`, pris: 'flyt', type: 'raekke', raekke: g.raekke, aendring: { dage: [d.dato] } }] });
        if (r && andreDage.length && r.maxDage && r.dage.length >= r.maxDage && !r.dispensationFlereDage) {
            ud.push({ gruppe: 'flere-dage', trin: [{ tekst: `Lad ${g.raekke} spille over flere dage`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { dage: [...new Set([...r.dage, ...andreDage.map((d) => d.dato)])].sort(), dispensationFlereDage: true } }] });
        }
    }
    if (g.familie === 'dage' && r) {
        const mangler = [...new Set(g.kampe.map((x) => x.dag).filter((d) => d && !r.dage.includes(d)))];
        if (mangler.length) ud.push({ gruppe: 'dage', trin: [{ tekst: `Lad ${g.raekke} spille ${mangler.map(kortDato).join(' og ')} også`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { dage: [...new Set([...r.dage, ...mangler])].sort(), dispensationFlereDage: true } }] });
        // Rækken har flere dage valgt, men må kun spille én (max dage): dispensation til at bruge dem
        else if (r.maxDage && r.dage.length > r.maxDage && !r.dispensationFlereDage) ud.push({ gruppe: 'dage', trin: [{ tekst: `Lad ${g.raekke} spille over flere dage`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { dispensationFlereDage: true } }] });
    }
    return ud;
}

/**
 * Beslutningskort for et lagt program: ét kort pr. problem (familie × række), hvert med afprøvede løsninger
 * sorteret efter prisrækkefølgen. Kun løsninger, der giver færre regelbrud, vises; "behold" er altid et valg i UI.
 * Returnerer { brud, kort: [{ noegle, titel, familie, raekke, antal, valg: [{ tekst, pris, prisNavn, aendring,
 * brudEfter, loest, gaarOp, konsekvens }] }] }.
 */
export function lavBeslutninger(projekt, forslag, { medNedskaering = true } = {}) {
    const foer = { f: forslag, brud: brudI(forslag) };
    if (!foer.brud) return { brud: 0, kort: [] };
    const orden = prisOrden(projekt);
    const prisNavn = Object.fromEntries(PRIS.map((x) => [x.id, x.navn]));
    const kort = [];
    let nedskaeringer = null;
    for (const g of grupper(projekt, forslag)) {
        const valg = [];
        for (const k of kandidater(projekt, g)) {
            // Trinene prøves fra det mindste: det første, der løser kortet, vises; ellers det bedste
            let bedst = null;
            for (const t of k.trin) {
                const res = afproev(projekt, foer, g, t);
                if (!res.bedre) continue;
                if (!bedst || res.brudEfter < bedst.brudEfter) bedst = { ...t, ...res };
                if (res.loest) break;
            }
            if (bedst) valg.push(bedst);
        }
        // Færre runder er dyrt at regne ud — prøves kun, når intet billigere løser kortet
        // — dvs. kun når ingen løsning, der står FØR "færre runder" i prisrækkefølgen, løser kortet
        const runderRang = orden.indexOf('runder');
        if (medNedskaering && g.familie === 'plads' && !valg.some((v) => v.loest && orden.indexOf(v.pris) < runderRang)) {
            nedskaeringer ??= alleNedskaeringer(projekt).filter((f) => f.loest || f.brudEfter < f.brudFoer);
            for (const f of nedskaeringer) {
                const toDage = f.raekkerToDage?.length ? f.raekkerToDage : null;
                const skaerer = f.kampeEfter !== f.kampeFoer;
                const pris = toDage ? 'dispensation' : 'runder';
                const tekst = [toDage ? `Lad ${opremsning(toDage)} spille over to dage` : '', skaerer ? `${toDage ? 'og skær' : 'Skær'} i runderne (${f.navn.toLowerCase()})` : ''].filter(Boolean).join(' ') || f.navn;
                const aendring = { tekst, pris, type: 'nedskaering', forslag: f };
                const res = afproev(projekt, foer, g, aendring);
                if (!res.bedre) continue;
                // Kun det, der ÆNDRES: spillere under minimum kan også skyldes TP's lodtrækning og fandtes før
                if (skaerer) res.konsekvens.unshift(`${f.kampeFoer} → ${f.kampeEfter} kampe`);
                if (f.spillereUnderKravEfter !== f.spillereUnderKravFoer) res.konsekvens.unshift(`spillere under reglementets minimum: ${f.spillereUnderKravFoer} → ${f.spillereUnderKravEfter}`);
                valg.push({ ...aendring, ...res });
            }
        }
        const rang = (v) => [v.loest ? 0 : 1, orden.indexOf(v.pris), v.brudEfter];
        valg.sort((a, b) => { const x = rang(a), y = rang(b); for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
        kort.push({ noegle: g.noegle, titel: titelFor(projekt, g), familie: g.familie, raekke: g.raekke, antal: g.kampe.length, valg: valg.slice(0, 4).map((v) => ({ ...v, prisNavn: prisNavn[v.pris] })) });
    }
    // Kort, hvis anbefalede løsning er den samme (fx "lad tre rækker spille over to dage"), bliver til ét kort
    const samlet = [];
    for (const k of kort) {
        const n = k.valg[0] ? k.valg[0].tekst : null;
        const ens = n && samlet.find((x) => x.valg[0]?.tekst === n);
        if (ens) { ens.flere = [...(ens.flere || []), k.titel]; ens.antal += k.antal; ens.noegler.push(k.noegle); } else samlet.push({ ...k, noegler: [k.noegle] });
    }
    kort.splice(0, kort.length, ...samlet);
    // Kort med en løsning, der får hele programmet til at gå op, først — det er dem, der flytter mest
    kort.sort((a, b) => (b.valg.some((v) => v.gaarOp) - a.valg.some((v) => v.gaarOp)));
    return { brud: foer.brud, kort };
}
