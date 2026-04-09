const { getPool, closeAll } = require('./tenantPools');
require('dotenv').config();

// Helper function to execute queries — bruger automatisk den rigtige tenant-pool
async function query(sql, params) {
    try {
        const [results] = await getPool().execute(sql, params);
        return results;
    } catch (error) {
        // Undgå verbose stacktrace under startup-retry
        if (error.code === 'ECONNREFUSED') throw error;
        console.error('Database query error:', error);
        throw error;
    }
}

// Helper function to get single row
async function queryOne(sql, params) {
    const results = await query(sql, params);
    return results[0] || null;
}

// pool eksporteres for bagudkompatibilitet (health check, graceful shutdown)
// Bemærk: brug closeAll() ved shutdown for at lukke alle tenant-pools
module.exports = {
    get pool() { return getPool(); },
    query,
    queryOne,
    closeAll
};
