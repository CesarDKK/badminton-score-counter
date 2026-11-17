/**
 * Pakke S — nr. 21 (fire små sikkerhedsting). Den fulde afprøvning mod rigtig
 * MySQL ligger i tests/integration/ (nr. 56); her de hurtige vagter.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROD = path.join(__dirname, '..', '..', '..');
const laes = (f) => fs.readFileSync(path.join(ROD, f), 'utf8').replace(/\r\n/g, '\n');

// ── 21d: QR-kodens link (match_session) er ikke en TV-PC ──
test('21d: PC-endepunkterne slår kun links op, der ikke er QR-kodens (match_session)', () => {
    const screens = laes('backend/routes/screens.js');
    const pcLink = screens.slice(screens.indexOf('async function pcLink'), screens.indexOf("router.post('/pc-rapport'"));
    assert.match(pcLink, /FROM device_tokens WHERE token = \? AND is_active = 1\s+AND COALESCE\(token_type, 'permanent'\) <> 'match_session'/);
    // pc-rapport, pc-opdatering, pc-fejllog/spoerg og pc-fejllog går alle gennem pcLink
    for (const rute of ["'/pc-rapport'", "'/pc-opdatering'", "'/pc-fejllog/spoerg'"]) {
        const i = screens.indexOf(`router.post(${rute}`);
        assert.ok(i > 0, rute);
        assert.match(screens.slice(i, i + 200), /await pcLink\(req, res\)/, rute);
    }
    assert.match(screens, /async function fejllogAdgang[\s\S]{0,120}await pcLink\(req, res\)/);

    const ls = laes('backend/routes/livestream.js');
    const pc = ls.slice(ls.indexOf("router.post('/pc'"), ls.indexOf("router.post('/pc'") + 1200);
    assert.match(pc, /FROM device_tokens WHERE token = \? AND is_active = 1\s+AND COALESCE\(token_type, 'permanent'\) <> 'match_session'/);
    // Heartbeat (JWT) afviste allerede QR-sessionen
    assert.match(screens, /req\.user\.tokenType === 'match_session'\) \{\s+return res\.status\(403\)/);
});

// ── 21a: Livestream har sin egen side-rettighed ──
test('21a: livestream er en side-nøgle i backend, admin og super-admin, og migration 053 bevarer adgangen', () => {
    const sa = laes('backend/routes/superAdmin.js');
    assert.match(sa, /const VALID_PAGE_KEYS = \[[^\]]*'livestream'[^\]]*\];/);
    const ls = laes('backend/routes/livestream.js');
    const vagt = ls.slice(ls.indexOf('const livestreamAdmin'), ls.indexOf('const baneNr'));
    assert.match(vagt, /requirePage\('livestream'\)/);
    assert.doesNotMatch(vagt, /requirePage\('devicetokens'\)/);
    // Adgangslinks og skærmene følger stadig devicetokens
    assert.match(laes('backend/routes/deviceTokens.js'), /requirePage\('devicetokens'\)/);
    assert.match(laes('backend/routes/screens.js'), /requirePage\('devicetokens'\)/);

    const html = laes('frontend/admin.html');
    assert.match(html, /id="livestreamBtn"[^>]*data-page="livestream"/);
    assert.match(laes('frontend/admin-script.js'), /hash === '#livestream' && canAccess\('livestream'\)/);
    assert.match(laes('frontend/super-admin-script.js'), /\{ key: 'livestream', label: 'Livestream' \}/);

    const mig = laes('backend/migrations/053_livestream_side.sql');
    assert.match(mig, /JSON_ARRAY_APPEND\(page_permissions, '\$', 'livestream'\)/);
    assert.match(mig, /JSON_CONTAINS\(page_permissions, '"devicetokens"'\)/);
    assert.match(mig, /NOT JSON_CONTAINS\(page_permissions, '"livestream"'\)/);
    // club_admins er ikke i backuppen — en gendannelse kører ikke migrationen igen
    assert.ok(!require('../../config/klubBackup').BACKUP_TABLES.includes('club_admins'));
});

test('21a: super-admin og admin-siden henter de nye filer (cache-versioner)', () => {
    const v = (html, fil) => {
        const i = html.indexOf(fil + '?v=');
        return i < 0 ? NaN : parseInt(html.slice(i + fil.length + 3), 10);
    };
    assert.ok(v(laes('frontend/admin.html'), 'admin-script.js') >= 122);
    assert.ok(v(laes('frontend/super-admin.html'), 'super-admin-script.js') >= 44);
});
