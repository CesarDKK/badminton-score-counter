// Databasens forbindelser til super-admins helbredskort (nr. 55).
//
// Hver klub har sin egen pulje (config/tenantPools.js, DB_POOL_SIZE, standard
// 15), plus master (5) og football (5) i backenden og football-appens egen (10).
// Summen over klubberne må ikke nå MySQL's max_connections, ellers får den
// næste "Too many connections". Kortet viser de åbne forbindelser (alle
// klienter: backenden, football-appen, backup-tjenesten), loftet og antallet
// af puljer — og advarer over 80 %.

const ADVARSEL = 0.8;
const KRITISK = 0.95;

/**
 * vurder({ aabne, maks, klubPuljer, puljeStoerrelse }) → samme + { andel, niveau, besked }
 */
function vurder({ aabne, maks, klubPuljer, puljeStoerrelse }) {
    const andel = maks > 0 ? aabne / maks : null;
    let niveau = null;
    let besked = null;
    if (andel !== null && andel >= KRITISK) {
        niveau = 'kritisk';
        besked = 'Databasen er ved at løbe tør for forbindelser';
    } else if (andel !== null && andel >= ADVARSEL) {
        niveau = 'advarsel';
        besked = `Over ${Math.round(ADVARSEL * 100)} % af databasens forbindelser er i brug`;
    }
    return { aabne, maks, andel, klubPuljer, puljeStoerrelse, niveau, besked };
}

// Tal fra en SHOW-række ({ Variable_name, Value }) eller en SELECT
const tal = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function status({
    masterPool = () => require('./masterDatabase').pool,
    klubPuljer = () => require('./tenantPools').antalPuljer(),
} = {}) {
    const pool = masterPool();
    // Tekst-protokol (query, ikke execute): SHOW kan ikke altid forberedes
    const [[aabne]] = await pool.query("SHOW GLOBAL STATUS LIKE 'Threads_connected'");
    const [[maks]] = await pool.query('SELECT @@GLOBAL.max_connections AS maks');
    return vurder({
        aabne: tal(aabne && aabne.Value),
        maks: tal(maks && maks.maks),
        klubPuljer: klubPuljer(),
        puljeStoerrelse: Number(process.env.DB_POOL_SIZE) || 15,
    });
}

module.exports = { status, vurder, ADVARSEL, KRITISK };
