/**
 * Unit-tests af sponsorbilledernes filstier (config/sponsorFiler.js) — ingen server,
 * ingen database; filerne skrives i en midlertidig mappe.
 *
 * Før slettede "Slet billede" den sti, der stod i kolonnen file_path — og den kunne
 * komme fra en uploadet backup. En gendannet række med file_path '/app/server.js'
 * eller en anden klubs billede fik serveren til at slette den fil.
 *
 * Kør: npm run test:unit
 */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sponsor-'));
process.env.UPLOAD_DIR = TMP;
const {
    UPLOAD_DIR, klubMappe, sponsorFilSti, backupFilnavn, tilpasSponsorRaekker, hentSponsorFiler, skrivSponsorFiler
} = require('../../config/sponsorFiler');
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('klubMappe: klubbens db-navn, ellers local', () => {
    assert.equal(klubMappe({ clubDbName: 'lyngby' }), 'lyngby');
    assert.equal(klubMappe({}), 'local');
});

test('sponsorFilSti: klubbens egen fil giver en sti i klubbens mappe', () => {
    assert.equal(sponsorFilSti('lyngby', 'lyngby/sponsor_1_ab.jpg'), path.join(UPLOAD_DIR, 'lyngby', 'sponsor_1_ab.jpg'));
});

test('sponsorFilSti: en anden klubs fil, stier ud af mappen og ikke-billeder giver null', () => {
    for (const navn of [
        'gentofte/sponsor.jpg',          // anden klub
        '../gentofte/sponsor.jpg',
        'lyngby/../gentofte/x.jpg',
        'lyngby/../../server.js',
        '/app/server.js',
        'lyngby/server.js',              // ikke et billede
        'lyngby/sub/x.jpg',
        'sponsor.jpg',                   // uden klubmappe
        'lyngby/',
        null,
    ]) {
        assert.equal(sponsorFilSti('lyngby', navn), null, String(navn));
    }
});

test('backupFilnavn: rent filnavn eller <mappe>/<fil> fra ældre backups — ellers null', () => {
    assert.equal(backupFilnavn('sponsor.png'), 'sponsor.png');
    assert.equal(backupFilnavn('local/sponsor.png'), 'sponsor.png');
    for (const navn of ['../x.png', 'a/b/x.png', '../../app/server.js', 'x.html', 'a b.png', '..png/x.png']) {
        assert.equal(backupFilnavn(navn), null, navn);
    }
});

test('tilpasSponsorRaekker: rækkerne peges ind i DENNE klubs mappe, og file_path sættes af os', () => {
    const raekker = [
        { id: 1, filename: 'gentofte/a.jpg', file_path: '/app/server.js' },
        { id: 2, filename: 'b.png', file_path: '/app/uploads/gentofte/b.png' },
        { id: 3, filename: 'lyngby/c.webp' },
    ];
    assert.equal(tilpasSponsorRaekker(raekker, 'lyngby'), null);
    assert.deepEqual(raekker, [
        { id: 1, filename: 'lyngby/a.jpg', file_path: path.join(UPLOAD_DIR, 'lyngby', 'a.jpg') },
        { id: 2, filename: 'lyngby/b.png', file_path: path.join(UPLOAD_DIR, 'lyngby', 'b.png') },
        { id: 3, filename: 'lyngby/c.webp' },
    ]);
});

test('tilpasSponsorRaekker: et filnavn, der ikke er et billede, afviser hele gendannelsen', () => {
    assert.match(tilpasSponsorRaekker([{ filename: 'lyngby/../../server.js' }], 'lyngby'), /Ugyldigt filnavn/);
    assert.match(tilpasSponsorRaekker([{ filename: 'x.html' }], 'lyngby'), /Ugyldigt filnavn/);
    assert.equal(tilpasSponsorRaekker(undefined, 'lyngby'), null);
});

test('backup → gendannelse: billederne kommer med og ender i klubbens mappe', () => {
    fs.mkdirSync(path.join(UPLOAD_DIR, 'lyngby'), { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, 'lyngby', 'a.jpg'), 'billede-a');
    const filer = hentSponsorFiler([{ filename: 'lyngby/a.jpg' }, { filename: 'lyngby/mangler.jpg' }, { filename: 'gentofte/x.jpg' }], 'lyngby');
    assert.deepEqual(Object.keys(filer), ['a.jpg']);

    assert.equal(skrivSponsorFiler(filer, 'holte'), 1);
    assert.equal(fs.readFileSync(path.join(UPLOAD_DIR, 'holte', 'a.jpg'), 'utf8'), 'billede-a');
    // Ældre backup-nøgle med mappe skrives også i klubbens mappe
    skrivSponsorFiler({ 'local/b.png': Buffer.from('b').toString('base64') }, 'holte');
    assert.ok(fs.existsSync(path.join(UPLOAD_DIR, 'holte', 'b.png')));
    assert.ok(!fs.existsSync(path.join(UPLOAD_DIR, 'local')));
});
