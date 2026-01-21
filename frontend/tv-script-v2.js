// TV Display Script - Read-only view with auto-refresh
const api = window.BadmintonAPI;

const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id')) || 1;

let refreshInterval = null;
let slideshowInterval = null;
let currentSlideIndex = 0;
let isShowingSlideshow = false;
let cachedSponsorImages = [];
let cachedSlideDuration = 10000; // 10 seconds default
let timerInterval = null;
let isMatchCurrentlyActive = false;
let wasMatchPreviouslyActive = false;
// Track original player names to keep consistent TV display
let originalPlayer1Name = null;
let originalPlayer1Name2 = null;
let originalPlayer2Name = null;
let originalPlayer2Name2 = null;
// Store match start time from database
let matchStartTime = null;
let matchEndTime = null;

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initializeTVDisplay();
    loadCourtData();
    startAutoRefresh();
    startLocalTimer();
    // Refresh sponsor settings every 30 seconds
    setInterval(refreshSponsorSettings, 30000);
});

async function initializeTVDisplay() {
    // Display court number
    document.getElementById('courtNumber').textContent = courtId;

    try {
        // Verify court is valid
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;

        if (courtId < 1 || courtId > courtCount) {
            document.querySelector('.tv-container').innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; height: 100vh; flex-direction: column; gap: 20px;">
                    <h1 style="font-size: 4em; color: #e94560;">Bane ${courtId} Ikke Fundet</h1>
                    <a href="landing.html" style="color: #fff; font-size: 2em; text-decoration: underline;">Tilbage til Landingsside</a>
                </div>
            `;
        }

        // Preload sponsor settings
        await refreshSponsorSettings();
    } catch (error) {
        console.error('Failed to initialize TV display:', error);
    }
}

function startAutoRefresh() {
    // Refresh every 2 seconds for responsive updates
    refreshInterval = setInterval(loadCourtData, 2000);
}

function startLocalTimer() {
    // Update timer display every second based on matchStartTime
    timerInterval = setInterval(function() {
        if (isMatchCurrentlyActive) {
            updateTimerDisplay();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const timerElement = document.getElementById('timerDisplay');
    if (!timerElement) return;

    let elapsedSeconds = 0;

    if (matchStartTime) {
        // Calculate elapsed time from server timestamp (same as court page)
        const startTime = new Date(matchStartTime);
        const endTime = matchEndTime ? new Date(matchEndTime) : new Date();
        const elapsedMs = endTime - startTime;
        elapsedSeconds = Math.floor(elapsedMs / 1000);
    }

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

    // Show hours if match has been going for more than an hour
    if (hours > 0) {
        timerElement.textContent =
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    } else {
        timerElement.textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
}

async function loadCourtData() {
    try {
        // Get game state from API
        const gameState = await api.getGameState(courtId);

        // Check if match is active
        const isMatchActive = gameState.isActive === true;

        // Check if there's actual game activity (scoring has started)
        const hasGameActivity =
            gameState.player1.score > 0 ||
            gameState.player2.score > 0 ||
            gameState.player1.games > 0 ||
            gameState.player2.games > 0 ||
            gameState.timerSeconds > 0;

        // Timer should only run when there's actual game activity
        isMatchCurrentlyActive = isMatchActive && hasGameActivity;

        // Show sponsors if court is not active (based on isActive flag)
        // When admin deactivates the court, sponsors will show
        if (!isMatchActive) {
            // Court not active - show sponsor slideshow
            matchStartTime = null;
            matchEndTime = null;
            isMatchCurrentlyActive = false;
            wasMatchPreviouslyActive = false;
            // Reset original player names for next match
            originalPlayer1Name = null;
            originalPlayer1Name2 = null;
            originalPlayer2Name = null;
            originalPlayer2Name2 = null;
            hideMatchFinished(); // Hide match finished overlay if shown
            hideRestBreak(); // Hide rest break overlay if shown
            showSponsorSlideshow();
            return;
        }

        // Detect new match starting (transition from inactive to active)
        if (isMatchActive && !wasMatchPreviouslyActive) {
            console.log('[TV] New match detected - reloading theme colors and storing original player positions');
            // Store original player names for consistent TV display
            originalPlayer1Name = gameState.player1.name;
            originalPlayer1Name2 = gameState.player1.name2 || null;
            originalPlayer2Name = gameState.player2.name;
            originalPlayer2Name2 = gameState.player2.name2 || null;

            // Reload theme colors when a new match starts
            if (window.loadTheme) {
                await window.loadTheme();
            }
            wasMatchPreviouslyActive = true;
        }

        // Match is active - hide slideshow and show scores
        hideSponsorSlideshow();

        // Check if players have been swapped on court page (for consistent TV display)
        // If player1's current name matches original player2's name, they've been swapped
        const playersSwapped = originalPlayer1Name &&
                               gameState.player1.name === originalPlayer2Name;

        // Check if match is finished (someone won)
        const maxGames = gameState.gameMode === '15' ? 2 : 2; // Best of 3 in both modes
        const matchFinished = gameState.player1.games >= 2 || gameState.player2.games >= 2;

        if (matchFinished) {
            showMatchFinished(gameState, playersSwapped);
            return; // Don't update normal display if match is finished
        } else {
            hideMatchFinished();
        }

        // Check for rest break (pass swapped status for consistent display)
        if (gameState.restBreakActive) {
            showRestBreak(gameState.restBreakSecondsLeft, gameState.restBreakTitle, gameState, playersSwapped);
        } else {
            hideRestBreak();
        }

        // Determine display players based on swap status
        let displayPlayer1, displayPlayer2;

        if (playersSwapped) {
            // Swap back for TV display only - keep original positions
            displayPlayer1 = {
                name: gameState.player2.name,
                name2: gameState.player2.name2,
                score: gameState.player2.score,
                games: gameState.player2.games
            };
            displayPlayer2 = {
                name: gameState.player1.name,
                name2: gameState.player1.name2,
                score: gameState.player1.score,
                games: gameState.player1.games
            };
            console.log('[TV] Players swapped on court - displaying in original TV positions');
        } else {
            // No swap or first time - display as-is
            displayPlayer1 = gameState.player1;
            displayPlayer2 = gameState.player2;
        }

        // Update display with consistent player positions
        document.getElementById('player1Name').textContent = displayPlayer1.name;
        document.getElementById('player2Name').textContent = displayPlayer2.name;

        // Handle doubles mode
        const isDoubles = gameState.isDoubles || false;
        const player1Name2 = document.getElementById('player1Name2');
        const player2Name2 = document.getElementById('player2Name2');

        if (isDoubles && displayPlayer1.name2 && displayPlayer2.name2) {
            player1Name2.textContent = displayPlayer1.name2;
            player2Name2.textContent = displayPlayer2.name2;
            player1Name2.style.display = 'flex';
            player2Name2.style.display = 'flex';
        } else {
            player1Name2.style.display = 'none';
            player2Name2.style.display = 'none';
        }

        document.getElementById('player1Score').textContent = displayPlayer1.score;
        document.getElementById('player2Score').textContent = displayPlayer2.score;
        document.getElementById('player1Games').textContent = displayPlayer1.games;
        document.getElementById('player2Games').textContent = displayPlayer2.games;

        // Update match timing from database (same as court page)
        matchStartTime = gameState.matchStartTime;
        matchEndTime = gameState.matchEndTime;

        // Update timer display (calculates elapsed time from matchStartTime)
        updateTimerDisplay();
    } catch (error) {
        console.error('Failed to load court data:', error);
        // Show sponsor slideshow on error (network issues)
        showSponsorSlideshow();
    }
}

async function refreshSponsorSettings() {
    try {
        // Refresh sponsor images cache
        const images = await api.getSponsorImages();
        cachedSponsorImages = images;

        // Refresh slide duration cache
        const settings = await api.getSponsorSettings();
        cachedSlideDuration = settings.slideDuration * 1000; // Convert to milliseconds
    } catch (error) {
        console.error('Failed to refresh sponsor settings:', error);
    }
}

function getSponsorImages() {
    return cachedSponsorImages;
}

function getSlideDuration() {
    return cachedSlideDuration;
}

function showSponsorSlideshow() {
    const images = getSponsorImages();

    if (images.length === 0) {
        // No sponsor images - show default message
        if (!isShowingSlideshow) {
            hideScoreboard();
            showDefaultMessage();
            isShowingSlideshow = true;
        }
        return;
    }

    // Only initialize slideshow if not already showing
    if (!isShowingSlideshow) {
        hideScoreboard();
        createSlideshowContainer();
        isShowingSlideshow = true;
        currentSlideIndex = 0;

        // Display first slide
        displayCurrentSlide(images);

        // Start slideshow timer
        const duration = getSlideDuration();
        slideshowInterval = setInterval(function() {
            const imgs = getSponsorImages();
            if (imgs.length > 0) {
                currentSlideIndex = (currentSlideIndex + 1) % imgs.length;
                displayCurrentSlide(imgs);
            }
        }, duration);
    }
    // If already showing slideshow, do nothing - let the interval handle slide changes
}

function hideSponsorSlideshow() {
    if (isShowingSlideshow) {
        // Stop slideshow
        if (slideshowInterval) {
            clearInterval(slideshowInterval);
            slideshowInterval = null;
        }

        // Remove slideshow container
        const slideshowContainer = document.querySelector('.sponsor-slideshow');
        if (slideshowContainer) {
            slideshowContainer.remove();
        }

        // Show scoreboard
        showScoreboard();
        isShowingSlideshow = false;
    }
}

function hideScoreboard() {
    const scoreboard = document.querySelector('.scoreboard');
    const header = document.querySelector('.tv-header');
    const footer = document.querySelector('.tv-footer');

    if (scoreboard) scoreboard.style.display = 'none';
    if (header) header.style.display = 'none';
    if (footer) footer.style.display = 'none';
}

function showScoreboard() {
    const scoreboard = document.querySelector('.scoreboard');
    const header = document.querySelector('.tv-header');
    const footer = document.querySelector('.tv-footer');

    if (scoreboard) scoreboard.style.display = 'flex';
    if (header) header.style.display = 'flex';
    if (footer) footer.style.display = 'flex';
}

function createSlideshowContainer() {
    // Remove existing if any
    const existing = document.querySelector('.sponsor-slideshow');
    if (existing) existing.remove();

    // Create new slideshow container
    const container = document.createElement('div');
    container.className = 'sponsor-slideshow';
    document.querySelector('.tv-container').appendChild(container);
}

function displayCurrentSlide(images) {
    const container = document.querySelector('.sponsor-slideshow');
    if (!container || images.length === 0) return;

    const image = images[currentSlideIndex];

    // Use /uploads/ URL instead of base64 data
    container.innerHTML = `
        <div class="sponsor-slide">
            <img src="/uploads/${image.filename}" alt="${escapeHtml(image.original_name)}" class="sponsor-image">
        </div>
    `;
}

function showDefaultMessage() {
    const container = document.createElement('div');
    container.className = 'sponsor-slideshow';
    container.innerHTML = `
        <div class="sponsor-slide">
            <div class="no-sponsors-message">
                <h2>Ingen aktiv kamp</h2>
                <p>Bane ${courtId}</p>
            </div>
        </div>
    `;
    document.querySelector('.tv-container').appendChild(container);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Rest break display functions
function showRestBreak(secondsLeft, title, gameState, playersSwapped) {
    const overlay = document.getElementById('tvRestBreakOverlay');
    const timerDisplay = document.getElementById('tvRestBreakTimer');
    const titleElement = document.getElementById('tvRestBreakTitle');

    if (!overlay) return;

    titleElement.textContent = title || 'Pause';
    timerDisplay.textContent = secondsLeft || 0;

    // Update score display in rest break overlay with consistent player positions
    if (gameState) {
        let displayPlayer1, displayPlayer2;
        if (playersSwapped) {
            displayPlayer1 = gameState.player2;
            displayPlayer2 = gameState.player1;
        } else {
            displayPlayer1 = gameState.player1;
            displayPlayer2 = gameState.player2;
        }

        // Update main player names
        document.getElementById('tvRestBreakPlayer1').textContent = displayPlayer1.name;
        document.getElementById('tvRestBreakPlayer2').textContent = displayPlayer2.name;

        // Update partner names (show only for doubles)
        const partner1Element = document.getElementById('tvRestBreakPlayer1Partner');
        const partner2Element = document.getElementById('tvRestBreakPlayer2Partner');
        const isDoubles = gameState.isDoubles && displayPlayer1.name2 && displayPlayer2.name2;

        if (isDoubles) {
            partner1Element.textContent = displayPlayer1.name2;
            partner1Element.style.display = 'block';
            partner2Element.textContent = displayPlayer2.name2;
            partner2Element.style.display = 'block';
        } else {
            partner1Element.style.display = 'none';
            partner2Element.style.display = 'none';
        }

        // Update scores and games
        document.getElementById('tvRestBreakScore1').textContent = displayPlayer1.score;
        document.getElementById('tvRestBreakScore2').textContent = displayPlayer2.score;
        document.getElementById('tvRestBreakGames1').textContent = displayPlayer1.games;
        document.getElementById('tvRestBreakGames2').textContent = displayPlayer2.games;
    }

    // Change color based on time remaining
    if (secondsLeft <= 10) {
        timerDisplay.style.color = '#e94560';
    } else if (secondsLeft <= 30) {
        timerDisplay.style.color = '#FFA500';
    } else {
        timerDisplay.style.color = '#4CAF50';
    }

    overlay.style.display = 'flex';
}

function hideRestBreak() {
    const overlay = document.getElementById('tvRestBreakOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Helper function to format player names (includes partner if doubles)
function formatPlayerNames(playerName, playerName2) {
    if (playerName2 && playerName2.trim() !== '') {
        return `${playerName} / ${playerName2}`;
    }
    return playerName;
}

// Match finished display functions
function showMatchFinished(gameState, playersSwapped) {
    const overlay = document.getElementById('tvMatchFinishedOverlay');
    if (!overlay) return;

    // Determine display player names (consistent with TV positions)
    // Include partner names for doubles
    let displayPlayer1Name, displayPlayer1Name2, displayPlayer2Name, displayPlayer2Name2;
    if (playersSwapped) {
        displayPlayer1Name = gameState.player2.name;
        displayPlayer1Name2 = gameState.player2.name2;
        displayPlayer2Name = gameState.player1.name;
        displayPlayer2Name2 = gameState.player1.name2;
    } else {
        displayPlayer1Name = gameState.player1.name;
        displayPlayer1Name2 = gameState.player1.name2;
        displayPlayer2Name = gameState.player2.name;
        displayPlayer2Name2 = gameState.player2.name2;
    }

    // Display individual set scores with winner highlighted
    const setScoresContainer = document.getElementById('tvSetScoresContainer');
    if (setScoresContainer && gameState.setScoresHistory && gameState.setScoresHistory.length > 0) {
        const setScoresHtml = gameState.setScoresHistory.map((setData, index) => {
            let player1Name, player2Name, scoreText;

            // Handle both old format (string) and new format (object)
            if (typeof setData === 'string') {
                // Old format: just score like "21-15"
                // Use original display names for consistency (include partners)
                player1Name = formatPlayerNames(originalPlayer1Name || displayPlayer1Name,
                                               originalPlayer1Name2 || displayPlayer1Name2);
                player2Name = formatPlayerNames(originalPlayer2Name || displayPlayer2Name,
                                               originalPlayer2Name2 || displayPlayer2Name2);
                scoreText = setData;
            } else {
                // New format: object with player names and score (now includes partner names)
                // Map the stored names to original display positions
                const storedPlayer1Name = setData.player1Name;
                const storedPlayer2Name = setData.player2Name;
                const scores = setData.score.split('-').map(s => parseInt(s.trim()));

                // Check if stored names match original positions
                if (storedPlayer1Name === originalPlayer1Name) {
                    // Names are in original order
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2);
                    scoreText = setData.score;
                } else {
                    // Names were swapped when set was saved - swap score back
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2);
                    scoreText = `${scores[1]}-${scores[0]}`; // Reverse the score
                }
            }

            // Parse score (e.g., "21-15")
            const scores = scoreText.split('-').map(s => parseInt(s.trim()));
            const player1Won = scores[0] > scores[1];
            const winnerName = player1Won ? player1Name : player2Name;
            const winnerColor = '#4CAF50'; // Green for winner
            const loserColor = '#e94560'; // Red for loser

            return `
                <div style="margin: 20px 0; font-size: 1.1em;">
                    <div style="margin-bottom: 8px; color: #aaa;">Sæt ${index + 1}</div>
                    <div style="font-size: 1.3em;">
                        <span style="color: ${player1Won ? winnerColor : loserColor}; font-weight: ${player1Won ? 'bold' : 'normal'};">
                            ${player1Name}
                        </span>
                        <span style="color: #fff; margin: 0 15px; font-weight: bold;">
                            ${scoreText}
                        </span>
                        <span style="color: ${!player1Won ? winnerColor : loserColor}; font-weight: ${!player1Won ? 'bold' : 'normal'};">
                            ${player2Name}
                        </span>
                    </div>
                    <div style="color: ${winnerColor}; font-size: 0.9em; margin-top: 5px; font-weight: bold;">
                        ✓ ${winnerName}
                    </div>
                </div>
            `;
        }).join('');
        setScoresContainer.innerHTML = setScoresHtml;
    } else {
        setScoresContainer.innerHTML = '';
    }

    // Determine winner based on actual game state, then map to display names (include partners)
    const player1WonMatch = gameState.player1.games > gameState.player2.games;
    let winner;
    if (playersSwapped) {
        // When swapped: gameState.player1 -> displayPlayer2, gameState.player2 -> displayPlayer1
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer2Name, displayPlayer2Name2)
            : formatPlayerNames(displayPlayer1Name, displayPlayer1Name2);
    } else {
        // When not swapped: gameState.player1 -> displayPlayer1, gameState.player2 -> displayPlayer2
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer1Name, displayPlayer1Name2)
            : formatPlayerNames(displayPlayer2Name, displayPlayer2Name2);
    }
    document.getElementById('tvFinishedWinner').textContent = winner;

    overlay.style.display = 'flex';
}

function hideMatchFinished() {
    const overlay = document.getElementById('tvMatchFinishedOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (slideshowInterval) {
        clearInterval(slideshowInterval);
    }
});
