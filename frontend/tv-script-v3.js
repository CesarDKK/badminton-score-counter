// TV Display Script V3 - Minimalist layout with set score boxes
const api = window.BadmintonAPI;

const urlParams = new URLSearchParams(window.location.search);
const courtId = parseInt(urlParams.get('id') || urlParams.get('court')) || 1;

let refreshInterval = null;
let slideshowInterval = null;
let screensaverAnimFrame = null;
let currentSlideIndex = 0;
let isShowingSlideshow = false;
let cachedSponsorImages = [];
let cachedCourtBanner = null;
let cachedSlideDuration = 10000;
let timerInterval = null;
let isMatchCurrentlyActive = false;
let wasMatchPreviouslyActive = false;
// Track original player names to keep consistent TV display
let originalPlayer1Name = null;
let originalPlayer1Name2 = null;
let originalPlayer2Name = null;
let originalPlayer2Name2 = null;
let matchStartTime = null;
let matchEndTime = null;
// Rest break timer tracking
let restBreakInterval = null;
let localRestBreakSecondsLeft = 0;
let isRestBreakActive = false;
let wasRestBreakActive = false; // Track previous rest break state
// Cache scores we see during gameplay as fallback until database history updates
let cachedSetScores = {
    team1: { set1: 0, set2: 0, set3: 0 },
    team2: { set1: 0, set2: 0, set3: 0 }
};
// QR counter — kun aktiv i klub-mode; vises når banen er ledig, gemmes når kampen starter
let qrCounterEnabled = false;
let qrCounterVisible = false;

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initializeTVDisplay();
    loadCourtData();
    startAutoRefresh();
    startLocalTimer();
    setInterval(refreshSponsorSettings, 10000);
});

async function initializeTVDisplay() {
    document.getElementById('courtNumber').textContent = courtId;

    // Spørg backend om QR-counter funktionen er tilgængelig (kun i klub-mode).
    // Ud over mode-flaget kan tokenet have slået QR fra via admin-siden;
    // det flag kommer med som &qr=0/1 på URL'en fra /t/:token redirect.
    const qrParam = urlParams.get('qr');
    const qrAllowedByToken = qrParam !== '0'; // default ON hvis param mangler (fx direkte TV-adgang)
    try {
        const modeResp = await fetch('/api/mode');
        const modeData = await modeResp.json();
        qrCounterEnabled = !!modeData.qrCounter && qrAllowedByToken;
    } catch (e) {
        qrCounterEnabled = false;
    }

    try {
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

        await refreshSponsorSettings();
    } catch (error) {
        console.error('Failed to initialize TV display:', error);
    }
}

function startAutoRefresh() {
    refreshInterval = setInterval(loadCourtData, 2000);
}

function startLocalTimer() {
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
        const startTime = new Date(matchStartTime);
        const endTime = matchEndTime ? new Date(matchEndTime) : new Date();
        const elapsedMs = endTime - startTime;
        elapsedSeconds = Math.floor(elapsedMs / 1000);
    }

    const hours = Math.floor(elapsedSeconds / 3600);
    const minutes = Math.floor((elapsedSeconds % 3600) / 60);
    const seconds = elapsedSeconds % 60;

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
        const gameState = await api.getGameState(courtId);

        const isMatchActive = gameState.isActive === true;

        // Check if there's any game activity OR if a serving player has been selected
        const hasGameActivity =
            gameState.player1.score > 0 ||
            gameState.player2.score > 0 ||
            gameState.player1.games > 0 ||
            gameState.player2.games > 0 ||
            gameState.timerSeconds > 0 ||
            gameState.servingPlayer != null ||  // Serving player selected (singles)
            gameState.servingTeam != null;      // Serving team selected (doubles)

        isMatchCurrentlyActive = isMatchActive && hasGameActivity;

        if (!isMatchActive) {
            matchStartTime = null;
            matchEndTime = null;
            isMatchCurrentlyActive = false;
            wasMatchPreviouslyActive = false;
            originalPlayer1Name = null;
            originalPlayer1Name2 = null;
            originalPlayer2Name = null;
            originalPlayer2Name2 = null;
            hideMatchFinished();
            hideRestBreak();
            showSponsorSlideshow();
            showQrCounter();
            return;
        }

        hideQrCounter();

        // Detect new match starting
        if (isMatchActive && !wasMatchPreviouslyActive) {
            console.log('[TV V3] New match detected - storing original player positions');

            // If set history exists, use it to determine the true original positions.
            // This handles the case where the TV page loads mid-match after sides have switched.
            const history = gameState.setScoresHistory;
            if (history && history.length > 0 && typeof history[0] === 'object' && history[0].player1Name) {
                originalPlayer1Name = history[0].player1Name;
                originalPlayer1Name2 = history[0].player1Name2 || null;
                originalPlayer2Name = history[0].player2Name;
                originalPlayer2Name2 = history[0].player2Name2 || null;
                console.log('[TV V3] Using set history for original positions:', originalPlayer1Name, 'vs', originalPlayer2Name);
            } else {
                originalPlayer1Name = gameState.player1.name;
                originalPlayer1Name2 = gameState.player1.name2 || null;
                originalPlayer2Name = gameState.player2.name;
                originalPlayer2Name2 = gameState.player2.name2 || null;
            }

            // Reset cached scores for new match
            cachedSetScores = {
                team1: { set1: 0, set2: 0, set3: 0 },
                team2: { set1: 0, set2: 0, set3: 0 }
            };

            // Reset rest break tracker
            wasRestBreakActive = false;

            if (window.loadTheme) {
                await window.loadTheme();
            }
            wasMatchPreviouslyActive = true;
        }

        hideSponsorSlideshow();

        // Check if players have been swapped
        const playersSwapped = originalPlayer1Name &&
                               gameState.player1.name === originalPlayer2Name;

        // Check if match is finished
        const matchFinished = gameState.player1.games >= 2 || gameState.player2.games >= 2;

        if (matchFinished) {
            showMatchFinished(gameState, playersSwapped);
            return;
        } else {
            hideMatchFinished();
        }

        // Check for rest break
        if (gameState.restBreakActive) {
            showRestBreak(gameState.restBreakSecondsLeft, gameState.restBreakTitle, gameState, playersSwapped);
        } else {
            hideRestBreak();
        }

        // Detect when rest break ends (timer disappears)
        // This is the perfect time to refresh data from database
        // because backend has finished saving setScoresHistory by then
        if (wasRestBreakActive && !gameState.restBreakActive) {
            console.log('[TV V3] Rest break ended. Refreshing data from database to get updated set scores...');

            // Immediately fetch fresh data from database
            setTimeout(async () => {
                try {
                    const freshGameState = await api.getGameState(courtId);
                    console.log(`[TV V3] Fresh data after rest break. setScoresHistory length: ${freshGameState.setScoresHistory?.length || 0}`);

                    // Re-determine swap status
                    const freshPlayersSwapped = originalPlayer1Name && freshGameState.player1.name === originalPlayer2Name;

                    // Update display with fresh data from database
                    updateSetScores(freshGameState, freshPlayersSwapped);
                } catch (error) {
                    console.error('[TV V3] Failed to refresh data after rest break:', error);
                }
            }, 100); // Small delay just to ensure database transaction is committed
        }

        // Track rest break state for next iteration
        wasRestBreakActive = gameState.restBreakActive;

        // Update display elements with v3 layout
        updatePlayerNames(gameState, playersSwapped);
        updateSetScores(gameState, playersSwapped);
        updateServingHighlight(gameState, playersSwapped);

        // Update match timing
        matchStartTime = gameState.matchStartTime;
        matchEndTime = gameState.matchEndTime;

        updateTimerDisplay();
        updateCourtBanner();
    } catch (error) {
        console.error('Failed to load court data:', error);
        showSponsorSlideshow();
    }
}

// Extract first name (before '/') for doubles display
function extractFirstName(fullName) {
    if (!fullName) return '';
    const parts = fullName.split('/');
    return parts[0].trim();
}

// For singles: fjern mellemnavne så lange navne ikke presser pointene ud.
// "Jens Peter Hansen-Olsen" → "Jens Hansen-Olsen"; "Jens Hansen" bevares.
function shortenSinglesName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 2) return fullName.trim();
    return `${parts[0]} ${parts[parts.length - 1]}`;
}

// Update player names display
function updatePlayerNames(gameState, playersSwapped) {
    const isDoubles = gameState.isDoubles || false;

    // Determine display players based on swap status
    let displayPlayer1, displayPlayer2;
    if (playersSwapped) {
        displayPlayer1 = gameState.player2;
        displayPlayer2 = gameState.player1;
    } else {
        displayPlayer1 = gameState.player1;
        displayPlayer2 = gameState.player2;
    }

    // Player 1
    const player1Name = displayPlayer1.name;
    const player1Name2 = displayPlayer1.name2;

    if (isDoubles && player1Name2) {
        // Extract first name (before '/')
        const firstName1 = extractFirstName(player1Name);
        const firstName2 = extractFirstName(player1Name2);

        document.getElementById('player1Name').textContent = firstName1;
        document.getElementById('player1Name2').textContent = firstName2;
        document.getElementById('player1Name2').style.display = 'block';
    } else {
        document.getElementById('player1Name').textContent = shortenSinglesName(player1Name);
        document.getElementById('player1Name2').style.display = 'none';
    }

    // Player 2
    const player2Name = displayPlayer2.name;
    const player2Name2 = displayPlayer2.name2;

    if (isDoubles && player2Name2) {
        const firstName1 = extractFirstName(player2Name);
        const firstName2 = extractFirstName(player2Name2);

        document.getElementById('player2Name').textContent = firstName1;
        document.getElementById('player2Name2').textContent = firstName2;
        document.getElementById('player2Name2').style.display = 'block';
    } else {
        document.getElementById('player2Name').textContent = shortenSinglesName(player2Name);
        document.getElementById('player2Name2').style.display = 'none';
    }
}

// Update set score boxes
function updateSetScores(gameState, playersSwapped) {
    const setHistory = gameState.setScoresHistory || [];
    const currentSetIndex = gameState.player1.games + gameState.player2.games;

    // Determine display players
    let displayPlayer1, displayPlayer2;
    if (playersSwapped) {
        displayPlayer1 = gameState.player2;
        displayPlayer2 = gameState.player1;
    } else {
        displayPlayer1 = gameState.player1;
        displayPlayer2 = gameState.player2;
    }

    // Update set boxes for both teams
    updateTeamSetBoxes('team1', displayPlayer1, setHistory, currentSetIndex, gameState, playersSwapped);
    updateTeamSetBoxes('team2', displayPlayer2, setHistory, currentSetIndex, gameState, playersSwapped);
}

function updateTeamSetBoxes(teamId, playerData, setHistory, currentSetIndex, gameState, playersSwapped) {
    // Determine which team we're displaying (1 or 2)
    const isTeam1 = teamId === 'team1';

    // Set 1
    const box1 = document.getElementById(`${teamId}Set1`);
    if (setHistory.length >= 1) {
        // Set 1 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set1Score = extractTeamScore(setHistory[0], isTeam1, gameState, playersSwapped);
        box1.textContent = set1Score;
        box1.className = 'set-box'; // Reset classes
        markSetResult(teamId, 1, setHistory[0], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 0) {
        // Set 1 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        // Cache maximum score we see (for fallback if history delayed)
        if (currentScore > cachedSetScores[teamId].set1) {
            cachedSetScores[teamId].set1 = currentScore;
        }
        box1.textContent = currentScore;
        box1.className = 'set-box current';
    } else {
        // Set 1 finished but history not updated yet - use cached score as fallback
        box1.textContent = cachedSetScores[teamId].set1 || '-';
        box1.className = 'set-box';
    }

    // Set 2
    const box2 = document.getElementById(`${teamId}Set2`);
    if (setHistory.length >= 2) {
        // Set 2 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set2Score = extractTeamScore(setHistory[1], isTeam1, gameState, playersSwapped);
        box2.textContent = set2Score;
        box2.className = 'set-box'; // Reset classes
        markSetResult(teamId, 2, setHistory[1], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 1) {
        // Set 2 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        if (currentScore > cachedSetScores[teamId].set2) {
            cachedSetScores[teamId].set2 = currentScore;
        }
        box2.textContent = currentScore;
        box2.className = 'set-box current';
    } else if (currentSetIndex >= 2) {
        // Set 2 finished but history not updated yet - use cached score as fallback
        box2.textContent = cachedSetScores[teamId].set2 || '-';
        box2.className = 'set-box';
    } else {
        // Not started yet
        box2.textContent = '-';
        box2.className = 'set-box';
    }

    // Set 3
    const box3 = document.getElementById(`${teamId}Set3`);
    if (setHistory.length >= 3) {
        // Set 3 is complete - show final score from history (AUTHORITATIVE SOURCE)
        const set3Score = extractTeamScore(setHistory[2], isTeam1, gameState, playersSwapped);
        box3.textContent = set3Score;
        box3.className = 'set-box'; // Reset classes
        markSetResult(teamId, 3, setHistory[2], isTeam1, gameState, playersSwapped);
    } else if (currentSetIndex === 2) {
        // Set 3 is current ongoing set - show and cache current score
        const currentScore = playerData.score;
        if (currentScore > cachedSetScores[teamId].set3) {
            cachedSetScores[teamId].set3 = currentScore;
        }
        box3.textContent = currentScore;
        box3.className = 'set-box current';
    } else {
        // Not started yet
        box3.textContent = '-';
        box3.className = 'set-box';
    }
}

function extractTeamScore(setData, isTeam1, gameState, playersSwapped) {
    let scoreText;

    if (typeof setData === 'string') {
        // Old format: "21-15"
        scoreText = setData;
    } else {
        // New format: object with player names and score
        const storedPlayer1Name = setData.player1Name;

        // Check if stored names match original positions
        if (storedPlayer1Name === originalPlayer1Name) {
            // Names are in original order
            scoreText = setData.score;
        } else {
            // Names were swapped when set was saved - swap score back
            const scores = setData.score.split('-').map(s => s.trim());
            scoreText = `${scores[1]}-${scores[0]}`;
        }
    }

    // Parse score and return appropriate team's score
    const scores = scoreText.split('-').map(s => parseInt(s.trim()));
    return isTeam1 ? scores[0] : scores[1];
}

function markSetResult(teamId, setNum, setData, isTeam1, gameState, playersSwapped) {
    const box = document.getElementById(`${teamId}Set${setNum}`);

    let scoreText;
    if (typeof setData === 'string') {
        scoreText = setData;
    } else {
        const storedPlayer1Name = setData.player1Name;
        if (storedPlayer1Name === originalPlayer1Name) {
            scoreText = setData.score;
        } else {
            const scores = setData.score.split('-').map(s => s.trim());
            scoreText = `${scores[1]}-${scores[0]}`;
        }
    }

    const scores = scoreText.split('-').map(s => parseInt(s.trim()));
    const team1Score = scores[0];
    const team2Score = scores[1];

    if (isTeam1) {
        if (team1Score > team2Score) {
            box.classList.add('won');
        } else {
            box.classList.add('lost');
        }
    } else {
        if (team2Score > team1Score) {
            box.classList.add('won');
        } else {
            box.classList.add('lost');
        }
    }
}

// Update serving team highlight
function updateServingHighlight(gameState, playersSwapped) {
    const team1Row = document.getElementById('team1Row');
    const team2Row = document.getElementById('team2Row');

    // Remove existing highlights
    team1Row.classList.remove('serving');
    team2Row.classList.remove('serving');

    // Determine serving team based on game type
    let servingTeam = null;

    if (gameState.isDoubles) {
        // For doubles: use servingTeam (which team is serving)
        servingTeam = gameState.servingTeam || gameState.serving_team;
    } else {
        // For singles: use servingPlayer (which player is serving, 1 or 2)
        // servingPlayer directly maps to team (player 1 = team 1, player 2 = team 2)
        servingTeam = gameState.servingPlayer || gameState.serving_player;
    }

    // Validate serving team
    if (!servingTeam || (servingTeam !== 1 && servingTeam !== 2)) {
        // No valid serving team - don't highlight anything
        console.log('[TV V3] No valid serving info. Doubles:', gameState.isDoubles, 'servingTeam:', gameState.servingTeam, 'servingPlayer:', gameState.servingPlayer);
        return;
    }

    // If players are swapped, swap the serving indicator for consistent TV display
    if (playersSwapped) {
        servingTeam = servingTeam === 1 ? 2 : 1;
    }

    console.log('[TV V3] Serving team:', servingTeam, 'Doubles:', gameState.isDoubles, 'Players swapped:', playersSwapped);

    // Add serving highlight to correct team
    if (servingTeam === 1) {
        team1Row.classList.add('serving');
    } else if (servingTeam === 2) {
        team2Row.classList.add('serving');
    }
}

// ========== SPONSOR AND BANNER FUNCTIONS (UNCHANGED FROM V2) ==========

async function refreshSponsorSettings() {
    try {
        // Check if TV version has changed - redirect if needed
        const appSettings = await api.getSettings();
        if (appSettings.tvVersion && appSettings.tvVersion !== 'v3') {
            window.location.href = `tv.html?id=${courtId}`;
            return;
        }

        const oldImages = cachedSponsorImages;
        const images = await api.getSponsorImages('slideshow');

        const imagesChanged = !oldImages ||
                             oldImages.length !== images.length ||
                             !oldImages.every((img, idx) => images[idx] && img.id === images[idx].id);

        cachedSponsorImages = images;

        const courtBanners = await api.getSponsorImages('court');
        const oldBanner = cachedCourtBanner;

        cachedCourtBanner = courtBanners.find(banner =>
            banner.assignedCourts && banner.assignedCourts.includes(courtId)
        ) || null;

        const bannerChanged = (!oldBanner && cachedCourtBanner) ||
                             (oldBanner && !cachedCourtBanner) ||
                             (oldBanner && cachedCourtBanner && oldBanner.id !== cachedCourtBanner.id);

        const settings = await api.getSponsorSettings();
        cachedSlideDuration = settings.slideDuration * 1000;

        if (imagesChanged && isShowingSlideshow) {
            console.log('Sponsor images changed, restarting slideshow');
            restartSlideshow();
        }

        if (bannerChanged && isMatchCurrentlyActive) {
            console.log('Court banner changed, updating footer');
            updateCourtBanner();
        }
    } catch (error) {
        console.error('Failed to refresh sponsor settings:', error);
    }
}

function updateCourtBanner() {
    const footer = document.querySelector('.tv-footer');
    if (!footer) return;

    const isMatchActive = !isShowingSlideshow;

    if (isMatchActive && cachedCourtBanner) {
        footer.classList.add('has-banner');
        footer.innerHTML = `
            <img src="/uploads/${cachedCourtBanner.filename}"
                 alt="Court Banner"
                 class="court-banner-image">
        `;
    } else {
        footer.classList.remove('has-banner');
        footer.innerHTML = `
            <div class="live-indicator">
                <span class="live-dot"></span>
                LIVE
            </div>
        `;
    }
}

function restartSlideshow() {
    if (slideshowInterval) {
        clearInterval(slideshowInterval);
        slideshowInterval = null;
    }
    isShowingSlideshow = false;
    currentSlideIndex = 0;
    showSponsorSlideshow();
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
        if (!isShowingSlideshow) {
            hideScoreboard();
            showDefaultMessage();
            isShowingSlideshow = true;
            updateCourtBanner();
        }
        return;
    }

    if (!isShowingSlideshow) {
        hideScoreboard();
        createSlideshowContainer();
        isShowingSlideshow = true;
        currentSlideIndex = 0;

        displayCurrentSlide(images);
        updateCourtBanner();

        if (images.length > 1) {
            const duration = getSlideDuration();
            slideshowInterval = setInterval(function() {
                const imgs = getSponsorImages();
                if (imgs.length > 1) {
                    currentSlideIndex = (currentSlideIndex + 1) % imgs.length;
                    displayCurrentSlide(imgs);
                }
            }, duration);
        }
    }
}

function hideSponsorSlideshow() {
    if (isShowingSlideshow) {
        if (slideshowInterval) {
            clearInterval(slideshowInterval);
            slideshowInterval = null;
        }

        stopScreensaver();

        const slideshowContainer = document.querySelector('.sponsor-slideshow');
        if (slideshowContainer) {
            slideshowContainer.remove();
        }

        showScoreboard();
        isShowingSlideshow = false;
        updateCourtBanner();
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
    const existing = document.querySelector('.sponsor-slideshow');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'sponsorSlideshowContainer';
    container.className = 'sponsor-slideshow active';
    document.querySelector('.tv-container').appendChild(container);
}

function displayCurrentSlide(images) {
    const container = document.getElementById('sponsorSlideshowContainer');
    if (!container || images.length === 0) return;

    const image = images[currentSlideIndex];

    container.innerHTML = `
        <img src="/uploads/${image.filename}"
             alt="${escapeHtml(image.original_name)}"
             class="sponsor-slide-image">
    `;
}

function showDefaultMessage() {
    const container = document.createElement('div');
    container.id = 'sponsorSlideshowContainer';
    container.className = 'sponsor-slideshow active';
    container.style.cssText = 'position: relative; overflow: hidden;';
    container.innerHTML = `
        <div class="screensaver-text" style="position: absolute; text-align: center; color: white; white-space: nowrap;">
            <div style="font-size: 6em; font-weight: 600; color: #aaa; letter-spacing: 0.05em; margin-bottom: 5px;">Ingen aktiv kamp</div>
            <div style="font-size: 16em; font-weight: bold; line-height: 1; color: white; letter-spacing: 0.02em;">BANE ${courtId}</div>
        </div>
    `;
    document.querySelector('.tv-container').appendChild(container);
    startScreensaver();
}

function startScreensaver() {
    stopScreensaver();

    let x = -1;
    let y = -1;
    let dx = 0;
    let dy = 0;
    let lastTime = null;

    function animate(timestamp) {
        const c = document.getElementById('sponsorSlideshowContainer');
        const t = c ? c.querySelector('.screensaver-text') : null;
        if (!c || !t) return;

        if (x < 0) {
            // Initialize once sizes are known
            const maxX = c.offsetWidth - t.offsetWidth;
            const maxY = c.offsetHeight - t.offsetHeight;
            x = Math.max(0, maxX / 2);
            y = Math.max(0, maxY / 2);
            const speed = 20; // px/s
            const angle = Math.random() * 2 * Math.PI;
            dx = Math.cos(angle) * speed;
            dy = Math.sin(angle) * speed;
            if (Math.abs(dx) < 6) dx = dx < 0 ? -6 : 6;
            if (Math.abs(dy) < 6) dy = dy < 0 ? -6 : 6;
        }

        if (!lastTime) lastTime = timestamp;
        const delta = Math.min((timestamp - lastTime) / 1000, 0.1);
        lastTime = timestamp;

        x += dx * delta;
        y += dy * delta;

        const maxX = Math.max(0, c.offsetWidth - t.offsetWidth);
        const maxY = Math.max(0, c.offsetHeight - t.offsetHeight);

        if (x <= 0) { x = 0; dx = Math.abs(dx); }
        if (x >= maxX) { x = maxX; dx = -Math.abs(dx); }
        if (y <= 0) { y = 0; dy = Math.abs(dy); }
        if (y >= maxY) { y = maxY; dy = -Math.abs(dy); }

        t.style.left = Math.round(x) + 'px';
        t.style.top = Math.round(y) + 'px';

        screensaverAnimFrame = requestAnimationFrame(animate);
    }

    screensaverAnimFrame = requestAnimationFrame(animate);
}

function stopScreensaver() {
    if (screensaverAnimFrame) {
        cancelAnimationFrame(screensaverAnimFrame);
        screensaverAnimFrame = null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== REST BREAK FUNCTIONS (UNCHANGED FROM V2) ==========

function showRestBreak(secondsLeft, title, gameState, playersSwapped) {
    const overlay = document.getElementById('tvRestBreakOverlay');
    const timerDisplay = document.getElementById('tvRestBreakTimer');
    const titleElement = document.getElementById('tvRestBreakTitle');

    if (!overlay) return;

    titleElement.textContent = title || 'Pause';

    const isNewRestBreak = !isRestBreakActive;

    if (isNewRestBreak) {
        localRestBreakSecondsLeft = secondsLeft || 0;
        isRestBreakActive = true;

        if (restBreakInterval) {
            clearInterval(restBreakInterval);
            restBreakInterval = null;
        }

        if (localRestBreakSecondsLeft > 0) {
            restBreakInterval = setInterval(() => {
                localRestBreakSecondsLeft--;
                if (localRestBreakSecondsLeft < 0) {
                    localRestBreakSecondsLeft = 0;
                }
                timerDisplay.textContent = localRestBreakSecondsLeft;

                if (localRestBreakSecondsLeft <= 10) {
                    timerDisplay.style.color = '#e94560';
                } else if (localRestBreakSecondsLeft <= 30) {
                    timerDisplay.style.color = '#FFA500';
                } else {
                    timerDisplay.style.color = '#4CAF50';
                }
            }, 1000);
        }
    }

    timerDisplay.textContent = localRestBreakSecondsLeft;

    if (localRestBreakSecondsLeft <= 10) {
        timerDisplay.style.color = '#e94560';
    } else if (localRestBreakSecondsLeft <= 30) {
        timerDisplay.style.color = '#FFA500';
    } else {
        timerDisplay.style.color = '#4CAF50';
    }

    if (gameState) {
        let displayPlayer1, displayPlayer2;
        if (playersSwapped) {
            displayPlayer1 = gameState.player2;
            displayPlayer2 = gameState.player1;
        } else {
            displayPlayer1 = gameState.player1;
            displayPlayer2 = gameState.player2;
        }

        document.getElementById('tvRestBreakPlayer1').textContent = displayPlayer1.name;
        document.getElementById('tvRestBreakPlayer2').textContent = displayPlayer2.name;

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

        document.getElementById('tvRestBreakScore1').textContent = displayPlayer1.score;
        document.getElementById('tvRestBreakScore2').textContent = displayPlayer2.score;
        document.getElementById('tvRestBreakGames1').textContent = displayPlayer1.games;
        document.getElementById('tvRestBreakGames2').textContent = displayPlayer2.games;
    }

    overlay.style.display = 'flex';
}

function hideRestBreak() {
    const overlay = document.getElementById('tvRestBreakOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    if (restBreakInterval) {
        clearInterval(restBreakInterval);
        restBreakInterval = null;
    }

    isRestBreakActive = false;
    localRestBreakSecondsLeft = 0;

    const timerDisplay = document.getElementById('tvRestBreakTimer');
    if (timerDisplay) {
        timerDisplay.style.color = '#4CAF50';
    }
}

// ========== MATCH FINISHED FUNCTIONS (UNCHANGED FROM V2) ==========

function formatPlayerNames(playerName, playerName2, isDoubles) {
    // Only show partner name if it's a doubles match AND partner name exists
    if (isDoubles && playerName2 && typeof playerName2 === 'string' && playerName2.trim() !== '') {
        return `${playerName} / ${playerName2}`;
    }
    return playerName;
}

function showMatchFinished(gameState, playersSwapped) {
    const overlay = document.getElementById('tvMatchFinishedOverlay');
    if (!overlay) return;

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

    const setScoresContainer = document.getElementById('tvSetScoresContainer');
    if (setScoresContainer && gameState.setScoresHistory && gameState.setScoresHistory.length > 0) {
        const setScoresHtml = gameState.setScoresHistory.map((setData, index) => {
            let player1Name, player2Name, scoreText;

            if (typeof setData === 'string') {
                player1Name = formatPlayerNames(originalPlayer1Name || displayPlayer1Name,
                                               originalPlayer1Name2 || displayPlayer1Name2,
                                               gameState.isDoubles);
                player2Name = formatPlayerNames(originalPlayer2Name || displayPlayer2Name,
                                               originalPlayer2Name2 || displayPlayer2Name2,
                                               gameState.isDoubles);
                scoreText = setData;
            } else {
                const storedPlayer1Name = setData.player1Name;
                const scores = setData.score.split('-').map(s => parseInt(s.trim()));

                if (storedPlayer1Name === originalPlayer1Name) {
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2, gameState.isDoubles);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2, gameState.isDoubles);
                    scoreText = setData.score;
                } else {
                    player1Name = formatPlayerNames(originalPlayer1Name, originalPlayer1Name2, gameState.isDoubles);
                    player2Name = formatPlayerNames(originalPlayer2Name, originalPlayer2Name2, gameState.isDoubles);
                    scoreText = `${scores[1]}-${scores[0]}`;
                }
            }

            const scores = scoreText.split('-').map(s => parseInt(s.trim()));
            const player1Won = scores[0] > scores[1];
            const winnerName = player1Won ? player1Name : player2Name;
            const winnerColor = '#4CAF50';
            const loserColor = '#e94560';

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
        const player1DisplayName = formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles);
        const player2DisplayName = formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles);

        let displayPlayer1Games, displayPlayer2Games;
        if (playersSwapped) {
            displayPlayer1Games = gameState.player2.games;
            displayPlayer2Games = gameState.player1.games;
        } else {
            displayPlayer1Games = gameState.player1.games;
            displayPlayer2Games = gameState.player2.games;
        }

        const player1WonMatch = displayPlayer1Games > displayPlayer2Games;
        const winnerColor = '#4CAF50';
        const loserColor = '#e94560';

        setScoresContainer.innerHTML = `
            <div style="margin: 30px 0; font-size: 1.3em;">
                <div style="margin-bottom: 15px; color: #aaa; font-size: 0.9em;">Resultat</div>
                <div style="font-size: 1.5em; display: flex; justify-content: center; align-items: center; gap: 30px;">
                    <span style="color: ${player1WonMatch ? winnerColor : loserColor}; font-weight: ${player1WonMatch ? 'bold' : 'normal'};">
                        ${player1DisplayName}
                    </span>
                    <span style="color: #fff; font-weight: bold; font-size: 1.2em;">
                        ${displayPlayer1Games} - ${displayPlayer2Games}
                    </span>
                    <span style="color: ${!player1WonMatch ? winnerColor : loserColor}; font-weight: ${!player1WonMatch ? 'bold' : 'normal'};">
                        ${player2DisplayName}
                    </span>
                </div>
            </div>
        `;
    }

    const player1WonMatch = gameState.player1.games > gameState.player2.games;
    let winner;
    if (playersSwapped) {
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles)
            : formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles);
    } else {
        winner = player1WonMatch
            ? formatPlayerNames(displayPlayer1Name, displayPlayer1Name2, gameState.isDoubles)
            : formatPlayerNames(displayPlayer2Name, displayPlayer2Name2, gameState.isDoubles);
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

// ========== QR COUNTER ==========

function showQrCounter() {
    if (!qrCounterEnabled) return;
    const container = document.getElementById('qrCounter');
    const img = document.getElementById('qrCounterImage');
    if (!container || !img) return;

    // Sæt kilden første gang banen går i idle — cache-busting via timestamp sikrer
    // at en ny token hentes efter invalidering (gamle billeder kan ellers blive i browser-cachen)
    if (!qrCounterVisible) {
        img.src = `/api/qr-code/${courtId}?t=${Date.now()}`;
        container.style.display = 'flex';
        qrCounterVisible = true;
    }
}

function hideQrCounter() {
    const container = document.getElementById('qrCounter');
    if (!container) return;
    if (qrCounterVisible) {
        container.style.display = 'none';
        qrCounterVisible = false;
    }
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshInterval) clearInterval(refreshInterval);
    if (slideshowInterval) clearInterval(slideshowInterval);
    stopScreensaver();
});
