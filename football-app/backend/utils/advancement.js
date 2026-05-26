const { computeStandings } = require('./standings');

async function tryAdvanceToCups(conn, tournamentId) {
  const [[tournament]] = await conn.query('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
  if (!tournament) return;

  const [pools] = await conn.query(
    'SELECT id, pool_index FROM pools WHERE tournament_id = ? ORDER BY pool_index',
    [tournamentId]
  );
  const poolIds = pools.map((p) => p.id);
  if (poolIds.length === 0) return;

  const [allMatches] = await conn.query(
    'SELECT * FROM pool_matches WHERE pool_id IN (?)',
    [poolIds]
  );
  const allPlayed = allMatches.length > 0 && allMatches.every((m) => m.played);
  if (!allPlayed) return;

  const [allTeams] = await conn.query(
    'SELECT id, pool_id, name, logo_path FROM teams WHERE pool_id IN (?)',
    [poolIds]
  );

  const placementByPoolIndex = new Map();
  for (const pl of pools) {
    const teams = allTeams.filter((t) => t.pool_id === pl.id);
    const matches = allMatches.filter((m) => m.pool_id === pl.id);
    const standings = computeStandings(teams, matches, tournament);
    placementByPoolIndex.set(pl.pool_index, standings);
  }

  const [cups] = await conn.query(
    'SELECT id FROM cups WHERE tournament_id = ?',
    [tournamentId]
  );
  for (const cup of cups) {
    const [firstRound] = await conn.query(
      'SELECT * FROM cup_matches WHERE cup_id = ? AND round = 1',
      [cup.id]
    );
    for (const cm of firstRound) {
      const homeSeed = cm.home_seed ? safeParse(cm.home_seed) : null;
      const awaySeed = cm.away_seed ? safeParse(cm.away_seed) : null;
      const homeTeamId = resolveSeed(homeSeed, placementByPoolIndex);
      const awayTeamId = resolveSeed(awaySeed, placementByPoolIndex);
      await conn.query(
        'UPDATE cup_matches SET home_team_id = ?, away_team_id = ? WHERE id = ?',
        [homeTeamId, awayTeamId, cm.id]
      );
    }
  }

  if (tournament.status === 'pool_stage' || tournament.status === 'setup') {
    await conn.query(
      "UPDATE tournaments SET status = 'cup_stage' WHERE id = ?",
      [tournamentId]
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

async function advanceCupWinner(conn, matchId) {
  const [[match]] = await conn.query('SELECT * FROM cup_matches WHERE id = ?', [matchId]);
  if (!match || !match.played) return;
  if (!match.next_match_id) {
    const [[cup]] = await conn.query('SELECT tournament_id FROM cups WHERE id = ?', [match.cup_id]);
    if (cup) await maybeFinishTournament(conn, cup.tournament_id);
    return;
  }
  const winnerId = match.home_score > match.away_score ? match.home_team_id : match.away_team_id;
  const slotColumn = match.next_match_slot === 'home' ? 'home_team_id' : 'away_team_id';
  await conn.query(
    `UPDATE cup_matches SET ${slotColumn} = ? WHERE id = ?`,
    [winnerId, match.next_match_id]
  );
}

async function maybeFinishTournament(conn, tournamentId) {
  const [cups] = await conn.query('SELECT id FROM cups WHERE tournament_id = ?', [tournamentId]);
  if (cups.length === 0) return;
  const cupIds = cups.map((c) => c.id);
  const [matches] = await conn.query(
    'SELECT id, played FROM cup_matches WHERE cup_id IN (?)',
    [cupIds]
  );
  if (matches.length > 0 && matches.every((m) => m.played)) {
    await conn.query("UPDATE tournaments SET status = 'finished' WHERE id = ?", [tournamentId]);
  }
}

module.exports = { tryAdvanceToCups, advanceCupWinner };
