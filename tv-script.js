// TV Display Script - Read-only view with auto-refresh
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

let refreshInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeTVDisplay();
    loadCourtData();
    startAutoRefresh();
});

function initializeTVDisplay() {
    // Display court number
    document.getElementById('courtNumber').textContent = courtId;

    // Verify court is valid
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
    if (courtId < 1 || courtId > courtCount) {
        document.querySelector('.tv-container').innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 20px;">
                <h1 style="font-size: 4em; color: #e94560;">Court ${courtId} Not Found</h1>
                <a href="landing.html" style="color: #fff; font-size: 2em; text-decoration: underline;">Return to Landing Page</a>
            </div>
        `;
    }
}

function startAutoRefresh() {
    // Refresh every 1 second for real-time updates
    refreshInterval = setInterval(loadCourtData, 1000);
}

function loadCourtData() {
    const key = `gameState_court${courtId}`;
    const stateData = localStorage.getItem(key);

    if (!stateData) {
        // No data - show default
        document.getElementById('player1Name').textContent = 'Player 1';
        document.getElementById('player2Name').textContent = 'Player 2';
        document.getElementById('player1Name2').style.display = 'none';
        document.getElementById('player2Name2').style.display = 'none';
        document.getElementById('player1Score').textContent = '0';
        document.getElementById('player2Score').textContent = '0';
        document.getElementById('player1Games').textContent = '0';
        document.getElementById('player2Games').textContent = '0';
        document.getElementById('timerDisplay').textContent = '00:00';
        return;
    }

    const state = JSON.parse(stateData);

    // Update display
    document.getElementById('player1Name').textContent = state.player1.name;
    document.getElementById('player2Name').textContent = state.player2.name;

    // Handle doubles mode
    const isDoubles = state.isDoubles || false;
    const player1Name2 = document.getElementById('player1Name2');
    const player2Name2 = document.getElementById('player2Name2');

    if (isDoubles && state.player1.name2 && state.player2.name2) {
        player1Name2.textContent = state.player1.name2;
        player2Name2.textContent = state.player2.name2;
        player1Name2.style.display = 'flex';
        player2Name2.style.display = 'flex';
    } else {
        player1Name2.style.display = 'none';
        player2Name2.style.display = 'none';
    }

    document.getElementById('player1Score').textContent = state.player1.score;
    document.getElementById('player2Score').textContent = state.player2.score;
    document.getElementById('player1Games').textContent = state.player1.games;
    document.getElementById('player2Games').textContent = state.player2.games;

    // Format timer
    const minutes = Math.floor(state.timerSeconds / 60);
    const seconds = state.timerSeconds % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
});