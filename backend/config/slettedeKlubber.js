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
// Ved sletningen slettes intet: en klub, der blev slettet ved en fejl, kan
// reddes ved at gendanne en af backupperne (super-admin → Gendan, "fra en
// anden klub") — i 60 dage (SLETTET_BEHOLD_DAGE, besluttet af Jesper
// 2026-11-16). Derefter sletter natjobbet (scheduler.js startSlettetOprydning)
// mappen; fristen står som "slettes" i slettet.json. Kommandoerne til at se,
// redde og slette nu står i pakke-q-rapport.md.
//
// Natjobbet er et rm -rf i mappen med ALLE klubbers backups, så det er stramt
// (rydGamle): kun rigtige mapper (ikke symlinks) direkte under CLUB_BACKUP_DIR
// med præcis navneformen slettet-ÅÅÅÅMMDD-TTMMSS-<db>[-N]. En aktiv klubs
// mappe hedder <db_name>, som aldrig har '-', og kan derfor ikke matche. Alderen
// regnes fra "flyttet" i slettet.json, ellers fra tidsstemplet i navnet — aldrig
// fra filsystemets mtime. Kan den ikke afgøres, røres mappen ikke.
//
// Samme flytning sker, når en klub oprettes, og der allerede ligger mapper
// med dens db_name (rester fra en sletning før denne rettelse).

const fs = require('fs');
const path = require('path');
const { BACKUP_DIR } = require('./autoBackup');
const { UPLOAD_DIR } = require('./sponsorFiler');

const SIKKER_DB = /^[A-Za-z0-9_]+$/;
const SLETTET_BEHOLD_DAGE = 60;
const SLETTET_NAVN = /^slettet-(\d{8})-(\d{6})-[A-Za-z0-9_]+(-\d+)?$/;
const DAG_MS = 24 * 60 * 60 * 1000;

const slettesTid = (flyttet) => new Date(flyttet.getTime() + SLETTET_BEHOLD_DAGE * DAG_MS);

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
        flyttet: nu.toISOString(), slettes: slettesTid(nu).toISOString(), grund
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

// Tidsstemplet i mappenavnet (UTC, som stempel() skriver det), eller null
function navnetsTid(navn) {
    const m = SLETTET_NAVN.exec(navn);
    if (!m) return null;
    const [, d, t] = m;
    const tal = [d.slice(0, 4), d.slice(4, 6), d.slice(6, 8), t.slice(0, 2), t.slice(2, 4), t.slice(4, 6)].map(Number);
    const tid = new Date(Date.UTC(tal[0], tal[1] - 1, tal[2], tal[3], tal[4], tal[5]));
    // 20261340-… o.l. ruller over i Date — så er det ikke et tidsstempel
    return stempel(tid) === `${d}-${t}` ? tid : null;
}

// Hvornår mappen blev lavet: "flyttet" i slettet.json, ellers navnets
// tidsstempel. { tid: Date | null, kilde, info }
function flyttetTid(sti, navn) {
    let info = null;
    try { info = JSON.parse(fs.readFileSync(path.join(sti, 'slettet.json'), 'utf8')); } catch { /* mangler/ulæselig */ }
    if (info && typeof info.flyttet === 'string') {
        const t = new Date(info.flyttet);
        if (!isNaN(t.getTime())) return { tid: t, kilde: 'slettet.json', info };
    }
    const t = navnetsTid(navn);
    return { tid: t, kilde: t ? 'mappenavnet' : null, info };
}

/**
 * Natjobbet: slet slettet-mapper, der er ældre end SLETTET_BEHOLD_DAGE.
 * Returnerer { slettet: [navn], beholdt: [navn], sprunget: [navn], fejl: [navn] }.
 * En fejl på én mappe stopper ikke de næste.
 */
function rydGamle({ nu = new Date(), log = console } = {}) {
    const res = { slettet: [], beholdt: [], sprunget: [], fejl: [] };
    if (!fs.existsSync(BACKUP_DIR)) return res;
    const rod = fs.realpathSync(BACKUP_DIR);
    for (const d of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
        // Navnet først: en aktiv klubs mappe (<db_name>, uden '-') matcher aldrig
        if (!SLETTET_NAVN.test(d.name)) continue;
        const sti = path.join(BACKUP_DIR, d.name);
        try {
            if (d.isSymbolicLink() || !d.isDirectory()) {
                log.warn(`⚠️ Oprydning af slettede klubber: ${d.name} er ikke en almindelig mappe — røres ikke`);
                res.sprunget.push(d.name);
                continue;
            }
            const st = fs.lstatSync(sti);
            if (st.isSymbolicLink() || !st.isDirectory()) { res.sprunget.push(d.name); continue; }
            const opl = fs.realpathSync(sti);
            if (path.dirname(opl) !== rod || path.basename(opl) !== d.name) {
                log.warn(`⚠️ Oprydning af slettede klubber: ${d.name} peger uden for ${BACKUP_DIR} — røres ikke`);
                res.sprunget.push(d.name);
                continue;
            }
            const { tid, kilde, info } = flyttetTid(opl, d.name);
            if (!tid) {
                log.warn(`⚠️ Oprydning af slettede klubber: alderen på ${d.name} kan ikke afgøres — røres ikke`);
                res.sprunget.push(d.name);
                continue;
            }
            if (nu.getTime() < slettesTid(tid).getTime()) { res.beholdt.push(d.name); continue; }
            const dage = Math.floor((nu.getTime() - tid.getTime()) / DAG_MS);
            const klub = (info && (info.klub || info.db_name)) || '?';
            fs.rmSync(opl, { recursive: true, force: true });
            log.log(`🧹 Slettet klubs filer fjernet: ${d.name} (klub ${klub}, ${dage} dage gammel efter ${kilde})`);
            res.slettet.push(d.name);
        } catch (e) {
            log.error(`❌ Oprydning af ${d.name} fejlede:`, e.message);
            res.fejl.push(d.name);
        }
    }
    return res;
}

module.exports = { flytTilSide, liste, rydGamle, navnetsTid, SLETTET_BEHOLD_DAGE, SLETTET_NAVN };
