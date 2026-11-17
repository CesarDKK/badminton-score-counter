// Kan de gemte, krypterede hemmeligheder læses med den nuværende JWT_SECRET?
// (nr. 21c)
//
// Nøglen til config/hemmelig.js er afledt af JWT_SECRET. Skiftes den (fx hvis
// .env er gået tabt, og en ny er taget), kan værdierne ikke længere læses:
// klubbernes YouTube-forbindelse, Googles Client secret og Hetzner-nøglen holder
// stille op med at virke, hver for sig og uden at nogen ser hvorfor. Kontrollen
// kører én gang ved opstarten, logger tydeligt og vises under Serverens helbred
// i super-admin. Den ændrer intet og vælter aldrig opstarten.

const masterDb = require('./masterDatabase');
const { dekrypter } = require('./hemmelig');

// De krypterede værdier i master-databasens indstillinger
const MASTER = {
    youtube_client_secret: 'YouTube-login-klientens Client secret (super-admin → YouTube)',
    hetzner_token: 'Hetzner-nøglen (super-admin → Serverens helbred)',
};

const tilstand = { tjekket: null, antal: 0, ulaeselige: [], fejl: [] };

const kortFejl = (e) => String((e && e.message) || e || 'ukendt fejl').slice(0, 200);

// forbind(dbName) → mysql2-forbindelse (query giver [rows]; end() lukker)
async function kontroller({ forbind = require('./migrationRunner').getConnection } = {}) {
    const ud = { antal: 0, ulaeselige: [], fejl: [] };
    const tjek = (vaerdi, hvor) => {
        ud.antal++;
        if (dekrypter(vaerdi) === null) ud.ulaeselige.push(hvor);
    };

    try {
        const raekker = await masterDb.query(
            `SELECT noegle, vaerdi FROM indstillinger WHERE noegle IN (${Object.keys(MASTER).map(() => '?').join(', ')})`,
            Object.keys(MASTER));
        for (const r of raekker) if (r.vaerdi) tjek(r.vaerdi, MASTER[r.noegle] || r.noegle);
    } catch (e) {
        ud.fejl.push(`master: ${kortFejl(e)}`);
    }

    // Klubbernes YouTube-forbindelse (livestream_youtube.refresh_token)
    let databaser = [{ db: process.env.DB_NAME || 'badminton_counter', navn: null }];
    try {
        const klubber = await masterDb.query('SELECT name, subdomain, db_name FROM clubs ORDER BY db_name');
        databaser = databaser.concat(klubber.map(k => ({ db: k.db_name, navn: k.name || k.subdomain })));
    } catch (e) {
        ud.fejl.push(`klublisten: ${kortFejl(e)}`);
    }
    for (const { db, navn } of databaser) {
        let conn;
        try {
            conn = await forbind(db);
            const [rows] = await conn.query('SELECT refresh_token FROM livestream_youtube');
            for (const r of rows) {
                if (r.refresh_token) tjek(r.refresh_token, `${navn || db}: YouTube-forbindelsen (klubbens admin → Livestream → forbind igen)`);
            }
        } catch (e) {
            if (e && e.code !== 'ER_NO_SUCH_TABLE' && e.code !== 'ER_BAD_DB_ERROR') ud.fejl.push(`${db}: ${kortFejl(e)}`);
        } finally {
            if (conn) await conn.end().catch(() => {});
        }
    }

    Object.assign(tilstand, ud, { tjekket: new Date().toISOString() });
    if (ud.ulaeselige.length) {
        console.error(`✗ KRYPTERINGSNØGLE: ${ud.ulaeselige.length} af ${ud.antal} gemte hemmeligheder kan ikke læses med den nuværende JWT_SECRET` +
            ' — er .env (JWT_SECRET) skiftet? Se Serverens helbred i super-admin:');
        for (const h of ud.ulaeselige) console.error(`    - ${h}`);
    } else if (ud.antal) {
        console.log(`✓ Krypteringsnøglen: alle ${ud.antal} gemte hemmeligheder kan læses`);
    }
    if (ud.fejl.length) console.warn(`⚠ Kontrollen af krypteringsnøglen kunne ikke læse alt: ${ud.fejl.join('; ')}`);
    return status();
}

// Til super-admin (Serverens helbred)
function status() {
    return {
        tjekket: tilstand.tjekket,
        antal: tilstand.antal,
        ulaeselige: [...tilstand.ulaeselige],
        fejl: [...tilstand.fejl],
    };
}

function _nulstil() { Object.assign(tilstand, { tjekket: null, antal: 0, ulaeselige: [], fejl: [] }); }

module.exports = { kontroller, status, MASTER, _nulstil };
