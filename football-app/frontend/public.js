(function () {
  const POLL_MS = 5000;
  const state = {
    view: 'list',
    tournamentId: null,
    pollHandle: null,
  };

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function logoUrl(p) {
    return p ? '/api/uploads/' + p : null;
  }

  function show(view) {
    state.view = view;
    document.getElementById('view-list').classList.toggle('hidden', view !== 'list');
    document.getElementById('view-detail').classList.toggle('hidden', view !== 'detail');
    if (view !== 'detail') stopPolling();
  }

  function teamCell(team, size) {
    if (!team) return '<div class="team-cell"><div class="team-logo"></div><span class="muted">TBD</span></div>';
    const logo = team.logo_path
      ? '<img class="team-logo' + (size === 'large' ? ' large' : '') + '" src="' + logoUrl(team.logo_path) + '" alt="" />'
      : '<div class="team-logo' + (size === 'large' ? ' large' : '') + '"></div>';
    return '<div class="team-cell">' + logo + '<span>' + escapeHtml(team.name) + '</span></div>';
  }

  function startPolling() {
    stopPolling();
    state.pollHandle = setInterval(() => refreshDetail({ silent: true }), POLL_MS);
  }
  function stopPolling() {
    if (state.pollHandle) {
      clearInterval(state.pollHandle);
      state.pollHandle = null;
    }
  }

  async function loadList() {
    const container = document.getElementById('tournamentList');
    try {
      const list = await api('/api/tournaments');
      if (list.length === 1) {
        openTournament(list[0].id, { fromAutoOpen: true });
        return;
      }
      show('list');
      if (list.length === 0) {
        container.innerHTML = '<p class="muted">No tournaments yet.</p>';
        return;
      }
      container.innerHTML = list.map((t) => `
        <div class="tournament-card" data-id="${t.id}">
          <strong>${escapeHtml(t.name)}</strong>
          <div class="muted" style="margin-top: 4px;">${t.num_pools} pools × ${t.teams_per_pool} teams</div>
          <span class="status ${t.status}">${t.status.replace('_', ' ')}</span>
        </div>
      `).join('');
      container.querySelectorAll('.tournament-card').forEach((el) => {
        el.addEventListener('click', () => openTournament(parseInt(el.dataset.id, 10)));
      });
    } catch (err) {
      show('list');
      container.innerHTML = '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
    }
  }

  function openTournament(id, opts) {
    state.tournamentId = id;
    state.autoOpened = !!(opts && opts.fromAutoOpen);
    document.getElementById('backToListBtn').classList.toggle('hidden', state.autoOpened);
    show('detail');
    refreshDetail();
    startPolling();
  }

  async function refreshDetail(opts) {
    const silent = opts && opts.silent;
    const id = state.tournamentId;
    if (!id) return;
    try {
      const [detail, standings, cups] = await Promise.all([
        api('/api/tournaments/' + id),
        api('/api/tournaments/' + id + '/standings'),
        api('/api/tournaments/' + id + '/cups'),
      ]);
      document.getElementById('detail-title').textContent = detail.tournament.name;
      document.getElementById('detail-status').textContent = 'Status: ' + detail.tournament.status.replace('_', ' ');
      renderPools(detail, standings);
      renderCups(cups, detail);
    } catch (err) {
      if (!silent) {
        document.getElementById('detail-pools').innerHTML =
          '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
      }
    }
  }

  function renderPools(detail, standingsData) {
    const container = document.getElementById('detail-pools');
    container.innerHTML = standingsData.map((s) => {
      const teamsById = new Map(detail.teams.filter((t) => t.pool_id === s.pool.id).map((t) => [t.id, t]));
      const qualifyingPlacements = computeQualifyingPlacements(detail);
      return `
        <div style="margin-bottom: 24px;">
          <h4>${escapeHtml(s.pool.name)} ${s.all_played ? '<span class="badge">Completed</span>' : ''}</h4>
          <table>
            <thead><tr>
              <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th>
              <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
            </tr></thead>
            <tbody>
              ${s.standings.map((r) => {
                const team = teamsById.get(r.team_id);
                const cls = qualifyingPlacements.has(r.position) ? 'qualified' : '';
                return `
                  <tr class="${cls}">
                    <td>${r.position}</td>
                    <td>${teamCell(team)}</td>
                    <td>${r.played}</td>
                    <td>${r.wins}</td>
                    <td>${r.draws}</td>
                    <td>${r.losses}</td>
                    <td>${r.goals_for}</td>
                    <td>${r.goals_against}</td>
                    <td>${r.goal_diff > 0 ? '+' + r.goal_diff : r.goal_diff}</td>
                    <td><strong>${r.points}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div style="margin-top: 12px;">
            <h5 class="muted">Matches</h5>
            ${s.matches.map((m) => renderMatch(m, teamsById)).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function computeQualifyingPlacements(detail) {
    const set = new Set();
    (detail.cups || []).forEach((c) => {
      const placements = typeof c.source_placements === 'string'
        ? JSON.parse(c.source_placements)
        : c.source_placements;
      (placements || []).forEach((p) => set.add(p));
    });
    return set;
  }

  function renderMatch(m, teamsById) {
    const home = teamsById.get(m.home_team_id);
    const away = teamsById.get(m.away_team_id);
    const scoreText = m.played
      ? `<strong>${m.home_score} – ${m.away_score}</strong>`
      : '<span class="muted">vs</span>';
    return `
      <div class="match-row ${m.played ? 'played' : ''}">
        <div class="home">${teamCell(home)}</div>
        <div class="scores">${scoreText}</div>
        <div class="away">${teamCell(away)}</div>
        <div></div>
      </div>
    `;
  }

  function renderCups(cupsData, detail) {
    const card = document.getElementById('cups-card');
    const container = document.getElementById('detail-cups');
    if (cupsData.length === 0) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    container.innerHTML = cupsData.map((c) => {
      const rounds = groupByRound(c.matches);
      return `
        <div style="margin-bottom: 24px;">
          <h4>${escapeHtml(c.cup.name)}</h4>
          <div class="bracket">
            ${rounds.map((round, ri) => `
              <div class="bracket-round">
                <h4>${roundName(ri, rounds.length)}</h4>
                ${round.map((m) => renderBracketMatch(m)).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }

  function groupByRound(matches) {
    const map = new Map();
    matches.forEach((m) => {
      if (!map.has(m.round)) map.set(m.round, []);
      map.get(m.round).push(m);
    });
    const rounds = Array.from(map.keys()).sort((a, b) => a - b);
    return rounds.map((r) => map.get(r).sort((a, b) => a.bracket_position - b.bracket_position));
  }

  function roundName(idx, total) {
    const remaining = total - idx;
    if (remaining === 1) return 'Final';
    if (remaining === 2) return 'Semifinal';
    if (remaining === 3) return 'Quarterfinal';
    return 'Round ' + (idx + 1);
  }

  function renderBracketMatch(m) {
    const hWin = m.played && m.home_score > m.away_score;
    const aWin = m.played && m.away_score > m.home_score;
    const home = m.home_team || null;
    const away = m.away_team || null;
    const logoH = home && home.logo_path
      ? `<img class="team-logo" src="${logoUrl(home.logo_path)}" alt=""/>`
      : '<div class="team-logo"></div>';
    const logoA = away && away.logo_path
      ? `<img class="team-logo" src="${logoUrl(away.logo_path)}" alt=""/>`
      : '<div class="team-logo"></div>';
    return `
      <div class="bracket-match ${m.played ? 'played' : ''}">
        <div class="bracket-team ${hWin ? 'winner' : ''}">
          ${logoH}
          <span class="name">${home ? escapeHtml(home.name) : '<span class="muted">TBD</span>'}</span>
          <span class="score">${m.home_score == null ? '' : m.home_score}</span>
        </div>
        <div class="bracket-team ${aWin ? 'winner' : ''}">
          ${logoA}
          <span class="name">${away ? escapeHtml(away.name) : '<span class="muted">TBD</span>'}</span>
          <span class="score">${m.away_score == null ? '' : m.away_score}</span>
        </div>
      </div>
    `;
  }

  document.querySelectorAll('[data-back="list"]').forEach((el) => {
    el.addEventListener('click', loadList);
  });

  loadList();
})();
