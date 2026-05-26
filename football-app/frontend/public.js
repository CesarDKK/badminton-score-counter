(function () {
  const POLL_MS = 5000;
  const state = { view: 'list', tournamentId: null, pollHandle: null, autoOpened: false };

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function logoUrl(p) { return p ? '/api/uploads/' + p : null; }

  function initial(name) {
    const trimmed = (name || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
  }

  function teamLogoHtml(team, size) {
    const sizeClass = size === 'lg' ? ' lg' : '';
    if (!team) return `<div class="team-logo${sizeClass}">?</div>`;
    if (team.logo_path) {
      return `<div class="team-logo${sizeClass}"><img src="${logoUrl(team.logo_path)}" alt="" /></div>`;
    }
    return `<div class="team-logo${sizeClass}">${escapeHtml(initial(team.name))}</div>`;
  }

  function tournamentLogoHtml(t) {
    if (t && t.logo_path) {
      return `<div class="logo"><img src="${logoUrl(t.logo_path)}" alt="" /></div>`;
    }
    return `<div class="logo"><span class="initial">${escapeHtml(initial(t && t.name))}</span></div>`;
  }

  function show(view) {
    state.view = view;
    document.getElementById('view-list').classList.toggle('hidden', view !== 'list');
    document.getElementById('view-detail').classList.toggle('hidden', view !== 'detail');
    if (view !== 'detail') stopPolling();
    if (view === 'list') document.getElementById('brandTitle').textContent = 'Football';
  }

  function startPolling() {
    stopPolling();
    state.pollHandle = setInterval(() => refreshDetail({ silent: true }), POLL_MS);
  }
  function stopPolling() {
    if (state.pollHandle) { clearInterval(state.pollHandle); state.pollHandle = null; }
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
        container.innerHTML = `
          <div class="empty">
            <div class="icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2 L14.5 9 L22 9 L16 13.5 L18.5 21 L12 16.5 L5.5 21 L8 13.5 L2 9 L9.5 9 Z"/>
              </svg>
            </div>
            <h3>No tournaments yet</h3>
            <p>Tournaments will appear here once they're created.</p>
          </div>`;
        return;
      }
      container.innerHTML = list.map((t, i) => `
        <button class="tournament-card fade-in" data-id="${t.id}" style="animation-delay: ${i * 40}ms">
          ${tournamentLogoHtml(t)}
          <div class="info">
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="meta">${t.num_pools} pools · ${t.teams_per_pool} teams per pool</div>
            <span class="pill pill-${t.status}">${t.status.replace('_', ' ')}</span>
          </div>
        </button>
      `).join('');
      container.querySelectorAll('.tournament-card').forEach((el) => {
        el.addEventListener('click', () => openTournament(parseInt(el.dataset.id, 10)));
      });
    } catch (err) {
      show('list');
      container.innerHTML = '<div class="alert">' + escapeHtml(err.message) + '</div>';
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
      renderHero(detail.tournament);
      renderPools(detail, standings);
      renderCups(cups);
    } catch (err) {
      if (!silent) {
        document.getElementById('detail-pools').innerHTML =
          '<div class="alert">' + escapeHtml(err.message) + '</div>';
      }
    }
  }

  function renderHero(t) {
    const hero = document.getElementById('tournament-hero');
    hero.innerHTML = `
      ${tournamentLogoHtml(t)}
      <div class="info">
        <h1 class="name">${escapeHtml(t.name)}</h1>
        <span class="pill pill-${t.status}">${t.status.replace('_', ' ')}</span>
      </div>
    `;
    document.getElementById('brandTitle').textContent = t.name;
  }

  function renderPools(detail, standingsData) {
    const container = document.getElementById('detail-pools');
    const qualifyingPlacements = computeQualifyingPlacements(detail);
    container.innerHTML = `
      <div class="eyebrow" style="margin-bottom: var(--sp-3);">Pool stage</div>
      ${standingsData.map((s) => {
        const teamsById = new Map(detail.teams.filter((t) => t.pool_id === s.pool.id).map((t) => [t.id, t]));
        return `
          <div class="pool-block">
            <div class="pool-head">
              <div class="pool-name">${escapeHtml(s.pool.name)}</div>
              ${s.all_played ? '<span class="pill pill-completed">Completed</span>' : ''}
            </div>
            <div class="standings">
              ${s.standings.map((r) => {
                const team = teamsById.get(r.team_id);
                const qualified = qualifyingPlacements.has(r.position);
                return `
                  <div class="standing-row ${qualified ? 'qualified' : ''}">
                    <div class="pos">${r.position}</div>
                    <div class="team">
                      ${teamLogoHtml(team)}
                      <span class="team-name">${escapeHtml(team ? team.name : '')}</span>
                    </div>
                    <div class="stats">P${r.played} · W${r.wins} · D${r.draws} · L${r.losses} · GD ${r.goal_diff > 0 ? '+' + r.goal_diff : r.goal_diff}</div>
                    <div class="pts">${r.points}</div>
                  </div>
                `;
              }).join('')}
            </div>
            <div class="match-list">
              ${s.matches.map((m) => renderPoolMatch(m, teamsById)).join('')}
            </div>
          </div>
        `;
      }).join('')}
    `;
  }

  function renderPoolMatch(m, teamsById) {
    const home = teamsById.get(m.home_team_id);
    const away = teamsById.get(m.away_team_id);
    if (m.played) {
      const hWin = m.home_score > m.away_score;
      const aWin = m.away_score > m.home_score;
      return `
        <div class="match played">
          <div class="match-team ${hWin ? 'winner' : (aWin ? 'loser' : '')}">
            ${teamLogoHtml(home)}
            <span class="name">${escapeHtml(home ? home.name : '')}</span>
            <span class="score">${m.home_score}</span>
          </div>
          <div class="match-team ${aWin ? 'winner' : (hWin ? 'loser' : '')}">
            ${teamLogoHtml(away)}
            <span class="name">${escapeHtml(away ? away.name : '')}</span>
            <span class="score">${m.away_score}</span>
          </div>
        </div>
      `;
    }
    return `
      <div class="match">
        <div class="match-team">
          ${teamLogoHtml(home)}
          <span class="name">${escapeHtml(home ? home.name : '')}</span>
        </div>
        <div class="match-vs">vs</div>
        <div class="match-team">
          ${teamLogoHtml(away)}
          <span class="name">${escapeHtml(away ? away.name : '')}</span>
        </div>
      </div>
    `;
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

  function renderCups(cupsData) {
    const section = document.getElementById('detail-cups-section');
    const container = document.getElementById('detail-cups');
    if (!cupsData || cupsData.length === 0) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    container.innerHTML = cupsData.map((c) => {
      const rounds = groupByRound(c.matches);
      return `
        <div class="cup-block">
          <div class="cup-name">${escapeHtml(c.cup.name)}</div>
          <div class="bracket">
            ${rounds.map((round, ri) => `
              <div class="bracket-round">
                <div class="bracket-round-name">${roundName(ri, rounds.length)}</div>
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
    const homeCls = m.played ? (hWin ? 'winner' : 'loser') : '';
    const awayCls = m.played ? (aWin ? 'winner' : 'loser') : '';
    return `
      <div class="bracket-match ${m.played ? 'played' : ''}">
        <div class="bracket-team ${homeCls}">
          ${teamLogoHtml(home)}
          <span class="name">${home ? escapeHtml(home.name) : '<span class="dim">TBD</span>'}</span>
          <span class="score">${m.home_score == null ? '' : m.home_score}</span>
        </div>
        <div class="bracket-team ${awayCls}">
          ${teamLogoHtml(away)}
          <span class="name">${away ? escapeHtml(away.name) : '<span class="dim">TBD</span>'}</span>
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
