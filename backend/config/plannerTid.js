/**
 * Ren logik for badmintonplanner-integrationen: tidsrum (hvornår hvilke
 * nøgler må sende til hvilke baner), dansk tid og validering af en runde.
 *
 * Ingen database og intet netværk her, så det hele kan unit-testes.
 *
 * Opsætningen (gemmes som JSON i settings under 'planner_config'):
 *   { enabled: true,
 *     slots: [ { days: [1, 3], from: "18:00", to: "20:00", courts: [1,2,3,4], tokenId: 5 },
 *              { days: [1],    from: "20:00", to: "22:00", courts: [1,2],     tokenId: null } ] }
 * Ugedage er 1 = mandag ... 7 = søndag. tokenId null = alle nøgler.
 * Tider er dansk vægur, tidligst 07:00 og senest 23:00, i kvarter-trin.
 * Flere tidsrum må gerne overlappe (fx to nøgler samtidig på hver sine baner).
 *
 * Det gamle format ({ days: { "1": { from, to, courts } } }) konverteres
 * automatisk til ét tidsrum pr. dag for alle nøgler.
 */
const { danskVaeggurTilUtc } = require('../routes/importHoldkamp');

const TIDLIGST_MIN = 7 * 60;
const SENEST_MIN = 23 * 60;
const TRIN_MIN = 15;
const MAKS_BANER = 20;
const MAKS_TIDSRUM = 30;

const UGEDAGE = ['', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

// Grænser for en runde fra badmintonplanner
const MAKS_KAMPE = 20;
const MAKS_NAVN = 100;
const MAKS_LABEL = 100;
const MAKS_RUNDE_NOTE = 500;
const MAKS_BANE_NOTE = 200;
const MAKS_UDSKIFTERE = 8;
const MAKS_ROUND_ID = 100;

/** "18:45" eller "18.45" → minutter siden midnat, ellers null. */
function minutterFraKlokkeslaet(s) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const t = Number(m[1]), mi = Number(m[2]);
    if (t > 23 || mi > 59) return null;
    return t * 60 + mi;
}

function klokkeslaetFraMinutter(min) {
    const t = Math.floor(min / 60), mi = min % 60;
    return `${String(t).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** Dansk vægur lige nu: ugedag (1 = mandag), minutter siden midnat og dato. */
function danskNu(dato = new Date()) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Copenhagen', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short'
    });
    const del = {};
    for (const p of dtf.formatToParts(dato)) if (p.type !== 'literal') del[p.type] = p.value;
    const ugedag = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[del.weekday];
    return {
        ugedag,
        minutter: Number(del.hour) * 60 + Number(del.minute),
        aar: Number(del.year),
        maaned: Number(del.month) - 1, // 0-indekseret som Date.UTC
        dag: Number(del.day)
    };
}

/** Kort tekst for en dag-liste, fx "man, ons" eller "man–fre". */
function dageTekst(days) {
    return (days || []).map(d => UGEDAGE[d].slice(0, 3)).join(', ');
}

/**
 * Validerer og normaliserer opsætningen fra admin-UI'et (nyt eller gammelt format).
 * Returnerer { value } (klar til at gemme) eller { error }.
 */
function normaliserConfig(input) {
    if (!input || typeof input !== 'object') return { error: 'Ugyldig opsætning' };
    const enabled = input.enabled === true;

    let kilde = Array.isArray(input.slots) ? input.slots : null;
    if (!kilde && input.days && typeof input.days === 'object') {
        // Gammelt format: én post pr. ugedag → ét tidsrum pr. dag for alle nøgler
        kilde = Object.entries(input.days)
            .filter(([, d]) => d && typeof d === 'object')
            .map(([n, d]) => ({ days: [Number(n)], from: d.from, to: d.to, courts: d.courts, tokenId: null }));
    }
    if (!kilde) kilde = [];
    if (kilde.length > MAKS_TIDSRUM) return { error: `Højst ${MAKS_TIDSRUM} tidsrum` };

    const slots = [];
    for (let i = 0; i < kilde.length; i++) {
        const s = kilde[i];
        const hvor = `Tidsrum ${i + 1}`;
        if (!s || typeof s !== 'object') return { error: `${hvor}: ugyldigt` };
        const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number))].sort((a, b) => a - b) : [];
        if (!days.length) return { error: `${hvor}: vælg mindst én ugedag` };
        if (days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) return { error: `${hvor}: ugyldig ugedag` };
        const from = minutterFraKlokkeslaet(s.from);
        const to = minutterFraKlokkeslaet(s.to);
        if (from === null || to === null) return { error: `${hvor}: fra og til skal være et klokkeslæt (tt:mm)` };
        if (from < TIDLIGST_MIN || to > SENEST_MIN) return { error: `${hvor}: tidsrummet skal ligge mellem 07:00 og 23:00` };
        if (from % TRIN_MIN !== 0 || to % TRIN_MIN !== 0) return { error: `${hvor}: tider skal være i kvarter-trin` };
        if (from >= to) return { error: `${hvor}: sluttid skal være efter starttid` };
        const courts = Array.isArray(s.courts) ? s.courts.map(Number) : [];
        if (courts.some(c => !Number.isInteger(c) || c < 1 || c > MAKS_BANER)) return { error: `${hvor}: ugyldigt banenummer` };
        const unikke = [...new Set(courts)].sort((a, b) => a - b);
        if (unikke.length === 0) return { error: `${hvor}: vælg mindst én bane` };
        let tokenId = null;
        if (s.tokenId !== null && s.tokenId !== undefined && s.tokenId !== '') {
            tokenId = Number(s.tokenId);
            if (!Number.isInteger(tokenId) || tokenId < 1) return { error: `${hvor}: ugyldig nøgle` };
        }
        slots.push({ days, from: klokkeslaetFraMinutter(from), to: klokkeslaetFraMinutter(to), courts: unikke, tokenId });
    }
    return { value: { enabled, slots } };
}

/** Standardopsætning når intet er gemt. */
function tomConfig() {
    return { enabled: false, slots: [] };
}

// Gælder tidsrummet for denne nøgle? tokenId undefined = "alle tidsrum"
// (admin-status), null/tal = kun tidsrum for alle nøgler eller netop denne.
function slotForToken(slot, tokenId) {
    if (tokenId === undefined) return true;
    return slot.tokenId === null || slot.tokenId === tokenId;
}

/** De tidsrum der er åbne lige nu for nøglen (slutminut eksklusivt). */
function aabneTidsrum(config, dato = new Date(), tokenId) {
    if (!config || !config.enabled || !Array.isArray(config.slots)) return [];
    const nu = danskNu(dato);
    return config.slots.filter(s =>
        s.days.includes(nu.ugedag) &&
        slotForToken(s, tokenId) &&
        nu.minutter >= minutterFraKlokkeslaet(s.from) &&
        nu.minutter < minutterFraKlokkeslaet(s.to)
    );
}

/**
 * Er der åbent lige nu for nøglen, og hvilke baner må bruges?
 * Baner er foreningen af alle åbne tidsrum; vindue er det samlede spænd.
 */
function aabneBaner(config, dato = new Date(), tokenId) {
    const slots = aabneTidsrum(config, dato, tokenId);
    if (!slots.length) return { aaben: false, baner: [], vindue: null, slots: [] };
    const baner = [...new Set(slots.flatMap(s => s.courts))].sort((a, b) => a - b);
    const from = Math.min(...slots.map(s => minutterFraKlokkeslaet(s.from)));
    const to = Math.max(...slots.map(s => minutterFraKlokkeslaet(s.to)));
    return {
        aaben: true,
        baner,
        vindue: { ugedag: danskNu(dato).ugedag, from: klokkeslaetFraMinutter(from), to: klokkeslaetFraMinutter(to) },
        slots
    };
}

/**
 * Næste tidsrum der åbner for nøglen (eller det igangværende), inden for 7 dage.
 * Returnerer { ugedag, navn, from, to, courts, tokenId } eller null.
 */
function naesteVindue(config, dato = new Date(), tokenId) {
    if (!config || !config.enabled || !Array.isArray(config.slots)) return null;
    const nu = danskNu(dato);
    for (let i = 0; i < 7; i++) {
        const ugedag = ((nu.ugedag - 1 + i) % 7) + 1;
        const kandidater = config.slots
            .filter(s => s.days.includes(ugedag) && slotForToken(s, tokenId))
            .filter(s => i > 0 || nu.minutter < minutterFraKlokkeslaet(s.to)) // dagens overståede springes over
            .sort((a, b) => minutterFraKlokkeslaet(a.from) - minutterFraKlokkeslaet(b.from));
        if (!kandidater.length) continue;
        const s = kandidater[0];
        return { ugedag, navn: UGEDAGE[ugedag], from: s.from, to: s.to, courts: [...s.courts], tokenId: s.tokenId };
    }
    return null;
}

/**
 * "19:30" (dansk vægur i dag) → UTC-instant. Ligger klokkeslættet mere end
 * 6 timer bagud i forhold til nu, tolkes det som i morgen (runder omkring
 * midnat findes ikke i praksis, men et absurd tidspunkt bør ikke opstå).
 */
function klokkeslaetIDagTilUtc(hhmm, dato = new Date()) {
    const min = minutterFraKlokkeslaet(hhmm);
    if (min === null) return null;
    const nu = danskNu(dato);
    let d = danskVaeggurTilUtc(nu.aar, nu.maaned, nu.dag, Math.floor(min / 60), min % 60);
    if (d.getTime() < dato.getTime() - 6 * 3600 * 1000) d = new Date(d.getTime() + 24 * 3600 * 1000);
    return d;
}

// ---------- Validering af en modtaget runde ----------

/** Renser et navn/tekstfelt: trim, sammenfold whitespace, fjern styretegn. */
function rensTekst(v, maks) {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/[ -]/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > maks ? s.slice(0, maks) : s;
}

/**
 * Validerer body'en fra POST /planned-round.
 * Returnerer { runde } eller { error, details }.
 *
 * runde = { roundId, sequence, label, note, nextRoundStartsAt, forceNewMatch,
 *           matches: [{ courtNumber, matchId|null, side1: [n1, n2|null], side2: [...],
 *                       substitutes: [], note }] }
 */
function validerRunde(body) {
    const fejl = [];
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Body skal være et JSON-objekt', details: [] };
    }
    if (!Array.isArray(body.matches)) fejl.push('matches skal være en liste');
    else if (body.matches.length > MAKS_KAMPE) fejl.push(`matches må højst indeholde ${MAKS_KAMPE} baner`);

    const roundId = body.roundId === undefined || body.roundId === null ? null : rensTekst(body.roundId, MAKS_ROUND_ID);
    let sequence = null;
    if (body.sequence !== undefined && body.sequence !== null) {
        sequence = Number(body.sequence);
        if (!Number.isInteger(sequence) || sequence < 0) fejl.push('sequence skal være et helt tal ≥ 0');
    }
    const label = rensTekst(body.label, MAKS_LABEL);
    const note = rensTekst(body.note, MAKS_RUNDE_NOTE);

    let nextRoundStartsAt = null;
    if (body.nextRoundStartsAt !== undefined && body.nextRoundStartsAt !== null && String(body.nextRoundStartsAt).trim() !== '') {
        if (minutterFraKlokkeslaet(body.nextRoundStartsAt) === null) fejl.push('nextRoundStartsAt skal være tt:mm eller tom');
        else nextRoundStartsAt = klokkeslaetFraMinutter(minutterFraKlokkeslaet(body.nextRoundStartsAt));
    }
    if (body.forceNewMatch !== undefined && typeof body.forceNewMatch !== 'boolean') fejl.push('forceNewMatch skal være true eller false');
    const forceNewMatch = body.forceNewMatch !== false; // standard: skift altid

    const matches = [];
    const sete = new Set();
    if (Array.isArray(body.matches)) {
        body.matches.forEach((m, i) => {
            const hvor = `matches[${i}]`;
            if (!m || typeof m !== 'object') { fejl.push(`${hvor}: skal være et objekt`); return; }
            const courtNumber = Number(m.courtNumber);
            if (!Number.isInteger(courtNumber) || courtNumber < 1 || courtNumber > MAKS_BANER) { fejl.push(`${hvor}: courtNumber skal være 1–${MAKS_BANER}`); return; }
            if (sete.has(courtNumber)) { fejl.push(`${hvor}: bane ${courtNumber} optræder to gange`); return; }
            sete.add(courtNumber);
            const s1p1 = rensTekst(m.side1Player1, MAKS_NAVN), s1p2 = rensTekst(m.side1Player2, MAKS_NAVN);
            const s2p1 = rensTekst(m.side2Player1, MAKS_NAVN), s2p2 = rensTekst(m.side2Player2, MAKS_NAVN);
            if (!s1p1 || !s2p1) fejl.push(`${hvor}: side1Player1 og side2Player1 skal udfyldes`);
            let substitutes = [];
            if (m.substitutes !== undefined && m.substitutes !== null) {
                if (!Array.isArray(m.substitutes)) fejl.push(`${hvor}: substitutes skal være en liste`);
                else {
                    substitutes = m.substitutes.map(s => rensTekst(s, MAKS_NAVN)).filter(Boolean);
                    if (substitutes.length > MAKS_UDSKIFTERE) fejl.push(`${hvor}: højst ${MAKS_UDSKIFTERE} udskiftere`);
                }
            }
            // Afsenderens id for kampen — sendes med tilbage i resultaterne
            const matchId = m.matchId === undefined || m.matchId === null ? null : (rensTekst(m.matchId, MAKS_ROUND_ID) || null);
            matches.push({
                courtNumber,
                matchId,
                side1: [s1p1, s1p2 || null],
                side2: [s2p1, s2p2 || null],
                substitutes,
                note: rensTekst(m.note, MAKS_BANE_NOTE)
            });
        });
    }

    if (fejl.length) return { error: 'Ugyldig runde', details: fejl };
    return { runde: { roundId, sequence, label, note, nextRoundStartsAt, forceNewMatch, matches } };
}

module.exports = {
    UGEDAGE, TIDLIGST_MIN, SENEST_MIN, TRIN_MIN, MAKS_KAMPE, MAKS_TIDSRUM,
    minutterFraKlokkeslaet, klokkeslaetFraMinutter, danskNu, dageTekst,
    normaliserConfig, tomConfig, aabneTidsrum, aabneBaner, naesteVindue, klokkeslaetIDagTilUtc,
    rensTekst, validerRunde
};
