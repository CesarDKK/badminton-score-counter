// Automatisk backup af klubberne: hver mandag kl. 02.00 dansk tid (scheduler.js)
// tages en backup af hver aktiv klub, og de 4 nyeste gemmes. Lige før en
// gendannelse tages en "før gendannelse"-backup, så en gendannelse kan fortrydes
// (kun den nyeste af dem gemmes).
//
// Filerne ligger på serveren i <CLUB_BACKUP_DIR>/<klubbens db_name>/, som
// gzippet JSON i samme format som "Download backup" (config/klubBackup.js).
// Demoen (app.) er ingen klub i master-databasen og kommer derfor ikke med.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { lavBackup } = require('./klubBackup');

const BACKUP_DIR = path.resolve(process.env.CLUB_BACKUP_DIR || path.join(__dirname, '..', 'club-backups'));

// Hvor mange af hver slags der gemmes
const BEHOLD = { auto: 4, 'foer-gendannelse': 1 };

// auto-20261020-000012.json.gz — tidspunktet er UTC
const FILNAVN = /^(auto|foer-gendannelse)-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.json\.gz$/;
const SIKKER_DB = /^[A-Za-z0-9_]+$/;

function klubDir(dbName) {
    if (!SIKKER_DB.test(String(dbName || ''))) throw new Error(`Ugyldigt databasenavn: ${dbName}`);
    return path.join(BACKUP_DIR, dbName);
}

function filnavnFor(type, dato = new Date()) {
    const p = (n) => String(n).padStart(2, '0');
    const d = `${dato.getUTCFullYear()}${p(dato.getUTCMonth() + 1)}${p(dato.getUTCDate())}`;
    const t = `${p(dato.getUTCHours())}${p(dato.getUTCMinutes())}${p(dato.getUTCSeconds())}`;
    return `${type}-${d}-${t}.json.gz`;
}

// { type, tidspunkt } for et gyldigt backup-filnavn, ellers null
function fortolkFilnavn(fil) {
    const m = FILNAVN.exec(String(fil || ''));
    if (!m) return null;
    const [, type, Y, M, D, h, mi, s] = m;
    return { type, tidspunkt: new Date(Date.UTC(+Y, +M - 1, +D, +h, +mi, +s)) };
}

// Klubbens backups, nyeste først
function listBackups(dbName) {
    const dir = klubDir(dbName);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .map(fil => {
            const info = fortolkFilnavn(fil);
            if (!info) return null;
            return { fil, type: info.type, tidspunkt: info.tidspunkt.toISOString(), stoerrelse: fs.statSync(path.join(dir, fil)).size };
        })
        .filter(Boolean)
        .sort((a, b) => b.tidspunkt.localeCompare(a.tidspunkt));
}

// Slet de ældste af en slags, så der højst er BEHOLD[type] tilbage
function ryd(dbName, type) {
    const dir = klubDir(dbName);
    const slettes = listBackups(dbName).filter(b => b.type === type).slice(BEHOLD[type]);
    for (const b of slettes) fs.unlinkSync(path.join(dir, b.fil));
    return slettes.map(b => b.fil);
}

// Læs en backup — kun et gyldigt filnavn i klubbens egen mappe
function laesBackup(dbName, fil) {
    if (!fortolkFilnavn(fil)) return null;
    const sti = path.join(klubDir(dbName), fil);
    if (!fs.existsSync(sti)) return null;
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(sti)).toString('utf8'));
}

// Tag og gem en backup af klubben. conn: forbindelse til klubbens database.
// Skrives først til en .part-fil, så en afbrudt backup aldrig ligner en hel.
async function tagBackup(conn, club, type) {
    const backup = await lavBackup(conn, { mappe: club.db_name, clubSubdomain: club.subdomain, clubName: club.name });
    const dir = klubDir(club.db_name);
    fs.mkdirSync(dir, { recursive: true });
    const fil = filnavnFor(type);
    const sti = path.join(dir, fil);
    fs.writeFileSync(sti + '.part', zlib.gzipSync(JSON.stringify(backup)));
    fs.renameSync(sti + '.part', sti);
    ryd(club.db_name, type);
    return fil;
}

// Næste mandag kl. 02.00 dansk tid som Date (til visning)
function naesteKoersel(nu = new Date()) {
    const dk = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short'
    });
    const dele = (d) => Object.fromEntries(dk.formatToParts(d).map(p => [p.type, p.value]));
    // Dansk tid kl. 02.00 på en given dansk dato → det rigtige øjeblik (UTC+1 eller +2)
    const kl2 = (y, m, d) => {
        for (const forskydning of [1, 2]) {
            const t = new Date(Date.UTC(y, m - 1, d, 2 - forskydning));
            const p = dele(t);
            if (+p.hour === 2 && +p.day === d) return t;
        }
        return new Date(Date.UTC(y, m - 1, d, 1));
    };
    const idag = dele(nu);
    for (let i = 0; i <= 7; i++) {
        const dato = new Date(Date.UTC(+idag.year, +idag.month - 1, +idag.day + i));
        if (dato.getUTCDay() !== 1) continue; // mandag
        const t = kl2(dato.getUTCFullYear(), dato.getUTCMonth() + 1, dato.getUTCDate());
        if (t > nu) return t;
    }
    return null;
}

module.exports = {
    BACKUP_DIR, BEHOLD, klubDir, filnavnFor, fortolkFilnavn, listBackups, ryd, laesBackup, tagBackup, naesteKoersel
};
