// Admin Panel JavaScript
const api = window.BadmintonAPI;
let refreshInterval = null;
let currentEditingCourt = null;
let allMatchesDisplayCount = 30;
let courtTimers = {}; // Store timer values and timestamps for each court
let timerUpdateInterval = null;

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

    // Settings
    document.getElementById('saveCourtBtn').addEventListener('click', saveCourtCount);
    document.getElementById('changePasswordBtn').addEventListener('click', changePassword);
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
        // Load settings
        const settings = await api.getSettings();
        document.getElementById('courtCount').value = settings.courtCount;

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
    // Update all court timer displays based on stored values
    Object.keys(courtTimers).forEach(courtNumber => {
        const timerData = courtTimers[courtNumber];
        if (timerData && timerData.isActive) {
            const elapsed = Math.floor((Date.now() - timerData.timestamp) / 1000);
            const currentSeconds = timerData.baseSeconds + elapsed;

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
            baseSeconds: state.timerSeconds,
            timestamp: Date.now(),
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
                        <span class="meta-value" data-court-timer="${courtNumber}">${formatDuration(state.timerSeconds)}</span>
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

async function saveCourtCount() {
    const courtCount = parseInt(document.getElementById('courtCount').value);

    if (courtCount < 1 || courtCount > 20) {
        showMessage('Fejl', 'Antal baner skal være mellem 1 og 20!');
        return;
    }

    try {
        const settings = await api.getSettings();
        const oldCount = settings.courtCount;

        if (courtCount < oldCount) {
            showMessage(
                'Bekræft Reduktion',
                `Dette vil reducere baner fra ${oldCount} til ${courtCount}. Banedata for bane ${courtCount + 1}-${oldCount} vil forblive i lagring. Fortsæt?`,
                [
                    {
                        text: 'Ja, Fortsæt',
                        callback: async () => {
                            try {
                                await api.updateCourtCount(courtCount);
                                showMessage('Succes', 'Antal baner opdateret!');
                                await loadCourtOverview();
                            } catch (error) {
                                console.error('Failed to save court count:', error);
                                showMessage('Fejl', 'Kunne ikke gemme antal baner. Tjek din forbindelse.');
                            }
                        },
                        style: 'primary'
                    },
                    { text: 'Annuller', callback: null, style: 'secondary' }
                ]
            );
            return;
        }

        await api.updateCourtCount(courtCount);
        showMessage('Succes', 'Antal baner opdateret!');
        await loadCourtOverview();
    } catch (error) {
        console.error('Failed to save court count:', error);
        showMessage('Fejl', 'Kunne ikke gemme antal baner. Tjek din forbindelse.');
    }
}

async function changePassword() {
    const newPassword = document.getElementById('newPassword').value;

    if (!newPassword || newPassword.length < 4) {
        showMessage('Fejl', 'Adgangskode skal være mindst 4 tegn lang!');
        return;
    }

    try {
        await api.updatePassword(newPassword);
        document.getElementById('newPassword').value = '';
        showMessage('Succes', 'Adgangskode ændret! Husk din nye adgangskode.');
    } catch (error) {
        console.error('Failed to change password:', error);
        showMessage('Fejl', 'Kunne ikke ændre adgangskode. Tjek din forbindelse.');
    }
}

async function clearAllData() {
    showMessage(
        'ADVARSEL',
        'Er du sikker på at du vil rydde ALLE banedata? Dette kan ikke fortrydes!',
        [
            {
                text: 'Ja, Fortsæt',
                callback: () => {
                    showMessage(
                        'SIDSTE ADVARSEL',
                        'Dette vil slette alle point, kamphistorik og spiltilstande for ALLE baner. Er du helt sikker?',
                        [
                            {
                                text: 'Ja, Slet Alt',
                                callback: async () => {
                                    try {
                                        const settings = await api.getSettings();
                                        const courtCount = settings.courtCount;

                                        // Reset all game states
                                        for (let i = 1; i <= courtCount; i++) {
                                            try {
                                                await api.resetGameState(i);
                                            } catch (error) {
                                                console.error(`Failed to reset court ${i}:`, error);
                                            }
                                        }

                                        showMessage('Succes', 'Alle banedata er blevet ryddet!');
                                        await loadCourtOverview();
                                    } catch (error) {
                                        console.error('Failed to clear all data:', error);
                                        showMessage('Fejl', 'Kunne ikke rydde alle data. Tjek din forbindelse.');
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
            document.getElementById('editPlayer1Name').value = state.player1.name;
            document.getElementById('editPlayer2Name').value = state.player2.name;
            document.getElementById('editPlayer1Name2').value = state.player1.name2 || 'Makker 1';
            document.getElementById('editPlayer2Name2').value = state.player2.name2 || 'Makker 2';
            document.getElementById('editCourtActive').checked = state.isActive || false;
            document.getElementById('editDoublesMode').checked = state.isDoubles || false;
            document.getElementById('editGameMode').checked = (state.gameMode === '15');
        } else {
            // Default values for new court
            document.getElementById('editPlayer1Name').value = 'Spiller 1';
            document.getElementById('editPlayer2Name').value = 'Spiller 2';
            document.getElementById('editPlayer1Name2').value = 'Makker 1';
            document.getElementById('editPlayer2Name2').value = 'Makker 2';
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

    const newPlayer1Name = document.getElementById('editPlayer1Name').value.trim() || 'Spiller 1';
    const newPlayer2Name = document.getElementById('editPlayer2Name').value.trim() || 'Spiller 2';
    const newPlayer1Name2 = document.getElementById('editPlayer1Name2').value.trim() || 'Makker 1';
    const newPlayer2Name2 = document.getElementById('editPlayer2Name2').value.trim() || 'Makker 2';
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
        const allMatches = await api.getAllMatchHistory();

        // Sort by date (most recent first)
        allMatches.sort((a, b) => new Date(b.match_date) - new Date(a.match_date));

        const container = document.getElementById('allMatchesContainer');

        if (allMatches.length === 0) {
            container.innerHTML = '<div style="color: #999; text-align: center; padding: 40px; font-size: 1.2em;">Ingen kamphistorik tilgængelig</div>';
            return;
        }

        // Display matches (up to allMatchesDisplayCount)
        const displayMatches = allMatches.slice(0, allMatchesDisplayCount);
        const matchesHtml = displayMatches.map(match => `
            <div style="padding: 15px; background: rgba(15, 52, 96, 0.5); border-radius: 10px; margin-bottom: 10px; border-left: 5px solid #e94560;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <div style="font-weight: bold; font-size: 1.1em; color: #e94560; margin-bottom: 5px;">
                            ${escapeHtml(match.winner_name)} besejrede ${escapeHtml(match.loser_name)}
                        </div>
                        <div style="color: #aaa; font-size: 0.9em;">
                            Sæt Vundet: ${match.games_won}${match.set_scores ? ` (${match.set_scores})` : ''} | Varighed: ${match.duration} | Bane ${match.court_id}
                        </div>
                    </div>
                    <div style="color: #999; font-size: 0.85em;">
                        ${new Date(match.match_date).toLocaleDateString('da-DK')}
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = matchesHtml;

        // Add "Show More" button if there are more than allMatchesDisplayCount matches
        if (allMatches.length > allMatchesDisplayCount) {
            const showMoreBtn = `
                <button onclick="showMoreMatches()" style="width: 100%; padding: 15px; background: #533483; color: white; border: none; border-radius: 10px; cursor: pointer; font-size: 1em; font-weight: bold; margin-top: 10px;">
                    Vis Flere Kampe (${allMatches.length - allMatchesDisplayCount} flere)
                </button>
            `;
            container.innerHTML += showMoreBtn;
        }
    } catch (error) {
        console.error('Failed to load match history:', error);
        const container = document.getElementById('allMatchesContainer');
        container.innerHTML = '<div style="color: #e94560; text-align: center; padding: 40px; font-size: 1.2em;">Kunne ikke indlæse kamphistorik. Tjek din forbindelse.</div>';
    }
}

function showMoreMatches() {
    allMatchesDisplayCount += 30;
    loadAllMatches();
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
