const { test } = require('node:test');
const assert = require('node:assert/strict');
const { req } = require('./helpers');
const http = require('node:http');

// Hjælpefunktion der sætter X-Forwarded-Host (Express læser den med trust proxy)
function reqWithForwardedHost(path, host) {
    return new Promise((resolve, reject) => {
        const headers = {
            'Host': '127.0.0.1',
            'X-Forwarded-Host': host
        };
        const r = http.request({
            hostname: '127.0.0.1',
            port: parseInt(process.env.TEST_PORT || '3000'),
            path,
            method: 'GET',
            headers
        }, (res) => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        r.on('error', reject);
        r.end();
    });
}

test('Mode: localhost/IP returnerer direct', async () => {
    const { status, body } = await req('/api/mode');
    assert.equal(status, 200);
    assert.equal(body.mode, 'direct');
});

test('Mode: admin subdomain returnerer admin', async () => {
    const appDomain = process.env.APP_DOMAIN || 'badmintonapp.dk';
    const { status, body } = await reqWithForwardedHost('/api/mode', `admin.${appDomain}`);
    assert.equal(status, 200);
    assert.equal(body.mode, 'admin');
});

test('Mode: mode feltet er altid til stede', async () => {
    const { body } = await req('/api/mode');
    assert.ok(['direct', 'admin', 'club', 'marketing'].includes(body.mode));
});
