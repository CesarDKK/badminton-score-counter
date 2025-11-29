// Default admin password
const DEFAULT_PASSWORD = 'admin123';

// Game state
let gameState = {
    player1: {
        name: 'Player 1',
        score: 0,
        games: 0
    },
    player2: {
        name: 'Player 2',
        score: 0,
        games: 0
    },
    timerSeconds: 0,
    timerRunning: false,
    timerInterval: null,
    currentCourt: 1
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    loadGameState();
    updateDisplay();
    setupEventListeners();
    initializeCourts();
});

function initializeApp() {
    // Set default password if not exists
    if (!localStorage.getItem('adminPassword')) {
        localStorage.setItem('adminPassword', DEFAULT_PASSWORD);
    }

    // Set default court count if not exists
    if (!localStorage.getItem('courtCount')) {
        localStorage.setItem('courtCount', '4');
    }
}

function initializeCourts() {
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
    const courtSelect = document.getElementById('courtSelect');
    courtSelect.innerHTML = '';

    for (let i = 1; i <= courtCount; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `Court ${i}`;
        courtSelect.appendChild(option);
    }

    courtSelect.value = gameState.currentCourt;
}

function setupEventListeners() {
    // Player name changes
    document.getElementById('player1Name').addEventListener('change', function(e) {
        gameState.player1.name = e.target.value || 'Player 1';
        saveGameState();
    });

    document.getElementById('player2Name').addEventListener('change', function(e) {
        gameState.player2.name = e.target.value || 'Player 2';
        saveGameState();
    });

    // Timer controls
    document.getElementById('startTimer').addEventListener('click', toggleTimer);
    document.getElementById('resetTimer').addEventListener('click', resetTimer);

    // Action buttons
    document.getElementById('newGameBtn').addEventListener('click', startNewGame);
    document.getElementById('newMatchBtn').addEventListener('click', startNewMatch);

    // Court selector
    document.getElementById('courtSelect').addEventListener('change', function(e) {
        gameState.currentCourt = parseInt(e.target.value);
        loadGameState();
        updateDisplay();
        loadMatchHistory();
    });

    // Load match history
    loadMatchHistory();
}

function addPoint(player) {
    // Auto-start timer on first point
    const isFirstPoint = gameState.player1.score === 0 &&
                        gameState.player2.score === 0 &&
                        gameState.player1.games === 0 &&
                        gameState.player2.games === 0 &&
                        !gameState.timerRunning;

    if (player === 1) {
        gameState.player1.score++;
    } else {
        gameState.player2.score++;
    }

    // Start timer automatically on first point
    if (isFirstPoint) {
        startTimer();
    }

    checkGameWin();
    updateDisplay();
    saveGameState();
}

function removePoint(player) {
    if (player === 1 && gameState.player1.score > 0) {
        gameState.player1.score--;
    } else if (player === 2 && gameState.player2.score > 0) {
        gameState.player2.score--;
    }

    updateDisplay();
    saveGameState();
}

function checkGameWin() {
    const p1Score = gameState.player1.score;
    const p2Score = gameState.player2.score;

    // Standard badminton rules: first to 21, must win by 2, max 30
    if ((p1Score >= 21 && p1Score - p2Score >= 2) || p1Score === 30) {
        gameState.player1.games++;
        saveMatchResult(gameState.player1.name, gameState.player2.name, p1Score, p2Score);
        if (!confirm(`${gameState.player1.name} wins this game! Start new game?`)) {
            return;
        }
        resetScores();
    } else if ((p2Score >= 21 && p2Score - p1Score >= 2) || p2Score === 30) {
        gameState.player2.games++;
        saveMatchResult(gameState.player2.name, gameState.player1.name, p2Score, p1Score);
        if (!confirm(`${gameState.player2.name} wins this game! Start new game?`)) {
            return;
        }
        resetScores();
    }
}

function resetScores() {
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    updateDisplay();
    saveGameState();
}

function startNewGame() {
    if (confirm('Start a new game? Current scores will be reset.')) {
        resetScores();
    }
}

function startNewMatch() {
    if (confirm('Start a new match? All scores and games will be reset.')) {
        gameState.player1.score = 0;
        gameState.player2.score = 0;
        gameState.player1.games = 0;
        gameState.player2.games = 0;
        resetTimer();
        updateDisplay();
        saveGameState();
    }
}

function toggleTimer() {
    if (gameState.timerRunning) {
        clearInterval(gameState.timerInterval);
        gameState.timerRunning = false;
        document.getElementById('startTimer').textContent = 'Start';
    } else {
        startTimer();
    }
}

function startTimer() {
    if (!gameState.timerRunning) {
        gameState.timerInterval = setInterval(function() {
            gameState.timerSeconds++;
            updateTimerDisplay();
            saveGameState();
        }, 1000);
        gameState.timerRunning = true;
        document.getElementById('startTimer').textContent = 'Pause';
    }
}

function resetTimer() {
    clearInterval(gameState.timerInterval);
    gameState.timerSeconds = 0;
    gameState.timerRunning = false;
    document.getElementById('startTimer').textContent = 'Start';
    updateTimerDisplay();
    saveGameState();
}

function updateTimerDisplay() {
    const minutes = Math.floor(gameState.timerSeconds / 60);
    const seconds = gameState.timerSeconds % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateDisplay() {
    document.getElementById('player1Name').value = gameState.player1.name;
    document.getElementById('player2Name').value = gameState.player2.name;
    document.getElementById('player1Score').textContent = gameState.player1.score;
    document.getElementById('player2Score').textContent = gameState.player2.score;
    document.getElementById('player1Games').textContent = gameState.player1.games;
    document.getElementById('player2Games').textContent = gameState.player2.games;
    updateTimerDisplay();
}

function saveGameState() {
    const key = `gameState_court${gameState.currentCourt}`;
    const stateToSave = {
        player1: gameState.player1,
        player2: gameState.player2,
        timerSeconds: gameState.timerSeconds,
        currentCourt: gameState.currentCourt
    };
    localStorage.setItem(key, JSON.stringify(stateToSave));
}

function loadGameState() {
    const key = `gameState_court${gameState.currentCourt}`;
    const saved = localStorage.getItem(key);

    if (saved) {
        const loaded = JSON.parse(saved);
        gameState.player1 = loaded.player1;
        gameState.player2 = loaded.player2;
        gameState.timerSeconds = loaded.timerSeconds;
        gameState.currentCourt = loaded.currentCourt;
    }
}

function saveMatchResult(winner, loser, winnerScore, loserScore) {
    const key = `matchHistory_court${gameState.currentCourt}`;
    let history = JSON.parse(localStorage.getItem(key) || '[]');

    const match = {
        date: new Date().toLocaleString(),
        winner: winner,
        loser: loser,
        score: `${winnerScore}-${loserScore}`,
        duration: formatDuration(gameState.timerSeconds),
        court: gameState.currentCourt
    };

    history.unshift(match);

    // Keep only last 10 matches per court
    if (history.length > 10) {
        history = history.slice(0, 10);
    }

    localStorage.setItem(key, JSON.stringify(history));
    loadMatchHistory();
}

function loadMatchHistory() {
    const key = `matchHistory_court${gameState.currentCourt}`;
    const history = JSON.parse(localStorage.getItem(key) || '[]');
    const historyDiv = document.getElementById('matchHistory');

    if (history.length === 0) {
        historyDiv.innerHTML = '<p style="color: #999;">No match history yet</p>';
        return;
    }

    historyDiv.innerHTML = history.map(match => `
        <div class="history-item">
            <div class="match-result">${match.winner} defeated ${match.loser} (${match.score})</div>
            <div class="match-details">${match.date} - Duration: ${match.duration}</div>
        </div>
    `).join('');
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs}s`;
}