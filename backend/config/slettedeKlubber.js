// En slettet klubs filer (nr. 57): de automatiske backups i
// <CLUB_BACKUP_DIR>/<db_name>/ og upload-mappen <UPLOAD_DIR>/<db_name>/
// (sponsorbilleder, livestream-logo) blev før liggende, når klubben blev slettet.
// En ny klub med samme subdomæne får samme db_name — og så den gamle klubs
// backups (spillernavne, resultater) under "Gendan en valgt backup" og kunne
// gendanne dem.
//
// Nu flyttes begge mapper ved sletningen til
//     <CLUB_BACKUP_DIR>/slettet-<ÅÅÅÅMMDD-TTMMSS>-<db_name>/
//         backups/      klubbens automatiske backups (gzippet JSON)
//         uploads/      klubbens upload-mappe
//         slettet.json  hvilken klub, hvornår og hvorfor
// Navnet indeholder '-', som et databasenavn aldrig gør, så mappen kan aldrig
// blive en klubs egen og står aldrig i nogen listning. Den ligger i
// club-backups-volumet, som ikke udstilles på nettet (det gør uploads).
//
// Der slettes intet: en klub, der blev slettet ved en fejl, kan reddes ved at
// gendanne en af backupperne (super-admin → Gendan, "fra en anden klub").
// Mapperne ryddes ikke af sig selv (se pakke-q-rapport.md for kommandoerne).
//
// Samme flytning sker, når en klub oprettes, og der allerede ligger mapper
// med dens db_name (rester fra en sletning før denne rettelse).

const fs = require('fs');
const path = require('path');
const { BACKUP_DIR } = require('./autoBackup');
const { UPLOAD_DIR } = require('./sponsorFiler');

const SIKKER_DB = /^[A-Za-z0-9_]+$/;

function stempel(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

// rename, og på tværs af volumes (uploads → club-backups) kopiér og slet
function flyt(fra, til) {
    try {
        fs.renameSync(fra, til);
    } catch (e) {
        if (e.code !== 'EXDEV') throw e;
        fs.cpSync(fra, til, { recursive: true, preserveTimestamps: true });
        fs.rmSync(fra, { recursive: true, force: true });
    }
}

// Mapperne for klubben, der findes nu: [[del, sti]]
function klubbensMapper(dbName) {
    return [['backups', path.join(BACKUP_DIR, dbName)], ['uploads', path.join(UPLOAD_DIR, dbName)]]
        .filter(([, sti]) => fs.existsSync(sti));
}

/**
 * Flyt klubbens backup- og upload-mappe til side. Returnerer mappens navn
 * (under CLUB_BACKUP_DIR), eller null, når der intet var at flytte.
 * klub: { name, subdomain, db_name } (til slettet.json); grund: tekst.
 */
function flytTilSide(klub, { grund = 'klubben blev slettet', nu = new Date() } = {}) {
    const dbName = String((klub && klub.db_name) || '');
    if (!SIKKER_DB.test(dbName)) throw new Error(`Ugyldigt databasenavn: ${dbName}`);
    const mapper = klubbensMapper(dbName);
    if (!mapper.length) return null;

    let navn = `slettet-${stempel(nu)}-${dbName}`;
    for (let i = 2; fs.existsSync(path.join(BACKUP_DIR, navn)); i++) navn = `slettet-${stempel(nu)}-${dbName}-${i}`;
    const dest = path.join(BACKUP_DIR, navn);
    fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dest, 'slettet.json'), JSON.stringify({
        klub: klub.name || null, subdomain: klub.subdomain || null, db_name: dbName,
        oprettet: klub.created_at ? new Date(klub.created_at).toISOString() : null,
        flyttet: nu.toISOString(), grund
    }, null, 2) + '\n');
    for (const [del, sti] of mapper) flyt(sti, path.join(dest, del));
    return navn;
}

// De flyttede mapper (til super-admin/fejlsøgning): [{ navn, ...slettet.json }]
function liste() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('slettet-'))
        .map(d => {
            let info = {};
            try { info = JSON.parse(fs.readFileSync(path.join(BACKUP_DIR, d.name, 'slettet.json'), 'utf8')); } catch { /* ingen info */ }
            return { navn: d.name, ...info };
        })
        .sort((a, b) => b.navn.localeCompare(a.navn));
}

module.exports = { flytTilSide, liste };
