/**
 * Ren logik for et indtastet kampresultat (ingen database).
 *
 * Et resultat er en liste af sæt set fra banens to sider, fx [[15, 7], [13, 4]]
 * (side 1 først), en valgt vinder (1 eller 2) og evt. walkover. Kampen må gerne
 * være afsluttet før tid — så er sidste sæt ikke spillet færdigt, og vinderen
 * er den, brugeren vælger.
 *
 * Samme regler findes i frontend/js/kamp-resultat.js (tællersiden foreslår
 * vinder og viser om kampen er fuldført) — backend/tests/unit/kamp-resultat.test.js
 * kører de samme tilfælde mod begge, så de ikke glider fra hinanden.
 */

const MAKS_SAET = 3;

function graenser(gameMode) {
    return gameMode === '21' ? { vind: 21, maks: 30 } : { vind: 15, maks: 21 };
}

/** Er sættet spillet færdigt efter reglerne? (først til vind med 2 i forspring, dog højst maks) */
function saetFaerdigt(a, b, gameMode) {
    const { vind, maks } = graenser(gameMode);
    const hoj = Math.max(a, b), lav = Math.min(a, b);
    return (hoj >= vind && hoj - lav >= 2) || hoj === maks;
}

/** 1 eller 2 hvis sættet er vundet, ellers 0 (ikke færdigspillet eller lige). */
function saetVinder(a, b, gameMode) {
    if (a === b || !saetFaerdigt(a, b, gameMode)) return 0;
    return a > b ? 1 : 2;
}

/** Antal færdigspillede sæt vundet af hver side: [side1, side2]. */
function vundneSaet(saet, gameMode) {
    const v = [0, 0];
    for (const [a, b] of saet) {
        const w = saetVinder(a, b, gameMode);
        if (w) v[w - 1]++;
    }
    return v;
}

/**
 * Foreslået vinder: flest vundne sæt; står det lige, den der fører i sidste
 * (uafsluttede) sæt; ellers flest point i alt. null hvis intet skiller dem.
 */
function foreslaaVinder(saet, gameMode) {
    const [v1, v2] = vundneSaet(saet, gameMode);
    if (v1 !== v2) return v1 > v2 ? 1 : 2;
    const sidste = saet[saet.length - 1];
    if (sidste && sidste[0] !== sidste[1]) return sidste[0] > sidste[1] ? 1 : 2;
    const p1 = saet.reduce((s, x) => s + x[0], 0);
    const p2 = saet.reduce((s, x) => s + x[1], 0);
    if (p1 !== p2) return p1 > p2 ? 1 : 2;
    return null;
}

/**
 * 'completed' når sættene udgør en færdigspillet kamp (en side har vundet 2
 * sæt, og alle sæt er spillet færdigt), ellers 'ended_early'.
 */
function afslutning(saet, gameMode) {
    const [v1, v2] = vundneSaet(saet, gameMode);
    const alleFaerdige = saet.every(([a, b]) => saetVinder(a, b, gameMode) !== 0);
    return alleFaerdige && Math.max(v1, v2) === 2 ? 'completed' : 'ended_early';
}

/**
 * Validerer en indtastning fra tællersiden.
 * body = { winner: 1|2, walkover: bool, sets: [[a, b], ...] }
 * Returnerer { resultat: { sets, winner, walkover, outcome } } eller { error }.
 */
function validerIndtastning(body, gameMode) {
    if (!body || typeof body !== 'object') return { error: 'Resultatet mangler' };
    const winner = Number(body.winner);
    if (winner !== 1 && winner !== 2) return { error: 'Vælg hvem der vandt' };

    if (body.walkover === true) {
        return { resultat: { sets: [], winner, walkover: true, outcome: 'walkover' } };
    }

    if (!Array.isArray(body.sets)) return { error: 'Indtast mindst ét sæt' };
    const { maks } = graenser(gameMode);
    const saet = [];
    for (const s of body.sets) {
        if (!Array.isArray(s) || s.length !== 2) return { error: 'Ugyldigt sæt' };
        const a = Number(s[0]), b = Number(s[1]);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) return { error: 'Point skal være hele tal' };
        if (a > maks || b > maks) return { error: `Et sæt kan højst gå til ${maks}` };
        saet.push([a, b]);
    }
    // Tomme sæt (0-0) sidst i listen ignoreres — de er bare ikke udfyldt
    while (saet.length && saet[saet.length - 1][0] === 0 && saet[saet.length - 1][1] === 0) saet.pop();
    if (!saet.length) return { error: 'Indtast mindst ét sæt' };
    if (saet.length > MAKS_SAET) return { error: `Højst ${MAKS_SAET} sæt` };

    for (let i = 0; i < saet.length; i++) {
        const [a, b] = saet[i];
        const sidst = i === saet.length - 1;
        if (!sidst && saetVinder(a, b, gameMode) === 0) {
            return { error: `Sæt ${i + 1} er ikke spillet færdigt — kun sidste sæt må være afbrudt` };
        }
        const [v1, v2] = vundneSaet(saet.slice(0, i), gameMode);
        if (Math.max(v1, v2) >= 2) return { error: `Kampen var afgjort efter sæt ${i}` };
    }

    const outcome = afslutning(saet, gameMode);
    if (outcome === 'completed') {
        const [v1, v2] = vundneSaet(saet, gameMode);
        const rigtig = v1 > v2 ? 1 : 2;
        if (winner !== rigtig) return { error: 'Vinderen skal være den side, der har vundet 2 sæt' };
    }
    return { resultat: { sets: saet, winner, walkover: false, outcome } };
}

module.exports = {
    MAKS_SAET, saetFaerdigt, saetVinder, vundneSaet, foreslaaVinder, afslutning, validerIndtastning
};
