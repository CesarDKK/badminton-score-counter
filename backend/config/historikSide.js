// Én side af en historik-liste (nr. 88): ?limit= (højst HISTORIK_MAKS) og
// ?offset=. Før blev hele historikken for holdkampe og turneringer hentet i ét
// kald uden login — med en forespørgsel pr. holdkamp/turnering.
const HISTORIK_MAKS = 200;

function historikSide(query = {}, standard = HISTORIK_MAKS) {
    const tal = (v, d) => {
        const n = parseInt(v, 10);
        return Number.isInteger(n) ? n : d;
    };
    return {
        limit: Math.min(Math.max(tal(query.limit, standard), 1), HISTORIK_MAKS),
        offset: Math.max(tal(query.offset, 0), 0)
    };
}

module.exports = { historikSide, HISTORIK_MAKS };
