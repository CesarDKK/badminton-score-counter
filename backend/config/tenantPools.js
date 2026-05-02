const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');

// Holder styr på hvilken database den aktuelle request tilhører
const tenantStorage = new AsyncLocalStorage();

// Cache af connection pools — én per klub-database
const pools = new Map();

function createPool(dbName) {
    return mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'badminton_user',
        password: process.env.DB_PASSWORD || '',
        database: dbName,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        timezone: '+00:00'   // Fortolk TIMESTAMP/DATETIME som UTC — undgår +2t fejl i sommertid
    });
}

// Returnerer pool for den aktuelle tenant (eller default hvis ingen tenant)
function getPool() {
    const dbName = tenantStorage.getStore() || process.env.DB_NAME || 'badminton_counter';
    if (!pools.has(dbName)) {
        pools.set(dbName, createPool(dbName));
    }
    return pools.get(dbName);
}

// Kør en funktion i kontekst af en specifik tenant-database
function runWithTenant(dbName, fn) {
    return tenantStorage.run(dbName, fn);
}

// Luk alle pools ved graceful shutdown
async function closeAll() {
    for (const pool of pools.values()) {
        await pool.end();
    }
    pools.clear();
}

module.exports = { getPool, runWithTenant, closeAll };
