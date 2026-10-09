// Fase C (designkritikken 2026-10-09): problemerne i tre niveauer, og opskriften til TP i trin 4
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { niveauFor } from '../../src/ui/tjek.js';
import { opskriftPanel } from '../../src/ui/opsaetning.js';

describe('Problemer: tre niveauer', () => {
    test('fejl skal rettes, ventetid og lodtrækningen er til orientering, resten bør ses', () => {
        assert.equal(niveauFor({ alvor: 'fejl', type: 'kapacitet' }), 'skal');
        assert.equal(niveauFor({ alvor: 'advarsel', type: 'lang-ventetid' }), 'orientering');
        assert.equal(niveauFor({ alvor: 'advarsel', type: 'form' }), 'orientering');
        assert.equal(niveauFor({ alvor: 'info', type: 'uden-tid' }), 'orientering');
        assert.equal(niveauFor({ alvor: 'advarsel', type: 'raekke-tidsrum' }), 'boer');
        assert.equal(niveauFor({ alvor: 'advarsel', type: 'pause' }), 'boer');
    });
});

describe('Til TP: opskriften til lodtrækningen', () => {
    test('vises kun, når planneren selv har bygget kampe', () => {
        const p = { kategorier: [{ id: 'U11 D HS', formValg: 'tp' }], tilmeldinger: {} };
        assert.equal(opskriftPanel(p), '');
        const egen = { kategorier: [{ id: 'U11 D HS', formValg: 'swiss', formForslag: { tekst: 'Swiss Ladder, 5 runder', kampe: 10, baneSlots: 10, minKampe: 5, maxKampe: 5, opfylderKrav: true, krav: 4 } }], tilmeldinger: { 'U11 D HS': [1, 2, 3, 4] } };
        assert.match(opskriftPanel(egen), /opskrift til lodtrækningen i TP/i);
        assert.match(opskriftPanel(egen), /Swiss Ladder, 5 runder/);
    });
});
