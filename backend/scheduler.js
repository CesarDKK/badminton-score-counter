const cron = require('node-cron');
const { query } = require('./config/database');

/**
 * Scheduled task to reset all courts at midnight
 * Runs every day at 00:00 (midnight)
 */
function startMidnightReset() {
    // Schedule task to run at midnight (00:00) every day
    // Cron syntax: '0 0 * * *' means minute=0, hour=0, any day, any month, any day of week
    cron.schedule('0 0 * * *', async () => {
        try {
            console.log('===========================================');
            console.log('🌙 Running midnight court reset...');
            console.log(`⏰ Time: ${new Date().toISOString()}`);

            // Delete all game states (this resets all courts)
            const deleteResult = await query('DELETE FROM game_states');
            console.log(`✅ Cleared ${deleteResult.affectedRows} game states`);

            // Set all courts to inactive
            const updateResult = await query('UPDATE courts SET is_active = FALSE');
            console.log(`✅ Set ${updateResult.affectedRows} courts to inactive`);

            console.log('🎉 Midnight reset completed successfully');
            console.log('===========================================');
        } catch (error) {
            console.error('❌ Error during midnight reset:', error);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Copenhagen" // Danish timezone
    });

    console.log('⏰ Scheduled midnight court reset at 00:00 (Europe/Copenhagen timezone)');
}

/**
 * Scheduled task to check and deactivate expired sponsor images
 * Runs every hour at minute 0
 */
function startExpirationCheck() {
    // Schedule task to run every hour (at minute 0)
    // Cron syntax: '0 * * * *' means minute=0, every hour, any day, any month, any day of week
    cron.schedule('0 * * * *', async () => {
        try {
            console.log('===========================================');
            console.log('🖼️  Running sponsor expiration check...');
            console.log(`⏰ Time: ${new Date().toISOString()}`);

            // Deactivate expired images
            const result = await query(
                `UPDATE sponsor_images
                 SET is_active = FALSE
                 WHERE is_active = TRUE
                 AND expiration_date IS NOT NULL
                 AND expiration_date <= NOW()`
            );

            const deactivatedCount = result.affectedRows || 0;

            if (deactivatedCount > 0) {
                console.log(`✅ Deactivated ${deactivatedCount} expired sponsor image(s)`);
            } else {
                console.log('✅ No expired sponsor images found');
            }

            console.log('🎉 Sponsor expiration check completed');
            console.log('===========================================');
        } catch (error) {
            console.error('❌ Error during sponsor expiration check:', error);
        }
    }, {
        scheduled: true,
        timezone: "Europe/Copenhagen" // Danish timezone
    });

    console.log('⏰ Scheduled hourly sponsor expiration check at minute 0 (Europe/Copenhagen timezone)');
}

module.exports = { startMidnightReset, startExpirationCheck };
