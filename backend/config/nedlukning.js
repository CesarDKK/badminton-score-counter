// Hurtig nedlukning ved SIGTERM (nr. 54).
//
// Før ventede server.close() på de åbne live-strømme (SSE: TV, oversigt,
// tablets, admin, /live), som aldrig slutter af sig selv. Hver deploy endte
// derfor i Dockers timeout på 10 s og et SIGKILL — uden at puljerne blev lukket,
// og uden at dagens YouTube-forbrug blev gemt.
//
// Nu:
//   1. nye live-strømme afvises (503) — klienten prøver igen og rammer den nye container,
//   2. serveren tager ikke imod nye forbindelser (server.close),
//   3. de åbne live-strømme lukkes aktivt (klienternes EventSource genforbinder selv
//      efter "retry: 2000"), og ledige keep-alive-forbindelser lukkes,
//   4. efter GRACE_MS lukkes også forbindelser med en forespørgsel i gang,
//   5. oprydningen kører (YouTube-forbruget gemmes, databasepuljerne lukkes) —
//      hvert trin højst TRIN_MS,
//   6. processen afslutter — senest efter MAKS_MS, under Dockers 10 s.

const GRACE_MS = 3000;
const TRIN_MS = 2000;
const MAKS_MS = 8000;

let lukker = false;
const aabneStroemme = new Set();

function erLukkende() { return lukker; }

// SSE-endpointet melder hver strøm her; kald det returnerede, når den lukkes
function huskStroem(res) {
    aabneStroemme.add(res);
    return () => aabneStroemme.delete(res);
}

function antalStroemme() { return aabneStroemme.size; }

// Afslut alle åbne strømme; returnerer hvor mange
function lukStroemme() {
    const n = aabneStroemme.size;
    for (const res of aabneStroemme) {
        try { res.end(); } catch { /* allerede lukket */ }
    }
    aabneStroemme.clear();
    return n;
}

/**
 * Lav nedluknings-funktionen til server.js.
 *   server: http.Server
 *   oprydning: [async () => …] — køres efter, at serveren er lukket; en fejl stopper ikke de næste
 *   exit: process.exit (erstattes i test)
 * Funktionen kan kaldes flere gange (SIGTERM + SIGINT); kun første gang tæller.
 */
function lavNedlukning({ server, oprydning = [], exit = (kode) => process.exit(kode),
    graceMs = GRACE_MS, maksMs = MAKS_MS, trinMs = TRIN_MS, log = console } = {}) {
    let igang = null;
    return function nedluk(signal) {
        if (igang) return igang;
        lukker = true;
        const start = Date.now();
        log.log(`${signal} modtaget: lukker ned`);
        const haardt = setTimeout(() => {
            log.error(`✗ Nedlukningen tog over ${maksMs / 1000} s — afslutter uden at vente længere`);
            exit(1);
        }, maksMs);
        if (haardt.unref) haardt.unref();

        igang = (async () => {
            const lukket = new Promise((resolve) => server.close(() => resolve()));
            const n = lukStroemme();
            if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
            const tvang = setTimeout(() => {
                if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            }, graceMs);
            if (tvang.unref) tvang.unref();
            await lukket;
            clearTimeout(tvang);
            log.log(`✓ HTTP-serveren er lukket (${n} live-strøm(me) afsluttet)`);
            // Hvert trin højst TRIN_MS: en database, der ikke svarer, må ikke
            // skubbe nedlukningen op mod Dockers SIGKILL
            for (const trin of oprydning) {
                let stop;
                const loft = new Promise((_, afvis) => {
                    stop = setTimeout(() => afvis(new Error(`svarede ikke på ${trinMs / 1000} s`)), trinMs);
                    if (stop.unref) stop.unref();
                });
                try { await Promise.race([Promise.resolve().then(trin), loft]); }
                catch (e) { log.error('✗ Fejl under nedlukningen:', e && e.message); }
                finally { clearTimeout(stop); }
            }
            clearTimeout(haardt);
            log.log(`✓ Nedlukning færdig på ${((Date.now() - start) / 1000).toFixed(1)} s`);
            exit(0);
        })();
        return igang;
    };
}

function _nulstil() { lukker = false; aabneStroemme.clear(); }

module.exports = { lavNedlukning, huskStroem, erLukkende, lukStroemme, antalStroemme, GRACE_MS, TRIN_MS, MAKS_MS, _nulstil };
