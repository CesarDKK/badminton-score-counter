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
