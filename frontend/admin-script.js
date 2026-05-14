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

// Holdkamp format definitions
const HOLDKAMP_FORMATS = {
    liga11:    { name: 'Liga (11 kampe)',         games: ['MD','MD','DS','DS','HS','HS','HS','DD','DD','HD','HD'] },
    '13kamps': { name: '13-kamps format',          games: ['HS','HS','HS','HS','DS','DS','HD','HD','HD','DD','DD','MD','MD'] },
    '2plus2':  { name: '2+2-format (8 kampe)',     games: ['MD','MD','DS','DS','HS','HS','DD','HD'] },
    '4plus2':  { name: '4+2-format (8 kampe)',     games: ['MD','DS','HS','HS','HS','DD','HD','HD'] },
    '4plus3':  { name: '4+3-format (9 kampe)',     games: ['MD','MD','DS','DS','HS','HS','DD','HD','HD'] },
    '4spillere':{ name: '4-spillere (6 kampe)',    games: ['Single','Single','Single','Single','Double','Double'] }
};
const DOUBLES_CATEGORIES = ['MD', 'DD', 'HD', 'Double'];

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeAdmin();
    setupEventListeners();
});

async function initializeAdmin() {
    // Multi-tenant: klub admin login via club-login.html — redirect hertil hvis ikke logget ind
    try {
        const mode = await api.getMode();
        if (mode.mode === 'club' && !api.token) {
            window.location.href = '/club-login.html';
            return;
        }
        // Vis "Adgangslinks" knap kun til klub admins på klub-subdomains
        if (mode.mode === 'club' && api.isClubAdminSession()) {
            document.getElementById('deviceTokensBtn').style.display = 'inline-block';
        }
    } catch {}

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

    // Device Tokens
    document.getElementById('deviceTokensBtn').addEventListener('click', showDeviceTokens);
    document.getElementById('createDtBtn').addEventListener('click', handleCreateDeviceToken);

    // Nav overview button
    document.getElementById('backToOverviewNavBtn').addEventListener('click', showCourtOverview);

    // Holdkamp
    document.getElementById('holdkampBtn').addEventListener('click', showHoldkamp);
    document.getElementById('backFromHoldkampBtn').addEventListener('click', showCourtOverview);
    document.getElementById('holdkampFormat').addEventListener('change', onHoldkampFormatChange);
    document.getElementById('startHoldkampBtn').addEventListener('click', startHoldkamp);

    // badmintonplayer.dk import
    document.getElementById('bpImportBtn').addEventListener('click', bpImport);
    document.getElementById('bpImportUrl').addEventListener('keypress', e => { if (e.key === 'Enter') bpImport(); });

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

        // Navigate to section specified in URL hash (e.g. admin.html#holdkamp)
        const hash = window.location.hash;
        if (hash === '#holdkamp') {
            await showHoldkamp();
        } else if (hash === '#history') {
            await showMatchHistory();
        } else if (hash === '#device-tokens') {
            showDeviceTokens();
        }
    } catch (error) {
        console.error('Failed to load dashboard:', error);
        showMessage('Fejl', 'Kunne ikke indlæse dashboard data. Tjek din forbindelse.');
    }
}

function startAutoRefresh() {
    loadCourtOverview();
    // Reduced from 1000ms to 2500ms to decrease server load (saves 60% API calls)
    refreshInterval = setInterval(loadCourtOverview, 2500);

    // Start timer update interval (every second for smooth display)
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
                <h3>Bane ${courtNumber}${isDoubles ? ' <span style="font-size: 0.7em; color: var(--color-accent);">(Double)</span>' : ''}</h3>
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

// escapeHtml moved to utils.js
const escapeHtml = window.BadmintonUtils.escapeHtml;

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
    const isTeam = activeHistoryTab === 'team';
    const title = isTeam ? 'ADVARSEL' : 'ADVARSEL';
    const msg1 = isTeam
        ? 'Er du sikker på at du vil slette AL holdkamphistorik? Dette kan ikke fortrydes!'
        : 'Er du sikker på at du vil slette ALT kamphistorik? Dette kan ikke fortrydes!';
    const msg2 = isTeam
        ? 'Dette vil permanent slette hele holdkamphistorikken. Er du helt sikker?'
        : 'Dette vil permanent slette hele kamphistorikken. Er du helt sikker?';
    const successMsg = isTeam
        ? 'Al holdkamphistorik er blevet slettet!'
        : 'Alt kamphistorik er blevet slettet!';

    showMessage(
        title,
        msg1,
        [
            {
                text: 'Ja, Fortsæt',
                callback: () => {
                    showMessage(
                        'SIDSTE ADVARSEL',
                        msg2,
                        [
                            {
                                text: 'Ja, Slet Alt',
                                callback: async () => {
                                    try {
                                        if (isTeam) {
                                            await api.deleteAllTeamMatches();
                                            showMessage('Succes', successMsg);
                                            await loadTeamMatchHistory();
                                        } else {
                                            await api.deleteAllMatchHistory();
                                            showMessage('Succes', successMsg);
                                            await loadAllMatches();
                                        }
                                    } catch (error) {
                                        console.error('Failed to delete match history:', error);
                                        showMessage('Fejl', 'Kunne ikke slette historik. Tjek din forbindelse.');
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

                                        // Reset all courts and set them to single mode
                                        for (let i = 1; i <= courtCount; i++) {
                                            await api.resetGameState(i);
                                            // Set court to single mode (isDoubles = false)
                                            await api.updateCourt(i, { isDoubles: false });
                                        }

                                        showMessage('Succes', 'Alle baner er blevet nulstillet og sat til single!');
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

    // Check if any changes have been made (names entered or settings changed)
    const hasChanges = player1Value || player2Value || player1Value2 || player2Value2;

    // If changes were made but court is not marked as active, ask user
    if (hasChanges && !isActive) {
        showMessage(
            'Markér banen som aktiv?',
            'Du har lavet ændringer til banen. Vil du markere banen som aktiv?',
            [
                {
                    text: 'Ja, Markér som Aktiv',
                    callback: () => {
                        // Set checkbox to checked and save
                        document.getElementById('editCourtActive').checked = true;
                        performSaveCourtChanges(true);
                    },
                    style: 'primary'
                },
                {
                    text: 'Nej, Gem uden at Aktivere',
                    callback: () => {
                        performSaveCourtChanges(false);
                    },
                    style: 'secondary'
                },
                {
                    text: 'Annuller',
                    callback: null,
                    style: 'secondary'
                }
            ]
        );
        return;
    }

    // No changes or already active - save directly
    await performSaveCourtChanges(isActive);
}

async function performSaveCourtChanges(isActive) {
    if (!currentEditingCourt) return;

    // Get values again
    const player1Value = document.getElementById('editPlayer1Name').value.trim();
    const player2Value = document.getElementById('editPlayer2Name').value.trim();
    const player1Value2 = document.getElementById('editPlayer1Name2').value.trim();
    const player2Value2 = document.getElementById('editPlayer2Name2').value.trim();

    const newPlayer1Name = player1Value || 'Spiller 1';
    const newPlayer2Name = player2Value || 'Spiller 2';
    const newPlayer1Name2 = player1Value2 || 'Makker 1';
    const newPlayer2Name2 = player2Value2 || 'Makker 2';
    const isDoubles = document.getElementById('editDoublesMode').checked;
    const gameMode = document.getElementById('editGameMode').checked ? '15' : '21';

    try {
        // Get current state
        const state = await api.getGameState(currentEditingCourt);

        // Update court settings (isActive, isDoubles, gameMode) - separate endpoint
        const courtResult = await api.updateCourt(currentEditingCourt, {
            isActive: isActive,
            isDoubles: isDoubles,
            gameMode: gameMode
        });

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

        const stateResult = await api.updateGameState(currentEditingCourt, updatedState, true);

        document.getElementById('editCourtModal').style.display = 'none';
        currentEditingCourt = null;
        await loadCourtOverview();
    } catch (error) {
        console.error('Failed to save court changes:', error);
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

let activeHistoryTab = 'single';

async function showMatchHistory() {
    stopHoldkampRefresh();
    hideAllSections();
    document.getElementById('matchHistorySection').style.display = 'block';
    setNavActive('history');
    history.replaceState(null, '', '#history');
    await loadActiveHistoryTab();
}

function switchHistoryTab(tab) {
    activeHistoryTab = tab;
    const isSingle = tab === 'single';

    document.getElementById('singleMatchesTab').style.display = isSingle ? 'block' : 'none';
    document.getElementById('teamMatchesTab').style.display = isSingle ? 'none' : 'block';

    document.getElementById('tabSingleMatches').style.background = isSingle ? 'var(--color-primary)' : 'transparent';
    document.getElementById('tabSingleMatches').style.color = isSingle ? '#fff' : '#aaa';
    document.getElementById('tabSingleMatches').style.borderBottomColor = isSingle ? 'var(--color-primary)' : 'transparent';

    document.getElementById('tabTeamMatches').style.background = isSingle ? 'transparent' : 'var(--color-primary)';
    document.getElementById('tabTeamMatches').style.color = isSingle ? '#aaa' : '#fff';
    document.getElementById('tabTeamMatches').style.borderBottomColor = isSingle ? 'transparent' : 'var(--color-primary)';

    const isTeam = tab === 'team';
    const btn = document.getElementById('deleteAllMatchHistoryBtn');
    if (btn) btn.textContent = isTeam ? 'Slet Alt Holdkamphistorik' : 'Slet Alt Kamphistorik';

    loadActiveHistoryTab();
}

async function loadActiveHistoryTab() {
    if (activeHistoryTab === 'single') {
        await loadAllMatches();
    } else {
        await loadTeamMatchHistory();
    }
}

async function loadTeamMatchHistory() {
    const container = document.getElementById('teamMatchHistoryContainer');
    try {
        const matches = await api.getTeamMatchHistory();
        if (!matches || matches.length === 0) {
            container.innerHTML = '';
            return;
        }

        const formatNames = {
            liga11:      'Liga (11 kampe)',
            '13kamps':   '13-kamps format',
            '2plus2':    '2+2-format (8 kampe)',
            '4plus2':    '4+2-format (8 kampe)',
            '4plus3':    '4+3-format (9 kampe)',
            '4spillere': '4-spillere (6 kampe)'
        };
        const DOUBLES = ['MD', 'DD', 'HD', 'Double'];

        const cards = matches.map((tm, i) => {
            const team1Wins = tm.games.filter(g => g.winner_team === 1).length;
            const team2Wins = tm.games.filter(g => g.winner_team === 2).length;
            const date = new Date(tm.created_at).toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' });
            const formatLabel = formatNames[tm.format] || tm.format;

            const counts = {};
            const gameRows = tm.games.map(g => {
                counts[g.category] = (counts[g.category] || 0) + 1;
                const num = counts[g.category];
                const isDoubles = DOUBLES.includes(g.category);
                const t1 = isDoubles
                    ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
                    : (g.team1_player1 || '?');
                const t2 = isDoubles
                    ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
                    : (g.team2_player1 || '?');

                let resultHtml = '<span style="color:#aaa; font-size:0.8em;">Ikke spillet</span>';
                let rowBorder = '#444';
                if (g.status === 'finished' && g.winner_team) {
                    const winnerName = g.winner_team === 1 ? tm.team1_name : tm.team2_name;
                    const winnerColor = g.winner_team === 1 ? '#4CAF50' : 'var(--color-accent)';
                    const scoreNums = g.set_scores ? (g.set_scores.match(/\d+-\d+/g) || []).join(' · ') : '';
                    const scores = scoreNums ? `<span style="color:#aaa; font-size:0.8em; margin-left:6px;">${scoreNums}</span>` : '';
                    resultHtml = `<span style="color:${winnerColor}; font-size:0.85em; font-weight:bold;">✓ ${escapeHtml(winnerName)}</span>${scores}`;
                    rowBorder = winnerColor;
                }

                return `<div style="display:flex; align-items:center; gap:10px; padding:7px 10px; border-left:3px solid ${rowBorder}; background:rgba(255,255,255,0.03); border-radius:4px; margin-bottom:4px; flex-wrap:wrap;">
                    <span style="background:var(--color-accent); color:#fff; padding:2px 7px; border-radius:4px; font-size:0.78em; font-weight:bold; white-space:nowrap;">${escapeHtml(g.category)} ${num}</span>
                    <span style="color:#eaeaea; font-size:0.85em; flex:1; min-width:120px;">${escapeHtml(t1)} <span style="color:#aaa;">vs</span> ${escapeHtml(t2)}</span>
                    ${resultHtml}
                </div>`;
            }).join('');

            return `<div style="background:rgba(var(--color-primary-rgb),0.15); border:1px solid var(--color-primary); border-radius:8px; margin-bottom:12px; overflow:hidden;">
                <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; cursor:pointer; flex-wrap:wrap; gap:8px;" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
                    <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                        <span style="font-size:1.1em; font-weight:bold; color:#eaeaea;">${escapeHtml(tm.team1_name)} <span style="color:#4CAF50;">${team1Wins}</span> – <span style="color:var(--color-accent);">${team2Wins}</span> ${escapeHtml(tm.team2_name)}</span>
                        <span style="color:#aaa; font-size:0.82em;">${formatLabel}</span>
                        <span style="color:#666; font-size:0.8em;">${date}</span>
                    </div>
                    <span style="color:#aaa; font-size:0.85em;">▼ Se delkampe</span>
                </div>
                <div style="display:none; padding:0 16px 12px;">
                    ${gameRows}
                </div>
            </div>`;
        }).join('');

        container.innerHTML = `
            <h3 style="color:#eaeaea; margin-bottom:12px; font-size:1.1em; border-bottom:1px solid #333; padding-bottom:8px;">🏸 Holdkampe (${matches.length})</h3>
            ${cards}`;
    } catch (error) {
        console.error('Failed to load team match history:', error);
        container.innerHTML = '';
    }
}

function hideAllSections() {
    ['courtOverviewSection', 'holdkampSection', 'matchHistorySection', 'deviceTokensSection']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
}

function showCourtOverview() {
    stopHoldkampRefresh();
    document.getElementById('matchHistorySection').style.display = 'none';
    document.getElementById('holdkampSection').style.display = 'none';
    document.getElementById('deviceTokensSection').style.display = 'none';
    document.getElementById('courtOverviewSection').style.display = 'block';
    setNavActive('overview');
    history.replaceState(null, '', '#');
}

function setNavActive(section) {
    document.querySelectorAll('#adminNavRow .btn-primary').forEach(btn => {
        btn.classList.remove('admin-nav-active');
    });
    const overviewBtn = document.getElementById('backToOverviewNavBtn');
    if (section === 'overview' || !section) {
        if (overviewBtn) overviewBtn.style.display = 'none';
    } else {
        if (overviewBtn) overviewBtn.style.display = '';
        const btn = document.querySelector(`#adminNavRow [data-section="${section}"]`);
        if (btn) btn.classList.add('admin-nav-active');
    }
}

// ==================== HOLDKAMP ====================

let holdkampRefreshTimer = null;
let holdkampEditOpen = false;

async function showHoldkamp() {
    hideAllSections();
    document.getElementById('holdkampSection').style.display = 'block';
    setNavActive('holdkamp');
    history.replaceState(null, '', '#holdkamp');
    await loadActiveHoldkamp();
    // Poll every 3 seconds for live scores
    if (!holdkampRefreshTimer) {
        holdkampRefreshTimer = setInterval(loadActiveHoldkamp, 3000);
    }
}

function stopHoldkampRefresh() {
    if (holdkampRefreshTimer) {
        clearInterval(holdkampRefreshTimer);
        holdkampRefreshTimer = null;
    }
}

async function loadActiveHoldkamp() {
    try {
        const [teamMatch, allGameStates, settings] = await Promise.all([
            api.getActiveTeamMatch(),
            api.getAllGameStates(),
            api.getSettings()
        ]);
        const container = document.getElementById('activeHoldkampContainer');
        const createForm = document.getElementById('createHoldkampForm');
        const courtCount = settings.courtCount || 5;

        if (teamMatch) {
            container.style.display = 'block';
            createForm.style.display = 'none';
            // Don't re-render while an edit form is open — it would clear the user's input
            if (!holdkampEditOpen) {
                renderActiveHoldkamp(teamMatch, container, allGameStates, courtCount, settings.defaultGameMode || '21');
            }
            // Polling may have been stopped when there was no active match; restart it.
            if (!holdkampRefreshTimer) {
                holdkampRefreshTimer = setInterval(loadActiveHoldkamp, 3000);
            }
        } else {
            stopHoldkampRefresh();
            container.style.display = 'none';
            createForm.style.display = 'block';
        }
    } catch (error) {
        console.error('Failed to load holdkamp:', error);
    }
}

function renderActiveHoldkamp(teamMatch, container, allGameStates = [], courtCount = 5, gameMode = '21') {
    const team1Wins = teamMatch.games.filter(g => g.winner_team === 1).length;
    const team2Wins = teamMatch.games.filter(g => g.winner_team === 2).length;

    const formatName = HOLDKAMP_FORMATS[teamMatch.format]?.name || teamMatch.format;

    const counts = {};
    let gamesHtml = teamMatch.games.map(g => {
        counts[g.category] = (counts[g.category] || 0) + 1;
        const num = counts[g.category];
        const isDoubles = DOUBLES_CATEGORIES.includes(g.category);
        const t1 = isDoubles
            ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
            : (g.team1_player1 || '?');
        const t2 = isDoubles
            ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
            : (g.team2_player1 || '?');

        let statusBadge = '';
        let winnerBadge = '';
        let editBtn = '';
        let liveScore = '';
        let courtAssign = '';

        if (g.status === 'pending') {
            statusBadge = '<span style="background:#555;color:#fff;padding:3px 8px;border-radius:4px;font-size:0.8em;">Afventer</span>';
            editBtn = `<button onclick="toggleEditGame(${teamMatch.id}, ${g.id})" style="padding:3px 10px;background:transparent;color:#aaa;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:0.8em;">Rediger</button>
                       <button onclick="toggleManualResult(${teamMatch.id}, ${g.id})" style="padding:3px 10px;background:transparent;color:#f0a500;border:1px solid #f0a500;border-radius:4px;cursor:pointer;font-size:0.8em;">Manuel</button>`;

            // Courts occupied by other active holdkamp games or active game states
            const occupiedByCourts = new Set(
                teamMatch.games
                    .filter(og => og.status === 'active' && og.court_number)
                    .map(og => og.court_number)
            );
            const occupiedByGameState = new Set(
                allGameStates
                    .filter(c => c.isActive && (c.player1.score > 0 || c.player2.score > 0 || c.player1.games > 0 || c.player2.games > 0 || c.timerSeconds > 0))
                    .map(c => c.courtId)
            );

            const courtOptions = Array.from({length: courtCount}, (_, i) => {
                const n = i + 1;
                const inUse = occupiedByCourts.has(n) || occupiedByGameState.has(n);
                return `<option value="${n}" ${inUse ? 'disabled' : ''}>Bane ${n}${inUse ? ' (optaget)' : ''}</option>`;
            }).join('');

            courtAssign = `
                <div style="display:flex;align-items:center;gap:6px;margin-top:8px;">
                    <select id="courtSelect_${g.id}" style="padding:5px 8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;font-size:0.82em;">
                        ${courtOptions}
                    </select>
                    <button onclick="assignCourtToGame(${teamMatch.id}, ${g.id})" style="padding:5px 12px;background:var(--color-primary);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.82em;">Tildel bane</button>
                </div>`;
        } else if (g.status === 'active') {
            const courtData = allGameStates.find(c => c.courtId === g.court_number);
            let scoreText = '';
            if (courtData) {
                scoreText = ` · ${courtData.player1.score}–${courtData.player2.score} (${courtData.player1.games}–${courtData.player2.games} sæt)`;
            }
            statusBadge = `<span style="background:var(--color-primary);color:#fff;padding:3px 8px;border-radius:4px;font-size:0.8em;">Bane ${g.court_number || '?'} ▶${scoreText}</span>`;
            editBtn = `<button onclick="toggleEditGame(${teamMatch.id}, ${g.id})" style="padding:3px 10px;background:transparent;color:#aaa;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:0.8em;">Rediger</button>
                       <button onclick="toggleManualResult(${teamMatch.id}, ${g.id})" style="padding:3px 10px;background:transparent;color:#f0a500;border:1px solid #f0a500;border-radius:4px;cursor:pointer;font-size:0.8em;">Manuel</button>`;
        } else if (g.status === 'finished') {
            const winner = g.winner_team === 1 ? teamMatch.team1_name : teamMatch.team2_name;
            const isWO = g.set_scores === 'W.O.';
            winnerBadge = `<span style="background:#4CAF50;color:#fff;padding:3px 8px;border-radius:4px;font-size:0.8em;">✓ ${escapeHtml(winner)}${isWO ? ' (W.O.)' : ''}</span>`;
        }

        const editForm = g.status !== 'finished' ? `
        <div id="editGame_${g.id}" style="display:none; padding:12px; background:rgba(0,0,0,0.3); border-radius:6px; margin-top:8px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
                <div>
                    <div style="color:#4CAF50;font-size:0.82em;margin-bottom:6px;">${escapeHtml(teamMatch.team1_name)}</div>
                    <input id="eg_${g.id}_t1p1" type="text" value="${escapeHtml(g.team1_player1 || '')}" placeholder="Spiller 1" style="width:100%;padding:7px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;box-sizing:border-box;margin-bottom:6px;">
                    ${isDoubles ? `<input id="eg_${g.id}_t1p2" type="text" value="${escapeHtml(g.team1_player2 || '')}" placeholder="Makker" style="width:100%;padding:7px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;box-sizing:border-box;">` : ''}
                </div>
                <div>
                    <div style="color:var(--color-accent);font-size:0.82em;margin-bottom:6px;">${escapeHtml(teamMatch.team2_name)}</div>
                    <input id="eg_${g.id}_t2p1" type="text" value="${escapeHtml(g.team2_player1 || '')}" placeholder="Spiller 1" style="width:100%;padding:7px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;box-sizing:border-box;margin-bottom:6px;">
                    ${isDoubles ? `<input id="eg_${g.id}_t2p2" type="text" value="${escapeHtml(g.team2_player2 || '')}" placeholder="Makker" style="width:100%;padding:7px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;box-sizing:border-box;">` : ''}
                </div>
            </div>
            <div style="display:flex;gap:8px;">
                <button onclick="saveEditGame(${teamMatch.id}, ${g.id}, ${isDoubles})" style="padding:6px 16px;background:var(--color-primary);color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:0.85em;">Gem</button>
                <button onclick="toggleEditGame(${teamMatch.id}, ${g.id})" style="padding:6px 12px;background:transparent;color:#aaa;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:0.85em;">Annuller</button>
            </div>
        </div>` : '';

        const manualForm = g.status !== 'finished' ? `
        <div id="manualResult_${g.id}" style="display:none; padding:12px; background:rgba(240,165,0,0.07); border:1px solid rgba(240,165,0,0.3); border-radius:6px; margin-top:8px;">
            <div style="color:#f0a500;font-size:0.82em;font-weight:bold;margin-bottom:10px;">Manuel resultat</div>
            <div style="margin-bottom:10px;">
                <div style="color:#aaa;font-size:0.8em;margin-bottom:6px;">Vinder</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:1px solid #4CAF50;border-radius:4px;color:#4CAF50;font-size:0.88em;">
                        <input type="radio" name="manualWinner_${g.id}" value="1" style="accent-color:#4CAF50;"> ${escapeHtml(teamMatch.team1_name)}
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:1px solid var(--color-accent);border-radius:4px;color:var(--color-accent);font-size:0.88em;">
                        <input type="radio" name="manualWinner_${g.id}" value="2" style="accent-color:var(--color-accent);"> ${escapeHtml(teamMatch.team2_name)}
                    </label>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <div style="color:#aaa;font-size:0.8em;margin-bottom:8px;">Sætscore <span style="color:#666;">(valgfrit)</span></div>
                <div style="display:flex;flex-direction:column;gap:6px;">
                    ${[1,2,3].map(s => `
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="color:#666;font-size:0.8em;width:38px;flex-shrink:0;">Sæt ${s}${s===3?' *':''}</span>
                        <input id="manualS${s}t1_${g.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="–"
                               oninput="this.value=this.value.replace(/[^0-9]/g,''); determineHoldkampWinner(${g.id}, '${gameMode}')"
                               style="width:52px;padding:6px;background:var(--color-bg-dark);color:#4CAF50;border:1px solid #555;border-radius:4px;text-align:center;font-size:0.95em;">
                        <span style="color:#555;font-size:1em;">–</span>
                        <input id="manualS${s}t2_${g.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" placeholder="–"
                               oninput="this.value=this.value.replace(/[^0-9]/g,''); determineHoldkampWinner(${g.id}, '${gameMode}')"
                               style="width:52px;padding:6px;background:var(--color-bg-dark);color:var(--color-accent);border:1px solid #555;border-radius:4px;text-align:center;font-size:0.95em;">
                    </div>`).join('')}
                </div>
                <div style="color:#666;font-size:0.75em;margin-top:5px;">* Sæt 3 kun hvis nødvendigt</div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <button onclick="saveManualResult(${teamMatch.id}, ${g.id}, '${gameMode}')" style="padding:6px 16px;background:#f0a500;color:#000;font-weight:bold;border:none;border-radius:4px;cursor:pointer;font-size:0.85em;">Gem resultat</button>
                <button id="woToggle_${g.id}" onclick="toggleWO(${g.id})" style="padding:6px 14px;background:transparent;color:#aaa;border:1px solid #777;border-radius:4px;cursor:pointer;font-size:0.85em;">W.O.</button>
                <button onclick="toggleManualResult(${teamMatch.id}, ${g.id})" style="padding:6px 12px;background:transparent;color:#aaa;border:1px solid #555;border-radius:4px;cursor:pointer;font-size:0.85em;">Annuller</button>
            </div>
        </div>` : '';

        return `
        <div style="padding:10px 15px;background:rgba(var(--color-primary-rgb),0.2);border-radius:8px;margin-bottom:6px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="background:var(--color-accent);color:#fff;padding:3px 8px;border-radius:4px;font-size:0.85em;font-weight:bold;white-space:nowrap;">${escapeHtml(g.category)} ${num}</span>
                <span style="color:#eaeaea;font-size:0.95em;flex:1;min-width:120px;">${escapeHtml(t1)} <span style="color:#aaa;">vs</span> ${escapeHtml(t2)}</span>
                ${statusBadge}
                ${winnerBadge}
                ${editBtn}
            </div>
            ${courtAssign}
            ${editForm}
            ${manualForm}
        </div>`;
    }).join('');

    container.innerHTML = `
        <div style="background:rgba(var(--color-primary-rgb),0.15);border:1px solid var(--color-primary);border-radius:10px;padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
                <div>
                    <div style="color:#aaa;font-size:0.85em;margin-bottom:4px;">${escapeHtml(formatName)}</div>
                    <div style="font-size:1.8em;font-weight:bold;">
                        <span style="color:#4CAF50;">${escapeHtml(teamMatch.team1_name)}</span>
                        <span style="color:#fff;margin:0 15px;">${team1Wins} – ${team2Wins}</span>
                        <span style="color:var(--color-accent);">${escapeHtml(teamMatch.team2_name)}</span>
                    </div>
                </div>
                <div style="display:flex;gap:10px;">
                    <button onclick="finishHoldkamp(${teamMatch.id})" class="btn-secondary">Afslut Holdkamp</button>
                    <button onclick="deleteHoldkamp(${teamMatch.id})" class="btn-danger">Slet</button>
                </div>
            </div>
            <div>${gamesHtml}</div>
        </div>
    `;
}

function onHoldkampFormatChange() {
    const format = document.getElementById('holdkampFormat').value;
    const container = document.getElementById('holdkampGamesInputContainer');
    const playerInputs = document.getElementById('holdkampPlayerInputs');

    if (!format || !HOLDKAMP_FORMATS[format]) {
        playerInputs.style.display = 'none';
        return;
    }

    const games = HOLDKAMP_FORMATS[format].games;
    const team1Name = document.getElementById('holdkampTeam1Name').value || 'Hold 1';
    const team2Name = document.getElementById('holdkampTeam2Name').value || 'Hold 2';

    // Count occurrences of each category for numbering
    const counts = {};
    container.innerHTML = games.map((cat, i) => {
        counts[cat] = (counts[cat] || 0) + 1;
        const num = counts[cat];
        const isDoubles = DOUBLES_CATEGORIES.includes(cat);
        const label = `${cat} ${num}`;

        if (isDoubles) {
            return `
            <div style="background:rgba(var(--color-primary-rgb),0.1);border-radius:8px;padding:15px;margin-bottom:10px;">
                <div style="font-weight:bold;color:var(--color-accent);margin-bottom:10px;">${label}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <div style="color:#4CAF50;font-size:0.85em;margin-bottom:5px;">${escapeHtml(team1Name)}</div>
                        <input type="text" placeholder="Spiller 1" data-game="${i}" data-field="t1p1" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;margin-bottom:6px;">
                        <input type="text" placeholder="Makker" data-game="${i}" data-field="t1p2" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;">
                    </div>
                    <div>
                        <div style="color:var(--color-accent);font-size:0.85em;margin-bottom:5px;">${escapeHtml(team2Name)}</div>
                        <input type="text" placeholder="Spiller 1" data-game="${i}" data-field="t2p1" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;margin-bottom:6px;">
                        <input type="text" placeholder="Makker" data-game="${i}" data-field="t2p2" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;">
                    </div>
                </div>
            </div>`;
        } else {
            return `
            <div style="background:rgba(var(--color-primary-rgb),0.1);border-radius:8px;padding:15px;margin-bottom:10px;">
                <div style="font-weight:bold;color:var(--color-accent);margin-bottom:10px;">${label}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div>
                        <div style="color:#4CAF50;font-size:0.85em;margin-bottom:5px;">${escapeHtml(team1Name)}</div>
                        <input type="text" placeholder="Spillernavn" data-game="${i}" data-field="t1p1" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;">
                    </div>
                    <div>
                        <div style="color:var(--color-accent);font-size:0.85em;margin-bottom:5px;">${escapeHtml(team2Name)}</div>
                        <input type="text" placeholder="Spillernavn" data-game="${i}" data-field="t2p1" style="width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;">
                    </div>
                </div>
            </div>`;
        }
    }).join('');

    playerInputs.style.display = 'block';
}

async function startHoldkamp() {
    const format = document.getElementById('holdkampFormat').value;
    const team1Name = document.getElementById('holdkampTeam1Name').value.trim();
    const team2Name = document.getElementById('holdkampTeam2Name').value.trim();

    if (!format || !team1Name || !team2Name) {
        alert('Udfyld venligst holdnavne og vælg format.');
        return;
    }

    const formatDef = HOLDKAMP_FORMATS[format];
    const inputs = document.getElementById('holdkampGamesInputContainer').querySelectorAll('input');

    // Build games array from inputs
    const gameData = {};
    inputs.forEach(input => {
        const gameIdx = input.dataset.game;
        const field = input.dataset.field;
        if (!gameData[gameIdx]) gameData[gameIdx] = {};
        gameData[gameIdx][field] = input.value.trim();
    });

    const games = formatDef.games.map((cat, i) => ({
        category: cat,
        team1Player1: gameData[i]?.t1p1 || '',
        team1Player2: gameData[i]?.t1p2 || '',
        team2Player1: gameData[i]?.t2p1 || '',
        team2Player2: gameData[i]?.t2p2 || ''
    }));

    try {
        await api.createTeamMatch({ format, team1Name, team2Name, games });
        await loadActiveHoldkamp();
    } catch (error) {
        console.error('Failed to create holdkamp:', error);
        alert('Kunne ikke oprette holdkamp. Prøv igen.');
    }
}

async function assignCourtToGame(teamMatchId, gameId) {
    const select = document.getElementById(`courtSelect_${gameId}`);
    const courtNumber = parseInt(select?.value);
    if (!courtNumber) return;
    if (select?.options[select.selectedIndex]?.disabled) {
        alert('Denne bane er allerede i brug. Vælg en ledig bane.');
        return;
    }
    try {
        await api.updateTeamMatchGame(teamMatchId, gameId, {
            courtNumber,
            status: 'active'
        });

        // Pre-populate game state med spillernavne så banen vises på baneoversigten
        const teamMatch = (await api.getActiveTeamMatch());
        const game = teamMatch?.games?.find(g => g.id === gameId);
        if (game) {
            const isDoubles = DOUBLES_CATEGORIES.includes(game.category);
            const currentState = await api.getGameState(courtNumber);
            await api.updateGameState(courtNumber, {
                ...(currentState || {}),
                player1: {
                    name: game.team1_player1 || `${teamMatch.team1_name} spiller`,
                    name2: game.team1_player2 || '',
                    score: 0, games: 0
                },
                player2: {
                    name: game.team2_player1 || `${teamMatch.team2_name} spiller`,
                    name2: game.team2_player2 || '',
                    score: 0, games: 0
                },
                isActive: true,
                isDoubles,
                matchStartTime: null,
                matchEndTime: null,
                matchCompleted: false,
                timerSeconds: 0,
                servingPlayer: null,
                initialServer: null,
                servingTeam: null,
                servingPlayerOnTeam: null,
                setScoresHistory: [],
                restBreakActive: false,
                restBreakSecondsLeft: 0,
                restBreakTitle: '',
                restBreakTaken: false,
                decidingGameSwitched: false,
                team1RightCourt: 1,
                team2RightCourt: 1,
                betweenSets: false,
                gameMode: currentState?.gameMode || '21',
                isActive: true
            });
        }

        await loadActiveHoldkamp();
    } catch (error) {
        console.error('Failed to assign court:', error);
        alert('Kunne ikke tildele bane. Prøv igen.');
    }
}

function toggleEditGame(teamMatchId, gameId) {
    const form = document.getElementById(`editGame_${gameId}`);
    if (form) {
        const opening = form.style.display === 'none';
        form.style.display = opening ? 'block' : 'none';
        holdkampEditOpen = opening;
    }
}

async function saveEditGame(teamMatchId, gameId, isDoubles) {
    const t1p1 = document.getElementById(`eg_${gameId}_t1p1`)?.value.trim() || '';
    const t1p2 = isDoubles ? (document.getElementById(`eg_${gameId}_t1p2`)?.value.trim() || '') : '';
    const t2p1 = document.getElementById(`eg_${gameId}_t2p1`)?.value.trim() || '';
    const t2p2 = isDoubles ? (document.getElementById(`eg_${gameId}_t2p2`)?.value.trim() || '') : '';

    try {
        await api.updateTeamMatchGame(teamMatchId, gameId, {
            team1Player1: t1p1,
            team1Player2: t1p2,
            team2Player1: t2p1,
            team2Player2: t2p2
        });
        holdkampEditOpen = false;
        await loadActiveHoldkamp();
    } catch (error) {
        console.error('Failed to save game edit:', error);
        alert('Kunne ikke gemme ændringerne. Prøv igen.');
    }
}

function toggleManualResult(teamMatchId, gameId) {
    const form = document.getElementById(`manualResult_${gameId}`);
    if (!form) return;
    const opening = form.style.display === 'none';
    // Close edit form if open
    const editForm = document.getElementById(`editGame_${gameId}`);
    if (editForm) editForm.style.display = 'none';
    form.style.display = opening ? 'block' : 'none';
    holdkampEditOpen = opening;
}

function determineHoldkampWinner(gameId, gameMode) {
    const winTarget = gameMode === '15' ? 15 : 21;
    const cap = gameMode === '15' ? 21 : 30;

    function setWinner(t1, t2) {
        const a = parseInt(t1), b = parseInt(t2);
        if (isNaN(a) || isNaN(b)) return null;
        if (Math.max(a, b) >= cap) return a > b ? 1 : 2;
        if (Math.max(a, b) >= winTarget && Math.abs(a - b) >= 2) return a > b ? 1 : 2;
        return null;
    }

    let t1Sets = 0, t2Sets = 0;
    for (let s = 1; s <= 3; s++) {
        const t1 = document.getElementById(`manualS${s}t1_${gameId}`)?.value.trim() || '';
        const t2 = document.getElementById(`manualS${s}t2_${gameId}`)?.value.trim() || '';
        const w = setWinner(t1, t2);
        if (w === 1) t1Sets++;
        else if (w === 2) t2Sets++;
    }

    const winner = t1Sets >= 2 ? 1 : t2Sets >= 2 ? 2 : null;
    if (winner !== null) {
        const radio = document.querySelector(`input[name="manualWinner_${gameId}"][value="${winner}"]`);
        if (radio) radio.checked = true;
    }
}

function toggleWO(gameId) {
    const form = document.getElementById(`manualResult_${gameId}`);
    const btn = document.getElementById(`woToggle_${gameId}`);
    const isWO = form.dataset.wo === 'true';
    form.dataset.wo = isWO ? 'false' : 'true';
    btn.style.background = isWO ? 'transparent' : '#aaa';
    btn.style.color = isWO ? '#aaa' : '#000';
    btn.style.borderColor = isWO ? '#777' : '#aaa';
}

async function saveManualResult(teamMatchId, gameId, gameMode = '21') {
    const winnerRadio = document.querySelector(`input[name="manualWinner_${gameId}"]:checked`);
    if (!winnerRadio) {
        alert('Vælg venligst en vinder.');
        return;
    }
    const winnerTeam = parseInt(winnerRadio.value);

    const form = document.getElementById(`manualResult_${gameId}`);
    const isWO = form?.dataset.wo === 'true';

    let setScores = null;

    if (isWO) {
        setScores = 'W.O.';
    } else {
        const sets = [1, 2, 3].map(s => {
            const t1 = document.getElementById(`manualS${s}t1_${gameId}`)?.value.trim();
            const t2 = document.getElementById(`manualS${s}t2_${gameId}`)?.value.trim();
            return (t1 !== '' && t2 !== '') ? `${t1}-${t2}` : null;
        });

        if (!sets[0] || !sets[1]) {
            alert('Udfyld venligst sætscore for sæt 1 og 2.');
            return;
        }

        const winTarget = gameMode === '15' ? 15 : 21;
        const cap = gameMode === '15' ? 21 : 30;
        function getSetWinner(score) {
            const [a, b] = score.split('-').map(Number);
            if (Math.max(a, b) >= cap) return a > b ? 1 : 2;
            if (Math.max(a, b) >= winTarget && Math.abs(a - b) >= 2) return a > b ? 1 : 2;
            return null;
        }
        const w1 = getSetWinner(sets[0]);
        const w2 = getSetWinner(sets[1]);
        if ((w1 === 1 && w2 === 2) || (w1 === 2 && w2 === 1)) {
            if (!sets[2]) {
                alert('Sæt 3 er påkrævet når sætstillingen er 1-1.');
                return;
            }
        }

        setScores = sets.filter(Boolean).join(' ');
    }

    try {
        await api.updateTeamMatchGame(teamMatchId, gameId, {
            status: 'finished',
            winnerTeam,
            ...(setScores ? { setScores } : {})
        });
        holdkampEditOpen = false;
        await loadActiveHoldkamp();
    } catch (error) {
        console.error('Failed to save manual result:', error);
        alert('Kunne ikke gemme resultatet. Prøv igen.');
    }
}

function finishHoldkamp(id) {
    showMessage(
        'Afslut Holdkamp',
        'Holdkampen afsluttes og kan ikke genoptages.',
        [
            {
                text: 'Afslut',
                style: 'primary',
                callback: async () => {
                    try {
                        await api.finishTeamMatch(id);
                        await loadActiveHoldkamp();
                    } catch (error) {
                        showMessage('Fejl', 'Kunne ikke afslutte holdkampen: ' + (error.message || 'Ukendt fejl'));
                    }
                }
            },
            { text: 'Annuller', style: 'secondary', callback: null }
        ]
    );
}

function deleteHoldkamp(id) {
    showMessage(
        'Slet Holdkamp',
        'Holdkampen og al tilhørende data slettes permanent.',
        [
            {
                text: 'Slet',
                style: 'danger',
                callback: async () => {
                    try {
                        await api.deleteTeamMatch(id);
                        document.getElementById('activeHoldkampContainer').style.display = 'none';
                        document.getElementById('createHoldkampForm').style.display = 'block';
                    } catch (error) {
                        showMessage('Fejl', 'Kunne ikke slette holdkampen: ' + (error.message || 'Ukendt fejl'));
                    }
                }
            },
            { text: 'Annuller', style: 'secondary', callback: null }
        ]
    );
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
        container.innerHTML = '<div style="color: var(--color-accent); text-align: center; padding: 40px; font-size: 1.2em;">Kunne ikke indlæse kamphistorik. Tjek din forbindelse.</div>';
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
        showMoreBtn.style.cssText = 'width: 100%; padding: 15px; background: var(--color-primary); color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 1em; font-weight: bold; margin-top: 10px;';
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

// Parse set score string into structured data
function parseSetScore(setScoreStr) {
    // Format: "Player1 21-19 Player2" or just "21-19"
    const trimmed = setScoreStr.trim();
    const match = trimmed.match(/^(.+?)\s+(\d+)-(\d+)\s+(.+)$/);

    if (match) {
        return {
            player1: match[1],
            score1: parseInt(match[2]),
            score2: parseInt(match[3]),
            player2: match[4],
            winner: parseInt(match[2]) > parseInt(match[3]) ? match[1] : match[4]
        };
    } else {
        // Just scores: "21-19"
        const scores = trimmed.split('-');
        if (scores.length === 2) {
            return {
                player1: null,
                score1: parseInt(scores[0]),
                score2: parseInt(scores[1]),
                player2: null,
                winner: parseInt(scores[0]) > parseInt(scores[1]) ? 'player1' : 'player2'
            };
        }
    }
    return null;
}

// Calculate match statistics
function calculateMatchStats(setScoresArray) {
    if (!setScoresArray || setScoresArray.length === 0) {
        return null;
    }

    const parsedSets = setScoresArray.map(s => parseSetScore(s)).filter(s => s !== null);
    if (parsedSets.length === 0) return null;

    // Calculate point differences
    const pointDifferences = parsedSets.map(set => Math.abs(set.score1 - set.score2));
    const totalPoints = parsedSets.reduce((sum, set) => sum + set.score1 + set.score2, 0);

    // Find closest and longest sets
    const closestSetDiff = Math.min(...pointDifferences);
    const closestSetIndex = pointDifferences.indexOf(closestSetDiff);
    const longestSetPoints = Math.max(...parsedSets.map(set => Math.max(set.score1, set.score2)));

    return {
        parsedSets,
        avgPointsPerSet: (totalPoints / parsedSets.length).toFixed(1),
        closestSet: {
            index: closestSetIndex + 1,
            diff: closestSetDiff,
            set: parsedSets[closestSetIndex]
        },
        longestSetPoints,
        totalSets: parsedSets.length
    };
}

function createMatchCard(match, index) {
    const card = document.createElement('div');
    card.className = 'match-card';
    card.dataset.matchId = index;

    // Parse set scores if available
    const setScoresArray = match.set_scores ? match.set_scores.split(', ') : [];
    const hasSetDetails = setScoresArray.length > 0;
    const stats = calculateMatchStats(setScoresArray);

    // Determine if doubles (check for "/" or " & " in names)
    const isDoubles = match.winner_name.includes('/') || match.loser_name.includes('/') ||
                      match.winner_name.includes(' & ') || match.loser_name.includes(' & ');
    const gameTypeIcon = isDoubles ? '👥' : '👤';
    const gameTypeText = isDoubles ? 'Double' : 'Single';

    // Create set overview badges
    let setOverviewBadges = '';
    if (stats && stats.parsedSets.length > 0) {
        const winnerName = match.winner_name;
        setOverviewBadges = stats.parsedSets.map((set, i) => {
            const wonSet = set.winner === winnerName ||
                          winnerName.startsWith(set.winner) ||
                          (set.winner === 'player1' && set.score1 > set.score2) ||
                          (set.winner === 'player2' && set.score2 > set.score1);
            const badgeColor = wonSet ? '#4CAF50' : 'var(--color-accent)';
            const badgeIcon = wonSet ? '✓' : '✗';
            return `<span style="background: ${badgeColor}; color: white; padding: 4px 10px; border-radius: 5px; font-size: 0.85em; font-weight: bold; margin-right: 5px;">${badgeIcon} Sæt ${i + 1}</span>`;
        }).join('');
    }

    // Main match info (always visible)
    const mainInfo = document.createElement('div');
    mainInfo.className = 'match-main-info';
    mainInfo.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; cursor: ${hasSetDetails ? 'pointer' : 'default'}; gap: 15px;">
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="font-size: 1.3em;">${gameTypeIcon}</span>
                    <span style="background: rgba(var(--color-primary-rgb), 0.3); color: var(--color-accent); padding: 3px 8px; border-radius: 5px; font-size: 0.8em; font-weight: bold;">${gameTypeText}</span>
                </div>
                <div style="font-weight: bold; font-size: 1.2em; margin-bottom: 8px;">
                    <span style="color: #4CAF50;">${escapeHtml(match.winner_name)}</span>
                    <span style="color: #aaa; margin: 0 8px;">besejrede</span>
                    <span style="color: var(--color-accent);">${escapeHtml(match.loser_name)}</span>
                </div>
                ${setOverviewBadges ? `<div style="margin: 10px 0;">${setOverviewBadges}</div>` : ''}
                <div style="color: #aaa; font-size: 0.9em; margin-top: 8px;">
                    <span style="margin-right: 15px;">⏱️ ${match.duration}</span>
                    <span style="margin-right: 15px;">🏸 Bane ${match.court_id}</span>
                    <span>📅 ${new Date(match.match_date).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
            </div>
            ${hasSetDetails ? '<div class="expand-icon" style="color: var(--color-accent); font-size: 1.5em; padding: 10px;">▼</div>' : ''}
        </div>
    `;

    // Details section (hidden by default)
    const details = document.createElement('div');
    details.className = 'match-details';
    details.style.display = 'none';

    if (hasSetDetails && stats) {
        let setsHtml = '';

        stats.parsedSets.forEach((set, i) => {
            const player1Won = set.score1 > set.score2;
            const player1Color = player1Won ? '#4CAF50' : 'var(--color-accent)';
            const player2Color = player1Won ? 'var(--color-accent)' : '#4CAF50';
            const player1Weight = player1Won ? 'bold' : 'normal';
            const player2Weight = player1Won ? 'normal' : 'bold';

            const player1Name = set.player1 || match.winner_name;
            const player2Name = set.player2 || match.loser_name;

            setsHtml += `
                <div style="padding: 12px 15px; background: rgba(var(--color-primary-rgb), 0.2); border-radius: 8px; margin-bottom: 10px; border-left: 4px solid ${player1Won ? player1Color : player2Color};">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                        <span style="font-weight: bold; color: #eaeaea; font-size: 0.9em;">SÆT ${i + 1}</span>
                        <span style="background: ${player1Won ? player1Color : player2Color}; color: white; padding: 3px 10px; border-radius: 5px; font-size: 0.85em; font-weight: bold;">
                            ${player1Won ? '✓ ' + player1Name : '✓ ' + player2Name}
                        </span>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 1.1em;">
                        <span style="color: ${player1Color}; font-weight: ${player1Weight};">${escapeHtml(player1Name)}</span>
                        <span style="color: white; font-weight: bold; font-size: 1.3em; margin: 0 15px;">${set.score1} - ${set.score2}</span>
                        <span style="color: ${player2Color}; font-weight: ${player2Weight};">${escapeHtml(player2Name)}</span>
                    </div>
                </div>
            `;
        });

        // Statistics section
        const statsHtml = `
            <div style="margin-top: 15px; padding: 15px; background: rgba(var(--color-primary-rgb), 0.15); border-radius: 8px; border: 1px solid rgba(var(--color-primary-rgb), 0.3);">
                <div style="font-weight: bold; margin-bottom: 12px; color: var(--color-accent); font-size: 1em;">📊 KAMPSTATISTIK</div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 5px;">
                        <div style="color: #aaa; font-size: 0.85em; margin-bottom: 3px;">Gennemsnitlige Point pr. Sæt</div>
                        <div style="color: #eaeaea; font-weight: bold; font-size: 1.1em;">${stats.avgPointsPerSet} point</div>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 5px;">
                        <div style="color: #aaa; font-size: 0.85em; margin-bottom: 3px;">Tættest Sæt</div>
                        <div style="color: #eaeaea; font-weight: bold; font-size: 1.1em;">Sæt ${stats.closestSet.index} (${stats.closestSet.diff} points forskel)</div>
                    </div>
                    <div style="background: rgba(255, 255, 255, 0.05); padding: 10px; border-radius: 5px;">
                        <div style="color: #aaa; font-size: 0.85em; margin-bottom: 3px;">Højeste Score i et Sæt</div>
                        <div style="color: #eaeaea; font-weight: bold; font-size: 1.1em;">${stats.longestSetPoints} point</div>
                    </div>
                </div>
            </div>
        `;

        details.innerHTML = `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 2px solid rgba(var(--color-accent-rgb), 0.3);">
                <div style="font-weight: bold; margin-bottom: 15px; color: #eaeaea; font-size: 1.1em;">🏆 SÆT DETALJER</div>
                ${setsHtml}
                ${statsHtml}
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

    // Clear autocomplete timeout to prevent memory leaks
    if (autocompleteTimeout) {
        clearTimeout(autocompleteTimeout);
        autocompleteTimeout = null;
    }
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
        autocompleteTimeout = setTimeout(async () => {
            try {
                await searchPlayers(searchTerm, inputId);
            } catch (error) {
                console.error('Autocomplete search failed:', error);
                hideAutocomplete(inputId);
            } finally {
                autocompleteTimeout = null;
            }
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

// ═══════════════════════════════════════════
// DEVICE TOKENS (Adgangslinks)
// ═══════════════════════════════════════════

async function showDeviceTokens() {
    hideAllSections();
    document.getElementById('deviceTokensSection').style.display = 'block';
    setNavActive('deviceTokens');
    stopAutoRefresh();

    // Udfyld bane-vælger dynamisk ud fra antal baner i indstillinger
    try {
        const settings = await api.getSettings();
        const courtCount = settings.courtCount || 4;
        const courtSelect = document.getElementById('dtCourt');
        courtSelect.innerHTML = Array.from({ length: courtCount }, (_, i) =>
            `<option value="${i + 1}">Bane ${i + 1}</option>`
        ).join('');
    } catch {}

    loadDeviceTokens();
}

async function loadDeviceTokens() {
    const listEl = document.getElementById('deviceTokensList');
    listEl.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:20px;">Indlæser...</p>';

    try {
        const tokens = await api.getDeviceTokens();
        renderDeviceTokens(tokens);
    } catch (err) {
        listEl.innerHTML = `<p style="color:var(--color-accent);text-align:center;padding:20px;">Fejl: ${err.message}</p>`;
    }
}

function renderDeviceTokens(tokens) {
    const listEl = document.getElementById('deviceTokensList');
    const baseUrl = window.location.origin;

    if (tokens.length === 0) {
        listEl.innerHTML = '<p style="color:rgba(255,255,255,0.4);text-align:center;padding:20px;">Ingen adgangslinks endnu</p>';
        return;
    }

    const rows = tokens.map(t => {
        const link = `${baseUrl}/t/${t.token}`;
        const lastUsed = t.last_used_at
            ? new Date(t.last_used_at).toLocaleString('da-DK')
            : 'Aldrig';
        const dest = t.destination;
        const destLabel = dest === 'oversigt' ? 'Oversigt'
            : dest.startsWith('tv/') ? `TV — Bane ${dest.split('/')[1]}`
            : dest.startsWith('court/') ? `Bane visning — Bane ${dest.split('/')[1]}`
            : dest;
        const qrBadge = dest.startsWith('tv/')
            ? ` &nbsp;•&nbsp; 📱 ${t.show_qr_on_tv ? 'QR vises' : 'QR skjult'}`
            : '';

        return `
        <div style="background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:16px 20px;margin-bottom:12px;${!t.is_active ? 'opacity:0.45;' : ''}">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div style="font-weight:600;margin-bottom:4px;">${escapeHtmlDt(t.name)}</div>
                    <div style="font-size:0.8em;color:rgba(255,255,255,0.45);">
                        📍 ${destLabel} &nbsp;•&nbsp;
                        🔒 ${t.locked ? 'Låst' : 'Fri navigation'}${qrBadge} &nbsp;•&nbsp;
                        Sidst brugt: ${lastUsed}
                    </div>
                    <div style="margin-top:8px;display:flex;align-items:center;gap:8px;">
                        <input readonly value="${link}"
                            style="flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:6px 10px;color:rgba(255,255,255,0.6);font-size:0.78em;font-family:monospace;"
                            onclick="this.select()">
                        <button onclick="copyLink('${link}', this)"
                            style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:6px 12px;color:#eaeaea;font-size:0.8em;cursor:pointer;white-space:nowrap;">
                            Kopiér
                        </button>
                    </div>
                </div>
                <div style="display:flex;gap:8px;flex-shrink:0;">
                    ${t.is_active
                        ? `<button onclick="handleDeleteDeviceToken(${t.id})"
                            style="background:rgba(var(--color-accent-rgb),0.12);border:1px solid rgba(var(--color-accent-rgb),0.25);border-radius:6px;padding:6px 14px;color:var(--color-accent);font-size:0.85em;cursor:pointer;">
                            Tilbagekald
                           </button>`
                        : `<span style="font-size:0.8em;color:rgba(255,255,255,0.3);padding:6px 10px;">Tilbagekaldt</span>
                           <button onclick="handlePermanentDeleteDeviceToken(${t.id})"
                            style="background:rgba(var(--color-accent-rgb),0.18);border:1px solid rgba(var(--color-accent-rgb),0.35);border-radius:6px;padding:6px 14px;color:var(--color-accent);font-size:0.85em;cursor:pointer;">
                            🗑 Slet
                           </button>`
                    }
                </div>
            </div>
        </div>`;
    }).join('');

    listEl.innerHTML = rows;
}

function toggleDtCourt() {
    const type = document.getElementById('dtType').value;
    document.getElementById('dtCourtWrap').style.visibility = type === 'oversigt' ? 'hidden' : 'visible';
    // QR-flaget er kun relevant for TV-destinationer
    const qrWrap = document.getElementById('dtQrWrap');
    if (qrWrap) qrWrap.style.display = type === 'tv' ? 'flex' : 'none';
}

async function handleCreateDeviceToken() {
    const name = document.getElementById('dtName').value.trim();
    const type = document.getElementById('dtType').value;
    const court = document.getElementById('dtCourt').value;
    const destination = type === 'oversigt' ? 'oversigt' : `${type}/${court}`;
    const locked = document.getElementById('dtLocked').value === '1';
    const showQrOnTv = type === 'tv' ? document.getElementById('dtShowQr').checked : true;
    const btn = document.getElementById('createDtBtn');
    const msgEl = document.getElementById('dtCreateMsg');

    if (!name) {
        showDtMsg(msgEl, 'Indtast et navn til linket', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Opretter...';

    try {
        await api.createDeviceToken(name, destination, locked, showQrOnTv);
        document.getElementById('dtName').value = '';
        document.getElementById('dtShowQr').checked = true;
        showDtMsg(msgEl, '✓ Link oprettet', 'success');
        await loadDeviceTokens();
    } catch (err) {
        showDtMsg(msgEl, err.message || 'Oprettelse mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Opret Link';
    }
}

function handleDeleteDeviceToken(id) {
    showMessage(
        'Tilbagekald Adgangslink',
        'Enheder der bruger dette link mister adgang med det samme.',
        [
            {
                text: 'Tilbagekald',
                style: 'danger',
                callback: async () => {
                    try {
                        await api.deleteDeviceToken(id);
                        await loadDeviceTokens();
                    } catch (err) {
                        showMessage('Fejl', err.message);
                    }
                }
            },
            { text: 'Annuller', style: 'secondary', callback: null }
        ]
    );
}

function handlePermanentDeleteDeviceToken(id) {
    showMessage(
        'Slet permanent',
        'Adgangslinket slettes permanent og kan ikke gendannes.',
        [
            {
                text: 'Slet',
                style: 'danger',
                callback: async () => {
                    try {
                        await api.permanentlyDeleteDeviceToken(id);
                        await loadDeviceTokens();
                    } catch (err) {
                        showMessage('Fejl', err.message);
                    }
                }
            },
            { text: 'Annuller', style: 'secondary', callback: null }
        ]
    );
}

function copyLink(link, btn) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link).then(() => {
            btn.textContent = '✓ Kopieret';
            setTimeout(() => { btn.textContent = 'Kopiér'; }, 2000);
        });
    } else {
        // Fallback til execCommand for HTTP
        const ta = document.createElement('textarea');
        ta.value = link;
        ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        btn.textContent = '✓ Kopieret';
        setTimeout(() => { btn.textContent = 'Kopiér'; }, 2000);
    }
}

function showDtMsg(el, msg, type) {
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = type === 'error' ? 'rgba(var(--color-accent-rgb),0.12)' : 'rgba(39,174,96,0.1)';
    el.style.border = type === 'error' ? '1px solid rgba(var(--color-accent-rgb),0.3)' : '1px solid rgba(39,174,96,0.25)';
    el.style.color = type === 'error' ? 'var(--color-accent)' : '#2ecc71';
}

function escapeHtmlDt(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ==================== BADMINTONPLAYER.DK IMPORT ====================

async function bpImport() {
    const url = document.getElementById('bpImportUrl').value.trim();
    if (!url) { bpStatus('Indsæt venligst et link fra badmintonplayer.dk', 'error'); return; }

    const btn = document.getElementById('bpImportBtn');
    btn.disabled = true;
    btn.textContent = 'Henter...';
    bpStatus('Henter kampdata fra badmintonplayer.dk...', 'info');
    document.getElementById('bpImportPreview').style.display = 'none';

    try {
        const data = await api.request('/import/holdkamp-url', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        bpRenderPreview(data);
        bpStatus(`✓ Importeret: ${escapeHtml(data.team1Name)} vs ${escapeHtml(data.team2Name)} — ${data.games.length} kampe`, 'success');
    } catch (err) {
        bpStatus('Fejl: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Hent kampdata';
    }
}

function bpStatus(msg, type) {
    const el = document.getElementById('bpImportStatus');
    if (!msg) { el.style.display = 'none'; return; }
    el.textContent = msg;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'rgba(76,175,80,0.12)'
                        : type === 'error'   ? 'rgba(var(--color-accent-rgb),0.12)'
                        :                      'rgba(var(--color-primary-rgb),0.18)';
    el.style.color     = type === 'success' ? '#4CAF50'
                        : type === 'error'   ? 'var(--color-accent)'
                        :                      '#aaa';
    el.style.border    = type === 'success' ? '1px solid rgba(76,175,80,0.25)'
                        : type === 'error'   ? '1px solid rgba(var(--color-accent-rgb),0.25)'
                        :                      '1px solid rgba(var(--color-primary-rgb),0.3)';
}

function bpRenderPreview(data) {
    const { team1Name, team2Name, games } = data;
    const preview = document.getElementById('bpImportPreview');

    const inpStyle = 'width:100%;padding:8px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-primary);border-radius:4px;margin-bottom:4px;box-sizing:border-box;';

    const counts = {};
    const gameRows = games.map((g, i) => {
        counts[g.category] = (counts[g.category] || 0) + 1;
        const label = `${g.category} ${counts[g.category]}`;
        const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
        const inp = (id, val, ph) =>
            `<input type="text" id="bp_${id}_${i}" value="${escapeHtml(val || '')}" placeholder="${ph}" style="${inpStyle}">`;

        return `<div style="background:rgba(var(--color-primary-rgb),0.1);border-radius:8px;padding:14px;margin-bottom:8px;">
            <div style="font-weight:bold;color:var(--color-accent);margin-bottom:10px;">${label}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <div style="color:#4CAF50;font-size:0.82em;margin-bottom:6px;">${escapeHtml(team1Name)}</div>
                    ${inp('t1p1', g.team1Player1, 'Spiller')}
                    ${isDoubles ? inp('t1p2', g.team1Player2, 'Makker') : ''}
                </div>
                <div>
                    <div style="color:var(--color-accent);font-size:0.82em;margin-bottom:6px;">${escapeHtml(team2Name)}</div>
                    ${inp('t2p1', g.team2Player1, 'Spiller')}
                    ${isDoubles ? inp('t2p2', g.team2Player2, 'Makker') : ''}
                </div>
            </div>
        </div>`;
    }).join('');

    preview.innerHTML = `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--color-primary);border-radius:10px;padding:20px;">
            <h4 style="color:#eaeaea;margin-bottom:15px;">Gennemse og ret inden oprettelse</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px;">
                <div>
                    <label style="color:#aaa;font-size:0.85em;">Hold 1</label>
                    <input id="bp_team1" value="${escapeHtml(team1Name)}"
                           style="width:100%;padding:10px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid #4CAF50;border-radius:5px;margin-top:4px;box-sizing:border-box;">
                </div>
                <div>
                    <label style="color:#aaa;font-size:0.85em;">Hold 2</label>
                    <input id="bp_team2" value="${escapeHtml(team2Name)}"
                           style="width:100%;padding:10px;background:var(--color-bg-dark);color:#eaeaea;border:1px solid var(--color-accent);border-radius:5px;margin-top:4px;box-sizing:border-box;">
                </div>
            </div>
            ${gameRows}
            <button onclick="bpCreate()" class="btn-primary"
                    style="width:100%;padding:14px;font-size:1.05em;margin-top:8px;">
                Opret Holdkamp
            </button>
        </div>`;

    // Store original game structure for bpCreate
    preview.dataset.games   = JSON.stringify(games);
    preview.dataset.format  = data.format;
    preview.style.display   = 'block';

    // Scroll to preview
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function bpCreate() {
    const preview  = document.getElementById('bpImportPreview');
    const games    = JSON.parse(preview.dataset.games);
    const format   = preview.dataset.format;
    const team1Name = document.getElementById('bp_team1').value.trim();
    const team2Name = document.getElementById('bp_team2').value.trim();

    if (!team1Name || !team2Name) {
        alert('Udfyld venligst begge holdnavne.');
        return;
    }

    const gamesData = games.map((g, i) => {
        const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
        return {
            category:     g.category,
            team1Player1: document.getElementById(`bp_t1p1_${i}`)?.value.trim() || '',
            team1Player2: isDoubles ? (document.getElementById(`bp_t1p2_${i}`)?.value.trim() || '') : '',
            team2Player1: document.getElementById(`bp_t2p1_${i}`)?.value.trim() || '',
            team2Player2: isDoubles ? (document.getElementById(`bp_t2p2_${i}`)?.value.trim() || '') : '',
        };
    });

    try {
        await api.createTeamMatch({ format, team1Name, team2Name, games: gamesData });
        // Reset import section
        document.getElementById('bpImportUrl').value = '';
        preview.style.display = 'none';
        bpStatus('', '');
        // Reload active holdkamp view
        await loadActiveHoldkamp();
    } catch (err) {
        alert('Kunne ikke oprette holdkamp: ' + err.message);
    }
}

