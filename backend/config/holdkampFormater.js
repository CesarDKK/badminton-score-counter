/**
 * Holdkamp-formater og opstillingsregler — samme fil som frontenden bruger
 * (frontend/js/holdkamp-formater.js), så reglerne kun findes ét sted.
 *
 * I containeren kopieres filen til /app/shared af Dockerfile.backend; i repoet
 * (unit-tests og CI) læses den direkte fra frontend/js.
 */
let formater;
try {
    formater = require('../shared/holdkamp-formater');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    formater = require('../../frontend/js/holdkamp-formater');
}

/**
 * Formatet ud fra delkampene på en holdseddel fra badmintonplayer.dk.
 *
 * Ungdomsformaterne 4 spillere og U9 3 spillere hedder Single/Double ("1. S",
 * "1. D"), mens 4 piger hedder DS/DD ("1. DS", "1. DD") — derfor genkendes de
 * på, at der KUN er single- og double-kategorier (ingen MD/HS/HD).
 */
function detectFormat(games) {
    const cats = (games || []).map(g => g.category);
    const n = cats.length;
    const cnt = c => cats.filter(x => x === c).length;
    const ungdom = n > 0 && cats.every(c => ['Single', 'Double', 'DS', 'DD'].includes(c));
    if (ungdom) {
        const doubler = cats.filter(c => formater.erDouble(c)).length;
        const singler = n - doubler;
        if (singler === 4 && doubler === 2) return '4spillere';
        if (singler === 4 && doubler === 4) return '4spillere8';
        if (singler === 4 && doubler === 1) return 'u9_3spillere';
        return 'imported';
    }
    if (n === 11) return 'liga11';
    if (n === 13) return '13kamps';
    if (n === 9)  return '4plus3';
    if (n === 8 && cnt('MD') >= 2 && cnt('DS') >= 2) return '2plus2';
    if (n === 8 && cnt('MD') === 1 && cnt('DS') === 1) return '4plus2';
    return 'imported';
}

/**
 * Er formatet et, vi kender? Formaterne i FORMATER plus 'imported', som
 * detectFormat giver en holdseddel, der ikke passer på nogen af dem.
 * POST /api/team-matches afviser alt andet (formatet vises i admin).
 */
function kendtFormat(format) {
    return typeof format === 'string'
        && (format === 'imported' || Object.prototype.hasOwnProperty.call(formater.FORMATER, format));
}

/**
 * Delkampe på holdsedlen, hvor en side mangler spillere (begge makkere i en
 * double). Badmintonplayer.dk kan vise holdene og kategorierne, før spillerne
 * er sat på.
 */
function delkampeUdenSpillere(games) {
    return (games || []).filter(g => {
        const dbl = formater.erDouble(g.category);
        return !g.team1Player1 || !g.team2Player1 || (dbl && (!g.team1Player2 || !g.team2Player2));
    }).length;
}

// Fra så lang tid før kampstart godtages en holdseddel med tomme pladser: så
// er de et afbud (w.o.), ikke en seddel, der stadig udfyldes.
const DELVIS_FRA_MIN_FOER_START = 30;

/**
 * Er holdsedlen frigivet, så holdkamp-køen kan oprette holdkampen (nr. 80)?
 * Før var hold og delkampe nok: kom spillerne på bagefter, blev holdkampen
 * oprettet uden dem og blev aldrig opdateret.
 *  start   kamptidspunktet (Date) eller null
 *  nu      nu (Date)
 * Returnerer { klar, mangler } — mangler = delkampe uden spillere.
 */
function holdseddelKlar(seddel, { start = null, nu = new Date() } = {}) {
    if (!seddel || !seddel.team1Name || !seddel.team2Name || !(seddel.games || []).length) {
        return { klar: false, mangler: 0 };
    }
    const mangler = delkampeUdenSpillere(seddel.games);
    if (mangler === 0) return { klar: true, mangler };
    // Begge hold skal have sat mindst én spiller på; uden kamptidspunkt eller
    // tæt på kampstart er de tomme pladser afbud
    const harSpillere = (n) => seddel.games.some(g => g[`team${n}Player1`] || g[`team${n}Player2`]);
    if (!harSpillere(1) || !harSpillere(2)) return { klar: false, mangler };
    const startMs = start ? new Date(start).getTime() : NaN;
    const taetPaa = !Number.isFinite(startMs)
        || new Date(nu).getTime() >= startMs - DELVIS_FRA_MIN_FOER_START * 60 * 1000;
    return { klar: taetPaa, mangler };
}

module.exports = { ...formater, detectFormat, kendtFormat, delkampeUdenSpillere, holdseddelKlar, DELVIS_FRA_MIN_FOER_START };
