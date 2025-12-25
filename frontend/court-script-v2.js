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
    decidingGameSwitched: false,  // Track if sides switched at 11 in deciding game
    setScoresHistory: [],  // Store scores from each completed set
    restBreakTaken: false,  // Track if rest break at 11 points has been taken this set
    restBreakActive: false,  // Track if rest break is currently active
    restBreakInterval: null,  // Interval for rest break countdown
    restBreakCallback: null,  // Callback to execute when rest break ends
    restBreakSecondsLeft: 0,  // Seconds remaining in rest break
    restBreakTitle: ''  // Title to display during rest break
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
            showMessage(
                'Fejl',
                `Bane ${courtId} findes ikke. Omdirigerer til landingsside.`,
                [{ text: 'OK', callback: () => window.location.href = 'landing.html', style: 'primary' }]
            );
        }

        // Show/hide reset button based on settings
        const clearBtn = document.getElementById('clearCourtBtn');
        if (clearBtn) {
            clearBtn.style.display = settings.showResetButton === false ? 'none' : 'inline-block';
        }
    } catch (error) {
        console.error('Failed to initialize app:', error);
        showMessage('Fejl', 'Kunne ikke indlæse bane. Tjek din forbindelse.');
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
    document.getElementById('doublesToggle').addEventListener('click', toggleDoubles);
    document.getElementById('clearCourtBtn').addEventListener('click', clearCourt);

    // Rest break skip button
    document.getElementById('skipRestBreak').addEventListener('click', endRestBreak);
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

    // Check for rest break at 11 points
    checkRestBreak();

    // Check for side switch at 11 points in deciding game (when games are 1-1)
    const isDecidingGame = gameState.player1.games === 1 && gameState.player2.games === 1;
    const scoredTo11 = gameState.player1.score === 11 || gameState.player2.score === 11;

    if (isDecidingGame && scoredTo11 && !gameState.decidingGameSwitched) {
        gameState.decidingGameSwitched = true;
        switchSides();
        showMessage('Skift Sider!', 'Point har nået 11 i afgørende sæt. Spillere har skiftet side!');
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
        // Save the set score with player names
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player2Name: gameState.player2.name,
            score: `${p1Score}-${p2Score}`
        });

        // Check if player won the match (2 games)
        if (gameState.player1.games === 2) {
            // Stop the timer
            if (gameState.timerRunning) {
                clearInterval(gameState.timerInterval);
                gameState.timerRunning = false;
                document.getElementById('startTimer').textContent = 'Start';
            }

            saveMatchResult(gameState.player1.name, gameState.player2.name,
                           gameState.player1.games, gameState.player2.games);
            showMessage(
                'Kamp Vundet!',
                `${gameState.player1.name} vinder kampen ${gameState.player1.games}-${gameState.player2.games}!`,
                [
                    { text: 'OK', callback: null, style: 'primary' }
                ]
            );
            return;
        }

        // Set won but not match - trigger 2-minute break for 21/30 mode
        showMessage('Sæt Vundet!', `${gameState.player1.name} vinder dette sæt!`);
        if (gameState.gameMode === '21') {
            // Start 2-minute rest break with callback to reset and switch
            startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
                resetScores();
                gameState.decidingGameSwitched = false;
                switchSides();
            });
        } else {
            resetScores();
            gameState.decidingGameSwitched = false;
            switchSides();
        }
    } else if ((p2Score >= winScore && p2Score - p1Score >= 2) || p2Score === maxScore) {
        gameState.player2.games++;
        // Save the set score with player names
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player2Name: gameState.player2.name,
            score: `${p1Score}-${p2Score}`
        });

        // Check if player won the match (2 games)
        if (gameState.player2.games === 2) {
            // Stop the timer
            if (gameState.timerRunning) {
                clearInterval(gameState.timerInterval);
                gameState.timerRunning = false;
                document.getElementById('startTimer').textContent = 'Start';
            }

            saveMatchResult(gameState.player2.name, gameState.player1.name,
                           gameState.player2.games, gameState.player1.games);
            showMessage(
                'Kamp Vundet!',
                `${gameState.player2.name} vinder kampen ${gameState.player2.games}-${gameState.player1.games}!`,
                [
                    { text: 'OK', callback: null, style: 'primary' }
                ]
            );
            return;
        }

        // Set won but not match - trigger 2-minute break for 21/30 mode
        showMessage('Sæt Vundet!', `${gameState.player2.name} vinder dette sæt!`);
        if (gameState.gameMode === '21') {
            // Start 2-minute rest break with callback to reset and switch
            startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
                resetScores();
                gameState.decidingGameSwitched = false;
                switchSides();
            });
        } else {
            resetScores();
            gameState.decidingGameSwitched = false;
            switchSides();
        }
    }
}

function resetScores() {
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    gameState.restBreakTaken = false;  // Reset rest break flag for new set
    updateDisplay();
    saveGameState();
}

function startNewGame() {
    showMessage(
        'Start Nyt Sæt?',
        'Nuværende point vil blive nulstillet.',
        [
            { text: 'Ja, Start', callback: () => resetScores(), style: 'primary' },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
}

function startNewMatch() {
    showMessage(
        'Start Ny Kamp?',
        'Alle point og sæt vil blive nulstillet.',
        [
            {
                text: 'Ja, Start',
                callback: async () => {
                    gameState.player1.score = 0;
                    gameState.player2.score = 0;
                    gameState.player1.games = 0;
                    gameState.player2.games = 0;
                    gameState.setScoresHistory = [];
                    gameState.restBreakTaken = false;
                    resetTimer();
                    updateDisplay();
                    saveGameState();

                    // Set court as inactive after 20 seconds to show sponsors on TV
                    setTimeout(async () => {
                        try {
                            await api.updateCourt(courtId, { isActive: false });
                            console.log('Court set to inactive after reset');
                        } catch (error) {
                            console.error('Failed to set court inactive:', error);
                        }
                    }, 20000);
                },
                style: 'primary'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
}

function clearCourt() {
    showMessage(
        'Ryd Banen?',
        'Dette vil nulstille alle point og tidtagerdata for denne bane og sætte banen til inaktiv.',
        [
            {
                text: 'Ja, Ryd',
                callback: async () => {
                    try {
                        // Reset all game state values including player names
                        gameState.player1.name = 'Spiller 1';
                        gameState.player1.name2 = 'Makker 1';
                        gameState.player1.score = 0;
                        gameState.player1.games = 0;
                        gameState.player2.name = 'Spiller 2';
                        gameState.player2.name2 = 'Makker 2';
                        gameState.player2.score = 0;
                        gameState.player2.games = 0;
                        gameState.setScoresHistory = [];
                        gameState.restBreakTaken = false;
                        resetTimer();
                        updateDisplay();
                        await saveGameState();

                        // Immediately set court to inactive
                        await api.updateCourt(courtId, { isActive: false });

                        showMessage('Succes', 'Banen er blevet ryddet!', [
                            { text: 'OK', callback: () => window.location.reload(), style: 'primary' }
                        ]);
                    } catch (error) {
                        console.error('Failed to clear court:', error);
                        showMessage('Fejl', 'Kunne ikke rydde banen. Tjek din forbindelse.');
                    }
                },
                style: 'danger'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
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
            // Don't save every second - timer will be saved when points are added
            // This prevents the debounce timer from being constantly reset
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
    showMessage(
        'Skift Tilstand?',
        `Er du sikker på at du vil skifte til ${newMode} tilstand?`,
        [
            {
                text: 'Ja, Skift',
                callback: () => {
                    gameState.isDoubles = !gameState.isDoubles;
                    updateDoublesDisplay();
                    saveGameState();
                },
                style: 'primary'
            },
            { text: 'Annuller', callback: null, style: 'secondary' }
        ]
    );
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

// Debounced save function - saves max once per 0.5 seconds
function saveGameState() {
    // Clear existing timeout
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    // Mark that we have a pending save
    pendingSave = true;

    // Debounce: wait 0.5 seconds before saving (faster sync with TV/Admin)
    saveTimeout = setTimeout(async () => {
        if (pendingSave && !isSaving) {
            await performSave();
        }
    }, 500);
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
            decidingGameSwitched: gameState.decidingGameSwitched,
            restBreakActive: gameState.restBreakActive,
            restBreakSecondsLeft: gameState.restBreakSecondsLeft,
            restBreakTitle: gameState.restBreakTitle,
            isDoubles: gameState.isDoubles,
            setScoresHistory: gameState.setScoresHistory
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
        // Format set scores for match history
        const setScoresText = gameState.setScoresHistory.map(set => {
            if (typeof set === 'string') {
                return set; // Old format
            } else {
                return `${set.player1Name} ${set.score} ${set.player2Name}`; // New format
            }
        }).join(', ');

        const matchData = {
            courtId: courtId,
            winnerName: winner,
            loserName: loser,
            gamesWon: `${winnerGames}-${loserGames}`,
            duration: formatDuration(gameState.timerSeconds),
            setScores: setScoresText
        };

        await api.saveMatchResult(matchData);
    } catch (error) {
        console.error('Failed to save match result:', error);
        showMessage('Advarsel', 'Kampresultatet kunne ikke gemmes.');
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Rest break functions
async function startRestBreak(duration = 60, title = 'Pause 1 minut', callback = null) {
    gameState.restBreakActive = true;
    gameState.restBreakCallback = callback;
    gameState.restBreakSecondsLeft = duration;
    gameState.restBreakTitle = title;
    if (duration === 60) {
        gameState.restBreakTaken = true; // Only set this for 11-point break
    }

    const overlay = document.getElementById('restBreakOverlay');
    const timerDisplay = document.getElementById('restBreakTimer');
    const titleElement = overlay.querySelector('h1');

    titleElement.textContent = title;
    overlay.style.display = 'flex';

    let secondsLeft = duration;
    timerDisplay.textContent = secondsLeft;

    // Immediately save to database so TV page sees it right away
    await performSave();

    gameState.restBreakInterval = setInterval(() => {
        secondsLeft--;
        gameState.restBreakSecondsLeft = secondsLeft;
        timerDisplay.textContent = secondsLeft;

        // Change color as time runs out
        if (secondsLeft <= 10) {
            timerDisplay.style.color = '#e94560';
        } else if (secondsLeft <= 30) {
            timerDisplay.style.color = '#FFA500';
        }

        if (secondsLeft <= 0) {
            endRestBreak();
        }

        // Save state to sync with TV page (debounced)
        saveGameState();
    }, 1000);
}

async function endRestBreak() {
    if (gameState.restBreakInterval) {
        clearInterval(gameState.restBreakInterval);
        gameState.restBreakInterval = null;
    }

    gameState.restBreakActive = false;
    gameState.restBreakSecondsLeft = 0;
    gameState.restBreakTitle = '';

    const overlay = document.getElementById('restBreakOverlay');
    const timerDisplay = document.getElementById('restBreakTimer');

    overlay.style.display = 'none';
    timerDisplay.style.color = '#4CAF50';
    timerDisplay.textContent = '60';

    // Execute callback if one was provided
    if (gameState.restBreakCallback) {
        gameState.restBreakCallback();
        gameState.restBreakCallback = null;
    }

    // Immediately save to database so TV page sees it ended right away
    await performSave();
}

function checkRestBreak() {
    // Check if either player has reached 11 points and break hasn't been taken yet
    // Only trigger rest break in 21/30 mode (gameMode === '21'), not in 15/21 mode
    if (!gameState.restBreakTaken && !gameState.restBreakActive && gameState.gameMode === '21') {
        if (gameState.player1.score === 11 || gameState.player2.score === 11) {
            startRestBreak();
        }
    }
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
        btn.className = button.style === 'secondary' ? 'btn-secondary' : 'btn-primary';
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
