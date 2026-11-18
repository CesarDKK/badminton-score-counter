/**
 * Nr. 110: hvert deploy genstartede backenden. Commit og byggetidspunkt lå i
 * backend-imaget (build-args → ENV), så imaget skiftede ved hvert deploy. Nu
 * skriver deploy.sh versionen i deploy-info/version.json, som er monteret
 * skrivebeskyttet i backenden, og backenden læser den ved hvert kald.
 *
 * deploy.sh køres her for alvor i en tom mappe med falske `docker` og `git`
 * på PATH (ingen containere, intet netværk).
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');
const { deployVersion } = require('../../config/hetzner');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-version-'));

// ---------- Backenden læser filen ----------

test('110: versionsfilen findes — commit og deploy-tidspunkt, renset som før', () => {
    const d = tmp(), f = path.join(d, 'version.json');
    fs.writeFileSync(f, JSON.stringify({ sha: '1f35ad3abcde+ændret', deployet: '2026-11-16T20:00:00Z' }));
    assert.deepEqual(deployVersion(f), { sha: '1f35ad3abcde+ændret', deployet: '2026-11-16T20:00:00.000Z' });
    fs.writeFileSync(f, JSON.stringify({ sha: '<script>alert(1)</script>', deployet: 'i går' }));
    assert.deepEqual(deployVersion(f), { sha: 'scriptalert1script', deployet: null });
    fs.writeFileSync(f, JSON.stringify({ sha: 'a'.repeat(100), deployet: 12345 }));
    assert.deepEqual(deployVersion(f), { sha: 'a'.repeat(40), deployet: null }, 'loft på 40 tegn; kun en tekst er et tidspunkt');
});

test('110: filen mangler, er tom eller ødelagt — "ukendt", aldrig en fejl', () => {
    const d = tmp(), f = path.join(d, 'version.json');
    const ukendt = { sha: 'ukendt', deployet: null };
    assert.deepEqual(deployVersion(f), ukendt, 'mangler (docker compose up uden deploy.sh)');
    assert.deepEqual(deployVersion(path.join(d, 'findes-ikke', 'version.json')), ukendt, 'mappen mangler');
    assert.deepEqual(deployVersion(d), ukendt, 'en mappe, hvor filen skulle være');
    for (const indhold of ['', '{', 'null', '"1f35ad3"', '[1,2]', '{"sha": 42}']) {
        fs.writeFileSync(f, indhold);
        assert.deepEqual(deployVersion(f), ukendt, `indhold ${JSON.stringify(indhold)}`);
    }
});

test('110: filen læses ved hvert kald — en ny version ses uden genstart', () => {
    const d = tmp(), f = path.join(d, 'version.json');
    fs.writeFileSync(f, JSON.stringify({ sha: 'aaaaaaaaaaaa', deployet: '2026-11-17T10:00:00Z' }));
    assert.equal(deployVersion(f).sha, 'aaaaaaaaaaaa');
    fs.writeFileSync(f + '.ny', JSON.stringify({ sha: 'bbbbbbbbbbbb', deployet: '2026-11-18T10:00:00Z' }));
    fs.renameSync(f + '.ny', f);   // som deploy.sh: ny fil, der erstatter den gamle
    assert.equal(deployVersion(f).sha, 'bbbbbbbbbbbb');
    // Standardstien er den monterede mappe
    assert.match(laes('backend/config/hetzner.js'), /'\/app\/deploy-info\/version\.json'/);
});

// ---------- Imaget og compose ----------

test('110: backend-imaget har ingen version/tidspunkt; deploy-info/ monteres skrivebeskyttet og er udenfor git og images', () => {
    const df = laes('Dockerfile.backend');
    assert.doesNotMatch(df, /^\s*(ARG|ENV)\b.*(GIT_SHA|BUILD_TIME)/m);
    assert.doesNotMatch(df, /^\s*COPY\b.*deploy-info/m, 'kopieres ikke ind');
    const compose = laes('docker-compose.yml');
    assert.doesNotMatch(compose, /GIT_SHA|BUILD_TIME/);
    const backend = compose.slice(compose.indexOf('\n  backend:'), compose.indexOf('\n  football-backend:'));
    assert.match(backend, /- \.\/deploy-info:\/app\/deploy-info:ro/);
    assert.equal((compose.match(/deploy-info:\/app/g) || []).length, 1, 'kun backenden');
    assert.match(laes('.gitignore'), /^deploy-info\/$/m);
    assert.match(laes('.dockerignore'), /^deploy-info$/m);
    // football-backend bygger på sin egen Dockerfile (football-app/)
    const fb = compose.slice(compose.indexOf('\n  football-backend:'));
    assert.match(fb, /context: \.\/football-app\s+dockerfile: Dockerfile\.backend/);
});

// ---------- deploy.sh for alvor (falske docker og git) ----------

// Kører deploy.sh i en tom mappe. `inspect` er det, `docker inspect` svarer før
// og efter "up" (tom = containeren findes ikke).
function koerDeploy({ foer = 'id1 2026-11-18T10:00:00Z', efter = foer, forbered } = {}) {
    const d = tmp();
    fs.copyFileSync(path.join(ROD, 'deploy.sh'), path.join(d, 'deploy.sh'));
    fs.mkdirSync(path.join(d, 'scripts'));
    fs.writeFileSync(path.join(d, 'scripts', 'ensure-env.sh'), 'exit 0\n');
    const bin = path.join(d, 'bin');
    fs.mkdirSync(bin);
    const svar = path.join(d, 'inspect-svar');
    fs.writeFileSync(svar, `${foer}\n${efter}\n`);
    // docker: inspect svarer linje for linje fra inspect-svar; alt andet lykkes
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
case "$1" in
  inspect)
    linje=$(head -n 1 "${svar}"); sed -i 1d "${svar}"
    [ -n "$linje" ] || exit 1
    echo "$linje" ;;
  compose) echo "docker compose $*" >> "${d}/kald" ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
case "$*" in
  *rev-parse*) echo 0123456789ab ;;
  *status*) echo "" ;;
esac
`, { mode: 0o755 });
    if (forbered) forbered(d);
    const r = spawnSync('sh', [path.join(d, 'deploy.sh')], {
        cwd: d, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }
    });
    return { d, status: r.status, ud: r.stdout + r.stderr };
}

test('110: deploy.sh skriver versionen i deploy-info/version.json, og backenden kan læse den', () => {
    const r = koerDeploy();
    assert.equal(r.status, 0, r.ud);
    const v = deployVersion(path.join(r.d, 'deploy-info', 'version.json'));
    assert.equal(v.sha, '0123456789ab');
    assert.ok(Date.now() - Date.parse(v.deployet) < 10 * 60 * 1000, `nu (${v.deployet})`);
    assert.ok(!fs.existsSync(path.join(r.d, 'deploy-info', 'version.json.ny')), 'ingen halv fil tilbage');
    assert.match(fs.readFileSync(path.join(r.d, 'kald'), 'utf8'), /compose up -d --build/);
    assert.doesNotMatch(r.ud, /bygget/);
});

test('110: kan versionen ikke skrives, fejler deployet IKKE — super-admin viser "ukendt"', () => {
    // deploy-info er en fil (ikke en mappe): hverken mkdir eller skrivning kan lykkes
    // (en mappe uden skriveret virker ikke som prøve, når testen kører som root)
    const r = koerDeploy({ forbered: (d) => fs.writeFileSync(path.join(d, 'deploy-info'), 'ikke en mappe') });
    assert.equal(r.status, 0, r.ud);
    assert.match(r.ud, /Advarsel: versionen kunne ikke skrives i deploy-info\//);
    assert.match(r.ud, /Deploy færdig: version 0123456789ab\./);
    assert.deepEqual(deployVersion(path.join(r.d, 'deploy-info', 'version.json')), { sha: 'ukendt', deployet: null });
});

test('110: deploy.sh siger, om backenden blev genstartet eller kørte videre', () => {
    const videre = koerDeploy({ foer: 'id1 2026-11-18T10:00:00Z' });
    assert.equal(videre.status, 0, videre.ud);
    assert.match(videre.ud, /Backenden kørte videre uden genstart/);
    const genstartet = koerDeploy({ foer: 'id1 2026-11-18T10:00:00Z', efter: 'id2 2026-11-18T11:00:00Z' });
    assert.match(genstartet.ud, /Backenden blev genstartet/);
    const ny = koerDeploy({ foer: '', efter: 'id1 2026-11-18T10:00:00Z' });
    assert.equal(ny.status, 0, ny.ud);
    assert.match(ny.ud, /Backenden blev startet \(den kørte ikke før\)/);
});

test('110: "+ændret" udløses ikke af versionsfilen (den er hverken sporet eller med i git status)', () => {
    const d = laes('deploy.sh');
    assert.match(d, /status --porcelain --untracked-files=no/);
    assert.match(laes('.gitignore'), /^deploy-info\/$/m);
    // Mappen oprettes før "up", så Docker ikke opretter den som root
    assert.ok(d.indexOf('mkdir -p deploy-info') < d.indexOf('docker compose up -d --build'));
});
