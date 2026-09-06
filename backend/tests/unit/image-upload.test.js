/**
 * Unit-tests af upload-valideringen: fil-endelse fra mimetype (ikke filnavn)
 * og magic-byte-tjek af indholdet. Lukker "evil.html forklædt som billede".
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { sikkerEndelse, erGyldigtBillede, validateImageMagic, billedFilnavn, billedFileFilter } = require('../../config/imageUpload');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9)]);
const GIF = Buffer.from('GIF89a\0\0\0\0\0\0', 'binary');
const WEBP = Buffer.from('RIFF\0\0\0\0WEBP', 'binary');
const HTML = Buffer.from('<script>alert(1)</script>', 'utf8');

test('erGyldigtBillede genkender PNG, JPEG, GIF og WebP', () => {
    assert.equal(erGyldigtBillede(PNG), true);
    assert.equal(erGyldigtBillede(JPEG), true);
    assert.equal(erGyldigtBillede(GIF), true);
    assert.equal(erGyldigtBillede(WEBP), true);
});

test('erGyldigtBillede afviser HTML/script, tomt og for kort indhold', () => {
    assert.equal(erGyldigtBillede(HTML), false);
    assert.equal(erGyldigtBillede(Buffer.alloc(0)), false);
    assert.equal(erGyldigtBillede(Buffer.from([0x89, 0x50])), false);
    assert.equal(erGyldigtBillede(null), false);
});

test('sikkerEndelse udleder endelse af mimetype — aldrig af filnavnet', () => {
    assert.equal(sikkerEndelse('image/png'), '.png');
    assert.equal(sikkerEndelse('image/jpeg'), '.jpg');
    assert.equal(sikkerEndelse('image/webp'), '.webp');
    assert.equal(sikkerEndelse('text/html'), null);
    assert.equal(sikkerEndelse('application/octet-stream'), null);
});

test('billedFilnavn: "evil.html" med mimetype image/png gemmes med .png', () => {
    const filnavn = billedFilnavn(crypto);
    let resultat;
    filnavn({}, { originalname: 'evil.html', mimetype: 'image/png' }, (err, navn) => { resultat = { err, navn }; });
    assert.equal(resultat.err, null);
    assert.match(resultat.navn, /\.png$/);
    assert.doesNotMatch(resultat.navn, /\.html/);
});

test('billedFilnavn afviser ukendt mimetype', () => {
    const filnavn = billedFilnavn(crypto);
    let resultat;
    filnavn({}, { originalname: 'x.png', mimetype: 'text/html' }, (err, navn) => { resultat = { err, navn }; });
    assert.ok(resultat.err instanceof Error);
});

test('billedFileFilter accepterer billeder og afviser andet', () => {
    let ok;
    billedFileFilter({}, { mimetype: 'image/gif' }, (err, accept) => { ok = accept; });
    assert.equal(ok, true);
    billedFileFilter({}, { mimetype: 'text/html' }, (err, accept) => { ok = accept; });
    assert.equal(ok, false);
});

test('validateImageMagic: afviser en fil der ikke er et billede og sletter ALLE uploadede filer', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
    const god = path.join(dir, 'god.png');
    const ond = path.join(dir, 'ond.png');   // rigtig endelse, forkert indhold
    fs.writeFileSync(god, PNG);
    fs.writeFileSync(ond, HTML);

    let status = 200, nexted = false;
    const res = { status(c) { status = c; return this; }, json() { return this; } };
    validateImageMagic({ files: [{ path: god }, { path: ond }] }, res, () => { nexted = true; });

    assert.equal(nexted, false);
    assert.equal(status, 400);
    assert.equal(fs.existsSync(god), false, 'den gode fil skal også ryddes op');
    assert.equal(fs.existsSync(ond), false);
    fs.rmSync(dir, { recursive: true, force: true });
});

test('validateImageMagic: lader rigtige billeder passere (req.file og req.files)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));
    const a = path.join(dir, 'a.jpg');
    const b = path.join(dir, 'b.webp');
    fs.writeFileSync(a, JPEG);
    fs.writeFileSync(b, WEBP);

    let nexted = 0;
    const res = { status() { return this; }, json() { return this; } };
    validateImageMagic({ files: [{ path: a }, { path: b }] }, res, () => { nexted++; });
    validateImageMagic({ file: { path: a } }, res, () => { nexted++; });

    assert.equal(nexted, 2);
    assert.equal(fs.existsSync(a), true);
    fs.rmSync(dir, { recursive: true, force: true });
});
