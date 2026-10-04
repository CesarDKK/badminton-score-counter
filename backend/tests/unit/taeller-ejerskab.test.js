/**
 * Unit-tests af "kun én tæller ad gangen pr. bane" — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AKTIV_SEK, rensId, rensNavn, maaGemme, status, kraev, kortId } = require('../../taeller/ejerskab');

const NU = 1_800_000_000_000;
const TABLET = 'tablet-aaaaaaaa';
const TELEFON = 'telefon-bbbbbbbb';
const sek = s => new Date(NU - s * 1000);

const raekke = (felter = {}) => ({
    taeller_id: TABLET, taeller_navn: 'Tablet', taeller_set_at: sek(5),
    forrige_taeller_id: null, forrige_taeller_navn: null, ...felter
});

test('ny bane uden række eller tæller: alle må gemme, banen er ledig', () => {
    assert.equal(maaGemme(null, TELEFON, NU), true);
    assert.equal(maaGemme({ taeller_id: null }, TELEFON, NU), true);
    assert.deepEqual(status(null, TELEFON, NU), { ejer: false, ledig: true, taeller: null, overtagetFraDig: false });
});

test('tælleren selv må gemme og er ejer', () => {
    const r = raekke();
    assert.equal(maaGemme(r, TABLET, NU), true);
    const s = status(r, TABLET, NU);
    assert.equal(s.ejer, true);
    assert.equal(s.ledig, false);
    assert.equal(s.taeller, null);
});

test('en anden enhed må ikke gemme, mens tælleren er aktiv — og ser hvem der tæller', () => {
    const r = raekke();
    assert.equal(maaGemme(r, TELEFON, NU), false);
    const s = status(r, TELEFON, NU);
    assert.equal(s.ejer, false);
    assert.equal(s.ledig, false);
    assert.equal(s.taeller.navn, 'Tablet');
    assert.equal(s.taeller.aktiv, true);
    assert.equal(s.overtagetFraDig, false);
});

test(`tæller uden lyd i over ${AKTIV_SEK} s (tablet løbet tør): banen er ledig igen`, () => {
    const r = raekke({ taeller_set_at: sek(AKTIV_SEK + 1) });
    assert.equal(maaGemme(r, TELEFON, NU), true);
    assert.equal(status(r, TELEFON, NU).ledig, true);
    const lige = raekke({ taeller_set_at: sek(AKTIV_SEK) });
    assert.equal(maaGemme(lige, TELEFON, NU), false);
});

test('gemninger uden tæller-id (admin, ældre sider) spærres aldrig', () => {
    assert.equal(maaGemme(raekke(), null, NU), true);
});

test('overtagelse husker hvem der tællede, så den kan få besked og tage tilbage', () => {
    const f = kraev(raekke(), TELEFON, 'Telefon (QR-kode)');
    assert.equal(f.taeller_id, TELEFON);
    assert.equal(f.forrige_taeller_id, TABLET);
    assert.equal(f.forrige_taeller_navn, 'Tablet');
    assert.equal(f.overtaget, true);

    // Tabletten spørger: den er overtaget fra, af telefonen
    const efter = raekke({ taeller_id: TELEFON, taeller_navn: 'Telefon (QR-kode)', taeller_set_at: sek(1),
        forrige_taeller_id: TABLET, forrige_taeller_navn: 'Tablet' });
    const s = status(efter, TABLET, NU);
    assert.equal(s.ejer, false);
    assert.equal(s.overtagetFraDig, true);
    assert.equal(s.taeller.navn, 'Telefon (QR-kode)');
    assert.equal(maaGemme(efter, TABLET, NU), false);

    // ...og tager den tilbage
    const tilbage = kraev(efter, TABLET, 'Tablet');
    assert.equal(tilbage.taeller_id, TABLET);
    assert.equal(tilbage.forrige_taeller_id, TELEFON);
});

test('tælleren der fortsætter, bevarer forrige (ingen ny overtagelse)', () => {
    const r = raekke({ forrige_taeller_id: TELEFON, forrige_taeller_navn: 'Telefon' });
    const f = kraev(r, TABLET, 'Tablet');
    assert.equal(f.overtaget, false);
    assert.equal(f.forrige_taeller_id, TELEFON);
});

test('en afsluttet kamp har ingen aktiv tæller — næste kamp kan startes fra en anden enhed', () => {
    const r = raekke({ match_completed: 1 });
    assert.equal(maaGemme(r, TELEFON, NU), true);
    assert.equal(status(r, TELEFON, NU).ledig, true);
    assert.equal(status(r, TABLET, NU).ejer, true);
});

test('id og navn renses; kortId afslører kun starten', () => {
    assert.equal(rensId('abc'), null);
    assert.equal(rensId('ok-id_12345'), 'ok-id_12345');
    assert.equal(rensId('<script>alert(1)</script>'), null);
    assert.equal(rensId(42), null);
    assert.equal(rensNavn('  Tablet\n'), 'Tablet');
    assert.equal(rensNavn('x'.repeat(300)).length, 100);
    assert.equal(rensNavn(''), null);
    assert.equal(kortId(TABLET), 'tablet-a');
    assert.equal(kortId(null), null);
});
