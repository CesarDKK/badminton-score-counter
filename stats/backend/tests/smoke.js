/**
 * Røgtest mod den rigtige badmintonplayer-API.
 *
 * Kører ikke som en del af `npm test` — den rammer nettet og bruger et par
 * sekunder. Kør den manuelt når parsningen er rørt:
 *
 *   docker compose run --rm stats-backend node tests/smoke.js Lyngby 2025
 */

const bp = require('../badmintonplayer');
const P = require('../parse');
const { holdMatcher, AARGANG } = require('../harvest');

const klubNavn = process.argv[2] || 'Lyngby';
const season = process.argv[3] || '2025';

function tjek(navn, betingelse, detalje) {
    console.log(`${betingelse ? 'OK  ' : 'FEJL'}  ${navn}${detalje ? ' — ' + detalje : ''}`);
    if (!betingelse) process.exitCode = 1;
}

(async () => {
    const { klubber } = await bp.searchClub(klubNavn);
    tjek('SearchClub', klubber.length > 0, klubber.map((k) => `${k.navn} (${k.id})`).join(', '));
    if (!klubber.length) return;
    const klub = klubber[0];
    const erKlub = holdMatcher(klub.navn);

    const oversigt = await bp.standing({ subPage: 6, seasonID: season, clubID: klub.id });
    const raekker = P.parseClubOverview(oversigt);
    tjek('parseClubOverview', raekker.length > 0, `${raekker.length} rækker, fx "${raekker[0] && raekker[0].raekke}"`);
    if (!raekker.length) return;

    const r = raekker[0];
    tjek('årgang kendt', !!AARGANG[Number(r.ageGroupID)], `ageGroupID ${r.ageGroupID} → ${AARGANG[Number(r.ageGroupID)]}`);

    const pulje = await bp.standing({
        subPage: 2, seasonID: season, leagueGroupID: r.leagueGroupID,
        ageGroupID: r.ageGroupID, regionID: r.regionID, clubID: klub.id
    });
    const hold = P.parsePoolTeams(pulje, erKlub);
    tjek('parsePoolTeams', hold.length > 0, hold.map((h) => `${h.navn}=${h.teamID}`).join(', '));
    if (!hold.length) return;

    const program = await bp.standing({
        subPage: 3, seasonID: season, leagueGroupID: hold[0].leagueGroupID,
        ageGroupID: hold[0].ageGroupID, regionID: hold[0].regionID,
        leagueGroupTeamID: hold[0].teamID, clubID: klub.id
    });
    const kampe = P.parseTeamMatches(program);
    tjek('parseTeamMatches', kampe.length > 0, `${kampe.length} kampe: ${kampe.slice(0, 5).join(', ')}`);
    if (!kampe.length) return;

    const seddel = await bp.standing({ subPage: 5, seasonID: season, leagueMatchID: kampe[0], clubID: klub.id });
    const kamp = P.parseMatch(seddel, erKlub);
    tjek('parseMatch', !!kamp, kamp && `${kamp.hjemme} – ${kamp.ude} ${kamp.resultat} (${kamp.tid})`);
    tjek('parseMatch fandt klubben', !!(kamp && kamp.side), kamp && `side: ${kamp.side}`);
    tjek('parseMatch fandt spillere', !!(kamp && kamp.spillere.length),
        kamp && kamp.spillere.slice(0, 4).map((s) => `${s.disciplin} ${s.navn} #${s.id}`).join(' | '));
    tjek('spiller-id er tal', !!(kamp && kamp.spillere.every((s) => /^\d+$/.test(s.id))));
})().catch((e) => { console.error('Uventet fejl:', e); process.exitCode = 1; });
