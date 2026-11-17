/**
 * Pakke S, nr. 21c: scripts/ensure-env.sh finder aldrig på en ny JWT_SECRET
 * (eller MySQL-kode) til en eksisterende installation, og den eksisterende
 * installation med .env på plads går altid lige igennem.
 *
 * Scriptet køres i en midlertidig mappe med en falsk docker (volumes og
 * containere fra filer) og en falsk openssl på PATH — ingen rigtig Docker,
 * container eller volume røres.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROD = path.join(__dirname, '..', '..', '..');
const HAR_SH = process.platform !== 'win32' && spawnSync('sh', ['-c', 'exit 0']).status === 0;
const skip = !HAR_SH && 'kræver sh (kører i CI og i Docker)';

function miljoe({ env = null, volume = false, containere = {}, ingenDocker = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-env-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(ROD, 'scripts', 'ensure-env.sh'), path.join(dir, 'scripts', 'ensure-env.sh'));
    const bin = path.join(dir, 'bin');
    const falsk = path.join(dir, 'falsk');
    fs.mkdirSync(bin);
    fs.mkdirSync(path.join(falsk, 'c'), { recursive: true });
    fs.writeFileSync(path.join(falsk, 'volumes'), volume ? 'badminton-app_mysql_data\nandet_volume\n' : 'andet_volume\n');
    for (const [navn, vars] of Object.entries(containere)) {
        const linjer = ['PATH=/usr/bin', ...Object.entries(vars).map(([k, v]) => `${k}=${v}`)];
        fs.writeFileSync(path.join(falsk, 'c', navn), linjer.join('\n') + '\n');
    }
    const docker = ingenDocker
        ? ['#!/bin/sh', 'echo "docker: kan ikke nås" >&2', 'exit 127']
        : ['#!/bin/sh',
            `if [ "$1" = volume ]; then cat "${falsk}/volumes"; exit 0; fi`,
            `if [ "$1" = inspect ]; then [ -f "${falsk}/c/$2" ] || exit 1; cat "${falsk}/c/$2"; exit 0; fi`,
            'exit 1'];
    fs.writeFileSync(path.join(bin, 'docker'), docker.join('\n') + '\n', { mode: 0o755 });
    // openssl rand -hex N → 2N hex-tegn
    fs.writeFileSync(path.join(bin, 'openssl'),
        '#!/bin/sh\nhead -c "$3" /dev/urandom | od -An -tx1 | tr -d " \\n"\n', { mode: 0o755 });
    if (env !== null) fs.writeFileSync(path.join(dir, '.env'), env);

    const envSti = path.join(dir, '.env');
    return {
        koer: (ekstra = {}) => spawnSync('sh', [path.join(dir, 'scripts', 'ensure-env.sh')], {
            encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, NY_JWT_SECRET: '', ...ekstra }
        }),
        envFil: () => (fs.existsSync(envSti) ? fs.readFileSync(envSti, 'utf8') : null),
        vaerdi(navn) { return ((this.envFil() || '').match(new RegExp(`^${navn}=(.*)$`, 'm')) || [])[1]; },
        rester: () => fs.readdirSync(dir).filter(f => f.startsWith('.env.ensure')),
        ryd: () => fs.rmSync(dir, { recursive: true, force: true }),
    };
}

const KOMPLET = [
    'MYSQL_ROOT_PASSWORD=rod-i-env',
    'MYSQL_PASSWORD=bruger-i-env',
    'JWT_SECRET=jwt-i-env-0123456789abcdef0123456789',
    'FOOTBALL_DB_PASSWORD=fb-i-env',
    'FOOTBALL_JWT_SECRET=fbjwt-i-env',
    'YOUTUBE_CLIENT_ID=noget-andet',
].join('\n') + '\n';
const CONTAINERE = {
    'badminton-mysql': { MYSQL_ROOT_PASSWORD: 'rod-i-container', MYSQL_PASSWORD: 'bruger-i-container' },
    'badminton-backend': { JWT_SECRET: 'jwt-i-container' },
    'football-backend': { DB_PASSWORD: 'fb-i-container', JWT_SECRET: 'fbjwt-i-container' },
};

test('21c: den eksisterende installation (.env på plads) går lige igennem — .env er byte for byte uændret', { skip }, () => {
    for (const forhold of [
        { volume: true, containere: CONTAINERE },   // som i prod
        { volume: true },                           // containerne er væk
        { volume: true, ingenDocker: true },        // docker kan ikke engang nås
    ]) {
        const m = miljoe({ env: KOMPLET, ...forhold });
        try {
            const r = m.koer();
            assert.equal(r.status, 0, r.stderr + r.stdout);
            assert.equal(m.envFil(), KOMPLET);
            assert.doesNotMatch(r.stderr + r.stdout, /STOP|genereret|genskabt/);
            assert.match(r.stdout, /uændret\.?\s*$/);
            assert.deepEqual(m.rester(), []);
        } finally { m.ryd(); }
    }
});

test('21c: frisk installation (ingen database, ingen containere) får alle fem værdier', { skip }, () => {
    const m = miljoe({});
    try {
        const r = m.koer();
        assert.equal(r.status, 0, r.stderr + r.stdout);
        for (const n of ['MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'JWT_SECRET', 'FOOTBALL_DB_PASSWORD', 'FOOTBALL_JWT_SECRET']) {
            assert.match(m.vaerdi(n) || '', /^[0-9a-f]{48,}$/, n);
        }
        assert.equal(m.vaerdi('JWT_SECRET').length, 64);
        assert.deepEqual(m.rester(), []);
        // Anden kørsel: uændret
        const foer = m.envFil();
        assert.equal(m.koer().status, 0);
        assert.equal(m.envFil(), foer);
    } finally { m.ryd(); }
});

test('21c: .env væk, databasen findes og containerne er væk → STOP, og intet ændres', { skip }, () => {
    const m = miljoe({ volume: true });
    try {
        const r = m.koer();
        assert.equal(r.status, 1);
        assert.match(r.stderr, /STOP/);
        assert.match(r.stderr, /Intet er ændret/);
        assert.equal(m.envFil(), null, 'ingen .env oprettet');
        assert.deepEqual(m.rester(), []);
    } finally { m.ryd(); }
});

test('21c: kun JWT_SECRET mangler, databasen findes, backend-containeren er væk → STOP på JWT_SECRET, .env uændret', { skip }, () => {
    const udenJwt = KOMPLET.replace(/^JWT_SECRET=.*\n/m, '');
    const m = miljoe({ env: udenJwt, volume: true });
    try {
        const r = m.koer();
        assert.equal(r.status, 1);
        assert.match(r.stderr, /STOP: JWT_SECRET mangler/);
        assert.match(r.stderr, /NY_JWT_SECRET=ja/);
        assert.equal(m.envFil(), udenJwt);
        assert.deepEqual(m.rester(), []);

        // Bevidst ny nøgle: kun JWT_SECRET tilføjes, resten urørt
        const ja = m.koer({ NY_JWT_SECRET: 'ja' });
        assert.equal(ja.status, 0, ja.stderr);
        assert.match(m.vaerdi('JWT_SECRET'), /^[0-9a-f]{64}$/);
        assert.equal(m.envFil().replace(/^JWT_SECRET=.*\n/m, ''), udenJwt);
    } finally { m.ryd(); }
});

test('21c: .env væk, men containerne findes → værdierne genskabes præcist (ingen ny nøgle)', { skip }, () => {
    const m = miljoe({ volume: true, containere: CONTAINERE });
    try {
        const r = m.koer();
        assert.equal(r.status, 0, r.stderr);
        assert.equal(m.vaerdi('JWT_SECRET'), 'jwt-i-container');
        assert.equal(m.vaerdi('MYSQL_ROOT_PASSWORD'), 'rod-i-container');
        assert.equal(m.vaerdi('MYSQL_PASSWORD'), 'bruger-i-container');
        assert.equal(m.vaerdi('FOOTBALL_JWT_SECRET'), 'fbjwt-i-container');
        assert.doesNotMatch(r.stdout, /genereret/);
    } finally { m.ryd(); }
});

test('21c: en tom "JWT_SECRET=" i .env behandles som manglende (genskabes fra containeren)', { skip }, () => {
    const tom = KOMPLET.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=');
    const m = miljoe({ env: tom, volume: true, containere: CONTAINERE });
    try {
        const r = m.koer();
        assert.equal(r.status, 0, r.stderr);
        assert.equal(m.vaerdi('JWT_SECRET'), 'jwt-i-container');
        assert.equal((m.envFil().match(/^JWT_SECRET=/gm) || []).length, 1);
    } finally { m.ryd(); }
});

test('21c: deploy.sh kører stadig ensure-env.sh før containerne, og stopper når den stopper (set -e)', () => {
    const d = fs.readFileSync(path.join(ROD, 'deploy.sh'), 'utf8');
    assert.match(d, /^set -eu$/m);
    assert.ok(d.indexOf('sh scripts/ensure-env.sh') > 0);
    assert.ok(d.indexOf('sh scripts/ensure-env.sh') < d.indexOf('docker compose up'));
});
