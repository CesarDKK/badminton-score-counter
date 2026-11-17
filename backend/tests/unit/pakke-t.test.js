/**
 * Pakke T — nr. 58c (multer 2.x). Den fulde afprøvning af hver upload-rute
 * mod den kørende backend ligger i tests/integration/80-upload.test.js; her de
 * hurtige vagter.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8');

test('58c: backenden bruger multer 2.x (package.json og lock), og 1.x-afhængighederne er væk', () => {
    const pkg = JSON.parse(laes('backend/package.json'));
    assert.match(pkg.dependencies.multer, /^\^2\./);
    const lock = JSON.parse(laes('backend/package-lock.json'));
    assert.equal(lock.packages[''].dependencies.multer, pkg.dependencies.multer);
    assert.match(lock.packages['node_modules/multer'].version, /^2\./);
    for (const gammel of ['concat-stream', 'mkdirp', 'xtend']) {
        assert.equal(lock.packages[`node_modules/${gammel}`], undefined, `${gammel} (kun brugt af multer 1.x)`);
    }
    assert.match(require('multer/package.json').version, /^2\./, 'den installerede multer');
});

test('58c: maerkUploadFejl mærker klientens fejl — ikke diskfejl eller fejl med status', () => {
    const { maerkUploadFejl } = require('../../config/tenantPools');
    const { MulterError } = require('multer');
    const busboy = new Error('Unexpected end of form');
    const multerFejl = new MulterError('MISSING_FIELD_NAME');
    const disk = Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC', syscall: 'write' });
    const raw = Object.assign(new Error('request aborted'), { status: 400, statusCode: 400 });
    const type = Object.assign(new Error('Kun JPEG, PNG, GIF eller WebP er tilladt'), { status: 400 });
    for (const e of [busboy, multerFejl, disk, raw, type]) maerkUploadFejl(e);
    maerkUploadFejl(undefined);
    assert.equal(busboy.uploadFejl, true);
    assert.equal(multerFejl.uploadFejl, true);
    assert.equal(disk.uploadFejl, undefined);
    assert.equal(raw.uploadFejl, undefined);
    assert.equal(type.uploadFejl, undefined);
});

function svar(err) {
    const { errorHandler } = require('../../middleware/errorHandler');
    const res = { kode: null, krop: null, status(k) { this.kode = k; return this; }, json(b) { this.krop = b; return this; } };
    const log = console.error;
    console.error = () => {};
    try { errorHandler(err, {}, res, () => {}); } finally { console.error = log; }
    return { status: res.kode, error: res.krop.error };
}

test('58c: fejlhåndteringen — for stor fil som før, ødelagt upload og forkert type giver 400, diskfejl stadig 500', () => {
    const { MulterError } = require('multer');
    const { maerkUploadFejl } = require('../../config/tenantPools');
    const maerket = (e) => { maerkUploadFejl(e); return e; };

    // Samme statuskode og besked som med multer 1.x
    assert.deepEqual(svar(maerket(new MulterError('LIMIT_FILE_SIZE', 'images'))), { status: 400, error: 'Filen er for stor. Maksimum 10MB.' });
    assert.deepEqual(svar(maerket(new MulterError('LIMIT_FILE_COUNT'))), { status: 400, error: 'For mange filer. Maksimum 10 filer ad gangen.' });
    assert.deepEqual(svar(maerket(new MulterError('LIMIT_UNEXPECTED_FILE', 'x'))), { status: 400, error: 'Uventet fil felt.' });

    // Før: 500 med busboys engelske tekst
    for (const e of [new Error('Unexpected end of form'), new Error('Multipart: Boundary not found'), new MulterError('MISSING_FIELD_NAME'), new Error('Request aborted')]) {
        const s = svar(maerket(e));
        assert.equal(s.status, 400, e.message);
        assert.match(s.error, /^Uploaden kunne ikke læses/);
    }

    // Forkert filtype: 400 med beskeden (før 500)
    const { billedFileFilter } = require('../../config/imageUpload');
    let typeFejl;
    billedFileFilter({}, { mimetype: 'text/html' }, (e) => { typeFejl = e; });
    assert.deepEqual(svar(maerket(typeFejl)), { status: 400, error: 'Kun JPEG, PNG, GIF eller WebP er tilladt' });

    // En diskfejl under upload er serverens: stadig 500
    const disk = maerket(Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES', syscall: 'open' }));
    assert.equal(svar(disk).status, 500);
});

test('58c: multer-konfigurationernes lofter er hele tal (multer 2.x afviser andet ved opstart)', () => {
    process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || require('os').tmpdir();
    // Indlæsningen kaster TypeError, hvis et loft ikke er et ikke-negativt heltal
    assert.doesNotThrow(() => require('../../config/multer'));
    assert.doesNotThrow(() => require('../../config/logoUpload'));
    const compose = laes('docker-compose.yml');
    assert.match(compose, /MAX_FILE_SIZE: 10485760\b/, 'prod-loftet er et heltal i bytes');
});
