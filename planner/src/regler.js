// Reglementets tal som data: standardpauser, tidsvinduer og grænser — og projektets egne ændringer lagt ovenpå.
// Ligger for sig selv, så både projektstoren (store.js) og regelmodellen (regelmodel.js) kan bruge dem
// uden at afhænge af hinanden.

/** Reglementets standardpauser (§ 4 stk. 5). "faelles" bruges når M og ABCD spiller i samme turnering. */
export const STANDARD_PAUSE = { ABCD: 10, M: 15, E: 20, faelles: 12 };

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
    };
}
