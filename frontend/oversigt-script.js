// Overview Page Script - Display all active matches
const api = window.BadmintonAPI;

let courtCount = 5;
let allCourtData = [];
let activeCourts = [];
let currentPage = 0;
const COURTS_PER_PAGE = 6;
const REFRESH_INTERVAL = 2000; // 2 seconds - fast updates with batch API
const SCROLL_INTERVAL = 10000; // 10 seconds between page changes
let scrollTimer = null;
let refreshTimer = null;
let localTimerInterval = null;

// Store match start times for each court (courtId -> {matchStartTime, matchEndTime})
let courtMatchTimes = {};

// Recently finished matches — shown for 5 minutes after a match ends.
// courtId -> { snapshot, finishedAt, matchStartTime }
const finishedCourts = new Map();
const FINISHED_DISPLAY_MS = 5 * 60 * 1000;

// Snapshot af sidst kendte aktive tilstand pr. bane — bruges som fallback
// når en bane forsvinder fra API'et før oversigten når at se matchCompleted=true.
// courtId -> court data snapshot
const lastKnownActiveState = new Map();

// Local pause countdown state — avoids relying on 2s API interval for accuracy
// courtId -> { receivedAt: timestamp, secondsLeft: number }
let pauseCountdownState = {};

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initialize();
    startAutoRefresh();
    startAutoScroll();
    startLocalTimers();
});

// ==================== HOLDKAMP ====================

let activeTeamMatches = []; // alle aktive holdkampe (multi-holdkamp)

let _hkRenderedKey = ''; // signatur af struktur (match-ids + game-ids + status)
const HK_DOUBLES = ['MD', 'DD', 'HD', 'Double'];

async function loadHoldkamp() {
    try {
        const matches = await api.getActiveTeamMatches();
        activeTeamMatches = matches || [];
        const grid = document.getElementById('holdkampCardsGrid');
        const container = document.querySelector('.overview-container');

        if (!activeTeamMatches.length) {
            grid.style.display = 'none';
            grid.innerHTML = '';
            _hkRenderedKey = '';
            if (container) container.classList.remove('has-holdkamp');
            updateIdleState();
            return;
        }

        grid.style.display = 'grid';
        if (container) container.classList.add('has-holdkamp');

        // Struktur-signatur: fuld re-render kun når den ændrer sig (undgår flicker).
        // Live score-ændringer patches uden at genskabe DOM (bevarer scroll).
        const key = activeTeamMatches.map(tm =>
            `${tm.id}:${(tm.games || []).map(g => g.id + g.status).join(',')}`
        ).join('|');

        if (key !== _hkRenderedKey) {
            renderHoldkampCards(activeTeamMatches);
            _hkRenderedKey = key;
        } else {
            patchHoldkampCards(activeTeamMatches);
        }
        updateIdleState();
    } catch (error) {
        console.error('Failed to load holdkamp:', error);
    }
}

function hkGameCellHtml(g, num) {
    const isDoubles = HK_DOUBLES.includes(g.category);
    const t1 = isDoubles ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}` : (g.team1_player1 || '?');
    const t2 = isDoubles ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}` : (g.team2_player1 || '?');
    return `<div class="hk-game" data-game-id="${g.id}" style="background:rgba(83,52,131,0.15); border-left:3px solid #555; border-radius:6px; padding:9px 11px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="background:#e94560; color:#fff; padding:2px 7px; border-radius:4px; font-size:0.85em; font-weight:bold;">${g.category} ${num}</span>
            <span class="hk-game-status" style="font-size:0.85em;"></span>
        </div>
        <div style="color:#eaeaea; font-size:0.95em;">${escapeHtml(t1)}</div>
        <div style="color:#aaa; font-size:0.75em; margin:2px 0;">vs</div>
        <div style="color:#eaeaea; font-size:0.95em;">${escapeHtml(t2)}</div>
    </div>`;
}

function hkStatusFor(g, teamMatch) {
    if (g.status === 'pending') return { html: '<span style="color:#aaa;">Afventer</span>', border: '#555' };
    if (g.status === 'active') {
        const cd = allCourtData.find(c => c.courtId === g.court_number);
        const live = cd ? ` · ${cd.player1.score}-${cd.player2.score} (${cd.player1.games}-${cd.player2.games} sæt)` : '';
        return { html: `<span style="color:#fff;">▶ Bane ${g.court_number}${live}</span>`, border: '#533483' };
    }
    // finished — orienter scoren til team1 så tallene matcher navnene
    const winner = g.winner_team === 1 ? teamMatch.team1_name : teamMatch.team2_name;
    const isDoubles = HK_DOUBLES.includes(g.category);
    const side1Key = isDoubles && g.team1_player2 ? `${g.team1_player1 || ''} / ${g.team1_player2}` : (g.team1_player1 || '');
    const nums = g.set_scores ? orientHistorySetScoreNumbers(g.set_scores, side1Key).join(' · ') : '';
    const sc = nums ? ` <span style="color:rgba(255,255,255,0.45);">${nums}</span>` : '';
    return { html: `<span style="color:#4CAF50;">✓ ${escapeHtml(winner)}${sc}</span>`, border: g.winner_team === 1 ? '#4CAF50' : '#e94560' };
}

function renderHoldkampCards(matches) {
    const grid = document.getElementById('holdkampCardsGrid');
    grid.innerHTML = matches.map(tm => {
        const t1w = tm.games.filter(g => g.winner_team === 1).length;
        const t2w = tm.games.filter(g => g.winner_team === 2).length;
        const counts = {};
        const cells = tm.games.map(g => {
            counts[g.category] = (counts[g.category] || 0) + 1;
            return hkGameCellHtml(g, counts[g.category]);
        }).join('');
        return `<div class="hk-card" data-match-id="${tm.id}">
            <div class="hk-card-header">
                <span class="t1">${escapeHtml(tm.team1_name)}</span>
                <span class="sc">${t1w} – ${t2w}</span>
                <span class="t2">${escapeHtml(tm.team2_name)}</span>
            </div>
            <div class="hk-games">${cells}</div>
        </div>`;
    }).join('');
    patchHoldkampCards(matches); // sæt status/score + border på de friske celler
}

function patchHoldkampCards(matches) {
    matches.forEach(tm => {
        const card = document.querySelector(`.hk-card[data-match-id="${tm.id}"]`);
        if (!card) return;
        const t1w = tm.games.filter(g => g.winner_team === 1).length;
        const t2w = tm.games.filter(g => g.winner_team === 2).length;
        const scEl = card.querySelector('.hk-card-header .sc');
        if (scEl) scEl.textContent = `${t1w} – ${t2w}`;
        tm.games.forEach(g => {
            const cell = card.querySelector(`.hk-game[data-game-id="${g.id}"]`);
            if (!cell) return;
            const st = hkStatusFor(g, tm);
            const statusEl = cell.querySelector('.hk-game-status');
            if (statusEl) statusEl.innerHTML = st.html;
            cell.style.borderLeftColor = st.border;
        });
    });
}

async function initialize() {
    try {
        // Get court count from settings
        const settings = await api.getSettings();
        courtCount = settings.courtCount || 5;

        await refreshIdleSettings();
        await loadHoldkamp();
        await loadAllCourts();

        // Refresh sponsor images every 10 seconds
        setInterval(refreshIdleSettings, 10000);
    } catch (error) {
        console.error('Failed to initialize overview:', error);
        hideLoading();
    }
}

function isHoldkampCourt(courtId) {
    if (!activeTeamMatches.length) return false;
    // Kun aktive spil — afsluttede holdkamp-spil har stadig court_number sat
    // men banen skal ikke behandles som holdkamp-bane efter kampen er slut.
    // Søg på tværs af ALLE aktive holdkampe.
    return activeTeamMatches.some(tm =>
        (tm.games || []).some(g => g.court_number === courtId && g.status === 'active')
    );
}

async function loadAllCourts() {
    try {
        // Fetch all court data in a single batch request (much more efficient!)
        const allGameStates = await api.getAllGameStates();

        // Add court banners to each court
        const courtBanners = await api.getSponsorImages('court');

        allCourtData = allGameStates.map(gameState => {
            // Find banner for this court
            const banner = courtBanners.find(b =>
                b.assignedCourts && b.assignedCourts.includes(gameState.courtId)
            );
            return {
                ...gameState,
                courtBanner: banner || null
            };
        });

        // Sync pause countdown state from fresh API data
        const now = Date.now();
        allCourtData.forEach(court => {
            if (court.restBreakActive && court.restBreakSecondsLeft > 0) {
                const existing = pauseCountdownState[court.courtId];
                // Re-sync if this is a new pause or API value differs significantly from local estimate
                const localEstimate = existing ? getPauseSecondsLeft(court) : null;
                if (!existing || Math.abs((localEstimate) - court.restBreakSecondsLeft) > 2) {
                    pauseCountdownState[court.courtId] = { receivedAt: now, secondsLeft: court.restBreakSecondsLeft };
                }
            } else {
                delete pauseCountdownState[court.courtId];
            }
        });

        // Opdater snapshot af aktive baner og spor afsluttede baner.
        // Simpel tilgang: afsluttede baner (matchCompleted=true) vises direkte
        // i activeOnly i op til 5 min. Snapshot-fallback håndterer race-condition
        // hvor banen forsvinder (clearCourt) inden oversigt ser matchCompleted=true.
        const currentCourtIds = new Set(allCourtData.map(c => c.courtId));

        allCourtData.forEach(court => {
            if (!court.isActive || !court.matchStartTime || isHoldkampCourt(court.courtId)) {
                // Bane er aktiv uden matchStartTime → ny tildeling → fjern gammel post
                if (court.isActive && finishedCourts.has(court.courtId)) {
                    finishedCourts.delete(court.courtId);
                    lastKnownActiveState.delete(court.courtId);
                }
                return;
            }

            // Kamp er "færdig" når en spiller har vundet 2 sæt — robust uanset matchCompleted-flag
            const matchDone = court.matchCompleted ||
                              court.player1.games >= 2 ||
                              court.player2.games >= 2;

            // Gem senest kendte tilstand — bruges som fallback hvis banen ryddes
            lastKnownActiveState.set(court.courtId, { ...court });

            if (matchDone) {
                const existing = finishedCourts.get(court.courtId);
                if (!existing || existing.matchStartTime !== court.matchStartTime) {
                    finishedCourts.set(court.courtId, {
                        finishedAt: court.matchEndTime ? new Date(court.matchEndTime).getTime() : now,
                        matchStartTime: court.matchStartTime,
                        _snapshot: { ...court }  // altid gem snapshot så fallback virker efter clearCourt
                    });
                } else if (!existing._snapshot) {
                    // Opdater eksisterende entry med snapshot hvis det mangler
                    existing._snapshot = { ...court };
                }
            } else if (finishedCourts.has(court.courtId)) {
                // Ny kamp startet på samme bane — fjern den afsluttede post
                const entry = finishedCourts.get(court.courtId);
                if (court.matchStartTime !== entry.matchStartTime) {
                    finishedCourts.delete(court.courtId);
                }
            }
        });

        // Fallback: baner der var aktive men nu er forsvundet (clearCourt før oversigt
        // nåede at se matchCompleted=true). Brug snapshot til at vise resultatet.
        for (const [courtId, snapshot] of lastKnownActiveState) {
            const current = allCourtData.find(c => c.courtId === courtId);
            const isGone = !current?.isActive || !current?.matchStartTime;
            if (isGone && !finishedCourts.has(courtId)) {
                finishedCourts.set(courtId, {
                    finishedAt: snapshot.matchEndTime
                        ? new Date(snapshot.matchEndTime).getTime()
                        : now,
                    matchStartTime: snapshot.matchStartTime,
                    _snapshot: { ...snapshot, matchCompleted: true }
                });
            }
            if (isGone) lastKnownActiveState.delete(courtId);
        }

        // Expire entries older than 5 minutes
        for (const [cid, entry] of finishedCourts) {
            if (now - entry.finishedAt > FINISHED_DISPLAY_MS) {
                finishedCourts.delete(cid);
                lastKnownActiveState.delete(cid);
            }
        }

        // Filter: vis aktive baner + afsluttede i op til 5 min.
        // matchCompleted=true baner inkluderes direkte — ingen separat snapshot-mekanisme.
        const activeOnly = allCourtData.filter(court => {
            if (!court.isActive) return false;

            const hasGameActivity =
                !!court.matchStartTime ||
                court.player1.score > 0 ||
                court.player2.score > 0 ||
                court.player1.games > 0 ||
                court.player2.games > 0 ||
                court.timerSeconds > 0 ||
                court.isActive;

            if (!hasGameActivity) {
                delete courtMatchTimes[court.courtId];
                return false;
            }

            // Vis afsluttet kamp i op til 5 min (brug games-count som primær indikator)
            const matchDone = court.matchCompleted ||
                              court.player1.games >= 2 ||
                              court.player2.games >= 2;
            if (matchDone) {
                const entry = finishedCourts.get(court.courtId);
                if (!entry) return false;
                if (now - entry.finishedAt > FINISHED_DISPLAY_MS) return false;
            }

            courtMatchTimes[court.courtId] = {
                matchStartTime: court.matchStartTime,
                matchEndTime: court.matchEndTime
            };
            return true;
        });

        // Merge: aktive/afsluttede baner fra DB + snapshot-fallback for ryddede baner
        const activeIds = new Set(activeOnly.map(c => c.courtId));
        const fallbackCourts = Array.from(finishedCourts.entries())
            .filter(([cid, e]) => e._snapshot && !activeIds.has(cid))
            .map(([, e]) => ({
                ...e._snapshot,
                _isFinished: true,
                _finishedAt: e.finishedAt
            }));

        // Mark completed courts in activeOnly as finished for rendering
        activeCourts = [
            ...activeOnly.map(c => {
                const done = c.matchCompleted || c.player1.games >= 2 || c.player2.games >= 2;
                return done
                    ? { ...c, _isFinished: true, _finishedAt: finishedCourts.get(c.courtId)?.finishedAt ?? now }
                    : c;
            }),
            ...fallbackCourts
        ];

        hideLoading();
        displayCurrentPage();
        updateIdleState();
    } catch (error) {
        console.error('Failed to load courts:', error);
        hideLoading();
    }
}

async function loadCourtData(courtId) {
    try {
        const gameState = await api.getGameState(courtId);

        // Add court ID to the game state
        gameState.courtId = courtId;

        // Fetch court banner if court type
        const courtBanners = await api.getSponsorImages('court');
        const banner = courtBanners.find(b =>
            b.assignedCourts && b.assignedCourts.includes(courtId)
        );
        gameState.courtBanner = banner || null;

        return gameState;
    } catch (error) {
        console.error(`Failed to load court ${courtId}:`, error);
        return {
            courtId: courtId,
            isActive: false,
            player1: { name: 'N/A', score: 0, games: 0 },
            player2: { name: 'N/A', score: 0, games: 0 },
            timerSeconds: 0
        };
    }
}

function displayCurrentPage() {
    const grid = document.getElementById('courtsGrid');
    const noMatchesMsg = document.getElementById('noMatchesMessage');
    const pageIndicator = document.getElementById('pageIndicator');
    const pageInfo = document.getElementById('pageInfo');

    if (activeCourts.length === 0) {
        grid.style.display = 'none';
        noMatchesMsg.style.display = 'none';
        pageIndicator.style.display = 'none';
        return;
    }

    noMatchesMsg.style.display = 'none';
    grid.style.display = 'grid';

    // Calculate total pages
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);

    // Update page indicator
    if (totalPages > 1) {
        pageIndicator.style.display = 'block';
        pageInfo.textContent = `Side ${currentPage + 1} af ${totalPages}`;
    } else {
        pageIndicator.style.display = 'none';
    }

    // Calculate which courts to show on current page
    const startIndex = currentPage * COURTS_PER_PAGE;
    const endIndex = startIndex + COURTS_PER_PAGE;
    const courtsToShow = activeCourts.slice(startIndex, endIndex);

    // Check if same courts are already rendered — if so, update in-place to avoid layout jump
    // Include _isFinished in the key so a transition active→finished triggers a full re-render
    const existingIds = Array.from(grid.querySelectorAll('.court-card')).map(el =>
        el.dataset.courtId + (el.dataset.finished ? '-f' : ''));
    const newIds = courtsToShow.map(c => String(c.courtId) + (c._isFinished ? '-f' : ''));
    const sameLayout = existingIds.length === newIds.length && newIds.every((id, i) => id === existingIds[i]);

    if (sameLayout) {
        courtsToShow.forEach(court => updateCourtCardData(court));
    } else {
        grid.innerHTML = courtsToShow.map(court => renderCourtCard(court)).join('');
        // Add animation class only on full re-render
        grid.querySelectorAll('.court-card').forEach(el => el.classList.add('court-card--animate'));
    }
}

function updateCourtCardData(court) {
    if (court._isFinished) {
        const card = document.querySelector(`.court-card[data-court-id="${court.courtId}"][data-finished="1"]`);
        if (card) {
            const timeEl = card.querySelector('.finished-time');
            if (timeEl) {
                const minutesAgo = Math.floor((Date.now() - court._finishedAt) / 60000);
                timeEl.textContent = minutesAgo < 1 ? 'Lige afsluttet' : `${minutesAgo} min siden`;
            }
        }
        return;
    }
    const card = document.querySelector(`.court-card[data-court-id="${court.courtId}"]`);
    if (!card) return;

    const isDoubles = court.isDoubles || false;
    const isPaused = !!court.restBreakActive;

    // Toggle paused class
    card.classList.toggle('court-card--paused', isPaused);

    // Re-render entire card if finished state, pause state, history or player name changed
    const history = court.setScoresHistory || [];
    const wasPaused = !!card.querySelector('.court-pause-overlay');
    const wasFinished = !!card.dataset.finished;
    const isFinishedNow = !!court._isFinished;
    if (wasFinished !== isFinishedNow ||
        wasPaused !== isPaused ||
        parseInt(card.dataset.sets || '0') !== history.length ||
        card.dataset.p1 !== court.player1.name) {
        card.outerHTML = renderCourtCard(court);
        return;
    }

    // Update pause overlay countdown
    if (isPaused) {
        const pauseTimerEl = document.getElementById(`pause-timer-${court.courtId}`);
        if (pauseTimerEl) pauseTimerEl.textContent = getPauseSecondsLeft(court);
    }

    // Update current-set scores (always white — history badges handle colour)
    const scoreEls = card.querySelectorAll('.player-score');
    if (scoreEls[0]) scoreEls[0].textContent = court.player1.score;
    if (scoreEls[1]) scoreEls[1].textContent = court.player2.score;

    // Update player names
    const rows = card.querySelectorAll('.player-row');
    if (rows[0]) {
        const info = rows[0].querySelector('.player-info');
        if (info) info.innerHTML = isDoubles && court.player1.name2
            ? `<div class="player-name">${escapeHtml(court.player1.name)}</div><div class="player-name-partner">${escapeHtml(court.player1.name2)}</div>`
            : `<div class="player-name">${escapeHtml(court.player1.name)}</div>`;
    }
    if (rows[1]) {
        const info = rows[1].querySelector('.player-info');
        if (info) info.innerHTML = isDoubles && court.player2.name2
            ? `<div class="player-name">${escapeHtml(court.player2.name)}</div><div class="player-name-partner">${escapeHtml(court.player2.name2)}</div>`
            : `<div class="player-name">${escapeHtml(court.player2.name)}</div>`;
    }
}

function renderCourtCard(court) {
    if (court._isFinished) return renderFinishedCard(court);
    const isDoubles = court.isDoubles || false;
    const isPaused = !!court.restBreakActive;

    // Calculate elapsed time from matchStartTime (same as TV display)
    const timerSeconds = calculateElapsedTime(court.courtId);
    const timerDisplay = formatTimer(timerSeconds);

    // Pause label based on restBreakTitle
    const pauseLabel = (court.restBreakTitle || '').toLowerCase().includes('sæt') ? 'SÆTHVIL' : 'PAUSE';

    // Render player names (including doubles partner if applicable)
    const player1Names = isDoubles && court.player1.name2
        ? `<div class="player-name">${escapeHtml(court.player1.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player1.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player1.name)}</div>`;

    const player2Names = isDoubles && court.player2.name2
        ? `<div class="player-name">${escapeHtml(court.player2.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player2.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player2.name)}</div>`;

    // Rest break badge (only when restBreakActive, not betweenSets)
    const restBreakBadge = court.restBreakActive
        ? `<div class="rest-break-badge">PAUSE ${court.restBreakSecondsLeft}s</div>`
        : '';

    // Court banner
    const bannerHtml = court.courtBanner
        ? `<div class="court-card-footer">
               <img src="/uploads/${court.courtBanner.filename}"
                    alt="Court Banner"
                    class="court-banner-small">
           </div>`
        : '';

    // Build set-history score badges.
    // After switchSides() player1/player2 slots swap, but setScoresHistory stores the
    // names at the time the set ended. Match history names against current names to ensure
    // each score is shown in the correct player row regardless of side switches.
    const history = court.setScoresHistory || [];
    const p1Name = court.player1.name;
    let histP1 = '', histP2 = '';
    history.forEach(set => {
        const parts = (set.score || '0-0').split('-');
        let sA = parseInt(parts[0]) || 0; // score of history-player1
        let sB = parseInt(parts[1]) || 0; // score of history-player2

        // Determine if history player1 maps to current player1 or player2
        const swapped = set.player1Name && set.player1Name !== p1Name;
        const row1Score = swapped ? sB : sA;
        const row2Score = swapped ? sA : sB;
        const row1Won = row1Score > row2Score;

        histP1 += `<div class="set-hist-score" style="color:${row1Won ? '#4CAF50' : '#e94560'}">${row1Score}</div>`;
        histP2 += `<div class="set-hist-score" style="color:${row1Won ? '#e94560' : '#4CAF50'}">${row2Score}</div>`;
    });

    // Når et sæt netop er afsluttet er restBreakActive=true men resetScores() er
    // endnu ikke kørt — scorerne viser stadig sæt-slutresultatet i stedet for 0-0.
    // Detektér dette ved at sammenligne med det sidst gemte sæt-resultat.
    let currentP1Score = court.player1.score;
    let currentP2Score = court.player2.score;
    if (isPaused && history.length > 0) {
        const last = history[history.length - 1];
        const parts = (last.score || '0-0').split('-');
        const hs1 = parseInt(parts[0]) || 0;
        const hs2 = parseInt(parts[1]) || 0;
        if ((currentP1Score === hs1 && currentP2Score === hs2) ||
            (currentP1Score === hs2 && currentP2Score === hs1)) {
            currentP1Score = 0;
            currentP2Score = 0;
        }
    }

    const pauseSeconds = isPaused ? getPauseSecondsLeft(court) : 0;

    return `
        <div class="court-card${isPaused ? ' court-card--paused' : ''}" data-court-id="${court.courtId}" data-sets="${history.length}" data-p1="${escapeHtml(court.player1.name)}">

            <!-- Pause overlay — dækker hele kortet når aktiv -->
            ${isPaused ? `
            <div class="court-pause-overlay">
                <div class="court-pause-overlay__label">${pauseLabel}</div>
                <div class="court-pause-overlay__timer" id="pause-timer-${court.courtId}">${pauseSeconds}</div>
                <div class="court-pause-overlay__unit">SEK</div>
            </div>` : ''}

            <div class="court-card-content${isPaused ? ' court-card-content--paused' : ''}">
                <div class="court-card-header">
                    <div class="court-number">BANE ${court.courtId}</div>
                    <div class="court-timer" id="timer-${court.courtId}">${timerDisplay}</div>
                </div>

                <div class="court-players">
                    <div class="player-row">
                        <div class="player-info">${player1Names}</div>
                        <div class="player-stats">
                            ${histP1}
                            <div class="player-score">${currentP1Score}</div>
                        </div>
                    </div>

                    <div class="vs-divider">VS</div>

                    <div class="player-row">
                        <div class="player-info">${player2Names}</div>
                        <div class="player-stats">
                            ${histP2}
                            <div class="player-score">${currentP2Score}</div>
                        </div>
                    </div>
                </div>

                ${bannerHtml}
            </div>
        </div>
    `;
}

function renderFinishedCard(court) {
    const isDoubles = court.isDoubles || false;
    const p1games = court.player1?.games ?? 0;
    const p2games = court.player2?.games ?? 0;
    const p1won = p1games > p2games;

    const minutesAgo = Math.floor((Date.now() - court._finishedAt) / 60000);
    const timeText = minutesAgo < 1 ? 'Lige afsluttet' : `${minutesAgo} min siden`;

    const p1Names = isDoubles && court.player1?.name2
        ? `${escapeHtml(court.player1.name)} / ${escapeHtml(court.player1.name2)}`
        : escapeHtml(court.player1?.name || '?');
    const p2Names = isDoubles && court.player2?.name2
        ? `${escapeHtml(court.player2.name)} / ${escapeHtml(court.player2.name2)}`
        : escapeHtml(court.player2?.name || '?');

    // Byg sæt-score badges med samme navn-matching som active-kortet
    const history = court.setScoresHistory || [];
    const p1Name = court.player1?.name || '';
    let histP1 = '', histP2 = '';
    history.forEach(set => {
        const parts = (set.score || '0-0').split('-');
        let sA = parseInt(parts[0]) || 0;
        let sB = parseInt(parts[1]) || 0;
        const swapped = set.player1Name && set.player1Name !== p1Name;
        const r1 = swapped ? sB : sA;
        const r2 = swapped ? sA : sB;
        const r1won = r1 > r2;
        histP1 += `<div class="set-hist-score" style="color:${r1won ? '#4CAF50' : '#e94560'}">${r1}</div>`;
        histP2 += `<div class="set-hist-score" style="color:${r1won ? '#e94560' : '#4CAF50'}">${r2}</div>`;
    });

    return `
        <div class="court-card court-card--finished" data-court-id="${court.courtId}" data-finished="1">
            <div class="court-card-header">
                <div class="court-number">BANE ${court.courtId}</div>
                <span class="finished-badge">AFSLUTTET</span>
                <div class="finished-time">${timeText}</div>
            </div>
            <div class="court-players">
                <div class="player-row${p1won ? ' player-row--winner' : ''}">
                    <div class="player-info">
                        <div class="player-name">${p1Names}</div>
                    </div>
                    <div class="player-stats">${histP1}</div>
                </div>
                <div class="vs-divider">VS</div>
                <div class="player-row${!p1won ? ' player-row--winner' : ''}">
                    <div class="player-info">
                        <div class="player-name">${p2Names}</div>
                    </div>
                    <div class="player-stats">${histP2}</div>
                </div>
            </div>
        </div>
    `;
}

function getPauseSecondsLeft(court) {
    const state = pauseCountdownState[court.courtId];
    if (!state) return court.restBreakSecondsLeft || 0;
    const elapsed = (Date.now() - state.receivedAt) / 1000;
    return Math.max(0, Math.round(state.secondsLeft - elapsed));
}

function calculateElapsedTime(courtId) {
    const matchTimes = courtMatchTimes[courtId];

    if (!matchTimes || !matchTimes.matchStartTime) {
        return 0;
    }

    // Calculate elapsed time from server timestamp (same as TV display)
    const startTime = new Date(matchTimes.matchStartTime);
    const endTime = matchTimes.matchEndTime ? new Date(matchTimes.matchEndTime) : new Date();
    const elapsedMs = endTime - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    return Math.max(0, elapsedSeconds);
}

function formatTimer(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Orienterer sætscoren til team1 (række-venstre side) ud fra navnene i
// set_scores-strengen, så tallene matcher hvilket hold der står hvor — uanset
// hvilken side spillerne stod på pr. sæt. side1Key tomt -> kun rå tal.
// (Samme logik som admin-script.js' orientHistorySetScoreNumbers.)
function orientHistorySetScoreNumbers(rawSetScores, side1Key) {
    if (!rawSetScores) return [];
    if (!side1Key) return rawSetScores.match(/\d+-\d+/g) || [];
    const normalizeNames = s => String(s).trim().replace(/\s*[/&]\s*/g, ' / ');
    const anchor = normalizeNames(side1Key);
    return rawSetScores.split(', ').map(part => {
        const m = part.match(/^(.*?)\s+(\d+)-(\d+)\s+(.*?)$/);
        if (m) {
            const p1 = normalizeNames(m[1]);
            const p2 = normalizeNames(m[4]);
            if (p1 === anchor) return `${m[2]}-${m[3]}`;
            if (p2 === anchor) return `${m[3]}-${m[2]}`;
            return `${m[2]}-${m[3]}`;
        }
        const scoreOnly = part.trim().match(/^\d+-\d+$/);
        return scoreOnly ? part.trim() : null;
    }).filter(Boolean);
}

function hideLoading() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.style.display = 'none';
}

// ==================== IDLE SCREEN (screensaver / sponsor slideshow) ====================

let _idleImages = [];
let _idleSlideDuration = 10000;
let _idleSlideshowTimer = null;
let _idleAnimFrame = null;
let _idleSlideIndex = 0;
let _isIdleVisible = false;

async function refreshIdleSettings() {
    try {
        const [images, settings] = await Promise.all([
            api.getSponsorImages('general'),
            api.getSettings()
        ]);
        const newImages = images || [];
        const newDuration = (settings.slideDuration || 10) * 1000;

        // If image list or duration changed while idle, restart the idle screen
        const changed = newImages.length !== _idleImages.length || newDuration !== _idleSlideDuration;
        _idleImages = newImages;
        _idleSlideDuration = newDuration;

        if (_isIdleVisible && changed) {
            _stopIdleSlideshow();
            _stopIdleScreensaver();
            const screen = document.getElementById('idleScreen');
            if (screen) screen.innerHTML = '';
            _isIdleVisible = false;
            _startIdleContent();
        }
    } catch (e) { /* keep cached values on error */ }
}

function updateIdleState() {
    const hasActivity = activeCourts.length > 0 || activeTeamMatches.length > 0;
    if (hasActivity) {
        _hideIdleScreen();
    } else {
        _showIdleScreen();
    }
}

function _showIdleScreen() {
    if (_isIdleVisible) return;
    const screen = document.getElementById('idleScreen');
    if (!screen) return;
    screen.style.display = 'block';
    _isIdleVisible = true;
    _startIdleContent();
}

function _hideIdleScreen() {
    if (!_isIdleVisible) return;
    _stopIdleSlideshow();
    _stopIdleScreensaver();
    const screen = document.getElementById('idleScreen');
    if (screen) {
        screen.style.display = 'none';
        screen.innerHTML = '';
    }
    _isIdleVisible = false;
    _idleSlideIndex = 0;
}

function _startIdleContent() {
    if (_idleImages.length > 0) {
        _startIdleSlideshow();
    } else {
        _startIdleDefaultMessage();
    }
}

// ── Sponsor slideshow ────────────────────────────────────────────────────────

function _startIdleSlideshow() {
    const screen = document.getElementById('idleScreen');
    if (!screen) return;

    screen.innerHTML = `<img id="idleSlideImg"
        src="/uploads/${escapeHtml(_idleImages[0].filename)}"
        style="width:100%;height:100%;object-fit:contain;display:block;" alt="">`;
    _idleSlideIndex = 0;

    if (_idleImages.length > 1) {
        _idleSlideshowTimer = setInterval(() => {
            _idleSlideIndex = (_idleSlideIndex + 1) % _idleImages.length;
            const img = document.getElementById('idleSlideImg');
            if (img) img.src = `/uploads/${escapeHtml(_idleImages[_idleSlideIndex].filename)}`;
        }, _idleSlideDuration);
    }
}

function _stopIdleSlideshow() {
    if (_idleSlideshowTimer) {
        clearInterval(_idleSlideshowTimer);
        _idleSlideshowTimer = null;
    }
}

// ── Screensaver (bouncing text) ───────────────────────────────────────────────

function _startIdleDefaultMessage() {
    const screen = document.getElementById('idleScreen');
    if (!screen) return;

    screen.innerHTML = `
        <div id="idleBounceText" style="position:absolute; text-align:center; color:white; white-space:nowrap;">
            <div style="font-size:10.5em; font-weight:bold; color:white; letter-spacing:0.02em;">Ingen aktive kampe</div>
        </div>`;

    _startIdleScreensaver();
}

function _startIdleScreensaver() {
    _stopIdleScreensaver();

    let x = -1, y = -1, dx = 0, dy = 0, lastTime = null;

    function animate(timestamp) {
        const screen = document.getElementById('idleScreen');
        const text = screen ? screen.querySelector('#idleBounceText') : null;
        if (!screen || !text) return;

        if (x < 0) {
            const maxX = screen.offsetWidth - text.offsetWidth;
            const maxY = screen.offsetHeight - text.offsetHeight;
            x = Math.max(0, maxX / 2);
            y = Math.max(0, maxY / 2);
            const speed = 20;
            const angle = Math.random() * 2 * Math.PI;
            dx = Math.cos(angle) * speed;
            dy = Math.sin(angle) * speed;
            if (Math.abs(dx) < 6) dx = dx < 0 ? -6 : 6;
            if (Math.abs(dy) < 6) dy = dy < 0 ? -6 : 6;
        }

        if (!lastTime) lastTime = timestamp;
        const delta = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        x += dx * delta;
        y += dy * delta;

        const maxX = Math.max(0, screen.offsetWidth - text.offsetWidth);
        const maxY = Math.max(0, screen.offsetHeight - text.offsetHeight);

        if (x <= 0)    { x = 0;    dx =  Math.abs(dx); }
        if (x >= maxX) { x = maxX; dx = -Math.abs(dx); }
        if (y <= 0)    { y = 0;    dy =  Math.abs(dy); }
        if (y >= maxY) { y = maxY; dy = -Math.abs(dy); }

        text.style.left = Math.round(x) + 'px';
        text.style.top  = Math.round(y) + 'px';

        _idleAnimFrame = requestAnimationFrame(animate);
    }

    _idleAnimFrame = requestAnimationFrame(animate);
}

function _stopIdleScreensaver() {
    if (_idleAnimFrame) {
        cancelAnimationFrame(_idleAnimFrame);
        _idleAnimFrame = null;
    }
}

function startAutoRefresh() {
    // loadHoldkamp køres FØRST så activeTeamMatch er frisk når loadAllCourts
    // kalder isHoldkampCourt() — ellers bruger den stale data hvor afsluttede
    // holdkamp-spil stadig har status='active' og ekskluderer banen fra visning.
    refreshTimer = setInterval(async () => {
        await loadHoldkamp();
        await loadAllCourts();
    }, REFRESH_INTERVAL);
}

function startAutoScroll() {
    // Auto-scroll to next page every 10 seconds if there are more than 6 active courts
    scrollTimer = setInterval(() => {
        if (activeCourts.length > COURTS_PER_PAGE) {
            nextPage();
        }
    }, SCROLL_INTERVAL);
}

function startLocalTimers() {
    // Update timer displays every second based on matchStartTime
    localTimerInterval = setInterval(() => {
        updateTimerDisplays();
    }, 1000);
}

function updateTimerDisplays() {
    // Update match timer for all visible courts
    for (const courtId in courtMatchTimes) {
        const elapsed = formatTimer(calculateElapsedTime(courtId));
        const timerEl = document.getElementById(`timer-${courtId}`);
        if (timerEl) timerEl.textContent = elapsed;
    }
    // Update pause countdown timers using local state (no API lag)
    activeCourts.forEach(court => {
        if (!court.restBreakActive) return;
        const pauseTimerEl = document.getElementById(`pause-timer-${court.courtId}`);
        if (pauseTimerEl) {
            pauseTimerEl.textContent = getPauseSecondsLeft(court);
        }
    });
}

function nextPage() {
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);

    // Move to next page, wrap around to 0 if at end
    currentPage = (currentPage + 1) % totalPages;

    // Display new page immediately without animation
    displayCurrentPage();
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (scrollTimer) clearInterval(scrollTimer);
    if (localTimerInterval) clearInterval(localTimerInterval);
});
