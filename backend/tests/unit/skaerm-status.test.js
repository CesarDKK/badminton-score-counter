/**
 * Unit-tests af skærm-registret (fjernstatus for TV'er) — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { registrer, liste, fjern, rensHaendelse, _nulstil, MAX_SKAERME } = require('../../screens/skaermStatus');

const NU = 1_800_000_000_000;
const meta = { tokenId: 7, ip: '203.0.113.5' };

beforeEach(() => _nulstil());

test('første livstegn registrerer skærmen med navn, bane og link', () => {
    const r = registrer('lyngby', { klientId: 'abc123', navn: 'tv-bane-1a', bane: 1, version: '45' }, meta, NU);
    assert.equal(r.ny, true);
    const [s] = liste('lyngby', NU + 5000);
    assert.equal(s.navn, 'tv-bane-1a');
    assert.equal(s.bane, 1);
    assert.equal(s.tokenId, 7);
    assert.equal(s.ip, '203.0.113.5');
    assert.equal(s.sekunderSiden, 5);
});

test('Badminton TV-PC\'ens version og sidetype gemmes; ugyldig version ignoreres', () => {
    registrer('lyngby', { klientId: 'abc123', kioskVersion: '2026.10.21', side: 'oversigt' }, meta, NU);
    registrer('lyngby', { klientId: 'def456', kioskVersion: '<b>2026</b>' }, meta, NU);
    registrer('lyngby', { klientId: 'ghi789', kioskVersion: '2026.10.13-abc1234' }, meta, NU);
    const pr = Object.fromEntries(liste('lyngby', NU).map(s => [s.klientId, s]));
    assert.equal(pr.abc123.kioskVersion, '2026.10.21');
    assert.equal(pr.abc123.side, 'oversigt');
    assert.equal(pr.def456.kioskVersion, '');
    assert.equal(pr.def456.side, 'tv');
    assert.equal(pr.ghi789.kioskVersion, '2026.10.13-abc1234');
});

test('to skærme på samme link holdes adskilt på klient-id', () => {
    registrer('lyngby', { klientId: 'skaerm-a1', navn: 'tv-bane-1a', bane: 1 }, meta, NU);
    registrer('lyngby', { klientId: 'skaerm-b2', navn: 'tv-bane-1b', bane: 1 }, meta, NU + 1000);
    const l = liste('lyngby', NU + 2000);
    assert.deepEqual(l.map(s => s.navn), ['tv-bane-1b', 'tv-bane-1a']); // senest set først
});

test('klubber ser ikke hinandens skærme', () => {
    registrer('lyngby', { klientId: 'abc123' }, meta, NU);
    assert.equal(liste('gladsaxe', NU).length, 0);
});

test('ugyldigt klient-id afvises', () => {
    assert.equal(registrer('lyngby', { klientId: '<script>' }, meta, NU), null);
    assert.equal(registrer('lyngby', { klientId: 'ab' }, meta, NU), null);
    assert.equal(liste('lyngby', NU).length, 0);
});

test('hændelser gemmes nyeste først og returneres i tidsorden til logning', () => {
    const r = registrer('lyngby', {
        klientId: 'abc123',
        haendelser: [
            { type: 'frys', fra: NU - 200000, sek: 45 },
            { type: 'net', fra: NU - 90000, til: NU - 10000 }
        ]
    }, meta, NU);
    assert.deepEqual(r.nye.map(h => h.type), ['frys', 'net']);
    assert.equal(r.nye[1].sek, 80);
    assert.deepEqual(liste('lyngby', NU)[0].haendelser.map(h => h.type), ['net', 'frys']);
});

test('ugyldige hændelser filtreres fra', () => {
    assert.equal(rensHaendelse({ type: 'frys', fra: NU, sek: 0 }, NU), null);
    assert.equal(rensHaendelse({ type: 'net', fra: NU, til: NU - 1 }, NU), null);
    assert.equal(rensHaendelse({ type: 'hack', fra: NU }, NU), null);
    assert.equal(rensHaendelse({ type: 'frys', fra: 'igår', sek: 5 }, NU), null);
});

test('højst 20 hændelser pr. skærm', () => {
    for (let i = 0; i < 5; i++) {
        registrer('lyngby', {
            klientId: 'abc123',
            haendelser: Array.from({ length: 10 }, (_, j) => ({ type: 'frys', fra: NU - 1000 * (i * 10 + j), sek: 2 }))
        }, meta, NU);
    }
    assert.equal(liste('lyngby', NU)[0].haendelser.length, 20);
});

test('en skærm der har været tavs i over 2 minutter meldes tilbage', () => {
    registrer('lyngby', { klientId: 'abc123' }, meta, NU);
    assert.equal(registrer('lyngby', { klientId: 'abc123' }, meta, NU + 20000).tilbageEfterSek, null);
    assert.equal(registrer('lyngby', { klientId: 'abc123' }, meta, NU + 20000 + 300000).tilbageEfterSek, 300);
});

test('skærme der ikke er set i et døgn glemmes', () => {
    registrer('lyngby', { klientId: 'abc123' }, meta, NU);
    assert.equal(liste('lyngby', NU + 25 * 3600 * 1000).length, 0);
});

test('samme navn på samme link erstatter den gamle række (skærmen er startet forfra)', () => {
    registrer('lyngby', { klientId: 'gammel-id1', navn: 'tv-bane-1a', bane: 1 }, meta, NU);
    registrer('lyngby', { klientId: 'andet-link', navn: 'tv-bane-1a', bane: 1 }, { tokenId: 8, ip: '' }, NU);
    registrer('lyngby', { klientId: 'ny-id2', navn: 'tv-bane-1a', bane: 1 }, meta, NU + 60000);
    const l = liste('lyngby', NU + 61000);
    assert.deepEqual(l.map(s => s.klientId).sort(), ['andet-link', 'ny-id2']);
});

test('advarsler fra før en genstart følger med til den nye række', () => {
    registrer('lyngby', { klientId: 'gammel-id1', navn: 'tv-bane-2a', haendelser: [{ type: 'frys', fra: NU - 5000, sek: 30 }] }, meta, NU);
    registrer('lyngby', { klientId: 'ny-id2', navn: 'tv-bane-2a' }, meta, NU + 120000);
    const [s] = liste('lyngby', NU + 121000);
    assert.equal(s.klientId, 'ny-id2');
    assert.equal(s.haendelser.length, 1);
    assert.equal(s.haendelser[0].sek, 30);
});

test('skærme uden navn erstattes ikke af hinanden', () => {
    registrer('lyngby', { klientId: 'uden-navn1' }, meta, NU);
    registrer('lyngby', { klientId: 'uden-navn2' }, meta, NU);
    assert.equal(liste('lyngby', NU).length, 2);
});

test('advarsler vises kun den første time efter de sluttede', () => {
    registrer('lyngby', { klientId: 'abc123', haendelser: [
        { type: 'frys', fra: NU - 10000, sek: 8 },
        { type: 'net', fra: NU - 95000, til: NU - 2000 }
    ] }, meta, NU);
    assert.equal(liste('lyngby', NU + 30 * 60000)[0].haendelser.length, 2);
    assert.equal(liste('lyngby', NU + 61 * 60000)[0].haendelser.length, 0);
});

test('korte huller i forbindelsen (under et minut) vises ikke som advarsel', () => {
    registrer('lyngby', { klientId: 'abc123', haendelser: [
        { type: 'net', fra: NU - 40000, til: NU - 20000 },
        { type: 'net', fra: NU - 200000, til: NU - 110000 }
    ] }, meta, NU);
    const h = liste('lyngby', NU)[0].haendelser;
    assert.equal(h.length, 1);
    assert.equal(h[0].sek, 90);
});

test('admin kan fjerne en skærm', () => {
    registrer('lyngby', { klientId: 'abc123' }, meta, NU);
    assert.equal(fjern('lyngby', 'abc123'), true);
    assert.equal(fjern('lyngby', 'abc123'), false);
    assert.equal(fjern('anden-klub', 'abc123'), false);
    assert.equal(liste('lyngby', NU).length, 0);
});

test('loft over antal skærme pr. klub', () => {
    for (let i = 0; i < MAX_SKAERME; i++) registrer('lyngby', { klientId: `skaerm-${i}` }, meta, NU);
    assert.equal(registrer('lyngby', { klientId: 'en-for-mange' }, meta, NU), null);
    assert.equal(liste('lyngby', NU).length, MAX_SKAERME);
});

// ── Hvad serveren selv ser: startet forfra / væk ──

const lb = (klientId, sideStartet, ekstra = {}) => ({ klientId, navn: 'tv-bane-1a', bane: 1, sideStartet, ...ekstra });

test('siden startet forfra efter et hul = genstart (PC/browser genstartet eller frosset)', () => {
    registrer('lyngby', lb('abc123', NU - 3600000), meta, NU);
    // 3 min uden livstegn, så en ny side (ny timeOrigin)
    const r = registrer('lyngby', lb('abc123', NU + 170000), meta, NU + 180000);
    assert.deepEqual(r.nye.map(h => h.type), ['genstart']);
    assert.equal(r.nye[0].fra, NU);
    assert.equal(r.nye[0].til, NU + 180000);
    assert.equal(r.nye[0].sek, 180);
    assert.equal(liste('lyngby', NU + 180000)[0].haendelser[0].type, 'genstart');
});

test('genstart med ny browserprofil (nyt klient-id, samme navn) ses også', () => {
    registrer('lyngby', lb('gammel-id1', NU - 3600000), meta, NU);
    const r = registrer('lyngby', lb('ny-id2', NU + 80000), meta, NU + 90000);
    assert.deepEqual(r.nye.map(h => h.type), ['genstart']);
    assert.equal(r.nye[0].sek, 90);
});

test('en genindlæsning (ny version) med få sekunders hul er ikke en genstart', () => {
    registrer('lyngby', lb('abc123', NU - 3600000), meta, NU);
    const r = registrer('lyngby', lb('abc123', NU + 15000), meta, NU + 20000);
    assert.deepEqual(r.nye, []);
});

test('væk og tilbage af sig selv (samme side) — men ikke når TV\'et selv har meldt net-hullet', () => {
    registrer('lyngby', lb('abc123', NU - 3600000), meta, NU);
    const vaek = registrer('lyngby', lb('abc123', NU - 3600000), meta, NU + 300000);
    assert.deepEqual(vaek.nye.map(h => h.type), ['vaek']);
    assert.equal(vaek.nye[0].sek, 300);

    const meldt = registrer('lyngby', lb('abc123', NU - 3600000, {
        haendelser: [{ type: 'net', fra: NU + 300000, til: NU + 600000 }]
    }), meta, NU + 600000);
    assert.deepEqual(meldt.nye.map(h => h.type), ['net']);
});

test('et hul på over 4 timer er en slukket skærm (natten), ikke et udfald', () => {
    registrer('lyngby', lb('abc123', NU - 3600000), meta, NU);
    const r = registrer('lyngby', lb('abc123', NU + 8 * 3600000), meta, NU + 8 * 3600000 + 10000);
    assert.deepEqual(r.nye, []);
});

test('første livstegn efter en server-genstart giver ingen hændelse', () => {
    const r = registrer('lyngby', lb('abc123', NU - 60000), meta, NU);
    assert.deepEqual(r.nye, []);
});
