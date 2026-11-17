// Backup og gendannelse af én klubs data — fælles for Indstillinger → Backup
// (routes/backup.js), super-admin (routes/superAdmin.js) og den automatiske
// ugentlige backup (config/autoBackup.js), så de tre altid gemmer og gendanner
// det samme.
//
// Filnavne, filstier og kolonnenavne i en backup-fil er angriberkontrollerede:
// filnavnet ender i fs.writeFileSync (path traversal), file_path blev før brugt,
// når et billede blev slettet (vilkårlig filsletning), og kolonnenavnet står i
// backticks i SQL (identifier injection). Alt valideres FØR noget skrives, og
// sponsorbillederne peges ind i klubbens egen mappe (config/sponsorFiler.js).

const fs = require('fs');
const path = require('path');
const { backupFilnavn, tilpasSponsorRaekker, skrivSponsorFiler, sponsorFilSti, rydUbrugteFiler } = require('./sponsorFiler');
const { laesIndstillinger } = require('../screens/livestream');
const { tilGendannelse, statements } = require('./dataMigrationer');

const BACKUP_VERSION = '1.0';

// Tabellerne i en backup, i gendannelses-rækkefølge (forældre før børn).
// Klub-admins og deres adgangskoder er bevidst IKKE med: en gendannelse må ikke
// låse nogen ude eller give en gammel adgangskode liv igen. Det samme gælder
// adgangslinkene (device_tokens, nr. 47): før rullede en gendannelse dem
// tilbage — tilbagekaldte links virkede igen, og nye links (og TV'erne på dem)
// holdt op med at virke. Nu bevares klubbens nuværende links; ældre backups,
// der har dem med, gendannes uden dem. Banernes stream-nøgler følger samme
// regel (nr. 21b, SERVERKOLONNER herunder).
const BACKUP_TABLES = [
    'settings',
    'sponsor_settings',
    'courts',
    'court_streams',
    'sponsor_images',
    'sponsor_image_courts',
    'game_states',
    'match_history',
    'team_matches',
    'team_match_games',
    'player_info',
    'tournaments',
    'tournament_matches',
    'tournament_player_clubs',
    'player_logos',
];

const SIKKERT_KOLONNENAVN = /^[A-Za-z0-9_]+$/;

// Kolonner, der ikke kommer med i backup-filen, og som en gendannelse tager fra
// klubbens nuværende rækker (nr. 21b). Stream-nøglerne stod før i klar tekst i
// filen — den downloades, mailes og ligger på laptops, og med nøglen kan enhver
// sende på klubbens kanal. yt_* er banens stream på den forbundne YouTube-kanal
// (nøgle, adresse, udsendelse); forbindelsen selv (livestream_youtube) er heller
// ikke med, så de hører til serveren, ikke til data. Ældre backups, der har
// kolonnerne med, gendannes uden dem: klubbens nuværende nøgler bevares.
//   noegle: rækkens nøgle (en bane), skjul: kolonnerne, der holdes ude
const SERVERKOLONNER = {
    court_streams: { noegle: 'court_number', skjul: (kol) => kol === 'stream_key' || kol.startsWith('yt_') },
};

function udenServerkolonner(table, row) {
    const s = SERVERKOLONNER[table];
    if (!s || !row || typeof row !== 'object') return row;
    return Object.fromEntries(Object.entries(row).filter(([k]) => !s.skjul(k)));
}

// Klubbens nuværende værdier i de skjulte kolonner: Map(nøgle → { kolonne: værdi })
async function nuvaerendeServerkolonner(conn, table) {
    const s = SERVERKOLONNER[table];
    const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
    const bevar = new Map();
    for (const r of rows) {
        bevar.set(String(r[s.noegle]), Object.fromEntries(Object.entries(r).filter(([k]) => s.skjul(k))));
    }
    return bevar;
}

// Backuppens rækker uden de skjulte kolonner, med klubbens nuværende værdier
// sat ind. En bane, der har en nøgle nu, men ikke er i backuppen, beholder den
// i en række for sig (slået fra, som en ny bane), så nøglen ikke går tabt.
function medServerkolonner(table, rows, bevar) {
    const s = SERVERKOLONNER[table];
    const brugt = new Set();
    const ud = rows.map(row => {
        const k = String(row[s.noegle]);
        brugt.add(k);
        return { ...udenServerkolonner(table, row), ...(bevar.get(k) || {}) };
    });
    for (const [k, vaerdier] of bevar) {
        if (brugt.has(k) || !Object.values(vaerdier).some(v => v !== null && v !== undefined)) continue;
        ud.push({ [s.noegle]: Number(k), ...vaerdier });
    }
    return ud;
}

// ISO 8601-tidsstempler → MySQL DATETIME, og JSON-objekter → tekst
function normalizeValue(v) {
    if (v === null || v === undefined) return v;
    // En nuværende værdi fra databasen (SERVERKOLONNER) — driveren skriver den i UTC
    if (v instanceof Date) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        // "2026-04-09T18:34:24.000Z" → "2026-04-09 18:34:24"
        return v.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    if (v instanceof Object && !Buffer.isBuffer(v)) return JSON.stringify(v);
    return v;
}

// Klubbens logo i livestreamen (settings 'livestream', kun filnavnet) kommer med
// som en sponsorfil, så det står i klubbens mappe igen efter en gendannelse
function livestreamLogo(settings, mappe) {
    const r = (settings || []).find(s => s.setting_key === 'livestream');
    const fil = r && laesIndstillinger(r.setting_value).logo;
    return fil ? [{ filename: `${mappe}/${fil}` }] : [];
}

// Klubbens data som backup-objekt. conn: en mysql2-forbindelse til klubbens
// database (query giver [rows]); mappe: klubbens upload-mappe (db_name).
//
// clubDbName (nr. 47): klubbens identitet — en gendannelse i en anden klub
// opdages (backupFraAndenKlub). Subdomænet kan ændres; databasenavnet ikke.
//
// clubCreatedAt (nr. 57): hvornår klubben blev oprettet. Slettes en klub, og
// oprettes en ny med samme subdomæne, får den samme databasenavn — oprettelsen
// skiller de to klubber ad.
//
// Et øjebliksbillede (nr. 86): alle tabeller læses i én transaktion med
// CONSISTENT SNAPSHOT (REPEATABLE READ) på samme forbindelse. Før blev de læst
// én efter én, så en kamp, der sluttede midt i en backup, kunne stå i
// match_history men stadig i game_states, eller et sponsorbillede uden sine
// baner. Filerne læses bagefter ud fra de rækker, snapshottet gav; en fil, der
// mangler på disken, vælter ikke backuppen, men står i manglendeFiler.
async function lavBackup(conn, { mappe, clubSubdomain = null, clubName, clubDbName, clubCreatedAt = null } = {}) {
    const tables = {};
    let timestamp;
    let migrationer = null;
    await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    try {
        timestamp = new Date().toISOString();
        for (const table of BACKUP_TABLES) {
            const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
            tables[table] = rows.map(r => udenServerkolonner(table, r));
        }
        // Skemaets og data-migrationernes stand (nr. 87) — i samme snapshot
        migrationer = await koerteMigrationer(conn);
    } finally {
        // Kun læst — afslut transaktionen, også når en SELECT fejlede, så
        // forbindelsen ikke går tilbage til puljen midt i en transaktion
        try { await conn.query('COMMIT'); } catch { /* forbindelsen er væk */ }
    }
    // Sponsorbillederne og livestream-logoet som base64 — fra klubbens egen mappe
    const { filer, mangler } = await hentFiler([...tables.sponsor_images, ...livestreamLogo(tables.settings, mappe)], mappe);
    const backup = {
        version: BACKUP_VERSION,
        timestamp,
        clubSubdomain,
        tables,
        files: filer,
    };
    if (mangler.length) {
        backup.manglendeFiler = mangler;
        console.warn(`⚠ Backup af ${clubDbName || mappe}: ${mangler.length} billedfil(er) mangler på disken og er ikke med: ${mangler.join(', ')}`);
    }
    // Hvilke migrationer databasen havde kørt (nr. 87): den nyeste og hele
    // listen. Gendannelsen kører de data-migrationer, backuppen er ældre end.
    if (migrationer) {
        backup.migration = migrationer.length ? migrationer[migrationer.length - 1] : null;
        backup.migrationer = migrationer;
    }
    if (clubName) backup.clubName = clubName;
    if (clubDbName) backup.clubDbName = clubDbName;
    const oprettet = tidMs(clubCreatedAt);
    if (oprettet !== null) backup.clubCreatedAt = new Date(oprettet).toISOString();
    return backup;
}

// Klubbens filer som base64 ({ filer }), og de filer, rækkerne peger på, men
// som ikke kunne læses ({ mangler }: filnavne). Rækker, der ikke peger ind i
// klubbens egen mappe, springes over som før (sponsorFilSti).
async function hentFiler(raekker, mappe) {
    const filer = {};
    const mangler = [];
    for (const r of raekker || []) {
        const sti = sponsorFilSti(mappe, r.filename);
        if (!sti) continue;
        const navn = path.basename(sti);
        if (navn in filer) continue;
        try {
            filer[navn] = (await fs.promises.readFile(sti)).toString('base64');
        } catch {
            if (!mangler.includes(navn)) mangler.push(navn);
        }
    }
    return { filer, mangler };
}

function tidMs(v) {
    if (v === null || v === undefined || v === '') return null;
    const t = v instanceof Date ? v.getTime() : Date.parse(v);
    return Number.isFinite(t) ? t : null;
}

// Er backuppen fra en anden klub end klub ({ db_name, subdomain, created_at })?
// Svarer med en tekst om, hvor den er fra, ellers null. Backups uden klub (demoen,
// en lokal installation) kan ikke tjekkes og godtages. Ældre backups har kun
// subdomænet.
//
// Samme navn er ikke nok (nr. 57): en slettet klubs backup har samme
// databasenavn og subdomæne som en ny klub, der er oprettet med samme
// subdomæne. Er klubben oprettet efter backuppen (eller har backuppen en anden
// oprettelse), er den fra den tidligere klub.
function backupFraAndenKlub(backup, klub) {
    if (!backup || !klub) return null;
    const fra = backup.clubName
        ? `${backup.clubName}${backup.clubSubdomain ? ` (${backup.clubSubdomain})` : ''}`
        : backup.clubSubdomain || backup.clubDbName;
    if (backup.clubDbName) {
        if (backup.clubDbName !== klub.db_name) return fra;
    } else if (backup.clubSubdomain) {
        if (backup.clubSubdomain !== klub.subdomain) return fra;
    } else {
        return null;
    }
    const oprettet = tidMs(klub.created_at);
    if (oprettet === null) return null;
    const tidligere = `${fra} — en tidligere, slettet klub med samme navn`;
    const backupOprettet = tidMs(backup.clubCreatedAt);
    if (backupOprettet !== null) return Math.abs(backupOprettet - oprettet) <= 1000 ? null : tidligere;
    const taget = tidMs(backup.timestamp);
    return taget !== null && taget < oprettet - 1000 ? tidligere : null;
}

// Fejltekst, hvis backuppen ikke kan gendannes; ellers null. Ændrer intet.
function validerBackup(backup) {
    if (!backup || typeof backup !== 'object' || !backup.version || !backup.tables || typeof backup.tables !== 'object') {
        return 'Ugyldig backup-fil — mangler version eller tabeller';
    }
    for (const table of BACKUP_TABLES) {
        const rows = backup.tables[table];
        if (rows === undefined) continue;
        if (!Array.isArray(rows)) return `Ugyldig backup-fil — ${table} er ikke en liste`;
        for (const row of rows) {
            if (!row || typeof row !== 'object') return `Ugyldig række i ${table}`;
            for (const col of Object.keys(row)) {
                if (!SIKKERT_KOLONNENAVN.test(col)) return `Ugyldigt kolonnenavn i backup: ${col}`;
            }
        }
    }
    if (backup.files !== undefined && (typeof backup.files !== 'object' || backup.files === null)) {
        return 'Ugyldig backup-fil — files';
    }
    for (const filename of Object.keys(backup.files || {})) {
        if (!backupFilnavn(filename)) return `Ugyldigt filnavn i backup: ${filename}`;
    }
    return null;
}

// Filnavnene i klubbens mappe, databasen bruger lige nu: sponsorbillederne og
// livestream-logoet
async function brugteFiler(conn, mappe) {
    const [billeder] = await conn.query('SELECT filename FROM `sponsor_images`');
    const [settings] = await conn.query("SELECT setting_key, setting_value FROM `settings` WHERE setting_key = 'livestream'");
    const navne = new Set();
    for (const r of [...billeder, ...livestreamLogo(settings, mappe)]) {
        const sti = sponsorFilSti(mappe, r.filename);
        if (sti) navne.add(path.basename(sti));
    }
    return navne;
}

// Fejl med en tekst, brugeren må se (400 i stedet for 500)
class BackupFejl extends Error {}

// Gendan backuppen i klubbens database. Tabeller, backuppen har med, erstattes
// helt (også når de er tomme i backuppen); tabeller, en ældre backup ikke har
// med (fx turneringer før de kom med), røres ikke.
// Alt sker i én transaktion: fejler et INSERT, rulles alt tilbage, så klubbens
// data ikke efterlades halvt slettet. Billedfilerne skrives først efter commit.
//
// kunBrugte (demoen): der skrives kun filer, den gendannede database bruger, og
// filer i mappen, som den ikke længere bruger, slettes. Ellers kunne gentagne
// gendannelser med nye filnavne fylde disken med billeder, ingen kan slette igen.
//
// Data-migrationer (nr. 87): er backuppen ældre end en data-migration, som
// klubbens database har kørt, køres den på de gendannede rækker i samme
// transaktion (config/dataMigrationer.js har reglen og listen).
async function gendanBackup(conn, backup, mappe, { kunBrugte = false } = {}) {
    const fejl = validerBackup(backup) || tilpasSponsorRaekker(backup.tables.sponsor_images, mappe);
    if (fejl) throw new BackupFejl(fejl);

    const dataMigrationer = tilGendannelse(backup, new Set((await koerteMigrationer(conn)) || []));
    for (const m of dataMigrationer) if (m.foer) m.foer(backup.tables);

    try {
        await conn.beginTransaction();
        for (const table of BACKUP_TABLES) {
            const rows = backup.tables[table];
            if (!Array.isArray(rows)) continue;
            const bevar = SERVERKOLONNER[table] ? await nuvaerendeServerkolonner(conn, table) : null;
            await conn.query(`DELETE FROM \`${table}\``);
            for (const row of bevar ? medServerkolonner(table, rows, bevar) : rows) {
                const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
                const placeholders = Object.keys(row).map(() => '?').join(', ');
                await conn.query(
                    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
                    Object.values(row).map(normalizeValue)
                );
            }
        }
        for (const m of dataMigrationer) {
            for (const stmt of statements(m)) await conn.query(stmt);
        }
        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch {}
        throw error;
    }
    if (dataMigrationer.length) {
        console.log(`✓ Gendannelse: backuppen var ældre end ${dataMigrationer.map(m => m.fil).join(', ')} — kørt igen på de gendannede data`);
    }

    const brugte = kunBrugte ? await brugteFiler(conn, mappe) : null;
    const files = skrivSponsorFiler(backup.files, mappe, brugte);
    if (brugte) rydUbrugteFiler(mappe, brugte);
    return {
        restored: Object.fromEntries(BACKUP_TABLES.map(t => [t, backup.tables[t]?.length ?? 0])),
        files,
        dataMigrationer: dataMigrationer.map(m => m.fil),
    };
}

// Migrationerne, databasen har kørt (sorteret). null: tabellen kunne ikke læses.
async function koerteMigrationer(conn) {
    try {
        const [rows] = await conn.query('SELECT filename FROM `migrations` ORDER BY filename');
        return Array.isArray(rows) ? rows.map(r => r.filename).filter(f => typeof f === 'string') : null;
    } catch {
        return null;
    }
}

module.exports = { BACKUP_TABLES, SERVERKOLONNER, udenServerkolonner, medServerkolonner, lavBackup, validerBackup, gendanBackup, BackupFejl, normalizeValue, backupFraAndenKlub };
