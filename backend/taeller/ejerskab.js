// Kun én tæller ad gangen pr. bane — reglerne, uden database (unit-testet).
//
// En tæller-enhed har et tilfældigt id (laves i browseren og gemmes på enheden)
// og sender det med hver gemning og hvert livstegn. Banen (game_states-rækken)
// husker, hvem der tæller, og hvornår den sidst gav lyd.
//
// - Ingen tæller, eller tælleren har ikke givet lyd i AKTIV_SEK: banen er ledig,
//   og den første der gemmer, bliver tæller.
// - En anden enhed må ikke gemme, men kan "Overtage" — så husker banen, hvem
//   der blev overtaget fra, så den enhed kan få besked og tage tællingen tilbage.
// - Gemninger uden id (admin, ældre sider) spærres ikke.

// Tælleren melder sig hvert 10. sekund; efter 45 s uden lyd (tablet løbet tør,
// browser lukket) er banen ledig igen
const AKTIV_SEK = 45;

const MAKS_ID = 64;
const MAKS_NAVN = 100;

function rensId(id) {
    if (typeof id !== 'string') return null;
    const t = id.trim();
    return /^[A-Za-z0-9_-]{8,64}$/.test(t) ? t.slice(0, MAKS_ID) : null;
}

function rensNavn(navn) {
    if (typeof navn !== 'string') return null;
    const t = navn.replace(/[\u0000-\u001f]/g, '').trim();
    return t ? t.slice(0, MAKS_NAVN) : null;
}

function tilMs(v) {
    if (v === null || v === undefined) return null;
    const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isFinite(ms) ? ms : null;
}

// Hvor mange sekunder siden tælleren sidst gav lyd (null = ingen tæller)
function sekSidenLyd(row, nuMs) {
    if (!row || !row.taeller_id) return null;
    const ms = tilMs(row.taeller_set_at);
    if (ms === null) return Infinity;
    return Math.max(0, (nuMs - ms) / 1000);
}

function erAktiv(row, nuMs) {
    // En afsluttet kamp tælles ikke mere — tabletten, der stadig viser "Kamp
    // Vundet", må ikke spærre for næste kamp (fx en QR-gæst)
    if (row && row.match_completed) return false;
    const s = sekSidenLyd(row, nuMs);
    return s !== null && s <= AKTIV_SEK;
}

// Må enheden med dette id gemme banens tilstand?
function maaGemme(row, id, nuMs) {
    if (!id) return true;                       // admin/ældre sider
    if (!row || !row.taeller_id) return true;   // ingen tæller endnu
    if (row.taeller_id === id) return true;     // det er os
    return !erAktiv(row, nuMs);                 // den anden er gået
}

// Status til enheden: tæller den selv, er banen ledig, hvem tæller ellers,
// og er tællingen overtaget fra netop denne enhed?
function status(row, id, nuMs) {
    const aktiv = erAktiv(row, nuMs);
    const ejer = !!id && !!row && row.taeller_id === id;
    const s = sekSidenLyd(row, nuMs);
    return {
        ejer,
        ledig: !ejer && !aktiv,
        taeller: row && row.taeller_id && !ejer
            ? { navn: row.taeller_navn || 'En anden enhed', sekSidenLyd: s === Infinity ? null : Math.round(s), aktiv }
            : null,
        overtagetFraDig: !ejer && !!id && !!row && row.forrige_taeller_id === id && !!row.taeller_id
    };
}

// Felterne der skal skrives, når enheden bliver/forbliver tæller. Overtages
// banen fra en anden (aktiv eller ej), huskes den som forrige.
function kraev(row, id, navn) {
    const tidligere = row && row.taeller_id && row.taeller_id !== id ? row : null;
    return {
        taeller_id: id,
        taeller_navn: navn,
        forrige_taeller_id: tidligere ? tidligere.taeller_id : (row ? row.forrige_taeller_id || null : null),
        forrige_taeller_navn: tidligere ? tidligere.taeller_navn : (row ? row.forrige_taeller_navn || null : null),
        overtaget: !!tidligere
    };
}

// Kort nøgle til GET-svaret (som alle kan læse): nok til at en enhed kan se,
// om det er den selv, men ikke nok til at udgive sig for den
function kortId(id) {
    return id ? String(id).slice(0, 8) : null;
}

module.exports = { AKTIV_SEK, rensId, rensNavn, sekSidenLyd, erAktiv, maaGemme, status, kraev, kortId };
