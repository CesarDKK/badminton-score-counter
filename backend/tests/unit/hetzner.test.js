/**
 * Unit-tests af serverens helbred (Hetzner-målingerne i super-admin) — ingen
 * server, ingen database: master-databasen og fetch er stubbet.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-hemmelighed-til-hetzner';
const masterDb = require('../../config/masterDatabase');
const { krypter } = require('../../config/hemmelig');
const hetzner = require('../../config/hetzner');

const SERVER = {
    id: 4711, name: 'badmintonapp-prod', status: 'running', created: '2025-01-10T09:00:00+00:00',
    server_type: { name: 'cx32', cores: 4, memory: 8, disk: 80 },
    primary_disk_size: 80,
    location: { city: 'Falkenstein' },
    public_net: { ipv4: { ip: '203.0.113.7' } },
    backup_window: '22-02',
    outgoing_traffic: 123456789, ingoing_traffic: 98765432, included_traffic: 21990232555520
};
const METRICS = {
    start: '2026-11-05T10:00:00Z', end: '2026-11-05T11:00:00Z', step: 60,
    time_series: {
        cpu: { values: [[1793872800, '20'], [1793872860, '80.4'], [1793872920, 'NaN']] },
        'network.0.bandwidth.in': { values: [[1793872800, '1500']] },
        'network.0.bandwidth.out': { values: [[1793872800, '3000.5']] },
        'disk.0.bandwidth.read': { values: [] },
        'disk.0.bandwidth.write': { values: [[1793872800, '4096']] }
    }
};

let gemt;      // indstillinger-tabellen: noegle -> vaerdi
let kald;      // fetch-kald: [url, headers]
let svar;      // url-del -> { status, body }
const ægteFetch = global.fetch;

beforeEach(() => {
    gemt = new Map();
    kald = [];
    svar = {};
    delete process.env.HETZNER_API_TOKEN;
    masterDb.query = async (sql, params) => {
        if (sql.startsWith('SELECT')) {
            return params.filter(n => gemt.has(n)).map(n => ({ noegle: n, vaerdi: gemt.get(n), opdateret: '2026-11-05 10:00:00' }));
        }
        if (sql.startsWith('INSERT')) { gemt.set(params[0], params[1]); return []; }
        if (sql.startsWith('DELETE')) { params.forEach(n => gemt.delete(n)); return []; }
        throw new Error(`uventet SQL: ${sql}`);
    };
    global.fetch = async (url, opts = {}) => {
        kald.push([String(url), opts.headers || {}, opts.method || 'GET']);
        if (String(url).includes('169.254.169.254')) throw new Error('ikke på Hetzner');
        const noegle = Object.keys(svar).find(k => String(url).includes(k));
        const s = noegle ? svar[noegle] : { status: 404, body: { error: { message: 'not found' } } };
        return {
            ok: s.status >= 200 && s.status < 300, status: s.status,
            json: async () => s.body, text: async () => JSON.stringify(s.body)
        };
    };
});

afterEach(() => { global.fetch = ægteFetch; });

test('omform: CPU deles med antal kerner, tekstværdier bliver tal, ugyldige punkter droppes', () => {
    const d = hetzner.omform(SERVER, METRICS);
    assert.deepEqual(d.serier.cpu, [[1793872800000, 5], [1793872860000, 20.1]]);
    assert.deepEqual(d.serier.netUd, [[1793872800000, 3000.5]]);
    assert.deepEqual(d.serier.diskLaes, []);
    assert.equal(d.server.kerner, 4);
    assert.equal(d.server.diskGb, 80);
    assert.equal(d.server.trafik.inkluderet, 21990232555520);
    assert.equal(d.step, 60);
    // Manglende serier og målinger giver tomme lister, ikke fejl
    assert.deepEqual(hetzner.omform({ name: 'x' }, null).serier.cpu, []);
});

test('meminfo: MemAvailable foretrækkes, MemFree er nødløsningen', () => {
    assert.deepEqual(hetzner.laesMeminfo('MemTotal:       8000000 kB\nMemFree:  1000 kB\nMemAvailable:    6000000 kB\n'),
        { total: 8000000 * 1024, tilgaengelig: 6000000 * 1024 });
    assert.deepEqual(hetzner.laesMeminfo('MemTotal: 2000 kB\nMemFree: 500 kB\n'), { total: 2000 * 1024, tilgaengelig: 500 * 1024 });
    assert.equal(hetzner.laesMeminfo('noget andet'), null);
});

test('uden nøgle: kun serverens egne tal, ingen kald til Hetzner', async () => {
    const d = await hetzner.helbred('24t');
    assert.equal(d.opsat, false);
    assert.equal(d.hetzner, undefined);
    assert.ok(d.lokal.kerner >= 1);
    assert.ok(Array.isArray(d.lokal.belastning));
    assert.equal(kald.length, 0);
});

test('tjek + gem: én server i projektet vælges, nøglen gemmes krypteret', async () => {
    svar['/servers?per_page=50'] = { status: 200, body: { servers: [{ id: 4711, name: 'badmintonapp-prod' }] } };
    const t = await hetzner.tjek('a'.repeat(64));
    assert.deepEqual(t, { serverId: 4711, servere: [{ id: 4711, navn: 'badmintonapp-prod' }] });
    assert.equal(kald.find(k => k[0].includes('api.hetzner.cloud'))[1].Authorization, `Bearer ${'a'.repeat(64)}`);

    await hetzner.gem('a'.repeat(64), t.serverId);
    assert.notEqual(gemt.get('hetzner_token'), 'a'.repeat(64), 'ikke i klartekst');
    assert.equal(gemt.get('hetzner_server_id'), '4711');
    const o = await hetzner.opsaetning();
    assert.equal(o.token, 'a'.repeat(64));
    assert.equal(o.kilde, 'admin');
});

test('flere servere og ingen metadata: super-admin skal vælge', async () => {
    gemt.set('hetzner_token', krypter('b'.repeat(64)));
    svar['/servers?per_page=50'] = { status: 200, body: { servers: [{ id: 1, name: 'prod' }, { id: 2, name: 'test' }] } };
    const d = await hetzner.helbred('24t');
    assert.deepEqual(d.vaelg, [{ id: 1, navn: 'prod' }, { id: 2, navn: 'test' }]);
    assert.equal(d.hetzner, undefined);
});

test('helbred: målinger for perioden, kun GET-kald, og svaret gemmes et minut', async () => {
    gemt.set('hetzner_token', krypter('c'.repeat(64)));
    gemt.set('hetzner_server_id', '4711');
    svar['/servers/4711/metrics'] = { status: 200, body: { metrics: METRICS } };
    svar['/servers/4711'] = { status: 200, body: { server: SERVER } };
    const nu = Date.parse('2026-11-05T11:00:00Z');
    const d = await hetzner.helbred('1t', nu);
    assert.equal(d.periode, '1t');
    assert.equal(d.hetzner.server.navn, 'badmintonapp-prod');
    assert.equal(d.hetzner.serier.cpu.length, 2);
    const m = new URL(kald.find(k => k[0].includes('/metrics'))[0]);
    assert.equal(m.searchParams.get('type'), 'cpu,disk,network');
    assert.equal(m.searchParams.get('start'), '2026-11-05T10:00:00.000Z');
    assert.equal(m.searchParams.get('end'), '2026-11-05T11:00:00.000Z');
    assert.equal(m.searchParams.get('step'), '60');
    assert.ok(kald.every(k => k[2] === 'GET'), 'skriver aldrig til Hetzner');

    const foer = kald.length;
    await hetzner.helbred('1t', nu + 30 * 1000);
    assert.equal(kald.length, foer, 'fra cachen');
    await hetzner.helbred('1t', nu + 61 * 1000);
    assert.equal(kald.length, foer + 2, 'hentes igen efter et minut');
});

test('ukendt periode bliver til et døgn', async () => {
    const d = await hetzner.helbred('1000d');
    assert.equal(d.periode, '24t');
});

test('fejl hos Hetzner vises som tekst; en forsvundet server glemmes', async () => {
    gemt.set('hetzner_token', krypter('d'.repeat(64)));
    gemt.set('hetzner_server_id', '999');
    svar['/servers/999'] = { status: 401, body: {} };
    let d = await hetzner.helbred('24t', Date.now() + 10 * 60 * 1000);
    assert.match(d.fejl, /kender ikke API-nøglen/);
    assert.equal(gemt.get('hetzner_server_id'), '999');

    svar['/servers/999'] = { status: 404, body: { error: { message: 'server not found' } } };
    d = await hetzner.helbred('24t', Date.now() + 20 * 60 * 1000);
    assert.match(d.fejl, /404/);
    assert.equal(gemt.has('hetzner_server_id'), false);
});

test('HETZNER_API_TOKEN i .env går forud', async () => {
    gemt.set('hetzner_token', krypter('e'.repeat(64)));
    process.env.HETZNER_API_TOKEN = 'f'.repeat(64);
    const o = await hetzner.opsaetning();
    assert.equal(o.kilde, 'env');
    assert.equal(o.token, 'f'.repeat(64));
});
