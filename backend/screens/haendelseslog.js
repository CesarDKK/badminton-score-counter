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

async function gem(klub, skaerm, haendelser) {
    if (!haendelser || !haendelser.length) return;
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

module.exports = { gem, forKlub, alle, hentLog, antalSenesteDoegn, ryd, BEHOLD_DAGE };
