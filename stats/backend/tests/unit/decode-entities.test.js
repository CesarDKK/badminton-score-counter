/**
 * Unit-tests af HTML-entitets-afkodningen. Regression: &amp; skal afkodes SIDST,
 * ellers bliver "&amp;lt;" (teksten "&lt;") fejlagtigt til "<" i to trin.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { decodeEntities } = require('../../badmintonplayer');

test('almindelige entiteter', () => {
    assert.equal(decodeEntities('A&amp;B'), 'A&B');
    assert.equal(decodeEntities('&lt;tag&gt;'), '<tag>');
    assert.equal(decodeEntities('&quot;x&quot; &#39;y&#39; &apos;z&apos;'), '"x" \'y\' \'z\'');
    assert.equal(decodeEntities('a&nbsp;b'), 'a b');
});

test('ingen dobbelt-afkodning: &amp;lt; er teksten "&lt;", ikke "<"', () => {
    assert.equal(decodeEntities('&amp;lt;'), '&lt;');
    assert.equal(decodeEntities('&amp;amp;'), '&amp;');
});

test('numeriske og hex-entiteter, inkl. danske tegn', () => {
    assert.equal(decodeEntities('&#x26;'), '&');
    assert.equal(decodeEntities('&#230;&#248;&#229;'), 'æøå');
    assert.equal(decodeEntities('&#xE6;'), 'æ');
});

test('tekst uden entiteter er uændret', () => {
    assert.equal(decodeEntities('Lyngby 3'), 'Lyngby 3');
    assert.equal(decodeEntities(''), '');
});
