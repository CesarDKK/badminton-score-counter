/**
 * Serverens helbred i super-admin: Hetzners målinger af prod-serveren (CPU,
 * disk-aktivitet, netværk, månedens trafik) via Hetzner Cloud API'et — og det,
 * Hetzner ikke kan se udefra (ledig diskplads, hukommelse, belastning), som
 * serveren selv måler.
 *
 * Super-admin indtaster en API-nøgle med KUN læseadgang (Hetzner Console →
 * projektet → Security → API Tokens → Read). Den gemmes krypteret i
 * master-databasen (config/hemmelig.js); HETZNER_API_TOKEN i .env går forud.
 * Nøglen sendes aldrig tilbage. Kun GET-kald — koden skriver aldrig til Hetzner.
 */
const fs = require('fs');
const os = require('os');
const masterDb = require('./masterDatabase');
const { krypter, dekrypter } = require('./hemmelig');
const fuldBackup = require('./fuldBackup');
const opstart = require('./opstart');
const migrationRunner = require('./migrationRunner');

const API ='https://api.hetzner.cloud/v1';
const TIMEOUT_MS = 8000;
const TOKEN = 'hetzner_token';
const SERVER = 'hetzner_server_id';
// Hetzners metadata-tjeneste: serveren kan selv spørge, hvilken server den er
const METADATA = 'http://169.254.169.254/hetzner/v1/metadata/instance-id';

// Perioderne i super-admin. Hetzner giver højst 200 punkter, hvis step udelades;
// vi vælger selv step, så punkterne ligger på hele minutter/timer.
const PERIODER = {
    '1t': { sek: 3600, step: 60 },
    '24t': { sek: 24 * 3600, step: 600 },
    '7d': { sek: 7 * 24 * 3600, step: 3600 },
    '30d': { sek: 30 * 24 * 3600, step: 4 * 3600 }
};
const CACHE_MS = 60 * 1000;

let cache = new Map();   // periode -> { tid, data }

// ── nøglen ─────────────────────────────────────────────────

async function indstillinger() {
    const raekker = await masterDb.query(
        'SELECT noegle, vaerdi, opdateret FROM indstillinger WHERE noegle IN (?, ?)', [TOKEN, SERVER]);
    return Object.fromEntries(raekker.map(r => [r.noegle, r]));
}

// { token, kilde: 'env' | 'admin' | null, serverId, ulaeselig, opdateret }
async function opsaetning() {
    const v = await indstillinger();
    const serverId = v[SERVER] ? Number(v[SERVER].vaerdi) || null : null;
    if (process.env.HETZNER_API_TOKEN) {
        return { token: process.env.HETZNER_API_TOKEN.trim(), kilde: 'env', serverId, ulaeselig: false, opdateret: null };
    }
    const token = v[TOKEN] ? dekrypter(v[TOKEN].vaerdi) : null;
    return { token, kilde: token ? 'admin' : null, serverId, ulaeselig: !!(v[TOKEN] && !token),
        opdateret: v[TOKEN] ? v[TOKEN].opdateret : null };
}

async function saet(noegle, vaerdi) {
    await masterDb.query(
        'INSERT INTO indstillinger (noegle, vaerdi) VALUES (?, ?) ON DUPLICATE KEY UPDATE vaerdi = VALUES(vaerdi)',
        [noegle, vaerdi]);
}

async function gem(token, serverId) {
    await saet(TOKEN, krypter(token));
    if (serverId) await saet(SERVER, String(serverId));
    else await masterDb.query('DELETE FROM indstillinger WHERE noegle = ?', [SERVER]);
    cache = new Map();
}

async function vaelgServer(serverId) {
    await saet(SERVER, String(serverId));
    cache = new Map();
}

async function fjern() {
    await masterDb.query('DELETE FROM indstillinger WHERE noegle IN (?, ?)', [TOKEN, SERVER]);
    cache = new Map();
}

// ── Hetzner-kald ───────────────────────────────────────────

class HetznerFejl extends Error {
    constructor(besked, status) { super(besked); this.status = status; }
}

async function hent(token, sti) {
    let r;
    try {
        r = await fetch(API + sti, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
    } catch (e) {
        throw new HetznerFejl(e.name === 'TimeoutError' ? 'Hetzner svarede ikke inden for 8 sekunder' : `Kunne ikke nå Hetzner: ${e.message}`, 0);
    }
    if (r.status === 401) throw new HetznerFejl('Hetzner kender ikke API-nøglen — er den slettet eller kopieret forkert?', 401);
    if (r.status === 429) throw new HetznerFejl('Hetzner siger, at der er spurgt for tit — prøv igen om lidt', 429);
    if (!r.ok) {
        let besked = '';
        try { besked = ((await r.json()).error || {}).message || ''; } catch { /* ingen JSON */ }
        throw new HetznerFejl(`Hetzner svarede ${r.status}${besked ? `: ${besked}` : ''}`, r.status);
    }
    return r.json();
}

// Serverens eget id fra metadata-tjenesten — null udenfor Hetzner eller uden svar
async function egetId() {
    try {
        const r = await fetch(METADATA, { signal: AbortSignal.timeout(1500) });
        if (!r.ok) return null;
        const id = Number((await r.text()).trim());
        return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
}

// Tjekker nøglen og finder serveren. Returnerer { serverId, servere } —
// serverId er null, hvis projektet har flere servere, og ingen af dem er denne.
async function tjek(token) {
    const { servers = [] } = await hent(token, '/servers?per_page=50');
    const servere = servers.map(s => ({ id: s.id, navn: s.name }));
    const eget = await egetId();
    if (eget && servere.some(s => s.id === eget)) return { serverId: eget, servere };
    return { serverId: servere.length === 1 ? servere[0].id : null, servere };
}

// ── omformning (ren logik, testes i tests/unit/hetzner.test.js) ──

// Hetzners time_series-værdier er tekst: [[sekunder, "42.1"], …] → [[ms, 42.1], …]
function serie(ts, navn, faktor = 1) {
    const s = ts && ts[navn];
    if (!s || !Array.isArray(s.values)) return [];
    return s.values
        .map(([t, v]) => [Math.round(Number(t) * 1000), Number(v) * faktor])
        .filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v));
}

function omform(server, metrics) {
    const kerner = (server.server_type && server.server_type.cores) || 1;
    const ts = (metrics && metrics.time_series) || {};
    return {
        server: {
            navn: server.name,
            status: server.status,
            type: server.server_type ? server.server_type.name : '',
            kerner,
            hukommelseGb: server.server_type ? server.server_type.memory : null,
            diskGb: server.primary_disk_size || (server.server_type && server.server_type.disk) || null,
            by: server.location ? server.location.city : '',
            ipv4: server.public_net && server.public_net.ipv4 ? server.public_net.ipv4.ip : '',
            oprettet: server.created,
            backupVindue: server.backup_window || null,
            trafik: {
                ud: server.outgoing_traffic,
                ind: server.ingoing_traffic,
                inkluderet: server.included_traffic
            }
        },
        step: metrics ? metrics.step : null,
        serier: {
            // Hetzner regner CPU pr. kerne (100 = én kerne fuldt) — delt med
            // antallet af kerner, så 100 % er hele serveren
            cpu: serie(ts, 'cpu', 1 / kerner),
            netInd: serie(ts, 'network.0.bandwidth.in'),
            netUd: serie(ts, 'network.0.bandwidth.out'),
            diskLaes: serie(ts, 'disk.0.bandwidth.read'),
            diskSkriv: serie(ts, 'disk.0.bandwidth.write')
        }
    };
}

// /proc/meminfo → { total, tilgaengelig } i bytes (MemAvailable: hvad der kan
// bruges uden at skubbe noget ud — fri hukommelse alene tæller cachen som brugt)
function laesMeminfo(tekst) {
    const kb = (navn) => {
        const m = new RegExp(`^${navn}:\\s+(\\d+) kB`, 'm').exec(tekst);
        return m ? Number(m[1]) * 1024 : null;
    };
    const total = kb('MemTotal');
    const tilgaengelig = kb('MemAvailable') ?? kb('MemFree');
    return total ? { total, tilgaengelig } : null;
}

// Det, serveren selv kan se: containerens rodfilsystem ligger på serverens disk
function lokal() {
    let disk = null;
    try {
        const s = fs.statfsSync('/');
        disk = { total: s.blocks * s.bsize, ledig: s.bavail * s.bsize };
    } catch { /* ikke tilgængelig */ }
    let hukommelse = null;
    try {
        hukommelse = laesMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
    } catch { /* ikke Linux */ }
    if (!hukommelse) hukommelse = { total: os.totalmem(), tilgaengelig: os.freemem() };
    return {
        disk,
        hukommelse,
        belastning: os.loadavg(),
        kerner: os.cpus().length,
        oppetidSek: Math.round(os.uptime()),
        // Den fulde backup (alle databaser + billeder): seneste kørsel og gode dump
        fuldBackup: fuldBackup.status(),
        // Backend-processen: hvornår den startede, om opstarten lykkedes, og
        // databaser med migrationer, der fejlede
        backend: opstart.status(migrationRunner.status())
    };
}

// ── til ruten ──────────────────────────────────────────────

// { opsat, kilde, ulaeselig, opdateret, lokal, hetzner?, fejl?, vaelg? }
async function helbred(periode, nu = Date.now()) {
    const p = PERIODER[periode] || PERIODER['24t'];
    const o = await opsaetning();
    const svar = { opsat: !!o.token, kilde: o.kilde, ulaeselig: o.ulaeselig, opdateret: o.opdateret,
        periode: PERIODER[periode] ? periode : '24t', lokal: lokal() };
    if (!o.token) return svar;

    let serverId = o.serverId;
    if (!serverId) {
        try {
            const t = await tjek(o.token);
            if (!t.serverId) return { ...svar, vaelg: t.servere };
            serverId = t.serverId;
            await vaelgServer(serverId);
        } catch (e) {
            return { ...svar, fejl: e.message };
        }
    }

    const noegle = `${serverId}:${svar.periode}`;
    const c = cache.get(noegle);
    if (c && nu - c.tid < CACHE_MS) return { ...svar, hetzner: c.data };
    try {
        const slut = new Date(nu);
        const start = new Date(nu - p.sek * 1000);
        const q = new URLSearchParams({ type: 'cpu,disk,network', start: start.toISOString(), end: slut.toISOString(), step: String(p.step) });
        const [{ server }, { metrics }] = await Promise.all([
            hent(o.token, `/servers/${serverId}`),
            hent(o.token, `/servers/${serverId}/metrics?${q}`)
        ]);
        const data = omform(server, metrics);
        cache.set(noegle, { tid: nu, data });
        return { ...svar, hetzner: data };
    } catch (e) {
        if (e.status === 404) {
            // Serveren findes ikke (mere) i projektet — find den igen næste gang
            await masterDb.query('DELETE FROM indstillinger WHERE noegle = ?', [SERVER]);
        }
        return { ...svar, fejl: e.message };
    }
}

module.exports = { opsaetning, gem, vaelgServer, fjern, tjek, helbred, omform, laesMeminfo, serie, PERIODER, HetznerFejl };
