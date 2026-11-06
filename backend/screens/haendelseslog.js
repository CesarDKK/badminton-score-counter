// Skærmenes hændelser (stod stille, uden forbindelse, startet forfra, væk — og
// TV-PC'ens egen rapport om, hvordan forrige kørsel sluttede) gemt i 30 dage,
// så klubbens admin kan se dem under Adgangslinks, og super-admin på tværs af
// klubberne. Ligger i master-databasen, så super-admin ikke skal åbne hver
// klubs database. `klub` er klubbens db_name ('direct' uden klubber).
//
// En fejl her må aldrig koste et livstegn — derfor fanges den og logges bare.

const masterDb = require('../config/masterDatabase');

const BEHOLD_DAGE = 30;
const MAX_RAEKKER = 1000;

const dato = (ms) => (ms == null ? null : new Date(ms));

// ---- Loft: tabellen deles af alle klubber ----
//
// Hændelserne ligger i master-databasen, så en strøm af livstegn med opdigtede
// hændelser (et adgangslink kan lækkes) kunne fylde den disk, alle klubber
// deler. Derfor et loft pr. skærm og pr. klub pr. time — langt over, hvad
// rigtige skærme melder (et par stykker om dagen) — og et mindre loft for
// hændelser med loguddrag (op til 32 KB hver). Demoen gemmer slet ingen
// (se routes/screens.js).
const MAX_PR_TIME_SKAERM = 40;
const MAX_PR_TIME_KLUB = 300;
const MAX_LOG_PR_TIME_KLUB = 10;
const TIME_MS = 3600 * 1000;

const talt = new Map();       // 'klub', 'klub|skærm' eller 'klub#log' -> [tidspunkter]
const advaret = new Map();    // klub -> hvornår loftet sidst blev skrevet i loggen

function brugt(noegle, nu) {
    const tider = (talt.get(noegle) || []).filter(t => nu - t < TIME_MS);
    if (tider.length) talt.set(noegle, tider); else talt.delete(noegle);
    return tider;
}

// Hvor mange af skærmens `antal` nye hændelser må gemmes nu? Tæller dem med.
function plads(klub, klientId, antal, nu = Date.now()) {
    const iKlub = brugt(klub, nu);
    const paaSkaerm = brugt(`${klub}|${klientId}`, nu);
    const tilladt = Math.max(0, Math.min(antal, MAX_PR_TIME_KLUB - iKlub.length, MAX_PR_TIME_SKAERM - paaSkaerm.length));
    if (tilladt > 0) {
        talt.set(klub, [...iKlub, ...Array(tilladt).fill(nu)]);
        talt.set(`${klub}|${klientId}`, [...paaSkaerm, ...Array(tilladt).fill(nu)]);
    }
    return tilladt;
}

// Må endnu et loguddrag gemmes for klubben i denne time? Tæller det med.
function pladsTilLog(klub, nu = Date.now()) {
    const logs = brugt(`${klub}#log`, nu);
    if (logs.length >= MAX_LOG_PR_TIME_KLUB) return false;
    talt.set(`${klub}#log`, [...logs, nu]);
    return true;
}

// De hændelser, der må gemmes nu (de ældste først — livstegnet sender dem i
// tidsorden), uden loguddrag ud over loftet. Skriver én linje i timen, når
// loftet er nået.
function indenforLoft(klub, klientId, haendelser, nu = Date.now()) {
    const tilladt = plads(klub, klientId, haendelser.length, nu);
    if (tilladt < haendelser.length && nu - (advaret.get(klub) || 0) > TIME_MS) {
        advaret.set(klub, nu);
        console.warn(`[skærm] ${klub}: loftet for hændelser er nået (${MAX_PR_TIME_SKAERM} pr. skærm, ${MAX_PR_TIME_KLUB} pr. klub i timen) — resten gemmes ikke`);
    }
    return haendelser.slice(0, tilladt).map(h => (h.log && !pladsTilLog(klub, nu) ? { ...h, log: null } : h));
}

function _nulstilLoft() { talt.clear(); advaret.clear(); }

async function gem(klub, skaerm, haendelser) {
    if (!haendelser || !haendelser.length) return;
    haendelser = indenforLoft(klub, skaerm.klientId, haendelser);
    if (!haendelser.length) return;
    try {
        const pladser = haendelser.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
        const vaerdier = haendelser.flatMap(h => [
            klub, skaerm.klientId, skaerm.navn || null, skaerm.side || 'tv', skaerm.bane || null,
            skaerm.tokenId || null, h.type, dato(h.fra), dato(h.til), h.sek ?? null,
            h.tekst || null, h.log || null
        ]);
        await masterDb.query(
            `INSERT INTO skaerm_haendelser
                (klub, klient_id, navn, side, bane, token_id, type, fra, til, sek, tekst, log)
             VALUES ${pladser}`,
            vaerdier
        );
    } catch (e) {
        console.error('Skærm-hændelser kunne ikke gemmes:', e.message);
    }
}

function fraDato(dage) {
    const d = Math.min(Math.max(parseInt(dage, 10) || BEHOLD_DAGE, 1), BEHOLD_DAGE);
    return new Date(Date.now() - d * 24 * 3600 * 1000);
}

// Klubbens hændelser, nyeste først. Loggen hentes for sig (hentLog) — den kan
// fylde titusinder af tegn pr. hændelse.
async function forKlub(klub, dage) {
    return masterDb.query(
        `SELECT id, klient_id, navn, side, bane, token_id, type, fra, til, sek, tekst,
                (log IS NOT NULL) AS har_log
           FROM skaerm_haendelser
          WHERE klub = ? AND fra >= ?
          ORDER BY fra DESC, id DESC
          LIMIT ${MAX_RAEKKER}`,
        [klub, fraDato(dage)]
    );
}

// Alle klubbers hændelser (super-admin), med klubbens navn
async function alle(dage) {
    return masterDb.query(
        `SELECT h.id, h.klub, c.name AS klub_navn, c.subdomain, h.klient_id, h.navn, h.side,
                h.bane, h.type, h.fra, h.til, h.sek, h.tekst, (h.log IS NOT NULL) AS har_log
           FROM skaerm_haendelser h
           LEFT JOIN clubs c ON c.db_name = h.klub
          WHERE h.fra >= ?
          ORDER BY h.fra DESC, h.id DESC
          LIMIT ${MAX_RAEKKER}`,
        [fraDato(dage)]
    );
}

// Loguddraget fra en TV-PC's rapport. klub = null: super-admin (alle klubber).
async function hentLog(id, klub) {
    const rows = await masterDb.query(
        `SELECT log FROM skaerm_haendelser WHERE id = ?${klub == null ? '' : ' AND klub = ?'}`,
        klub == null ? [id] : [id, klub]
    );
    return rows.length ? rows[0].log : null;
}

// Antal hændelser pr. klub det seneste døgn: { db_name: antal }
async function antalSenesteDoegn() {
    const rows = await masterDb.query(
        `SELECT klub, COUNT(*) AS antal FROM skaerm_haendelser WHERE fra >= ? GROUP BY klub`,
        [new Date(Date.now() - 24 * 3600 * 1000)]
    );
    return Object.fromEntries(rows.map(r => [r.klub, Number(r.antal)]));
}

async function ryd() {
    const r = await masterDb.query('DELETE FROM skaerm_haendelser WHERE fra < ?', [fraDato(BEHOLD_DAGE)]);
    return r.affectedRows || 0;
}

module.exports = {
    gem, forKlub, alle, hentLog, antalSenesteDoegn, ryd, BEHOLD_DAGE,
    plads, pladsTilLog, indenforLoft, _nulstilLoft, MAX_PR_TIME_SKAERM, MAX_PR_TIME_KLUB, MAX_LOG_PR_TIME_KLUB
};
