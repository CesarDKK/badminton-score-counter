const cron = require('node-cron');
const { query } = require('./config/database');
const { runWithTenant } = require('./config/tenantPools');

async function resetDatabase(dbLabel) {
    const deleteResult = await query('DELETE FROM game_states');
    const updateResult = await query('UPDATE courts SET is_active = FALSE');
    console.log(`  ✅ ${dbLabel}: cleared ${deleteResult.affectedRows} game states, set ${updateResult.affectedRows} courts inactive`);
}

/**
 * Scheduled task to reset all courts at midnight.
 * Runs for the default database (direct mode) AND for every active club database
 * (multi-tenant mode) — because query() has no tenant context in a cron job.
 */
function startMidnightReset() {
    cron.schedule('0 0 * * *', async () => {
        console.log('===========================================');
        console.log('🌙 Running midnight court reset...');
        console.log(`⏰ Time: ${new Date().toISOString()}`);

        // 1. Reset default/direct-mode database
        try {
            await resetDatabase('default');
        } catch (err) {
            console.error('❌ Default DB reset failed:', err.message);
        }

        // 2. Reset each active club database (multi-tenant)
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, () => resetDatabase(club.db_name));
                } catch (err) {
                    console.error(`❌ Reset failed for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) {
            console.error('❌ Could not load club list for midnight reset:', err.message);
        }

        console.log('🎉 Midnight reset completed');
        console.log('===========================================');
    }, {
        scheduled: true,
        timezone: "Europe/Copenhagen"
    });

    console.log('⏰ Scheduled midnight court reset at 00:00 (Europe/Copenhagen timezone)');
}

/**
 * Scheduled task to check and deactivate expired sponsor images
 * Runs every hour at minute 0
 */
async function expireSponsors(dbLabel) {
    const result = await query(
        `UPDATE sponsor_images SET is_active = FALSE
         WHERE is_active = TRUE AND expiration_date IS NOT NULL AND expiration_date <= NOW()`
    );
    if (result.affectedRows > 0) {
        console.log(`  ✅ ${dbLabel}: deactivated ${result.affectedRows} expired sponsor image(s)`);
    }
}

function startExpirationCheck() {
    cron.schedule('0 * * * *', async () => {
        // 1. Default database
        try { await expireSponsors('default'); } catch (err) {
            console.error('❌ Sponsor expiration failed (default):', err.message);
        }

        // 2. All active club databases
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, () => expireSponsors(club.db_name));
                } catch (err) {
                    console.error(`❌ Sponsor expiration failed for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) {
            console.error('❌ Could not load club list for expiration check:', err.message);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Copenhagen"
    });

    console.log('⏰ Scheduled hourly sponsor expiration check at minute 0 (Europe/Copenhagen timezone)');
}

const INACTIVITY_MINUTES = 20;

async function releaseInactiveCourts(dbLabel) {
    // Find aktive baner hvor en kamp er startet men ikke afsluttet,
    // og der ikke har været aktivitet i INACTIVITY_MINUTES minutter.
    const staleCourts = await query(
        `SELECT c.id, c.court_number
         FROM courts c
         JOIN game_states gs ON gs.court_id = c.id
         WHERE c.is_active = TRUE
           AND gs.match_start_time IS NOT NULL
           AND gs.match_completed = FALSE
           AND gs.updated_at < NOW() - INTERVAL ${INACTIVITY_MINUTES} MINUTE`
    );

    if (!staleCourts.length) return;

    for (const court of staleCourts) {
        await query('DELETE FROM game_states WHERE court_id = ?', [court.id]);
        await query('UPDATE courts SET is_active = FALSE, is_doubles = FALSE WHERE id = ?', [court.id]);
        await query(
            `DELETE FROM device_tokens WHERE token_type = 'match_session' AND court_number = ?`,
            [court.court_number]
        );
    }

    console.log(`  ♻️  ${dbLabel}: frigivet ${staleCourts.length} inaktiv(e) bane(r) efter ${INACTIVITY_MINUTES} min uden aktivitet`);
}

function startInactivityCheck() {
    cron.schedule('* * * * *', async () => {
        // 1. Standard/direkte database
        try {
            await releaseInactiveCourts('default');
        } catch (err) {
            console.error('❌ Inactivity check failed (default):', err.message);
        }

        // 2. Alle aktive klub-databaser (multi-tenant)
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, () => releaseInactiveCourts(club.db_name));
                } catch (err) {
                    console.error(`❌ Inactivity check failed for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });

    console.log(`⏰ Scheduled inactivity check every minute (releases courts idle for ${INACTIVITY_MINUTES}+ min)`);
}

/**
 * Serverbaseret auto-opdatering fra Tournament Software hvert 4. minut.
 * Kører kun for turneringer hvor admin har slået auto_sync til — og kører
 * uafhængigt af om admin-siden/browseren er åben.
 */
function startTournamentAutoSync() {
    // Lazy require — undgår require-cyklus ved opstart
    const { runTournamentAutoSync } = require('./routes/tournaments');

    cron.schedule('*/4 * * * *', async () => {
        // 1. Standard/direkte database
        try {
            await runTournamentAutoSync('direct');
        } catch (err) {
            console.error('❌ Tournament auto-sync failed (default):', err.message);
        }

        // 2. Alle aktive klub-databaser (multi-tenant)
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, () => runTournamentAutoSync(club.db_name));
                } catch (err) {
                    console.error(`❌ Tournament auto-sync failed for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });

    console.log('⏰ Scheduled tournament auto-sync every 4 minutes (TS-turneringer med auto_sync slået til)');
}

module.exports = { startMidnightReset, startExpirationCheck, startInactivityCheck, startTournamentAutoSync };
