/**
 * Unit-tests af nr. 99: TV-PC'en melder en fejlet eller tilbagerullet
 * automatisk opdatering som skærm-hændelse (opd-fejl / opd-tilbage) i sin
 * rapport, og admin viser den ved PC'en — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { rensRapport, indenforLoft, _nulstil, TYPER, MAX_PR_TIME, MAX_LOG } = require('../../screens/pcRapport');

const NU = 1_800_000_000_000;
const FRONTEND = path.join(__dirname, '../../../frontend');
const laes = (f) => fs.readFileSync(path.join(FRONTEND, f), 'utf8');

beforeEach(() => _nulstil());

test('opd-fejl og opd-tilbage tages imod med tekst og log', () => {
    const r = rensRapport({
        navn: 'tv-bane-2', kioskVersion: '2026.11.3', haendelser: [
            { type: 'opd-fejl', fra: NU - 60000, tekst: 'Den automatiske opdatering fejlede: signaturen passer ikke', log: '== Den automatiske opdatering ==\nFEJL: …' },
            { type: 'opd-tilbage', fra: NU - 30000, tekst: 'Version 2026.11.4 startede ikke rigtigt (forsøg 1 af 3) — kører 2026.11.3 igen.' }
        ]
    }, NU);
    assert.deepEqual(r.haendelser.map(h => h.type), ['opd-fejl', 'opd-tilbage']);
    assert.match(r.haendelser[0].log, /Den automatiske opdatering/);
    assert.equal(r.haendelser[1].log, undefined);
    assert.ok(TYPER.has('opd-fejl') && TYPER.has('opd-tilbage'));
});

test('opd-hændelser holdes inden for de samme lofter (tekst, log, antal i timen)', () => {
    const r = rensRapport({
        navn: 'tv-bane-2', haendelser: [{ type: 'opd-fejl', fra: NU, tekst: 'x'.repeat(1000), log: 'y'.repeat(MAX_LOG + 500) }]
    }, NU);
    assert.equal(r.haendelser[0].tekst.length, 300);
    assert.ok(r.haendelser[0].log.length <= MAX_LOG + 20);
    // Loftet pr. adgangslink er uændret — opdateringen får ingen særbehandling
    assert.equal(MAX_PR_TIME, 30);
    assert.equal(indenforLoft('lyngby:3', MAX_PR_TIME, NU), true);
    assert.equal(indenforLoft('lyngby:3', 1, NU), false);
});

test('ukendte opd-typer afvises stadig', () => {
    assert.equal(rensRapport({ navn: 'tv-bane-2', haendelser: [{ type: 'opd-andet', fra: NU }] }, NU), null);
});

// Funktionen fra admin-script.js, kørt alene med de hjælpere, den bruger
function opdFejlFunktion(log) {
    const kilde = laes('admin-script.js');
    const start = kilde.indexOf('const OPD_HAENDELSER');
    const slut = kilde.indexOf('function renderSkaerme(');
    assert.ok(start > 0 && slut > start, 'skaermOpdateringFejlHtml findes før renderSkaerme');
    const ctx = {
        _skaermLog: log,
        skaermNoegle: (h) => h.navn,
        Ikon: () => '[!]',
        escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        skaermHaendelseTekst: (h) => h.tekst || h.type
    };
    vm.createContext(ctx);
    vm.runInContext(kilde.slice(start, slut) + '\nthis.f = skaermOpdateringFejlHtml;', ctx);
    return ctx.f;
}

test('admin: den seneste opd-hændelse fra de sidste 7 dage vises med rødt ved PC\'en', () => {
    const nu = Date.now();
    const f = opdFejlFunktion([
        { navn: 'tv-bane-2', type: 'opd-fejl', fra: new Date(nu - 3 * 3600e3).toISOString(), tekst: 'Ældre fejl' },
        { navn: 'tv-bane-2', type: 'opd-tilbage', fra: new Date(nu - 3600e3).toISOString(), tekst: 'Version <b>2026.11.4</b> gik tilbage' },
        { navn: 'tv-bane-2', type: 'pc-brat', fra: new Date(nu).toISOString(), tekst: 'Ikke en opdatering' },
        { navn: 'tv-bane-3', type: 'opd-fejl', fra: new Date(nu).toISOString(), tekst: 'En anden PC' }
    ]);
    const html = f('tv-bane-2', false);
    assert.match(html, /var\(--color-danger\)/);
    assert.match(html, /Version &lt;b&gt;2026\.11\.4&lt;\/b&gt; gik tilbage/, 'den seneste, og escaped');
    assert.doesNotMatch(html, /Ældre fejl|Ikke en opdatering|En anden PC/);
    assert.match(html, /visSkaermLog/);
    assert.equal(f('tv-bane-2', true), '', 'kører den nyeste version: intet at vise');
    assert.equal(f('tv-bane-1', false), '', 'ingen hændelser: intet');
});

test('admin: opd-hændelser ældre end 7 dage vises ikke ved PC\'en', () => {
    const f = opdFejlFunktion([
        { navn: 'tv-bane-2', type: 'opd-fejl', fra: new Date(Date.now() - 8 * 24 * 3600e3).toISOString(), tekst: 'Gammel' }
    ]);
    assert.equal(f('tv-bane-2', false), '');
});

test('admin og super-admin kender teksterne, super-admin har slags "Opdatering", og ?v= er hævet', () => {
    const admin = laes('admin-script.js');
    const superAdmin = laes('super-admin-script.js');
    for (const kilde of [admin, superAdmin]) {
        assert.match(kilde, /case 'opd-fejl':/);
        assert.match(kilde, /case 'opd-tilbage':/);
    }
    assert.match(superAdmin, /navn: 'opd', tekst: 'Opdatering', typer: \['opd-fejl', 'opd-tilbage'\]/);
    assert.match(admin, /skaermOpdateringFejlHtml\(noegle, paaNyeste\)/, 'renderSkaerme bruger den');
    // Mindst den version, rettelsen kom med (senere pakker hæver den)
    const v = (html, re) => Number((laes(html).match(re) || [])[1]);
    assert.ok(v('admin.html', /"admin-script\.js\?v=(\d+)/) >= 105);
    assert.ok(v('super-admin.html', /super-admin-script\.js\?v=(\d+)/) >= 40);
});
