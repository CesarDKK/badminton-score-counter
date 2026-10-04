/**
 * Holdkamp-formater og opstillingsregler — samme fil som frontenden bruger
 * (frontend/js/holdkamp-formater.js), så reglerne kun findes ét sted.
 *
 * I containeren kopieres filen til /app/shared af Dockerfile.backend; i repoet
 * (unit-tests og CI) læses den direkte fra frontend/js.
 */
let formater;
try {
    formater = require('../shared/holdkamp-formater');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    formater = require('../../frontend/js/holdkamp-formater');
}

/**
 * Formatet ud fra delkampene på en holdseddel fra badmintonplayer.dk.
 *
 * Ungdomsformaterne 4 spillere og U9 3 spillere hedder Single/Double ("1. S",
 * "1. D"), mens 4 piger hedder DS/DD ("1. DS", "1. DD") — derfor genkendes de
 * på, at der KUN er single- og double-kategorier (ingen MD/HS/HD).
 */
function detectFormat(games) {
    const cats = (games || []).map(g => g.category);
    const n = cats.length;
    const cnt = c => cats.filter(x => x === c).length;
    const ungdom = n > 0 && cats.every(c => ['Single', 'Double', 'DS', 'DD'].includes(c));
    if (ungdom) {
        const doubler = cats.filter(c => formater.erDouble(c)).length;
        const singler = n - doubler;
        if (singler === 4 && doubler === 2) return '4spillere';
        if (singler === 4 && doubler === 4) return '4spillere8';
        if (singler === 4 && doubler === 1) return 'u9_3spillere';
        return 'imported';
    }
    if (n === 11) return 'liga11';
    if (n === 13) return '13kamps';
    if (n === 9)  return '4plus3';
    if (n === 8 && cnt('MD') >= 2 && cnt('DS') >= 2) return '2plus2';
    if (n === 8 && cnt('MD') === 1 && cnt('DS') === 1) return '4plus2';
    return 'imported';
}

module.exports = { ...formater, detectFormat };
