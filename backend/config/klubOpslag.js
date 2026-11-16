// Klub-opslaget (subdomæne → database) med en kort cache (nr. 55).
//
// Før slog hver eneste forespørgsel på et klub-subdomæne klubben op i
// master-databasen — også hver poll fra hver skærm og tablet (flere i sekundet
// pr. hal) — gennem master-puljen på 5 forbindelser. Nu huskes svaret i 30 s
// (også "findes ikke"). Super-admin tømmer cachen, når en klub oprettes,
// slettes eller (de)aktiveres, så en deaktiveret klub lukkes med det samme
// (backenden er én proces). Uden den tømning ville det ske inden for 30 s.
// En fejl i opslaget huskes ikke.

const CACHE_MS = 30 * 1000;
const MAKS = 1000;   // tilfældige subdomæner udefra må ikke fylde hukommelsen

const cache = new Map();   // subdomæne → { klub: { db_name, is_active } | null, tid }

async function slaaOp(subdomain, nu = Date.now()) {
    const c = cache.get(subdomain);
    if (c && nu - c.tid < CACHE_MS) return c.klub;
    const r = await require('./masterDatabase').queryOne(
        'SELECT db_name, is_active FROM clubs WHERE subdomain = ?',
        [subdomain]
    );
    const klub = r ? { db_name: r.db_name, is_active: r.is_active } : null;
    if (cache.size >= MAKS) cache.clear();
    cache.set(subdomain, { klub, tid: nu });
    return klub;
}

function glemKlubber() {
    cache.clear();
}

module.exports = { slaaOp, glemKlubber, CACHE_MS, MAKS, _antal: () => cache.size };
