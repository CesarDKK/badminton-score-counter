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

module.exports = { startMidnightReset };
