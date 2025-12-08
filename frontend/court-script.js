// Court-specific script - gets court ID from URL parameter
const api = window.BadmintonAPI;

// Get court ID from URL
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

// Game state - specific to this court only
let gameState = {
    player1: {
        name: 'Spiller 1',
        name2: 'Makker 1',
        score: 0,
        games: 0
    },
    player2: {
        name: 'Spiller 2',
        name2: 'Makker 2',
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

// Debouncing variables
let saveTimeout = null;
let isSaving = false;
let pendingSave = false;

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    await initializeApp();
    await loadGameState();
    updateDisplay();
    setupEventListeners();
});

async function initializeApp() {
    try {
        // Display court number
        document.getElementById('courtNumber').textContent = courtId;

        // Verify court is valid
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;

        if (courtId < 1 || courtId > courtCount) {
            alert(`Bane ${courtId} findes ikke. Omdirigerer til landingsside.`);
            window.location.href = 'landing.html';
        }
    } catch (error) {
        console.error('Failed to initialize app:', error);
        alert('Kunne ikke indlæse bane. Tjek din forbindelse.');
    }
}

function setupEventListeners() {
    // Player name changes
    document.getElementById('player1Name').addEventListener('change', function(e) {
        gameState.player1.name = e.target.value || 'Spiller 1';
        saveGameState();
    });

    document.getElementById('player1Name2').addEventListener('change', function(e) {
        gameState.player1.name2 = e.target.value || 'Makker 1';
        saveGameState();
    });

    document.getElementById('player2Name').addEventListener('change', function(e) {
        gameState.player2.name = e.target.value || 'Spiller 2';
        saveGameState();
    });

    document.getElementById('player2Name2').addEventListener('change', function(e) {
        gameState.player2.name2 = e.target.value || 'Makker 2';
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
        alert('Point har nået 11 i afgørende sæt. Spillere har skiftet side!');
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
            saveMatchResult(gameState.player1.name, gameState.player2.name,
                           gameState.player1.games, gameState.player2.games);
            alert(`${gameState.player1.name} vinder kampen ${gameState.player1.games}-${gameState.player2.games}!`);
            if (confirm('Start en ny kamp?')) {
                startNewMatch();
            }
            return;
        }

        if (!confirm(`${gameState.player1.name} vinder dette sæt! Start nyt sæt?`)) {
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
            saveMatchResult(gameState.player2.name, gameState.player1.name,
                           gameState.player2.games, gameState.player1.games);
            alert(`${gameState.player2.name} vinder kampen ${gameState.player2.games}-${gameState.player1.games}!`);
            if (confirm('Start en ny kamp?')) {
                startNewMatch();
            }
            return;
        }

        if (!confirm(`${gameState.player2.name} vinder dette sæt! Start nyt sæt?`)) {
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
    if (confirm('Start et nyt sæt? Nuværende point vil blive nulstillet.')) {
        resetScores();
    }
}

function startNewMatch() {
    if (confirm('Start en ny kamp? Alle point og sæt vil blive nulstillet.')) {
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
    document.getElementById('player1Name2').value = gameState.player1.name2 || 'Makker 1';
    document.getElementById('player2Name').value = gameState.player2.name;
    document.getElementById('player2Name2').value = gameState.player2.name2 || 'Makker 2';
    document.getElementById('player1Score').textContent = gameState.player1.score;
    document.getElementById('player2Score').textContent = gameState.player2.score;
    document.getElementById('player1Games').textContent = gameState.player1.games;
    document.getElementById('player2Games').textContent = gameState.player2.games;
    updateTimerDisplay();
    updateDoublesDisplay();
}

function toggleDoubles() {
    const newMode = gameState.isDoubles ? 'single' : 'double';
    if (!confirm(`Er du sikker på at du vil skifte til ${newMode} tilstand?`)) {
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
        toggleBtn.textContent = 'Skift til Single';
    } else {
        player1Name2.style.display = 'none';
        player2Name2.style.display = 'none';
        toggleBtn.textContent = 'Skift til Double';
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

// Debounced save function - saves max once per 2 seconds
function saveGameState() {
    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // Mark that we have a pending save
    pendingSave = true;

    // Debounce: wait 2 seconds before saving
    saveTimeout = setTimeout(async () => {
        if (pendingSave && !isSaving) {
            await performSave();
        }
    }, 2000);
}

// Perform the actual API save
async function performSave() {
    if (isSaving) {
        // Already saving, will retry
        pendingSave = true;
        return;
    }

    isSaving = true;
    pendingSave = false;

    try {
        const stateToSave = {
            player1: gameState.player1,
            player2: gameState.player2,
            timerSeconds: gameState.timerSeconds,
            decidingGameSwitched: gameState.decidingGameSwitched
        };

        await api.updateGameState(courtId, stateToSave);
    } catch (error) {
        console.error('Failed to save game state:', error);
        // Retry after 5 seconds on error
        pendingSave = true;
        setTimeout(performSave, 5000);
    } finally {
        isSaving = false;

        // If another save was requested while we were saving, do it now
        if (pendingSave) {
            setTimeout(performSave, 100);
        }
    }
}

// Load game state from API
async function loadGameState() {
    try {
        const loaded = await api.getGameState(courtId);

        gameState.player1 = loaded.player1;
        gameState.player2 = loaded.player2;
        gameState.timerSeconds = loaded.timerSeconds;
        gameState.currentCourt = courtId;
        gameState.isActive = loaded.isActive;
        gameState.isDoubles = loaded.isDoubles || false;
        gameState.gameMode = loaded.gameMode || '21';
        gameState.decidingGameSwitched = loaded.decidingGameSwitched || false;

        // Ensure name2 exists for backwards compatibility
        if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
        if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';
    } catch (error) {
        console.error('Failed to load game state:', error);
        // Continue with default state
    }
}

// Save match result to API
async function saveMatchResult(winner, loser, winnerGames, loserGames) {
    try {
        const matchData = {
            courtId: courtId,
            winnerName: winner,
            loserName: loser,
            gamesWon: `${winnerGames}-${loserGames}`,
            duration: formatDuration(gameState.timerSeconds)
        };

        await api.saveMatchResult(matchData);
    } catch (error) {
        console.error('Failed to save match result:', error);
        alert('Advarsel: Kampresultatet kunne ikke gemmes.');
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Cleanup on page unload - save immediately before leaving
window.addEventListener('beforeunload', async function() {
    // Cancel any pending debounced save
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // Perform immediate save
    if (pendingSave) {
        // Use synchronous XHR for beforeunload (fetch won't complete in time)
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `/api/game-states/${courtId}`, false); // false = synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');

        const stateToSave = {
            player1: gameState.player1,
            player2: gameState.player2,
            timerSeconds: gameState.timerSeconds,
            decidingGameSwitched: gameState.decidingGameSwitched
        };

        try {
            xhr.send(JSON.stringify(stateToSave));
        } catch (e) {
            // Ignore errors during unload
        }
    }
});
