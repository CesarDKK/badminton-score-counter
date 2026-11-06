// Status for den fulde backup (scripts/backup-loop.sh i containeren
// badminton-backup): alle databaser i én dump plus de uploadede billeder, én gang
// i døgnet. Den er den eneste kopi af bl.a. master-databasen, klub-admins og
// football — og før kunne ingen se, om den virkede: en fejlet dump stod kun i
// containerens log.
//
// Scriptet skriver status.json i backup-mappen efter hver kørsel. Mappen er
// monteret skrivebeskyttet i backenden (docker-compose: FULD_BACKUP_DIR), og
// super-admin viser den under Serverens helbred.

const fs = require('fs');
const path = require('path');

const DIR = process.env.FULD_BACKUP_DIR || path.join(__dirname, '..', 'fuld-backup');
const TIME_MS = 3600 * 1000;

const tid = (v) => {
    const ms = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(ms) ? ms : null;
};
const tal = (v, standard) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : standard);

/**
 * Vurderer indholdet af status.json. raa: det parsede indhold (eller null, når
 * filen ikke findes). Returnerer
 *   { opsat: false }                                    — ingen status endnu
 *   { opsat: true, tid, ok, fejl, uploadsOk, senesteGode, senesteGodeBytes,
 *     antal, intervalTimer, beholdDage, niveau, besked }
 * niveau: null (alt godt), 'advarsel' eller 'kritisk'; besked forklarer hvorfor.
 */
function vurder(raa, nu = Date.now()) {
    if (!raa || typeof raa !== 'object' || tid(raa.tid) === null) return { opsat: false };
    const interval = tal(raa.intervalTimer, 24);
    const gode = tid(raa.senesteGode);
    const koert = tid(raa.tid);
    const s = {
        opsat: true,
        tid: new Date(koert).toISOString(),
        ok: raa.ok === true,
        fejl: raa.ok === true ? null : String(raa.fejl || 'ukendt fejl').slice(0, 300),
        uploadsOk: raa.uploadsOk === true ? true : raa.uploadsOk === false ? false : null,
        senesteGode: gode === null ? null : new Date(gode).toISOString(),
        senesteGodeBytes: tal(raa.senesteGodeBytes, 0),
        antal: tal(raa.antal, 0),
        intervalTimer: interval,
        beholdDage: tal(raa.beholdDage, 14),
        niveau: null,
        besked: null
    };
    const timerSiden = (ms) => Math.floor((nu - ms) / TIME_MS);
    if (gode === null) {
        s.niveau = 'kritisk';
        s.besked = 'Der findes ingen god backup';
    } else if (nu - gode > 3 * interval * TIME_MS) {
        s.niveau = 'kritisk';
        s.besked = `Den seneste gode backup er ${timerSiden(gode)} timer gammel`;
    } else if (!s.ok) {
        s.niveau = 'advarsel';
        s.besked = 'Den seneste kørsel fejlede';
    } else if (nu - koert > 1.5 * interval * TIME_MS) {
        // Scriptet skriver efter hver kørsel — er status gammel, kører det ikke
        s.niveau = 'advarsel';
        s.besked = `Backup-tjenesten har ikke kørt i ${timerSiden(koert)} timer`;
    } else if (s.uploadsOk === false) {
        s.niveau = 'advarsel';
        s.besked = 'Databaserne er gemt, men billederne kunne ikke arkiveres';
    }
    return s;
}

// Læser status.json. Mangler mappen eller filen (ældre docker-compose uden
// monteringen, eller første kørsel er ikke færdig), er svaret { opsat: false }.
function status(nu = Date.now()) {
    let raa = null;
    try {
        raa = JSON.parse(fs.readFileSync(path.join(DIR, 'status.json'), 'utf8'));
    } catch { /* ingen status */ }
    return vurder(raa, nu);
}

module.exports = { status, vurder, DIR };
