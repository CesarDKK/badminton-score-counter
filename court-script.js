// Court-specific script - gets court ID from URL parameter
const DEFAULT_PASSWORD = 'admin123';

// Get court ID from URL
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

// Game state - specific to this court only
let gameState = {
    player1: {
        name: 'Player 1',
        name2: 'Partner 1',
        score: 0,
        games: 0
    },
    player2: {
        name: 'Player 2',
        name2: 'Partner 2',
        score: 0,
        games: 0
    },
    timerSeconds: 0,
    timerRunning: false,
    timerInterval: null,
    currentCourt: courtId,
    isActive: false,
    isDoubles: false,
    gameMode: '21',  // '21' for 21/30, '15' for 15/21
    decidingGameSwitched: false  // Track if sides switched at 11 in deciding game
};

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    loadGameState();
    updateDisplay();
    setupEventListeners();
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

    // Display court number
    document.getElementById('courtNumber').textContent = courtId;

    // Verify court is valid
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
    if (courtId < 1 || courtId > courtCount) {
        alert(`Court ${courtId} does not exist. Redirecting to landing page.`);
        window.location.href = 'landing.html';
    }
}

function setupEventListeners() {
    // Player name changes
    document.getElementById('player1Name').addEventListener('change', function(e) {
        gameState.player1.name = e.target.value || 'Player 1';
        saveGameState();
    });

    document.getElementById('player1Name2').addEventListener('change', function(e) {
        gameState.player1.name2 = e.target.value || 'Partner 1';
        saveGameState();
    });

    document.getElementById('player2Name').addEventListener('change', function(e) {
        gameState.player2.name = e.target.value || 'Player 2';
        saveGameState();
    });

    document.getElementById('player2Name2').addEventListener('change', function(e) {
        gameState.player2.name2 = e.target.value || 'Partner 2';
        saveGameState();
    });

    // Timer controls
    document.getElementById('startTimer').addEventListener('click', toggleTimer);

    // Action buttons
    document.getElementById('switchSidesBtn').addEventListener('click', switchSides);
    document.getElementById('newMatchBtn').addEventListener('click', startNewMatch);
    document.getElementById('doublesToggle').addEventListener('click', toggleDoubles);
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

    // Check for side switch at 11 points in deciding game (when games are 1-1)
    const isDecidingGame = gameState.player1.games === 1 && gameState.player2.games === 1;
    const scoredTo11 = gameState.player1.score === 11 || gameState.player2.score === 11;

    if (isDecidingGame && scoredTo11 && !gameState.decidingGameSwitched) {
        gameState.decidingGameSwitched = true;
        switchSides();
        alert('Score has reached 11 in the deciding game. Players have switched sides!');
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

    // Determine win conditions based on game mode
    const winScore = gameState.gameMode === '21' ? 21 : 15;
    const maxScore = gameState.gameMode === '21' ? 30 : 21;

    // Badminton rules: first to winScore, must win by 2, max maxScore
    if ((p1Score >= winScore && p1Score - p2Score >= 2) || p1Score === maxScore) {
        gameState.player1.games++;

        // Check if player won the match (2 games)
        if (gameState.player1.games === 2) {
            alert(`${gameState.player1.name} wins the match ${gameState.player1.games}-${gameState.player2.games}!`);
            if (confirm('Start a new match?')) {
                startNewMatch();
            }
            return;
        }

        if (!confirm(`${gameState.player1.name} wins this game! Start new game?`)) {
            return;
        }
        resetScores();
        gameState.decidingGameSwitched = false;  // Reset for next game
        // Automatically switch sides after each game
        switchSides();
    } else if ((p2Score >= winScore && p2Score - p1Score >= 2) || p2Score === maxScore) {
        gameState.player2.games++;

        // Check if player won the match (2 games)
        if (gameState.player2.games === 2) {
            alert(`${gameState.player2.name} wins the match ${gameState.player2.games}-${gameState.player1.games}!`);
            if (confirm('Start a new match?')) {
                startNewMatch();
            }
            return;
        }

        if (!confirm(`${gameState.player2.name} wins this game! Start new game?`)) {
            return;
        }
        resetScores();
        gameState.decidingGameSwitched = false;  // Reset for next game
        // Automatically switch sides after each game
        switchSides();
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
    document.getElementById('player1Name2').value = gameState.player1.name2 || 'Partner 1';
    document.getElementById('player2Name').value = gameState.player2.name;
    document.getElementById('player2Name2').value = gameState.player2.name2 || 'Partner 2';
    document.getElementById('player1Score').textContent = gameState.player1.score;
    document.getElementById('player2Score').textContent = gameState.player2.score;
    document.getElementById('player1Games').textContent = gameState.player1.games;
    document.getElementById('player2Games').textContent = gameState.player2.games;
    updateTimerDisplay();
    updateDoublesDisplay();
}

function toggleDoubles() {
    const newMode = gameState.isDoubles ? 'singles' : 'doubles';
    if (!confirm(`Are you sure you want to switch to ${newMode} mode?`)) {
        return;
    }
    gameState.isDoubles = !gameState.isDoubles;
    updateDoublesDisplay();
    saveGameState();
}

function updateDoublesDisplay() {
    const player1Name2 = document.getElementById('player1Name2');
    const player2Name2 = document.getElementById('player2Name2');
    const toggleBtn = document.getElementById('doublesToggle');

    if (gameState.isDoubles) {
        player1Name2.style.display = 'block';
        player2Name2.style.display = 'block';
        toggleBtn.textContent = 'Switch to Singles';
    } else {
        player1Name2.style.display = 'none';
        player2Name2.style.display = 'none';
        toggleBtn.textContent = 'Switch to Doubles';
    }
}

function switchSides() {
    // Swap all player data
    const tempPlayer = {
        name: gameState.player1.name,
        name2: gameState.player1.name2,
        score: gameState.player1.score,
        games: gameState.player1.games
    };

    gameState.player1.name = gameState.player2.name;
    gameState.player1.name2 = gameState.player2.name2;
    gameState.player1.score = gameState.player2.score;
    gameState.player1.games = gameState.player2.games;

    gameState.player2.name = tempPlayer.name;
    gameState.player2.name2 = tempPlayer.name2;
    gameState.player2.score = tempPlayer.score;
    gameState.player2.games = tempPlayer.games;

    updateDisplay();
    saveGameState();
}

function saveGameState() {
    // Save to localStorage with court-specific key
    const key = `gameState_court${courtId}`;

    // Check if there's an existing isActive flag and preserve it
    const existing = localStorage.getItem(key);
    const isActive = existing ? JSON.parse(existing).isActive : undefined;

    const stateToSave = {
        player1: gameState.player1,
        player2: gameState.player2,
        timerSeconds: gameState.timerSeconds,
        currentCourt: courtId,
        isActive: isActive,  // Preserve admin-set active status
        isDoubles: gameState.isDoubles,  // Save doubles mode
        gameMode: gameState.gameMode,  // Save game mode
        decidingGameSwitched: gameState.decidingGameSwitched  // Save deciding game switch status
    };
    localStorage.setItem(key, JSON.stringify(stateToSave));
}

function loadGameState() {
    // Load from localStorage with court-specific key
    const key = `gameState_court${courtId}`;
    const saved = localStorage.getItem(key);

    if (saved) {
        const loaded = JSON.parse(saved);
        gameState.player1 = loaded.player1;
        gameState.player2 = loaded.player2;
        gameState.timerSeconds = loaded.timerSeconds;
        gameState.currentCourt = courtId;
        gameState.isActive = loaded.isActive;  // Load active status
        gameState.isDoubles = loaded.isDoubles || false;  // Load doubles mode
        gameState.gameMode = loaded.gameMode || '21';  // Load game mode, default to 21
        gameState.decidingGameSwitched = loaded.decidingGameSwitched || false;  // Load deciding game switch status

        // Ensure name2 exists for backwards compatibility
        if (!gameState.player1.name2) gameState.player1.name2 = 'Partner 1';
        if (!gameState.player2.name2) gameState.player2.name2 = 'Partner 2';
    }
}

