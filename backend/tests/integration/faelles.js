/**
 * Fælles for integrationstestene i denne mappe (nr. 56).
 *
 * De opretter klubber, gendanner backups og kører migrationer igen — derfor
 * kører de KUN under koer.js mod en frisk test-MySQL (INTEGRATION_DB=1), aldrig
 * mod en rigtig installation.
 */
const http = require('node:http');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

if (process.env.INTEGRATION_DB !== '1') {
    throw new Error('Integrationstestene i tests/integration kører kun via tests/integration/koer.js (frisk test-MySQL)');
}

const PORT = Number(process.env.TEST_PORT || 3999);
const DOMAENE = process.env.APP_DOMAIN || 'test.local';
const ADMIN_HOST = `admin.${DOMAENE}`;

/**
 * HTTP-kald mod test-backenden. Host-headeren afgør klubben (som bag nginx).
 * body: objekt (JSON) eller { multipart: { felt, filnavn, type, data } }.
 * Svarer { status, body, headers }.
 */
function kald(sti, { method = 'GET', body, host = '127.0.0.1', token, ekstra = {} } = {}) {
    return new Promise((resolve, reject) => {
        const headers = { Host: host, ...ekstra };
        if (token) headers.Authorization = `Bearer ${token}`;
        let data = null;
        if (body && body.multipart) {
            const { felt, filnavn, type = 'application/octet-stream', data: indhold } = body.multipart;
            const graense = '----it' + crypto.randomBytes(8).toString('hex');
            data = Buffer.concat([
                Buffer.from(`--${graense}\r\nContent-Disposition: form-data; name="${felt}"; filename="${filnavn}"\r\nContent-Type: ${type}\r\n\r\n`),
                Buffer.isBuffer(indhold) ? indhold : Buffer.from(indhold),
                Buffer.from(`\r\n--${graense}--\r\n`),
            ]);
            headers['Content-Type'] = `multipart/form-data; boundary=${graense}`;
        } else if (body !== undefined) {
            data = Buffer.from(JSON.stringify(body));
            headers['Content-Type'] = 'application/json';
        }
        if (data) headers['Content-Length'] = data.length;
        const r = http.request({ host: '127.0.0.1', port: PORT, path: sti, method, headers }, (res) => {
            const dele = [];
            res.on('data', d => dele.push(d));
            res.on('end', () => {
                const tekst = Buffer.concat(dele).toString('utf8');
                let b = tekst;
                try { b = JSON.parse(tekst); } catch { /* ikke JSON */ }
                resolve({ status: res.statusCode, body: b, headers: res.headers });
            });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

function rod(database) {
    return mysql.createConnection({
        host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
        user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, database: database || undefined, timezone: '+00:00'
    });
}

async function rodQuery(database, sql, params = []) {
    const c = await rod(database);
    try { return (await c.query(sql, params))[0]; } finally { await c.end(); }
}

// Super-admin-token for standard-super-admin'en (som efter skiftet af
// standardkoden) — signeret med testens opdigtede JWT_SECRET
let _super = null;
async function superToken() {
    if (_super) return _super;
    const [a] = await rodQuery('badminton_master', 'SELECT id, username, password_hash FROM super_admins ORDER BY id LIMIT 1');
    await rodQuery('badminton_master', 'UPDATE super_admins SET must_change_password = FALSE WHERE id = ?', [a.id]);
    const { generateSuperAdminToken } = require('../../middleware/superAdminAuth');
    _super = generateSuperAdminToken(a.id, a.username, false, a.password_hash);
    return _super;
}

/**
 * Opretter en klub via super-admin-API'et (init.sql + alle migrationer, som i
 * prod) med en klub-admin, og logger ind som den. Svarer
 * { id, subdomain, host, db, bruger, kode, adminToken }.
 */
async function opretKlub(subdomain, navn = subdomain) {
    const token = await superToken();
    const k = await kald('/api/super-admin/clubs', { method: 'POST', host: ADMIN_HOST, token, body: { name: navn, subdomain } });
    if (k.status !== 201) throw new Error(`klubben ${subdomain} blev ikke oprettet (${k.status}): ${JSON.stringify(k.body)}`);
    if (k.body.migrationsfejl && k.body.migrationsfejl.length) {
        throw new Error(`migrationer fejlede for ${subdomain}: ${JSON.stringify(k.body.migrationsfejl)}`);
    }
    const bruger = 'admin';
    const kode = 'test-kode-' + crypto.randomBytes(4).toString('hex');
    const a = await kald(`/api/super-admin/clubs/${k.body.id}/admins`, {
        method: 'POST', host: ADMIN_HOST, token, body: { username: bruger, password: kode }
    });
    if (a.status !== 201) throw new Error(`klub-admin blev ikke oprettet (${a.status}): ${JSON.stringify(a.body)}`);
    const host = `${subdomain}.${DOMAENE}`;
    const l = await kald('/api/club-admin/login', { method: 'POST', host, body: { username: bruger, password: kode } });
    if (l.status !== 200 || !l.body.token) throw new Error(`klub-login fejlede (${l.status}): ${JSON.stringify(l.body)}`);
    return { id: k.body.id, subdomain, host, db: k.body.db_name, bruger, kode, adminToken: l.body.token };
}

// Enhedens session (JWT) for et adgangslink, som når tabletten/TV'et åbner /t/<token>
async function enhedsSession(klub, linkToken) {
    const r = await kald(`/t/${linkToken}`, { host: klub.host });
    const m = /[?&]dt=([^&]+)/.exec(r.headers.location || '');
    if (r.status !== 302 || !m) throw new Error(`/t/ gav ikke en session (${r.status} ${r.headers.location})`);
    return decodeURIComponent(m[1]);
}

// Et adgangslink (permanent) oprettet af klubbens admin → enhedens session
async function enhedsToken(klub, destination) {
    const r = await kald('/api/device-tokens', {
        method: 'POST', host: klub.host, token: klub.adminToken,
        body: { name: `Test ${destination}`, destination, locked: true }
    });
    if (r.status !== 201) throw new Error(`adgangslink blev ikke oprettet (${r.status}): ${JSON.stringify(r.body)}`);
    return enhedsSession(klub, r.body.token);
}

// QR-kodens link (match_session) på banen — som routes/matchSessionTokens.js opretter
// det. Token-værdien står i QR-koden, så enhver, der har scannet den, kender den.
async function qrLink(klub, bane = 1) {
    const token = crypto.randomBytes(32).toString('hex');
    await rodQuery(klub.db,
        `INSERT INTO device_tokens (token, name, destination, token_type, court_number, locked, is_active)
         VALUES (?, ?, ?, 'match_session', ?, 1, 1)`,
        [token, `QR kamp-session bane ${bane}`, `court/${bane}`, bane]);
    return token;
}

// En QR-kamp-session (JWT), som når en telefon scanner TV'ets QR-kode
async function qrSession(klub, bane = 1) {
    return enhedsSession(klub, await qrLink(klub, bane));
}

module.exports = { kald, rod, rodQuery, superToken, opretKlub, enhedsToken, enhedsSession, qrLink, qrSession, ADMIN_HOST, DOMAENE };
