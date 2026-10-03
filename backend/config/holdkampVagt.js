/**
 * Tidsplanen for den automatiske hentning af holdsedler (ren logik, ingen
 * database og intet netværk — unit-testes i tests/unit/holdkamp-vagt.test.js).
 *
 * Badmintonplayer frigiver holdsedlen 60 minutter før kampstart. Vi tjekker:
 *
 *   Før vinduet   kamptidspunktet genlæses med mellemrum (hvert 30. minut det
 *                 sidste døgn, ellers hver 6. time), så en flyttet kamp ikke
 *                 åbner vinduet for sent. Er holdsedlen der allerede, oprettes
 *                 holdkampen med det samme.
 *   I vinduet     første tjek 59 min 50 sek før start (10 sek efter frigivelsen,
 *                 så vi ikke rammer præcis i frigivelsesøjeblikket og må vente
 *                 en hel omgang), derefter hvert 30. sekund på et fast gitter.
 *   Efter         30 minutter efter kampstart opgives kampen.
 *
 * Kender vi ikke tidspunktet, tjekkes hvert 5. minut i seks timer.
 */
const FRIGIVES_FOER_MS = 60 * 60 * 1000;
const FOERSTE_FORSINKELSE_MS = 10 * 1000;
const INTERVAL_MS = 30 * 1000;
const OPGIV_EFTER_MIN = 30;
const UDEN_TID_TIMER = 6;
const UDEN_TID_INTERVAL_MS = 5 * 60 * 1000;
const NAER_MS = 24 * 60 * 60 * 1000;
const FOER_VINDUE_NAER_MS = 30 * 60 * 1000;
const FOER_VINDUE_FJERN_MS = 6 * 60 * 60 * 1000;

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
        // I vinduet: fast 30-sekunders gitter fra første tjek. Et manuelt tjek
        // uden for gitteret flytter det ikke — næste tjek er næste gitterpunkt.
        if (sidst === null || sidst < foerste) return new Date(foerste);
        const n = Math.floor((sidst - foerste) / INTERVAL_MS) + 1;
        return new Date(foerste + n * INTERVAL_MS);
    }

    // Før vinduet: genlæs kamptidspunktet med mellemrum, men aldrig senere end
    // vinduets første tjek.
    const interval = (start - nuMs <= NAER_MS) ? FOER_VINDUE_NAER_MS : FOER_VINDUE_FJERN_MS;
    const t = sidst === null ? nuMs : sidst + interval;
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
    FRIGIVES_FOER_MS, FOERSTE_FORSINKELSE_MS, INTERVAL_MS, OPGIV_EFTER_MIN, UDEN_TID_TIMER,
    foersteTjek, naesteTjek, erForfalden, sekunderTilNaeste
};
