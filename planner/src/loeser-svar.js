// Hvad planneren gør med løserens svar — trukket ud af app.js, så reglerne kan testes uden en side (gennemgangen af
// løseren 2026-10-17, pakke 3). Sikkerhedsnettet er det samme overalt: et program med flere fejl i Tjek end det,
// brugeren har, skifter aldrig et program ud af sig selv (Fable-gennemgangen 2026-10-10, K8).

/**
 * Løserens lovlige plan:
 *   'indlaeg'      — lægges ind (løseren kørte af sig selv efter "Lav kampprogram", bedre score, ikke flere fejl)
 *   'tilbud'       — som 'indlaeg', men brugeren har set listen til TP imens: et tilbud, tiderne ændres ikke
 *   'beholdt-fejl' — bedre score, men flere fejl i Tjek: programmet beholdes
 *   'beholdt'      — ikke bedre: programmet beholdes
 *   'vaelg'        — brugeren trykkede selv (eller der var intet program): bladr mellem løserens plan og den fra før
 */
export function vurderLoeserPlan({ auto, harProgram, scoreLoeser, scoreFoer, fejlLoeser, fejlFoer, listeSet = false }) {
    if (!auto || !harProgram) return 'vaelg';
    const bedre = scoreLoeser < scoreFoer;
    if (!bedre) return 'beholdt';
    if (fejlLoeser > fejlFoer) return 'beholdt-fejl';
    return listeSet ? 'tilbud' : 'indlaeg';
}

/** Planen med færrest brud vises kun, når den ikke har flere fejl i Tjek end programmet, brugeren har. */
export const visPlanMedFaerrestBrud = (fejlPlan, fejlNu) => fejlPlan <= fejlNu;

/**
 * En prøve uden udvalgte kompromiser: bliver løserens program et tilbud? Kun, når det ikke får flere fejl i Tjek — og
 * en plan med regelbrud (ingen lovlig fandtes) kun, når den har færre fejl end det nuværende.
 * Returnerer { tilbud, bedre } — bedre: færre fejl, eller lige mange og en lavere score.
 */
export function vurderProeve({ lovlig, fejlProeve, fejlNu, scoreProeve, scoreNu }) {
    const bedre = fejlProeve < fejlNu || (fejlProeve === fejlNu && scoreProeve < scoreNu);
    return { tilbud: fejlProeve <= fejlNu && (lovlig || fejlProeve < fejlNu), bedre };
}
