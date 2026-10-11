// Hvilket regelsæt planneren følger (regler.js: REGELSAET) — vises under "Reglementets grænser" og i sidefoden.
// Ved en ny udgave af reglementet: gennemgå teksten, ret tallene og reglement.test.js, og opdatér REGELSAET.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REGELSAET, regelsaetTekst } from '../../src/regler.js';
import { regelsaetBoks } from '../../src/ui/opsaetning.js';

describe('Regelsættet', () => {
    test('har sæson, gennemgangsdato og kilder fra badminton.dk', () => {
        assert.match(REGELSAET.saeson, /^\d{4}\/\d{2}$/);
        assert.match(REGELSAET.gennemgaaet, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(REGELSAET.kilder.length >= 3);
        for (const k of REGELSAET.kilder) assert.match(k.url, /^https:\/\/badminton\.dk\/.+\.pdf$/);
    });
    test('teksten til sidefoden og boksen i panelet', () => {
        assert.equal(regelsaetTekst(), 'Badminton Danmarks reglement, sæson 2026/27 (gennemgået 20/9-2026)');
        const html = regelsaetBoks();
        for (const k of REGELSAET.kilder) assert.ok(html.includes(k.url) && html.includes(k.udgave));
        assert.match(html, /rel="noopener noreferrer"/);
    });
});
