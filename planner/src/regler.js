// Reglementets tal som data: standardpauser, tidsvinduer og grænser — og projektets egne ændringer lagt ovenpå.
// Ligger for sig selv, så både projektstoren (store.js) og regelmodellen (regelmodel.js) kan bruge dem
// uden at afhænge af hinanden.

/**
 * Hvilke udgaver af Badminton Danmarks tekster tallene i planneren er tjekket mod. Reglementet ændrer sig fra sæson til
 * sæson; når en ny udgave kommer, finder Jesper den, vi gennemgår den sammen og retter tallene, testene
 * (tests/unit/reglement.test.js) og denne liste. Vises under "Reglementets grænser" og i sidefoden.
 */
export const REGELSAET = {
    saeson: '2026/27',
    gennemgaaet: '2026-09-20',
    kilder: [
        { navn: 'Reglement for Individuelle Turneringer', udgave: 'september 2026', url: 'https://badminton.dk/wp-content/uploads/2026/09/Reglement-for-Individuelle-Turneringer.pdf' },
        { navn: 'Appendiks 1 — Turneringsformer, seedning og lodtrækning', udgave: 'juli 2026', url: 'https://badminton.dk/wp-content/uploads/2026/07/Appendiks-1-Turneringsformer-seedning-lodtraekning.pdf' },
        { navn: 'U9-U11 turneringer 2026-2027 — Vejledning', udgave: '28. juli 2026', url: 'https://badminton.dk/wp-content/uploads/2026/08/U9-U11-turneringer-2026-2027-Vejledning-28-07-2026-1.pdf' },
    ],
};

/** Kort tekst om regelsættet, fx til sidefoden: "Badminton Danmarks reglement, sæson 2026/27 (gennemgået 20/9-2026)". */
export function regelsaetTekst(r = REGELSAET) {
    const [aar, md, dag] = r.gennemgaaet.split('-').map(Number);
    return `Badminton Danmarks reglement, sæson ${r.saeson} (gennemgået ${dag}/${md}-${aar})`;
}

/** Reglementets standardpauser (§ 4 stk. 5). "faelles" bruges når M og ABCD spiller i samme turnering. */
export const STANDARD_PAUSE = { ABCD: 10, M: 15, E: 20, faelles: 12 };

/** Reglementets pauser for turneringens rækker: fælles pause (12 min), når M og A–D spiller i samme turnering. */
export function reglementetsPause(raekker = []) {
    const harM = raekker.some((r) => r.raekke === 'M');
    const harABCD = raekker.some((r) => r.pauseKlasse === 'ABCD');
    return { ...STANDARD_PAUSE, faelles: harM && harABCD ? STANDARD_PAUSE.faelles : null };
}

/** Ingen pause i planen (som mange klubber gør i TP — flowet i hallen giver pauserne). */
export const INGEN_PAUSE = { ABCD: 0, M: 0, E: 0, faelles: null };

/** Tidsvinduer i programmet pr. årgang (§ 4 stk. 5.1): start–slut. */
export const TIDSVINDUE = {
    U09: ['09:00', '19:00'], U11: ['09:00', '19:00'],
    U13: ['09:00', '20:00'], U15: ['09:00', '20:00'],
    U17: ['09:00', '21:00'], U19: ['09:00', '21:00'], SEN: ['09:00', '21:00'],
};

/**
 * Reglementets grænser som parametre (design § 5: "alle grænser er parametre med
 * reglementets værdi som standard"). Ligger i projekt.opsaetning.regler og kan
 * ændres i fane 1; manglende felter i ældre projekter falder tilbage på disse.
 */
export const STANDARD_REGLER = {
    tidsvindue: TIDSVINDUE,          // pr. årgang: [start, slut]
    foerSkoledagTimer: 2,            // så mange timer tidligere slutter vinduet dagen før en skoledag
    maxKampePrDag: 10,               // ved flere dage
    maxKampePrDagEnDag: 12,          // ungdom, når hele turneringen afvikles på én dag (§ 4 stk. 5.1); senior: 10 (stk. 5.2)
    minKampMin: { ungdomABCD: 20, ungdomEM: 25, seniorABCD: 25, seniorEM: 30 },
    eTidligst: '10:00',              // E-rækker: ingen kampe (indledende, kvart-, semifinaler, finaler) før dette tidspunkt (§ 4 stk. 5.1)
    eFinale: ['10:00', '13:00'],       // E-finaler skal ligge i dette vindue
    seniorMaxPrKategori: 3,          // senior E/M: max kampe pr. kategori pr. dag
    minKampe: { MA: 2, BCDSingle: 3, BCDDouble: 2, U9U11Single: 4, swissRunder: 4 },
    // U9-U11-vejledningen 2026/27: "Alle spillere får 4 – 6 singlekampe og 2 – 5 doublekampe" — Jesper 2026-10-11:
    // anbefalingen følges (advarsel), og reglementets max kampe pr. dag gælder stadig (fejl)
    maxKampeU9U11: { single: 6, double: 5 },
};

/** Reglerne for et projekt: standard med projektets ændringer lagt ovenpå. */
export function reglerFor(projekt) {
    const egne = projekt?.opsaetning?.regler || {};
    return {
        ...STANDARD_REGLER,
        ...egne,
        tidsvindue: { ...STANDARD_REGLER.tidsvindue, ...(egne.tidsvindue || {}) },
        minKampMin: { ...STANDARD_REGLER.minKampMin, ...(egne.minKampMin || {}) },
        minKampe: { ...STANDARD_REGLER.minKampe, ...(egne.minKampe || {}) },
        maxKampeU9U11: { ...STANDARD_REGLER.maxKampeU9U11, ...(egne.maxKampeU9U11 || {}) },
    };
}
