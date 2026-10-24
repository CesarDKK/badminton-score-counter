/**
 * Unit-tests af TV-PC'ens rapport (POST /api/screens/pc-rapport): validering,
 * skærmen i hændelsesloggen og loftet pr. adgangslink — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { rensRapport, skaermFor, gyldigtToken, indenforLoft, _nulstil, MAX_PR_TIME, MAX_LOG } = require('../../screens/pcRapport');

const NU = 1_800_000_000_000;
const rapport = (haendelser, ekstra = {}) => ({ navn: 'tv-bane-3', kioskVersion: '2026.10.25', haendelser, ...ekstra });

beforeEach(() => _nulstil());

test('en gyldig rapport renses og får varigheden regnet ud', () => {
    const r = rensRapport(rapport([
        { type: 'pc-brat', fra: NU - 600000, til: NU - 60000, tekst: 'Stoppede brat kl. 14.32', log: 'linje 1\nlinje 2' }
    ]), NU);
    assert.equal(r.navn, 'tv-bane-3');
    assert.equal(r.kioskVersion, '2026.10.25');
    assert.deepEqual(r.haendelser, [{
        type: 'pc-brat', fra: NU - 600000, til: NU - 60000, sek: 540,
        tekst: 'Stoppede brat kl. 14.32', log: 'linje 1\nlinje 2'
    }]);
});

test('ukendte typer og tidspunkter langt væk filtreres fra', () => {
    const r = rensRapport(rapport([
        { type: 'hack', fra: NU },
        { type: 'pc-knap', fra: NU - 40 * 24 * 3600 * 1000 },
        { type: 'browser-genstart', fra: NU - 1000, tekst: 'hjerteslaget stod stille' }
    ]), NU);
    assert.deepEqual(r.haendelser.map(h => h.type), ['browser-genstart']);
    assert.equal(r.haendelser[0].til, null);
    assert.equal(r.haendelser[0].sek, null);
});

test('slut før start (PC\'ens ur lidt bagud lige efter opstart): hændelsen beholdes uden slut', () => {
    // Set i VM-testen: "startet igen" lå 7 s før "slukket"
    const [h] = rensRapport(rapport([{ type: 'pc-knap', fra: NU, til: NU - 7000 }]), NU).haendelser;
    assert.equal(h.type, 'pc-knap');
    assert.equal(h.til, null);
    assert.equal(h.sek, null);
});

test('rapporten afvises uden gyldige hændelser, med forkert navn eller for mange hændelser', () => {
    assert.equal(rensRapport(rapport([{ type: 'hack', fra: NU }]), NU), null);
    assert.equal(rensRapport(rapport([{ type: 'pc-knap', fra: NU }], { navn: '<script>' }), NU), null);
    assert.equal(rensRapport(rapport(Array(11).fill({ type: 'pc-knap', fra: NU })), NU), null);
    assert.equal(rensRapport(null, NU), null);
});

test('en for lang log afkortes forfra — slutningen er den interessante', () => {
    const log = 'START' + 'x'.repeat(MAX_LOG + 100) + 'SLUT';
    const [h] = rensRapport(rapport([{ type: 'pc-brat', fra: NU, log }]), NU).haendelser;
    assert.ok(h.log.startsWith('… (afkortet)\n'));
    assert.ok(h.log.endsWith('SLUT'));
    assert.ok(!h.log.includes('START'));
});

test('ugyldig Badminton TV-version gemmes som tom', () => {
    assert.equal(rensRapport(rapport([{ type: 'pc-knap', fra: NU }], { kioskVersion: '<b>' }), NU).kioskVersion, '');
});

test('PC\'ens hændelser står under samme skærm som TV-sidens (navnet fra kiosk.conf)', () => {
    assert.deepEqual(skaermFor('tv-bane-3', { id: 7, destination: 'tv/3' }),
        { klientId: 'pc-tv-bane-3', navn: 'tv-bane-3', side: 'tv', bane: 3, tokenId: 7 });
    assert.equal(skaermFor('oversigt-hal', { id: 8, destination: 'oversigt' }).side, 'oversigt');
    assert.equal(skaermFor('oversigt-hal', { id: 8, destination: 'oversigt' }).bane, null);
});

test('kun adgangslink-tokens accepteres', () => {
    assert.equal(gyldigtToken('a'.repeat(64)), true);
    assert.equal(gyldigtToken('kort'), false);
    assert.equal(gyldigtToken("abc' OR 1=1 --"), false);
    assert.equal(gyldigtToken(undefined), false);
});

test('loft pr. adgangslink: højst MAX_PR_TIME hændelser i timen', () => {
    assert.equal(indenforLoft('lyngby:7', MAX_PR_TIME - 1, NU), true);
    assert.equal(indenforLoft('lyngby:7', 2, NU), false);
    assert.equal(indenforLoft('lyngby:7', 1, NU), true);
    assert.equal(indenforLoft('lyngby:8', 5, NU), true, 'et andet link har sit eget loft');
    assert.equal(indenforLoft('lyngby:7', 1, NU + 3600 * 1000 + 1), true, 'en time senere er der plads igen');
});
