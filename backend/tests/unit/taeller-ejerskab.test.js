/**
 * Unit-tests af "kun én tæller ad gangen pr. bane" — ingen server, ingen database.
 *
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AKTIV_SEK, rensId, rensNavn, kampIGang, optaget, maaGemme, status, kraev, kortId } = require('../../taeller/ejerskab');

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

test(`tæller uden lyd i over ${AKTIV_SEK} s, og ingen kamp i gang: banen er ledig igen`, () => {
    const r = raekke({ taeller_set_at: sek(AKTIV_SEK + 1) });
    assert.equal(maaGemme(r, TELEFON, NU), true);
    assert.equal(status(r, TELEFON, NU).ledig, true);
    const lige = raekke({ taeller_set_at: sek(AKTIV_SEK) });
    assert.equal(maaGemme(lige, TELEFON, NU), false);
});

test('midt i en kamp bliver banen ikke ledig af stilhed (uret i pausen, telefon med gammel 0-0-skærm)', () => {
    // Uret gav sidst lyd for 2 minutter siden — pausen mellem sæt
    const r = raekke({ taeller_id: 'ur-cccccccccccc', taeller_navn: 'Ur', taeller_set_at: sek(120),
        match_start_time: sek(900), match_completed: 0 });
    assert.equal(maaGemme(r, TELEFON, NU), false);
    const s = status(r, TELEFON, NU);
    assert.equal(s.ledig, false);            // telefonen går i "Ser med" og må trykke "Overtag"
    assert.equal(s.taeller.navn, 'Ur');
    assert.equal(s.taeller.aktiv, false);    // "har ikke givet lyd i et stykke tid" — ingen bekræftelse ved Overtag
    // Tælleren selv fortsætter bare
    assert.equal(maaGemme(r, 'ur-cccccccccccc', NU), true);
    assert.equal(status(r, 'ur-cccccccccccc', NU).ejer, true);
    // Også efter lang tid (skadespause)
    assert.equal(maaGemme({ ...r, taeller_set_at: sek(3600) }, TELEFON, NU), false);
});

test('kampen er ikke startet eller er slut: stilhed gør banen ledig som før', () => {
    const foerStart = raekke({ taeller_set_at: sek(120), match_start_time: null, match_completed: 0 });
    assert.equal(optaget(foerStart, NU), false);
    assert.equal(maaGemme(foerStart, TELEFON, NU), true);
    const slut = raekke({ taeller_set_at: sek(120), match_start_time: sek(900), match_completed: 1 });
    assert.equal(kampIGang(slut), false);
    assert.equal(maaGemme(slut, TELEFON, NU), true);
    assert.equal(status(slut, TELEFON, NU).ledig, true);
    // En startet kamp uden tæller (fx sat i gang fra admin) spærrer ingen
    assert.equal(maaGemme({ taeller_id: null, match_start_time: sek(900), match_completed: 0 }, TELEFON, NU), true);
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
