// Offentlig helbredsadresse til overvågning udefra (nr. 53): GET /api/health.
//
// /health (Dockers healthcheck) kan ikke nås udefra: nginx har ingen location
// for den, så https://app.badmintonapp.dk/health gav forsiden (index.html) med
// 200 — også når backenden var nede. /api/health går gennem nginx' /api/ til
// backenden og svarer
//   200 {"status":"ok"}    når opstarten er færdig, og master-databasen svarer
//   503 {"status":"fejl"}  ellers (også når databasen ikke svarer inden 3 s)
// — uden versioner, klubnavne eller fejltekster. Svaret huskes i 5 s, og
// samtidige kald deler ét tjek, så adressen ikke kan bruges til at belaste
// databasen. Ruten står før klub-opslaget (server.js) og virker på alle
// subdomæner.

const CACHE_MS = 5000;
const DB_LOFT_MS = 3000;

function medLoft(promise, ms) {
    let t;
    const loft = new Promise((_, afvis) => { t = setTimeout(() => afvis(new Error('timeout')), ms); });
    return Promise.race([promise, loft]).finally(() => clearTimeout(t));
}

function lavHelbred({
    cacheMs = CACHE_MS, loftMs = DB_LOFT_MS, nu = () => Date.now(),
    master = () => require('./masterDatabase').query('SELECT 1'),
    klar = () => require('./opstart').erKlar(),
} = {}) {
    let sidst = null;      // { ok, tid }
    let igang = null;

    async function tjek() {
        if (sidst && nu() - sidst.tid < cacheMs) return sidst.ok;
        if (igang) return igang;
        igang = (async () => {
            let ok = false;
            try {
                ok = !!klar() && (await medLoft(Promise.resolve().then(master), loftMs), true);
            } catch {
                ok = false;
            }
            sidst = { ok, tid: nu() };
            return ok;
        })().finally(() => { igang = null; });
        return igang;
    }

    async function rute(req, res) {
        const ok = await tjek();
        res.set('Cache-Control', 'no-store');
        res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'fejl' });
    }

    return { tjek, rute };
}

module.exports = { lavHelbred, ...lavHelbred(), CACHE_MS, DB_LOFT_MS };
