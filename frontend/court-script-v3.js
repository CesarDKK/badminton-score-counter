// Court V3 Script - New version of court page
const api = window.BadmintonAPI;

// PWA Install
let _pwaPrompt = null;

function _isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _pwaPrompt = e;
    const btn = document.getElementById('installAppBtn');
    if (btn && !_isStandalone()) btn.style.display = '';
});

window.addEventListener('appinstalled', () => {
    _pwaPrompt = null;
    const btn = document.getElementById('installAppBtn');
    if (btn) btn.style.display = 'none';
});

// Get court ID from URL
const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id') || urlParams.get('court')) || 1;

// Holdkamp state
let activeTeamMatch = null;
let assignedGameId = null;

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
    servingPlayer: null,  // 1 or 2, null if not yet selected (used for singles)
    initialServer: null,  // Track who served first for set resets
    servingTeam: null,  // 1 or 2, which team is serving (for doubles)
    servingPlayerOnTeam: null,  // 1 or 2, which player on the team (1=main player, 2=partner)

    // Track which player is in right court for each team (1=main, 2=partner)
    // This determines positions and who serves based on score
    team1RightCourt: 1,  // Player 1 main starts in right court
    team2RightCourt: 1,  // Player 2 main starts in right court

    // Track if we're between sets (allows position swapping in doubles)
    betweenSets: false,

    history: []
};

// Debouncing variables
let saveTimeout = null;
let isSaving = false;
let pendingSave = false;

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    // Set court name label
    const courtNameDisplay = document.getElementById('courtNameDisplay');
    if (courtNameDisplay) courtNameDisplay.textContent = 'Bane ' + courtId;

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

    // Load holdkamp panel
    await initHoldkampPanel();

    console.log('Court V3 initialized for court', courtId);

    // Register service worker for PWA support
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    // Install button — vises kun hvis browser tilbyder installation og appen ikke allerede er installeret
    const installBtn = document.getElementById('installAppBtn');
    if (installBtn) {
        if (_isStandalone()) installBtn.style.display = 'none';
        installBtn.addEventListener('click', async () => {
            if (!_pwaPrompt) return;
            _pwaPrompt.prompt();
            const { outcome } = await _pwaPrompt.userChoice;
            if (outcome === 'accepted') {
                _pwaPrompt = null;
                installBtn.style.display = 'none';
            }
            closeSettingsMenu();
        });
    }
});

function setupEventListeners() {
    // Point buttons
    document.getElementById('addPointPlayer1').addEventListener('click', () => addPoint(1));
    document.getElementById('addPointPlayer2').addEventListener('click', () => addPoint(2));

    // Serve selection buttons
    document.getElementById('startServPlayer1').addEventListener('click', () => selectServer(1));
    document.getElementById('startServPlayer2').addEventListener('click', () => selectServer(2));

    // Swap players buttons
    document.getElementById('swapPlayer1Btn').addEventListener('click', () => swapPlayers(1));
    document.getElementById('swapPlayer2Btn').addEventListener('click', () => swapPlayers(2));

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
    document.getElementById('switchSidesCourtBtn').addEventListener('click', () => {
        if (gameState.matchStartTime && !gameState.matchEndTime) return;
        switchSides();
    });
    document.getElementById('doublesToggle').addEventListener('click', () => {
        toggleDoubles();
        closeSettingsMenu();
    });

    document.getElementById('gameModeToggle').addEventListener('click', () => {
        toggleGameMode();
        closeSettingsMenu();
    });

    // Close settings menu when clicking outside
    document.getElementById('settingsMenu').addEventListener('click', (e) => {
        if (e.target.id === 'settingsMenu') {
            closeSettingsMenu();
        }
    });

    // Editable player names
    // Top fields edit main player names, bottom fields can edit partner names in doubles
    setupEditablePlayerName('player1Name1Display', 'player1', 'name', 'name2');
    setupEditablePlayerName('player1Name2Display', 'player1', 'name2', 'name');
    setupEditablePlayerName('player2Name1Display', 'player2', 'name', 'name2');
    setupEditablePlayerName('player2Name2Display', 'player2', 'name2', 'name');
}

function toggleDoubles() {
    if (gameState.matchStartTime && !gameState.matchEndTime) {
        return; // Cannot change during active match
    }
    const newMode = gameState.isDoubles ? 'single' : 'double';
    showMessage(
        'Skift Spil Tilstand',
        `Er du sikker på at du vil skifte til ${newMode} tilstand?`,
        [
            {
                text: 'Ja',
                callback: () => {
                    gameState.isDoubles = !gameState.isDoubles;
                    updateDisplay();
                    saveGameState();
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

function toggleGameMode() {
    if (gameState.matchStartTime && !gameState.matchEndTime) {
        showMessage('Ikke muligt', 'Kamptilstand kan ikke ændres mens en kamp er i gang.');
        return;
    }
    const newMode = gameState.gameMode === '21' ? '15' : '21';
    const label   = newMode === '21' ? '21/30 point' : '15/21 point';
    showMessage(
        'Skift Kamptilstand',
        `Skift til ${label} format?`,
        [
            {
                text: 'Ja',
                callback: () => {
                    gameState.gameMode = newMode;
                    updateGameModeButton();
                    saveGameState();
                },
                style: 'primary'
            },
            { text: 'Annuller', callback: () => {}, style: 'secondary' }
        ]
    );
}

function updateGameModeButton() {
    const btn = document.getElementById('gameModeToggle');
    if (btn) btn.textContent = gameState.gameMode === '21' ? 'Skift til 15/21' : 'Skift til 21/30';
}

function openSettingsMenu() {
    document.getElementById('settingsMenu').style.display = 'flex';
}

function closeSettingsMenu() {
    document.getElementById('settingsMenu').style.display = 'none';
}

function swapPlayers(team) {
    // Can only swap before match starts OR between sets (in doubles mode)
    if (!gameState.isDoubles || (gameState.matchStartTime && !gameState.betweenSets)) {
        return;
    }

    // Flip the right court position for the team
    if (team === 1) {
        gameState.team1RightCourt = gameState.team1RightCourt === 1 ? 2 : 1;
    } else {
        gameState.team2RightCourt = gameState.team2RightCourt === 1 ? 2 : 1;
    }

    // Update which player serves when the serving team's positions are swapped
    if (gameState.isDoubles && gameState.servingTeam) {
        const servingTeam = gameState.servingTeam;
        gameState.servingPlayerOnTeam = servingTeam === 1 ? gameState.team1RightCourt : gameState.team2RightCourt;
    }

    updateDisplay();
    saveGameState();
}

// Save current game state to history before making changes
function saveToHistory() {
    const snapshot = {
        player1: {
            score: gameState.player1.score,
            games: gameState.player1.games
        },
        player2: {
            score: gameState.player2.score,
            games: gameState.player2.games
        },
        servingPlayer: gameState.servingPlayer,
        servingTeam: gameState.servingTeam,
        servingPlayerOnTeam: gameState.servingPlayerOnTeam,
        team1RightCourt: gameState.team1RightCourt,
        team2RightCourt: gameState.team2RightCourt,
        betweenSets: gameState.betweenSets,
        decidingGameSwitched: gameState.decidingGameSwitched,
        timerSeconds: gameState.timerSeconds,
        isActive: gameState.isActive
    };

    gameState.history.push(snapshot);

    // Limit history to last 20 actions to prevent memory issues
    if (gameState.history.length > 20) {
        gameState.history.shift();
    }
}

function addPoint(player) {
    // Cannot add points if match hasn't selected server yet
    if (!gameState.servingPlayer) {
        return;
    }

    // Save state to history before adding point
    saveToHistory();

    // If we're between sets in doubles, lock in positions
    if (gameState.betweenSets && gameState.isDoubles) {
        gameState.betweenSets = false;

        // Only determine server based on court positions if not already set
        // (i.e., at the very start of the match)
        if (gameState.servingPlayerOnTeam === null) {
            // Score is 0 (even), so player in right court serves
            const servingTeam = gameState.servingTeam;
            if (servingTeam === 1) {
                gameState.servingPlayerOnTeam = gameState.team1RightCourt;
            } else {
                gameState.servingPlayerOnTeam = gameState.team2RightCourt;
            }
        }
        // Otherwise, keep the current server (same player continues from previous set)
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
        document.getElementById('holdkampPanel').style.display = 'none';
        startTimer();
    }

    // Check for rest break at 11 points
    checkRestBreak();

    // Check for side switch at mid-point in deciding game (when games are 1-1)
    // 21/30 format: 11 points · 15/21 format: 8 points
    const isDecidingGame = gameState.player1.games === 1 && gameState.player2.games === 1;
    const decidingMidPoint = gameState.gameMode === '21' ? 11 : 8;
    const scoredToMid = gameState.player1.score === decidingMidPoint || gameState.player2.score === decidingMidPoint;

    if (isDecidingGame && scoredToMid && !gameState.decidingGameSwitched) {
        gameState.decidingGameSwitched = true;
        switchSides();
        fixDoublesServePosition();
        showMessage('Skift Sider!', `Point har nået ${decidingMidPoint} i afgørende sæt. Spillere har skiftet side!`);
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
        // Save set scores to history BEFORE incrementing games or resetting scores
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player1Name2: gameState.player1.name2 || null,
            player2Name: gameState.player2.name,
            player2Name2: gameState.player2.name2 || null,
            score: `${p1Score}-${p2Score}`
        });

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

        // Set won but not match - start 2-minute rest break in background, show on Fortsæt
        const winnerNames = formatPlayerNames(gameState.player1.name, gameState.player1.name2);

        await startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
            resetScores();
            gameState.decidingGameSwitched = false;
            switchSides();
            fixDoublesStartPosition();
            showDoublesPositionMessage();
        }, false); // showOverlay = false, timer runs in background

        showMessage(
            'Sæt Vundet!',
            `${winnerNames} vinder dette sæt!`,
            [
                {
                    text: 'Fortsæt',
                    callback: () => showRestBreakOverlay(),
                    style: 'primary'
                }
            ]
        );
    } else if ((p2Score >= winScore && p2Score - p1Score >= 2) || p2Score === maxScore) {
        // Save set scores to history BEFORE incrementing games or resetting scores
        gameState.setScoresHistory.push({
            player1Name: gameState.player1.name,
            player1Name2: gameState.player1.name2 || null,
            player2Name: gameState.player2.name,
            player2Name2: gameState.player2.name2 || null,
            score: `${p1Score}-${p2Score}`
        });

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

        // Set won but not match - start 2-minute rest break in background, show on Fortsæt
        const winnerNames = formatPlayerNames(gameState.player2.name, gameState.player2.name2);

        await startRestBreak(120, 'Pause mellem Sæt - 2 Minutter', () => {
            resetScores();
            gameState.decidingGameSwitched = false;
            switchSides();
            fixDoublesStartPosition();
            showDoublesPositionMessage();
        }, false); // showOverlay = false, timer runs in background

        showMessage(
            'Sæt Vundet!',
            `${winnerNames} vinder dette sæt!`,
            [
                {
                    text: 'Fortsæt',
                    callback: () => showRestBreakOverlay(),
                    style: 'primary'
                }
            ]
        );
    }
}

function fixDoublesServePosition() {
    // Correct serving player's court position based on current score (even=right, odd=left)
    if (!gameState.isDoubles || !gameState.servingTeam || !gameState.servingPlayerOnTeam) return;
    const st = gameState.servingTeam;
    const score = st === 1 ? gameState.player1.score : gameState.player2.score;
    const serverInRightCourt = score % 2 === 0;
    const serverPlayer = gameState.servingPlayerOnTeam;
    const otherPlayer = serverPlayer === 1 ? 2 : 1;
    if (st === 1) {
        gameState.team1RightCourt = serverInRightCourt ? serverPlayer : otherPlayer;
    } else {
        gameState.team2RightCourt = serverInRightCourt ? serverPlayer : otherPlayer;
    }
    updateDisplay();
    saveGameState();
}

function fixDoublesStartPosition() {
    if (!gameState.isDoubles || !gameState.betweenSets || !gameState.servingTeam) return;
    if (!gameState.servingPlayerOnTeam) return;
    if (gameState.servingTeam === 1) {
        gameState.team1RightCourt = gameState.servingPlayerOnTeam;
    } else {
        gameState.team2RightCourt = gameState.servingPlayerOnTeam;
    }
    updateDisplay();
    saveGameState();
}

function showDoublesPositionMessage() {
    if (!gameState.isDoubles || !gameState.betweenSets) return;
    showMessage(
        'Tjek positioner',
        'Tjek at spillerne på skærmen står på de samme pladser som på den rigtige bane. Brug ⇅ til at justere hvis det ikke passer.',
        [{ text: 'OK', callback: null, style: 'primary' }]
    );
}

function resetScores() {
    gameState.player1.score = 0;
    gameState.player2.score = 0;
    gameState.restBreakTaken = false; // Reset for next set

    // In badminton, the winner of the previous game serves first in the next game
    // The same PLAYER who was serving at the end continues to serve
    // Determine who won the last game
    if (gameState.player1.games > gameState.player2.games) {
        gameState.servingPlayer = 1;
        if (gameState.isDoubles) {
            gameState.servingTeam = 1;
            // servingPlayerOnTeam preserved — same player who served at end of set continues
            gameState.betweenSets = true;
        }
    } else if (gameState.player2.games > gameState.player1.games) {
        gameState.servingPlayer = 2;
        if (gameState.isDoubles) {
            gameState.servingTeam = 2;
            // servingPlayerOnTeam preserved — same player who served at end of set continues
            gameState.betweenSets = true;
        }
    } else if (gameState.isDoubles) {
        // Tied (1-1) = deciding set — keep current server, but still flag betweenSets
        gameState.betweenSets = true;
    }

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

    // Swap serving state to follow the teams to their new positions
    if (gameState.servingPlayer === 1) {
        gameState.servingPlayer = 2;
    } else if (gameState.servingPlayer === 2) {
        gameState.servingPlayer = 1;
    }

    if (gameState.servingTeam === 1) {
        gameState.servingTeam = 2;
    } else if (gameState.servingTeam === 2) {
        gameState.servingTeam = 1;
    }

    // Swap and mirror court positions — Team A's data follows Team A to its new slot, mirrored
    if (gameState.isDoubles) {
        const temp = gameState.team1RightCourt;
        gameState.team1RightCourt = gameState.team2RightCourt === 1 ? 2 : 1;
        gameState.team2RightCourt = temp === 1 ? 2 : 1;
    }

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
                    gameState.servingTeam = null;  // Reset doubles serving state
                    gameState.servingPlayerOnTeam = null;
                    gameState.team1RightCourt = 1;  // Reset court positions
                    gameState.team2RightCourt = 1;
                    gameState.setScoresHistory = [];  // Clear set history so TV doesn't show old results
                    gameState.history = [];  // Clear undo history

                    // Update display
                    updateDisplay();

                    // Delete game state from database completely
                    try {
                        await api.resetGameState(courtId);
                        console.log('Court cleared successfully');
                        await refreshHoldkampPanel();
                    } catch (error) {
                        console.error('Failed to clear court:', error);
                        showMessage('Fejl', 'Kunne ikke rydde banen i databasen.');
                    }

                    closeSettingsMenu();

                    // QR-tæller mister adgangen når banen ryddes
                    if (isMatchSessionToken()) {
                        showQrSessionExpired();
                    }
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
        // Store default game mode for use when no game state exists yet
        gameState._defaultGameMode = settings.defaultGameMode || '21';

        if (courtId < 1 || courtId > courtCount) {
            alert(`Bane ${courtId} findes ikke. Omdirigerer til landingsside.`);
            window.location.href = 'landing.html';
        }

        // Show/hide elements based on tournament mode settings
        const isTournamentMode = settings.showResetButton === false;

        if (isTournamentMode) {
            // Hide "Ryd Banen" button in settings menu
            const clearBtn = document.getElementById('clearCourtBtn');
            if (clearBtn) {
                clearBtn.style.display = 'none';
            }

            // Hide "Skift til Double" button in settings menu
            const doublesToggle = document.getElementById('doublesToggle');
            if (doublesToggle) {
                doublesToggle.style.display = 'none';
            }

            // Hide "Tilbage" link in settings menu
            const backLink = document.querySelector('a[href="landing.html"]');
            if (backLink) {
                backLink.style.display = 'none';
            }

            // Hide "Admin" link in settings menu
            const adminLink = document.querySelector('a[href="admin.html"]');
            if (adminLink) {
                adminLink.style.display = 'none';
            }
        }

        console.log('Court V3 ready, tournament mode:', isTournamentMode);
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
        gameState.gameMode = loaded.gameMode || gameState._defaultGameMode || '21';
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

        // Load serving state
        gameState.servingPlayer = loaded.servingPlayer || null;
        gameState.initialServer = loaded.initialServer || null;
        gameState.servingTeam = loaded.servingTeam || null;
        gameState.servingPlayerOnTeam = loaded.servingPlayerOnTeam || null;
        gameState.team1RightCourt = loaded.team1RightCourt || 1;
        gameState.team2RightCourt = loaded.team2RightCourt || 1;
        gameState.betweenSets = loaded.betweenSets || false;

        // Ensure name2 exists for backwards compatibility
        if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
        if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';

        // Clear history when loading from database (can't undo server-side state)
        gameState.history = [];
    } catch (error) {
        console.error('Failed to load game state:', error);
        // Continue with default state
    }
}

// Returns true if any player name differs from the default placeholder names
function hasCustomPlayerNames() {
    return gameState.player1.name !== 'Spiller 1' ||
           gameState.player1.name2 !== 'Makker 1' ||
           gameState.player2.name !== 'Spiller 2' ||
           gameState.player2.name2 !== 'Makker 2';
}

// Update display with current game state
function updateDisplay() {
    updateGameModeButton();
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

    const serverSelected = gameState.isDoubles ? gameState.servingTeam : gameState.servingPlayer;

    if (!serverSelected && !gameState.matchStartTime) {
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

    // Show/hide swap players buttons (in doubles: before match starts OR between sets)
    const swapBtn1 = document.getElementById('swapPlayer1Btn');
    const swapBtn2 = document.getElementById('swapPlayer2Btn');
    if (gameState.isDoubles && (!gameState.matchStartTime || gameState.betweenSets)) {
        swapBtn1.style.display = 'flex';
        swapBtn2.style.display = 'flex';
    } else {
        swapBtn1.style.display = 'none';
        swapBtn2.style.display = 'none';
    }

    // Hide switch-sides and doubles toggle during active match
    const matchActive = gameState.matchStartTime && !gameState.matchEndTime;
    const switchSidesCourtBtn = document.getElementById('switchSidesCourtBtn');
    if (switchSidesCourtBtn) {
        switchSidesCourtBtn.style.display = matchActive ? 'none' : 'flex';
    }
    if (doublesBtn) {
        doublesBtn.style.display = matchActive ? 'none' : 'block';
    }

    // Show/hide start button and timer
    const startBtn = document.getElementById('startMatchBtn');
    const timerDisplay = document.getElementById('timerDisplay');

    // Disable start button if no server selected
    startBtn.disabled = !gameState.servingPlayer;

    const courtNameEl = document.getElementById('courtNameDisplay');

    if (gameState.matchStartTime && !gameState.matchEndTime) {
        startBtn.style.display = 'none';
        timerDisplay.style.display = 'block';
        if (courtNameEl) courtNameEl.style.display = 'none';
        updateTimer();
    } else if (!gameState.matchStartTime) {
        startBtn.style.display = 'block';
        timerDisplay.style.display = 'none';
        if (courtNameEl) courtNameEl.style.display = 'block';
    } else {
        startBtn.style.display = 'none';
        timerDisplay.style.display = 'block';
        if (courtNameEl) courtNameEl.style.display = 'none';
    }
}

// Select which team serves first
async function selectServer(team) {
    if (gameState.matchStartTime) {
        return; // Cannot change server after match started
    }

    gameState.servingTeam = team;
    gameState.servingPlayer = team; // For compatibility
    gameState.initialServer = team;

    if (gameState.isDoubles) {
        // Doubles mode: Determine who serves based on current court positions
        // Score is 0 (even), so player in right court serves
        const rightCourtPlayer = team === 1 ? gameState.team1RightCourt : gameState.team2RightCourt;
        gameState.servingPlayerOnTeam = rightCourtPlayer;

        const playerName = team === 1
            ? (rightCourtPlayer === 1 ? gameState.player1.name : gameState.player1.name2)
            : (rightCourtPlayer === 1 ? gameState.player2.name : gameState.player2.name2);

        console.log(`Team ${team} will serve first (${playerName} from right court)`);
    } else {
        // Singles mode
        console.log(`Player ${team} will serve first`);
    }

    // Set match as active so TV displays will show it immediately
    gameState.isActive = true;

    // Enable +1 buttons and Start Kamp button
    updateDisplay();

    // Save immediately without debounce so TV sees the change right away
    await performSave();
}

// Get serving side based on server's score
function getServingSide() {
    if (gameState.isDoubles) {
        // In doubles: based on serving TEAM's score
        if (!gameState.servingTeam) return null;
        const teamScore = gameState.servingTeam === 1 ? gameState.player1.score : gameState.player2.score;
        return teamScore % 2 === 0 ? 'right' : 'left';
    } else {
        // In singles: based on serving player's score
        if (!gameState.servingPlayer) return null;
        const serverScore = gameState.servingPlayer === 1 ? gameState.player1.score : gameState.player2.score;
        return serverScore % 2 === 0 ? 'right' : 'left';
    }
}

// Update serving player after a point
function updateServingPlayer(pointWinner) {
    if (gameState.isDoubles) {
        // Doubles logic based on official badminton rules
        const winningTeam = pointWinner; // Team 1 or 2

        if (winningTeam === gameState.servingTeam) {
            // Serving team won - they scored a point
            // Rule: Same player continues serving, but they switch sides
            // This means we flip who is in right court vs left court
            if (gameState.servingTeam === 1) {
                // Team 1 scored - flip their court positions
                gameState.team1RightCourt = gameState.team1RightCourt === 1 ? 2 : 1;
            } else {
                // Team 2 scored - flip their court positions
                gameState.team2RightCourt = gameState.team2RightCourt === 1 ? 2 : 1;
            }

            // Update servingPlayerOnTeam based on new positions
            const newTeamScore = winningTeam === 1 ? gameState.player1.score : gameState.player2.score;
            const rightCourtPlayer = winningTeam === 1 ? gameState.team1RightCourt : gameState.team2RightCourt;

            // Who serves? Player in right court if score is even, player in left court if odd
            if (newTeamScore % 2 === 0) {
                gameState.servingPlayerOnTeam = rightCourtPlayer;
            } else {
                gameState.servingPlayerOnTeam = rightCourtPlayer === 1 ? 2 : 1;
            }
        } else {
            // Receiving team won - serve changes
            // Rule: Serve goes to the other team, they serve from the court matching their score
            // Their positions don't change
            gameState.servingTeam = winningTeam;

            // Determine who serves based on their score and court positions
            const newTeamScore = winningTeam === 1 ? gameState.player1.score : gameState.player2.score;
            const rightCourtPlayer = winningTeam === 1 ? gameState.team1RightCourt : gameState.team2RightCourt;

            // Who serves? Player in right court if score is even, player in left court if odd
            if (newTeamScore % 2 === 0) {
                gameState.servingPlayerOnTeam = rightCourtPlayer;
            } else {
                gameState.servingPlayerOnTeam = rightCourtPlayer === 1 ? 2 : 1;
            }
        }

        gameState.servingPlayer = gameState.servingTeam; // For compatibility
    } else {
        // Singles logic: server only changes when server loses the rally
        if (pointWinner !== gameState.servingPlayer) {
            gameState.servingPlayer = pointWinner;
        }
    }
}

// Update serve indicator visual on court
function updateServeIndicator() {
    // Remove any existing serve indicator
    const existingIndicator = document.querySelector('.serve-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Check if server is selected
    const serverSelected = gameState.isDoubles ? gameState.servingTeam : gameState.servingPlayer;
    if (!serverSelected) return;

    const servingSide = getServingSide();
    if (!servingSide) return;

    // Create serve indicator element
    const indicator = document.createElement('div');
    indicator.className = 'serve-indicator';

    // Determine which side of court is serving
    const servingTeamSide = gameState.isDoubles ? gameState.servingTeam : gameState.servingPlayer;

    // Position based on serving team/player and serving side
    if (servingTeamSide === 1) {
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

    if (gameState.isDoubles) {
        // === DOUBLES MODE ===
        // Position players based on who is in right court for each team
        // Team 1 (left side of court)
        if (gameState.team1RightCourt === 1) {
            // Main player in right court = bottom position (because right court is bottom for left side)
            safeSetText(leftTop, gameState.player1.name2);      // Partner in left court (top)
            safeSetText(leftBottom, gameState.player1.name);    // Main in right court (bottom)
        } else {
            // Partner in right court = bottom position
            safeSetText(leftTop, gameState.player1.name);       // Main in left court (top)
            safeSetText(leftBottom, gameState.player1.name2);   // Partner in right court (bottom)
        }

        // Team 2 (right side of court)
        if (gameState.team2RightCourt === 1) {
            // Main player in right court = top position (because right court is top for right side)
            safeSetText(rightTop, gameState.player2.name);      // Main in right court (top)
            safeSetText(rightBottom, gameState.player2.name2);  // Partner in left court (bottom)
        } else {
            // Partner in right court = top position
            safeSetText(rightTop, gameState.player2.name2);     // Partner in right court (top)
            safeSetText(rightBottom, gameState.player2.name);   // Main in left court (bottom)
        }
    } else {
        // === SINGLES MODE ===
        if (!gameState.servingPlayer) {
            // Before server selected
            safeSetText(leftTop, '');
            safeSetText(leftBottom, gameState.player1.name);
            safeSetText(rightTop, gameState.player2.name);
            safeSetText(rightBottom, '');
            return;
        }

        const servingSide = getServingSide();
        if (!servingSide) return;

        if (gameState.servingPlayer === 1) {
            // Player 1 (left) is serving
            if (servingSide === 'right') {
                // Player 1 bottom-left, Player 2 top-right (diagonal)
                safeSetText(leftTop, '');
                safeSetText(leftBottom, gameState.player1.name);
                safeSetText(rightTop, gameState.player2.name);
                safeSetText(rightBottom, '');
            } else {
                // Player 1 top-left, Player 2 bottom-right (diagonal)
                safeSetText(leftTop, gameState.player1.name);
                safeSetText(leftBottom, '');
                safeSetText(rightTop, '');
                safeSetText(rightBottom, gameState.player2.name);
            }
        } else {
            // Player 2 (right) is serving
            if (servingSide === 'right') {
                // Player 2 top-right, Player 1 bottom-left (diagonal)
                safeSetText(leftTop, '');
                safeSetText(leftBottom, gameState.player1.name);
                safeSetText(rightTop, gameState.player2.name);
                safeSetText(rightBottom, '');
            } else {
                // Player 2 bottom-right, Player 1 top-left (diagonal)
                safeSetText(leftTop, gameState.player1.name);
                safeSetText(leftBottom, '');
                safeSetText(rightTop, '');
                safeSetText(rightBottom, gameState.player2.name);
            }
        }
    }
}

// Undo last action
async function undoLastAction() {
    // If server selected but no points scored yet, allow resetting server selection
    const serverSelected = gameState.isDoubles ? gameState.servingTeam : gameState.servingPlayer;
    const noPointsScored = gameState.player1.score === 0 &&
                          gameState.player2.score === 0 &&
                          gameState.player1.games === 0 &&
                          gameState.player2.games === 0;

    if (serverSelected && noPointsScored) {
        // Reset server selection and deactivate match
        gameState.servingPlayer = null;
        gameState.initialServer = null;
        gameState.servingTeam = null;
        gameState.servingPlayerOnTeam = null;
        gameState.isActive = false;
        gameState.matchStartTime = null;
        gameState.timerSeconds = 0;
        if (gameState.timerInterval) {
            clearInterval(gameState.timerInterval);
            gameState.timerInterval = null;
        }
        updateDisplay();
        await performSave();  // Save immediately so TV sees the change
        console.log('Server selection reset');
        return;
    }

    // Check if there's history to undo
    if (gameState.history.length === 0) {
        showMessage('Fortryd', 'Der er ingen handlinger at fortryde.');
        return;
    }

    // Pop last state from history
    const previousState = gameState.history.pop();

    // Restore all game state from snapshot
    gameState.player1.score = previousState.player1.score;
    gameState.player1.games = previousState.player1.games;
    gameState.player2.score = previousState.player2.score;
    gameState.player2.games = previousState.player2.games;

    gameState.servingPlayer = previousState.servingPlayer;
    gameState.servingTeam = previousState.servingTeam;
    gameState.servingPlayerOnTeam = previousState.servingPlayerOnTeam;

    // Restore player positions (important for doubles)
    gameState.team1RightCourt = previousState.team1RightCourt;
    gameState.team2RightCourt = previousState.team2RightCourt;

    gameState.betweenSets = previousState.betweenSets;
    gameState.decidingGameSwitched = previousState.decidingGameSwitched;
    gameState.timerSeconds = previousState.timerSeconds;
    gameState.isActive = previousState.isActive;

    // Update display and save restored state
    updateDisplay();
    saveGameState();

    console.log('Undid last action, history size:', gameState.history.length);
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
    document.getElementById('holdkampPanel').style.display = 'none';
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
            restBreakTaken: gameState.restBreakTaken,
            servingPlayer: gameState.servingPlayer,
            initialServer: gameState.initialServer,
            servingTeam: gameState.servingTeam,
            servingPlayerOnTeam: gameState.servingPlayerOnTeam,
            team1RightCourt: gameState.team1RightCourt,
            team2RightCourt: gameState.team2RightCourt,
            betweenSets: gameState.betweenSets
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
    if (gameState.restBreakTaken || gameState.restBreakActive) return;
    const breakPoint = gameState.gameMode === '21' ? 11 : 8;
    if (gameState.player1.score === breakPoint || gameState.player2.score === breakPoint) {
        startRestBreak();
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

        const setScoresText = gameState.setScoresHistory.map(set => {
            if (typeof set === 'string') {
                return set;
            } else {
                const p1 = formatPlayerNames(set.player1Name, set.player1Name2);
                const p2 = formatPlayerNames(set.player2Name, set.player2Name2);
                return `${p1} ${set.score} ${p2}`;
            }
        }).join(', ');

        const matchData = {
            courtId: courtId,
            winnerName: winner,
            loserName: loser,
            gamesWon: `${winnerGames}-${loserGames}`,
            duration: duration,
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

                // Match-session tokens (QR-kode tæller) låses når banen nulstilles
                // — brugeren skal scanne QR-koden igen for at tælle næste kamp.
                if (isMatchSessionToken()) {
                    showQrSessionExpired();
                    return;
                }

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

        // Holdkamp sync: detect new holdkamp OR sync names from holdkamp to court
        try {
            const tm = await api.getActiveTeamMatch();
            if (tm) {
                if (!activeTeamMatch && !assignedGameId) {
                    // Holdkamp just started — initialize panel
                    activeTeamMatch = tm;
                    await initHoldkampPanel();
                } else if (activeTeamMatch && !assignedGameId) {
                    // Panel open but no game assigned yet — refresh dropdown to remove taken games
                    // Skip if user has already selected a game to avoid resetting their selection
                    const panel = document.getElementById('holdkampPanel');
                    const select = document.getElementById('holdkampGameSelect');
                    const userIsSelecting = select && select.value;
                    if (panel && panel.style.display !== 'none' && !userIsSelecting) {
                        await refreshHoldkampPanel();
                    }
                } else if (assignedGameId) {
                    // Already assigned — sync player names from holdkamp game to court,
                    // BUT only before any set has been decided. After the first set,
                    // switchSides() has swapped the player slots; re-applying original
                    // names from the holdkamp game would undo that swap and leave names
                    // and scores in inconsistent positions.
                    activeTeamMatch = tm;
                    const myGame = tm.games.find(g => g.id === assignedGameId);
                    const sidesHaveBeenSwitched = gameState.player1.games > 0 || gameState.player2.games > 0;
                    if (myGame && !sidesHaveBeenSwitched) {
                        const namesChanged =
                            (myGame.team1_player1 && gameState.player1.name !== myGame.team1_player1) ||
                            (myGame.team1_player2 && gameState.player1.name2 !== myGame.team1_player2) ||
                            (myGame.team2_player1 && gameState.player2.name !== myGame.team2_player1) ||
                            (myGame.team2_player2 && gameState.player2.name2 !== myGame.team2_player2);
                        if (namesChanged) {
                            if (myGame.team1_player1) gameState.player1.name = myGame.team1_player1;
                            if (myGame.team1_player2) gameState.player1.name2 = myGame.team1_player2;
                            if (myGame.team2_player1) gameState.player2.name = myGame.team2_player1;
                            if (myGame.team2_player2) gameState.player2.name2 = myGame.team2_player2;
                            updateDisplay();
                            saveGameState();
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to sync holdkamp:', error);
        }
    }, 5000); // Check every 5 seconds
}

// Setup editable player name functionality
// primaryField is the main field to edit, fallbackField is used if primary is not displayed
function setupEditablePlayerName(elementId, player, primaryField, fallbackField = null) {
    const element = document.getElementById(elementId);

    element.addEventListener('click', function() {
        // Don't allow editing during active match or rest break
        if (gameState.restBreakActive) {
            return;
        }

        // Skip if element is empty
        if (!element.textContent.trim()) {
            return;
        }

        // Determine which field to edit based on current displayed text
        let fieldToEdit = primaryField;
        const currentText = element.textContent.trim();

        // Check if current text matches the fallback field (for dynamic positioning)
        if (fallbackField && gameState[player][fallbackField] === currentText && gameState[player][primaryField] !== currentText) {
            fieldToEdit = fallbackField;
        }

        // Store which field we're editing
        element.dataset.editingField = fieldToEdit;

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
        const fieldToEdit = element.dataset.editingField || primaryField;
        finishEditingName(element, player, fieldToEdit);
        delete element.dataset.editingField;
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
            delete element.dataset.editingField;
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

    // Sync name change back to holdkamp game if one is assigned
    if (assignedGameId && activeTeamMatch) {
        api.updateTeamMatchGame(activeTeamMatch.id, assignedGameId, {
            team1Player1: gameState.player1.name,
            team1Player2: gameState.player1.name2 || null,
            team2Player1: gameState.player2.name,
            team2Player2: gameState.player2.name2 || null,
        }).catch(e => console.error('Failed to sync name to holdkamp:', e));
    }

    console.log(`Updated ${player}.${nameField} to: ${newName}`);
}

// ==================== HOLDKAMP ====================

async function initHoldkampPanel() {
    try {
        activeTeamMatch = await api.getActiveTeamMatch();
        if (!activeTeamMatch) return;

        const panel = document.getElementById('holdkampPanel');

        // Register all button listeners once upfront, regardless of code path
        document.getElementById('showHoldkampPanelBtn').style.display = 'block';
        document.getElementById('showHoldkampPanelBtn').addEventListener('click', async () => {
            document.getElementById('settingsMenu').style.display = 'none';
            await refreshHoldkampPanel();
        });
        document.getElementById('closeHoldkampPanelBtn').addEventListener('click', () => {
            panel.style.display = 'none';
        });
        document.getElementById('assignHoldkampBtn').addEventListener('click', assignHoldkampGame);

        // Check if this court is already assigned to a game
        const myGame = activeTeamMatch.games.find(g => g.court_number === courtId && g.status === 'active');
        if (myGame) {
            assignedGameId = myGame.id;
            applyHoldkampGameToState(myGame);
            showHoldkampAssigned(myGame);
            return;
        }

        // Show panel with pending games
        const select = document.getElementById('holdkampGameSelect');
        const pendingGames = activeTeamMatch.games.filter(g => g.status === 'pending');
        if (pendingGames.length === 0) return;

        select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
        pendingGames.forEach(g => {
            const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
            const t1 = isDoubles
                ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
                : (g.team1_player1 || '?');
            const t2 = isDoubles
                ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
                : (g.team2_player1 || '?');
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.category} ${g.game_number}: ${t1} vs ${t2}`;
            select.appendChild(opt);
        });

        panel.style.display = 'block';
    } catch (error) {
        console.error('Failed to init holdkamp panel:', error);
    }
}

function applyHoldkampGameToState(game) {
    const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(game.category);
    const team1 = activeTeamMatch?.team1_name || 'Hold 1';
    const team2 = activeTeamMatch?.team2_name || 'Hold 2';

    gameState.player1.name = game.team1_player1 || `${team1} spiller`;
    gameState.player2.name = game.team2_player1 || `${team2} spiller`;
    if (isDoubles) {
        gameState.player1.name2 = game.team1_player2 || `${team1} makker`;
        gameState.player2.name2 = game.team2_player2 || `${team2} makker`;
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
    const select = document.getElementById('holdkampGameSelect');
    const assignBtn = document.getElementById('assignHoldkampBtn');
    const assignedDiv = document.getElementById('holdkampAssigned');

    select.style.display = 'none';
    assignBtn.style.display = 'none';

    const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(game.category);
    const t1 = isDoubles
        ? `${game.team1_player1 || '?'}${game.team1_player2 ? ' & ' + game.team1_player2 : ''}`
        : (game.team1_player1 || '?');
    const t2 = isDoubles
        ? `${game.team2_player1 || '?'}${game.team2_player2 ? ' & ' + game.team2_player2 : ''}`
        : (game.team2_player1 || '?');

    assignedDiv.style.display = 'block';
    assignedDiv.textContent = `✓ Tilknyttet: ${game.category} – ${t1} vs ${t2} (${activeTeamMatch.team1_name} vs ${activeTeamMatch.team2_name})`;
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

        // Reset panel to selection state
        assignedDiv.style.display = 'none';
        select.style.display = '';
        assignBtn.style.display = '';

        select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
        pendingGames.forEach(g => {
            const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
            const t1 = isDoubles
                ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
                : (g.team1_player1 || '?');
            const t2 = isDoubles
                ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
                : (g.team2_player1 || '?');
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = `${g.category} ${g.game_number}: ${t1} vs ${t2}`;
            select.appendChild(opt);
        });

        panel.style.display = 'block';
    } catch (error) {
        console.error('Failed to refresh holdkamp panel:', error);
    }
}

// ── QR match-session lock ────────────────────────────────────────────────────

function getDeviceTokenPayload() {
    const dt = sessionStorage.getItem('deviceToken');
    if (!dt) return null;
    try { return JSON.parse(atob(dt.split('.')[1])); } catch { return null; }
}

function isMatchSessionToken() {
    const p = getDeviceTokenPayload();
    return p && p.tokenType === 'match_session';
}

function showQrSessionExpired() {
    // Fjern eksisterende overlay hvis det allerede vises
    const existing = document.getElementById('qrSessionExpiredOverlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.id = 'qrSessionExpiredOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 9999;
        background: rgba(0,0,0,0.92);
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        text-align: center; padding: 32px;
        font-family: inherit; color: #fff;
    `;
    overlay.innerHTML = `
        <div style="font-size: clamp(3em,10vw,6em); margin-bottom: 24px;">🏸</div>
        <h1 style="font-size: clamp(1.4em,5vw,2.4em); margin-bottom: 16px; color: #4CAF50;">Kamp Afsluttet</h1>
        <p style="font-size: clamp(1em,3vw,1.4em); color: rgba(255,255,255,0.65); max-width: 400px; line-height: 1.6;">
            Banen er blevet nulstillet.<br>
            Scan QR-koden igen for at tælle næste kamp.
        </p>
    `;
    document.body.appendChild(overlay);

    // Deaktiver alle knapinteraktioner
    document.querySelectorAll('button').forEach(b => b.disabled = true);
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
