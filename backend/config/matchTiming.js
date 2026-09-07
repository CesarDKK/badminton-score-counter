/**
 * Tidsregning for holdkamp-delkampe og turneringskampe.
 *
 * Bane-siden gemmer selv en varighed for almindelige kampe (match_history.
 * duration). For delkampe og turneringskampe udleder vi den i stedet af
 * started_at og finished_at på selve kampen (migration 026).
 */
const { queryOne } = require('./database');

/**
 * Banens rigtige starttid (game_states.match_start_time = første serv) for
 * den delkamp/turneringskamp der netop afsluttes på banen — eller null.
 *
 * Værn mod en gammel starttid: banens match_start_time kan i princippet
 * stamme fra en tidligere kamp på samme bane. Er den ÆLDRE end det tidspunkt
 * kampen blev tildelt banen (eksisterendeStart), hører den ikke til denne
 * kamp, og vi beholder tildelingstidspunktet i stedet.
 */
async function banensStartTid(courtNumber, eksisterendeStart) {
    if (!courtNumber) return null;
    const row = await queryOne(
        `SELECT gs.match_start_time AS start
           FROM game_states gs
           JOIN courts c ON c.id = gs.court_id
          WHERE c.court_number = ?
          LIMIT 1`,
        [courtNumber]
    );
    if (!row || !row.start) return null;
    const start = new Date(row.start);
    if (isNaN(start.getTime())) return null;
    if (eksisterendeStart) {
        const tildelt = new Date(eksisterendeStart);
        if (!isNaN(tildelt.getTime()) && start < tildelt) return null;
    }
    return start;
}

/**
 * "MM:SS" som bane-siden bruger til almindelige kampe (minutter ubegrænset,
 * fx "75:12"). Tom streng hvis start eller slut mangler eller er ugyldig.
 */
function varighedTekst(startedAt, finishedAt) {
    if (!startedAt || !finishedAt) return '';
    const s = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000);
    if (!Number.isFinite(s) || s < 0) return '';
    const m = Math.floor(s / 60);
    const sek = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sek).padStart(2, '0')}`;
}

module.exports = { banensStartTid, varighedTekst };
