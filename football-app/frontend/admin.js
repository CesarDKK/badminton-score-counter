(function () {
  const TOKEN_KEY = 'football_admin_token';
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  const state = {
    wizard: {
      step: 1,
      name: '',
      numPools: 2,
      teamsPerPool: 4,
      pw: 3, pd: 1, pl: 0,
      pools: [],
      cups: [],
    },
    currentTournamentId: null,
    pollInterval: null,
  };

  function authHeaders(extra) {
    return Object.assign({ 'Authorization': 'Bearer ' + token }, extra || {});
  }

  async function api(path, opts) {
    const options = opts || {};
    options.headers = authHeaders(options.headers);
    if (options.body && !(options.body instanceof FormData) && typeof options.body !== 'string') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const res = await fetch(path, options);
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      window.location.href = '/login.html';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || ('HTTP ' + res.status));
    }
    return res.json();
  }

  function show(view) {
    ['list', 'wizard', 'detail'].forEach((v) => {
      document.getElementById('view-' + v).classList.toggle('hidden', v !== view);
    });
    if (view !== 'detail') stopPolling();
  }

  function logoUrl(p) {
    return p ? '/api/uploads/' + p : null;
  }

  function teamCell(team) {
    const logo = team && team.logo_path
      ? '<img class="team-logo" src="' + logoUrl(team.logo_path) + '" alt="" />'
      : '<div class="team-logo"></div>';
    const name = team ? escapeHtml(team.name) : '<span class="muted">TBD</span>';
    return '<div class="team-cell">' + logo + '<span>' + name + '</span></div>';
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /* ============= TOURNAMENT LIST ============= */

  async function loadList() {
    show('list');
    try {
      const list = await api('/api/tournaments');
      const html = list.length === 0
        ? '<p class="muted">No tournaments yet. Click "New tournament" to create one.</p>'
        : list.map((t) => `
          <div class="tournament-card" data-id="${t.id}">
            <strong>${escapeHtml(t.name)}</strong>
            <div class="muted" style="margin-top: 4px;">${t.num_pools} pools × ${t.teams_per_pool} teams</div>
            <span class="status ${t.status}">${t.status.replace('_', ' ')}</span>
          </div>
        `).join('');
      document.getElementById('tournamentList').innerHTML = html;
      document.querySelectorAll('.tournament-card').forEach((el) => {
        el.addEventListener('click', () => openTournament(parseInt(el.dataset.id, 10)));
      });
    } catch (err) {
      document.getElementById('tournamentList').innerHTML =
        '<div class="error-msg">' + escapeHtml(err.message) + '</div>';
    }
  }

  /* ============= WIZARD ============= */

  function openWizard() {
    state.wizard = {
      step: 1, name: '', numPools: 2, teamsPerPool: 4,
      pw: 3, pd: 1, pl: 0, pools: [], cups: [],
    };
    show('wizard');
    setWizStep(1);
    document.getElementById('wiz-name').value = '';
    document.getElementById('wiz-num-pools').value = 2;
    document.getElementById('wiz-teams-per-pool').value = 4;
    document.getElementById('wiz-pw').value = 3;
    document.getElementById('wiz-pd').value = 1;
    document.getElementById('wiz-pl').value = 0;
  }

  function setWizStep(n) {
    state.wizard.step = n;
    [1,2,3,4].forEach((i) => {
      document.getElementById('step-' + i).classList.toggle('hidden', i !== n);
      const tab = document.querySelector('.wizard-step[data-step="' + i + '"]');
      tab.classList.toggle('active', i === n);
      tab.classList.toggle('done', i < n);
    });
    if (n === 2) buildPoolsStep();
    if (n === 3) buildCupsStep();
    if (n === 4) buildReviewStep();
  }

  function captureStep1() {
    state.wizard.name = document.getElementById('wiz-name').value.trim();
    state.wizard.numPools = Math.max(1, parseInt(document.getElementById('wiz-num-pools').value, 10) || 1);
    state.wizard.teamsPerPool = Math.max(2, parseInt(document.getElementById('wiz-teams-per-pool').value, 10) || 2);
    state.wizard.pw = parseInt(document.getElementById('wiz-pw').value, 10);
    state.wizard.pd = parseInt(document.getElementById('wiz-pd').value, 10);
    state.wizard.pl = parseInt(document.getElementById('wiz-pl').value, 10);
    if (!state.wizard.name) {
      alert('Please enter a tournament name');
      return false;
    }
    const existingPools = state.wizard.pools;
    state.wizard.pools = [];
    for (let i = 0; i < state.wizard.numPools; i += 1) {
      const old = existingPools[i] || {};
      const oldTeams = old.teams || [];
      const teams = [];
      for (let j = 0; j < state.wizard.teamsPerPool; j += 1) {
        teams.push(oldTeams[j] || { name: '' });
      }
      state.wizard.pools.push({
        name: old.name || ('Pool ' + String.fromCharCode(65 + i)),
        teams,
      });
    }
    return true;
  }

  function buildPoolsStep() {
    const container = document.getElementById('pools-builder');
    container.innerHTML = state.wizard.pools.map((p, pi) => `
      <div class="card" style="margin: 0;">
        <div class="row" style="margin-bottom: 8px;">
          <input type="text" data-pool-name="${pi}" value="${escapeHtml(p.name)}" style="flex:1;" />
        </div>
        ${p.teams.map((t, ti) => `
          <div class="team-row">
            <input type="text" data-team="${pi}-${ti}" placeholder="Team ${ti + 1}" value="${escapeHtml(t.name)}" />
          </div>
        `).join('')}
      </div>
    `).join('');

    container.querySelectorAll('input[data-pool-name]').forEach((el) => {
      el.addEventListener('input', () => {
        state.wizard.pools[parseInt(el.dataset.poolName, 10)].name = el.value;
      });
    });
    container.querySelectorAll('input[data-team]').forEach((el) => {
      el.addEventListener('input', () => {
        const [pi, ti] = el.dataset.team.split('-').map(Number);
        state.wizard.pools[pi].teams[ti].name = el.value;
      });
    });
  }

  function buildCupsStep() {
    if (state.wizard.cups.length === 0) {
      const placements = [];
      for (let i = 1; i <= state.wizard.teamsPerPool; i += 1) placements.push(i);
      state.wizard.cups = [
        { name: 'Championship Cup', source_placements: placements.slice(0, Math.ceil(placements.length / 2)) },
      ];
      if (placements.length > Math.ceil(placements.length / 2)) {
        state.wizard.cups.push({
          name: 'Plate Cup',
          source_placements: placements.slice(Math.ceil(placements.length / 2)),
        });
      }
    }
    renderCupsBuilder();
  }

  function renderCupsBuilder() {
    const container = document.getElementById('cups-builder');
    const placements = [];
    for (let i = 1; i <= state.wizard.teamsPerPool; i += 1) placements.push(i);

    container.innerHTML = state.wizard.cups.map((c, ci) => `
      <div class="card" style="margin: 0 0 12px;">
        <div class="row spread" style="margin-bottom: 8px;">
          <input type="text" data-cup-name="${ci}" value="${escapeHtml(c.name)}" style="flex:1; max-width: 320px;" />
          <button class="btn danger small" data-remove-cup="${ci}">Remove</button>
        </div>
        <div class="muted" style="margin-bottom: 6px;">Pool placements feeding this cup:</div>
        <div>
          ${placements.map((pl) => `
            <span class="placement-chip ${c.source_placements.includes(pl) ? 'selected' : ''}"
                  data-toggle-placement="${ci}-${pl}">${ordinal(pl)} place</span>
          `).join('')}
        </div>
        <div class="muted" style="margin-top: 8px; font-size: .85rem;">
          ${c.source_placements.length * state.wizard.numPools} teams will enter this cup.
        </div>
      </div>
    `).join('');

    container.querySelectorAll('input[data-cup-name]').forEach((el) => {
      el.addEventListener('input', () => {
        state.wizard.cups[parseInt(el.dataset.cupName, 10)].name = el.value;
      });
    });
    container.querySelectorAll('[data-toggle-placement]').forEach((el) => {
      el.addEventListener('click', () => {
        const [ci, pl] = el.dataset.togglePlacement.split('-').map(Number);
        const cup = state.wizard.cups[ci];
        const idx = cup.source_placements.indexOf(pl);
        if (idx === -1) cup.source_placements.push(pl);
        else cup.source_placements.splice(idx, 1);
        cup.source_placements.sort((a, b) => a - b);
        renderCupsBuilder();
      });
    });
    container.querySelectorAll('[data-remove-cup]').forEach((el) => {
      el.addEventListener('click', () => {
        state.wizard.cups.splice(parseInt(el.dataset.removeCup, 10), 1);
        renderCupsBuilder();
      });
    });
  }

  function ordinal(n) {
    const s = ['th','st','nd','rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function buildReviewStep() {
    const w = state.wizard;
    const totalTeams = w.numPools * w.teamsPerPool;
    document.getElementById('review-summary').innerHTML = `
      <p><strong>${escapeHtml(w.name)}</strong></p>
      <p>${w.numPools} pools × ${w.teamsPerPool} teams = ${totalTeams} teams total</p>
      <p>Scoring: ${w.pw} / ${w.pd} / ${w.pl} (Win / Draw / Loss)</p>
      <h4>Pools</h4>
      <ul>
        ${w.pools.map((p) => `
          <li><strong>${escapeHtml(p.name)}</strong>: ${p.teams.map((t) => escapeHtml(t.name || '(unnamed)')).join(', ')}</li>
        `).join('')}
      </ul>
      <h4>Cups</h4>
      ${w.cups.length === 0 ? '<p class="muted">No cups configured.</p>' : `
        <ul>
          ${w.cups.map((c) => `
            <li><strong>${escapeHtml(c.name)}</strong> — placements: ${c.source_placements.map(ordinal).join(', ')} → ${c.source_placements.length * w.numPools} teams</li>
          `).join('')}
        </ul>
      `}
    `;
  }

  async function createTournament() {
    const w = state.wizard;
    const payload = {
      name: w.name,
      num_pools: w.numPools,
      points_win: w.pw,
      points_draw: w.pd,
      points_loss: w.pl,
      pools: w.pools.map((p) => ({
        name: p.name,
        teams: p.teams.map((t) => ({ name: t.name || 'Team' })),
      })),
      cups: w.cups,
    };
    const errBox = document.getElementById('createError');
    errBox.classList.add('hidden');
    try {
      const result = await api('/api/tournaments', { method: 'POST', body: payload });
      openTournament(result.id);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }

  /* ============= TOURNAMENT DETAIL ============= */

  async function openTournament(id) {
    state.currentTournamentId = id;
    show('detail');
    await refreshDetail();
    startPolling();
  }

  function startPolling() {
    stopPolling();
    state.pollInterval = setInterval(() => refreshDetail({ silent: true }), 5000);
  }
  function stopPolling() {
    if (state.pollInterval) {
      clearInterval(state.pollInterval);
      state.pollInterval = null;
    }
  }

  async function refreshDetail(opts) {
    const silent = opts && opts.silent;
    const id = state.currentTournamentId;
    try {
      const [detail, standings, cups] = await Promise.all([
        api('/api/tournaments/' + id),
        api('/api/tournaments/' + id + '/standings'),
        api('/api/tournaments/' + id + '/cups'),
      ]);
      document.getElementById('detail-title').textContent = detail.tournament.name;
      const status = document.getElementById('detail-status');
      status.textContent = 'Status: ' + detail.tournament.status.replace('_', ' ');
      renderPoolsDetail(detail, standings);
      renderCupsDetail(cups);
    } catch (err) {
      if (!silent) alert('Failed to load: ' + err.message);
    }
  }

  function renderPoolsDetail(detail, standingsData) {
    const container = document.getElementById('detail-pools');
    container.innerHTML = standingsData.map((s) => {
      const teamsById = new Map((detail.teams.filter((t) => t.pool_id === s.pool.id)).map((t) => [t.id, t]));
      return `
        <div style="margin-bottom: 24px;">
          <h4>${escapeHtml(s.pool.name)} ${s.all_played ? '<span class="badge">Completed</span>' : ''}</h4>
          <table>
            <thead><tr>
              <th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th>
              <th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th></th>
            </tr></thead>
            <tbody>
              ${s.standings.map((r) => {
                const team = teamsById.get(r.team_id);
                return `
                  <tr>
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
                    <td>
                      <label class="btn secondary small" style="cursor: pointer;">
                        Logo<input type="file" accept="image/*" data-upload="${r.team_id}" style="display: none;" />
                      </label>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
          <div style="margin-top: 10px;">
            <h5 class="muted">Matches</h5>
            ${s.matches.map((m) => renderMatchRow(m, teamsById, 'pool')).join('')}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('input[type="file"][data-upload]').forEach((el) => {
      el.addEventListener('change', async () => {
        if (!el.files || el.files.length === 0) return;
        const file = el.files[0];
        const fd = new FormData();
        fd.append('logo', file);
        try {
          await api('/api/teams/' + el.dataset.upload + '/logo', { method: 'POST', body: fd });
          refreshDetail();
        } catch (err) {
          alert('Upload failed: ' + err.message);
        }
      });
    });

    container.querySelectorAll('[data-save-match]').forEach((btn) => {
      btn.addEventListener('click', () => saveMatch(btn.dataset.saveMatch, btn.dataset.matchType));
    });
    container.querySelectorAll('[data-clear-match]').forEach((btn) => {
      btn.addEventListener('click', () => clearMatch(btn.dataset.clearMatch, btn.dataset.matchType));
    });
  }

  function renderMatchRow(m, teamsById, type) {
    const home = teamsById.get ? teamsById.get(m.home_team_id) : m.home_team;
    const away = teamsById.get ? teamsById.get(m.away_team_id) : m.away_team;
    const homeScore = m.home_score == null ? '' : m.home_score;
    const awayScore = m.away_score == null ? '' : m.away_score;
    return `
      <div class="match-row ${m.played ? 'played' : ''}">
        <div class="home">${teamCell(home)}</div>
        <div class="scores">
          <input type="number" min="0" class="score-input" data-input-home="${m.id}" value="${homeScore}" ${home ? '' : 'disabled'} />
          <span>–</span>
          <input type="number" min="0" class="score-input" data-input-away="${m.id}" value="${awayScore}" ${away ? '' : 'disabled'} />
        </div>
        <div class="away">${teamCell(away)}</div>
        <div>
          <button class="btn small" data-save-match="${m.id}" data-match-type="${type}" ${(home && away) ? '' : 'disabled'}>Save</button>
          ${m.played ? `<button class="btn secondary small" data-clear-match="${m.id}" data-match-type="${type}">Clear</button>` : ''}
        </div>
      </div>
    `;
  }

  async function saveMatch(matchId, type) {
    const hEl = document.querySelector('[data-input-home="' + matchId + '"]');
    const aEl = document.querySelector('[data-input-away="' + matchId + '"]');
    const home = parseInt(hEl.value, 10);
    const away = parseInt(aEl.value, 10);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      alert('Enter valid non-negative scores');
      return;
    }
    const url = type === 'cup' ? '/api/cup-matches/' + matchId : '/api/pool-matches/' + matchId;
    try {
      await api(url, { method: 'PUT', body: { home_score: home, away_score: away } });
      refreshDetail();
    } catch (err) {
      alert('Save failed: ' + err.message);
    }
  }

  async function clearMatch(matchId, type) {
    const url = type === 'cup' ? '/api/cup-matches/' + matchId : '/api/pool-matches/' + matchId;
    try {
      await api(url, { method: 'PUT', body: { clear: true } });
      refreshDetail();
    } catch (err) {
      alert('Clear failed: ' + err.message);
    }
  }

  function renderCupsDetail(cupsData) {
    const container = document.getElementById('detail-cups');
    if (cupsData.length === 0) {
      container.innerHTML = '<p class="muted">No cups configured for this tournament.</p>';
      return;
    }
    container.innerHTML = cupsData.map((c) => {
      const rounds = groupByRound(c.matches);
      return `
        <div style="margin-bottom: 24px;">
          <h4>${escapeHtml(c.cup.name)}</h4>
          <div class="bracket">
            ${rounds.map((round, ri) => `
              <div class="bracket-round">
                <h4>${roundName(ri, rounds.length)}</h4>
                ${round.map((m) => renderBracketMatch(m, true)).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('[data-save-match]').forEach((btn) => {
      btn.addEventListener('click', () => saveMatch(btn.dataset.saveMatch, btn.dataset.matchType));
    });
    container.querySelectorAll('[data-clear-match]').forEach((btn) => {
      btn.addEventListener('click', () => clearMatch(btn.dataset.clearMatch, btn.dataset.matchType));
    });
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

  function renderBracketMatch(m, editable) {
    const hWin = m.played && m.home_score > m.away_score;
    const aWin = m.played && m.away_score > m.home_score;
    const home = m.home_team || null;
    const away = m.away_team || null;
    const enabled = home && away;
    return `
      <div class="bracket-match ${m.played ? 'played' : ''}">
        <div class="bracket-team ${hWin ? 'winner' : ''}">
          ${home && home.logo_path ? `<img class="team-logo" src="${logoUrl(home.logo_path)}" alt=""/>` : '<div class="team-logo"></div>'}
          <span class="name">${home ? escapeHtml(home.name) : '<span class="muted">TBD</span>'}</span>
          ${editable
            ? `<input type="number" min="0" class="score-input" data-input-home="${m.id}" value="${m.home_score == null ? '' : m.home_score}" ${enabled ? '' : 'disabled'} />`
            : `<span class="score">${m.home_score == null ? '' : m.home_score}</span>`}
        </div>
        <div class="bracket-team ${aWin ? 'winner' : ''}">
          ${away && away.logo_path ? `<img class="team-logo" src="${logoUrl(away.logo_path)}" alt=""/>` : '<div class="team-logo"></div>'}
          <span class="name">${away ? escapeHtml(away.name) : '<span class="muted">TBD</span>'}</span>
          ${editable
            ? `<input type="number" min="0" class="score-input" data-input-away="${m.id}" value="${m.away_score == null ? '' : m.away_score}" ${enabled ? '' : 'disabled'} />`
            : `<span class="score">${m.away_score == null ? '' : m.away_score}</span>`}
        </div>
        ${editable ? `
          <div class="row" style="justify-content: flex-end; margin-top: 4px;">
            <button class="btn small" data-save-match="${m.id}" data-match-type="cup" ${enabled ? '' : 'disabled'}>Save</button>
            ${m.played ? `<button class="btn secondary small" data-clear-match="${m.id}" data-match-type="cup">Clear</button>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  /* ============= INIT ============= */

  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login.html';
  });

  document.getElementById('newTournamentBtn').addEventListener('click', openWizard);

  document.querySelectorAll('[data-back="list"]').forEach((el) => {
    el.addEventListener('click', loadList);
  });

  document.querySelectorAll('[data-next]').forEach((el) => {
    el.addEventListener('click', () => {
      const next = parseInt(el.dataset.next, 10);
      if (state.wizard.step === 1 && !captureStep1()) return;
      setWizStep(next);
    });
  });
  document.querySelectorAll('[data-prev]').forEach((el) => {
    el.addEventListener('click', () => {
      setWizStep(parseInt(el.dataset.prev, 10));
    });
  });

  document.getElementById('addCupBtn').addEventListener('click', () => {
    state.wizard.cups.push({ name: 'Cup ' + (state.wizard.cups.length + 1), source_placements: [] });
    renderCupsBuilder();
  });

  document.getElementById('createTournamentBtn').addEventListener('click', createTournament);

  document.getElementById('deleteTournamentBtn').addEventListener('click', async () => {
    if (!confirm('Delete this tournament? This cannot be undone.')) return;
    try {
      await api('/api/tournaments/' + state.currentTournamentId, { method: 'DELETE' });
      loadList();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  });

  loadList();
})();
