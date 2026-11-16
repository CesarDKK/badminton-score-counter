const cron = require('node-cron');
const { query, queryOne } = require('./config/database');
const { synligBane } = require('./config/baner');
const { runWithTenant, currentTenant } = require('./config/tenantPools');
const { publishGameStateChange } = require('./events/gameStateEvents');

async function resetDatabase(dbLabel) {
    const deleteResult = await query('DELETE FROM game_states');
    const updateResult = await query('UPDATE courts SET is_active = FALSE');
    // badmintonplanner-runden hører til aftenen — væk ved midnat (tildelinger følger med via FK)
    try { await query('DELETE FROM planner_rounds'); } catch (e) { /* før migration 027 */ }
    // QR- og ur-sessionerne hører til dagen (nr. 16): før kunne gårsdagens
    // QR-link åbnes fra telefonens historik, når ingen havde ryddet banen.
    // TV'erne henter selv en ny QR-kode (i baggrunden, hvert 5. minut).
    const qr = await query("DELETE FROM device_tokens WHERE token_type = 'match_session'");
    // Frigivne kampe (migration 051) gemmes højst til midnat
    try { await query('DELETE FROM frigivne_kampe'); } catch (e) { /* før migration 051 */ }
    console.log(`  ✅ ${dbLabel}: cleared ${deleteResult.affectedRows} game states, set ${updateResult.affectedRows} courts inactive, removed ${qr.affectedRows} QR sessions`);
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

// 20 minutter (før 10, pakke P): en tablet med net giver livstegn hvert 10.
// sekund og frigives aldrig her — det er tabletten uden net, uret under
// opvarmning og en lang skadespause med QR-telefonen, der rammes, og de skal
// ikke miste banen efter 10 minutter. Kampen gemmes desuden først (frigivne_kampe).
const INACTIVITY_MINUTES = 20;

// Har banen en badmintonplanner-kamp? (tabellen findes først efter migration 027)
async function harPlannerKamp(courtNumber) {
    try {
        return !!(await queryOne('SELECT court_number FROM planner_court_assignments WHERE court_number = ?', [courtNumber]));
    } catch (e) {
        return false;
    }
}

async function releaseInactiveCourts(dbLabel) {
    // Find aktive baner hvor en kamp er startet men ikke afsluttet,
    // og der ikke har været aktivitet i INACTIVITY_MINUTES minutter.
    //
    // Baner med en delkamp fra en holdkamp eller en turneringskamp røres ikke:
    // en skadespause eller en tablet uden net i 10 minutter slettede før kampen
    // uden spor, og delkampen bandt sig til banen igen som 0-0. De kampe styres
    // fra admin og ryddes af deres eget forløb (resultat, "Ryd banen", afslutning).
    const kandidater = await query(
        `SELECT c.id, c.court_number
         FROM courts c
         JOIN game_states gs ON gs.court_id = c.id
         WHERE c.is_active = TRUE AND ${synligBane('c')}
           AND gs.match_start_time IS NOT NULL
           AND gs.match_completed = FALSE
           AND gs.updated_at < NOW() - INTERVAL ${INACTIVITY_MINUTES} MINUTE
           -- ...og tælleren (tablettens livstegn hvert 10. sekund) har heller ikke givet lyd.
           -- Livstegnet flytter ikke længere updated_at; taeller_set_at er i UTC.
           AND (gs.taeller_set_at IS NULL OR gs.taeller_set_at < UTC_TIMESTAMP() - INTERVAL ${INACTIVITY_MINUTES} MINUTE)
           AND NOT EXISTS (
               SELECT 1 FROM team_match_games g
                 JOIN team_matches tm ON tm.id = g.team_match_id
                WHERE g.court_number = c.court_number AND g.status = 'active' AND tm.status = 'active')
           AND NOT EXISTS (
               SELECT 1 FROM tournament_matches m
                 JOIN tournaments t ON t.id = m.tournament_id
                WHERE m.court_number = c.court_number AND m.status = 'active' AND t.status = 'active')`
    );

    // Heller ikke en kamp fra badmintonplanner: den står, til næste runde lægges på banen
    const staleCourts = [];
    for (const court of kandidater) {
        if (!await harPlannerKamp(court.court_number)) staleCourts.push(court);
    }

    if (!staleCourts.length) return;

    let frigivet = 0;
    for (const court of staleCourts) {
        // Ikke uden spor (rest af nr. 4): rækken gemmes i frigivne_kampe, før den
        // slettes, så tabletten kan tilbyde "Fortsæt kampen?". Kan den ikke
        // gemmes, bliver banen stående (midnats-nulstillingen tager den).
        const raekke = await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
        if (!raekke) continue;
        try {
            await query(
                `INSERT INTO frigivne_kampe (court_id, data) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE data = VALUES(data), frigivet_at = CURRENT_TIMESTAMP`,
                [court.id, JSON.stringify(raekke)]
            );
        } catch (e) {
            console.error(`  ❌ ${dbLabel}: bane ${court.court_number} blev ikke frigivet — kampen kunne ikke gemmes:`, e.message);
            continue;
        }
        // Kun den version, der blev gemt: kom et point ind imellem, står banen
        const slettet = await query('DELETE FROM game_states WHERE court_id = ? AND version = ?',
            [court.id, raekke.version || 0]);
        if (!slettet || !slettet.affectedRows) continue;
        frigivet++;
        await query('UPDATE courts SET is_active = FALSE, is_doubles = FALSE WHERE id = ?', [court.id]);
        await query(
            `DELETE FROM device_tokens WHERE token_type = 'match_session' AND court_number = ?`,
            [court.court_number]
        );
        // TV og oversigt får besked med det samme (før så de det ved næste poll)
        publishGameStateChange({ clubDbName: currentTenant() }, court.court_number, 'reset');
    }

    if (frigivet) console.log(`  ♻️  ${dbLabel}: frigivet ${frigivet} inaktiv(e) bane(r) efter ${INACTIVITY_MINUTES} min uden aktivitet (kampen er gemt)`);
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
 * Serverbaseret auto-opdatering fra Tournament Software hvert 2. minut (rytmen pr. turnering: se autoPlan i routes/tournaments.js).
 * Kører kun for turneringer hvor admin har slået auto_sync til — og kører
 * uafhængigt af om admin-siden/browseren er åben.
 */
function startTournamentAutoSync() {
    // Lazy require — undgår require-cyklus ved opstart
    const { runTournamentAutoSync } = require('./routes/tournaments');

    cron.schedule('*/2 * * * *', async () => {
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

    console.log('⏰ Scheduled tournament auto-sync every 2 minutes (TS-turneringer med auto_sync slået til)');
}

/**
 * Automatisk hentning af holdsammensaetningen fra badmintonplayer.dk.
 *
 * Koerer hvert minut, men rammer kun badmintonplayer for de kampe der faktisk
 * er inde i vinduet omkring kampstart og ikke er tjekket de sidste 5 minutter.
 * Er der ingen kampe under overvaagning, er det en ren databaseforespoergsel.
 */
function startHoldkampWatch() {
    const { runHoldkampWatchers } = require('./routes/importHoldkamp');

    // Overlap-værn: badmintonplayer kan være langsom, og et gennemløb over mange
    // klubber kan tage over et minut. Uden dette ville næste minuts kørsel starte
    // oven i den forrige, vælge de samme 'venter'-watchers og oprette holdkampen
    // to gange. Springer vi bare over, til den igangværende er færdig.
    //
    // Nødbremse: værnet må aldrig kunne stoppe vagten for altid. Hænger et
    // gennemløb (alle kald har timeouts, så det burde ikke ske), slipper vi
    // det efter 3 minutter og starter et nyt. Det er sikkert, fordi hvert tjek
    // "tager" kampen atomart i databasen (se tjekWatcher) — to gennemløb kan
    // ikke oprette samme holdkamp.
    const MAKS_GENNEMLOEB_MS = 3 * 60 * 1000;
    let aktiv = null; // { id, siden }
    let loebenr = 0;

    // Hvert 10. sekund: tidsplanen har første tjek 59 min 50 sek før kampstart
    // og derefter hvert 30. sekund (senere hvert 2. minut), så minut-opløsning er for grov. Uden
    // forfaldne kampe er et gennemløb én lille databaseforespørgsel pr. klub.
    cron.schedule('*/10 * * * * *', async () => {
        if (aktiv) {
            if (Date.now() - aktiv.siden < MAKS_GENNEMLOEB_MS) return;
            console.error(`❌ Holdkamp-overvågning: gennemløb ${aktiv.id} har hængt i over 3 minutter — starter et nyt`);
        }
        const mit = { id: ++loebenr, siden: Date.now() };
        aktiv = mit;
        try {
            // 1. Standard/direkte database
            try {
                await runHoldkampWatchers();
            } catch (err) {
                console.error('❌ Holdkamp-overvågning fejlede (default):', err.message);
            }

            // 2. Alle aktive klub-databaser (multi-tenant)
            try {
                const masterDb = require('./config/masterDatabase');
                const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
                for (const club of clubs) {
                    try {
                        await runWithTenant(club.db_name, () => runHoldkampWatchers());
                    } catch (err) {
                        console.error(`❌ Holdkamp-overvågning fejlede for ${club.db_name}:`, err.message);
                    }
                }
            } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
        } finally {
            if (aktiv === mit) aktiv = null;
        }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });

    console.log('⏰ Scheduled holdkamp-overvågning hvert 10. sekund (første tjek 59:50 før kampstart, hvert 30. sekund i 10 min, derefter hvert 2. minut)');
}

/**
 * Automatisk lukning af faerdigspillede holdkampe.
 *
 * Koerer hvert minut. En holdkamp hvor ALLE delkampe er faerdige, lukkes
 * 10 minutter efter den sidste delkamp (se AUTO_AFSLUT_EFTER_MIN i
 * routes/teamMatches.js) — saa admin har tid til at rette et resultat, og
 * bagefter ligger den under Kamphistorik. Ren databaseforespoergsel; intet net.
 */
function startHoldkampAutoAfslut() {
    const { autoAfslutHoldkampe, AUTO_AFSLUT_EFTER_MIN } = require('./routes/teamMatches');
    const { autoRydAfsluttedeBaner, AUTO_RYD_EFTER_MIN } = require('./config/banerydning');
    const { currentTenant } = require('./config/tenantPools');
    // Hver bane med en afgjort holdkamp-/turneringskamp ryddes først, så
    // holdkampens egen lukning bagefter kun har sine sidste baner tilbage
    const koer = async () => {
        try {
            await autoRydAfsluttedeBaner({ clubDbName: currentTenant() });
        } catch (err) {
            console.error('❌ Automatisk rydning af baner fejlede:', err.message);
        }
        await autoAfslutHoldkampe();
    };

    cron.schedule('* * * * *', async () => {
        // 1. Standard/direkte database
        try {
            await koer();
        } catch (err) {
            console.error('❌ Auto-afslutning af holdkampe fejlede (default):', err.message);
        }

        // 2. Alle aktive klub-databaser (multi-tenant)
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, koer);
                } catch (err) {
                    console.error(`❌ Auto-afslutning af holdkampe fejlede for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });

    console.log(`⏰ Scheduled auto-afslutning af holdkampe hvert minut (${AUTO_AFSLUT_EFTER_MIN} min efter sidste delkamp; baner ryddes ${AUTO_RYD_EFTER_MIN} min efter kampen)`);
}

/**
 * badmintonplanner.dk: når klubbens tidsvindue lukker (eller integrationen
 * slås fra), ryddes de baner planner-runden viste, så klubben er tilbage i
 * normal drift. Kører hvert minut; ren databaseforespørgsel. Se
 * plannerVindueLuk i routes/plannerIntegration.js.
 */
function startPlannerVindueLuk() {
    const { plannerVindueLuk } = require('./routes/plannerIntegration');

    cron.schedule('* * * * *', async () => {
        try {
            await plannerVindueLuk();
        } catch (err) {
            console.error('❌ Planner-oprydning fejlede (default):', err.message);
        }

        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try {
                    await runWithTenant(club.db_name, () => plannerVindueLuk());
                } catch (err) {
                    console.error(`❌ Planner-oprydning fejlede for ${club.db_name}:`, err.message);
                }
            }
        } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });

    console.log('⏰ Scheduled oprydning af badmintonplanner-baner ved vindue-luk (hvert minut)');

    // Resultater til badmintonplanner.dk (spillernavne) gemmes ikke længere end
    // nødvendigt: de hentes løbende eller samme aften, så 90 dage er rigeligt.
    const rydResultater = () => query(
        `DELETE FROM planner_results WHERE created_at < NOW() - INTERVAL ${PLANNER_RESULTAT_DAGE} DAY`
    );
    cron.schedule('15 3 * * *', async () => {
        try { await rydResultater(); } catch (err) { /* tabellen findes først efter migration 029 */ }
        try {
            const masterDb = require('./config/masterDatabase');
            const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
            for (const club of clubs) {
                try { await runWithTenant(club.db_name, rydResultater); }
                catch (err) { console.error(`❌ Oprydning af planner-resultater fejlede for ${club.db_name}:`, err.message); }
            }
        } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
}

const PLANNER_RESULTAT_DAGE = 90;

/**
 * Automatisk backup af hver aktiv klub — mandag kl. 02.00 dansk tid. De 4 nyeste
 * gemmes (config/autoBackup.js). Klublisten læses ved hver kørsel, så nye klubber
 * kommer med af sig selv; deaktiverede klubber springes over, og demoen (app.) er
 * ingen klub. Resultatet (tidspunkt eller fejl) står på klubben i master-DB'en
 * og vises på super-admin.
 */
// Klubbernes backups tages én ad gangen — den ugentlige og indhentningen ved
// opstarten (nr. 57) står i samme kø, så to aldrig kører samtidig
let backupKoe = Promise.resolve();
function enBackupAdGangen(fn) {
    const p = backupKoe.then(fn, fn);
    backupKoe = p.catch(() => {});
    return p;
}

const AKTIVE_KLUBBER_SQL = 'SELECT id, name, subdomain, db_name, created_at FROM clubs WHERE is_active = 1';

// Tag én klubs ugentlige backup og skriv udfaldet på klubben. true: lykkedes.
async function ugentligBackupAfKlub(club) {
    const db = require('./config/database');
    const masterDb = require('./config/masterDatabase');
    const { tagBackup } = require('./config/autoBackup');
    try {
        const fil = await runWithTenant(club.db_name, async () => {
            const conn = await db.pool.getConnection();
            try { return await tagBackup(conn, club, 'auto'); } finally { conn.release(); }
        });
        await masterDb.query(
            'UPDATE clubs SET last_auto_backup_at = NOW(), last_auto_backup_error = NULL, updated_at = updated_at WHERE id = ?',
            [club.id]
        );
        console.log(`  ✅ ${club.db_name}: ${fil}`);
        return true;
    } catch (err) {
        console.error(`  ❌ Backup af ${club.db_name} fejlede:`, err.message);
        try {
            await masterDb.query(
                'UPDATE clubs SET last_auto_backup_error = ?, updated_at = updated_at WHERE id = ?',
                [String(err.message || err).slice(0, 500), club.id]
            );
        } catch { /* master-DB'en kunne heller ikke nås */ }
        return false;
    }
}

async function ugentligBackup() {
    return enBackupAdGangen(async () => {
        const masterDb = require('./config/masterDatabase');
        let clubs;
        try {
            clubs = await masterDb.query(AKTIVE_KLUBBER_SQL);
        } catch (err) {
            console.error('❌ Automatisk backup: klublisten kunne ikke hentes:', err.message);
            return;
        }
        console.log(`💾 Automatisk backup af ${clubs.length} klubber...`);
        let ok = 0;
        for (const club of clubs) {
            if (await ugentligBackupAfKlub(club)) ok++;
        }
        console.log(`💾 Automatisk backup færdig: ${ok} af ${clubs.length} klubber`);
    });
}

/**
 * Indhent den ugentlige backup (nr. 57): var serveren nede mandag kl. 02.00 (en
 * deploy, en genstart), sprang cron'en den over, og klubben stod en uge mere
 * uden. Ved opstarten tages den for hver aktiv klub, der mangler en fra den
 * seneste mandag — én klub ad gangen med en pause imellem, så opstarten og
 * klubberne, der er i gang, ikke mærker det. Køen deles med den ugentlige.
 */
async function indhentUgentligBackup({ nu = () => new Date(), pauseMs = INDHENT_PAUSE_MS } = {}) {
    const masterDb = require('./config/masterDatabase');
    const autoBackup = require('./config/autoBackup');
    const mangler = (club) => {
        try { return autoBackup.manglerUgentlig(club, nu()); } catch { return false; }
    };
    let clubs;
    try {
        clubs = (await masterDb.query(AKTIVE_KLUBBER_SQL)).filter(mangler);
    } catch (err) {
        console.error('❌ Indhentning af ugentlig backup: klublisten kunne ikke hentes:', err.message);
        return 0;
    }
    if (!clubs.length) return 0;
    console.log(`💾 ${clubs.length} klub(ber) mangler ugens backup (serveren var nede mandag kl. 02.00) — tages nu, én ad gangen`);
    let taget = 0;
    for (const [i, club] of clubs.entries()) {
        if (i > 0 && pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
        // Igen inde i køen: den ugentlige kan være kørt imens
        await enBackupAdGangen(async () => {
            if (mangler(club) && await ugentligBackupAfKlub(club)) taget++;
        });
    }
    console.log(`💾 Indhentning færdig: ${taget} af ${clubs.length} klubber`);
    return taget;
}

const INDHENT_EFTER_MS = 2 * 60 * 1000;   // efter opstarten — når migrationer og første forespørgsler er overstået
const INDHENT_PAUSE_MS = 15 * 1000;       // mellem to klubber

function startUgentligBackup() {
    cron.schedule('0 2 * * 1', ugentligBackup, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
    setTimeout(() => {
        indhentUgentligBackup().catch(err => console.error('❌ Indhentning af ugentlig backup:', err.message));
    }, INDHENT_EFTER_MS).unref();
    console.log('⏰ Automatisk backup af klubberne hver mandag kl. 02:00 (Europe/Copenhagen) — en manglende indhentes 2 min efter opstarten');
}

/**
 * Skærmenes hændelseslog (screens/haendelseslog.js) holdes på 30 dage —
 * ryddes hver nat kl. 04:15.
 */
function startSkaermLogOprydning() {
    const haendelseslog = require('./screens/haendelseslog');
    cron.schedule('15 4 * * *', async () => {
        try {
            const n = await haendelseslog.ryd();
            if (n) console.log(`🧹 Skærm-hændelser: ${n} ældre end ${haendelseslog.BEHOLD_DAGE} dage slettet`);
        } catch (err) {
            console.error('❌ Oprydning af skærm-hændelser fejlede:', err.message);
        }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
}

/**
 * Tæl fra uret: pausen ved 11 (8) og mellem sæt slutter af sig selv ved 0:00
 * (routes/urTaeller.js afslutUdloebnePauser). Uret kan ikke selv gøre det, når
 * skærmen er slukket. Hvert 2. sekund; uden pauser en lille forespørgsel pr. klub.
 */
/**
 * Vagten over YouTube-udsendelserne: YouTube lukker dem ikke selv længere
 * (et kort udfald skal blive i samme video), så serveren afslutter en
 * udsendelse, hvis PC'en har været tavs i 10 minutter, eller banen ikke skal
 * sende mere (se routes/livestream.js ytVagt). Hvert minut; uden åbne
 * udsendelser én lille forespørgsel pr. klub.
 */
function startYoutubeVagt() {
    const { ytVagt } = require('./routes/livestream');
    let koerer = false;
    cron.schedule('* * * * *', async () => {
        if (koerer) return;
        koerer = true;
        try {
            // 1. Standard/direkte database
            try {
                await ytVagt();
            } catch (err) {
                console.error('❌ Vagten over YouTube-udsendelser (default):', err.message);
            }
            // 2. Alle aktive klub-databaser (multi-tenant)
            try {
                const masterDb = require('./config/masterDatabase');
                const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
                for (const club of clubs) {
                    try {
                        await runWithTenant(club.db_name, () => ytVagt());
                    } catch (err) {
                        console.error(`❌ Vagten over YouTube-udsendelser for ${club.db_name}:`, err.message);
                    }
                }
            } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
        } finally {
            koerer = false;
        }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
    console.log('⏰ Scheduled vagten over YouTube-udsendelser hvert minut (afslutter efter 10 min uden PC)');
}

/**
 * Nr. 12C: appens YouTube-udsendelser bliver "kun med linket", når de er over
 * 60 dage gamle og stadig offentlige (routes/livestream.js ytSynlighedJob).
 * Hver nat kl. 03:40 dansk tid — sidst i Googles kvote-døgn, der nulstilles
 * kl. 9 (midnat Pacific), så jobbet bruger af det, dagens udsendelser ikke brugte.
 */
async function youtubeSynlighed() {
    const { ytSynlighedJob } = require('./routes/livestream');
    try {
        await ytSynlighedJob();
    } catch (err) {
        console.error('❌ YouTube "kun med linket" (default):', err.message);
    }
    try {
        const masterDb = require('./config/masterDatabase');
        const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
        for (const club of clubs) {
            try {
                await runWithTenant(club.db_name, () => ytSynlighedJob());
            } catch (err) {
                console.error(`❌ YouTube "kun med linket" for ${club.db_name}:`, err.message);
            }
        }
    } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
}

function startYoutubeSynlighed() {
    cron.schedule('40 3 * * *', youtubeSynlighed, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
    console.log('⏰ Scheduled YouTube "kun med linket" efter 60 dage hver nat kl. 03:40');
}

function startUrPauser() {
    const { afslutUdloebnePauser } = require('./routes/urTaeller');
    let koerer = false;
    cron.schedule('*/2 * * * * *', async () => {
        if (koerer) return;
        koerer = true;
        try {
            // 1. Standard/direkte database
            try {
                await afslutUdloebnePauser();
            } catch (err) {
                console.error('❌ Urets pauser (default):', err.message);
            }
            // 2. Alle aktive klub-databaser (multi-tenant)
            try {
                const masterDb = require('./config/masterDatabase');
                const clubs = await masterDb.query('SELECT db_name FROM clubs WHERE is_active = 1');
                for (const club of clubs) {
                    try {
                        await runWithTenant(club.db_name, () => afslutUdloebnePauser());
                    } catch (err) {
                        console.error(`❌ Urets pauser for ${club.db_name}:`, err.message);
                    }
                }
            } catch (err) { /* master DB ikke tilgængelig i direkte mode */ }
        } finally {
            koerer = false;
        }
    }, {
        scheduled: true,
        timezone: 'Europe/Copenhagen'
    });
    console.log('⏰ Scheduled urets pauser hvert 2. sekund (slutter ved 0:00, når uret tæller)');
}

module.exports = { resetDatabase, releaseInactiveCourts, startMidnightReset, startExpirationCheck, startInactivityCheck, startTournamentAutoSync, startHoldkampWatch, startHoldkampAutoAfslut, startPlannerVindueLuk, startUgentligBackup, ugentligBackup, indhentUgentligBackup, startSkaermLogOprydning, startUrPauser, startYoutubeVagt, startYoutubeSynlighed, youtubeSynlighed };
