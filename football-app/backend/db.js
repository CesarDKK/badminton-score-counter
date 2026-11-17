const mysql = require('mysql2/promise');

// Tidspunkter i UTC som badminton-backendens forbindelser (utcSession i
// backend/config/tenantPools.js). Alle football-tidspunkter er TIMESTAMP-kolonner,
// som MySQL selv skriver (NOW()/CURRENT_TIMESTAMP) og gemmer som et øjeblik i UTC;
// sessionens tidszone afgør kun, hvordan de læses. Før fulgte den databasens
// tidszone (CET i prod), mens driveren læste svaret som UTC — så played_at og
// created_at kom 1–2 timer for sent ud. Intet gemt flyttes af det her (nr. 90e).
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'football_user',
  password: process.env.DB_PASSWORD || 'football_password',
  database: process.env.DB_NAME || 'football_tournament',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',
});
pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));

async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, withTransaction };
