/**
 * Unit-tests af tidsplanen for den automatiske hentning af holdsedler.
 * Første tjek 59 min 50 sek før kampstart, hvert 30. sekund de første 10
 * minutter og derefter hvert 2. minut. Plus den fælles fartgrænse mod
 * badmintonplayer.dk.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vagt = require('../../config/holdkampVagt');

// Kamp kl. 15:00 dansk sommertid = 13:00Z. Frigives 12:00Z, første tjek 12:00:10Z.
const START = new Date('2026-10-03T13:00:00Z');
const t = (klokken) => new Date(`2026-10-03T${klokken}Z`);
const w = (sidst, start = START) => ({ start_time: start, last_checked_at: sidst });

test('første tjek i vinduet er 59 min 50 sek før kampstart', () => {
    assert.equal(vagt.foersteTjek(START).toISOString(), '2026-10-03T12:00:10.000Z');
    assert.equal(vagt.foersteTjek(null), null);
});

test('lige før første tjek er kampen ikke forfalden, i samme sekund er den', () => {
    const sidst = t('11:45:00'); // seneste genlæsning før vinduet
    assert.equal(vagt.erForfalden(w(sidst), t('12:00:09')), false);
    assert.equal(vagt.naesteTjek(w(sidst), t('12:00:09')).toISOString(), '2026-10-03T12:00:10.000Z');
    assert.equal(vagt.sekunderTilNaeste(w(sidst), t('12:00:09')), 1);
    assert.equal(vagt.erForfalden(w(sidst), t('12:00:10')), true);
});

test('de første 10 minutter tjekkes hvert 30. sekund på et fast gitter (:10 og :40)', () => {
    // Tjekket 12:00:10 → næste 12:00:40
    assert.equal(vagt.naesteTjek(w(t('12:00:10')), t('12:00:11')).toISOString(), '2026-10-03T12:00:40.000Z');
    assert.equal(vagt.erForfalden(w(t('12:00:10')), t('12:00:39')), false);
    assert.equal(vagt.erForfalden(w(t('12:00:10')), t('12:00:40')), true);
    // Et tjek der blev et par sekunder forsinket flytter ikke gitteret
    assert.equal(vagt.naesteTjek(w(t('12:00:43')), t('12:00:44')).toISOString(), '2026-10-03T12:01:10.000Z');
});

test('et manuelt tjek uden for gitteret flytter ikke næste automatiske tjek', () => {
    assert.equal(vagt.naesteTjek(w(t('12:00:27')), t('12:00:28')).toISOString(), '2026-10-03T12:00:40.000Z');
});

test('missede tjek (fx efter genstart) giver ét tjek straks, ikke en kø', () => {
    const efterNedetid = w(t('12:00:10'));
    assert.equal(vagt.erForfalden(efterNedetid, t('12:07:00')), true);
    // Når det tjek er taget (last_checked = 12:07:00), er næste det næste gitterpunkt
    assert.equal(vagt.naesteTjek(w(t('12:07:00')), t('12:07:01')).toISOString(), '2026-10-03T12:07:10.000Z');
});

test('kom linket ind efter vinduet åbnede, tjekkes der straks', () => {
    assert.equal(vagt.erForfalden(w(null), t('12:20:00')), true);
    assert.equal(vagt.sekunderTilNaeste(w(null), t('12:20:00')), 0);
});

test('før vinduet genlæses kamptidspunktet hvert 30. minut det sidste døgn', () => {
    assert.equal(vagt.naesteTjek(w(t('09:00:00')), t('09:10:00')).toISOString(), '2026-10-03T09:30:00.000Z');
    assert.equal(vagt.erForfalden(w(t('09:00:00')), t('09:29:59')), false);
    assert.equal(vagt.erForfalden(w(t('09:00:00')), t('09:30:00')), true);
    // ... men aldrig senere end vinduets første tjek
    assert.equal(vagt.naesteTjek(w(t('11:45:00')), t('11:50:00')).toISOString(), '2026-10-03T12:00:10.000Z');
});

test('mere end et døgn før start genlæses kun hver 6. time', () => {
    const omEnUge = new Date('2026-10-10T13:00:00Z');
    assert.equal(vagt.naesteTjek(w(t('09:00:00'), omEnUge), t('09:10:00')).toISOString(), '2026-10-03T15:00:00.000Z');
});

test('en kamp der flyttes frem får sit vindue på det nye tidspunkt', () => {
    // Stod til 17:00 dansk (15:00Z), genlæst 11:45Z: flyttet til 15:00 dansk (13:00Z).
    // Med den gamle tid var første tjek 14:00:10Z; med den nye er det 12:00:10Z.
    const gammel = new Date('2026-10-03T15:00:00Z');
    assert.equal(vagt.erForfalden(w(t('11:45:00'), gammel), t('12:00:10')), false);
    assert.equal(vagt.erForfalden(w(t('11:45:00'), START), t('12:00:10')), true);
});

test('uden kendt tidspunkt tjekkes hvert 5. minut', () => {
    const u = { start_time: null, last_checked_at: t('10:00:00') };
    assert.equal(vagt.naesteTjek(u, t('10:01:00')).toISOString(), '2026-10-03T10:05:00.000Z');
    assert.equal(vagt.erForfalden({ start_time: null, last_checked_at: null }, t('10:00:00')), true);
});

test('tidspunkter som strenge (fra databasen) accepteres også', () => {
    const s = { start_time: '2026-10-03T13:00:00Z', last_checked_at: '2026-10-03T12:00:10Z' };
    assert.equal(vagt.naesteTjek(s, t('12:00:11')).toISOString(), '2026-10-03T12:00:40.000Z');
});

test('efter 10 minutter trappes der ned til hvert 2. minut', () => {
    // Sidste hurtige tjek 12:09:40 → første langsomme 12:10:10
    assert.equal(vagt.naesteTjek(w(t('12:09:40')), t('12:09:41')).toISOString(), '2026-10-03T12:10:10.000Z');
    // Derefter 12:12:10, 12:14:10, ...
    assert.equal(vagt.naesteTjek(w(t('12:10:10')), t('12:10:11')).toISOString(), '2026-10-03T12:12:10.000Z');
    assert.equal(vagt.erForfalden(w(t('12:10:10')), t('12:12:09')), false);
    assert.equal(vagt.erForfalden(w(t('12:10:10')), t('12:12:10')), true);
    // Også efter kampstart, indtil der opgives 30 min efter
    assert.equal(vagt.naesteTjek(w(t('13:10:10')), t('13:10:11')).toISOString(), '2026-10-03T13:12:10.000Z');
    // Et manuelt tjek flytter heller ikke det langsomme gitter
    assert.equal(vagt.naesteTjek(w(t('12:11:00')), t('12:11:01')).toISOString(), '2026-10-03T12:12:10.000Z');
});

test('en kamp hvor holdsedlen aldrig kommer koster ca. 60 kald, ikke 180', () => {
    // Simulér hele vinduet: første tjek 12:00:10 til der opgives 13:30:00
    let sidst = t('11:45:00');
    let antal = 0;
    for (;;) {
        const naeste = vagt.naesteTjek(w(sidst), sidst);
        if (naeste > t('13:30:00')) break;
        sidst = naeste;
        antal++;
    }
    assert.equal(antal, 20 + 40); // 20 hurtige (10 min) + 40 langsomme (80 min)
});

test('fartgrænsen: samtidige kald til badmintonplayer spredes med mindst 500 ms', async () => {
    const { bpTur, BP_MIN_AFSTAND_MS } = require('../../routes/importHoldkamp');
    assert.equal(BP_MIN_AFSTAND_MS, 500);
    const t0 = Date.now();
    const tider = [];
    await Promise.all([1, 2, 3].map(() => bpTur().then(() => tider.push(Date.now() - t0))));
    tider.sort((a, b) => a - b);
    assert.ok(tider[0] < 200, `første kald skal gå igennem med det samme (${tider[0]} ms)`);
    assert.ok(tider[1] >= 450, `andet kald skal vente (${tider[1]} ms)`);
    assert.ok(tider[2] >= 950, `tredje kald skal vente to gange (${tider[2]} ms)`);
});
