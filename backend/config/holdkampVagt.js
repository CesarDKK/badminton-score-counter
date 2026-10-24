/**
 * Tidsplanen for den automatiske hentning af holdsedler (ren logik, ingen
 * database og intet netværk — unit-testes i tests/unit/holdkamp-vagt.test.js).
 *
 * Badmintonplayer frigiver holdsedlen 60 minutter før kampstart. Vi tjekker:
 *
 *   Før vinduet   kamptidspunktet genlæses oftere, jo nærmere kampen er (se
 *                 GENLAES_TRAPPE: hver 6. time, hver 2. time det sidste døgn,
 *                 hvert 30. minut de sidste 4 timer), så en flyttet kamp ikke
 *                 åbner vinduet for sent. Er holdsedlen der allerede, oprettes
 *                 holdkampen med det samme.
 *   I vinduet     første tjek 59 min 50 sek før start (10 sek efter frigivelsen,
 *                 så vi ikke rammer præcis i frigivelsesøjeblikket og må vente
 *                 en hel omgang), derefter hvert 30. sekund de første 10 minutter
 *                 og så hvert 2. minut (aftrapning: en holdseddel der ikke kom
 *                 til tiden, kommer sjældent inden for de næste 30 sekunder —
 *                 og med mange kampe på samme server skal badmintonplayer.dk
 *                 ikke have 180 kald pr. kamp).
 *   Efter         30 minutter efter kampstart opgives kampen.
 *
 * Kender vi ikke tidspunktet, tjekkes hvert 5. minut i seks timer.
 */
const FRIGIVES_FOER_MS = 60 * 60 * 1000;
const FOERSTE_FORSINKELSE_MS = 10 * 1000;
const INTERVAL_MS = 30 * 1000;
const HURTIG_FASE_MS = 10 * 60 * 1000;      // så længe tjekkes der hvert 30. sekund
const LANGSOMT_INTERVAL_MS = 2 * 60 * 1000; // derefter hvert 2. minut
const OPGIV_EFTER_MIN = 30;
const UDEN_TID_TIMER = 6;
const UDEN_TID_INTERVAL_MS = 5 * 60 * 1000;
const TIME_MS = 60 * 60 * 1000;

// Før vinduet: [mere end så lang tid før kampstart, genlæs med dette interval].
// En kamp flyttes sjældent med kort varsel, så det sidste døgn rækker hver 2.
// time; først de sidste 4 timer (3 før vinduet) genlæses der hvert 30. minut.
const GENLAES_TRAPPE = [
    [24 * TIME_MS, 6 * TIME_MS],
    [4 * TIME_MS, 2 * TIME_MS],
    [0, 30 * 60 * 1000]
];
const NAESTEN_VINDUE_MS = 5 * 60 * 1000;

const ms = (d) => {
    if (d === null || d === undefined) return null;
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    return Number.isFinite(t) ? t : null;
};

/** Første tjek i vinduet: 59 min 50 sek før start. null uden kendt tidspunkt. */
function foersteTjek(startTime) {
    const start = ms(startTime);
    return start === null ? null : new Date(start - FRIGIVES_FOER_MS + FOERSTE_FORSINKELSE_MS);
}

/**
 * Tidspunktet for næste tjek af en kamp, givet starttid og seneste tjek.
 * Ligger det i fortiden (eller er nu), er kampen forfalden.
 */
function naesteTjek(w, nu = new Date()) {
    const nuMs = ms(nu);
    const start = ms(w.start_time);
    const sidst = ms(w.last_checked_at);

    if (start === null) {
        return new Date(sidst === null ? nuMs : sidst + UDEN_TID_INTERVAL_MS);
    }

    const foerste = start - FRIGIVES_FOER_MS + FOERSTE_FORSINKELSE_MS;

    if (nuMs >= foerste) {
        // I vinduet: fast gitter fra første tjek — hvert 30. sekund de første
        // 10 minutter, derefter hvert 2. minut. Et manuelt tjek uden for
        // gitteret flytter det ikke — næste tjek er næste gitterpunkt.
        if (sidst === null || sidst < foerste) return new Date(foerste);
        const langsomFra = foerste + HURTIG_FASE_MS;
        if (sidst < langsomFra) {
            const n = Math.floor((sidst - foerste) / INTERVAL_MS) + 1;
            return new Date(foerste + n * INTERVAL_MS);
        }
        const n = Math.floor((sidst - langsomFra) / LANGSOMT_INTERVAL_MS) + 1;
        return new Date(langsomFra + n * LANGSOMT_INTERVAL_MS);
    }

    // Før vinduet: genlæs kamptidspunktet efter trappen, men aldrig senere end
    // vinduets første tjek. Når kampen rykker ind på næste trin, tjekkes der
    // dér — så nedtællingen i admin viser det rigtige tidspunkt.
    if (sidst === null) return new Date(Math.min(nuMs, foerste));
    const [graense, interval] = GENLAES_TRAPPE.find(([g]) => start - nuMs > g) || GENLAES_TRAPPE[GENLAES_TRAPPE.length - 1];
    let t = sidst + interval;
    if (graense > 0) t = Math.min(t, start - graense);
    // Et genlæs få minutter før vinduet åbner, er spildt — vinduets første tjek
    // læser alligevel tidspunktet igen
    if (foerste - t < NAESTEN_VINDUE_MS) t = foerste;
    return new Date(Math.min(t, foerste));
}

function erForfalden(w, nu = new Date()) {
    return naesteTjek(w, nu).getTime() <= ms(nu);
}

/** Hele sekunder til næste tjek (0 = nu) — til nedtællingen i admin. */
function sekunderTilNaeste(w, nu = new Date()) {
    return Math.max(0, Math.ceil((naesteTjek(w, nu).getTime() - ms(nu)) / 1000));
}

module.exports = {
    FRIGIVES_FOER_MS, FOERSTE_FORSINKELSE_MS, INTERVAL_MS, HURTIG_FASE_MS, LANGSOMT_INTERVAL_MS,
    OPGIV_EFTER_MIN, UDEN_TID_TIMER,
    foersteTjek, naesteTjek, erForfalden, sekunderTilNaeste
};
