// Pointreglerne — samme fil som tabletten bruger (frontend/js/taeller-regler.js),
// så reglerne kun findes ét sted.
//
// I containeren kopieres filen til /app/shared af Dockerfile.backend; i repoet
// (unit-tests og CI) læses den direkte fra frontend/js.
try {
    module.exports = require('../shared/taeller-regler');
} catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    module.exports = require('../../frontend/js/taeller-regler');
}
