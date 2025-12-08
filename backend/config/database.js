const mysql = require('mysql2/promise');
require('dotenv').config();

// Create MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'badminton_user',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'badminton_counter',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
});

// Test database connection
pool.getConnection()
    .then(connection => {
        console.log('✓ Database connection successful');
        connection.release();
    })
    .catch(err => {
        console.error('✗ Database connection failed:', err.message);
        process.exit(1);
    });

// Helper function to execute queries
async function query(sql, params) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to get single row
async function queryOne(sql, params) {
    const results = await query(sql, params);
    return results[0] || null;
}

module.exports = {
    pool,
    query,
    queryOne
};
