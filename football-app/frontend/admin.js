(function () {
  const TOKEN_KEY = 'football_admin_token';
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) { window.location.href = '/login.html'; return; }

  const tr = window.FI18N.t;
  const ordinal = window.FI18N.ordinal;

  function statusLabel(status) {
    return tr('status.' + status);
  }

  const state = {
    wizard: emptyWizard(),
    pendingLogoFile: null,
    currentTournamentId: null,
    pollInterval: null,
    club: null, // {id, name, subdomain} — hentes ved init via /api/auth/club-info
  };

  function emptyWizard() {
    return {
      step: 1,
      name: '',
      numPools: 2,
      teamsPerPool: 4,
      pw: 3, pd: 1, pl: 0,
      pools: [],
      cups: [],
    };
  }

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
    if (view === 'list') {
      const title = state.club ? state.club.name + ' — Admin' : 'Admin';
      document.getElementById('brandTitle').textContent = title;
    }
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

  /* ============= LIST ============= */

  async function loadList() {
    show('list');
    try {
      const list = await api('/api/tournaments');
      const container = document.getElementById('tournamentList');
      if (list.length === 0) {
        container.innerHTML = `
          <div class="empty">
            <div class="icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 2 L14.5 9 L22 9 L16 13.5 L18.5 21 L12 16.5 L5.5 21 L8 13.5 L2 9 L9.5 9 Z"/>
              </svg>
            </div>
            <h3>${tr('admin.noTournaments')}</h3>
            <p>${tr('admin.noTournamentsHint')}</p>
          </div>`;
        return;
      }
      container.innerHTML = list.map((t, i) => `
        <button class="tournament-card fade-in" data-id="${t.id}" style="animation-delay: ${i * 40}ms">
          ${tournamentLogoHtml(t)}
          <div class="info">
            <div class="name">${escapeHtml(t.name)}</div>
            <div class="meta">${tr('public.meta', { pools: t.num_pools, teams: t.teams_per_pool })}</div>
            <span class="pill pill-${t.status}">${statusLabel(t.status)}</span>
          </div>
        </button>
      `).join('');
      container.querySelectorAll('.tournament-card').forEach((el) => {
        el.addEventListener('click', () => openTournament(parseInt(el.dataset.id, 10)));
      });
    } catch (err) {
      document.getElementById('tournamentList').innerHTML =
        '<div class="alert">' + escapeHtml(err.message) + '</div>';
    }
  }

  /* ============= WIZARD ============= */

  function openWizard() {
    state.wizard = emptyWizard();
    state.pendingLogoFile = null;
    document.getElementById('wiz-logo-preview').classList.add('hidden');
    document.getElementById('wiz-logo-preview').src = '';
    document.getElementById('wiz-logo-placeholder').classList.remove('hidden');
    show('wizard');
    setWizStep(1);
    ['wiz-name', 'wiz-num-pools', 'wiz-teams-per-pool', 'wiz-pw', 'wiz-pd', 'wiz-pl'].forEach((id) => {
      const defaults = { 'wiz-num-pools': 2, 'wiz-teams-per-pool': 4, 'wiz-pw': 3, 'wiz-pd': 1, 'wiz-pl': 0 };
      const el = document.getElementById(id);
      el.value = defaults[id] != null ? defaults[id] : '';
    });
  }

  function setWizStep(n) {
    state.wizard.step = n;
    [1, 2, 3, 4].forEach((i) => {
      document.getElementById('step-' + i).classList.toggle('hidden', i !== n);
      const tab = document.querySelector('.wizard-progress .step[data-step="' + i + '"]');
      tab.classList.toggle('active', i === n);
      tab.classList.toggle('done', i < n);
    });
    if (n === 2) buildPoolsStep();
    if (n === 3) buildCupsStep();
    if (n === 4) buildReviewStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function captureStep1() {
    state.wizard.name = document.getElementById('wiz-name').value.trim();
    state.wizard.numPools = Math.max(1, parseInt(document.getElementById('wiz-num-pools').value, 10) || 1);
    state.wizard.teamsPerPool = Math.max(2, parseInt(document.getElementById('wiz-teams-per-pool').value, 10) || 2);
    state.wizard.pw = parseInt(document.getElementById('wiz-pw').value, 10);
    state.wizard.pd = parseInt(document.getElementById('wiz-pd').value, 10);
    state.wizard.pl = parseInt(document.getElementById('wiz-pl').value, 10);
    if (!state.wizard.name) {
      alert(tr('wizard.nameRequired'));
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
        name: old.name || (tr('wizard.defaultPoolPrefix') + String.fromCharCode(65 + i)),
        teams,
      });
    }
    return true;
  }

  function buildPoolsStep() {
    const container = document.getElementById('pools-builder');
    container.innerHTML = state.wizard.pools.map((p, pi) => `
      <div class="pool-builder-card">
        <input type="text" class="pool-name-input" data-pool-name="${pi}" value="${escapeHtml(p.name)}" />
        ${p.teams.map((t, ti) => `
          <input type="text" class="team-input" data-team="${pi}-${ti}" placeholder="${tr('wizard.teamPlaceholder', { n: ti + 1 })}" value="${escapeHtml(t.name)}" />
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
      const half = Math.ceil(placements.length / 2);
      state.wizard.cups = [
        { name: tr('wizard.defaultCupA'), source_placements: placements.slice(0, half) },
      ];
      if (placements.length > half) {
        state.wizard.cups.push({
          name: tr('wizard.defaultCupB'),
          source_placements: placements.slice(half),
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
      <div class="cup-builder-card">
        <div class="row spread" style="margin-bottom: var(--sp-3);">
          <input type="text" class="pool-name-input" style="margin: 0; flex: 1;" data-cup-name="${ci}" value="${escapeHtml(c.name)}" />
          <button class="btn-icon btn-ghost" data-remove-cup="${ci}" style="color: var(--live);" aria-label="Remove">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
        <div class="label">${tr('wizard.placementsLabel')}</div>
        <div class="placement-chips">
          ${placements.map((pl) => `
            <span class="placement-chip ${c.source_placements.includes(pl) ? 'selected' : ''}"
                  data-toggle-placement="${ci}-${pl}">${ordinal(pl)}</span>
          `).join('')}
        </div>
        <div class="muted" style="margin-top: var(--sp-3); font-size: 13px;">
          ${tr('wizard.teamsWillEnter', { n: c.source_placements.length * state.wizard.numPools })}
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

  function buildReviewStep() {
    const w = state.wizard;
    const totalTeams = w.numPools * w.teamsPerPool;
    document.getElementById('review-summary').innerHTML = `
      <p><strong>${escapeHtml(w.name)}</strong> · ${tr('wizard.reviewMeta', { pools: w.numPools, teams: w.teamsPerPool, total: totalTeams })}</p>
      <p class="muted" style="font-size: 13px;">${tr('wizard.reviewScoring', { pw: w.pw, pd: w.pd, pl: w.pl })}</p>
      <h4>${tr('wizard.reviewPools')}</h4>
      <ul>
        ${w.pools.map((p) => `
          <li><strong>${escapeHtml(p.name)}</strong> — ${p.teams.map((t) => escapeHtml(t.name || tr('wizard.unnamed'))).join(', ')}</li>
        `).join('')}
      </ul>
      <h4>${tr('wizard.reviewCups')}</h4>
      ${w.cups.length === 0 ? '<p class="muted">' + tr('wizard.noCups') + '</p>' : `
        <ul>
          ${w.cups.map((c) => `
            <li><strong>${escapeHtml(c.name)}</strong> — ${tr('wizard.reviewCupLine', { placements: c.source_placements.map(ordinal).join(', '), n: c.source_placements.length * w.numPools })}</li>
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
      points_win: w.pw, points_draw: w.pd, points_loss: w.pl,
      pools: w.pools.map((p) => ({
        name: p.name,
        teams: p.teams.map((t) => ({ name: t.name || tr('wizard.defaultTeamName') })),
      })),
      cups: w.cups,
    };
    const errBox = document.getElementById('createError');
    errBox.classList.add('hidden');
    try {
      const result = await api('/api/tournaments', { method: 'POST', body: payload });
      if (state.pendingLogoFile) {
        const fd = new FormData();
        fd.append('logo', state.pendingLogoFile);
        try {
          await api('/api/tournaments/' + result.id + '/logo', { method: 'POST', body: fd });
        } catch (uploadErr) {
          console.error('Logo upload failed:', uploadErr);
        }
      }
      state.pendingLogoFile = null;
      openTournament(result.id);
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    }
  }

  /* ============= DETAIL ============= */

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
    if (state.pollInterval) { clearInterval(state.pollInterval); state.pollInterval = null; }
  }

  function isEditingScore() {
    const el = document.activeElement;
    return !!(el && el.classList && el.classList.contains('score-input'));
  }

  async function refreshDetail(opts) {
    const silent = opts && opts.silent;
    if (silent && isEditingScore()) return;
    const id = state.currentTournamentId;
    try {
      const [detail, standings, cups] = await Promise.all([
        api('/api/tournaments/' + id),
        api('/api/tournaments/' + id + '/standings'),
        api('/api/tournaments/' + id + '/cups'),
      ]);
      renderHero(detail.tournament);
      renderPoolsDetail(detail, standings);
      renderCupsDetail(cups);
    } catch (err) {
      if (!silent) alert(tr('admin.loadFailed', { msg: err.message }));
    }
  }

  function renderHero(t) {
    const hero = document.getElementById('detail-hero');
    hero.innerHTML = `
      <button class="logo-upload" id="hero-logo-pick" type="button" style="width: 72px; height: 72px;" title="${tr('logo.chooseTournament')}">
        ${t.logo_path
          ? `<img src="${logoUrl(t.logo_path)}" alt="" />`
          : `<div class="placeholder">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18">
                 <rect x="3" y="3" width="18" height="18" rx="2"/>
                 <circle cx="8.5" cy="8.5" r="1.5"/>
                 <path d="M21 15l-5-5L5 21"/>
               </svg>
             </div>`}
      </button>
      <div class="info">
        <h1 class="name">${escapeHtml(t.name)}</h1>
        <span class="pill pill-${t.status}">${statusLabel(t.status)}</span>
      </div>
    `;
    document.getElementById('brandTitle').textContent = (state.club ? state.club.name + ' — ' : '') + t.name;
    document.getElementById('hero-logo-pick').addEventListener('click', () => {
      pickAndAssignLogo({ kind: 'tournament', id: state.currentTournamentId });
    });
  }

  function renderPoolsDetail(detail, standingsData) {
    const container = document.getElementById('detail-pools');
    container.innerHTML = `
      <div class="eyebrow" style="margin-bottom: var(--sp-3);">${tr('public.poolStage')}</div>
      ${standingsData.map((s) => {
        const teamsById = new Map(detail.teams.filter((t) => t.pool_id === s.pool.id).map((t) => [t.id, t]));
        return `
          <div class="pool-block">
            <div class="pool-head">
              <div class="pool-name">${escapeHtml(s.pool.name)}</div>
              ${s.all_played ? '<span class="pill pill-completed">' + tr('status.completed') + '</span>' : ''}
            </div>
            <div class="standings">
              ${s.standings.map((r) => {
                const team = teamsById.get(r.team_id);
                return `
                  <div class="standing-row">
                    <div class="pos">${r.position}</div>
                    <div class="team">
                      <button class="logo-upload" type="button" data-team-pick="${r.team_id}" style="width: 28px; height: 28px; border-radius: var(--r-sm); border-style: solid;" title="${tr('logo.chooseTeam')}">
                        ${teamLogoBareHtml(team)}
                      </button>
                      <span class="team-name">${escapeHtml(team ? team.name : '')}</span>
                    </div>
                    <div class="stats">${tr('public.statsCompact', { p: r.played, w: r.wins, d: r.draws, l: r.losses, gd: r.goal_diff > 0 ? '+' + r.goal_diff : r.goal_diff })}</div>
                    <div class="pts">${r.points}</div>
                  </div>
                `;
              }).join('')}
            </div>
            <div class="match-list">
              ${s.matches.map((m) => renderEditableMatch(m, teamsById, 'pool')).join('')}
            </div>
          </div>
        `;
      }).join('')}
    `;

    container.querySelectorAll('button[data-team-pick]').forEach((el) => {
      el.addEventListener('click', () => {
        pickAndAssignLogo({ kind: 'team', id: parseInt(el.dataset.teamPick, 10) });
      });
    });
    wireMatchActions(container);
  }

  function teamLogoBareHtml(team) {
    if (!team) return '<div class="team-logo" style="width:100%; height:100%; border: none;">?</div>';
    if (team.logo_path) return `<img src="${logoUrl(team.logo_path)}" alt="" />`;
    return `<div style="display:grid; place-items:center; width:100%; height:100%; font-family: var(--font-display); font-size: 14px; color: var(--text-muted);">${escapeHtml(initial(team.name))}</div>`;
  }

  function renderEditableMatch(m, teamsById, type) {
    const home = teamsById ? teamsById.get(m.home_team_id) : m.home_team;
    const away = teamsById ? teamsById.get(m.away_team_id) : m.away_team;
    const homeScore = m.home_score == null ? '' : m.home_score;
    const awayScore = m.away_score == null ? '' : m.away_score;
    const enabled = home && away;
    return `
      <div class="match editable ${m.played ? 'played' : ''}">
        <div class="me-teams">
          <div class="me-side home">
            ${teamLogoHtml(home)}
            <span class="name">${escapeHtml(home ? home.name : '')}</span>
          </div>
          <div class="me-side away">
            <span class="name">${escapeHtml(away ? away.name : '')}</span>
            ${teamLogoHtml(away)}
          </div>
        </div>
        <div class="me-inputs">
          <input type="number" min="0" maxlength="2" inputmode="numeric" class="score-input" data-input-home="${type}-${m.id}" value="${homeScore}" ${enabled ? '' : 'disabled'} />
          <input type="number" min="0" maxlength="2" inputmode="numeric" class="score-input" data-input-away="${type}-${m.id}" value="${awayScore}" ${enabled ? '' : 'disabled'} />
        </div>
        <div class="me-actions">
          <button class="btn btn-sm" data-save-match="${m.id}" data-match-type="${type}" ${enabled ? '' : 'disabled'}>${tr('common.save')}</button>
          ${m.played ? `<button class="btn btn-secondary btn-sm" data-clear-match="${m.id}" data-match-type="${type}">${tr('common.clear')}</button>` : ''}
        </div>
      </div>
    `;
  }

  function wireMatchActions(container) {
    container.querySelectorAll('[data-save-match]').forEach((btn) => {
      btn.addEventListener('click', () => saveMatch(btn.dataset.saveMatch, btn.dataset.matchType));
    });
    container.querySelectorAll('[data-clear-match]').forEach((btn) => {
      btn.addEventListener('click', () => clearMatch(btn.dataset.clearMatch, btn.dataset.matchType));
    });
  }

  async function saveMatch(matchId, type) {
    const hEl = document.querySelector('[data-input-home="' + type + '-' + matchId + '"]');
    const aEl = document.querySelector('[data-input-away="' + type + '-' + matchId + '"]');
    const home = parseInt(hEl.value, 10);
    const away = parseInt(aEl.value, 10);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      alert(tr('match.invalidScores'));
      return;
    }
    const url = type === 'cup' ? '/api/cup-matches/' + matchId : '/api/pool-matches/' + matchId;
    try {
      await api(url, { method: 'PUT', body: { home_score: home, away_score: away } });
      refreshDetail();
    } catch (err) {
      alert(tr('match.saveFailed', { msg: err.message }));
    }
  }

  async function clearMatch(matchId, type) {
    const url = type === 'cup' ? '/api/cup-matches/' + matchId : '/api/pool-matches/' + matchId;
    try {
      await api(url, { method: 'PUT', body: { clear: true } });
      refreshDetail();
    } catch (err) {
      alert(tr('match.clearFailed', { msg: err.message }));
    }
  }

  function renderCupsDetail(cupsData) {
    const section = document.getElementById('detail-cups-section');
    const container = document.getElementById('detail-cups');
    if (!cupsData || cupsData.length === 0) { section.classList.add('hidden'); return; }
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
                ${round.map((m) => renderEditableBracketMatch(m)).join('')}
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
    wireMatchActions(container);
  }

  function renderEditableBracketMatch(m) {
    const hWin = m.played && m.home_score > m.away_score;
    const aWin = m.played && m.away_score > m.home_score;
    const home = m.home_team || null;
    const away = m.away_team || null;
    const homeCls = m.played ? (hWin ? 'winner' : 'loser') : '';
    const awayCls = m.played ? (aWin ? 'winner' : 'loser') : '';
    const enabled = home && away;
    return `
      <div class="bracket-match ${m.played ? 'played' : ''}">
        <div class="bracket-team ${homeCls}">
          ${teamLogoHtml(home)}
          <span class="name">${home ? escapeHtml(home.name) : '<span class="dim">' + tr('common.tbd') + '</span>'}</span>
          <input type="number" min="0" inputmode="numeric" class="score-input" style="width: 44px; height: 36px; font-size: 16px;" data-input-home="cup-${m.id}" value="${m.home_score == null ? '' : m.home_score}" ${enabled ? '' : 'disabled'} />
        </div>
        <div class="bracket-team ${awayCls}">
          ${teamLogoHtml(away)}
          <span class="name">${away ? escapeHtml(away.name) : '<span class="dim">' + tr('common.tbd') + '</span>'}</span>
          <input type="number" min="0" inputmode="numeric" class="score-input" style="width: 44px; height: 36px; font-size: 16px;" data-input-away="cup-${m.id}" value="${m.away_score == null ? '' : m.away_score}" ${enabled ? '' : 'disabled'} />
        </div>
        <div class="bracket-actions">
          <button class="btn btn-sm" data-save-match="${m.id}" data-match-type="cup" ${enabled ? '' : 'disabled'}>${tr('common.save')}</button>
          ${m.played ? `<button class="btn btn-secondary btn-sm" data-clear-match="${m.id}" data-match-type="cup">${tr('common.clear')}</button>` : ''}
        </div>
      </div>
    `;
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
    if (remaining === 1) return tr('round.final');
    if (remaining === 2) return tr('round.semifinal');
    if (remaining === 3) return tr('round.quarterfinal');
    return tr('round.n', { n: idx + 1 });
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
    el.addEventListener('click', () => setWizStep(parseInt(el.dataset.prev, 10)));
  });

  document.querySelectorAll('[data-step-delta]').forEach((el) => {
    el.addEventListener('click', () => {
      const delta = parseInt(el.dataset.stepDelta, 10);
      const input = document.getElementById(el.dataset.stepTarget);
      const min = parseInt(input.min || '1', 10);
      const max = parseInt(input.max || '99', 10);
      const cur = parseInt(input.value, 10) || 0;
      input.value = Math.min(max, Math.max(min, cur + delta));
    });
  });

  document.getElementById('addCupBtn').addEventListener('click', () => {
    state.wizard.cups.push({ name: 'Cup ' + (state.wizard.cups.length + 1), source_placements: [] });
    renderCupsBuilder();
  });

  document.getElementById('createTournamentBtn').addEventListener('click', createTournament);

  document.getElementById('deleteTournamentBtn').addEventListener('click', async () => {
    if (!confirm(tr('admin.confirmDelete'))) return;
    try {
      await api('/api/tournaments/' + state.currentTournamentId, { method: 'DELETE' });
      loadList();
    } catch (err) {
      alert(tr('admin.deleteFailed', { msg: err.message }));
    }
  });

  // Wizard logo preview
  const logoInput = document.getElementById('wiz-logo-input');
  logoInput.addEventListener('change', () => {
    if (!logoInput.files || logoInput.files.length === 0) return;
    const file = logoInput.files[0];
    state.pendingLogoFile = file;
    const preview = document.getElementById('wiz-logo-preview');
    const placeholder = document.getElementById('wiz-logo-placeholder');
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.classList.remove('hidden');
      placeholder.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LOGO PICKER
  // Generisk modal til at vælge et logo fra biblioteket (klub-egne + flag).
  // openLogoPicker() returnerer en Promise<string|null> med valgt logoPath.
  // ═══════════════════════════════════════════════════════════════════════
  const logoPicker = {
    modal: null,
    grid: null,
    search: null,
    kind: null,
    resolver: null,
    debounce: null,
  };

  function initLogoPicker() {
    logoPicker.modal = document.getElementById('logoPickerModal');
    logoPicker.grid = document.getElementById('logoPickerGrid');
    logoPicker.search = document.getElementById('logoPickerSearch');
    logoPicker.kind = document.getElementById('logoPickerKind');

    document.getElementById('logoPickerClose').addEventListener('click', closeLogoPicker);
    logoPicker.modal.addEventListener('click', (e) => {
      // Luk hvis bruger klikker på overlay-baggrund
      if (e.target === logoPicker.modal) closeLogoPicker();
    });

    logoPicker.search.addEventListener('input', () => {
      clearTimeout(logoPicker.debounce);
      logoPicker.debounce = setTimeout(refreshLogoPickerGrid, 250);
    });
    logoPicker.kind.addEventListener('change', refreshLogoPickerGrid);

    document.getElementById('logoPickerUploadToggle').addEventListener('click', () => {
      document.getElementById('logoPickerUploadForm').classList.toggle('hidden');
    });
    document.getElementById('logoPickerUploadBtn').addEventListener('click', handleLogoPickerUpload);
  }

  function openLogoPicker() {
    return new Promise((resolve) => {
      logoPicker.resolver = resolve;
      logoPicker.search.value = '';
      logoPicker.kind.value = '';
      document.getElementById('logoPickerUploadForm').classList.add('hidden');
      document.getElementById('logoPickerUploadName').value = '';
      document.getElementById('logoPickerUploadFile').value = '';
      document.getElementById('logoPickerUploadMsg').textContent = '';
      logoPicker.modal.classList.remove('hidden');
      refreshLogoPickerGrid();
    });
  }

  function closeLogoPicker(value) {
    logoPicker.modal.classList.add('hidden');
    if (logoPicker.resolver) {
      logoPicker.resolver(value || null);
      logoPicker.resolver = null;
    }
  }

  async function refreshLogoPickerGrid() {
    const params = new URLSearchParams();
    if (logoPicker.kind.value) params.set('kind', logoPicker.kind.value);
    if (logoPicker.search.value.trim()) params.set('search', logoPicker.search.value.trim());
    try {
      const res = await fetch('/api/logos?' + params.toString(), {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const logos = await res.json();
      renderLogoPickerGrid(logos);
    } catch (err) {
      logoPicker.grid.innerHTML = `<div style="color:#f0867a; padding:30px; text-align:center; grid-column:1/-1;">${tr('common.error')}: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderLogoPickerGrid(logos) {
    if (!logos || logos.length === 0) {
      logoPicker.grid.innerHTML = '<div style="color:rgba(255,255,255,0.5); padding:30px; text-align:center; grid-column:1/-1;">' + tr('logo.none') + '</div>';
      return;
    }
    logoPicker.grid.innerHTML = logos.map(l => `
      <button class="logo-pick-card" data-url="${escapeHtml(l.url)}" type="button"
              style="background:#0f1117; border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:6px; transition:all 0.15s;">
        <div style="width:64px; height:64px; display:flex; align-items:center; justify-content:center; background:#fff; border-radius:6px; overflow:hidden;">
          <img src="/api/uploads/${escapeHtml(l.url)}" alt="${escapeHtml(l.name)}" style="max-width:100%; max-height:100%; object-fit:contain;">
        </div>
        <div style="font-size:0.75em; color:#eaeaea; text-align:center; word-break:break-word; line-height:1.2;">${escapeHtml(l.name)}</div>
        ${l.club_id === null ? '<span style="font-size:0.65em; color:rgba(255,255,255,0.4);">' + tr('logo.global') + '</span>' : ''}
      </button>
    `).join('');

    logoPicker.grid.querySelectorAll('.logo-pick-card').forEach(card => {
      card.addEventListener('click', () => {
        closeLogoPicker(card.dataset.url);
      });
      card.addEventListener('mouseenter', () => { card.style.borderColor = '#e94560'; });
      card.addEventListener('mouseleave', () => { card.style.borderColor = 'rgba(255,255,255,0.08)'; });
    });
  }

  async function handleLogoPickerUpload() {
    const name = document.getElementById('logoPickerUploadName').value.trim();
    const file = document.getElementById('logoPickerUploadFile').files[0];
    const msg = document.getElementById('logoPickerUploadMsg');
    if (!name || !file) {
      msg.style.color = '#f0867a';
      msg.textContent = tr('logo.fillNameAndFile');
      return;
    }
    msg.style.color = 'rgba(255,255,255,0.6)';
    msg.textContent = tr('logo.uploading');

    const fd = new FormData();
    fd.append('name', name);
    fd.append('logo', file);

    try {
      const res = await fetch('/api/logos', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'HTTP ' + res.status);
      }
      const uploaded = await res.json();
      msg.style.color = '#90df93';
      msg.textContent = tr('logo.added');
      // Auto-pick det netop uploadede logo
      setTimeout(() => closeLogoPicker(uploaded.url), 400);
    } catch (err) {
      msg.style.color = '#f0867a';
      msg.textContent = tr('common.error') + ': ' + err.message;
    }
  }

  // Helper: gør et label/element til en logo-picker-knap der tildeler logo til
  // en tournament eller team. Bruges af renderHero / renderPoolsDetail.
  async function pickAndAssignLogo({ kind, id }) {
    const url = await openLogoPicker();
    if (!url) return;
    try {
      const endpoint = kind === 'tournament'
        ? `/api/tournaments/${id}/logo`
        : `/api/teams/${id}/logo`;
      await api(endpoint, { method: 'PUT', body: { logoPath: url } });
      if (kind === 'tournament' && state.currentTournamentId) refreshDetail();
      else if (kind === 'team') refreshDetail();
    } catch (err) {
      alert(tr('logo.assignFailed', { msg: err.message }));
    }
  }

  // Re-render den aktive visning når sproget skiftes
  window.FI18N.onChange(() => {
    const wizardVisible = !document.getElementById('view-wizard').classList.contains('hidden');
    const detailVisible = !document.getElementById('view-detail').classList.contains('hidden');
    if (wizardVisible) {
      const step = state.wizard.step;
      if (step === 2) buildPoolsStep();
      if (step === 3) renderCupsBuilder();
      if (step === 4) buildReviewStep();
    } else if (detailVisible) {
      refreshDetail({ silent: true });
    } else {
      loadList();
    }
  });

  // Bootstrap: hent klub-kontekst først så header viser klubnavnet
  (async () => {
    try {
      const res = await fetch('/api/auth/club-info');
      const data = await res.json();
      if (!data.club) {
        // Apex — admin på footballapp.dk uden subdomain giver ikke mening
        localStorage.removeItem(TOKEN_KEY);
        window.location.href = '/login.html';
        return;
      }
      state.club = data.club;
      document.title = state.club.name + ' — Admin';
    } catch (err) {
      console.warn('Could not load club context', err);
    }
    initLogoPicker();
    loadList();
  })();
})();
