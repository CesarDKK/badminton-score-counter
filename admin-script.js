// Admin Panel JavaScript
const DEFAULT_PASSWORD = 'admin123';
let refreshInterval = null;
let currentEditingCourt = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeAdmin();
    setupEventListeners();
});

function initializeAdmin() {
    // Set default password if not exists
    if (!localStorage.getItem('adminPassword')) {
        localStorage.setItem('adminPassword', DEFAULT_PASSWORD);
    }

    // Set default court count if not exists
    if (!localStorage.getItem('courtCount')) {
        localStorage.setItem('courtCount', '4');
    }

    // Check if already logged in (session storage)
    if (sessionStorage.getItem('adminLoggedIn') === 'true') {
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

function handleLogin() {
    const password = document.getElementById('adminPassword').value;
    const savedPassword = localStorage.getItem('adminPassword');

    if (password === savedPassword) {
        sessionStorage.setItem('adminLoggedIn', 'true');
        showDashboard();
    } else {
        alert('Incorrect password!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    sessionStorage.removeItem('adminLoggedIn');
    stopAutoRefresh();
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('adminPassword').value = '';
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';

    // Load settings
    document.getElementById('courtCount').value = localStorage.getItem('courtCount') || '4';

    // Load and display court overview
    loadCourtOverview();

    // Start auto-refresh every 2 seconds
    startAutoRefresh();
}

function startAutoRefresh() {
    loadCourtOverview();
    refreshInterval = setInterval(loadCourtOverview, 2000);
}

function stopAutoRefresh() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
}

function loadCourtOverview() {
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
    const courtOverview = document.getElementById('courtOverview');

    courtOverview.innerHTML = '';

    for (let i = 1; i <= courtCount; i++) {
        const courtCard = createCourtCard(i);
        courtOverview.appendChild(courtCard);
    }
}

function createCourtCard(courtNumber) {
    const key = `gameState_court${courtNumber}`;
    const stateData = localStorage.getItem(key);

    const card = document.createElement('div');
    card.className = 'court-card';

    if (!stateData) {
        card.innerHTML = `
            <div class="court-header">
                <h3>Court ${courtNumber}</h3>
                <span class="court-status inactive">Inactive</span>
            </div>
            <div class="court-empty">
                No active match
            </div>
            <div class="court-actions">
                <button class="btn-edit" onclick="openEditModal(${courtNumber})">Edit Court</button>
            </div>
        `;
        return card;
    }

    const state = JSON.parse(stateData);
    // Check if manually set as active OR has actual game data
    const isActive = state.isActive ||
                     state.player1.score > 0 || state.player2.score > 0 ||
                     state.player1.games > 0 || state.player2.games > 0 ||
                     state.timerSeconds > 0;

    const isDoubles = state.isDoubles || false;
    const player1Display = isDoubles && state.player1.name2
        ? `${escapeHtml(state.player1.name)}<br>${escapeHtml(state.player1.name2)}`
        : escapeHtml(state.player1.name);
    const player2Display = isDoubles && state.player2.name2
        ? `${escapeHtml(state.player2.name)}<br>${escapeHtml(state.player2.name2)}`
        : escapeHtml(state.player2.name);

    // Load match history for this court
    const historyKey = `matchHistory_court${courtNumber}`;
    const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
    const historyHtml = history.length > 0
        ? history.slice(0, 3).map(match => `
            <div style="padding: 8px; background: rgba(15, 52, 96, 0.3); border-radius: 5px; margin-top: 5px; font-size: 0.85em;">
                <div style="font-weight: bold; color: #e94560;">${escapeHtml(match.winner)} def. ${escapeHtml(match.loser)}</div>
                <div style="color: #aaa; font-size: 0.9em;">Games: ${match.gamesWon} | Duration: ${match.duration}</div>
            </div>
        `).join('')
        : '<div style="color: #999; font-style: italic; margin-top: 10px;">No match history</div>';

    card.innerHTML = `
        <div class="court-header">
            <h3>Court ${courtNumber}${isDoubles ? ' <span style="font-size: 0.7em; color: #e94560;">(Doubles)</span>' : ''}</h3>
            <span class="court-status ${isActive ? 'active' : 'inactive'}">
                ${isActive ? 'Active' : 'Inactive'}
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
                    <span class="meta-label">Games Won</span>
                    <span class="meta-value">${state.player1.games} - ${state.player2.games}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Duration</span>
                    <span class="meta-value">${formatDuration(state.timerSeconds)}</span>
                </div>
            </div>
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #533483;">
                <div style="font-weight: bold; margin-bottom: 10px; color: #e94560;">Recent Matches</div>
                ${historyHtml}
            </div>
        </div>
        <div class="court-actions">
            <button class="btn-edit" onclick="openEditModal(${courtNumber})">Edit Court</button>
        </div>
    `;

    return card;
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

function saveCourtCount() {
    const courtCount = parseInt(document.getElementById('courtCount').value);

    if (courtCount < 1 || courtCount > 20) {
        alert('Court count must be between 1 and 20!');
        return;
    }

    const oldCount = parseInt(localStorage.getItem('courtCount') || '4');

    if (courtCount < oldCount) {
        if (!confirm(`This will reduce courts from ${oldCount} to ${courtCount}. Court data for courts ${courtCount + 1}-${oldCount} will remain in storage. Continue?`)) {
            return;
        }
    }

    localStorage.setItem('courtCount', courtCount.toString());
    alert('Court count updated successfully!');
    loadCourtOverview();
}

function changePassword() {
    const newPassword = document.getElementById('newPassword').value;

    if (!newPassword || newPassword.length < 4) {
        alert('Password must be at least 4 characters long!');
        return;
    }

    localStorage.setItem('adminPassword', newPassword);
    document.getElementById('newPassword').value = '';
    alert('Password changed successfully! Please remember your new password.');
}

function clearAllData() {
    if (!confirm('Are you sure you want to clear ALL court data? This cannot be undone!')) {
        return;
    }

    if (!confirm('This will delete all scores, match history, and game states for ALL courts. Are you absolutely sure?')) {
        return;
    }

    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');

    // Clear game states
    for (let i = 1; i <= 20; i++) {
        localStorage.removeItem(`gameState_court${i}`);
        localStorage.removeItem(`matchHistory_court${i}`);
    }

    alert('All court data has been cleared!');
    loadCourtOverview();
}

function openEditModal(courtNumber) {
    currentEditingCourt = courtNumber;
    const key = `gameState_court${courtNumber}`;
    const stateData = localStorage.getItem(key);

    document.getElementById('editCourtNumber').textContent = courtNumber;

    if (stateData) {
        const state = JSON.parse(stateData);
        document.getElementById('editPlayer1Name').value = state.player1.name;
        document.getElementById('editPlayer2Name').value = state.player2.name;
        document.getElementById('editPlayer1Name2').value = state.player1.name2 || 'Partner 1';
        document.getElementById('editPlayer2Name2').value = state.player2.name2 || 'Partner 2';
        document.getElementById('editCourtActive').checked = state.isActive || false;
        document.getElementById('editDoublesMode').checked = state.isDoubles || false;
        document.getElementById('editGameMode').checked = (state.gameMode === '15');
    } else {
        document.getElementById('editPlayer1Name').value = 'Player 1';
        document.getElementById('editPlayer2Name').value = 'Player 2';
        document.getElementById('editPlayer1Name2').value = 'Partner 1';
        document.getElementById('editPlayer2Name2').value = 'Partner 2';
        document.getElementById('editCourtActive').checked = false;
        document.getElementById('editDoublesMode').checked = false;
        document.getElementById('editGameMode').checked = false;
    }

    // Update visibility of partner fields
    toggleEditDoublesMode();

    document.getElementById('editCourtModal').style.display = 'block';
}

function saveCourtChanges() {
    if (!currentEditingCourt) return;

    const key = `gameState_court${currentEditingCourt}`;
    const stateData = localStorage.getItem(key);

    const newPlayer1Name = document.getElementById('editPlayer1Name').value.trim() || 'Player 1';
    const newPlayer2Name = document.getElementById('editPlayer2Name').value.trim() || 'Player 2';
    const newPlayer1Name2 = document.getElementById('editPlayer1Name2').value.trim() || 'Partner 1';
    const newPlayer2Name2 = document.getElementById('editPlayer2Name2').value.trim() || 'Partner 2';
    const isActive = document.getElementById('editCourtActive').checked;
    const isDoubles = document.getElementById('editDoublesMode').checked;
    const gameMode = document.getElementById('editGameMode').checked ? '15' : '21';

    if (stateData) {
        const state = JSON.parse(stateData);
        state.player1.name = newPlayer1Name;
        state.player2.name = newPlayer2Name;
        state.player1.name2 = newPlayer1Name2;
        state.player2.name2 = newPlayer2Name2;
        state.isActive = isActive;
        state.isDoubles = isDoubles;
        state.gameMode = gameMode;
        localStorage.setItem(key, JSON.stringify(state));
    } else {
        // Create new state if doesn't exist (or if marked as active)
        const newState = {
            player1: { name: newPlayer1Name, name2: newPlayer1Name2, score: 0, games: 0 },
            player2: { name: newPlayer2Name, name2: newPlayer2Name2, score: 0, games: 0 },
            timerSeconds: 0,
            currentCourt: currentEditingCourt,
            isActive: isActive,
            isDoubles: isDoubles,
            gameMode: gameMode
        };
        localStorage.setItem(key, JSON.stringify(newState));
    }

    document.getElementById('editCourtModal').style.display = 'none';
    currentEditingCourt = null;
    loadCourtOverview();
}

function resetCourtConfirm() {
    if (!currentEditingCourt) return;

    if (!confirm(`Are you sure you want to reset Court ${currentEditingCourt}? This will clear all scores and timer data for this court.`)) {
        return;
    }

    const key = `gameState_court${currentEditingCourt}`;
    localStorage.removeItem(key);

    document.getElementById('editCourtModal').style.display = 'none';
    currentEditingCourt = null;
    loadCourtOverview();
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    stopAutoRefresh();
});