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
    history: []
};

// Initialize app
document.addEventListener('DOMContentLoaded', async function() {
    await initializeApp();
    console.log('Court V3 initialized for court', courtId);
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

        console.log('Court V3 ready - content will be added here');
    } catch (error) {
        console.error('Failed to initialize Court V3:', error);
    }
}
