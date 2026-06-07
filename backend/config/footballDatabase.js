// Pool til badminton-backends adgang til football_tournament-DB.
// Bruges af super-admin endpoints til at administrere football-klubber + admins.
// Bruger football_user-credentials der har fulde rettigheder på football_tournament-DB
// (oprettet af football-db-init i docker-compose).

const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.FOOTBALL_DB_USER || 'football_user',
    password: process.env.FOOTBALL_DB_PASSWORD || '',
    database: 'football_tournament',
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: '+00:00'
});

async function query(sql, params) {
    const [results] = await pool.execute(sql, params);
    return results;
}

async function queryOne(sql, params) {
    const results = await query(sql, params);
    return results[0] || null;
}

async function hashPassword(plain) {
    return bcrypt.hash(plain, 10);
}

module.exports = { pool, query, queryOne, hashPassword };
