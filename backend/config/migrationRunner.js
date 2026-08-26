const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// MySQL fejlkoder der betyder "findes allerede" — sikkert at ignorere ved re-kørsel
const ALREADY_EXISTS_ERRORS = new Set([
    1050, // Table already exists
    1060, // Duplicate column name
    1061, // Duplicate key name
    1062, // Duplicate entry
    1091, // Can't DROP; doesn't exist — at droppe noget der allerede er væk er ikke en fejl
]);

async function getConnection(dbName) {
    return mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'badminton_user',
        password: process.env.DB_PASSWORD || '',
        database: dbName,
    });
}

async function ensureMigrationsTable(conn) {
    await conn.query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INT PRIMARY KEY AUTO_INCREMENT,
            filename VARCHAR(255) UNIQUE NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    `);
}

async function getAppliedMigrations(conn) {
    const [rows] = await conn.query('SELECT filename FROM migrations');
    return new Set(rows.map(r => r.filename));
}

function getMigrationFiles() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    return fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
}

// Fjerner kommentarer, så en statement kan tjekkes for reelt indhold.
function udenKommentarer(s) {
    return s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '')
        .replace(/#[^\n]*/g, '')
        .trim();
}

// Splitter en SQL-fil til individuelle statements.
//
// En scanner frem for et naivt split(';'): et semikolon inde i en streng
// ('a;b'), en identifier (`a;b`) eller en kommentar må IKKE dele statementet,
// og `DELIMITER $$` (bruges af triggers/procedurer) skal respekteres. Det
// naive split ville ødelægge sådanne migrationer. For de nuværende simple
// migrationer giver den præcis samme resultat (verificeret).
function splitStatements(sql) {
    sql = sql.replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN'); // MySQL 8.0 kender ikke denne syntaks

    const statements = [];
    let delimiter = ';';
    let buf = '';
    const n = sql.length;
    let i = 0;

    while (i < n) {
        // DELIMITER-direktiv i starten af en linje
        if ((i === 0 || sql[i - 1] === '\n')) {
            const m = /^[ \t]*DELIMITER[ \t]+(\S+)[^\n]*(\r?\n|$)/i.exec(sql.slice(i));
            if (m) { delimiter = m[1]; i += m[0].length; continue; }
        }

        const ch = sql[i];
        const to = sql.substr(i, 2);

        // Linjekommentar: "-- " eller "#"
        if ((ch === '-' && sql[i + 1] === '-' && /\s|$/.test(sql[i + 2] || '')) || ch === '#') {
            let nl = sql.indexOf('\n', i);
            if (nl === -1) nl = n;
            buf += sql.slice(i, nl);
            i = nl;
            continue;
        }
        // Blokkommentar
        if (to === '/*') {
            const end = sql.indexOf('*/', i + 2);
            const stop = end === -1 ? n : end + 2;
            buf += sql.slice(i, stop);
            i = stop;
            continue;
        }
        // Streng eller quoted identifier
        if (ch === "'" || ch === '"' || ch === '`') {
            buf += ch; i++;
            while (i < n) {
                if (sql[i] === '\\' && ch !== '`') { buf += sql.slice(i, i + 2); i += 2; continue; }
                if (sql[i] === ch) {
                    if (sql[i + 1] === ch) { buf += ch + ch; i += 2; continue; } // fordoblet = escaped
                    buf += ch; i++; break;
                }
                buf += sql[i]; i++;
            }
            continue;
        }
        // Delimiter → afslut statement
        if (delimiter && sql.startsWith(delimiter, i)) {
            const stmt = buf.trim();
            if (udenKommentarer(stmt).length > 0) statements.push(stmt);
            buf = '';
            i += delimiter.length;
            continue;
        }
        buf += ch; i++;
    }
    const sidste = buf.trim();
    if (udenKommentarer(sidste).length > 0) statements.push(sidste);

    // Vi er allerede tilkoblet den rigtige database — drop USE-statements.
    // Kommentarer strippes først, så en "-- ...\nUSE db"-blok også fanges (ellers
    // ville et USE mod en klub-database skifte til den forkerte database).
    return statements.filter(s => !/^USE\b/i.test(udenKommentarer(s)));
}

async function runMigrationsForDatabase(dbName) {
    const conn = await getConnection(dbName);
    try {
        await ensureMigrationsTable(conn);
        const applied = await getAppliedMigrations(conn);
        const files = getMigrationFiles();

        let count = 0;
        for (const file of files) {
            if (applied.has(file)) continue;

            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
            const statements = splitStatements(sql);

            // Hver migration køres i en transaktion, og "applied"-registreringen
            // sker inde i samme transaktion. Fejler en migration midtvejs, rulles
            // data-ændringerne tilbage, så en delvist anvendt migration ikke
            // genkøres oven i sig selv ved næste opstart. (DDL som ALTER/CREATE
            // laver implicit commit i MySQL, så rene skema-migrationer beskyttes
            // ikke fuldt — men data-migrationer og selve registreringen gør.)
            let ok = true;
            await conn.beginTransaction();
            for (const stmt of statements) {
                try {
                    await conn.query(stmt);
                } catch (err) {
                    if (ALREADY_EXISTS_ERRORS.has(err.errno)) {
                        // Kolonne/tabel/index findes allerede — init.sql dækkede det
                        console.log(`  ⚠ ${file} [${dbName}]: "${err.sqlMessage}" — springer over`);
                    } else {
                        console.error(`  ✗ Migration ${file} fejlede mod ${dbName}: ${err.message}`);
                        ok = false;
                        break;
                    }
                }
            }

            if (ok) {
                await conn.query('INSERT INTO migrations (filename) VALUES (?)', [file]);
                await conn.commit();
                console.log(`  ✓ ${file} → ${dbName}`);
                count++;
            } else {
                try { await conn.rollback(); } catch { /* DDL kan have committet implicit */ }
            }
        }

        if (count > 0) {
            console.log(`✓ ${count} migration(er) kørt mod ${dbName}`);
        }
    } finally {
        await conn.end();
    }
}

// Bruges ved oprettelse af ny klub-database: init.sql har allerede fuldt skema,
// så vi markerer blot alle eksisterende migrations som applied uden at køre dem.
async function markAllMigrationsApplied(dbName) {
    const conn = await getConnection(dbName);
    try {
        await ensureMigrationsTable(conn);
        const files = getMigrationFiles();
        for (const file of files) {
            await conn.query(
                'INSERT IGNORE INTO migrations (filename) VALUES (?)',
                [file]
            );
        }
        if (files.length > 0) {
            console.log(`✓ ${files.length} migrations markeret som applied for ${dbName}`);
        }
    } finally {
        await conn.end();
    }
}

async function runMigrationsForAllDatabases() {
    const defaultDb = process.env.DB_NAME || 'badminton_counter';
    console.log('⏳ Kører database migrationer...');

    // Standard database
    await runMigrationsForDatabase(defaultDb);

    // Multi-tenant: alle aktive klub-databaser
    try {
        const masterDb = require('./masterDatabase');
        const clubs = await masterDb.query(
            'SELECT db_name, is_active FROM clubs WHERE is_active = TRUE'
        );
        for (const club of clubs) {
            await runMigrationsForDatabase(club.db_name);
        }
        if (clubs.length > 0) {
            console.log(`✓ Migrationer tjekket for ${clubs.length} klub(ber)`);
        }
    } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE' && !error.message.includes("doesn't exist")) {
            console.error('⚠ Kunne ikke hente klub-liste til migrationer:', error.message);
        }
    }

    console.log('✓ Database migrationer gennemført');
}

module.exports = { runMigrationsForDatabase, runMigrationsForAllDatabases, markAllMigrationsApplied, splitStatements };
