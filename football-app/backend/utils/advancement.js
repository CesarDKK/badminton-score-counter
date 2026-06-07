const { computeStandings } = require('./standings');

// Multi-tenant: alle queries scoped via clubId. Kald: tryAdvanceToCups(conn, tournamentId, clubId)
async function tryAdvanceToCups(conn, tournamentId, clubId) {
  const [[tournament]] = await conn.query(
    'SELECT * FROM tournaments WHERE id = ? AND club_id = ?',
    [tournamentId, clubId]
  );
  if (!tournament) return;

  const [pools] = await conn.query(
    'SELECT id, pool_index FROM pools WHERE tournament_id = ? AND club_id = ? ORDER BY pool_index',
    [tournamentId, clubId]
  );
  const poolIds = pools.map((p) => p.id);
  if (poolIds.length === 0) return;

  const [allMatches] = await conn.query(
    'SELECT * FROM pool_matches WHERE pool_id IN (?) AND club_id = ?',
    [poolIds, clubId]
  );
  const allPlayed = allMatches.length > 0 && allMatches.every((m) => m.played);
  if (!allPlayed) return;

  const [allTeams] = await conn.query(
    'SELECT id, pool_id, name, logo_path FROM teams WHERE pool_id IN (?) AND club_id = ?',
    [poolIds, clubId]
  );

  const placementByPoolIndex = new Map();
  for (const pl of pools) {
    const teams = allTeams.filter((t) => t.pool_id === pl.id);
    const matches = allMatches.filter((m) => m.pool_id === pl.id);
    const standings = computeStandings(teams, matches, tournament);
    placementByPoolIndex.set(pl.pool_index, standings);
  }

  const [cups] = await conn.query(
    'SELECT id FROM cups WHERE tournament_id = ? AND club_id = ?',
    [tournamentId, clubId]
  );
  for (const cup of cups) {
    const [firstRound] = await conn.query(
      'SELECT * FROM cup_matches WHERE cup_id = ? AND club_id = ? AND round = 1',
      [cup.id, clubId]
    );
    for (const cm of firstRound) {
      const homeSeed = cm.home_seed ? safeParse(cm.home_seed) : null;
      const awaySeed = cm.away_seed ? safeParse(cm.away_seed) : null;
      const homeTeamId = resolveSeed(homeSeed, placementByPoolIndex);
      const awayTeamId = resolveSeed(awaySeed, placementByPoolIndex);
      await conn.query(
        'UPDATE cup_matches SET home_team_id = ?, away_team_id = ? WHERE id = ? AND club_id = ?',
        [homeTeamId, awayTeamId, cm.id, clubId]
      );
    }
  }

  if (tournament.status === 'pool_stage' || tournament.status === 'setup') {
    await conn.query(
      "UPDATE tournaments SET status = 'cup_stage' WHERE id = ? AND club_id = ?",
      [tournamentId, clubId]
    );
  }
}

function safeParse(v) {
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (_) { return null; }
  }
  return v;
}

function resolveSeed(seed, placementByPoolIndex) {
  if (!seed) return null;
  const standings = placementByPoolIndex.get(seed.pool_index);
  if (!standings) return null;
  const row = standings.find((s) => s.position === seed.placement);
  return row ? row.team_id : null;
}

async function advanceCupWinner(conn, matchId, clubId) {
  const [[match]] = await conn.query(
    'SELECT * FROM cup_matches WHERE id = ? AND club_id = ?',
    [matchId, clubId]
  );
  if (!match || !match.played) return;
  if (!match.next_match_id) {
    const [[cup]] = await conn.query(
      'SELECT tournament_id FROM cups WHERE id = ? AND club_id = ?',
      [match.cup_id, clubId]
    );
    if (cup) await maybeFinishTournament(conn, cup.tournament_id, clubId);
    return;
  }
  const winnerId = match.home_score > match.away_score ? match.home_team_id : match.away_team_id;
  const slotColumn = match.next_match_slot === 'home' ? 'home_team_id' : 'away_team_id';
  await conn.query(
    `UPDATE cup_matches SET ${slotColumn} = ? WHERE id = ? AND club_id = ?`,
    [winnerId, match.next_match_id, clubId]
  );
}

async function maybeFinishTournament(conn, tournamentId, clubId) {
  const [cups] = await conn.query(
    'SELECT id FROM cups WHERE tournament_id = ? AND club_id = ?',
    [tournamentId, clubId]
  );
  if (cups.length === 0) return;
  const cupIds = cups.map((c) => c.id);
  const [matches] = await conn.query(
    'SELECT id, played FROM cup_matches WHERE cup_id IN (?) AND club_id = ?',
    [cupIds, clubId]
  );
  if (matches.length > 0 && matches.every((m) => m.played)) {
    await conn.query(
      "UPDATE tournaments SET status = 'finished' WHERE id = ? AND club_id = ?",
      [tournamentId, clubId]
    );
  }
}

module.exports = { tryAdvanceToCups, advanceCupWinner };
