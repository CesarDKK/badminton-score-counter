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
    keepAliveInitialDelay: 0
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
