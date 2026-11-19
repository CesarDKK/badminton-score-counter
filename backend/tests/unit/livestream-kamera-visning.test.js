/**
 * Unit-tests af kameravisningen på TV'et (screens/livestream.js): admin viser
 * banens kamera på TV'et i 5 minutter; mens browseren har kameraet, sender
 * PC'en ikke, og efter visningen venter streamen et par sekunder, så browseren
 * har sluppet kameraet.
 *
 * Kør: npm run test:unit
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const ls = require('../../screens/livestream');

const NU = 1_800_000_000_000;
const T = 'klub_test';

beforeEach(() => ls._nulstilStatus());

test('rensStatus: kameravisningen kun med kameraVisning === true, navn og USB-id renses', () => {
    const s = ls.rensStatus({ kameraVisning: true, kameraKort: 'Lenovo 500 RGB Camera', kameraUsb: '17ef:4831' });
    assert.equal(s.kanVise, true);
    assert.equal(s.kameraKort, 'Lenovo 500 RGB Camera');
    assert.equal(s.kameraUsb, '17ef:4831');
    const gammel = ls.rensStatus({});
    assert.equal(gammel.kanVise, false);
    assert.equal(gammel.kameraKort, null);
    assert.equal(gammel.kameraUsb, null);
    assert.equal(ls.rensStatus({ kameraVisning: 'ja', kameraUsb: '17EF:4831; rm' }).kanVise, false);
    assert.equal(ls.rensStatus({ kameraUsb: '17ef:4831x' }).kameraUsb, null);
});

test('visningen varer 5 minutter og glemmes, når browseren har sluppet kameraet', () => {
    const til = ls.startVisning(T, 7, 'tv3', NU);
    assert.equal(til, NU + ls.VISNING_MS);
    assert.deepEqual(ls.visning(T, 7, NU + 1000), { til, navn: 'tv3' });
    assert.equal(ls.visningHolderKamera(T, 7, NU + 1000), true);
    // Udløbet af sig selv: ingen visning, men kameraet er stadig hos browseren lidt endnu
    assert.equal(ls.visning(T, 7, til), null);
    assert.equal(ls.visningHolderKamera(T, 7, til + ls.VISNING_FRIGIV_MS - 1), true);
    assert.equal(ls.visningHolderKamera(T, 7, til + ls.VISNING_FRIGIV_MS), false);
    // Andre PC'er og klubber er uberørte
    assert.equal(ls.visning(T, 8, NU), null);
    assert.equal(ls.visning('anden_klub', 7, NU), null);
});

test('stopVisning: lukker med det samme, og streamen venter VISNING_FRIGIV_MS', () => {
    ls.startVisning(T, 7, 'tv3', NU);
    assert.equal(ls.stopVisning(T, 7, NU + 10_000), true);
    assert.equal(ls.visning(T, 7, NU + 10_000), null);
    assert.equal(ls.visningHolderKamera(T, 7, NU + 10_000 + ls.VISNING_FRIGIV_MS - 1), true);
    assert.equal(ls.visningHolderKamera(T, 7, NU + 10_000 + ls.VISNING_FRIGIV_MS), false);
    // Intet at lukke: false (ingen besked til TV'et)
    assert.equal(ls.stopVisning(T, 7, NU + 20_000), false);
    assert.equal(ls.stopVisning(T, 99, NU), false);
});

test('en ny visning efter en lukket starter forfra', () => {
    ls.startVisning(T, 7, 'tv3', NU);
    ls.stopVisning(T, 7, NU + 1000);
    const til = ls.startVisning(T, 7, 'tv3', NU + 2000);
    assert.deepEqual(ls.visning(T, 7, NU + 3000), { til, navn: 'tv3' });
});

test('visningSpaerret: grunden til admin', () => {
    const klar = { online: true, kamera: 'Brio', kanVise: true, sender: false };
    assert.equal(ls.visningSpaerret(klar), null);
    assert.match(ls.visningSpaerret(null), /meldt/);
    assert.match(ls.visningSpaerret({ ...klar, online: false }), /meldt/);
    assert.match(ls.visningSpaerret({ ...klar, kamera: null }), /intet USB-kamera/);
    assert.match(ls.visningSpaerret({ ...klar, kanVise: false }), /nyere Badminton TV/);
    assert.match(ls.visningSpaerret({ ...klar, sender: true }), /sender lige nu/);
    // Banen skal sendes, eller PC'en venter på, at browseren slipper kameraet
    assert.match(ls.visningSpaerret({ ...klar, skalSende: true }), /skal sendes nu/);
    assert.match(ls.visningSpaerret({ ...klar, grund: 'kamera-visning' }), /skal sendes nu/);
    assert.equal(ls.visningSpaerret({ ...klar, grund: 'ingen-kamp', skalSende: false }), null);
});

test('visningTilTv: kamera, streamens format, vending og overlay', () => {
    const v = { til: NU + 90_500, navn: 'tv3' };
    const s = { kamera: 'Lenovo 500 RGB Camera', kameraKort: 'Lenovo 500 RGB Camera', kameraUsb: '17ef:4831' };
    const indst = ls.laesIndstillinger({ oploesning: 1080, billeder: 30, placering: 'bund-hoejre', stoerrelse: 'stor' });
    const tv = ls.visningTilTv({ v, s, indst, opsaetning: { flip_180: 1, mirror: 0, overlay: 1, logo: 'sponsor' }, bane: 3, nu: NU });
    assert.equal(tv.aktiv, true);
    assert.equal(tv.sekunder, 91);
    assert.equal(tv.navn, 'tv3');
    assert.deepEqual(tv.kamera, { navn: 'Lenovo 500 RGB Camera', kort: 'Lenovo 500 RGB Camera', usb: '17ef:4831' });
    assert.equal(tv.video.bredde, 1920);
    assert.equal(tv.video.hoejde, 1080);
    assert.equal(tv.video.vend, true);
    assert.equal(tv.video.spejl, false);
    assert.equal(tv.video.placering, 'bund-hoejre');
    assert.equal(tv.video.stoerrelse, 'stor');
    assert.equal(tv.bane, 3);
    assert.equal(tv.overlay, true);
    assert.equal(tv.logo, true);
    // Uden bane (eller opsætning): standard — overlay til, intet logo
    const uden = ls.visningTilTv({ v, s: null, indst: ls.laesIndstillinger(null), opsaetning: null, bane: null, nu: NU });
    assert.equal(uden.overlay, true);
    assert.equal(uden.logo, false);
    assert.deepEqual(uden.kamera, { navn: null, kort: null, usb: null });
    assert.equal(ls.visningTilTv({ v, s, indst, opsaetning: { overlay: 0, logo: 'ingen' }, bane: 1, nu: NU }).logo, false);
});
