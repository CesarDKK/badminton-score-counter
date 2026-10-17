// "Lav kampprogram" (designkritikken 2026-10-09, fase B): én handling, der kører hele kæden selv —
// kamplængde og pause, turneringsform, det bedste af flere forslag — og, når programmet ikke går op,
// beslutningskort med løsninger, der ALLEREDE er afprøvet med planlæggeren.
//
// Motorens regler ændres ikke her (Jesper 2026-10-09): planlæggeren (lavForslag/lavAlternativer) lægger
// stadig alle kampe og bryder reglerne i den aftalte rækkefølge. Kortene foreslår kun ændringer af
// opsætningen, som brugeren selv kunne have lavet, og viser, hvad hver ændring giver.
import { lavForslag, lavAlternativer } from './scheduler.js';
import { genberegnKampe, saetSlotMin, opdaterOpsaetning, opdaterRaekke, opdaterDag, opdaterPause, anvendForslag, saetForm, opdaterKategori } from './store.js';
import { effektivForm, maxSwissGrupper, swissGruppeFordeling } from './form.js';
import { sammenlignKamplaengder, bedsteKamplaengde, erUdenPause, kandidatLaengder } from './kamplaengde.js';
import { alleNedskaeringer, anvendNedskaering } from './nedskaering.js';
import { minutter } from './tp-reader.js';
import { standardMaxDage, lavRegelmodel, varighedsSpaend, VARIGHEDER } from './regelmodel.js';
import { reglerFor } from './regler.js';

const opremsning = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} og ${xs[xs.length - 1]}`);
const klokke = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const pauseNoegle = (p) => ['ABCD', 'M', 'E', 'faelles'].map((x) => p?.[x] ?? null).join('|');

// ── Autopilot ─────────────────────────────────────────────────

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

/**
 * Laver kampprogrammet: vælger kamplængde og pause ud fra sammenligningen (Jesper: autopiloten må selv vælge
 * og skal vise valget), bygger kampene og tager det bedste af de alternative forslag. Låste kampe beholder
 * deres tid — og så røres kamplængden ikke, for låste kampe ligger i det nuværende slot-gitter.
 * Returnerer { projekt, forslag, valg } — valg: { minutter, udenPause, aendret, foer: { slotMin, pauseMin }, grund }.
 */
export function lavKampprogram(projekt, { fastKamplaengde = false, behold = false } = {}) {
    // "Planlæg kun kampe uden tid" (gennemgangen 2026-10-11, U6/I2): efter et afbud eller en ny lodtrækning i TP skal
    // programmet, spillerne har set, blive stående — alle kampe med tid låses midlertidigt, og kun resten planlægges
    const oprLaast = projekt.laast || [];
    if (behold) {
        const medTid = projekt.kampe.filter((k) => projekt.plan[k.id]).map((k) => k.id);
        projekt = { ...projekt, laast: [...new Set([...oprLaast, ...medTid])] };
        fastKamplaengde = true;
    }
    const foer = { slotMin: projekt.opsaetning.slotMin, pauseMin: projekt.opsaetning.pauseMin };
    let p = projekt;
    let grund = null;
    let bedst = null;
    if (behold) grund = 'behold';
    else if (fastKamplaengde) grund = 'fast';
    else if ((projekt.laast || []).length) grund = 'laast';
    else {
        bedst = bedsteKamplaengde(sammenlignKamplaengder(medMiddelvej(projekt, () => false)));
        if (bedst) p = opdaterOpsaetning(saetSlotMin(p, bedst.minutter), { pauseMin: { ...bedst.pauseMin } });
    }
    // Først til minimum (ingen middelvej) — så vurderes pladsen på det, der SKAL være plads til. Ikke ved "kun kampe uden
    // tid" eller låste kampe: der må ingen kampe med tid forsvinde, så kategoriernes valg bliver stående
    const nulstil = !behold && !(projekt.laast || []).length;
    p = genberegnKampe(nulstil ? medMiddelvej(p, () => false) : p);
    const alternativer = lavAlternativer(p);
    let forslag = alternativer[0] || lavForslag(p);
    // Middelvejen for U9/U11 (Jesper 2026-10-12): kun når der er god plads — dvs. når programmet går op, og det STADIG går op
    // med de ekstra kampe. Først alle kategorier, ellers kun singlerne (hvor 4 → 5 kampe betyder mest).
    const middelvej = [];
    const kandidater = p.kategorier.filter((k) => erMiddelvejKandidat(p, k));
    if (kandidater.length && nulstil && brudI(forslag) === 0) {
        for (const med of [() => true, (k) => k.type === 'single']) {
            const q = genberegnKampe(medMiddelvej(p, (k) => kandidater.includes(k) && med(k)));
            const loeftet = q.kategorier.filter((k) => (q.kampe.filter((x) => x.kategori === k.id).length > p.kampe.filter((x) => x.kategori === k.id).length));
            if (!loeftet.length) continue;
            const fq = lavAlternativer(q)[0] || lavForslag(q);
            if (brudI(fq) > 0) continue;
            p = medMiddelvej(q, (k) => loeftet.some((x) => x.id === k.id));
            forslag = fq;
            middelvej.push(...loeftet.map((k) => `${k.id} (${k.formForslag?.minKampe}–${k.formForslag?.maxKampe} kampe)`));
            break;
        }
    }
    const o = p.opsaetning;
    const valg = {
        minutter: o.slotMin,
        udenPause: erUdenPause(o.pauseMin),
        aendret: o.slotMin !== foer.slotMin || pauseNoegle(o.pauseMin) !== pauseNoegle(foer.pauseMin),
        foer,
        grund,
        middelvej,
    };
    return { projekt: { ...anvendForslag(p, forslag), laast: oprLaast }, forslag, valg };
}

// ── Beslutninger ──────────────────────────────────────────────

/**
 * Hvad der må give sig, når programmet ikke går op — i den rækkefølge, løsningerne anbefales. Brugeren kan
 * ændre rækkefølgen under Avanceret (opsaetning.prisOrden). Der foreslås aldrig flere baner end dagens.
 */
// Standardrækkefølgen er Jespers (2026-10-10): pausen på dagen og færre runder før længere dag og tidsrum
export const PRIS = [
    { id: 'pause', navn: 'Pausen gives på dagen i stedet for i planen' },
    // Jesper 2026-10-12: en stor Swiss Ladder fra TP deles i grupper — ingen mister kampe, men lodtrækningen laves om i TP
    { id: 'grupper', navn: 'Swiss Ladder delt i grupper (ny lodtrækning i TP)' },
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
    // For mange kampe pr. spiller pr. dag kommer af lodtrækningen (runder/kampe pr. spiller), ikke af tiderne
    'max-kampe': 'kampe', 'spiller har max kampe den dag': 'kampe',
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
    // Max varighed: hvilke af rækkens grænser (singlerne, doublerne, hele rækken) planen går over
    if ([...ud.values()].some((g) => g.familie === 'haltid')) {
        const spaend = [...varighedsSpaend(lavRegelmodel(projekt), projekt.kampe, forslag.plan || {}).values()];
        for (const g of ud.values()) {
            if (g.familie !== 'haltid') continue;
            const over = spaend.filter((d) => d.raekkeId === g.raekke && d.sidste - d.foerste + projekt.opsaetning.slotMin > d.graense);
            g.arter = VARIGHEDER.filter((v) => over.some((d) => d.art === v.art)).map((v) => v.art);
        }
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
    if (g.familie === 'haltid') {
        const arter = VARIGHEDER.filter((v) => (g.arter?.length ? g.arter : ['single']).includes(v.art) && r?.[v.felt]);
        return `${g.raekke}: ${arter.map((v) => `${v.navn} kan ikke afvikles inden for ${r[v.felt]} min`).join(', og ') || 'kampene kan ikke afvikles inden for grænsen'}`;
    }
    if (g.familie === 'dage') return `${hvem} ligger på en dag, rækken ikke spiller`;
    if (g.familie === 'kampe') return `${g.raekke}: spillerne får flere kampe på én dag, end reglementet tillader`;
    const grunde = [...new Set([...g.aarsager].map((a) => PLADS_TEKST[a] || a))];
    return `${hvem} har ikke lovlig plads (${grunde.join(', ')})`;
}

/** Hvorfor et kort ikke kan løses med tiderne alene — vises på kortet (gennemgangen 2026-10-11). */
function forklaringFor(projekt, g) {
    if (g.familie !== 'kampe') return null;
    const egneKategorier = projekt.kategorier.filter((k) => k.raekke === g.raekke && (k.formValg || 'tp') !== 'tp');
    return `Det kommer af lodtrækningen — antallet af runder og kampe pr. spiller — ikke af tiderne. ${egneKategorier.length ? 'Vælg færre runder under Turneringen' : 'Ret det i TP, fx med færre Swiss-runder'}, eller behold det og giv deltagerne mulighed for at trække sig fra en kategori inden turneringen (reglementet § 4 stk. 5.1).`;
}

/** Udfører en ændring på projektet. Ændringen er ren data, så den kan gemmes i UI-tilstanden. */
export function anvendAendring(projekt, a) {
    if (a.type === 'raekke') return genberegnKampe(opdaterRaekke(projekt, a.raekke, a.aendring));
    if (a.type === 'dag') return genberegnKampe(opdaterDag(projekt, a.dato, a.aendring));
    if (a.type === 'kategori') return saetForm(projekt, a.kategori, a.aendring);
    if (a.type === 'kategorier') return genberegnKampe(a.aendringer.reduce((p, x) => opdaterKategori(p, x.kategori, x.aendring), projekt));
    if (a.type === 'pause') return genberegnKampe(opdaterPause(projekt, a.klasse, a.minutter));
    if (a.type === 'opsaetning') return genberegnKampe(opdaterOpsaetning(projekt, a.aendring));
    if (a.type === 'nedskaering') return anvendNedskaering(projekt, a.forslag).projekt;
    if (a.type === 'tidsvindue') {
        const regler = projekt.opsaetning.regler || {};
        return genberegnKampe(opdaterOpsaetning(projekt, { regler: { ...regler, tidsvindue: { ...(regler.tidsvindue || {}), [a.aargang]: a.vindue } } }));
    }
    return projekt;
}

/** Swiss Ladder med så mange deltagere foreslås delt i grupper (8 kampe pr. runde). */
const SWISS_STOR = 16;
/** … og i kortets egen række allerede fra 10 (2 grupper á 5). */
const SWISS_MELLEM = 10;

/** U9/U11-kategorier, hvor planneren selv vælger antallet af kampe (automatisk form/runder) — kan få middelvejen. */
function erMiddelvejKandidat(projekt, k) {
    const r = projekt.raekker.find((x) => x.id === k.raekke);
    return ['U09', 'U11'].includes(r?.aargang) && ['auto', 'swiss'].includes(k.formValg || 'tp') && !(k.swissRunder > 0);
}

/** Sætter kategori.middelvej efter `skal` (kun på kandidaterne; de andre får den fjernet). */
function medMiddelvej(projekt, skal) {
    return { ...projekt, kategorier: projekt.kategorier.map((k) => ({ ...k, middelvej: erMiddelvejKandidat(projekt, k) && !!skal(k) })) };
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
    let p = anvendAendring(projekt, aendring);
    let f = lavForslag(p);
    // Swiss i grupper kan gøre en anden kamplængde mulig (målt 2026-10-12: med grupperne gik 20 min op, hvor 25 min
    // var valgt uden dem) — så prøves de andre længder også; "Lav kampprogram" vælger kamplængden igen bagefter
    let andenLaengde = null;
    if (aendring.pris === 'grupper') {
        for (const min of kandidatLaengder(p)) {
            if (min === p.opsaetning.slotMin) continue;
            const q = genberegnKampe(saetSlotMin(p, min));
            const fq = lavForslag(q);
            if (brudI(fq) < brudI(f)) { p = q; f = fq; andenLaengde = min; }
        }
    }
    const brud = brudI(f);
    const tilbage = grupper(p, f).find((x) => x.noegle === g.noegle);
    const konsekvens = andenLaengde ? [`med ${andenLaengde} min kampe`] : [];
    const slutFoer = foer.f.statistik?.slutPrDag || {};
    for (const [d, t] of Object.entries(f.statistik?.slutPrDag || {})) {
        const f0 = slutFoer[d];
        if (f0 && t !== f0) konsekvens.push(`${d.slice(8, 10)}/${Number(d.slice(5, 7))}: dagen slutter ${t} (nu ${f0})`);
    }
    const rs = raekkeSlut(p, f.plan, g.raekke);
    if (rs && (aendring.pris === 'tidsrum' || aendring.pris === 'baner')) konsekvens.unshift(`${g.raekke} slutter ${rs}`);
    // "Bedre" måles mod det samme søgeniveau: én planlægger-kørsel på udgangspunktet (foer.basis), ikke det bedste af
    // alternativerne — ellers kunne en ændring, der reelt hjælper, se ud som ingen forbedring (gennemgangen, B2)
    return { brudEfter: brud, loest: !tilbage, gaarOp: brud === 0, bedre: brud < Math.max(foer.brud, foer.basis ?? 0), konsekvens };
}

/** Kandidat-ændringer for et kort. Hver: { tekst, pris, type, ... }. Flere trin prøves, til kortet er løst. */
export function kandidater(projekt, g) {
    const o = projekt.opsaetning;
    const r = projekt.raekker.find((x) => x.id === g.raekke);
    const ud = [];
    const trin = [1, 2, 3, 4].map((n) => n * o.slotMin);
    const dage = (r?.dage || []).map((d) => o.dage.find((x) => x.dato === d)).filter(Boolean);
    const andreDage = o.dage.filter((d) => !(r?.dage || []).includes(d.dato));
    const kortDato = (d) => `${d.slice(8, 10)}/${Number(d.slice(5, 7))}`;
    const forlaengDag = () => {
        for (const d of dage) ud.push({ gruppe: `dag-${d.dato}`, trin: trin.filter((m) => minutter(d.slut) + m < 24 * 60).map((m) => ({ tekst: `Forlæng ${kortDato(d.dato)} til ${klokke(minutter(d.slut) + m)}`, pris: 'dag', type: 'dag', dato: d.dato, aendring: { slut: klokke(minutter(d.slut) + m) } })) });
    };
    // Pause på dagen: 0 min i planen; den fælles pause (M + A–D) gælder for alle andre end E, så den nulstilles med.
    // Prøves også, når der mangler plads: pauser giver huller i programmet (pris nr. 1 i Jespers rækkefølge — Fable idé 3)
    const pausePaaDagen = () => {
        const klasse = r?.pauseKlasse || 'ABCD';
        const faelles = o.pauseMin?.faelles != null && klasse !== 'E';
        if (o.pauseMin?.[klasse] || (faelles && o.pauseMin.faelles)) {
            ud.push({ gruppe: 'pause', trin: [{ tekst: `Pausen for ${klasse === 'ABCD' ? 'A–D' : klasse}${faelles ? ' (og den fælles pause)' : ''} gives på dagen, 0 min i planen`, pris: 'pause', type: 'opsaetning', aendring: { pauseMin: { ...o.pauseMin, [klasse]: 0, ...(faelles ? { faelles: 0 } : {}) } } }] });
        }
    };
    const flereReserverede = () => {
        const maks = Math.min(...dage.map((d) => d.baner));
        if (!r?.reserveredeBaner || !Number.isFinite(maks)) return;
        const muligt = [1, 2].map((n) => r.reserveredeBaner + n).filter((n) => n <= maks);
        if (muligt.length) ud.push({ gruppe: 'baner', trin: muligt.map((n) => ({ tekst: `Reservér ${n} af dagens baner til ${g.raekke} (nu ${r.reserveredeBaner})`, pris: 'baner', type: 'raekke', raekke: g.raekke, aendring: { reserveredeBaner: n } })) });
    };
    // Swiss Ladder i grupper (Jesper 2026-10-12): en stor Swiss i rækken — fra TP's lodtrækning eller plannerens egen —
    // deles i 2 eller 3 grupper efter seedning. Hver spiller får lige så mange kampe, men grupperne kan spilles hver for
    // sig, så runderne ikke venter på hele feltet. Kræver en ny lodtrækning i TP, når kampene kommer derfra.
    // Målt 2026-10-12 (Lyngby, alt Swiss, U9 D + U11 D lørdag): én kategori ad gangen hjalp kun lidt; rækkens Swiss fra
    // 10 deltagere og dagens store (16+) i 2 grupper fik programmet til at gå op. Trinene prøves fra rækkens egne og ud.
    const swissGrupper = () => {
        const swiss = (kategorier, min) => kategorier.map((k) => ({ k, e: effektivForm(k) })).filter(({ k, e }) => {
            const draws = new Set(projekt.kampe.filter((x) => x.kategori === k.id && x.fase === 'swiss').map((x) => x.tpRef.draw));
            return e.form === 'swiss' && draws.size === 1 && (e.deltagere || 0) >= min;
        });
        const egne = swiss(projekt.kategorier.filter((x) => x.raekke === g.raekke), SWISS_MELLEM);
        const sammeDag = (k) => k.raekke !== g.raekke && (projekt.raekker.find((x) => x.id === k.raekke)?.dage || []).some((d) => (r?.dage || []).includes(d));
        const dagens = [...egne, ...swiss(projekt.kategorier.filter(sammeDag), SWISS_STOR)];
        // Flest grupper ≤ ønsket, hvor hver gruppe stadig kan spille alle runderne mod nye modstandere
        const antalFor = (e, oensket) => {
            for (let x = Math.min(oensket, maxSwissGrupper(e.deltagere)); x >= 2; x -= 1) if (Math.min(...swissGruppeFordeling(e.deltagere, x)) - 1 >= (e.runder || 0)) return x;
            return 1;
        };
        const trinFor = (liste, antal) => {
            const dele = liste.map(({ k, e }) => ({ k, e, x: antalFor(e, antal(e.deltagere)) })).filter((d) => d.x >= 2);
            if (!dele.length) return null;
            const fraTP = dele.some(({ k }) => (k.formValg || 'tp') === 'tp');
            return {
                tekst: `Del Swiss Ladder i grupper: ${dele.map(({ k, e, x }) => `${k.id} (${swissGruppeFordeling(e.deltagere, x).join(' + ')})`).join(', ')}${fraTP ? ' — ny lodtrækning i TP' : ''}`,
                pris: 'grupper', type: 'kategorier',
                aendringer: dele.map(({ k, e, x }) => ({ kategori: k.id, aendring: { formValg: 'swiss', swissGrupper: x, ...(e.runder ? { swissRunder: e.runder } : {}) } })),
            };
        };
        const noegle = (t) => t && t.aendringer.map((a) => `${a.kategori}=${a.aendring.swissGrupper}`).join();
        const kandidat = [trinFor(egne, () => 2), trinFor(dagens, () => 2), trinFor(dagens, (n) => Math.max(2, Math.round(n / 10)))].filter(Boolean);
        const trin = kandidat.filter((t, i) => kandidat.findIndex((x) => noegle(x) === noegle(t)) === i);
        if (trin.length) ud.push({ gruppe: 'grupper', trin });
    };
    if (['tidsrum', 'pause', 'haltid', 'plads'].includes(g.familie)) swissGrupper();
    if (g.familie === 'tidsrum') {
        if (r?.senest) ud.push({ gruppe: 'senest', trin: trin.filter((m) => minutter(r.senest) + m < 24 * 60).map((m) => ({ tekst: `Udvid ${g.raekke} til ${klokke(minutter(r.senest) + m)}`, pris: 'tidsrum', type: 'raekke', raekke: g.raekke, aendring: { senest: klokke(minutter(r.senest) + m) } })) });
        if (r?.tidligst && g.aarsager.has('før rækkens tidligste start')) ud.push({ gruppe: 'tidligst', trin: trin.map((m) => ({ tekst: `Lad ${g.raekke} starte ${klokke(Math.max(0, minutter(r.tidligst) - m))}`, pris: 'tidsrum', type: 'raekke', raekke: g.raekke, aendring: { tidligst: klokke(Math.max(0, minutter(r.tidligst) - m)) } })) });
        flereReserverede();
    } else if (g.familie === 'pause') {
        pausePaaDagen();
        forlaengDag();
    } else if (g.familie === 'samtidighed') {
        ud.push({ gruppe: 'samtidighed', trin: [{ tekst: 'Tillad single og double samtidig', pris: 'samtidighed', type: 'opsaetning', aendring: { antiSamtidighed: false } }] });
        forlaengDag();
    } else if (g.familie === 'haltid') {
        flereReserverede();
        for (const v of VARIGHEDER) {
            if (!r?.[v.felt] || !(g.arter?.length ? g.arter : ['single']).includes(v.art)) continue;
            ud.push({ gruppe: `haltid-${v.art}`, trin: [30, 60, 90].map((m) => ({ tekst: `Hæv max varighed for ${g.raekke}s ${v.kort} til ${r[v.felt] + m} min`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { [v.felt]: r[v.felt] + m } })) });
        }
    } else if (g.familie === 'plads') {
        pausePaaDagen();
        forlaengDag();
        // Kampe uden for årgangens tidsvindue: et længere vindue kræver dispensation (gennemgangen 2026-10-11, A6) —
        // at forlænge dagen hjælper ikke, når det er vinduet, der er grænsen
        const aargang = r?.aargang;
        const vindue = aargang ? reglerFor(projekt).tidsvindue[aargang] : null;
        if (vindue && [...g.aarsager].some((a) => a === 'tidsvindue' || a === 'uden for tidsvinduet')) {
            const til = minutter(vindue[1]);
            ud.push({ gruppe: 'tidsvindue', trin: trin.filter((m) => til + m < 24 * 60).map((m) => ({ tekst: `Udvid ${aargang}'s tidsvindue til ${klokke(til + m)}`, pris: 'dispensation', type: 'tidsvindue', aargang, vindue: [vindue[0], klokke(til + m)] })) });
        }
        if (r && r.dage.length === 1) for (const d of andreDage) ud.push({ gruppe: `flyt-${d.dato}`, trin: [{ tekst: `Flyt ${g.raekke} til ${kortDato(d.dato)}`, pris: 'flyt', type: 'raekke', raekke: g.raekke, aendring: { dage: [d.dato] } }] });
        if (r && andreDage.length && r.maxDage && r.dage.length >= r.maxDage && !r.dispensationFlereDage) {
            ud.push({ gruppe: 'flere-dage', trin: [{ tekst: `Lad ${g.raekke} spille over flere dage`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { dage: [...new Set([...r.dage, ...andreDage.map((d) => d.dato)])].sort(), dispensationFlereDage: true } }] });
        }
    }
    if (g.familie === 'kampe' && r && andreDage.length && !r.dispensationFlereDage) {
        ud.push({ gruppe: 'flere-dage', trin: [{ tekst: `Lad ${g.raekke} spille over flere dage`, pris: 'dispensation', type: 'raekke', raekke: g.raekke, aendring: { dage: [...new Set([...r.dage, ...andreDage.map((d) => d.dato)])].sort(), dispensationFlereDage: true } }] });
    }
    if (g.familie === 'dage' && r) {
        const mangler = [...new Set(g.kampe.map((x) => x.dag).filter((d) => d && !r.dage.includes(d)))];
        if (mangler.length) {
            // Dispensation kun, når rækken så spiller flere dage, end den må — en række uden dag skal blot have en (Fable M6)
            const dage = [...new Set([...r.dage, ...mangler])].sort();
            const maks = r.maxDage !== undefined ? r.maxDage : standardMaxDage(r);
            const disp = !r.dispensationFlereDage && !!maks && dage.length > maks;
            const tekst = r.dage.length ? `Lad ${g.raekke} spille ${mangler.map(kortDato).join(' og ')} også` : `Lad ${g.raekke} spille ${mangler.map(kortDato).join(' og ')}`;
            ud.push({ gruppe: 'dage', trin: [{ tekst, pris: disp ? 'dispensation' : 'flyt', type: 'raekke', raekke: g.raekke, aendring: { dage, ...(disp ? { dispensationFlereDage: true } : {}) } }] });
        }
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
    foer.basis = brudI(lavForslag(projekt));
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
        kort.push({ noegle: g.noegle, titel: titelFor(projekt, g), forklaring: forklaringFor(projekt, g), familie: g.familie, raekke: g.raekke, antal: g.kampe.length, valg: valg.slice(0, 4).map((v) => ({ ...v, prisNavn: prisNavn[v.pris] })) });
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
