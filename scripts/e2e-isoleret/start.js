// Bygger en frisk database (som MySQL-containerens første start: init.sql og
// init.master.sql) og starter backenden i direct-mode på port 8080.
// Kun til scripts/e2e-isoleret/compose.yml — databasen ligger i hukommelsen.
const fs = require('fs');
const path = require('path');
const B = '/repo/backend';
const mysql = require(path.join(B, 'node_modules/mysql2/promise'));
const vent = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    let c;
    for (let i = 0; ; i++) {
        try {
            c = await mysql.createConnection({ host: 'mysql', user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, multipleStatements: true });
            break;
        } catch (e) { if (i > 120) throw e; await vent(1000); }
    }
    await c.query("CREATE USER 'badminton_user'@'%' IDENTIFIED BY ?", [process.env.DB_PASSWORD]);
    await c.query(fs.readFileSync(path.join(B, 'init.sql'), 'utf8'));
    await c.query("GRANT ALL PRIVILEGES ON badminton_counter.* TO 'badminton_user'@'%'");
    await c.query(fs.readFileSync(path.join(B, 'init.master.sql'), 'utf8'));
    await c.query('FLUSH PRIVILEGES');
    await c.end();
    for (const d of [process.env.UPLOAD_DIR, process.env.CLUB_BACKUP_DIR, process.env.FULD_BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });
    console.log('✓ databaser bygget — starter backenden');
    process.chdir(B);
    require(path.join(B, 'server.js'));
})().catch(e => { console.error(e); process.exit(1); });
