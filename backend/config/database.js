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

// Kør fn i én transaktion på én forbindelse fra den aktuelle tenants pulje.
// fn får { query, queryOne } bundet til forbindelsen. Kaster fn (eller en
// forespørgsel), rulles alt tilbage — så en import, der fejler halvvejs, ikke
// efterlader en halv turnering eller holdkamp (nr. 81).
async function transaktion(fn) {
    const conn = await getPool().getConnection();
    const tq = async (sql, params) => (await conn.execute(sql, params))[0];
    const tqOne = async (sql, params) => (await tq(sql, params))[0] || null;
    try {
        await conn.beginTransaction();
        const r = await fn({ query: tq, queryOne: tqOne });
        await conn.commit();
        return r;
    } catch (error) {
        try { await conn.rollback(); } catch { /* forbindelsen er væk — intet at rulle tilbage */ }
        throw error;
    } finally {
        conn.release();
    }
}

// pool eksporteres for bagudkompatibilitet (health check, graceful shutdown)
// Bemærk: brug closeAll() ved shutdown for at lukke alle tenant-pools
module.exports = {
    get pool() { return getPool(); },
    query,
    queryOne,
    transaktion,
    closeAll
};
