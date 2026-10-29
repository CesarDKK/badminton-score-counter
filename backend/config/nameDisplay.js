/**
 * Visningsnavnene — samme fil som TV'et og oversigten bruger
 * (frontend/js/name-display.js), så streamens overlay korter navne af på
 * samme måde: fornavn, forbogstav ved sammenfald.
 *
 * I containeren kopieres filen til /app/shared af Dockerfile.backend; i repoet
 * (unit-tests og CI) læses den direkte fra frontend/js.
 */
let nameDisplay;
try {
    nameDisplay = require('../shared/name-display');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    nameDisplay = require('../../frontend/js/name-display');
}

module.exports = nameDisplay;
