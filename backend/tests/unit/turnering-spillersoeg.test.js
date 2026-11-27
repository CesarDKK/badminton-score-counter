/**
 * Turneringens navnefelter i admin ("Tilføj kamp" og "Rediger"): søg turneringens
 * egne spillere frem (med klub og logo) i stedet for at taste hele navnet — fx når
 * Tournament Software ikke har sat spillerne på en kvartfinale. Fri indtastning
 * virker stadig.
 *
 * Funktionerne hentes ud af admin-script.js og køres i en vm-sandkasse.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8').replace(/\r/g, '');

function udsnit(kilde, fra, til) {
    const a = kilde.indexOf(fra);
    assert.ok(a >= 0, `markøren findes: ${fra}`);
    const b = kilde.indexOf(til, a + fra.length);
    assert.ok(b > a, `slutmarkøren findes: ${til}`);
    return kilde.slice(a, b);
}

const k = (id, label, a, b, a2, b2) => ({
    id, label, doubles: a2 ? 1 : 0,
    side1_player1: a, side1_player2: a2 || null, side2_player1: b, side2_player2: b2 || null
});

function sandkasse(labelVaerdi) {
    const kilde = laes('frontend/admin-script.js');
    const kode = udsnit(kilde, '// Rækken: label uden runde', '// Spillere i en igangværende turneringskamp');
    const LogoMatch = require(path.join(ROD, 'frontend/js/logo-match.js'));
    const klubber = {
        'filippa winther': 'Gentofte', 'vilda østergaard flies': 'Gentofte',
        'oliver nørgaard': 'Drive', 'lucas ørum': 'Drive', 'magnus holm': 'Valby'
    };
    const ctx = {
        LogoMatch,
        window: { LogoMatch },
        document: { getElementById: (id) => (id === 'lbl' ? { value: labelVaerdi } : null) },
        _adminClubByName: klubber,
        _adminPlayerLogos: [],
        _adminLogoCache: [
            { id: 1, club_name: 'Drive', url: '/logos/drive.png' },
            { id: 2, club_name: 'Gentofte', url: '/logos/gentofte.png' }
        ],
        sidsteTurneringer: [{
            id: 7,
            matches: [
                k(1, 'U15 B DS - Pulje 4 — Runde 1', 'Filippa Winther', 'Isabella Victoria Jensen'),
                k(2, 'U15 B DS - Pulje 5 — Runde 1', 'Vilda Østergaard Flies', 'Ella Andersen'),
                k(3, 'U15 B HS - Pulje 1 — Runde 1', 'Oliver Nørgaard [1]', 'Magnus Holm'),
                k(4, 'U15 B HS - Pulje 2 — Runde 1', 'Lucas Ørum', 'Oliver Nørgaard [1]'),
                k(5, 'U15 B HS — Kvartfinale', '', '?'),
                k(6, 'U15 B MD - Pulje 1 — Runde 1', 'Lucas Ørum', 'Emil Kjær', 'Magnus Holm', 'Noah Bæk')
            ]
        }]
    };
    vm.createContext(ctx);
    vm.runInContext(kode + '\nthis.f = turneringSpillerForslag;', ctx);
    // JSON-kopi: arrays fra sandkassen er fra en anden realm
    return (term) => JSON.parse(JSON.stringify(ctx.f(7, term, 'lbl')));
}

test('tomt felt: kun spillerne fra kampens egen række, med klub og logo', () => {
    const f = sandkasse('U15 B HS — Kvartfinale');
    const res = f('');
    assert.deepEqual(res.map(r => r.name), ['Lucas Ørum', 'Magnus Holm', 'Oliver Nørgaard [1]']);
    const oliver = res.find(r => r.name.startsWith('Oliver'));
    assert.equal(oliver.logoUrl, '/logos/drive.png');
    assert.match(oliver.info, /^Drive · U15 B HS$/);
    // Magnus' klub (Valby) har intet logo i testen
    assert.equal(res.find(r => r.name === 'Magnus Holm').logoUrl, null);
    // Lucas står i to rækker
    assert.match(res[0].info, /U15 B HS, U15 B MD|U15 B MD, U15 B HS/);
});

test('rækken findes også uden " — " i labelen, og uden label vises intet før der skrives', () => {
    assert.equal(sandkasse('U15 B HS kvartfinale')('').length, 3);
    assert.equal(sandkasse('')('').length, 0);
});

test('søgning på navn uden ø/accenter og på klub; rækkens spillere først', () => {
    const f = sandkasse('U15 B DS — Semifinale');
    assert.deepEqual(f('oster').map(r => r.name), ['Vilda Østergaard Flies']);
    assert.deepEqual(f('drive').map(r => r.name), ['Lucas Ørum', 'Oliver Nørgaard [1]']);
    // "gentofte" rammer to DS-spillere; "a" rammer mange — DS-rækken står først
    const a = f('a').map(r => r.name);
    const ds = ['Ella Andersen', 'Filippa Winther', 'Isabella Victoria Jensen', 'Vilda Østergaard Flies'];
    assert.deepEqual(a.slice(0, ds.length).sort(), ds.slice().sort());
});

test('hver spiller én gang, seed-mærket bevares, tomme pladser og "?" er ikke spillere', () => {
    const navne = sandkasse('')('e').map(r => r.name).concat(sandkasse('')('o').map(r => r.name));
    assert.equal(new Set(navne).size, new Set(navne.map(n => n.replace(/\s*\[.*\]$/, ''))).size);
    assert.ok(navne.includes('Oliver Nørgaard [1]'));
    assert.ok(!navne.some(n => n === '?' || n === ''));
    // Makkeren i doublen er også med
    assert.deepEqual(sandkasse('')('noah').map(r => r.name), ['Noah Bæk']);
});

test('begge formularer bruger turneringens spillere; listen lukker når man går til næste felt', () => {
    const kilde = laes('frontend/admin-script.js');
    assert.match(kilde, /setupPlayerNameAutocomplete\(inputId,\s*\(term\) => turneringSpillerForslag\(t\.id, term, `t\$\{t\.id\}_label`\)\)/);
    assert.match(kilde, /setupPlayerNameAutocomplete\(inputId,\s*\(term\) => turneringSpillerForslag\(t\.id, term, `te_\$\{m\.id\}_label`\)\)/);
    const opsaet = udsnit(kilde, 'function setupPlayerNameAutocomplete(', 'async function searchPlayers(');
    assert.match(opsaet, /if \(document\.activeElement !== input\)/);
    // Fri indtastning: intet i opsætningen låser feltet til listen
    assert.doesNotMatch(opsaet, /readonly|input\.value = ''/);
});

test('filtrene over kamplisten lukker ikke af opdateringen hvert 3. sek.', () => {
    const kilde = laes('frontend/admin-script.js');
    const hent = udsnit(kilde, 'async function loadActiveTournaments(', 'function renderTournamentBlocker(');
    // Enhver fokuseret valgliste i turneringen (bane, række, status) stopper genoptegningen
    assert.match(hent, /active\.tagName === 'SELECT'\)\) \{\s*return;/);
    // og filtrene slipper selv fokus efter et valg, så opdateringen fortsætter
    assert.match(kilde, /filter\[noegle\] = el\.value;\s*el\.blur\(\);/);
});
