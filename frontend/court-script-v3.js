// Court V3 Script - New version of court page
const api = window.BadmintonAPI;

// Get court ID from URL
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

// Game state
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
    matchStartTime: null,
    matchEndTime: null,
    currentCourt: courtId,
    isActive: false,
    isDoubles: false,
    gameMode: '21',
    decidingGameSwitched: false,
    setScoresHistory: [],
    restBreakTaken: false,
    restBreakActive: false,
    restBreakInterval: null,
    restBreakCallback: null,
    restBreakSecondsLeft: 0,
    restBreakTitle: '',
    matchCompleted: false,
    servingPlayer: null,  // 1 or 2, null if not yet selected
    initialServer: null,  // Track who served first for set resets
    history: []
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

    // Start timer if match is already in progress
    if (gameState.matchStartTime && !gameState.matchEndTime) {
        startTimer();
    }

    // Start periodic sync to detect admin resets
    startPeriodicSync();

    console.log('Court V3 initialized for court', courtId);
});

function setupEventListeners() {
    // Point buttons
    document.getElementById('addPointPlayer1').addEventListener('click', () => addPoint(1));
    document.getElementById('addPointPlayer2').addEventListener('click', () => addPoint(2));

    // Serve selection buttons
    document.getElementById('startServPlayer1').addEventListener('click', () => selectServer(1));
    document.getElementById('startServPlayer2').addEventListener('click', () => selectServer(2));

    // Control buttons
    document.getElementById('startMatchBtn').addEventListener('click', startMatch);
    document.getElementById('undoBtn').addEventListener('click', undoLastAction);
    document.getElementById('skipRestBreak').addEventListener('click', endRestBreak);
    document.getElementById('clearCourtBtn').addEventListener('click', clearCourt);

    // Settings menu
    document.getElementById('settingsBtn').addEventListener('click', openSettingsMenu);
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsMenu);
    document.getElementById('switchSidesBtn').addEventListener('click', () => {
        switchSides();
        closeSettingsMenu();
    });
    document.getElementById('doublesToggle').addEventListener('click', () => {
        toggleDoubles();
        closeSettingsMenu();
    });

    // Close settings menu when clicking outside
    document.getElementById('settingsMenu').addEventListener('click', (e) => {
        if (e.target.id === 'settingsMenu') {
            closeSettingsMenu();
        }
    });

    // Editable player names (in singles, all fields edit 'name', not 'name2')
    setupEditablePlayerName('player1Name1Display', 'player1', 'name');
    setupEditablePlayerName('player1Name2Display', 'player1', 'name');
    setupEditablePlayerName('player2Name1Display', 'player2', 'name');
    setupEditablePlayerName('player2Name2Display', 'player2', 'name');
}

function toggleDoubles() {
    const newMode = gameState.isDoubles ? 'single' : 'double';
    if (!confirm(`Er du sikker på at du vil skifte til ${newMode} tilstand?`)) {
        return;
    }
    gameState.isDoubles = !gameState.isDoubles;
    updateDisplay();
    saveGameState();
}

function openSettingsMenu() {
    document.getElementById('settingsMenu').style.display = 'flex';
}

function closeSettingsMenu() {
    document.getElementById('settingsMenu').style.display = 'none';
}

function addPoint(player) {
    // Cannot add points if match hasn't selected server yet
    if (!gameState.servingPlayer) {
        return;
    }

    // Auto-start timer on first point
    const isFirstPoint = gameState.player1.score === 0 &&
                        gameState.player2.score === 0 &&
                        gameState.player1.games === 0 &&
                        gameState.player2.games === 0 &&
                        !gameState.matchStartTime;

    if (player === 1) {
        gameState.player1.score++;
    } else {
        gameState.player2.score++;
    }

    // Update serving player based on who won the point
    updateServingPlayer(player);

    // Start match automatically on first point
    if (isFirstPoint) {
        gameState.matchStartTime = Date.now();
        gameState.isActive = true;
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

async function checkGameWin() {
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
            gameState.matchEndTime = Date.now();
            gameState.matchCompleted = true;
            const winnerNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);
            const loserNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);

            // Save match result to database
            saveMatchResult(winnerNames, loserNames, gameState.player1.games, gameState.player2.games);

            showMessage(
                'Kamp Vundet!',
                `${winnerNames} vinder kampen ${gameState.player1.games}-${gameState.player2.games}!`,
                [
                    {
                        text: 'Ny Kamp',
                        callback: () => clearCourt(),
                        style: 'primary'
                    }
                ]
            );
            return;
        }

        // Set won but not match - start rest break and show message
        const winnerNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);

        // Start 2-minute rest break immediately in 21/30 mode (in background)
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
                }
            ]
        );
    } else if ((p2Score >= winScore && p2Score - p1Score >= 2) || p2Score === maxScore) {
        gameState.player2.games++;

        // Check if player won the match (2 games)
        if (gameState.player2.games === 2) {
            gameState.matchEndTime = Date.now();
            gameState.matchCompleted = true;
            const winnerNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);
            const loserNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);

            // Save match result to database
            saveMatchResult(winnerNames, loserNames, gameState.player2.games, gameState.player1.games);

            showMessage(
                'Kamp Vundet!',
                `${winnerNames} vinder kampen ${gameState.player2.games}-${gameState.player1.games}!`,
                [
                    {
                        text: 'Ny Kamp',
                        callback: () => clearCourt(),
                        style: 'primary'
                    }
                ]
            );
            return;
        }

        // Set won but not match - start rest break and show message
        const winnerNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);

        // Start 2-minute rest break immediately in 21/30 mode (in background)
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
                }
            ]
        );
    }
}

function resetScores() {
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    gameState.restBreakTaken = false; // Reset for next set

    // In badminton, the winner of the previous game serves first in the next game
    // Determine who won the last game
    if (gameState.player1.games > gameState.player2.games) {
        gameState.servingPlayer = 1;
    } else if (gameState.player2.games > gameState.player1.games) {
        gameState.servingPlayer = 2;
    }
    // If tied (shouldn't happen in normal play), keep current server

    updateDisplay();
    saveGameState();
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

function clearCourt() {
    showMessage(
        'Ryd Banen',
        'Er du sikker på at du vil rydde banen? Alle data vil blive slettet.',
        [
            {
                text: 'Ja, Ryd Banen',
                callback: async () => {
                    // Cancel any active rest break first
                    if (gameState.restBreakActive) {
                        gameState.restBreakCallback = null;
                        await endRestBreak();
                    }

                    // Stop timer if running
                    if (gameState.timerInterval) {
                        clearInterval(gameState.timerInterval);
                        gameState.timerInterval = null;
                    }

                    // Reset game state to defaults
                    gameState.player1.name = 'Spiller 1';
                    gameState.player1.name2 = 'Makker 1';
                    gameState.player1.score = 0;
                    gameState.player1.games = 0;

                    gameState.player2.name = 'Spiller 2';
                    gameState.player2.name2 = 'Makker 2';
                    gameState.player2.score = 0;
                    gameState.player2.games = 0;

                    gameState.matchStartTime = null;
                    gameState.matchEndTime = null;
                    gameState.timerSeconds = 0;
                    gameState.isActive = false;  // Set court as inactive
                    gameState.decidingGameSwitched = false;
                    gameState.matchCompleted = false;
                    gameState.restBreakTaken = false;
                    gameState.servingPlayer = null;  // Reset serving player
                    gameState.initialServer = null;

                    // Update display
                    updateDisplay();

                    // Delete game state from database completely
                    try {
                        await api.resetGameState(courtId);
                        console.log('Court cleared successfully');
                    } catch (error) {
                        console.error('Failed to clear court:', error);
                        showMessage('Fejl', 'Kunne ikke rydde banen i databasen.');
                    }

                    closeSettingsMenu();
                },
                style: 'primary'
            },
            {
                text: 'Annuller',
                callback: () => {},
                style: 'secondary'
            }
        ]
    );
}

async function initializeApp() {
    try {
        // Verify court is valid
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;

        if (courtId < 1 || courtId > courtCount) {
            alert(`Bane ${courtId} findes ikke. Omdirigerer til landingsside.`);
            window.location.href = 'landing.html';
        }

        console.log('Court V3 ready');
    } catch (error) {
        console.error('Failed to initialize Court V3:', error);
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

        // Convert timestamps from string/ISO format to numbers
        gameState.matchStartTime = loaded.matchStartTime ? (typeof loaded.matchStartTime === 'number' ? loaded.matchStartTime : new Date(loaded.matchStartTime).getTime()) : null;
        gameState.matchEndTime = loaded.matchEndTime ? (typeof loaded.matchEndTime === 'number' ? loaded.matchEndTime : new Date(loaded.matchEndTime).getTime()) : null;

        gameState.setScoresHistory = loaded.setScoresHistory || [];
        gameState.matchCompleted = loaded.matchCompleted || false;
        gameState.restBreakActive = loaded.restBreakActive || false;
        gameState.restBreakSecondsLeft = loaded.restBreakSecondsLeft || 0;
        gameState.restBreakTitle = loaded.restBreakTitle || '';
        gameState.restBreakTaken = loaded.restBreakTaken || false;

        // Ensure name2 exists for backwards compatibility
        if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
        if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';
    } catch (error) {
        console.error('Failed to load game state:', error);
        // Continue with default state
    }
}

// Update display with current game state
function updateDisplay() {
    // Update player names on court (for doubles only - singles names are set by updatePlayerNamePositions)
    if (gameState.isDoubles) {
        document.getElementById('player1Name1Display').textContent = gameState.player1.name;
        document.getElementById('player1Name2Display').textContent = gameState.player1.name2;
        document.getElementById('player2Name1Display').textContent = gameState.player2.name;
        document.getElementById('player2Name2Display').textContent = gameState.player2.name2;
    }

    // Update scores
    document.getElementById('player1PointScore').textContent = gameState.player1.score;
    document.getElementById('player2PointScore').textContent = gameState.player2.score;
    document.getElementById('player1SetScore').textContent = gameState.player1.games;
    document.getElementById('player2SetScore').textContent = gameState.player2.games;

    // Update doubles toggle button text
    const doublesBtn = document.getElementById('doublesToggle');
    if (doublesBtn) {
        doublesBtn.textContent = gameState.isDoubles ? 'Skift til Single' : 'Skift til Double';
    }

    // Show/hide serve selection buttons
    const servBtn1 = document.getElementById('startServPlayer1');
    const servBtn2 = document.getElementById('startServPlayer2');
    const addBtn1 = document.getElementById('addPointPlayer1');
    const addBtn2 = document.getElementById('addPointPlayer2');

    if (!gameState.servingPlayer && !gameState.isActive) {
        // Before server is selected: show serve buttons, disable +1 buttons
        servBtn1.classList.remove('hidden');
        servBtn2.classList.remove('hidden');
        addBtn1.disabled = true;
        addBtn2.disabled = true;
    } else {
        // After server is selected: hide serve buttons, enable +1 buttons
        servBtn1.classList.add('hidden');
        servBtn2.classList.add('hidden');
        addBtn1.disabled = false;
        addBtn2.disabled = false;
    }

    // Update serve indicator
    updateServeIndicator();

    // Update player name positions based on serve
    updatePlayerNamePositions();

    // Show/hide start button and timer
    const startBtn = document.getElementById('startMatchBtn');
    const timerDisplay = document.getElementById('timerDisplay');

    // Disable start button if no server selected
    startBtn.disabled = !gameState.servingPlayer;

    if (gameState.matchStartTime && !gameState.matchEndTime) {
        startBtn.style.display = 'none';
        timerDisplay.style.display = 'block';
        updateTimer();
    } else if (!gameState.matchStartTime) {
        startBtn.style.display = 'block';
        timerDisplay.style.display = 'none';
    } else {
        startBtn.style.display = 'none';
        timerDisplay.style.display = 'block';
    }
}

// Select which player serves first
function selectServer(player) {
    if (gameState.isActive) {
        return; // Cannot change server after match started
    }

    gameState.servingPlayer = player;
    gameState.initialServer = player;

    // Enable +1 buttons and Start Kamp button
    updateDisplay();

    console.log(`Player ${player} will serve first`);
}

// Get serving side based on server's score (for singles)
function getServingSide() {
    if (!gameState.servingPlayer) return null;

    const serverScore = gameState.servingPlayer === 1 ? gameState.player1.score : gameState.player2.score;

    // In singles: serve from right when score is even, left when odd
    return serverScore % 2 === 0 ? 'right' : 'left';
}

// Update serving player after a point
function updateServingPlayer(pointWinner) {
    // In badminton, server only changes when server loses the rally
    // If server wins, they keep serving
    // If server loses, opponent becomes the server

    if (pointWinner !== gameState.servingPlayer) {
        gameState.servingPlayer = pointWinner;
    }
}

// Update serve indicator visual on court
function updateServeIndicator() {
    // Remove any existing serve indicator
    const existingIndicator = document.querySelector('.serve-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Only show indicator if server is selected and match is active or about to start
    if (!gameState.servingPlayer) return;

    const servingSide = getServingSide();
    if (!servingSide) return;

    // Create serve indicator element
    const indicator = document.createElement('div');
    indicator.className = 'serve-indicator';

    // Position based on serving player and serving side
    if (gameState.servingPlayer === 1) {
        // Left side of court (opposite of right side)
        // Even score (right court) = bottom field, Odd score (left court) = top field
        if (servingSide === 'right') {
            indicator.classList.add('serve-left-bottom');
        } else {
            indicator.classList.add('serve-left-top');
        }
    } else {
        // Right side of court
        // Even score (right court) = top field, Odd score (left court) = bottom field
        if (servingSide === 'right') {
            indicator.classList.add('serve-right-top');
        } else {
            indicator.classList.add('serve-right-bottom');
        }
    }

    // Add to court surface
    document.querySelector('.court-surface').appendChild(indicator);
}

// Update player name positions based on serving position
function updatePlayerNamePositions() {
    // Get all name display elements
    const leftTop = document.getElementById('player1Name1Display');
    const leftBottom = document.getElementById('player1Name2Display');
    const rightTop = document.getElementById('player2Name1Display');
    const rightBottom = document.getElementById('player2Name2Display');

    // Helper function to safely update text content (don't update if being edited)
    function safeSetText(element, text) {
        if (element.contentEditable !== 'true') {
            element.textContent = text;
        }
    }

    // If no server selected or match not started, show Player 1 in bottom left, Player 2 in top right
    if (!gameState.servingPlayer) {
        safeSetText(leftTop, '');
        safeSetText(leftBottom, gameState.player1.name);
        safeSetText(rightTop, gameState.player2.name);
        safeSetText(rightBottom, '');
        return;
    }

    const servingSide = getServingSide();
    if (!servingSide) return;

    // Determine positions based on who is serving and from which side
    // Server stands where they serve from, receiver stands diagonally opposite

    if (gameState.servingPlayer === 1) {
        // Player 1 (left) is serving
        if (servingSide === 'right') {
            // Player 1 serves from right court (even score) = bottom field for left player
            // Player 1 bottom-left, Player 2 top-right (diagonal)
            safeSetText(leftTop, '');
            safeSetText(leftBottom, gameState.player1.name);
            safeSetText(rightTop, gameState.player2.name);
            safeSetText(rightBottom, '');
        } else {
            // Player 1 serves from left court (odd score) = top field for left player
            // Player 1 top-left, Player 2 bottom-right (diagonal)
            safeSetText(leftTop, gameState.player1.name);
            safeSetText(leftBottom, '');
            safeSetText(rightTop, '');
            safeSetText(rightBottom, gameState.player2.name);
        }
    } else {
        // Player 2 (right) is serving
        if (servingSide === 'right') {
            // Player 2 serves from right court (even score) = top field for right player
            // Player 2 top-right, Player 1 bottom-left (diagonal)
            safeSetText(leftTop, '');
            safeSetText(leftBottom, gameState.player1.name);
            safeSetText(rightTop, gameState.player2.name);
            safeSetText(rightBottom, '');
        } else {
            // Player 2 serves from left court (odd score) = bottom field for right player
            // Player 2 bottom-right, Player 1 top-left (diagonal)
            safeSetText(leftTop, gameState.player1.name);
            safeSetText(leftBottom, '');
            safeSetText(rightTop, '');
            safeSetText(rightBottom, gameState.player2.name);
        }
    }
}

// Undo last action
function undoLastAction() {
    // If server not yet selected and match hasn't started, reset server selection
    if (!gameState.isActive && gameState.servingPlayer) {
        gameState.servingPlayer = null;
        gameState.initialServer = null;
        updateDisplay();
        console.log('Server selection reset');
        return;
    }

    // TODO: Implement full undo for points (with history tracking)
    showMessage('Fortryd', 'Fuld fortryd funktionalitet for point kommer snart. Du kan kun fortryde server-valg før kampen starter.');
}

async function startMatch() {
    if (!gameState.servingPlayer) {
        showMessage('Vælg Server', 'Du skal vælge hvem der server først før kampen kan startes.', [
            { text: 'OK', style: 'primary' }
        ]);
        return;
    }

    gameState.matchStartTime = Date.now();
    gameState.isActive = true;
    updateDisplay();
    startTimer();
    await performSave(); // Save immediately without debouncing
    console.log('Match started');
}

function startTimer() {
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
    }

    gameState.timerInterval = setInterval(() => {
        updateTimer();
    }, 1000);
}

function updateTimer() {
    if (!gameState.matchStartTime) return;

    const now = gameState.matchEndTime || Date.now();
    const elapsed = Math.floor((now - gameState.matchStartTime) / 1000);

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
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
            isActive: gameState.isActive,
            isDoubles: gameState.isDoubles,
            gameMode: gameState.gameMode,
            decidingGameSwitched: gameState.decidingGameSwitched,
            setScoresHistory: gameState.setScoresHistory,
            matchCompleted: gameState.matchCompleted,
            restBreakActive: gameState.restBreakActive,
            restBreakSecondsLeft: gameState.restBreakSecondsLeft,
            restBreakTitle: gameState.restBreakTitle,
            restBreakTaken: gameState.restBreakTaken
        };

        await api.updateGameState(courtId, stateToSave);
        console.log('Game state saved');
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

// Helper function to format player names
function formatPlayerNames(name1, name2) {
    if (gameState.isDoubles && name2 && name2 !== 'Makker 1' && name2 !== 'Makker 2') {
        return `${name1} & ${name2}`;
    }
    return name1;
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
    const titleElement = document.getElementById('restBreakTitle');

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
    timerDisplay.style.color = 'var(--color-accent)';
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

// Save match result to database
async function saveMatchResult(winner, loser, winnerGames, loserGames) {
    try {
        // Calculate duration from timestamps
        let duration = '00:00';
        if (gameState.matchStartTime && gameState.matchEndTime) {
            const durationSeconds = Math.floor((gameState.matchEndTime - gameState.matchStartTime) / 1000);
            duration = formatDuration(durationSeconds);
        }

        const matchData = {
            courtId: courtId,
            winnerName: winner,
            loserName: loser,
            gamesWon: `${winnerGames}-${loserGames}`,
            duration: duration
        };

        await api.saveMatchResult(matchData);
        console.log('Match result saved:', matchData);
    } catch (error) {
        console.error('Failed to save match result:', error);
        showMessage('Advarsel', 'Kampresultatet kunne ikke gemmes i databasen.');
    }
}

function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Periodic sync to detect admin resets and update player names
function startPeriodicSync() {
    setInterval(async () => {
        try {
            const loaded = await api.getGameState(courtId);

            // Check if court was reset from admin (matchStartTime is null and scores are 0)
            const wasReset = !loaded.matchStartTime &&
                           loaded.player1.score === 0 &&
                           loaded.player2.score === 0 &&
                           loaded.player1.games === 0 &&
                           loaded.player2.games === 0;

            if (wasReset && gameState.matchStartTime) {
                // Court was reset from admin while we had an active match
                console.log('Court was reset from admin, resetting local state');

                // Stop timer
                if (gameState.timerInterval) {
                    clearInterval(gameState.timerInterval);
                    gameState.timerInterval = null;
                }

                // Cancel any active rest break
                if (gameState.restBreakActive) {
                    gameState.restBreakCallback = null;
                    await endRestBreak();
                }

                // Reset to loaded state
                gameState.player1 = loaded.player1;
                gameState.player2 = loaded.player2;
                gameState.player1.score = 0;
                gameState.player2.score = 0;
                gameState.player1.games = 0;
                gameState.player2.games = 0;
                gameState.matchStartTime = null;
                gameState.matchEndTime = null;
                gameState.timerSeconds = 0;
                gameState.isActive = false;
                gameState.decidingGameSwitched = false;
                gameState.matchCompleted = false;
                gameState.restBreakTaken = false;

                // Ensure name2 exists
                if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
                if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';

                updateDisplay();
            } else {
                // Just sync player names (in case they were changed from another device)
                const namesChanged =
                    gameState.player1.name !== loaded.player1.name ||
                    gameState.player1.name2 !== loaded.player1.name2 ||
                    gameState.player2.name !== loaded.player2.name ||
                    gameState.player2.name2 !== loaded.player2.name2;

                if (namesChanged) {
                    gameState.player1.name = loaded.player1.name;
                    gameState.player1.name2 = loaded.player1.name2 || 'Makker 1';
                    gameState.player2.name = loaded.player2.name;
                    gameState.player2.name2 = loaded.player2.name2 || 'Makker 2';
                    gameState.isDoubles = loaded.isDoubles || false;
                    updateDisplay();
                }
            }
        } catch (error) {
            console.error('Failed to sync game state:', error);
        }
    }, 5000); // Check every 5 seconds
}

// Setup editable player name functionality
function setupEditablePlayerName(elementId, player, nameField) {
    const element = document.getElementById(elementId);

    element.addEventListener('click', function() {
        // Don't allow editing during active match or rest break
        if (gameState.restBreakActive) {
            return;
        }

        // Make element editable
        element.contentEditable = true;
        element.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(element);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    });

    element.addEventListener('blur', function() {
        finishEditingName(element, player, nameField);
    });

    element.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            element.blur(); // Trigger blur event to save
        } else if (e.key === 'Escape') {
            e.preventDefault();
            // Revert to original name
            updateDisplay();
            element.contentEditable = false;
        }
    });
}

function finishEditingName(element, player, nameField) {
    element.contentEditable = false;

    // Get new name and trim whitespace
    let newName = element.textContent.trim();

    // If empty, revert to default
    if (!newName) {
        if (player === 'player1' && nameField === 'name') {
            newName = 'Spiller 1';
        } else if (player === 'player1' && nameField === 'name2') {
            newName = 'Makker 1';
        } else if (player === 'player2' && nameField === 'name') {
            newName = 'Spiller 2';
        } else if (player === 'player2' && nameField === 'name2') {
            newName = 'Makker 2';
        }
    }

    // Update game state
    gameState[player][nameField] = newName;

    // Update display to ensure consistency
    updateDisplay();

    // Save to database
    saveGameState();

    console.log(`Updated ${player}.${nameField} to: ${newName}`);
}
