const { AsyncLocalStorage } = require('async_hooks');
const mysql = require('mysql2/promise');

// Holder styr på hvilken database den aktuelle request tilhører
const tenantStorage = new AsyncLocalStorage();

// Cache af connection pools — én per klub-database
const pools = new Map();

// Hver forbindelse kører i UTC — også databasens egne NOW(), CURRENT_TIMESTAMP og
// TIMESTAMP-kolonner. `timezone: '+00:00'` herunder styrer kun, hvordan driveren
// fortolker datoer; uden SET time_zone fulgte NOW() databasens tidszone, og en
// server på CET sammenlignede dansk tid med appens UTC-tider (holdkamp-køen
// opgav fx kampe to timer for tidligt). Nu er det ligegyldigt, hvad serveren,
// containeren eller MySQL står på.
function utcSession(pool) {
    pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
    return pool;
}

function createPool(dbName) {
    return utcSession(mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'badminton_user',
        password: process.env.DB_PASSWORD || '',
        database: dbName,
        waitForConnections: true,
        // 15 (var 5). Under en turnering poller oversigt + hver TV + hver tablet
        // samtidig; med kun 5 forbindelser står resten og venter i kø, og et lille
        // hik vokser til synlige timeouts på alle skærme.
        // NB: MySQL 8 tillader 151 forbindelser i alt, og puljen er PER klub-database
        // — 15 × antal aktive klubber (+ fodbold-appens 10) skal holdes under den grænse.
        connectionLimit: Number(process.env.DB_POOL_SIZE) || 15,
        // Bundet kø (var 0 = ubegrænset). Med ubegrænset kø hobede requests sig op
        // under pres, og klienterne løb i timeout efter at have ventet i lang tid.
        // Med en grænse fejler de overskydende straks — skærmene prøver bare igen
        // ved næste poll i stedet for at trække serveren længere ned.
        queueLimit: Number(process.env.DB_QUEUE_LIMIT) || 60,
        enableKeepAlive: true,
        keepAliveInitialDelay: 0,
        timezone: '+00:00'   // Fortolk TIMESTAMP/DATETIME som UTC — undgår +2t fejl i sommertid
    }));
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

// Navnet på den aktuelle tenant-database (eller 'direct' uden for tenant-kontekst).
// Bruges til at nøgle in-memory state pr. klub, så to klubber ikke kolliderer.
function currentTenant() {
    return tenantStorage.getStore() || 'direct';
}

module.exports = { getPool, runWithTenant, closeAll, currentTenant, utcSession };
