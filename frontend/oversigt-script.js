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

let activeTeamMatch = null;

async function loadHoldkamp() {
    try {
        activeTeamMatch = await api.getActiveTeamMatch();
        const panel = document.getElementById('holdkampOverview');

        if (!activeTeamMatch) {
            panel.style.display = 'none';
            return;
        }

        panel.style.display = 'block';

        const team1Wins = activeTeamMatch.games.filter(g => g.winner_team === 1).length;
        const team2Wins = activeTeamMatch.games.filter(g => g.winner_team === 2).length;

        document.getElementById('hk_team1Name').textContent = activeTeamMatch.team1_name;
        document.getElementById('hk_team2Name').textContent = activeTeamMatch.team2_name;
        document.getElementById('hk_score').textContent = `${team1Wins} – ${team2Wins}`;

        const formatNames = {
            liga11: 'Liga-format (11 kampe)',
            '13kamps': '13-kamps format',
            '2plus2': '2+2-format (8 kampe)',
            '4plus2': '4+2-format (8 kampe)',
            '4plus3': '4+3-format (9 kampe)',
            '4spillere': '4-spillere-format (6 kampe)'
        };
        document.getElementById('holdkampFormatLabel').textContent = formatNames[activeTeamMatch.format] || activeTeamMatch.format;

        renderHoldkampGames(activeTeamMatch);
    } catch (error) {
        console.error('Failed to load holdkamp:', error);
    }
}

function renderHoldkampGames(teamMatch) {
    const container = document.getElementById('holdkampGamesGrid');
    const DOUBLES = ['MD', 'DD', 'HD', 'Double'];

    const counts = {};
    container.innerHTML = teamMatch.games.map(g => {
        counts[g.category] = (counts[g.category] || 0) + 1;
        const num = counts[g.category];
        const isDoubles = DOUBLES.includes(g.category);

        const t1 = isDoubles
            ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
            : (g.team1_player1 || '?');
        const t2 = isDoubles
            ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
            : (g.team2_player1 || '?');

        let statusHtml = '';
        let borderColor = '#555';

        if (g.status === 'pending') {
            statusHtml = '<span style="color:#aaa; font-size:0.8em;">Afventer</span>';
        } else if (g.status === 'active') {
            // Try to get live score from allCourtData
            const courtData = allCourtData.find(c => c.courtId === g.court_number);
            const liveScore = courtData
                ? `${courtData.player1.score}-${courtData.player2.score} (${courtData.player1.games}-${courtData.player2.games} sæt)`
                : '';
            statusHtml = `<span style="color:#fff; font-size:0.8em;">▶ Bane ${g.court_number}${liveScore ? ' · ' + liveScore : ''}</span>`;
            borderColor = '#533483';
        } else if (g.status === 'finished') {
            const winner = g.winner_team === 1 ? teamMatch.team1_name : teamMatch.team2_name;
            statusHtml = `<span style="color:#4CAF50; font-size:0.8em;">✓ ${winner}</span>`;
            borderColor = g.winner_team === 1 ? '#4CAF50' : '#e94560';
        }

        return `<div style="background:rgba(83,52,131,0.15); border-left:3px solid ${borderColor}; border-radius:6px; padding:10px 12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span style="background:#e94560; color:#fff; padding:2px 7px; border-radius:4px; font-size:0.8em; font-weight:bold;">${g.category} ${num}</span>
                ${statusHtml}
            </div>
            <div style="color:#eaeaea; font-size:0.9em;">${t1}</div>
            <div style="color:#aaa; font-size:0.75em; margin:2px 0;">vs</div>
            <div style="color:#eaeaea; font-size:0.9em;">${t2}</div>
        </div>`;
    }).join('');
}

async function initialize() {
    try {
        // Get court count from settings
        const settings = await api.getSettings();
        courtCount = settings.courtCount || 5;

        await loadAllCourts();
        await loadHoldkamp();
    } catch (error) {
        console.error('Failed to initialize overview:', error);
        hideLoading();
    }
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

        // Filter only active courts with actual game activity
        activeCourts = allCourtData.filter(court => {
            if (!court.isActive) return false;

            // Check if there's actual game activity (scoring has started)
            const hasGameActivity =
                court.player1.score > 0 ||
                court.player2.score > 0 ||
                court.player1.games > 0 ||
                court.player2.games > 0 ||
                court.timerSeconds > 0;

            // Store match timing from database
            if (hasGameActivity) {
                courtMatchTimes[court.courtId] = {
                    matchStartTime: court.matchStartTime,
                    matchEndTime: court.matchEndTime
                };
            } else {
                // Remove match times if court becomes inactive
                delete courtMatchTimes[court.courtId];
            }

            return hasGameActivity;
        });

        hideLoading();
        displayCurrentPage();
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
        noMatchesMsg.style.display = 'block';
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
    const existingIds = Array.from(grid.querySelectorAll('.court-card')).map(el => el.dataset.courtId);
    const newIds = courtsToShow.map(c => String(c.courtId));
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
    const card = document.querySelector(`.court-card[data-court-id="${court.courtId}"]`);
    if (!card) return;

    const isDoubles = court.isDoubles || false;
    const isPaused = !!court.restBreakActive;

    // Toggle paused class
    card.classList.toggle('court-card--paused', isPaused);

    // Update pause label and timer immediately when pause state changes
    const pauseLabelEl = card.querySelector('.pause-label');
    if (pauseLabelEl) {
        pauseLabelEl.textContent = (court.restBreakTitle || '').toLowerCase().includes('sæt') ? 'SÆTHVIL' : 'PAUSE';
    }
    if (isPaused) {
        const pauseTimerEl = document.getElementById(`pause-timer-${court.courtId}`);
        if (pauseTimerEl) pauseTimerEl.textContent = formatTimer(getPauseSecondsLeft(court));
    }

    // Update scores
    const scoreEls = card.querySelectorAll('.player-score');
    if (scoreEls[0]) scoreEls[0].textContent = court.player1.score;
    if (scoreEls[1]) scoreEls[1].textContent = court.player2.score;

    // Update set counts
    const gamesEls = card.querySelectorAll('.games-value');
    if (gamesEls[0]) gamesEls[0].textContent = court.player1.games;
    if (gamesEls[1]) gamesEls[1].textContent = court.player2.games;

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

    // Update rest break badge
    let badge = card.querySelector('.rest-break-badge');
    if (court.restBreakActive) {
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'rest-break-badge';
            card.prepend(badge);
        }
        badge.textContent = `PAUSE ${court.restBreakSecondsLeft}s`;
    } else if (badge) {
        badge.remove();
    }
}

function renderCourtCard(court) {
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

    return `
        <div class="court-card${isPaused ? ' court-card--paused' : ''}" data-court-id="${court.courtId}">
            ${restBreakBadge}
            <div class="court-card-header">
                <div class="court-number">BANE ${court.courtId}</div>
                <div class="court-pause-header">
                    <div class="pause-label">${pauseLabel}</div>
                    <div class="pause-timer" id="pause-timer-${court.courtId}">${timerDisplay}</div>
                </div>
                <div class="court-timer" id="timer-${court.courtId}">${timerDisplay}</div>
            </div>

            <div class="court-players">
                <div class="player-row">
                    <div class="player-info">
                        ${player1Names}
                    </div>
                    <div class="player-stats">
                        <div class="player-score">${court.player1.score}</div>
                        <div class="player-games">
                            <span class="games-label">Sæt:</span>
                            <span class="games-value">${court.player1.games}</span>
                        </div>
                    </div>
                </div>

                <div class="vs-divider">VS</div>

                <div class="player-row">
                    <div class="player-info">
                        ${player2Names}
                    </div>
                    <div class="player-stats">
                        <div class="player-score">${court.player2.score}</div>
                        <div class="player-games">
                            <span class="games-label">Sæt:</span>
                            <span class="games-value">${court.player2.games}</span>
                        </div>
                    </div>
                </div>
            </div>

            ${bannerHtml}
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

function hideLoading() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.style.display = 'none';
}

function startAutoRefresh() {
    // Refresh court data every 2 seconds
    refreshTimer = setInterval(async () => {
        await loadAllCourts();
        await loadHoldkamp();
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
            pauseTimerEl.textContent = formatTimer(getPauseSecondsLeft(court));
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
