// Court V3 Script - New version of court page
const api = window.BadmintonAPI;

// ── Screen Wake Lock ──
// Holder tablettens skærm tændt under en kamp, så den ikke går i dvale mellem
// point. Frigives ved kampslut/rydning. Genanskaffes på visibilitychange, fordi
// systemet automatisk slipper wake lock'en når fanen skjules/skærmen låses.
let _wakeLock = null;
async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) return; // ikke understøttet (fx iOS < 16.4)
    try {
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    } catch (e) {
        // Afvises fx hvis fanen ikke er synlig — prøves igen ved visibilitychange
        console.warn('Wake Lock kunne ikke aktiveres:', e && e.message);
    }
}
async function releaseWakeLock() {
    if (_wakeLock) {
        try { await _wakeLock.release(); } catch {}
        _wakeLock = null;
    }
}
// Er kampen i gang (skærmen bør holdes vågen)?
function matchIsLive() {
    return gameState && gameState.isActive && !gameState.matchEndTime;
}

// ── Sync-status (offline-indikator) ──
// Vises kun efter gentagne fejlede gemninger, så et enkelt blip ikke blinker.
let _saveFailCount = 0;
function setSyncStatus(ok) {
    const badge = document.getElementById('syncStatusBadge');
    if (!badge) return;
    if (ok) {
        _saveFailCount = 0;
        badge.style.display = 'none';
    } else {
        _saveFailCount++;
        // Vis først efter 2 fejl i træk (ét kortvarigt blip skjules)
        if (_saveFailCount >= 2) badge.style.display = 'flex';
    }
}

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

let isTournamentMode = false;

// Holdkamp state
let activeTeamMatch = null;
let assignedHoldkampGameId = null;
let holdkampSelectFocused = false; // true mens delkamp-dropdownen er i fokus/aaben
let holdkampMatches = []; // alle aktive holdkampe (cache til de to dropdowns)

// Tournament (planlagte kampe) state
let activeTournament = null;
let assignedTournamentMatchId = null;

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
    // True når brugeren manuelt har trykket "Skift side" og swappet player1/player2.
    // Beskytter swap'et mod at blive overskrevet af sync-loopet mens en holdkamp/
    // turneringskamp er tildelt. Ephemeral — nulstilles ved ny tildeling/clearCourt/reset.
    sidesManuallySwitched: false,
    setScoresHistory: [],
    restBreakTaken: false,
    restBreakActive: false,
    restBreakInterval: null,
    restBreakCallback: null,
    restBreakSecondsLeft: 0,
    restBreakTitle: '',
    restBreakStartedAt: null,
    restBreakDuration: 60,
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

    // Optimistic concurrency — serverens version fra seneste GET/PUT
    version: 0,

    history: []
};

// Debouncing variables
let saveTimeout = null;
let isSaving = false;
let pendingSave = false;
// Tidspunkt for seneste egen gemning — bruges til at ignorere SSE-events
// udløst af vores egne skrivninger (se handleCourtEvent)
let lastOwnSaveAt = 0;

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    // Set court name label
    const courtNameDisplay = document.getElementById('courtNameDisplay');
    if (courtNameDisplay) courtNameDisplay.textContent = 'Bane ' + courtId;

    await initializeApp();
    await loadGameState();
    updateDisplay();
    setupEventListeners();

    // QR-gæst der scanner ind i en allerede afsluttet kamp (banen er endnu ikke
    // ryddet): tilbyd at starte en frisk kamp i samme session — så man ikke skal
    // vente på "Ryd bane" eller admin for at komme i gang.
    promptStartFreshIfCompleted();

    // Start timer if match is already in progress
    if (gameState.matchStartTime && !gameState.matchEndTime) {
        startTimer();
    }

    // Genindlæst midt i en aktiv kamp — hold skærmen vågen med det samme
    if (matchIsLive()) acquireWakeLock();

    // Start periodic sync to detect admin resets
    startPeriodicSync();

    // Load holdkamp panel
    await initHoldkampPanel();

    // Tournament-tildelinger sker udelukkende fra admin baneoversigt —
    // sync-loopet detekterer når en kamp er sat på denne bane.

    console.log('Court V3 initialized for court', courtId);

    // Service worker registreres nu centralt i js/theme-loader.js (alle sider).

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

    // Holdkamp-panel listeners (registreres én gang — init kaldes flere gange)
    document.getElementById('closeHoldkampPanelBtn').addEventListener('click', () => {
        document.getElementById('holdkampPanel').style.display = 'none';
    });
    document.getElementById('assignHoldkampBtn').addEventListener('click', assignHoldkampGame);
    document.getElementById('showHoldkampPanelBtn').addEventListener('click', async () => {
        document.getElementById('settingsMenu').style.display = 'none';
        await refreshHoldkampPanel();
    });
    document.getElementById('holdkampMatchSelect').addEventListener('change', onHoldkampMatchChange);

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
        // Navne skal med i snapshottet: switchSides() (efter sætafslutning) bytter
        // player1/player2-navnene, så uden dem gendanner Fortryd scoren til den
        // gamle orientering mens navnene forbliver byttede — point på forkert side.
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
        sidesManuallySwitched: gameState.sidesManuallySwitched,
        restBreakTaken: gameState.restBreakTaken,
        servingPlayer: gameState.servingPlayer,
        servingTeam: gameState.servingTeam,
        servingPlayerOnTeam: gameState.servingPlayerOnTeam,
        team1RightCourt: gameState.team1RightCourt,
        team2RightCourt: gameState.team2RightCourt,
        betweenSets: gameState.betweenSets,
        decidingGameSwitched: gameState.decidingGameSwitched,
        timerSeconds: gameState.timerSeconds,
        isActive: gameState.isActive,
        // Så "Fortryd" kan genåbne en netop afsluttet kamp: gem også afslutnings-
        // og sæthistorik-tilstanden fra FØR dette point (kopi, ikke reference).
        matchCompleted: gameState.matchCompleted,
        matchEndTime: gameState.matchEndTime,
        setScoresHistory: gameState.setScoresHistory.map(s => (s && typeof s === 'object' ? { ...s } : s))
    };

    gameState.history.push(snapshot);

    // Limit history to last 20 actions to prevent memory issues
    if (gameState.history.length > 20) {
        gameState.history.shift();
    }
}

function addPoint(player) {
    // Kampen er afgjort (2 sæt vundet): lås tælling, så man ikke kan spille
    // videre til et 4. sæt hvis man annullerer "Ryd bane"-prompten. Brug "Fortryd"
    // hvis point-vindet var en fejl, eller "Ryd bane" for at afslutte.
    if (gameState.matchCompleted) {
        return;
    }

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
        gameState._sendStartNow = true; // serveren stempler starttiden med sit eget ur
        anchorTimer(0);
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
    flashPointFeedback(player);
    saveGameState();
}

// Visuel + haptisk feedback når et point gives (punkt 2).
// player1 = venstre side, player2 = højre side (se switchSides, der bytter selve data'en).
function flashPointFeedback(player) {
    // Haptisk feedback på touch-enheder (tablet/telefon). Ignoreres lydløst på desktop.
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(35); } catch (e) {}
    }

    // Respektér brugere der har slået bevægelse fra
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    // Puls på score-tallet for den side der scorede
    const scoreEl = document.getElementById(player === 1 ? 'player1PointScore' : 'player2PointScore');
    if (scoreEl) {
        scoreEl.classList.remove('score-pulse');
        void scoreEl.offsetWidth; // tving reflow så animationen kan starte forfra ved hurtige tap
        scoreEl.classList.add('score-pulse');
    }

    // Kort lysglimt på den scorende banehalvdel
    const surface = document.querySelector('.court-surface');
    if (surface) {
        const flash = document.createElement('div');
        flash.className = 'court-half-flash ' + (player === 1 ? 'flash-left' : 'flash-right');
        surface.appendChild(flash);
        setTimeout(() => { flash.remove(); }, 500);
    }
}

// Boldpoint-status (punkt 3): returnerer 'match' | 'set' | null for hver spiller.
// En spiller er til boldpoint hvis ét point mere opfylder vinderbetingelsen
// (jf. checkGameWin). Er det deres 2. sæt (games === 1) er det matchbold, ellers sætbold.
function getBoldpointState() {
    const none = { player1: null, player2: null };

    // Kun relevant under en aktiv duel — ikke før server er valgt, mellem sæt eller når kampen er slut
    const serverSelected = gameState.isDoubles ? gameState.servingTeam : gameState.servingPlayer;
    if (!serverSelected || !gameState.matchStartTime || gameState.matchEndTime ||
        gameState.matchCompleted || gameState.betweenSets) {
        return none;
    }

    const winScore = gameState.gameMode === '21' ? 21 : 15;
    const maxScore = gameState.gameMode === '21' ? 30 : 21;

    const evaluate = (p, o) => {
        const next = p.score + 1;
        const wins = (next >= winScore && next - o.score >= 2) || next === maxScore;
        if (!wins) return null;
        return p.games === 1 ? 'match' : 'set';
    };

    return {
        player1: evaluate(gameState.player1, gameState.player2),
        player2: evaluate(gameState.player2, gameState.player1)
    };
}

// Opdater score-fremhævning + label ud fra boldpoint-status
function updateBoldpointIndicator() {
    const state = getBoldpointState();
    const sides = [
        { key: 'player1', scoreId: 'player1PointScore', labelId: 'player1Boldpoint' },
        { key: 'player2', scoreId: 'player2PointScore', labelId: 'player2Boldpoint' }
    ];

    sides.forEach(({ key, scoreId, labelId }) => {
        const scoreEl = document.getElementById(scoreId);
        const labelEl = document.getElementById(labelId);
        const status = state[key];

        if (scoreEl) {
            scoreEl.classList.toggle('is-setpoint', status === 'set');
            scoreEl.classList.toggle('is-matchpoint', status === 'match');
        }
        if (labelEl) {
            if (status === 'match') {
                labelEl.innerHTML = '<span class="boldpoint-pill boldpoint-match">Matchbold</span>';
            } else if (status === 'set') {
                labelEl.innerHTML = '<span class="boldpoint-pill boldpoint-set">Sætbold</span>';
            } else {
                labelEl.innerHTML = '';
            }
        }
    });
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
            // Fang FOR saveMatchResult, fordi den synkront nuller de globale assigned-vars.
            const isReportedMatch = !!(assignedHoldkampGameId || assignedTournamentMatchId);

            // Gem øjeblikkeligt (afbryd debounced timer) så oversigt ser matchCompleted=true
            // inden brugeren evt. klikker "Ny Kamp" og nulstiller tilstanden.
            if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
            performSave();

            // Save match result to database
            saveMatchResult(winnerNames, loserNames, gameState.player1.games, gameState.player2.games);

            showMatchWonMessage(winnerNames, gameState.player1.games, gameState.player2.games, isReportedMatch);
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
            const isReportedMatch = !!(assignedHoldkampGameId || assignedTournamentMatchId);

            if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
            performSave();

            // Save match result to database
            saveMatchResult(winnerNames, loserNames, gameState.player2.games, gameState.player1.games);

            showMatchWonMessage(winnerNames, gameState.player2.games, gameState.player1.games, isReportedMatch);
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

    // Marker swap'et så sync-loopet ikke ruller det tilbage på næste tick
    gameState.sidesManuallySwitched = true;

    updateDisplay();
    // Øjeblikkelig save (ingen debounce) — ellers kan sync-loopet ramme det 500ms-vindue
    // hvor serveren stadig har de gamle navne og overskrive det netop gennemførte swap
    performSave();
}

// Selve nulstillingen — kaldes baade fra "Er du sikker"-prompten i clearCourt()
// og fra den 3-sekunders hold-knap der vises efter holdkamp/turneringskamp.
async function performClearCourtNow() {
    releaseWakeLock(); // banen ryddes — ingen aktiv kamp at holde skærmen vågen for
    // Release holdkamp game back to pending if assigned
    if (assignedHoldkampGameId && activeTeamMatch) {
        try {
            await api.updateTeamMatchGame(activeTeamMatch.id, assignedHoldkampGameId, {
                status: 'pending',
                courtNumber: null
            });
        } catch (e) {
            console.error('Failed to release holdkamp game:', e);
        }
        assignedHoldkampGameId = null;
    }

    // Release tournament match back to pending if assigned
    if (assignedTournamentMatchId && activeTournament) {
        try {
            await api.updateTournamentMatch(activeTournament.id, assignedTournamentMatchId, {
                status: 'pending',
                courtNumber: null
            });
        } catch (e) {
            console.error('Failed to release tournament match:', e);
        }
        assignedTournamentMatchId = null;
    }

    // Nulstil swap-flag når banen ryddes
    gameState.sidesManuallySwitched = false;

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
    gameState.version = 0;  // Rækken slettes — næste save opretter forfra

    // Update display
    updateDisplay();

    // Annullér ventende gemninger — de ville genskabe rækken efter DELETE
    if (saveTimeout) { clearTimeout(saveTimeout); saveTimeout = null; }
    pendingSave = false;

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
}

function clearCourt() {
    closeSettingsMenu();
    showMessage(
        'Ryd Banen',
        'Er du sikker på at du vil rydde banen? Alle data vil blive slettet.',
        [
            {
                text: 'Ja, Ryd Banen',
                callback: () => performClearCourtNow(),
                style: 'danger'
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
        gameState._defaultGameMode = settings.defaultGameMode || '15';

        if (courtId < 1 || courtId > courtCount) {
            alert(`Bane ${courtId} findes ikke. Omdirigerer til landingsside.`);
            window.location.href = 'landing.html';
        }

        // Show/hide elements based on tournament mode settings
        isTournamentMode = settings.showResetButton === false;

        if (isTournamentMode) {
            // Hide "Ryd Banen" button in settings menu
            const clearBtn = document.getElementById('clearCourtBtn');
            if (clearBtn) clearBtn.style.display = 'none';

            // Hide "Skift til Double" button (updateDisplay may override — modul-variablen bruges dér)
            const doublesToggle = document.getElementById('doublesToggle');
            if (doublesToggle) doublesToggle.style.display = 'none';

            // Hide "Skift til 15/21" button
            const gameModeToggle = document.getElementById('gameModeToggle');
            if (gameModeToggle) gameModeToggle.style.display = 'none';

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
        gameState.gameMode = loaded.gameMode || gameState._defaultGameMode || '15';
        gameState.decidingGameSwitched = loaded.decidingGameSwitched || false;

        // Convert timestamps from string/ISO format to numbers
        gameState.matchStartTime = loaded.matchStartTime ? (typeof loaded.matchStartTime === 'number' ? loaded.matchStartTime : new Date(loaded.matchStartTime).getTime()) : null;
        syncTimerAnchor(loaded);
        gameState.matchEndTime = loaded.matchEndTime ? (typeof loaded.matchEndTime === 'number' ? loaded.matchEndTime : new Date(loaded.matchEndTime).getTime()) : null;

        gameState.setScoresHistory = loaded.setScoresHistory || [];
        gameState.matchCompleted = loaded.matchCompleted || false;
        gameState.restBreakActive = loaded.restBreakActive || false;
        gameState.restBreakSecondsLeft = loaded.restBreakSecondsLeft || 0;
        gameState.restBreakTitle = loaded.restBreakTitle || '';
        gameState.restBreakTaken = loaded.restBreakTaken || false;
        gameState.restBreakStartedAt = loaded.restBreakStartedAt || null;
        gameState.restBreakDuration = loaded.restBreakDuration || 60;

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

        // Version til optimistic concurrency — medsendes ved næste save
        gameState.version = loaded.version || 0;

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

    // Boldpoint-indikator (punkt 3)
    updateBoldpointIndicator();

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
        // After server is selected: hide serve buttons
        servBtn1.classList.add('hidden');
        servBtn2.classList.add('hidden');
        // +1 låses når kampen er afgjort — ingen ekstra point efter 2 vundne sæt.
        // "Fortryd" og "Ryd bane" virker stadig.
        addBtn1.disabled = gameState.matchCompleted;
        addBtn2.disabled = gameState.matchCompleted;
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
        doublesBtn.style.display = (matchActive || isTournamentMode) ? 'none' : 'block';
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

    // Fortrydes sætbolden mens sætpausen stadig kører, skal pausen annulleres —
    // ellers fyrer dens callback (resetScores + switchSides) senere oven i den
    // gendannede tilstand og bytter score/navne.
    if (gameState.restBreakActive) {
        gameState.restBreakCallback = null;
        await endRestBreak();
    }

    // Restore all game state from snapshot
    gameState.player1.name = previousState.player1.name;
    gameState.player1.name2 = previousState.player1.name2;
    gameState.player1.score = previousState.player1.score;
    gameState.player1.games = previousState.player1.games;
    gameState.player2.name = previousState.player2.name;
    gameState.player2.name2 = previousState.player2.name2;
    gameState.player2.score = previousState.player2.score;
    gameState.player2.games = previousState.player2.games;

    gameState.sidesManuallySwitched = previousState.sidesManuallySwitched || false;
    gameState.restBreakTaken = previousState.restBreakTaken || false;

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

    // Genåbn en afsluttet kamp hvis point-vindet fortrydes (misklik): gendan
    // afslutnings-flag, sluttidspunkt og sæthistorik fra snapshottet, så man kan
    // spille videre til det rigtige resultat.
    gameState.matchCompleted = previousState.matchCompleted || false;
    gameState.matchEndTime = previousState.matchEndTime || null;
    if (Array.isArray(previousState.setScoresHistory)) {
        gameState.setScoresHistory = previousState.setScoresHistory;
    }

    // Kampen kører igen — genstart uret hvis det var stoppet ved kampafslutning
    if (gameState.matchStartTime && !gameState.matchEndTime && !gameState.timerInterval) {
        startTimer();
    }

    // Fortrydes det match-afgørende point, genåbnes kampen — showMatchWonMessage
    // frigav wake lock'en, så genanskaf den hvis kampen kører igen.
    if (matchIsLive() && !_wakeLock) acquireWakeLock();

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
    gameState._sendStartNow = true; // serveren stempler starttiden med sit eget ur
    anchorTimer(0);
    gameState.isActive = true;
    document.getElementById('holdkampPanel').style.display = 'none';
    updateDisplay();
    startTimer();
    acquireWakeLock(); // hold skærmen tændt mens kampen spilles
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

/* ── Kamp-timer: server-forankret og monotonisk ──
   Den forløbne tid ankres i serverens elapsedSeconds (samme ur som
   starttiden i databasen) og tælles lokalt videre med performance.now(),
   som er monotonisk — den kan ikke hoppe, selv hvis maskinens vægur
   justeres. Re-ankres kun ved drift > 2 sek. så visningen ikke flimrer
   ±1 sek. ved hver dataopdatering. */
let _timerAnchor = null;   // { base: sekunder, at: performance.now() }
let _timerFrozen = null;   // fastfrosset visning mens matchEndTime er sat

function anchorTimer(baseSeconds) {
    _timerAnchor = { base: baseSeconds, at: performance.now() };
    _timerFrozen = null;
}

function anchoredElapsed() {
    if (!_timerAnchor) return null;
    return Math.max(0, Math.floor(_timerAnchor.base + (performance.now() - _timerAnchor.at) / 1000));
}

// Kaldes fra loadGameState med serverens tilstand
function syncTimerAnchor(loaded) {
    if (!loaded.matchStartTime) {
        _timerAnchor = null;
        _timerFrozen = null;
        return;
    }
    if (typeof loaded.elapsedSeconds !== 'number') return; // ældre backend — behold lokal
    const local = anchoredElapsed();
    if (local === null || Math.abs(local - loaded.elapsedSeconds) > 2) {
        anchorTimer(loaded.elapsedSeconds);
    }
}

function updateTimer() {
    if (!gameState.matchStartTime) return;

    // Fallback hvis der endnu ikke er et anker (fx side genindlæst mod ældre backend)
    let elapsed;
    if (_timerAnchor) {
        if (gameState.matchEndTime) {
            if (_timerFrozen === null) _timerFrozen = anchoredElapsed();
            elapsed = _timerFrozen;
        } else {
            _timerFrozen = null;
            elapsed = anchoredElapsed();
        }
    } else {
        const now = gameState.matchEndTime || Date.now();
        elapsed = Math.max(0, Math.floor((now - gameState.matchStartTime) / 1000));
    }

    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;

    const timerDisplay = document.getElementById('timerDisplay');
    if (timerDisplay) {
        timerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

// Leading-edge throttle: foerste tryk gemmes MED DET SAMME, efterfoelgende
// tryk indenfor vinduet samles til een gemning. Tidligere var det en trailing
// debounce paa 500ms der blev nulstillet ved hvert tryk — saa ventede TV'et
// altid mindst 0,5s (og laengere ved hurtige tryk) foer point-trykket blev sendt.
const SAVE_THROTTLE_MS = 150;
let lastSaveStartedAt = 0;

function saveGameState() {
    // Mark that we have a pending save
    pendingSave = true;

    // En gemning er allerede planlagt — den tager denne aendring med
    if (saveTimeout) {
        return;
    }

    const sinceLastSave = Date.now() - lastSaveStartedAt;
    const wait = Math.max(0, SAVE_THROTTLE_MS - sinceLastSave);

    saveTimeout = setTimeout(async () => {
        saveTimeout = null;
        if (pendingSave && !isSaving) {
            await performSave();
        }
    }, wait);
}

// Perform the actual API save
// Byg det fulde save-payload fra gameState. Deles af performSave og
// pagehide-flushen, så flushen ikke sender en delmængde (backend merger
// per-felt, så manglende felter ville efterlade en inkonsistent tilstand —
// fx forkert servende makker/side for den gemte score).
function buildSavePayload() {
    return {
        player1: gameState.player1,
        player2: gameState.player2,
        timerSeconds: gameState.timerSeconds,
        // Starttid: 'now' ved kampstart (serveren stempler med sit eget ur),
        // null ved eksplicit rydning — ellers udelades feltet helt, så
        // serverens starttid aldrig overskrives med tablettens klokkeslæt
        matchStartTime: (gameState._sendStartNow && gameState.matchStartTime) ? 'now'
                      : (gameState.matchStartTime === null ? null : undefined),
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
        restBreakStartedAt: gameState.restBreakStartedAt,
        restBreakDuration: gameState.restBreakDuration,
        servingPlayer: gameState.servingPlayer,
        initialServer: gameState.initialServer,
        servingTeam: gameState.servingTeam,
        servingPlayerOnTeam: gameState.servingPlayerOnTeam,
        team1RightCourt: gameState.team1RightCourt,
        team2RightCourt: gameState.team2RightCourt,
        betweenSets: gameState.betweenSets,
        // Optimistic concurrency: serveren afviser med 409 hvis en anden
        // enhed har skrevet siden vores seneste læsning — i stedet for at
        // vi stiltiende overskriver dens ændring
        expectedVersion: typeof gameState.version === 'number' ? gameState.version : 0
    };
}

async function performSave() {
    if (isSaving) {
        // Already saving, will retry
        pendingSave = true;
        return;
    }

    isSaving = true;
    pendingSave = false;
    lastSaveStartedAt = Date.now();

    try {
        const stateToSave = buildSavePayload();

        const result = await api.updateGameState(courtId, stateToSave);
        if (result && typeof result.version === 'number') {
            gameState.version = result.version;
        }
        if (gameState._sendStartNow) gameState._sendStartNow = false; // starttid er nu sat af serveren
        lastOwnSaveAt = Date.now();
        setSyncStatus(true); // gemning lykkedes — skjul evt. offline-badge
        console.log('Game state saved');
    } catch (error) {
        if (error && error.status === 409) {
            // Konflikt — merge og lad finally-blokken genkøre gemningen.
            // En 409 er et svar fra serveren, ikke et forbindelsestab.
            setSyncStatus(true);
            await handleSaveConflict(error.body);
            return;
        }
        if (error && error.status === 401) {
            // Adgangslinket er udløbet/afvist (kun club-mode). Genindlæs så
            // auth-guard fornyer adgangen — droppes gemningen ikke i en løkke.
            handleAuthExpired();
            return;
        }
        console.error('Failed to save game state:', error);
        setSyncStatus(false); // forbindelses-/serverfejl — vis offline-badge
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

// 401 fra en skrivning (kun club-mode): adgangslinket er udløbet eller afvist.
// Genindlæs siden så auth-guard kører og fornyer/omdirigerer. Reload-guard på
// 30s forhindrer en løkke hvis tilstanden ikke retter sig ved genindlæsning.
function handleAuthExpired() {
    const now = Date.now();
    const last = Number(sessionStorage.getItem('lastAuthReload') || 0);
    if (now - last < 30000) {
        console.warn('Adgang afvist (401) — reload-guard aktiv, venter');
        return;
    }
    sessionStorage.setItem('lastAuthReload', String(now));
    console.warn('Adgang udløbet (401) — genindlæser for at forny adgangslink');
    window.location.reload();
}

// 409-konflikt fra performSave: en anden enhed har ændret banens tilstand
// siden vores seneste læsning. conflict.state === null betyder at rækken er
// slettet — banen er nulstillet (admin: Ryd bane) — og vores gemning droppes.
// Ellers adopteres serverens version + navne og gemningen prøves igen:
// tælleren er autoritativ for point/serve under spil, admin for navne.
async function handleSaveConflict(conflict) {
    if (!conflict || conflict.state === null || conflict.state === undefined) {
        console.warn('Save-konflikt: banen er nulstillet af en anden enhed');
        try {
            const fresh = await api.getGameState(courtId);
            await adoptServerReset(fresh);
        } catch (e) {
            console.error('Kunne ikke hente frisk tilstand efter reset-konflikt:', e);
            gameState.version = 0;
        }
        return;
    }

    const server = conflict.state;
    console.warn('Save-konflikt: adopterer serverversion', conflict.version, 'og prøver igen');
    gameState.version = conflict.version || server.version || 0;

    // Navne adopteres kun når de ikke styres af en holdkamp/turnering og
    // siderne ikke er byttet lokalt — samme regler som periodic sync
    const sidesSwitched = gameState.sidesManuallySwitched ||
        gameState.player1.games > 0 || gameState.player2.games > 0;
    if (!assignedHoldkampGameId && !assignedTournamentMatchId && !sidesSwitched) {
        if (server.player1) {
            gameState.player1.name = server.player1.name || gameState.player1.name;
            gameState.player1.name2 = server.player1.name2 || gameState.player1.name2;
        }
        if (server.player2) {
            gameState.player2.name = server.player2.name || gameState.player2.name;
            gameState.player2.name2 = server.player2.name2 || gameState.player2.name2;
        }
        updateDisplay();
    }

    pendingSave = true; // finally-blokken i performSave genkører gemningen
}

// Banen er nulstillet på serveren (admin: Ryd bane / Nulstil) — adopter den
// tomme servertilstand lokalt. Bruges af både periodic sync og 409-håndtering.
async function adoptServerReset(loaded) {
    // Version sættes FØR endRestBreak — dens save skal bruge den friske version
    gameState.version = (loaded && loaded.version) || 0;

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
    gameState.sidesManuallySwitched = false;
    gameState.matchCompleted = false;
    gameState.restBreakTaken = false;

    // Ensure name2 exists
    if (!gameState.player1.name2) gameState.player1.name2 = 'Makker 1';
    if (!gameState.player2.name2) gameState.player2.name2 = 'Makker 2';

    updateDisplay();
}

// Ved indlæsning: hvis banen står med en afsluttet QR-kamp (ikke ryddet endnu),
// så tilbyd den scannende gæst at starte en frisk kamp. Kun for QR-sessioner —
// holdkamp/turnering og direkte tilstand håndteres af admin/tablet som hidtil.
function promptStartFreshIfCompleted() {
    if (!gameState.matchCompleted) return;
    if (!isMatchSessionToken()) return;

    const p1Won = (gameState.player1.games || 0) > (gameState.player2.games || 0);
    const winnerNames = p1Won
        ? formatPlayerNames(gameState.player1.name, gameState.player1.name2)
        : formatPlayerNames(gameState.player2.name, gameState.player2.name2);

    showMessage(
        'Banen er ledig',
        '',
        [{ text: 'Start ny kamp', style: 'primary', callback: () => startFreshMatchInSession() }],
        { bodyHtml: `<div style="text-align:center;line-height:1.6;">Forrige kamp: <strong>${escapeMessageHtml(winnerNames)}</strong> vandt.<br>Tryk for at starte en ny kamp på banen.</div>` }
    );
}

// Starter en frisk kamp UDEN at rydde banen via DELETE — for en QR-session ville
// en DELETE nemlig udløbe adgangen ("scan igen"). I stedet nulstiller vi til
// defaults og gemmer (PUT), så den samme session fortsætter på et rent scoreboard.
async function startFreshMatchInSession() {
    if (gameState.restBreakActive) {
        gameState.restBreakCallback = null;
        await endRestBreak();
    }
    if (gameState.timerInterval) {
        clearInterval(gameState.timerInterval);
        gameState.timerInterval = null;
    }

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
    gameState.isActive = false;
    gameState.decidingGameSwitched = false;
    gameState.matchCompleted = false;
    gameState.restBreakTaken = false;
    gameState.servingPlayer = null;
    gameState.initialServer = null;
    gameState.servingTeam = null;
    gameState.servingPlayerOnTeam = null;
    gameState.team1RightCourt = 1;
    gameState.team2RightCourt = 1;
    gameState.setScoresHistory = [];
    gameState.sidesManuallySwitched = false;
    gameState.history = [];

    updateDisplay();
    // PUT med det samme så serverens afsluttede tilstand overskrives før
    // sync-loopet når at læse de gamle navne tilbage. version bevares → ingen 409.
    await performSave();
}

// Helper function to format player names
function formatPlayerNames(name1, name2) {
    if (gameState.isDoubles && name2 && name2 !== 'Makker 1' && name2 !== 'Makker 2') {
        return `${name1} & ${name2}`;
    }
    return name1;
}

// Rest break functions

// Beregn resterende sekunder fra vægur — korrekt selv hvis skærmen har været slukket.
function _restBreakSecondsRemaining() {
    if (!gameState.restBreakActive || !gameState.restBreakStartedAt) return 0;
    const elapsed = (Date.now() - gameState.restBreakStartedAt) / 1000;
    return Math.max(0, Math.round(gameState.restBreakDuration - elapsed));
}

function _updateRestBreakDisplay() {
    if (!gameState.restBreakActive) return;
    const timerDisplay = document.getElementById('restBreakTimer');
    if (!timerDisplay) return;
    const secondsLeft = _restBreakSecondsRemaining();
    timerDisplay.textContent = secondsLeft;
    if (secondsLeft <= 10) {
        timerDisplay.style.color = '#e94560';
    } else if (secondsLeft <= 30) {
        timerDisplay.style.color = '#FFA500';
    } else {
        timerDisplay.style.color = 'var(--color-accent)';
    }
    return secondsLeft;
}

// Lyt på visibilitychange så vi reagerer straks når skærmen tændes igen
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Systemet slipper wake lock'en når fanen skjules/skærmen låses —
        // genanskaf den hvis en kamp stadig er i gang
        if (matchIsLive() && !_wakeLock) acquireWakeLock();
        if (gameState.restBreakActive) {
            const left = _updateRestBreakDisplay();
            if (left === 0) endRestBreak();
        }
    }
});

// Flush ventende gemninger når siden lukkes/skjules, så et point givet lige før
// fanen lukkes ikke går tabt. fetch med keepalive:true overlever unload (modsat
// en almindelig fetch der afbrydes) og kan — i modsætning til sendBeacon — bruge
// PUT + Authorization-header, så samme rute og auth som en normal gemning.
// pagehide (ikke beforeunload) bevarer browserens bfcache.
window.addEventListener('pagehide', () => {
    if (!pendingSave && !saveTimeout) return;
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (api.token) headers['Authorization'] = `Bearer ${api.token}`;
        // Samme fulde payload som performSave — ellers merger backend per-felt og
        // efterlader serve-position/sider/pause uændret for den flushede score.
        const body = JSON.stringify(buildSavePayload());
        fetch(`/api/game-states/${courtId}`, { method: 'PUT', headers, body, keepalive: true });
    } catch { /* bedst muligt — intet at gøre hvis flush fejler under unload */ }
});

async function startRestBreak(duration = 60, title = 'Pause 1 minut', callback = null, showOverlay = true) {
    gameState.restBreakActive = true;
    gameState.restBreakCallback = callback;
    gameState.restBreakStartedAt = Date.now();
    gameState.restBreakDuration = duration;
    gameState.restBreakSecondsLeft = duration;
    gameState.restBreakTitle = title;
    if (duration === 60) {
        gameState.restBreakTaken = true; // Only set this for 11-point break
    }

    const overlay = document.getElementById('restBreakOverlay');
    const timerDisplay = document.getElementById('restBreakTimer');
    const titleElement = document.getElementById('restBreakTitle');

    titleElement.textContent = title;

    if (showOverlay) {
        overlay.style.display = 'flex';
    }

    timerDisplay.textContent = duration;

    // Brug vægur-beregning i stedet for simpel decrement — robust mod slukket skærm
    gameState.restBreakInterval = setInterval(() => {
        const secondsLeft = _updateRestBreakDisplay();
        gameState.restBreakSecondsLeft = secondsLeft;
        if (secondsLeft <= 0) {
            endRestBreak();
            return;
        }
        saveGameState();
    }, 1000);

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
// options.bodyHtml: hvis sat, indsaettes som innerHTML i stedet for text — bruges
// af showMatchWonMessage for at rendere en struktureret saet-tabel.
function showMessage(title, text, buttons = [{ text: 'OK', callback: null, style: 'primary' }], options = {}) {
    const overlay = document.getElementById('messageOverlay');
    const titleElement = document.getElementById('messageTitle');
    const textElement = document.getElementById('messageText');
    const buttonsContainer = document.getElementById('messageButtons');

    titleElement.textContent = title;
    if (options.bodyHtml) {
        textElement.innerHTML = options.bodyHtml;
        textElement.style.whiteSpace = 'normal';
    } else {
        textElement.textContent = text;
        // Stoet linjeskift i meddelelsens text (textContent rendre normalt \n som mellemrum)
        textElement.style.whiteSpace = 'pre-line';
    }

    // Clear existing buttons
    buttonsContainer.innerHTML = '';

    // Add buttons
    buttons.forEach(button => {
        const btn = document.createElement('button');
        btn.className = button.style === 'secondary' ? 'btn-secondary'
                      : button.style === 'danger'    ? 'btn-danger'
                      : 'btn-primary';
        btn.style.fontSize = '1.5em';
        btn.style.padding = '15px 40px';
        btn.style.cursor = 'pointer';

        if (button.holdDurationMs && button.holdDurationMs > 0) {
            // Hold-to-confirm knap — kraever at brugeren holder museknappen/fingeren
            // nede i holdDurationMs ms foer callback fires. Beskytter mod accidental
            // clears, fx ved holdkamp hvor dommerbesked skal gives foerst.
            btn.style.position = 'relative';
            btn.style.overflow = 'hidden';

            const fill = document.createElement('span');
            fill.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(255,255,255,0.3);pointer-events:none;';

            const label = document.createElement('span');
            label.textContent = button.text;
            label.style.cssText = 'position:relative;z-index:1;';

            btn.appendChild(fill);
            btn.appendChild(label);

            let holdTimer = null;
            const cancelHold = () => {
                if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
                fill.style.transition = 'width 150ms ease-out';
                fill.style.width = '0';
            };
            const beginHold = (e) => {
                if (e.cancelable) e.preventDefault();
                cancelHold();
                fill.style.transition = `width ${button.holdDurationMs}ms linear`;
                void fill.offsetWidth; // tving reflow saa transitionen starter fra 0
                fill.style.width = '100%';
                holdTimer = setTimeout(() => {
                    holdTimer = null;
                    hideMessage();
                    if (button.callback) button.callback();
                }, button.holdDurationMs);
            };

            btn.addEventListener('mousedown', beginHold);
            btn.addEventListener('touchstart', beginHold, { passive: false });
            btn.addEventListener('mouseup', cancelHold);
            btn.addEventListener('mouseleave', cancelHold);
            btn.addEventListener('touchend', cancelHold);
            btn.addEventListener('touchcancel', cancelHold);
            btn.addEventListener('contextmenu', e => e.preventDefault());
        } else {
            btn.textContent = button.text;
            btn.onclick = () => {
                hideMessage();
                if (button.callback) {
                    button.callback();
                }
            };
        }

        buttonsContainer.appendChild(btn);
    });

    overlay.style.display = 'flex';
}

function hideMessage() {
    const overlay = document.getElementById('messageOverlay');
    overlay.style.display = 'none';
}

// Lille html-escape saa spillernavne (brugerinput) ikke kan injicere markup.
function escapeMessageHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Vis "kamp vundet" besked med en struktureret saet-tabel saa det er klart
// hvilken spiller der fik hvilke point i hvert saet. Holdkamp/turneringskamp-
// kampe faar derudover en 3-sek hold-knap og en dommerbesked-paamindelse.
function showMatchWonMessage(winnerNames, winnerGames, loserGames, isReportedMatch) {
    releaseWakeLock(); // kampen er afgjort — skærmen må gerne gå i dvale igen
    const history = gameState.setScoresHistory || [];
    const isDoubles = !!gameState.isDoubles;

    // Find kanonisk side A / side B fra det foerste saet — efterfoelgende saet
    // kan have positionerne ombyttet (decider-skift). Det boejer vi op igen
    // saa hver raekke i tabellen viser den samme side hele vejen ned.
    let sideAName, sideAPartner, sideBName, sideBPartner;
    if (history.length > 0 && typeof history[0] === 'object' && history[0].player1Name) {
        sideAName = history[0].player1Name;
        sideAPartner = history[0].player1Name2;
        sideBName = history[0].player2Name;
        sideBPartner = history[0].player2Name2;
    } else {
        sideAName = gameState.player1.name;
        sideAPartner = gameState.player1.name2;
        sideBName = gameState.player2.name;
        sideBPartner = gameState.player2.name2;
    }

    let sideAGames = 0;
    let sideBGames = 0;
    const setCells = history.map(set => {
        const raw = typeof set === 'string' ? set : set.score;
        const parts = String(raw || '').split('-').map(s => parseInt(s.trim(), 10));
        let scoreA = parts[0];
        let scoreB = parts[1];
        if (typeof set === 'object' && set.player1Name && set.player1Name !== sideAName) {
            // Positioner var byttet om i dette saet — flip score saa side A altid er side A.
            scoreA = parts[1];
            scoreB = parts[0];
        }
        const aWonSet = scoreA > scoreB;
        if (aWonSet) sideAGames++; else sideBGames++;
        return { scoreA, scoreB, aWonSet };
    });

    const labelA = isDoubles && sideAPartner ? `${sideAName} / ${sideAPartner}` : sideAName;
    const labelB = isDoubles && sideBPartner ? `${sideBName} / ${sideBPartner}` : sideBName;
    const sideAWinsMatch = sideAGames > sideBGames;

    const WIN_GREEN = 'var(--color-win, #4CAF50)';
    const MUTED = '#9aa0a8';
    const NAME_COL = 'text-align:left;padding:10px 14px;';
    const SCORE_COL = 'text-align:center;padding:10px 14px;min-width:54px;';
    const SETS_COL = 'text-align:center;padding:10px 14px;font-weight:bold;border-left:1px solid rgba(255,255,255,0.15);';

    const headerCells = setCells.length
        ? setCells.map((_, i) => `<th style="${SCORE_COL}font-weight:normal;color:${MUTED};">Sæt ${i + 1}</th>`).join('')
        : '';

    const rowA = `
        <tr style="background:${sideAWinsMatch ? 'rgba(76,175,80,0.10)' : 'transparent'};color:${sideAWinsMatch ? '#fff' : MUTED};">
            <td style="${NAME_COL}font-weight:${sideAWinsMatch ? 'bold' : 'normal'};">${escapeMessageHtml(labelA)}</td>
            ${setCells.map(c => `<td style="${SCORE_COL}color:${c.aWonSet ? WIN_GREEN : MUTED};font-weight:${c.aWonSet ? 'bold' : 'normal'};">${c.scoreA}</td>`).join('')}
            <td style="${SETS_COL}color:${sideAWinsMatch ? WIN_GREEN : MUTED};">${sideAGames}</td>
        </tr>`;
    const rowB = `
        <tr style="background:${!sideAWinsMatch ? 'rgba(76,175,80,0.10)' : 'transparent'};color:${!sideAWinsMatch ? '#fff' : MUTED};">
            <td style="${NAME_COL}font-weight:${!sideAWinsMatch ? 'bold' : 'normal'};">${escapeMessageHtml(labelB)}</td>
            ${setCells.map(c => `<td style="${SCORE_COL}color:${!c.aWonSet ? WIN_GREEN : MUTED};font-weight:${!c.aWonSet ? 'bold' : 'normal'};">${c.scoreB}</td>`).join('')}
            <td style="${SETS_COL}color:${!sideAWinsMatch ? WIN_GREEN : MUTED};">${sideBGames}</td>
        </tr>`;

    const tableHtml = setCells.length
        ? `<table style="margin:0 auto;border-collapse:collapse;font-size:1.15em;">
                <thead>
                    <tr>
                        <th style="${NAME_COL}"></th>
                        ${headerCells}
                        <th style="${SETS_COL}font-weight:normal;color:${MUTED};">Sæt</th>
                    </tr>
                </thead>
                <tbody>${rowA}${rowB}</tbody>
           </table>`
        : '';

    const winnerLine = `
        <div style="text-align:center;margin-bottom:18px;font-size:1.25em;color:${WIN_GREEN};font-weight:bold;">
            ${escapeMessageHtml(winnerNames)} vinder ${winnerGames}-${loserGames}
        </div>`;

    const noticeHtml = isReportedMatch
        ? `<div style="margin-top:22px;color:#FFA500;line-height:1.55;text-align:center;font-size:0.95em;">
                Husk at give dommerbesked om resultatet.<br>
                Hold knappen inde i 3 sekunder for at rydde banen.
           </div>`
        : '';

    const bodyHtml = `<div style="display:flex;flex-direction:column;align-items:center;">${winnerLine}${tableHtml}${noticeHtml}</div>`;

    const buttons = isReportedMatch
        ? [{ text: 'Ryd Banen (hold 3 sek.)', callback: () => performClearCourtNow(), style: 'danger', holdDurationMs: 3000 }]
        : [{ text: 'Ny Kamp', callback: () => clearCourt(), style: 'primary' }];

    showMessage('Kamp Vundet!', '', buttons, { bodyHtml });
}

// Save match result to database
async function saveMatchResult(winner, loser, winnerGames, loserGames) {
    // Fang state-oplysninger med det samme og nulstil assigned-IDs straks.
    // saveMatchResult køres IKKE-afventet fra checkGameWin, så clearCourt() kan
    // køre parallelt og overskrive de globale assigned-vars inden vi når at rapportere.
    let capturedGameId = assignedHoldkampGameId;
    let capturedTeamMatch = activeTeamMatch;
    assignedHoldkampGameId = null;

    let capturedTournamentMatchId = assignedTournamentMatchId;
    let capturedTournament = activeTournament;
    assignedTournamentMatchId = null;

    try {
        // Fallback-binding: de globale assigned-vars sættes KUN af den periodiske
        // sync (hvert 5. sek). Hvis en turnerings-/holdkamp blev tildelt banen og
        // spillet færdig inden for ét sync-interval (typisk ved hurtig test, eller
        // hvis court-siden lige er åbnet), nåede syncen aldrig at binde — og så blev
        // resultatet hverken rapporteret eller fjernet fra kamplisten. Vi slår derfor
        // tildelingen op direkte her, så afslutningen altid registreres korrekt.
        if (!capturedTournamentMatchId && !capturedGameId) {
            try {
                const tournaments = await api.getActiveTournaments();
                for (const t of (tournaments || [])) {
                    const m = (t.matches || []).find(mm => mm.court_number === courtId && mm.status === 'active');
                    if (m) { capturedTournamentMatchId = m.id; capturedTournament = t; break; }
                }
            } catch (e) {
                console.error('Fallback-opslag af turneringskamp fejlede:', e);
            }

            if (!capturedTournamentMatchId) {
                try {
                    const byCourt = await api.getTeamMatchByCourt(courtId);
                    if (byCourt && byCourt.game) { capturedGameId = byCourt.game.id; capturedTeamMatch = byCourt; }
                } catch (e) {
                    console.error('Fallback-opslag af holdkamp fejlede:', e);
                }
            }
        }

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

        // Turneringskampe gemmes IKKE i enkelt-kamp-historikken — de findes kun
        // under Turnering-fanen så historikken ikke duplikeres.
        if (!capturedTournamentMatchId) {
            await api.saveMatchResult(matchData);
        }

        // Report holdkamp result using captured values (assignedHoldkampGameId may already be null).
        // capturedTeamMatch kan være enten et fuldt holdkamp-objekt (.games) eller et
        // by-court-objekt (.game) — håndtér begge.
        if (capturedGameId && capturedTeamMatch) {
            const candidateGames = capturedTeamMatch.games || (capturedTeamMatch.game ? [capturedTeamMatch.game] : []);
            const game = candidateGames.find(g => g.id === capturedGameId);
            let winnerTeam = 2;
            if (game) {
                const team1Names = [game.team1_player1, game.team1_player2].filter(Boolean);
                winnerTeam = team1Names.some(name => winner.includes(name)) ? 1 : 2;
            }
            await reportHoldkampResult(winnerTeam, setScoresText, capturedTeamMatch.id, capturedGameId);
        }

        // Report tournament result (parallel til holdkamp — uafhængigt resultat-flow)
        if (capturedTournamentMatchId && capturedTournament) {
            const match = (capturedTournament.matches || []).find(m => m.id === capturedTournamentMatchId);
            let winnerTeam = 2;
            if (match) {
                const side1Names = [match.side1_player1, match.side1_player2].filter(Boolean);
                winnerTeam = side1Names.some(name => winner.includes(name)) ? 1 : 2;
            }
            await reportTournamentResult(winnerTeam, setScoresText, capturedTournament.id, capturedTournamentMatchId);
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
// Synken er event-drevet: SSE-events fra serveren udløser den med det samme
// (admin-reset, navneændringer og holdkamp/turnerings-tildelinger rammer banen
// på ~100ms). Intervallet er kun et sikkerhedsnet — 30s når SSE er forbundet,
// 5s (som før) uden SSE. Selve sync-logikken i serverSyncTick() er uændret.
const SYNC_FALLBACK_MS = 5000;
const SYNC_SAFETY_MS = 30000;
let syncInterval = null;
let courtLiveUpdates = null;

function startPeriodicSync() {
    startSyncPolling(SYNC_FALLBACK_MS);

    if (window.LiveUpdates) {
        courtLiveUpdates = window.LiveUpdates.connect({
            court: courtId,
            onEvent: (event) => handleCourtEvent(event),
            onStateChange: (connected) => startSyncPolling(connected ? SYNC_SAFETY_MS : SYNC_FALLBACK_MS)
        });
    }
}

function startSyncPolling(ms) {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(runServerSync, ms);
}

// SSE-event for denne bane: kør synken med det samme. Egne gemninger udløser
// også events (ét pr. point-gemning) — de springes over, så vi ikke henter
// tilstand vi selv lige har skrevet. Reset-events køres altid; vores egen
// "Ryd bane" er ufarlig at synke (wasReset-grenen kræver en aktiv kamp lokalt).
function handleCourtEvent(event) {
    const type = event && event.type;
    if (type !== 'reset' && Date.now() - lastOwnSaveAt < 1200) return;
    runServerSync();
}

// Kør én sync ad gangen — events der ankommer imens samles til én ekstra kørsel
let _syncRunning = false;
let _syncPending = false;
async function runServerSync() {
    if (_syncRunning) {
        _syncPending = true;
        return;
    }
    _syncRunning = true;
    try {
        await serverSyncTick();
    } finally {
        _syncRunning = false;
        if (_syncPending) {
            _syncPending = false;
            runServerSync();
        }
    }
}

async function serverSyncTick() {
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
                await adoptServerReset(loaded);
                if (isMatchSessionToken()) return;
            } else if (!assignedHoldkampGameId && !assignedTournamentMatchId) {
                // Just sync player names (in case they were changed from another device).
                // Springes over når banen er bundet til en holdkamp/turnering — der er
                // delkampen/kampen autoritativ (håndteres i holdkamp/turnerings-synken),
                // så vi ikke kommer til at sætte banen tilbage til single via en stale læsning.
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

                // Sync game mode (21/30 vs 15/21) når admin har aendret det
                if (loaded.gameMode && loaded.gameMode !== gameState.gameMode) {
                    gameState.gameMode = loaded.gameMode;
                    updateGameModeButton();
                    updateDisplay();
                }
            }
        } catch (error) {
            console.error('Failed to sync game state:', error);
        }

        // Holdkamp sync: opdag binding/ny holdkamp uden at antage én aktiv holdkamp
        try {
            if (assignedHoldkampGameId) {
                // Allerede bundet — synk spillernavne fra delkampen, men KUN før et sæt
                // er afgjort. Efter første sæt har switchSides() byttet slots, og at
                // genanvende de oprindelige navne ville efterlade navne/score forkert.
                const byCourt = await api.getTeamMatchByCourt(courtId);
                if (byCourt && byCourt.game) {
                    activeTeamMatch = byCourt;
                    const myGame = byCourt.game;

                    // Håndhæv at banen står i samme single/double-tilstand som delkampen.
                    // Game-state-synken kan ellers kortvarigt læse en stale server-tilstand
                    // (lige efter tildeling) og sætte banen tilbage til single.
                    const shouldBeDoubles = ['MD', 'DD', 'HD', 'Double'].includes(myGame.category);
                    if (!gameState.matchStartTime && gameState.isDoubles !== shouldBeDoubles) {
                        gameState.isDoubles = shouldBeDoubles;
                        if (shouldBeDoubles) {
                            if (myGame.team1_player2) gameState.player1.name2 = myGame.team1_player2;
                            if (myGame.team2_player2) gameState.player2.name2 = myGame.team2_player2;
                        }
                        updateDisplay();
                        saveGameState();
                    }

                    const sidesHaveBeenSwitched = gameState.sidesManuallySwitched || gameState.player1.games > 0 || gameState.player2.games > 0;
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
            } else {
                // Ikke bundet: er denne bane lige blevet bundet (af denne enhed eller admin)?
                const byCourt = await api.getTeamMatchByCourt(courtId);
                if (byCourt && byCourt.game) {
                    activeTeamMatch = byCourt;
                    assignedHoldkampGameId = byCourt.game.id;
                    applyHoldkampGameToState(byCourt.game);
                    showHoldkampAssigned(byCourt.game);
                } else {
                    const matches = await api.getActiveTeamMatches();
                    const hasPending = (matches || []).some(tm => (tm.games || []).some(g => g.status === 'pending'));
                    const panel = document.getElementById('holdkampPanel');
                    const matchSel = document.getElementById('holdkampMatchSelect');
                    const gameSel = document.getElementById('holdkampGameSelect');
                    const userIsSelecting = holdkampSelectFocused || (matchSel && matchSel.value) || (gameSel && gameSel.value);
                    if (hasPending && !activeTeamMatch) {
                        // Åbn panelet én gang (activeTeamMatch markerer "initialiseret")
                        activeTeamMatch = matches[0];
                        await initHoldkampPanel();
                    } else if (panel && panel.style.display !== 'none' && !userIsSelecting) {
                        await refreshHoldkampPanel();
                    }
                }
            }
        } catch (error) {
            console.error('Failed to sync holdkamp:', error);
        }

        // Tournament sync: detect when admin har tildelt en planlagt kamp til DENNE bane,
        // og sync spillernavne hvis admin redigerer kampen mens den kører.
        try {
            const tournaments = await api.getActiveTournaments();
            let myMatch = null;
            let parentTournament = null;
            for (const t of (tournaments || [])) {
                const found = (t.matches || []).find(m =>
                    m.court_number === courtId && m.status === 'active'
                );
                if (found) {
                    myMatch = found;
                    parentTournament = t;
                    break;
                }
            }

            if (myMatch && parentTournament) {
                // Første gang vi ser tildelingen — populér gameState og lås id'erne fast
                if (!assignedTournamentMatchId) {
                    assignedTournamentMatchId = myMatch.id;
                    activeTournament = parentTournament;
                    applyTournamentMatchToCourt(myMatch);
                } else {
                    // Allerede tildelt — opdatér state-referencen så reportTournamentResult
                    // har frisk data, og sync navne ind hvis admin har redigeret dem.
                    activeTournament = parentTournament;
                    const sidesHaveBeenSwitched = gameState.sidesManuallySwitched || gameState.player1.games > 0 || gameState.player2.games > 0;
                    if (!sidesHaveBeenSwitched) {
                        const namesChanged =
                            (myMatch.side1_player1 && gameState.player1.name !== myMatch.side1_player1) ||
                            (myMatch.side1_player2 && gameState.player1.name2 !== myMatch.side1_player2) ||
                            (myMatch.side2_player1 && gameState.player2.name !== myMatch.side2_player1) ||
                            (myMatch.side2_player2 && gameState.player2.name2 !== myMatch.side2_player2);
                        if (namesChanged) {
                            if (myMatch.side1_player1) gameState.player1.name = myMatch.side1_player1;
                            if (myMatch.side1_player2) gameState.player1.name2 = myMatch.side1_player2;
                            if (myMatch.side2_player1) gameState.player2.name = myMatch.side2_player1;
                            if (myMatch.side2_player2) gameState.player2.name2 = myMatch.side2_player2;
                            updateDisplay();
                            saveGameState();
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Failed to sync tournament:', error);
        }
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
    if (assignedHoldkampGameId && activeTeamMatch) {
        api.updateTeamMatchGame(activeTeamMatch.id, assignedHoldkampGameId, {
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
        // Er denne bane allerede bundet til en aktiv delkamp?
        const byCourt = await api.getTeamMatchByCourt(courtId);
        if (byCourt && byCourt.game) {
            document.getElementById('showHoldkampPanelBtn').style.display = 'block';
            activeTeamMatch = byCourt;
            assignedHoldkampGameId = byCourt.game.id;
            applyHoldkampGameToState(byCourt.game);
            showHoldkampAssigned(byCourt.game);
            return;
        }

        // Ellers: vis panel med to-trins valg fra alle aktive holdkampe
        const matches = await api.getActiveTeamMatches();
        const hasPending = (matches || []).some(tm => (tm.games || []).some(g => g.status === 'pending'));
        if (!hasPending) return;

        document.getElementById('showHoldkampPanelBtn').style.display = 'block';
        populateHoldkampMatchSelect(matches);
        document.getElementById('holdkampPanel').style.display = 'block';
    } catch (error) {
        console.error('Failed to init holdkamp panel:', error);
    }
}

// Fylder holdkamp-dropdownen med aktive holdkampe der har ventende delkampe.
function populateHoldkampMatchSelect(matches) {
    holdkampMatches = matches || [];
    const matchSel = document.getElementById('holdkampMatchSelect');
    // Kun holdkampe der har ventende delkampe er relevante at vælge.
    const selectable = holdkampMatches.filter(tm => (tm.games || []).some(g => g.status === 'pending'));

    // Kun én holdkamp: spring holdkamp-valget over og vis kun delkampene.
    if (selectable.length === 1) {
        const tm = selectable[0];
        matchSel.style.display = 'none';
        // Byg option via textContent (ikke innerHTML) — holdnavne kommer fra
        // API'et og må ikke tolkes som HTML (XSS). Samme mønster som nedenfor.
        matchSel.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = tm.id;
        opt.textContent = `${tm.team1_name} vs ${tm.team2_name}`;
        matchSel.appendChild(opt);
        matchSel.value = String(tm.id);
        onHoldkampMatchChange();
        return;
    }

    // Flere holdkampe: vis holdkamp-dropdownen (to-trins valg).
    matchSel.style.display = '';
    const prev = matchSel.value;
    matchSel.innerHTML = '<option value="">-- Vælg holdkamp --</option>';
    selectable.forEach(tm => {
        const opt = document.createElement('option');
        opt.value = tm.id;
        opt.textContent = `${tm.team1_name} vs ${tm.team2_name}`;
        matchSel.appendChild(opt);
    });
    if (prev && matchSel.querySelector(`option[value="${prev}"]`)) matchSel.value = prev;
    onHoldkampMatchChange();
}

// Fylder delkamp-dropdownen ud fra den valgte holdkamp.
function onHoldkampMatchChange() {
    const matchSel = document.getElementById('holdkampMatchSelect');
    const select = document.getElementById('holdkampGameSelect');
    const tm = holdkampMatches.find(m => String(m.id) === matchSel.value);
    select.innerHTML = '<option value="">-- Vælg delkamp --</option>';
    if (!tm) return;
    const catNums = holdkampCategoryNumbers(tm.games);
    (tm.games || []).filter(g => g.status === 'pending').forEach(g => {
        const isDoubles = ['MD', 'DD', 'HD', 'Double'].includes(g.category);
        const t1 = isDoubles
            ? `${g.team1_player1 || '?'}${g.team1_player2 ? ' & ' + g.team1_player2 : ''}`
            : (g.team1_player1 || '?');
        const t2 = isDoubles
            ? `${g.team2_player1 || '?'}${g.team2_player2 ? ' & ' + g.team2_player2 : ''}`
            : (g.team2_player1 || '?');
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = `${g.category} ${catNums[g.id]}: ${t1} vs ${t2}`;
        select.appendChild(opt);
    });
}

// Bygger map game.id -> per-kategori-nummer (MD1, MD2, DS1, DS2 ...) saa numrene
// matcher Holdkamp-siden. Taeller over ALLE kampe i raekkefoelge — ikke kun
// pending — saa game_number (fortloebende) ikke laekker ind i visningen.
function holdkampCategoryNumbers(games) {
    const counts = {};
    const map = {};
    (games || []).forEach(g => {
        counts[g.category] = (counts[g.category] || 0) + 1;
        map[g.id] = counts[g.category];
    });
    return map;
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
    // Tildeling betragtes som aktiv — uden dette ville saveGameState saa langt
    // herefter sende isActive=false og overskrive courts.is_active i DB, saa
    // admin baneoversigt straks tabte navnene.
    gameState.isActive = true;
    // Frisk tildeling — eventuelt tidligere swap-flag nulstilles
    gameState.sidesManuallySwitched = false;
    updateDisplay();
    saveGameState();
}

async function assignHoldkampGame() {
    const matchId = parseInt(document.getElementById('holdkampMatchSelect').value, 10);
    const gameId = parseInt(document.getElementById('holdkampGameSelect').value, 10);
    if (!matchId || !gameId) return;
    const tm = holdkampMatches.find(m => m.id === matchId);
    const game = tm && (tm.games || []).find(g => g.id === gameId);
    if (!tm || !game) return;

    try {
        await api.updateTeamMatchGame(matchId, gameId, { courtNumber: courtId, status: 'active' });
        activeTeamMatch = tm;
        assignedHoldkampGameId = gameId;
        applyHoldkampGameToState(game);
        showHoldkampAssigned(game);
    } catch (error) {
        console.error('Failed to assign holdkamp game:', error);
        if (error.status === 409) {
            showMessage('Bane optaget', error.message);
            await refreshHoldkampPanel();
        }
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
        const matches = await api.getActiveTeamMatches();
        const hasPending = (matches || []).some(tm => (tm.games || []).some(g => g.status === 'pending'));
        if (!hasPending) return;

        assignedHoldkampGameId = null;
        const panel = document.getElementById('holdkampPanel');
        const select = document.getElementById('holdkampGameSelect');
        const assignBtn = document.getElementById('assignHoldkampBtn');
        const assignedDiv = document.getElementById('holdkampAssigned');

        // Reset panel to selection state
        assignedDiv.style.display = 'none';
        document.getElementById('holdkampMatchSelect').style.display = '';
        select.style.display = '';
        assignBtn.style.display = '';

        populateHoldkampMatchSelect(matches);
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
        <svg viewBox="0 0 24 24" fill="rgba(255,255,255,0.85)" style="width: clamp(60px,14vw,110px); height: clamp(60px,14vw,110px); margin-bottom: 24px;"><g transform="translate(0 1.2)"><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-33 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(-14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(14 12 14.5)"/><ellipse cx="12" cy="7.7" rx="1.5" ry="6.8" transform="rotate(33 12 14.5)"/><rect x="9.4" y="14.3" width="5.2" height="1.7" rx="0.85"/><path d="M9.7 16.6h4.6v0.5a2.3 2.3 0 0 1-4.6 0z"/></g></svg>
        <h1 style="font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.05em; font-size: clamp(1.8em,6vw,3em); margin-bottom: 16px; color: #fff;">Kamp Afsluttet</h1>
        <p style="font-size: clamp(1em,3vw,1.4em); color: rgba(255,255,255,0.65); max-width: 400px; line-height: 1.6;">
            Banen er blevet nulstillet.<br>
            Scan QR-koden igen for at tælle næste kamp.
        </p>
    `;
    document.body.appendChild(overlay);

    // Deaktiver alle knapinteraktioner
    document.querySelectorAll('button').forEach(b => b.disabled = true);
}

async function reportHoldkampResult(winnerTeam, setScores, teamMatchId, gameId) {
    // Brug eksplicitte IDs — assignedHoldkampGameId kan allerede være null pga. race-condition-fix
    const tmId = teamMatchId ?? activeTeamMatch?.id;
    const gId  = gameId      ?? assignedHoldkampGameId;
    if (!tmId || !gId) return;
    try {
        await api.updateTeamMatchGame(tmId, gId, {
            status: 'finished',
            winnerTeam,
            setScores
        });
    } catch (error) {
        console.error('Failed to report holdkamp result:', error);
    }
}

// ==================== TOURNAMENT (Planlagte kampe) — passiv modtagelse ====================

// Tildelinger sker fra admin baneoversigt. Court populerer kun gameState når sync-loopet
// detekterer at en planlagt kamp er aktiv på denne bane, og rapporterer resultatet
// tilbage når kampen afsluttes.

function applyTournamentMatchToCourt(match) {
    const isDoubles = !!match.doubles;
    gameState.player1.name = match.side1_player1 || 'Spiller 1';
    gameState.player2.name = match.side2_player1 || 'Spiller 2';
    if (isDoubles) {
        gameState.player1.name2 = match.side1_player2 || 'Makker 1';
        gameState.player2.name2 = match.side2_player2 || 'Makker 2';
    }
    gameState.isDoubles = isDoubles;
    // Tildeling betragtes som aktiv — saa saveGameState ikke nedgraderer
    // courts.is_active til false naar admin lige har aktiveret banen.
    gameState.isActive = true;
    // Frisk tildeling — eventuelt tidligere swap-flag nulstilles
    gameState.sidesManuallySwitched = false;
    updateDisplay();
    saveGameState();
}

async function reportTournamentResult(winnerTeam, setScores, tournamentId, matchId) {
    const tId = tournamentId ?? activeTournament?.id;
    const mId = matchId      ?? assignedTournamentMatchId;
    if (!tId || !mId) return;
    try {
        await api.updateTournamentMatch(tId, mId, {
            status: 'finished',
            winnerTeam,
            setScores
        });
    } catch (error) {
        console.error('Failed to report tournament result:', error);
    }
}
