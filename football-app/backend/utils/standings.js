function emptyRow(team) {
  return {
    team_id: team.id,
    team_name: team.name,
    logo_path: team.logo_path,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_diff: 0,
    points: 0,
  };
}

function computeStandings(teams, matches, scoring) {
  const { points_win, points_draw, points_loss } = scoring;
  const rows = new Map();
  teams.forEach((t) => rows.set(t.id, emptyRow(t)));

  const headToHead = new Map();
  const key = (a, b) => `${Math.min(a, b)}_${Math.max(a, b)}`;

  for (const m of matches) {
    if (!m.played) continue;
    const home = rows.get(m.home_team_id);
    const away = rows.get(m.away_team_id);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goals_for += m.home_score;
    home.goals_against += m.away_score;
    away.goals_for += m.away_score;
    away.goals_against += m.home_score;

    if (m.home_score > m.away_score) {
      home.wins += 1;
      away.losses += 1;
      home.points += points_win;
      away.points += points_loss;
    } else if (m.home_score < m.away_score) {
      away.wins += 1;
      home.losses += 1;
      away.points += points_win;
      home.points += points_loss;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += points_draw;
      away.points += points_draw;
    }

    const k = key(m.home_team_id, m.away_team_id);
    if (!headToHead.has(k)) headToHead.set(k, []);
    headToHead.get(k).push(m);
  }

  rows.forEach((r) => { r.goal_diff = r.goals_for - r.goals_against; });

  const list = Array.from(rows.values());

  list.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    const h2h = compareHeadToHead(a.team_id, b.team_id, headToHead, key, points_win, points_draw, points_loss);
    if (h2h !== 0) return h2h;
    return a.team_name.localeCompare(b.team_name);
  });

  list.forEach((r, idx) => { r.position = idx + 1; });
  return list;
}

function compareHeadToHead(aId, bId, headToHead, key, pw, pd, pl) {
  const matches = headToHead.get(key(aId, bId)) || [];
  let aPts = 0;
  let bPts = 0;
  let aGd = 0;
  let bGd = 0;
  for (const m of matches) {
    const aIsHome = m.home_team_id === aId;
    const aScore = aIsHome ? m.home_score : m.away_score;
    const bScore = aIsHome ? m.away_score : m.home_score;
    aGd += aScore - bScore;
    bGd += bScore - aScore;
    if (aScore > bScore) { aPts += pw; bPts += pl; }
    else if (aScore < bScore) { aPts += pl; bPts += pw; }
    else { aPts += pd; bPts += pd; }
  }
  if (bPts !== aPts) return bPts - aPts;
  return bGd - aGd;
}

function generateRoundRobin(teams) {
  const n = teams.length;
  if (n < 2) return [];
  const list = teams.slice();
  if (n % 2 === 1) list.push(null);
  const rounds = list.length - 1;
  const half = list.length / 2;
  const matches = [];
  let order = 0;
  let rotation = list.slice();
  for (let r = 0; r < rounds; r += 1) {
    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[rotation.length - 1 - i];
      if (home && away) {
        order += 1;
        matches.push({
          match_order: order,
          home_team_id: r % 2 === 0 ? home.id : away.id,
          away_team_id: r % 2 === 0 ? away.id : home.id,
        });
      }
    }
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, rotation.length - 1)];
  }
  return matches;
}

module.exports = { computeStandings, generateRoundRobin };
