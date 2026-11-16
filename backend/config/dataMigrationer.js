// Data-migrationer efter en gendannelse (nr. 87).
//
// En backup indeholder klubbens data, ikke migrations-tabellen. Gendannes en
// backup, der er taget før en data-migration (en migration, der ÆNDRER data,
// fx 043: det lilla standardtema → Skifer), står de gendannede rækker, som før
// migrationen — mens databasen mener, migrationen er kørt. Klubben fik så fx
// det gamle lilla tema vist som "Standard".
//
// Reglen:
//   - Kun migrationerne i listen herunder køres igen; de er gennemgået én for
//     én og kan køres på gendannede data uden at ødelægge noget. En ny
//     data-migration, der ændrer tabeller i backuppen, skal tilføjes her
//     (testen i pakke-q.test.js fejler, hvis den glemmes).
//   - Backuppen har listen over kørte migrationer (backup.migrationer, fra
//     pakke Q): en migration køres, hvis den IKKE står i listen.
//   - Ældre backups uden listen: en migration køres, hvis backuppen er taget
//     før den dag, migrationen kom i koden (indfoert). Det er forsigtigt: en
//     backup taget samme dag eller mellem commit og deploy får den ikke — som
//     før pakke Q. Har backuppen intet gyldigt tidspunkt, køres intet.
//   - Kun hvis backuppen har en af migrationens tabeller med, og kun hvis
//     klubbens database selv har kørt migrationen.
// Migrations-tabellen gendannes aldrig, så ingen migration køres to gange af
// migrationRunner; listen her kører dem kun på de gendannede data, i samme
// transaktion som gendannelsen (fejler en, rulles hele gendannelsen tilbage).
//
// Skema-migrationer (ALTER TABLE …) behøver intet: tabellen har allerede det
// nye skema, og kolonner, backuppen ikke har, får deres standardværdi.

const fs = require('fs');
const path = require('path');
const { splitStatements } = require('./migrationRunner');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// 044: to rækker med samme kilde i samme turnering får en ny unik nøgle — før
// indsættelsen, ellers afviser den unikke nøgle den ældre backups dubletter
function rydDubletKilder(raekker) {
    const behold = new Map();
    for (const r of raekker) {
        if (r.source_match_id === null || r.source_match_id === undefined) continue;
        const k = `${r.tournament_id}\u0000${r.source_match_id}`;
        if (!behold.has(k) || Number(r.id) < Number(behold.get(k))) behold.set(k, r.id);
    }
    let rettet = 0;
    for (const r of raekker) {
        if (r.source_match_id === null || r.source_match_id === undefined) continue;
        if (behold.get(`${r.tournament_id}\u0000${r.source_match_id}`) !== r.id) {
            r.source_match_id = `${String(r.source_match_id).slice(0, 100)}~d${r.id}`;
            rettet++;
        }
    }
    return rettet;
}

// fil: migrationens filnavn; indfoert: dagen den kom i koden (git); tabeller:
// tabellerne, den ændrer; sql: kun data-delen (når filen også ændrer skemaet),
// ellers hele filen; foer: en rettelse af backuppens rækker før indsættelsen
const DATA_MIGRATIONER = [
    { fil: '014_default_game_mode_15.sql', indfoert: '2026-06-09', tabeller: ['settings'] },
    { fil: '024_court_banner_slideshow.sql', indfoert: '2026-08-10', tabeller: ['sponsor_images'],
        sql: ["UPDATE sponsor_images SET court_scope = 'valgte' WHERE type = 'court'"] },
    { fil: '032_ny_standard_feltfarve.sql', indfoert: '2026-10-16', tabeller: ['settings'] },
    { fil: '037_livestream_logo_standard.sql', indfoert: '2026-10-30', tabeller: ['court_streams'],
        sql: ["UPDATE court_streams SET logo = 'klub' WHERE logo = 'ingen'"] },
    { fil: '043_ny_standard_skifer.sql', indfoert: '2026-11-09', tabeller: ['settings'] },
    { fil: '044_unik_turneringskamp_kilde.sql', indfoert: '2026-11-12', tabeller: ['tournament_matches'],
        sql: [], foer: (tables) => rydDubletKilder(tables.tournament_matches) },
];

// Migrationer før backup-funktionen (april 2026) eller i tabeller, der ikke er
// i backuppen — gennemgået og bevidst ikke med (testen holder listen ærlig)
const IKKE_RELEVANTE = new Set([
    '002_add_sponsor_type.sql', '004_add_sponsor_active_expiration.sql',
    '005_add_court_version_setting.sql', '007_add_tv_version_setting.sql',
    '038_kamera_valgt_af_admin.sql',
]);

function skalKoeres(m, backup) {
    if (Array.isArray(backup.migrationer)) return !backup.migrationer.includes(m.fil);
    const taget = Date.parse(backup.timestamp);
    if (!Number.isFinite(taget)) return false;
    return taget < Date.parse(`${m.indfoert}T00:00:00Z`);
}

/**
 * De data-migrationer, der skal køres efter gendannelsen af backup.
 * anvendt: Set af migrationer, klubbens database selv har kørt.
 */
function tilGendannelse(backup, anvendt) {
    return DATA_MIGRATIONER.filter(m =>
        anvendt.has(m.fil)
        && m.tabeller.some(t => Array.isArray(backup.tables && backup.tables[t]))
        && skalKoeres(m, backup));
}

function statements(m) {
    if (m.sql) return m.sql;
    return splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, m.fil), 'utf8'));
}

module.exports = { DATA_MIGRATIONER, IKKE_RELEVANTE, tilGendannelse, statements, skalKoeres, rydDubletKilder };
