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

const { backupFilnavn, tilpasSponsorRaekker, hentSponsorFiler, skrivSponsorFiler } = require('./sponsorFiler');

const BACKUP_VERSION = '1.0';

// Tabellerne i en backup, i gendannelses-rækkefølge (forældre før børn).
// Klub-admins og deres adgangskoder er bevidst IKKE med: en gendannelse må ikke
// låse nogen ude eller give en gammel adgangskode liv igen.
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
    'device_tokens',
    'player_info',
    'tournaments',
    'tournament_matches',
    'tournament_player_clubs',
    'player_logos',
];

const SIKKERT_KOLONNENAVN = /^[A-Za-z0-9_]+$/;

// ISO 8601-tidsstempler → MySQL DATETIME, og JSON-objekter → tekst
function normalizeValue(v) {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
        // "2026-04-09T18:34:24.000Z" → "2026-04-09 18:34:24"
        return v.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace('Z', '');
    }
    if (v instanceof Object && !Buffer.isBuffer(v)) return JSON.stringify(v);
    return v;
}

// Klubbens data som backup-objekt. conn: en mysql2-forbindelse til klubbens
// database (query giver [rows]); mappe: klubbens upload-mappe (db_name).
async function lavBackup(conn, { mappe, clubSubdomain = null, clubName } = {}) {
    const tables = {};
    for (const table of BACKUP_TABLES) {
        const [rows] = await conn.query(`SELECT * FROM \`${table}\``);
        tables[table] = rows;
    }
    const backup = {
        version: BACKUP_VERSION,
        timestamp: new Date().toISOString(),
        clubSubdomain,
        tables,
        // Sponsorbillederne som base64 — fra klubbens egen mappe
        files: hentSponsorFiler(tables.sponsor_images, mappe),
    };
    if (clubName) backup.clubName = clubName;
    return backup;
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

// Fejl med en tekst, brugeren må se (400 i stedet for 500)
class BackupFejl extends Error {}

// Gendan backuppen i klubbens database. Tabeller, backuppen har med, erstattes
// helt (også når de er tomme i backuppen); tabeller, en ældre backup ikke har
// med (fx turneringer før de kom med), røres ikke.
// Alt sker i én transaktion: fejler et INSERT, rulles alt tilbage, så klubbens
// data ikke efterlades halvt slettet. Billedfilerne skrives først efter commit.
async function gendanBackup(conn, backup, mappe) {
    const fejl = validerBackup(backup) || tilpasSponsorRaekker(backup.tables.sponsor_images, mappe);
    if (fejl) throw new BackupFejl(fejl);

    try {
        await conn.beginTransaction();
        for (const table of BACKUP_TABLES) {
            const rows = backup.tables[table];
            if (!Array.isArray(rows)) continue;
            await conn.query(`DELETE FROM \`${table}\``);
            for (const row of rows) {
                const cols = Object.keys(row).map(c => `\`${c}\``).join(', ');
                const placeholders = Object.keys(row).map(() => '?').join(', ');
                await conn.query(
                    `INSERT INTO \`${table}\` (${cols}) VALUES (${placeholders})`,
                    Object.values(row).map(normalizeValue)
                );
            }
        }
        await conn.commit();
    } catch (error) {
        try { await conn.rollback(); } catch {}
        throw error;
    }

    const files = skrivSponsorFiler(backup.files, mappe);
    return {
        restored: Object.fromEntries(BACKUP_TABLES.map(t => [t, backup.tables[t]?.length ?? 0])),
        files,
    };
}

module.exports = { BACKUP_TABLES, lavBackup, validerBackup, gendanBackup, BackupFejl, normalizeValue };
