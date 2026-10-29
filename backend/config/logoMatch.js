/**
 * Logo-matcheren — samme fil som TV'et og oversigten bruger
 * (frontend/js/logo-match.js), så streamens overlay viser de samme klublogoer.
 *
 * I containeren kopieres filen til /app/shared af Dockerfile.backend; i repoet
 * (unit-tests og CI) læses den direkte fra frontend/js.
 */
let logoMatch;
try {
    logoMatch = require('../shared/logo-match');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    logoMatch = require('../../frontend/js/logo-match');
}

module.exports = logoMatch;
