// Admin Panel JavaScript
const api = window.BadmintonAPI;
let refreshInterval = null;
let currentEditingCourt = null;
let allMatchesDisplayCount = 30;
let courtTimers = {}; // Store timer values and timestamps for each court
let timerUpdateInterval = null;
let allMatchesData = []; // Store all matches for filtering/sorting
let currentSearchTerm = '';
let currentCourtFilter = 'all';

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeAdmin();
    setupEventListeners();
});

function initializeAdmin() {
    // Check if already logged in (JWT token exists)
    if (api.token) {
        showDashboard();
    }
}

function setupEventListeners() {
    // Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            handleLogin();
        }
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Match History
    document.getElementById('matchHistoryBtn').addEventListener('click', showMatchHistory);
    document.getElementById('backToOverviewBtn').addEventListener('click', showCourtOverview);

    // Match History Search and Filter
    document.getElementById('matchSearchInput').addEventListener('input', handleMatchSearch);
    document.getElementById('courtFilterSelect').addEventListener('change', handleCourtFilter);
    document.getElementById('deleteAllMatchHistoryBtn').addEventListener('click', deleteAllMatchHistory);

    // Clear All Court Data
    document.getElementById('clearAllDataBtn').addEventListener('click', clearAllData);

    // Edit Court Modal
    const modal = document.getElementById('editCourtModal');
    const closeBtn = document.querySelector('.close-modal');

    closeBtn.onclick = function() {
        modal.style.display = 'none';
        currentEditingCourt = null;
    };

    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = 'none';
            currentEditingCourt = null;
        }
    };

    document.getElementById('saveCourtChanges').addEventListener('click', saveCourtChanges);
    document.getElementById('resetCourt').addEventListener('click', resetCourtConfirm);
    document.getElementById('editDoublesMode').addEventListener('change', toggleEditDoublesMode);

    // Setup autocomplete for player name fields
    setupPlayerNameAutocomplete('editPlayer1Name');
    setupPlayerNameAutocomplete('editPlayer1Name2');
    setupPlayerNameAutocomplete('editPlayer2Name');
    setupPlayerNameAutocomplete('editPlayer2Name2');
}

function toggleEditDoublesMode() {
    const isDoubles = document.getElementById('editDoublesMode').checked;
    const player1Name2 = document.getElementById('editPlayer1Name2');
    const player2Name2 = document.getElementById('editPlayer2Name2');
    const player1Name2Label = document.getElementById('editPlayer1Name2Label');
    const player2Name2Label = document.getElementById('editPlayer2Name2Label');

    if (isDoubles) {
        player1Name2.style.display = 'block';
        player2Name2.style.display = 'block';
        player1Name2Label.style.display = 'block';
        player2Name2Label.style.display = 'block';
    } else {
        player1Name2.style.display = 'none';
        player2Name2.style.display = 'none';
        player1Name2Label.style.display = 'none';
        player2Name2Label.style.display = 'none';
    }
}

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        showMessage('Fejl', 'Indtast venligst en adgangskode!');
        return;
    }

    try {
        await api.login(password);
        showDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('Fejl', 'Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    api.logout();
    stopAutoRefresh();
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('adminPassword').value = '';
}

async function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';

    try {
        // Load and display court overview
        await loadCourtOverview();

        // Start auto-refresh every 2 seconds
        startAutoRefresh();
    } catch (error) {
        console.error('Failed to load dashboard:', error);
        showMessage('Fejl', 'Kunne ikke indlæse dashboard data. Tjek din forbindelse.');
    }
}

function startAutoRefresh() {
    loadCourtOverview();
    refreshInterval = setInterval(loadCourtOverview, 1000);

    // Start timer update interval (every second)
    if (!timerUpdateInterval) {
        timerUpdateInterval = setInterval(updateAllTimerDisplays, 1000);
    }
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    if (timerUpdateInterval) {
        clearInterval(timerUpdateInterval);
        timerUpdateInterval = null;
    }
}

function updateAllTimerDisplays() {
    // Update all court timer displays based on match start time
    Object.keys(courtTimers).forEach(courtNumber => {
        const timerData = courtTimers[courtNumber];
        if (timerData && timerData.isActive && timerData.matchStartTime) {
            const startTime = new Date(timerData.matchStartTime);
            const endTime = timerData.matchEndTime ? new Date(timerData.matchEndTime) : new Date();
            const elapsedMs = endTime - startTime;
            const currentSeconds = Math.floor(elapsedMs / 1000);

            // Find the timer element for this court
            const timerElement = document.querySelector(`[data-court-timer="${courtNumber}"]`);
            if (timerElement) {
                timerElement.textContent = formatDuration(currentSeconds);
            }
        }
    });
}

async function loadCourtOverview() {
    try {
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;
        const courtOverview = document.getElementById('courtOverview');

        // Build all cards first before updating DOM (prevents flickering)
        const fragment = document.createDocumentFragment();

        for (let i = 1; i <= courtCount; i++) {
            const courtCard = await createCourtCard(i);
            fragment.appendChild(courtCard);
        }

        // Update DOM in one operation
        courtOverview.innerHTML = '';
        courtOverview.appendChild(fragment);
    } catch (error) {
        console.error('Failed to load court overview:', error);
        // Don't show alert during auto-refresh, just log
    }
}

async function createCourtCard(courtNumber) {
    const card = document.createElement('div');
    card.className = 'court-card';

    try {
        const state = await api.getGameState(courtNumber);

        if (!state || !state.isActive) {
            // Remove from active timers if court is inactive
            if (courtTimers[courtNumber]) {
                delete courtTimers[courtNumber];
            }

            card.innerHTML = `
                <div class="court-header">
                    <h3>Bane ${courtNumber}</h3>
                    <span class="court-status inactive">Inaktiv</span>
                </div>
                <div class="court-empty">
                    Ingen aktiv kamp
                </div>
                <div class="court-actions">
                    <button class="btn-edit" onclick="openEditModal(${courtNumber})">Redigér Bane</button>
                </div>
            `;
            return card;
        }

        const isActive = state.isActive;
        const isDoubles = state.isDoubles || false;
        const player1Display = isDoubles && state.player1.name2
            ? `${escapeHtml(state.player1.name)}<br>${escapeHtml(state.player1.name2)}`
            : escapeHtml(state.player1.name);
        const player2Display = isDoubles && state.player2.name2
            ? `${escapeHtml(state.player2.name)}<br>${escapeHtml(state.player2.name2)}`
            : escapeHtml(state.player2.name);

        // Store timer data for continuous updates
        courtTimers[courtNumber] = {
            matchStartTime: state.matchStartTime,
            matchEndTime: state.matchEndTime,
            isActive: isActive
        };

        card.innerHTML = `
            <div class="court-header">
                <h3>Bane ${courtNumber}${isDoubles ? ' <span style="font-size: 0.7em; color: #e94560;">(Double)</span>' : ''}</h3>
                <span class="court-status ${isActive ? 'active' : 'inactive'}">
                    ${isActive ? 'Aktiv' : 'Inaktiv'}
                </span>
            </div>
            <div class="court-match">
                <div class="court-players">
                    <div class="player-info">
                        <div class="player-name">${player1Display}</div>
                        <div class="player-score">${state.player1.score}</div>
                    </div>
                    <div class="vs-divider">VS</div>
                    <div class="player-info">
                        <div class="player-name">${player2Display}</div>
                        <div class="player-score">${state.player2.score}</div>
                    </div>
                </div>
                <div class="court-meta">
                    <div class="meta-item">
                        <span class="meta-label">Sæt Vundet</span>
                        <span class="meta-value">${state.player1.games} - ${state.player2.games}</span>
                    </div>
                    <div class="meta-item">
                        <span class="meta-label">Varighed</span>
                        <span class="meta-value" data-court-timer="${courtNumber}">${calculateElapsedTime(state)}</span>
                    </div>
                </div>
            </div>
            <div class="court-actions">
                <button class="btn-edit" onclick="openEditModal(${courtNumber})">Redigér Bane</button>
            </div>
        `;

        return card;
    } catch (error) {
        console.error(`Failed to load court ${courtNumber}:`, error);
        // Show empty court card on error
        card.innerHTML = `
            <div class="court-header">
                <h3>Bane ${courtNumber}</h3>
                <span class="court-status inactive">Inaktiv</span>
            </div>
            <div class="court-empty">
                Kunne ikke indlæse data
            </div>
            <div class="court-actions">
                <button class="btn-edit" onclick="openEditModal(${courtNumber})">Redigér Bane</button>
            </div>
        `;
        return card;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function calculateElapsedTime(state) {
    if (!state.matchStartTime) {
        return '00:00';
    }

    const startTime = new Date(state.matchStartTime);
    const endTime = state.matchEndTime ? new Date(state.matchEndTime) : new Date();
    const elapsedMs = endTime - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    return formatDuration(elapsedSeconds);
}

// saveCourtCount and changePassword functions moved to settings-script.js

async function deleteAllMatchHistory() {
    showMessage(
        'ADVARSEL',
        'Er du sikker på at du vil slette ALT kamphistorik? Dette kan ikke fortrydes!',
        [
            {
                text: 'Ja, Fortsæt',
                callback: () => {
                    showMessage(
                        'SIDSTE ADVARSEL',
                        'Dette vil permanent slette hele kamphistorikken. Er du helt sikker?',
                        [
                            {
                                text: 'Ja, Slet Alt',
                                callback: async () => {
                                    try {
                                        await api.deleteAllMatchHistory();
                                        showMessage('Succes', 'Alt kamphistorik er blevet slettet!');
                                        await loadAllMatches();
                                    } catch (error) {
                                        console.error('Failed to delete match history:', error);
                                        showMessage('Fejl', 'Kunne ikke slette kamphistorik. Tjek din forbindelse.');
                                    }
                                },
                                style: 'danger'
                            },
                            { text: 'Annuller', callback: null, style: 'secondary' }
                        ]
                    );
                },
                style: 'danger'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
}

async function clearAllData() {
    showMessage(
        'ADVARSEL',
        'Er du sikker på at du vil nulstille ALLE baner? Dette vil slette alle point og spiltilstande!',
        [
            {
                text: 'Ja, Fortsæt',
                callback: () => {
                    showMessage(
                        'SIDSTE ADVARSEL',
                        'Dette vil nulstille alle baner. Er du helt sikker?',
                        [
                            {
                                text: 'Ja, Nulstil Alt',
                                callback: async () => {
                                    try {
                                        const settings = await api.getSettings();
                                        const courtCount = settings.courtCount || 4;

                                        // Reset all courts
                                        for (let i = 1; i <= courtCount; i++) {
                                            await api.resetGameState(i);
                                        }

                                        showMessage('Succes', 'Alle baner er blevet nulstillet!');
                                        await loadCourtOverview();
                                    } catch (error) {
                                        console.error('Failed to clear all data:', error);
                                        showMessage('Fejl', 'Kunne ikke nulstille baner. Tjek din forbindelse.');
                                    }
                                },
                                style: 'danger'
                            },
                            { text: 'Annuller', callback: null, style: 'secondary' }
                        ]
                    );
                },
                style: 'danger'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
}

async function openEditModal(courtNumber) {
    currentEditingCourt = courtNumber;

    document.getElementById('editCourtNumber').textContent = courtNumber;

    try {
        const state = await api.getGameState(courtNumber);

        if (state && state.player1 && state.player2) {
            // Only set values if they're not the default placeholder text
            document.getElementById('editPlayer1Name').value = (state.player1.name && state.player1.name !== 'Spiller 1') ? state.player1.name : '';
            document.getElementById('editPlayer2Name').value = (state.player2.name && state.player2.name !== 'Spiller 2') ? state.player2.name : '';
            document.getElementById('editPlayer1Name2').value = (state.player1.name2 && state.player1.name2 !== 'Makker 1') ? state.player1.name2 : '';
            document.getElementById('editPlayer2Name2').value = (state.player2.name2 && state.player2.name2 !== 'Makker 2') ? state.player2.name2 : '';
            document.getElementById('editCourtActive').checked = state.isActive || false;
            document.getElementById('editDoublesMode').checked = state.isDoubles || false;
            document.getElementById('editGameMode').checked = (state.gameMode === '15');
        } else {
            // Empty values for new court (placeholder will show)
            document.getElementById('editPlayer1Name').value = '';
            document.getElementById('editPlayer2Name').value = '';
            document.getElementById('editPlayer1Name2').value = '';
            document.getElementById('editPlayer2Name2').value = '';
            document.getElementById('editCourtActive').checked = false;
            document.getElementById('editDoublesMode').checked = false;
            document.getElementById('editGameMode').checked = false;
        }

        // Update visibility of partner fields
        toggleEditDoublesMode();

        document.getElementById('editCourtModal').style.display = 'block';
    } catch (error) {
        console.error(`Failed to load court ${courtNumber} for editing:`, error);
        showMessage('Fejl', 'Kunne ikke indlæse banedata. Tjek din forbindelse.');
    }
}

async function saveCourtChanges() {
    if (!currentEditingCourt) return;

    // Get values, use placeholder text only if field is empty
    const player1Value = document.getElementById('editPlayer1Name').value.trim();
    const player2Value = document.getElementById('editPlayer2Name').value.trim();
    const player1Value2 = document.getElementById('editPlayer1Name2').value.trim();
    const player2Value2 = document.getElementById('editPlayer2Name2').value.trim();

    const newPlayer1Name = player1Value || 'Spiller 1';
    const newPlayer2Name = player2Value || 'Spiller 2';
    const newPlayer1Name2 = player1Value2 || 'Makker 1';
    const newPlayer2Name2 = player2Value2 || 'Makker 2';
    const isActive = document.getElementById('editCourtActive').checked;
    const isDoubles = document.getElementById('editDoublesMode').checked;
    const gameMode = document.getElementById('editGameMode').checked ? '15' : '21';

    console.log('[DEBUG] Saving court changes:', {
        courtId: currentEditingCourt,
        isActive,
        isDoubles,
        gameMode
    });

    try {
        // Get current state
        const state = await api.getGameState(currentEditingCourt);

        // Update court settings (isActive, isDoubles, gameMode) - separate endpoint
        console.log('[DEBUG] Calling api.updateCourt with:', {
            isActive,
            isDoubles,
            gameMode
        });

        const courtResult = await api.updateCourt(currentEditingCourt, {
            isActive: isActive,
            isDoubles: isDoubles,
            gameMode: gameMode
        });

        console.log('[DEBUG] Court update result:', courtResult);

        // Update game state (player names, scores, etc.)
        // Use skipAutoActive=true to prevent overwriting the manually set isActive status
        const updatedState = {
            player1: {
                name: newPlayer1Name,
                name2: newPlayer1Name2,
                score: state?.player1?.score || 0,
                games: state?.player1?.games || 0
            },
            player2: {
                name: newPlayer2Name,
                name2: newPlayer2Name2,
                score: state?.player2?.score || 0,
                games: state?.player2?.games || 0
            },
            timerSeconds: state?.timerSeconds || 0,
            decidingGameSwitched: state?.decidingGameSwitched || false
        };

        console.log('[DEBUG] Calling api.updateGameState with skipAutoActive=true');
        const stateResult = await api.updateGameState(currentEditingCourt, updatedState, true);
        console.log('[DEBUG] Game state update result:', stateResult);

        document.getElementById('editCourtModal').style.display = 'none';
        currentEditingCourt = null;
        await loadCourtOverview();
    } catch (error) {
        console.error('[DEBUG] Failed to save court changes:', error);
        showMessage('Fejl', 'Kunne ikke gemme ændringer. Tjek din forbindelse.');
    }
}

async function resetCourtConfirm() {
    if (!currentEditingCourt) return;

    showMessage(
        'Bekræft Nulstilling',
        `Er du sikker på at du vil nulstille Bane ${currentEditingCourt}? Dette vil rydde alle point og tidtagerdata for denne bane.`,
        [
            {
                text: 'Ja, Nulstil',
                callback: async () => {
                    try {
                        await api.resetGameState(currentEditingCourt);

                        document.getElementById('editCourtModal').style.display = 'none';
                        currentEditingCourt = null;
                        await loadCourtOverview();
                    } catch (error) {
                        console.error('Failed to reset court:', error);
                        showMessage('Fejl', 'Kunne ikke nulstille bane. Tjek din forbindelse.');
                    }
                },
                style: 'danger'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
}

async function showMatchHistory() {
    document.getElementById('courtOverviewSection').style.display = 'none';
    document.getElementById('matchHistorySection').style.display = 'block';
    await loadAllMatches();
}

function showCourtOverview() {
    document.getElementById('matchHistorySection').style.display = 'none';
    document.getElementById('courtOverviewSection').style.display = 'block';
}

async function loadAllMatches() {
    try {
        // Get all match history from API
        allMatchesData = await api.getAllMatchHistory();

        // Populate court filter dropdown
        populateCourtFilter();

        // Apply current filters and display
        displayFilteredMatches();
    } catch (error) {
        console.error('Failed to load match history:', error);
        const container = document.getElementById('allMatchesContainer');
        container.innerHTML = '<div style="color: #e94560; text-align: center; padding: 40px; font-size: 1.2em;">Kunne ikke indlæse kamphistorik. Tjek din forbindelse.</div>';
    }
}

function populateCourtFilter() {
    // Get unique court numbers from matches
    const courtNumbers = [...new Set(allMatchesData.map(match => match.court_id))].sort((a, b) => a - b);

    // Populate dropdown
    const select = document.getElementById('courtFilterSelect');

    // Keep "Alle baner" option and remove old court options
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Add court number options
    courtNumbers.forEach(courtNum => {
        const option = document.createElement('option');
        option.value = courtNum;
        option.textContent = `Bane ${courtNum}`;
        select.appendChild(option);
    });
}

function displayFilteredMatches() {
    const container = document.getElementById('allMatchesContainer');

    if (allMatchesData.length === 0) {
        container.innerHTML = '<div style="color: #999; text-align: center; padding: 40px; font-size: 1.2em;">Ingen kamphistorik tilgængelig</div>';
        return;
    }

    // Filter matches by search term and court number
    let filteredMatches = allMatchesData.filter(match => {
        // Filter by search term
        if (currentSearchTerm) {
            const searchLower = currentSearchTerm.toLowerCase();
            const matchesSearch = match.winner_name.toLowerCase().includes(searchLower) ||
                                 match.loser_name.toLowerCase().includes(searchLower);
            if (!matchesSearch) return false;
        }

        // Filter by court number
        if (currentCourtFilter !== 'all') {
            const courtId = parseInt(currentCourtFilter);
            if (match.court_id !== courtId) return false;
        }

        return true;
    });

    // Always sort by date (newest first)
    filteredMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

    // Clear container
    container.innerHTML = '';

    if (filteredMatches.length === 0) {
        container.innerHTML = '<div style="color: #999; text-align: center; padding: 40px; font-size: 1.2em;">Ingen kampe fundet</div>';
        return;
    }

    // Display matches (up to allMatchesDisplayCount)
    const displayMatches = filteredMatches.slice(0, allMatchesDisplayCount);

    displayMatches.forEach((match, index) => {
        const matchCard = createMatchCard(match, index);
        container.appendChild(matchCard);
    });

    // Add "Show More" button if there are more than allMatchesDisplayCount matches
    if (filteredMatches.length > allMatchesDisplayCount) {
        const showMoreBtn = document.createElement('button');
        showMoreBtn.textContent = `Vis Flere Kampe (${filteredMatches.length - allMatchesDisplayCount} flere)`;
        showMoreBtn.style.cssText = 'width: 100%; padding: 15px; background: #533483; color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 1em; font-weight: bold; margin-top: 10px;';
        showMoreBtn.onclick = showMoreMatches;
        container.appendChild(showMoreBtn);
    }
}

function handleMatchSearch(e) {
    currentSearchTerm = e.target.value.trim();
    allMatchesDisplayCount = 30; // Reset display count when searching
    displayFilteredMatches();
}

function handleCourtFilter(e) {
    currentCourtFilter = e.target.value;
    displayFilteredMatches();
}

function formatSetScoreWithBold(scoreText) {
    // Format can be either "21-19" or "Player1 21-19 Player2"
    const trimmed = scoreText.trim();

    // Try to match pattern: "Name Score-Score Name" or just "Score-Score"
    const fullMatch = trimmed.match(/^(.+?)\s+(\d+)-(\d+)\s+(.+)$/);

    if (fullMatch) {
        // Format: "Player1 21-19 Player2"
        const player1Name = fullMatch[1];
        const score1 = parseInt(fullMatch[2]);
        const score2 = parseInt(fullMatch[3]);
        const player2Name = fullMatch[4];

        if (isNaN(score1) || isNaN(score2)) {
            return escapeHtml(trimmed);
        }

        // Put winner first (name and score in bold)
        if (score1 > score2) {
            return `<strong>${escapeHtml(player1Name)} ${score1}</strong>-${score2} ${escapeHtml(player2Name)}`;
        } else if (score2 > score1) {
            // Swap order so winner is first
            return `<strong>${escapeHtml(player2Name)} ${score2}</strong>-${score1} ${escapeHtml(player1Name)}`;
        } else {
            return `${escapeHtml(player1Name)} ${score1}-${score2} ${escapeHtml(player2Name)}`;
        }
    } else {
        // Try simpler format: just "Score-Score"
        const scoreMatch = trimmed.match(/(\d+)-(\d+)/);

        if (!scoreMatch) {
            return escapeHtml(trimmed);
        }

        const score1 = parseInt(scoreMatch[1]);
        const score2 = parseInt(scoreMatch[2]);

        if (isNaN(score1) || isNaN(score2)) {
            return escapeHtml(trimmed);
        }

        // Put higher score first
        if (score1 > score2) {
            return `<strong>${score1}</strong>-${score2}`;
        } else if (score2 > score1) {
            return `<strong>${score2}</strong>-${score1}`;
        } else {
            return `${score1}-${score2}`;
        }
    }
}

function createMatchCard(match, index) {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.dataset.matchId = index;

    // Parse set scores if available
    const setScoresArray = match.set_scores ? match.set_scores.split(', ') : [];
    const hasSetDetails = setScoresArray.length > 0;

    // Main match info (always visible)
    const mainInfo = document.createElement('div');
    mainInfo.className = 'match-main-info';
    mainInfo.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; cursor: ${hasSetDetails ? 'pointer' : 'default'};">
            <div style="flex: 1;">
                <div style="font-weight: bold; font-size: 1.1em; color: #e94560; margin-bottom: 5px;">
                    <strong>${escapeHtml(match.winner_name)}</strong> besejrede ${escapeHtml(match.loser_name)}
                </div>
                <div style="color: #aaa; font-size: 0.9em;">
                    Sæt: ${match.games_won} | Varighed: ${match.duration} | Bane ${match.court_id}
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 15px;">
                <div style="color: #999; font-size: 0.85em;">
                    ${new Date(match.match_date).toLocaleDateString('da-DK')}
                </div>
                ${hasSetDetails ? '<div class="expand-icon" style="color: #e94560; font-size: 1.2em;">▼</div>' : ''}
            </div>
        </div>
    `;

    // Details section (hidden by default)
    const details = document.createElement('div');
    details.className = 'match-details';
    details.style.display = 'none';

    if (hasSetDetails) {
        details.innerHTML = `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(233, 69, 96, 0.3);">
                <div style="font-weight: bold; margin-bottom: 10px; color: #eaeaea;">Sæt detaljer:</div>
                ${setScoresArray.map((score, i) => {
                    const formattedScore = formatSetScoreWithBold(score);
                    return `
                        <div style="padding: 8px 12px; background: rgba(83, 52, 131, 0.3); border-radius: 5px; margin-bottom: 5px; display: flex; justify-content: space-between;">
                            <span style="color: #eaeaea;">Sæt ${i + 1}:</span>
                            <span style="color: #e94560;">${formattedScore}</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;

        // Add click handler to toggle details
        mainInfo.addEventListener('click', () => {
            const isExpanded = details.style.display === 'block';
            details.style.display = isExpanded ? 'none' : 'block';
            const icon = mainInfo.querySelector('.expand-icon');
            if (icon) {
                icon.textContent = isExpanded ? '▼' : '▲';
            }
        });
    }

    card.appendChild(mainInfo);
    card.appendChild(details);

    return card;
}

function showMoreMatches() {
    allMatchesDisplayCount += 30;
    displayFilteredMatches();
}

// Message overlay functions (replaces alert/confirm dialogs)
function showMessage(title, text, buttons = [{ text: 'OK', callback: null, style: 'primary' }]) {
    const overlay = document.getElementById('messageOverlay');
    const titleElement = document.getElementById('messageTitle');
    const textElement = document.getElementById('messageText');
    const buttonsContainer = document.getElementById('messageButtons');

    titleElement.textContent = title;
    textElement.textContent = text;

    // Clear existing buttons
    buttonsContainer.innerHTML = '';

    // Add buttons
    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.textContent = button.text;
        btn.className = button.style === 'secondary' ? 'btn-secondary' : (button.style === 'danger' ? 'btn-danger' : 'btn-primary');
        btn.style.fontSize = '1.5em';
        btn.style.padding = '15px 40px';
        btn.style.cursor = 'pointer';

        btn.onclick = () => {
            hideMessage();
            if (button.callback) {
                button.callback();
            }
        };

        buttonsContainer.appendChild(btn);
    });

    overlay.style.display = 'flex';
}

function hideMessage() {
    const overlay = document.getElementById('messageOverlay');
    overlay.style.display = 'none';
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
});

// ===== Player Name Autocomplete Functionality =====

let autocompleteTimeout = null;
let activeAutocompleteField = null;

function setupPlayerNameAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    // Create autocomplete container
    const autocompleteContainer = document.createElement('div');
    autocompleteContainer.id = `${inputId}-autocomplete`;
    autocompleteContainer.className = 'autocomplete-dropdown';
    autocompleteContainer.style.display = 'none';

    // Insert after input field
    input.parentNode.insertBefore(autocompleteContainer, input.nextSibling);

    // Add input event listener
    input.addEventListener('input', function(e) {
        const searchTerm = e.target.value.trim();

        // Clear previous timeout
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }

        // Hide dropdown if search term is empty
        if (searchTerm.length === 0) {
            hideAutocomplete(inputId);
            return;
        }

        // Debounce search - wait 300ms after user stops typing
        autocompleteTimeout = setTimeout(() => {
            searchPlayers(searchTerm, inputId);
        }, 300);
    });

    // Handle focus
    input.addEventListener('focus', function() {
        activeAutocompleteField = inputId;
    });

    // Handle blur with delay to allow clicking on dropdown
    input.addEventListener('blur', function() {
        setTimeout(() => {
            if (activeAutocompleteField === inputId) {
                hideAutocomplete(inputId);
            }
        }, 200);
    });
}

async function searchPlayers(searchTerm, inputId) {
    try {
        const response = await fetch(`/api/player-info/search?q=${encodeURIComponent(searchTerm)}`);

        if (!response.ok) {
            console.error('Failed to search players:', response.statusText);
            return;
        }

        const players = await response.json();
        showAutocompleteResults(players, inputId);
    } catch (error) {
        console.error('Error searching players:', error);
    }
}

function showAutocompleteResults(players, inputId) {
    const container = document.getElementById(`${inputId}-autocomplete`);
    if (!container) return;

    // Clear previous results
    container.innerHTML = '';

    if (players.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Create dropdown items
    players.forEach(player => {
        const item = document.createElement('div');
        item.className = 'autocomplete-item';

        // Display name with club and age group info
        const infoText = [player.club, player.age_group, player.gender]
            .filter(x => x)
            .join(' • ');

        item.innerHTML = `
            <div class="autocomplete-name">${escapeHtml(player.name)}</div>
            <div class="autocomplete-info">${escapeHtml(infoText)}</div>
        `;

        item.addEventListener('mousedown', function(e) {
            e.preventDefault(); // Prevent input blur
            selectPlayer(player.name, inputId);
        });

        container.appendChild(item);
    });

    container.style.display = 'block';
}

function selectPlayer(playerName, inputId) {
    const input = document.getElementById(inputId);
    if (input) {
        input.value = playerName;
    }
    hideAutocomplete(inputId);
}

function hideAutocomplete(inputId) {
    const container = document.getElementById(`${inputId}-autocomplete`);
    if (container) {
        container.style.display = 'none';
    }
    if (activeAutocompleteField === inputId) {
        activeAutocompleteField = null;
    }
}
