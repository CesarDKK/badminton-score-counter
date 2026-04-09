/**
 * Test helpers — fælles hjælpefunktioner til alle test-filer.
 * Tests køres inde i backend containeren mod 127.0.0.1:3000.
 *
 * Brug http modulet (ikke fetch) så vi kan sætte Host-headeren manuelt.
 */

const http = require('node:http');

const BASE_PORT = parseInt(process.env.TEST_PORT || '3000');
const BASE_HOST = process.env.TEST_HOST || '127.0.0.1';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '';

// Cache af admin token — undgår gentagne login-forsøg (vigtigt pga. rate limiter)
let _cachedAdminToken = null;

/**
 * Lav en HTTP request mod API'et.
 * @param {string} path - f.eks. '/api/settings'
 * @param {object} options - { method, body }
 * @param {object} extra - { host, token }
 * @returns {Promise<{ status, body }>}
 */
function req(path, options = {}, { host, token } = {}) {
    return new Promise((resolve, reject) => {
        const bodyStr = options.body ? JSON.stringify(options.body) : null;
        const headers = {
            'Content-Type': 'application/json',
            'Host': host || BASE_HOST,
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
        };

        const reqOptions = {
            hostname: BASE_HOST,
            port: BASE_PORT,
            path,
            method: options.method || 'GET',
            headers
        };

        const r = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let body = null;
                try { body = JSON.parse(data); } catch { body = data || null; }
                resolve({ status: res.statusCode, body });
            });
        });

        r.on('error', reject);
        if (bodyStr) r.write(bodyStr);
        r.end();
    });
}

/**
 * Log ind som admin og returner token. Token caches for hele test-kørslen.
 * Kaster en fejl med brugervenlig besked hvis login fejler.
 */
async function adminLogin() {
    if (_cachedAdminToken) return _cachedAdminToken;

    if (!ADMIN_PASSWORD) {
        throw new Error(
            'TEST_ADMIN_PASSWORD er ikke sat.\n' +
            'Kør: docker compose exec -e TEST_ADMIN_PASSWORD=<din-kode> backend node --test tests/*.test.js'
        );
    }

    const { status, body } = await req('/api/auth/login', {
        method: 'POST',
        body: { password: ADMIN_PASSWORD }
    });

    if (status !== 200 || !body?.token) {
        throw new Error(`Admin login fejlede (${status}): ${JSON.stringify(body)}`);
    }

    _cachedAdminToken = body.token;
    return _cachedAdminToken;
}

module.exports = { req, adminLogin, BASE_HOST, ADMIN_PASSWORD };
