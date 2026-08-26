const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Pool til normale forespørgsler mod master databasen (badminton_user)
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'badminton_user',
    password: process.env.DB_PASSWORD || '',
    database: 'badminton_master',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: '+00:00'
});

// Root-forbindelse til DDL operationer (CREATE DATABASE, GRANT)
async function createAdminConnection() {
    return mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: 'root',
        password: process.env.MYSQL_ROOT_PASSWORD || '',
        multipleStatements: true
    });
}

async function query(sql, params) {
    const [results] = await pool.execute(sql, params);
    return results;
}

async function queryOne(sql, params) {
    const results = await query(sql, params);
    return results[0] || null;
}

// Opretter standard super admin ved første opstart hvis ingen findes
async function initialize() {
    try {
        await pool.getConnection().then(c => c.release());

        // must_change_password: tilfoejes idempotent saa eksisterende master-DB
        // ogsaa faar kolonnen (init.master.sql kun paa friske installationer).
        const mustChangeCol = await query(
            `SELECT COUNT(*) AS c FROM information_schema.columns
             WHERE table_schema = 'badminton_master'
               AND table_name = 'super_admins'
               AND column_name = 'must_change_password'`
        );
        if (mustChangeCol[0].c === 0) {
            await query(
                `ALTER TABLE super_admins ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE`
            );
            console.log('✓ super_admins.must_change_password kolonne tilfoejet');
        }

        const existing = await queryOne('SELECT id FROM super_admins LIMIT 1');
        if (!existing) {
            const defaultPassword = 'superadmin123';
            const hash = await bcrypt.hash(defaultPassword, 10);
            // must_change_password = TRUE: skift tvinges ved foerste login
            await query(
                'INSERT INTO super_admins (username, password_hash, must_change_password) VALUES (?, ?, TRUE)',
                ['superadmin', hash]
            );
            console.log('');
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║  STANDARD SUPER ADMIN OPRETTET               ║');
            console.log('║  Brugernavn: superadmin                      ║');
            console.log('║  Adgangskode: superadmin123                  ║');
            console.log('║  SKAL SKIFTES VED FØRSTE LOGIN               ║');
            console.log('╚══════════════════════════════════════════════╝');
            console.log('');
        }

        // Tving et skift for enhver super-admin der STADIG har standard-adgangskoden
        // (fanger ogsaa en eksisterende installation der aldrig fik skiftet den).
        // Naar den er skiftet, fejler sammenligningen, og flaget saettes ikke igen.
        const alleAdmins = await query('SELECT id, password_hash FROM super_admins');
        for (const a of alleAdmins) {
            if (await bcrypt.compare('superadmin123', a.password_hash)) {
                await query('UPDATE super_admins SET must_change_password = TRUE WHERE id = ?', [a.id]);
            }
        }

        // Centralt logo-bibliotek — oprettes idempotent saa eksisterende master-DB ogsaa faar tabellen
        await query(`
            CREATE TABLE IF NOT EXISTS club_logos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                club_name VARCHAR(150) NOT NULL,
                aliases TEXT NULL,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_size INT NOT NULL,
                width INT NULL,
                height INT NULL,
                mime_type VARCHAR(50) NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_club_name (club_name)
            ) ENGINE=InnoDB
        `);

        // seed_key: stabil identitet for standard-seedede logoer (kildefilnavn).
        // Manuelt uploadede logoer har NULL. Tilfoejes idempotent saa eksisterende
        // master-DB ogsaa faar kolonnen. Bruges af seedClubLogos() til re-sync uden dubletter.
        const seedKeyCol = await query(
            `SELECT COUNT(*) AS c FROM information_schema.columns
             WHERE table_schema = 'badminton_master'
               AND table_name = 'club_logos'
               AND column_name = 'seed_key'`
        );
        if (seedKeyCol[0].c === 0) {
            await query(
                `ALTER TABLE club_logos ADD COLUMN seed_key VARCHAR(255) NULL UNIQUE`
            );
            console.log('✓ club_logos.seed_key kolonne tilfoejet');
        }

        // Seed standard klub-logoer (idempotent). Lazy require for at undgaa
        // cirkulaer afhaengighed (seedLogos kraever dette modul ved load).
        try {
            const { seedClubLogos } = require('./seedLogos');
            await seedClubLogos();
        } catch (e) {
            console.error('✗ Logo-seed fejlede (opstart fortsaetter):', e.message);
        }

        console.log('✓ Master database forbindelse OK');
    } catch (error) {
        console.error('✗ Master database fejl:', error.message);
        throw error;
    }
}

// Opretter en ny klub-database og kører init.sql mod den
async function createClubDatabase(dbName) {
    const fs = require('fs');
    const path = require('path');

    const conn = await createAdminConnection();
    try {
        // Opret database
        await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`
            CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);

        // Giv badminton_user adgang
        await conn.query(
            `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO 'badminton_user'@'%'`
        );
        await conn.query('FLUSH PRIVILEGES');

        // Kør klub-schema (init.sql) mod den nye database
        await conn.query(`USE \`${dbName}\``);
        const initSql = fs.readFileSync(
            path.join(__dirname, '..', 'init.sql'),
            'utf8'
        );
        // Fjern "CREATE DATABASE" og "USE" statements da vi allerede er tilkoblet
        const cleanedSql = initSql
            .replace(/CREATE DATABASE[^;]+;/gi, '')
            .replace(/USE [^;]+;/gi, '');
        await conn.query(cleanedSql);

        console.log(`✓ Klub database oprettet: ${dbName}`);

        // Markér alle eksisterende migrations som applied — init.sql har allerede fuldt skema
        const { markAllMigrationsApplied } = require('./migrationRunner');
        await markAllMigrationsApplied(dbName);
    } finally {
        await conn.end();
    }
}

module.exports = { pool, query, queryOne, initialize, createClubDatabase, createAdminConnection };
