// Court-specific script - gets court ID from URL parameter
const api = window.BadmintonAPI;

// Get court ID from URL
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

// Holdkamp state
let activeTeamMatch = null;
let assignedGameId = null;

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
    matchStartTime: null,  // Timestamp when match started (from server)
    matchEndTime: null,    // Timestamp when match ended (from server)
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
    restBreakTitle: '',  // Title to display during rest break
    matchCompleted: false,  // Track if match is completed and confirmed
    history: []  // Track history of game state snapshots for undo functionality
};

// Debouncing variables
let saveTimeout = null;
let isSaving = false;
let pendingSave = false;
let lastScoreUpdateTime = 0; // Timestamp of last local score update
let lastDoublesModeUpdateTime = 0; // Timestamp of last local doubles mode change

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    await initializeApp();
    await loadGameState();
    updateDisplay();
    setupEventListeners();
    startPeriodicSync();
    await initHoldkampPanel();
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

        // Show/hide elements based on tournament mode settings
        const isTournamentMode = settings.showResetButton === false;

        // Hide "Ryd Banen" button
        const clearBtn = document.getElementById('clearCourtBtn');
        if (clearBtn) {
            clearBtn.style.display = isTournamentMode ? 'none' : 'inline-block';
        }

        // Hide "Skift til Double" button
        const doublesToggle = document.getElementById('doublesToggle');
        if (doublesToggle) {
            doublesToggle.style.display = isTournamentMode ? 'none' : 'inline-block';
        }

        // Hide "Tilbage" button
        const backBtn = document.querySelector('.btn-back');
        if (backBtn) {
            backBtn.style.display = isTournamentMode ? 'none' : 'inline-block';
        }

        // Hide "Admin" button
        const adminBtn = document.querySelector('a[href="admin.html"]');
        if (adminBtn) {
            adminBtn.style.display = isTournamentMode ? 'none' : 'inline-block';
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

    // Action buttons
    document.getElementById('undoBtn').addEventListener('click', undoLastAction);
    document.getElementById('switchSidesBtn').addEventListener('click', switchSides);
    document.getElementById('doublesToggle').addEventListener('click', toggleDoubles);
    document.getElementById('clearCourtBtn').addEventListener('click', clearCourt);
    document.getElementById('startMatchBtn').addEventListener('click', manualStartMatch);

    // Rest break skip button
    document.getElementById('skipRestBreak').addEventListener('click', endRestBreak);
}

// History management functions
function saveStateToHistory() {
    // Create a deep copy of the current game state (excluding non-serializable properties)
    const snapshot = {
        player1: {
            name: gameState.player1.name,
            name2: gameState.player1.name2,
            score: gameState.player1.score,
            games: gameState.player1.games
        },
        player2: {
            name: gameState.player2.name,
            name2: gameState.player2.name2,
            score: gameState.player2.score,
            games: gameState.player2.games
        },
        isDoubles: gameState.isDoubles,
        gameMode: gameState.gameMode,
        decidingGameSwitched: gameState.decidingGameSwitched,
        setScoresHistory: JSON.parse(JSON.stringify(gameState.setScoresHistory)),
        restBreakTaken: gameState.restBreakTaken,
        matchStartTime: gameState.matchStartTime,
        matchEndTime: gameState.matchEndTime,
        matchCompleted: gameState.matchCompleted
    };

    // Add snapshot to history (limit to last 100 actions to prevent memory issues)
    gameState.history.push(snapshot);
    if (gameState.history.length > 100) {
        gameState.history.shift(); // Remove oldest snapshot
    }
}

function restoreStateFromHistory() {
    if (gameState.history.length === 0) {
        return false; // No history to restore
    }

    // Get the last snapshot and remove it from history
    const snapshot = gameState.history.pop();

    // Restore the game state from snapshot
    gameState.player1.name = snapshot.player1.name;
    gameState.player1.name2 = snapshot.player1.name2;
    gameState.player1.score = snapshot.player1.score;
    gameState.player1.games = snapshot.player1.games;

    gameState.player2.name = snapshot.player2.name;
    gameState.player2.name2 = snapshot.player2.name2;
    gameState.player2.score = snapshot.player2.score;
    gameState.player2.games = snapshot.player2.games;

    gameState.isDoubles = snapshot.isDoubles;
    gameState.gameMode = snapshot.gameMode;
    gameState.decidingGameSwitched = snapshot.decidingGameSwitched;
    gameState.setScoresHistory = snapshot.setScoresHistory;
    gameState.restBreakTaken = snapshot.restBreakTaken;
    gameState.matchStartTime = snapshot.matchStartTime;
    gameState.matchEndTime = snapshot.matchEndTime;
    gameState.matchCompleted = snapshot.matchCompleted;

    return true; // Successfully restored
}

function undoLastAction() {
    // Prevent undo if match is completed
    if (gameState.matchCompleted) {
        showMessage('Ikke Tilladt', 'Kan ikke fortryde efter kampen er afsluttet.');
        return;
    }

    // Check if there's any history to undo
    if (gameState.history.length === 0) {
        showMessage('Ingen Historik', 'Der er ingen handlinger at fortryde.');
        return;
    }

    // Cancel any active rest break
    if (gameState.restBreakActive) {
        gameState.restBreakCallback = null;
        endRestBreak();
    }

    // Restore previous state
    if (restoreStateFromHistory()) {
        // Restart timer if match ended but now we're undoing
        if (gameState.matchEndTime) {
            gameState.matchEndTime = null;
            if (!gameState.timerRunning && gameState.matchStartTime) {
                startTimer();
            }
        }

        updateDisplay();

        // Mark that we just updated scores locally
        lastScoreUpdateTime = Date.now();
        saveGameState();
    }
}

function addPoint(player) {
    // Prevent adding points if match is completed
    if (gameState.matchCompleted) {
        return;
    }

    // Save current state to history before making changes
    saveStateToHistory();

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
        // Set match start time if not already set
        if (!gameState.matchStartTime) {
            gameState.matchStartTime = new Date().toISOString();
        }
        document.getElementById('holdkampPanel').style.display = 'none';
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

    // Mark that we just updated scores locally
    lastScoreUpdateTime = Date.now();
    saveGameState();
}

// removePoint function removed - replaced by undoLastAction which uses history snapshots

function undoLastSet(player) {
    // Check if there's a set to undo
    if (gameState.setScoresHistory.length === 0) {
        return;
    }

    // Get the last completed set
    const lastSet = gameState.setScoresHistory[gameState.setScoresHistory.length - 1];

    // Parse the score from the last set
    let p1Score, p2Score;
    if (typeof lastSet === 'string') {
        // Old format: "21-19"
        const scores = lastSet.split('-');
        p1Score = parseInt(scores[0]);
        p2Score = parseInt(scores[1]);
    } else {
        // New format: {player1Name, player2Name, score: "21-19"}
        const scores = lastSet.score.split('-');
        p1Score = parseInt(scores[0]);
        p2Score = parseInt(scores[1]);
    }

    // Restore the scores from the last set minus one point
    gameState.player1.score = p1Score;
    gameState.player2.score = p2Score;

    // Remove one point from the player who won (to undo the winning point)
    if (player === 1 && gameState.player1.score > 0) {
        gameState.player1.score--;
    } else if (player === 2 && gameState.player2.score > 0) {
        gameState.player2.score--;
    }

    // Decrease the games counter for the winner
    if (player === 1) {
        gameState.player1.games--;
    } else {
        gameState.player2.games--;
    }

    // Remove the last set from history
    gameState.setScoresHistory.pop();

    // If match was ended (timer stopped), restart it
    if (gameState.matchEndTime) {
        gameState.matchEndTime = null;
        startTimer();
    }

    updateDisplay();

    // Mark that we just updated scores locally
    lastScoreUpdateTime = Date.now();
    saveGameState();
}

async function checkGameWin() {
    const p1Score = gameState.player1.score;
    const p2Score = gameState.player2.score;

    // Determine win conditions based on game mode
    const winScore = gameState.gameMode === '21' ? 21 : 15;
    const maxScore = gameState.gameMode === '21' ? 30 : 21;

    // Badminton rules: first to winScore, must win by 2, max maxScore
    if ((p1Score >= winScore && p1Score - p2Score >= 2) || p1Score === maxScore) {
        gameState.player1.games++;
        // Save the set score with player names (including partners for doubles)
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player1Name2: gameState.player1.name2 || null,
            player2Name: gameState.player2.name,
            player2Name2: gameState.player2.name2 || null,
            score: `${p1Score}-${p2Score}`
        });

        // Check if player won the match (2 games)
        if (gameState.player1.games === 2) {
            // Stop the timer display
            stopTimer();

            // Show message with option to save or undo
            const winnerNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);
            showMessage(
                'Kamp Vundet!',
                `${winnerNames} vinder kampen ${gameState.player1.games}-${gameState.player2.games}!`,
                [
                    {
                        text: 'OK',
                        callback: () => {
                            // Mark match as completed
                            gameState.matchCompleted = true;
                            // Disable all controls
                            disableAllControls();
                            // Save match result only when OK is clicked
                            saveMatchResult(gameState.player1.name, gameState.player2.name,
                                           gameState.player1.games, gameState.player2.games);
                            // Save game state with matchCompleted flag
                            saveGameState();
                        },
                        style: 'primary'
                    },
                    {
                        text: 'Fortryd',
                        callback: () => {
                            undoLastSet(1);
                        },
                        style: 'secondary'
                    }
                ]
            );
            return;
        }

        // Set won but not match - start timer immediately and show message with undo option
        const winnerNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);

        // Start 2-minute rest break immediately in 21/30 mode (in background, no overlay yet)
        if (gameState.gameMode === '21') {
            await startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
                resetScores();
                gameState.decidingGameSwitched = false;
                switchSides();
            }, false); // showOverlay = false, timer runs in background
        }

        showMessage(
            'Sæt Vundet!',
            `${winnerNames} vinder dette sæt!`,
            [
                {
                    text: 'Fortsæt',
                    callback: () => {
                        if (gameState.gameMode === '21') {
                            // Show the rest break overlay (timer already running)
                            showRestBreakOverlay();
                        } else {
                            // In 15/21 mode, reset and switch when Fortsæt is clicked
                            resetScores();
                            gameState.decidingGameSwitched = false;
                            switchSides();
                        }
                    },
                    style: 'primary'
                },
                {
                    text: 'Fortryd',
                    callback: () => {
                        // Cancel timer if running
                        if (gameState.restBreakActive) {
                            // Clear callback so it doesn't execute when we end the break
                            gameState.restBreakCallback = null;
                            // Stop the rest break timer
                            endRestBreak();
                        }
                        // Undo the set
                        undoLastSet(1);
                    },
                    style: 'secondary'
                }
            ]
        );
    } else if ((p2Score >= winScore && p2Score - p1Score >= 2) || p2Score === maxScore) {
        gameState.player2.games++;
        // Save the set score with player names (including partners for doubles)
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player1Name2: gameState.player1.name2 || null,
            player2Name: gameState.player2.name,
            player2Name2: gameState.player2.name2 || null,
            score: `${p1Score}-${p2Score}`
        });

        // Check if player won the match (2 games)
        if (gameState.player2.games === 2) {
            // Stop the timer display
            stopTimer();

            // Show message with option to save or undo
            const winnerNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);
            showMessage(
                'Kamp Vundet!',
                `${winnerNames} vinder kampen ${gameState.player2.games}-${gameState.player1.games}!`,
                [
                    {
                        text: 'OK',
                        callback: () => {
                            // Mark match as completed
                            gameState.matchCompleted = true;
                            // Disable all controls
                            disableAllControls();
                            // Save match result only when OK is clicked
                            saveMatchResult(gameState.player2.name, gameState.player1.name,
                                           gameState.player2.games, gameState.player1.games);
                            // Save game state with matchCompleted flag
                            saveGameState();
                        },
                        style: 'primary'
                    },
                    {
                        text: 'Fortryd',
                        callback: () => {
                            undoLastSet(2);
                        },
                        style: 'secondary'
                    }
                ]
            );
            return;
        }

        // Set won but not match - start timer immediately and show message with undo option
        const winnerNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);

        // Start 2-minute rest break immediately in 21/30 mode (in background, no overlay yet)
        if (gameState.gameMode === '21') {
            await startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
                resetScores();
                gameState.decidingGameSwitched = false;
                switchSides();
            }, false); // showOverlay = false, timer runs in background
        }

        showMessage(
            'Sæt Vundet!',
            `${winnerNames} vinder dette sæt!`,
            [
                {
                    text: 'Fortsæt',
                    callback: () => {
                        if (gameState.gameMode === '21') {
                            // Show the rest break overlay (timer already running)
                            showRestBreakOverlay();
                        } else {
                            // In 15/21 mode, reset and switch when Fortsæt is clicked
                            resetScores();
                            gameState.decidingGameSwitched = false;
                            switchSides();
                        }
                    },
                    style: 'primary'
                },
                {
                    text: 'Fortryd',
                    callback: () => {
                        // Cancel timer if running
                        if (gameState.restBreakActive) {
                            // Clear callback so it doesn't execute when we end the break
                            gameState.restBreakCallback = null;
                            // Stop the rest break timer
                            endRestBreak();
                        }
                        // Undo the set
                        undoLastSet(2);
                    },
                    style: 'secondary'
                }
            ]
        );
    }
}

function resetScores() {
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    gameState.restBreakTaken = false;  // Reset rest break flag for new set
    updateDisplay();

    // Mark that we just updated scores locally
    lastScoreUpdateTime = Date.now();
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
                    gameState.matchCompleted = false;
                    resetTimer();

                    // Re-enable all controls
                    enableAllControls();

                    updateDisplay();

                    // Mark that we just updated scores locally
                    lastScoreUpdateTime = Date.now();
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
                    // Release holdkamp game back to pending if assigned
                    if (assignedGameId && activeTeamMatch) {
                        try {
                            await api.updateTeamMatchGame(activeTeamMatch.id, assignedGameId, {
                                status: 'pending',
                                courtNumber: null
                            });
                        } catch (e) {
                            console.error('Failed to release holdkamp game:', e);
                        }
                        assignedGameId = null;
                    }

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
                        gameState.matchCompleted = false;
                        resetTimer();

                        // Re-enable all controls
                        enableAllControls();

                        updateDisplay();

                        // Mark that we just updated scores locally
                        lastScoreUpdateTime = Date.now();
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
    // Timer functionality removed - timer runs automatically based on server timestamps
    // Keeping function for backwards compatibility but it does nothing
    console.log('Manual timer control disabled - timer runs automatically when match starts');
}

function startTimer() {
    // Start display interval if not already running
    if (!gameState.timerRunning) {
        gameState.timerInterval = setInterval(function() {
            updateTimerDisplay();
        }, 1000);
        gameState.timerRunning = true;
    }

    // Disable start match button when timer is running
    updateStartMatchButton();
}

function manualStartMatch() {
    // Don't start if match is already started or completed
    if (gameState.matchStartTime || gameState.matchCompleted) {
        return;
    }

    // Set match start time to now
    gameState.matchStartTime = new Date().toISOString();

    // Hide holdkamp panel once match starts
    document.getElementById('holdkampPanel').style.display = 'none';

    // Start timer display
    startTimer();

    // Save state to database
    saveGameState();

    // Update button state
    updateStartMatchButton();
}

function updateStartMatchButton() {
    const startBtn = document.getElementById('startMatchBtn');
    if (startBtn) {
        // Disable button if match has started or is completed
        startBtn.disabled = !!(gameState.matchStartTime || gameState.matchCompleted);
    }
}

function stopTimer() {
    // Stop display interval
    if (gameState.timerRunning && gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
        gameState.timerRunning = false;
    }
}

function resetTimer() {
    stopTimer();
    gameState.matchStartTime = null;
    gameState.matchEndTime = null;
    updateTimerDisplay();
    saveGameState();
}

function updateTimerDisplay() {
    let elapsedSeconds = 0;

    if (gameState.matchStartTime) {
        // Calculate elapsed time from server timestamp
        const startTime = new Date(gameState.matchStartTime);
        const endTime = gameState.matchEndTime ? new Date(gameState.matchEndTime) : new Date();
        const elapsedMs = endTime - startTime;
        elapsedSeconds = Math.floor(elapsedMs / 1000);
    }

    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    document.getElementById('timerDisplay').textContent =
        `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

    // Update timerSeconds for backwards compatibility (used in match history)
    gameState.timerSeconds = elapsedSeconds;
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
    updateStartMatchButton();
}

function toggleDoubles() {
    // Prevent toggling doubles if match is completed
    if (gameState.matchCompleted) {
        return;
    }

    const newMode = gameState.isDoubles ? 'single' : 'double';
    showMessage(
        'Skift Tilstand?',
        `Er du sikker på at du vil skifte til ${newMode} tilstand?`,
        [
            {
                text: 'Ja, Skift',
                callback: () => {
                    gameState.isDoubles = !gameState.isDoubles;
                    lastDoublesModeUpdateTime = Date.now(); // Track local doubles mode change
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

function formatPlayerNames(playerName, playerName2) {
    // Format player names for display (includes partner ONLY if doubles mode)
    if (gameState.isDoubles && playerName2 && playerName2.trim() !== '') {
        return `${playerName} / ${playerName2}`;
    }
    return playerName;
}

function switchSides() {
    // Prevent switching sides if match is completed
    if (gameState.matchCompleted) {
        return;
    }

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

function disableAllControls() {
    // Disable all score buttons
    const scoreButtons = document.querySelectorAll('.btn-score, .btn-score-minus');
    scoreButtons.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    });

    // Disable action buttons
    const switchSidesBtn = document.getElementById('switchSidesBtn');
    const doublesToggleBtn = document.getElementById('doublesToggle');

    if (switchSidesBtn) {
        switchSidesBtn.disabled = true;
        switchSidesBtn.style.opacity = '0.5';
        switchSidesBtn.style.cursor = 'not-allowed';
    }

    if (doublesToggleBtn) {
        doublesToggleBtn.disabled = true;
        doublesToggleBtn.style.opacity = '0.5';
        doublesToggleBtn.style.cursor = 'not-allowed';
    }

    // Disable player name inputs
    document.getElementById('player1Name').disabled = true;
    document.getElementById('player1Name2').disabled = true;
    document.getElementById('player2Name').disabled = true;
    document.getElementById('player2Name2').disabled = true;
}

function enableAllControls() {
    // Enable all score buttons
    const scoreButtons = document.querySelectorAll('.btn-score, .btn-score-minus');
    scoreButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
    });

    // Enable action buttons
    const switchSidesBtn = document.getElementById('switchSidesBtn');
    const doublesToggleBtn = document.getElementById('doublesToggle');

    if (switchSidesBtn) {
        switchSidesBtn.disabled = false;
        switchSidesBtn.style.opacity = '1';
        switchSidesBtn.style.cursor = 'pointer';
    }

    if (doublesToggleBtn) {
        doublesToggleBtn.disabled = false;
        doublesToggleBtn.style.opacity = '1';
        doublesToggleBtn.style.cursor = 'pointer';
    }

    // Enable player name inputs
    document.getElementById('player1Name').disabled = false;
    document.getElementById('player1Name2').disabled = false;
    document.getElementById('player2Name').disabled = false;
    document.getElementById('player2Name2').disabled = false;
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
            matchStartTime: gameState.matchStartTime,
            matchEndTime: gameState.matchEndTime,
            decidingGameSwitched: gameState.decidingGameSwitched,
            restBreakActive: gameState.restBreakActive,
            restBreakSecondsLeft: gameState.restBreakSecondsLeft,
            restBreakTitle: gameState.restBreakTitle,
            isDoubles: gameState.isDoubles,
            setScoresHistory: gameState.setScoresHistory,
            matchCompleted: gameState.matchCompleted
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
        gameState.matchStartTime = loaded.matchStartTime;
        gameState.matchEndTime = loaded.matchEndTime;
        gameState.setScoresHistory = loaded.setScoresHistory || [];
        gameState.matchCompleted = loaded.matchCompleted || false;

        // Ensure name2 exists for backwards compatibility
        if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
        if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';

        // Start timer display if match is active and not ended
        if (gameState.matchStartTime && !gameState.matchEndTime) {
            startTimer();
        }

        // Disable all controls if match is completed
        if (gameState.matchCompleted) {
            disableAllControls();
        }
    } catch (error) {
        console.error('Failed to load game state:', error);
        // Continue with default state
    }
}

// Periodically sync game state with server to detect external changes (e.g., admin reset)
async function syncGameState() {
    try {
        // Don't sync if we're currently saving to avoid conflicts
        if (isSaving) {
            return;
        }

        const loaded = await api.getGameState(courtId);

        // Check if court was reset by admin (all scores/games back to 0 AND no matchStartTime)
        const wasReset = (
            loaded.player1.score === 0 &&
            loaded.player1.games === 0 &&
            loaded.player2.score === 0 &&
            loaded.player2.games === 0 &&
            !loaded.matchStartTime &&  // Backend has no matchStartTime
            (gameState.player1.score > 0 || gameState.player1.games > 0 ||
             gameState.player2.score > 0 || gameState.player2.games > 0 ||
             gameState.matchStartTime)  // But frontend has data
        );

        if (wasReset) {
            // Stop timer display
            stopTimer();

            // Stop rest break if active
            if (gameState.restBreakActive) {
                gameState.restBreakActive = false;
                if (gameState.restBreakInterval) {
                    clearInterval(gameState.restBreakInterval);
                    gameState.restBreakInterval = null;
                }
            }

            // Reset game state
            gameState.player1 = loaded.player1;
            gameState.player2 = loaded.player2;
            gameState.timerSeconds = 0;
            gameState.matchStartTime = null;
            gameState.matchEndTime = null;
            gameState.isActive = loaded.isActive;
            gameState.isDoubles = loaded.isDoubles || false;
            gameState.gameMode = loaded.gameMode || '21';
            gameState.decidingGameSwitched = loaded.decidingGameSwitched || false;
            gameState.setScoresHistory = [];
            gameState.restBreakTaken = false;
            gameState.matchCompleted = false;

            // Re-enable all controls after reset
            enableAllControls();

            // Ensure name2 exists
            if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
            if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';

            // Update display
            updateDisplay();

            console.log('Court was reset by admin - state synchronized and controls re-enabled');
        } else {
            // Check if matchCompleted changed from true to false (e.g., admin reset)
            if (gameState.matchCompleted && !loaded.matchCompleted) {
                gameState.matchCompleted = false;
                enableAllControls();
                console.log('Match unlocked by admin - controls re-enabled');
            }

            // Sync player names if changed in database (e.g., admin changed them)
            // Only update if the input field is not currently focused
            const player1NameInput = document.getElementById('player1Name');
            const player1Name2Input = document.getElementById('player1Name2');
            const player2NameInput = document.getElementById('player2Name');
            const player2Name2Input = document.getElementById('player2Name2');

            if (loaded.player1.name !== gameState.player1.name && document.activeElement !== player1NameInput) {
                gameState.player1.name = loaded.player1.name;
                player1NameInput.value = loaded.player1.name;
                console.log('Player 1 name synced from admin:', loaded.player1.name);
            }
            if (loaded.player1.name2 !== gameState.player1.name2 && document.activeElement !== player1Name2Input) {
                gameState.player1.name2 = loaded.player1.name2;
                player1Name2Input.value = loaded.player1.name2;
                console.log('Player 1 partner name synced from admin:', loaded.player1.name2);
            }
            if (loaded.player2.name !== gameState.player2.name && document.activeElement !== player2NameInput) {
                gameState.player2.name = loaded.player2.name;
                player2NameInput.value = loaded.player2.name;
                console.log('Player 2 name synced from admin:', loaded.player2.name);
            }
            if (loaded.player2.name2 !== gameState.player2.name2 && document.activeElement !== player2Name2Input) {
                gameState.player2.name2 = loaded.player2.name2;
                player2Name2Input.value = loaded.player2.name2;
                console.log('Player 2 partner name synced from admin:', loaded.player2.name2);
            }

            // Sync doubles mode if changed
            // BUT: Don't sync if we just toggled doubles locally (within last 2 seconds)
            // This prevents race conditions where local toggle gets overwritten by stale server data
            const timeSinceLastDoublesUpdate = Date.now() - lastDoublesModeUpdateTime;
            const shouldSyncDoubles = timeSinceLastDoublesUpdate > 2000; // 2 second cooldown

            if (shouldSyncDoubles && loaded.isDoubles !== gameState.isDoubles) {
                gameState.isDoubles = loaded.isDoubles;
                updateDoublesDisplay();
                console.log('Doubles mode synced from admin:', loaded.isDoubles);
            }

            // Sync scores and games from other instances
            // BUT: Don't sync if we just updated scores locally (within last 2 seconds)
            // This prevents race conditions where local changes get overwritten by stale server data
            const timeSinceLastUpdate = Date.now() - lastScoreUpdateTime;
            const shouldSyncScores = timeSinceLastUpdate > 2000; // 2 second cooldown

            if (shouldSyncScores &&
                (loaded.player1.score !== gameState.player1.score ||
                 loaded.player2.score !== gameState.player2.score ||
                 loaded.player1.games !== gameState.player1.games ||
                 loaded.player2.games !== gameState.player2.games)) {

                gameState.player1.score = loaded.player1.score;
                gameState.player2.score = loaded.player2.score;
                gameState.player1.games = loaded.player1.games;
                gameState.player2.games = loaded.player2.games;

                // Update display to show new scores
                updateDisplay();

                console.log('Scores synced from other instance:',
                    `${loaded.player1.score}-${loaded.player2.score}`,
                    `Games: ${loaded.player1.games}-${loaded.player2.games}`);
            }

            // Sync game mode if changed
            if (loaded.gameMode && loaded.gameMode !== gameState.gameMode) {
                gameState.gameMode = loaded.gameMode;
                updateDisplay();
                console.log('Game mode synced from other instance:', loaded.gameMode);
            }

            // Sync deciding game switch status
            if (loaded.decidingGameSwitched !== undefined &&
                loaded.decidingGameSwitched !== gameState.decidingGameSwitched) {
                gameState.decidingGameSwitched = loaded.decidingGameSwitched;
                console.log('Deciding game switch synced from other instance:', loaded.decidingGameSwitched);
            }

            // Sync timestamps even if not reset (for timer continuity)
            if (loaded.matchStartTime && !gameState.matchStartTime) {
                // Match started elsewhere, start timer display
                gameState.matchStartTime = loaded.matchStartTime;
                startTimer();
            }
            if (loaded.matchEndTime && !gameState.matchEndTime) {
                // Match ended elsewhere, stop timer display
                gameState.matchEndTime = loaded.matchEndTime;
                stopTimer();
            }
        }
    } catch (error) {
        console.error('Failed to sync game state:', error);
    }
}

// Start periodic synchronization with server
function startPeriodicSync() {
    // Sync every 3 seconds to detect admin actions
    setInterval(syncGameState, 3000);
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

        // Report holdkamp result if assigned
        if (assignedGameId && activeTeamMatch) {
            const game = activeTeamMatch.games.find(g => g.id === assignedGameId);
            let winnerTeam = 2;
            if (game) {
                const team1Names = [game.team1_player1, game.team1_player2].filter(Boolean);
                winnerTeam = team1Names.some(name => winner.includes(name)) ? 1 : 2;
            }
            await reportHoldkampResult(winnerTeam, setScoresText);
            assignedGameId = null;
        }

        // Show holdkamp panel if there are more pending games
        await refreshHoldkampPanel();
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
async function startRestBreak(duration = 60, title = 'Pause 1 minut', callback = null, showOverlay = true) {
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

    // Only show overlay if requested (can start timer in background)
    if (showOverlay) {
        overlay.style.display = 'flex';
    }

    let secondsLeft = duration;
    timerDisplay.textContent = secondsLeft;

    // Start the countdown interval IMMEDIATELY (before the async save)
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

    // Save to database so TV page sees it right away (after interval is started)
    await performSave();
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

function showRestBreakOverlay() {
    // Show the rest break overlay (timer should already be running)
    const overlay = document.getElementById('restBreakOverlay');
    overlay.style.display = 'flex';
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

// ==================== HOLDKAMP ====================

async function initHoldkampPanel() {
    try {
        activeTeamMatch = await api.getActiveTeamMatch();
        if (!activeTeamMatch) return;

        const panel = document.getElementById('holdkampPanel');

        // Register all button listeners once upfront, regardless of code path
        document.getElementById('showHoldkampPanelBtn').style.display = 'inline-block';
        document.getElementById('showHoldkampPanelBtn').addEventListener('click', () => {
            panel.style.display = 'block';
        });
        document.getElementById('closeHoldkampPanelBtn').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        document.getElementById('assignHoldkampBtn').addEventListener('click', assignHoldkampGame);

        const myGame = activeTeamMatch.games.find(g => g.court_number === courtId && g.status === 'active');
        if (myGame) {
            assignedGameId = myGame.id;
            applyHoldkampGameToState(myGame);
            showHoldkampAssigned(myGame);
            return;
        }

        const pendingGames = activeTeamMatch.games.filter(g => g.status === 'pending');
        if (pendingGames.length === 0) return;

        const select = document.getElementById('holdkampGameSelect');
        select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
        const pendingCounts = {};
        pendingGames.forEach(g => {
            pendingCounts[g.category] = (pendingCounts[g.category] || 0) + 1;
            const num = pendingCounts[g.category];
            const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
            const t1 = isDoubles
                ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
                : (g.team1_player1 || '?');
            const t2 = isDoubles
                ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
                : (g.team2_player1 || '?');
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.category} ${num}: ${t1} vs ${t2}`;
            select.appendChild(opt);
        });

        panel.style.display = 'block';
    } catch (error) {
        console.error('Failed to init holdkamp panel:', error);
    }
}

function applyHoldkampGameToState(game) {
    const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(game.category);
    if (game.team1_player1) {
        gameState.player1.name = game.team1_player1;
        if (isDoubles && game.team1_player2) gameState.player1.name2 = game.team1_player2;
    }
    if (game.team2_player1) {
        gameState.player2.name = game.team2_player1;
        if (isDoubles && game.team2_player2) gameState.player2.name2 = game.team2_player2;
    }
    gameState.isDoubles = isDoubles;
    updateDisplay();
    saveGameState();
}

async function assignHoldkampGame() {
    const gameId = parseInt(document.getElementById('holdkampGameSelect').value);
    if (!gameId || !activeTeamMatch) return;

    const game = activeTeamMatch.games.find(g => g.id === gameId);
    if (!game) return;

    try {
        await api.updateTeamMatchGame(activeTeamMatch.id, gameId, {
            courtNumber: courtId,
            status: 'active'
        });

        assignedGameId = gameId;
        applyHoldkampGameToState(game);
        showHoldkampAssigned(game);
    } catch (error) {
        console.error('Failed to assign holdkamp game:', error);
    }
}

function showHoldkampAssigned(game) {
    const panel = document.getElementById('holdkampPanel');
    document.getElementById('holdkampGameSelect').style.display = 'none';
    document.getElementById('assignHoldkampBtn').style.display = 'none';

    const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(game.category);
    const t1 = isDoubles
        ? `${game.team1_player1 || '?'}${game.team1_player2 ? ' & ' + game.team1_player2 : ''}`
        : (game.team1_player1 || '?');
    const t2 = isDoubles
        ? `${game.team2_player1 || '?'}${game.team2_player2 ? ' & ' + game.team2_player2 : ''}`
        : (game.team2_player1 || '?');

    const assignedDiv = document.getElementById('holdkampAssigned');
    assignedDiv.style.display = 'block';
    assignedDiv.textContent = `✓ Tilknyttet: ${game.category} – ${t1} vs ${t2}`;
    panel.style.display = 'none';
}

async function refreshHoldkampPanel() {
    try {
        activeTeamMatch = await api.getActiveTeamMatch();
        if (!activeTeamMatch) return;

        assignedGameId = null;

        const panel = document.getElementById('holdkampPanel');
        const select = document.getElementById('holdkampGameSelect');
        const assignBtn = document.getElementById('assignHoldkampBtn');
        const assignedDiv = document.getElementById('holdkampAssigned');

        const pendingGames = activeTeamMatch.games.filter(g => g.status === 'pending');
        if (pendingGames.length === 0) return;

        assignedDiv.style.display = 'none';
        select.style.display = '';
        assignBtn.style.display = '';

        select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
        const pendingCounts = {};
        pendingGames.forEach(g => {
            pendingCounts[g.category] = (pendingCounts[g.category] || 0) + 1;
            const num = pendingCounts[g.category];
            const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
            const t1 = isDoubles
                ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
                : (g.team1_player1 || '?');
            const t2 = isDoubles
                ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
                : (g.team2_player1 || '?');
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.category} ${num}: ${t1} vs ${t2}`;
            select.appendChild(opt);
        });

        panel.style.display = 'block';
    } catch (error) {
        console.error('Failed to refresh holdkamp panel:', error);
    }
}

async function reportHoldkampResult(winnerTeam, setScores) {
    if (!activeTeamMatch || !assignedGameId) return;
    try {
        await api.updateTeamMatchGame(activeTeamMatch.id, assignedGameId, {
            status: 'finished',
            winnerTeam,
            setScores
        });
    } catch (error) {
        console.error('Failed to report holdkamp result:', error);
    }
}
