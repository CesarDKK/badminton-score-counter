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

/** Årgange, der spiller med sænket net (U9-U11-vejledningen 2026/27: 145 cm). */
export const SAENKET_NET = new Set(['U09', 'U11']);

/** Spillerne, der er i hallen til en kamp: de kendte — og i Swiss alle i lodtrækningen (alle spiller hver runde). */
export const halTidSpillere = (k) => (k.fase === 'swiss' ? new Set([...k.spillere, ...(k.muligeSpillere || [])]) : k.spillere);

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
        // Flowet i hallen (Jesper 2026-10-10): en spiller, der spiller i slottet lige efter sin forrige kamp, får
        // kun reglementets minimumspause og ingen luft. Jespers egne planer giver som regel ét slot fri.
        id: 'kampeITraek', navn: 'Kampe i træk', enhed: 'gange',
        beskrivelse: 'Antal gange en spiller har sin næste kamp i slottet lige efter den forrige (kun minimumspausen imellem).',
        beregn: (p, c) => {
            let n = 0;
            for (const t of c.prSpillerDag.values()) for (let i = 1; i < t.length; i += 1) if (t[i] - t[i - 1] === c.slotMin) n += 1;
            return n;
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
                    tomme += Math.max(0, banerISlot(d, slot, c.slotMin) - ((her.length - halve) + Math.ceil(halve / 2)));
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
        // Gennemgangen 2026-10-11 (B3): de, der går videre fra puljen, tælles ikke af ventetiden (de er kun "mulige"
        // spillere i cuppen), så cuppen kunne starte timer efter puljerne. Målt i U13/U15: gns. 45 min, op til 3 timer.
        id: 'cupVent', navn: 'Ventetid før cupkampe', enhed: 'timer',
        beskrivelse: 'Tid fra de kampe, en cupkamp bygger på, er slut, til cupkampen starter — samme dag (en cup dagen efter puljerne tæller ikke).',
        beregn: (p, c) => {
            const tid = new Map(c.placeret.map((x) => [x.k.id, x]));
            let min = 0;
            for (const x of c.placeret) {
                if (x.k.fase !== 'cup' || !x.k.afhaengerAf.length) continue;
                const deps = x.k.afhaengerAf.map((id) => tid.get(id));
                if (deps.some((d) => !d || d.dag !== x.dag)) continue;
                min += Math.max(0, x.min - (Math.max(...deps.map((d) => d.min)) + c.slotMin));
            }
            return min / 60;
        },
    },
    {
        // U9-U11-vejledningen 2026/27: U9 og U11 spiller med sænket net (145 cm) — "flest baner først på dagen og færrest
        // sidst på dagen og U13 omvendt", så nettet kun hæves én gang. Jesper 2026-10-11: ja. Måles pr. dag som den tid,
        // U9/U11 og de øvrige årgange overlapper (fra de ældres første start til U9/U11's sidste slut).
        id: 'saenketNet', navn: 'Sænket net blandet med normalt', enhed: 'timer',
        beskrivelse: 'Pr. dag: tid fra den første kamp med normalt net (U13 og op) til den sidste med sænket net (U9/U11) slutter.',
        beregn: (p, c) => {
            const prDag = new Map();
            for (const x of c.placeret) {
                const aargang = p.raekker.find((r) => r.id === c.katMap.get(x.k.kategori)?.raekke)?.aargang;
                if (!aargang) continue;
                if (!prDag.has(x.dag)) prDag.set(x.dag, { saenket: -Infinity, normal: Infinity });
                const d = prDag.get(x.dag);
                if (SAENKET_NET.has(aargang)) d.saenket = Math.max(d.saenket, x.min + c.slotMin);
                else d.normal = Math.min(d.normal, x.min);
            }
            let min = 0;
            for (const d of prDag.values()) if (Number.isFinite(d.saenket) && Number.isFinite(d.normal)) min += Math.max(0, d.saenket - d.normal);
            return min / 60;
        },
    },
    {
        // Jesper 2026-10-12: U9-spillere i hallen fra kl. 9 til efter 15. Ventetiden kender kun spillerne i de kampe, de
        // er trukket til, og i Swiss kendes de først efter lodtrækningen til runden — så en U9-række med Swiss i alle
        // kategorier var næsten usynlig, og doublerne kunne spredes over eftermiddagen. Her tæller alle i en
        // Swiss-lodtrækning med i hver runde (de spiller alle hver runde). U9-U11-vejledningen: "U9 single først og dernæst
        // double", "kampene [skal] være så komprimeret med en hurtig afvikling uden for lange pauser".
        id: 'halTid', navn: 'Tid i hallen, U9/U11', enhed: 'spillertimer',
        beskrivelse: 'U9- og U11-spillernes tid i hallen pr. dag, fra deres første til deres sidste kamp er slut — Swiss-runder tæller for alle i lodtrækningen.',
        beregn: (p, c) => {
            const prSpillerDag = new Map();
            for (const x of c.placeret) {
                const aargang = p.raekker.find((r) => r.id === c.katMap.get(x.k.kategori)?.raekke)?.aargang;
                if (!SAENKET_NET.has(aargang)) continue;
                for (const s of halTidSpillere(x.k)) {
                    const n = `${s}|${x.dag}`;
                    const t = prSpillerDag.get(n) || [x.min, x.min];
                    prSpillerDag.set(n, [Math.min(t[0], x.min), Math.max(t[1], x.min)]);
                }
            }
            let min = 0;
            for (const [a, b] of prSpillerDag.values()) min += b - a + c.slotMin;
            return min / 60;
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
    standard: { navn: 'Standard: kort ventetid og luft mellem kampene', vaegte: { ventetid: 1, kampeITraek: 2, langeHuller: 2, sluttid: 2, tommeBaner: 0.1, puljerunderSpredt: 2, cupVent: 1, saenketNet: 0.5, halTid: 0.5, finalerSpredt: 0.2 } },
    tidligSlut: { navn: 'Tidlig slut', vaegte: { ventetid: 0.5, kampeITraek: 0.5, langeHuller: 1, sluttid: 8, tommeBaner: 0.3, puljerunderSpredt: 0.5, cupVent: 0.5, saenketNet: 0.2, halTid: 0.3, finalerSpredt: 0.1 } },
    roligt: { navn: 'Roligt, overskueligt program', vaegte: { ventetid: 0.5, kampeITraek: 3, langeHuller: 2, sluttid: 1, tommeBaner: 0.05, puljerunderSpredt: 3, cupVent: 1, saenketNet: 0.5, halTid: 0.5, finalerSpredt: 1 } },
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
