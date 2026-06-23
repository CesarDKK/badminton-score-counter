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

        const existing = await queryOne('SELECT id FROM super_admins LIMIT 1');
        if (!existing) {
            const defaultPassword = 'superadmin123';
            const hash = await bcrypt.hash(defaultPassword, 10);
            await query(
                'INSERT INTO super_admins (username, password_hash) VALUES (?, ?)',
                ['superadmin', hash]
            );
            console.log('');
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║  STANDARD SUPER ADMIN OPRETTET               ║');
            console.log('║  Brugernavn: superadmin                      ║');
            console.log('║  Adgangskode: superadmin123                  ║');
            console.log('║  SKIFT ADGANGSKODEN VED FØRSTE LOGIN!        ║');
            console.log('╚══════════════════════════════════════════════╝');
            console.log('');
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
