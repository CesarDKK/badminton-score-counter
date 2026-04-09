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

// Splitter SQL-fil til individuelle statements (ignorerer kommentarer og tomme linjer)
function splitStatements(sql) {
    return sql
        .replace(/USE\s+[^;]+;/gi, '')           // fjern USE-statements (vi er allerede tilkoblet)
        .replace(/ADD COLUMN IF NOT EXISTS/gi, 'ADD COLUMN') // MySQL 8.0 understøtter ikke denne syntaks
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && s.replace(/--[^\n]*/g, '').trim().length > 0);
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

            let ok = true;
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
                console.log(`  ✓ ${file} → ${dbName}`);
                count++;
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

module.exports = { runMigrationsForDatabase, runMigrationsForAllDatabases, markAllMigrationsApplied };
