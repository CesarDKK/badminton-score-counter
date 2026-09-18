// Bløde kriterier med vægte som data (idé fra Badminton Planner): hvert ønske
// til planen er et lille isoleret kriterie, der giver en straf, og planens
// score er den vægtede sum — lavere er bedre. Hårde regler hører IKKE til her;
// de ligger i rules.js (tjek) og scheduler.js / løseren (constraints).
//
// Et nyt ønske = ét nyt kriterie i KRITERIER + en vægt i skabelonerne.
// Vægtene ligger i projekt.opsaetning.vaegte og kan tunes i fane 1 uden kode.
import { minutter } from './tp-reader.js';
import { slotsForDag, banerISlot } from './kapacitet.js';

/** Fælles forarbejde, så kriterierne ikke hver især skal løbe planen igennem. */
function kontekst(projekt) {
    const { slotMin, dage } = projekt.opsaetning;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const placeret = [];
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (p) placeret.push({ k, dag: p.dag, slot: p.slot, min: minutter(p.slot) });
    }
    const prSpillerDag = new Map(); // `${spiller}|${dag}` → sorterede starttider
    for (const x of placeret) for (const s of x.k.spillere) {
        const n = `${s}|${x.dag}`;
        if (!prSpillerDag.has(n)) prSpillerDag.set(n, []);
        prSpillerDag.get(n).push(x.min);
    }
    for (const t of prSpillerDag.values()) t.sort((a, b) => a - b);
    return { slotMin, dage, katMap, placeret, prSpillerDag, maxVent: projekt.opsaetning.maxVentetidMin ?? 90 };
}

/** Kriterierne: { id, navn, beskrivelse, enhed, beregn(projekt, ctx) → tal (≥ 0) }. */
export const KRITERIER = [
    {
        id: 'ventetid', navn: 'Ventetid', enhed: 'timer',
        beskrivelse: 'Spillernes samlede ventetid mellem egne kampe (haltid minus egne kampe), i timer.',
        beregn: (p, c) => {
            let min = 0;
            for (const t of c.prSpillerDag.values()) min += (t[t.length - 1] - t[0] + c.slotMin) - t.length * c.slotMin;
            return min / 60;
        },
    },
    {
        id: 'langeHuller', navn: 'Lange huller', enhed: 'spillerdage',
        beskrivelse: 'Spillerdage med et hul over ventetidsgrænsen mellem to egne kampe.',
        beregn: (p, c) => {
            if (!(c.maxVent > 0)) return 0;
            let n = 0;
            for (const t of c.prSpillerDag.values()) for (let i = 1; i < t.length; i += 1) if (t[i] - t[i - 1] - c.slotMin > c.maxVent) { n += 1; break; }
            return n;
        },
    },
    {
        id: 'sluttid', navn: 'Sen sluttid', enhed: 'timer',
        beskrivelse: 'Timer fra dagens start til sidste kamp er slut, lagt sammen for alle dage.',
        beregn: (p, c) => {
            let timer = 0;
            for (const d of c.dage) {
                const sidste = Math.max(-1, ...c.placeret.filter((x) => x.dag === d.dato).map((x) => x.min));
                if (sidste >= 0) timer += (sidste + c.slotMin - minutter(d.start)) / 60;
            }
            return timer;
        },
    },
    {
        id: 'tommeBaner', navn: 'Tomme baner midt på dagen', enhed: 'bane-slots',
        beskrivelse: 'Ubrugte bane-slots før dagens sidste kamp (huller i programmet).',
        beregn: (p, c) => {
            let tomme = 0;
            for (const d of c.dage) {
                const paaDagen = c.placeret.filter((x) => x.dag === d.dato);
                if (!paaDagen.length) continue;
                const sidste = Math.max(...paaDagen.map((x) => x.min));
                for (const slot of slotsForDag(d, c.slotMin)) {
                    const m = minutter(slot);
                    if (m > sidste) break;
                    const her = paaDagen.filter((x) => x.min === m);
                    const halve = her.filter((x) => c.katMap.get(x.k.kategori)?.halvBane).length;
                    tomme += Math.max(0, banerISlot(d, slot) - ((her.length - halve) + Math.ceil(halve / 2)));
                }
            }
            return tomme;
        },
    },
    {
        id: 'puljerunderSpredt', navn: 'Puljerunder ude af takt', enhed: 'kampe',
        beskrivelse: 'Puljekampe i runde r+1, der ligger før eventets sidste kamp i runde r (alle puljer ikke i takt).',
        beregn: (p, c) => {
            const prKatRunde = new Map(); // `${kat}|${runde}` → [tid]
            for (const x of c.placeret) {
                if (x.k.fase !== 'pulje') continue;
                const n = `${x.k.kategori}|${x.k.runde}`;
                if (!prKatRunde.has(n)) prKatRunde.set(n, []);
                prKatRunde.get(n).push(`${x.dag}T${x.slot}`);
            }
            let ude = 0;
            for (const [n, tider] of prKatRunde) {
                const [kat, runde] = n.split('|');
                const forrige = prKatRunde.get(`${kat}|${Number(runde) - 1}`);
                if (!forrige) continue;
                const sidsteForrige = forrige.reduce((a, b) => (a > b ? a : b));
                ude += tider.filter((t) => t < sidsteForrige).length;
            }
            return ude;
        },
    },
    {
        id: 'finalerSpredt', navn: 'Finaler spredt', enhed: 'slots',
        beskrivelse: 'Afstand i slots mellem rækkens første og sidste finale samme dag (finaler gerne samlet).',
        beregn: (p, c) => {
            const prRaekkeDag = new Map();
            for (const x of c.placeret) {
                if (x.k.rundeNavn !== 'Finale') continue;
                const n = `${c.katMap.get(x.k.kategori)?.raekke}|${x.dag}`;
                if (!prRaekkeDag.has(n)) prRaekkeDag.set(n, []);
                prRaekkeDag.get(n).push(x.min);
            }
            let slots = 0;
            for (const t of prRaekkeDag.values()) slots += (Math.max(...t) - Math.min(...t)) / c.slotMin;
            return slots;
        },
    },
];

/** Navngivne skabeloner med vægte. "standard" bruges i nye projekter. */
export const VAEGT_SKABELONER = {
    standard: { navn: 'Kortest ventetid (standard)', vaegte: { ventetid: 1, langeHuller: 2, sluttid: 2, tommeBaner: 0.1, puljerunderSpredt: 0.2, finalerSpredt: 0.2 } },
    tidligSlut: { navn: 'Tidlig slut', vaegte: { ventetid: 0.5, langeHuller: 1, sluttid: 8, tommeBaner: 0.3, puljerunderSpredt: 0.1, finalerSpredt: 0.1 } },
    roligt: { navn: 'Roligt, overskueligt program', vaegte: { ventetid: 0.5, langeHuller: 2, sluttid: 1, tommeBaner: 0.05, puljerunderSpredt: 2, finalerSpredt: 1 } },
};

/** Projektets vægte: standard med projektets ændringer ovenpå (ukendte kriterier får vægt 0). */
export function vaegteFor(projekt) {
    return { ...VAEGT_SKABELONER.standard.vaegte, ...(projekt?.opsaetning?.vaegte || {}) };
}

/**
 * Planens score: vægtet sum af kriterierne — lavere er bedre.
 * Returnerer { total, dele: [{ id, navn, enhed, vaerdi, vaegt, bidrag }] }.
 */
export function scorePlan(projekt, vaegte = vaegteFor(projekt)) {
    const c = kontekst(projekt);
    const dele = KRITERIER.map((k) => {
        const vaerdi = k.beregn(projekt, c);
        const vaegt = Number(vaegte[k.id]) || 0;
        return { id: k.id, navn: k.navn, enhed: k.enhed, vaerdi: Math.round(vaerdi * 100) / 100, vaegt, bidrag: Math.round(vaerdi * vaegt * 100) / 100 };
    });
    return { total: Math.round(dele.reduce((s, d) => s + d.bidrag, 0) * 10) / 10, dele };
}
