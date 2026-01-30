// Overview Page Script - Display all active matches
const api = window.BadmintonAPI;

let courtCount = 5;
let allCourtData = [];
let activeCourts = [];
let currentPage = 0;
const COURTS_PER_PAGE = 6;
const REFRESH_INTERVAL = 2000; // 2 seconds
const SCROLL_INTERVAL = 10000; // 10 seconds between page changes
let scrollTimer = null;
let refreshTimer = null;
let localTimerInterval = null;

// Store match start times for each court (courtId -> {matchStartTime, matchEndTime})
let courtMatchTimes = {};

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initialize();
    startAutoRefresh();
    startAutoScroll();
    startLocalTimers();
});

async function initialize() {
    try {
        // Get court count from settings
        const settings = await api.getSettings();
        courtCount = settings.courtCount || 5;

        await loadAllCourts();
    } catch (error) {
        console.error('Failed to initialize overview:', error);
        hideLoading();
    }
}

async function loadAllCourts() {
    try {
        const courtPromises = [];

        // Fetch all court data in parallel
        for (let i = 1; i <= courtCount; i++) {
            courtPromises.push(loadCourtData(i));
        }

        allCourtData = await Promise.all(courtPromises);

        // Filter only active courts with actual game activity
        activeCourts = allCourtData.filter(court => {
            if (!court.isActive) return false;

            // Check if there's actual game activity (scoring has started)
            const hasGameActivity =
                court.player1.score > 0 ||
                court.player2.score > 0 ||
                court.player1.games > 0 ||
                court.player2.games > 0 ||
                court.timerSeconds > 0;

            // Store match timing from database
            if (hasGameActivity) {
                courtMatchTimes[court.courtId] = {
                    matchStartTime: court.matchStartTime,
                    matchEndTime: court.matchEndTime
                };
            } else {
                // Remove match times if court becomes inactive
                delete courtMatchTimes[court.courtId];
            }

            return hasGameActivity;
        });

        hideLoading();
        displayCurrentPage();
    } catch (error) {
        console.error('Failed to load courts:', error);
        hideLoading();
    }
}

async function loadCourtData(courtId) {
    try {
        const gameState = await api.getGameState(courtId);

        // Add court ID to the game state
        gameState.courtId = courtId;

        // Fetch court banner if court type
        const courtBanners = await api.getSponsorImages('court');
        const banner = courtBanners.find(b =>
            b.assignedCourts && b.assignedCourts.includes(courtId)
        );
        gameState.courtBanner = banner || null;

        return gameState;
    } catch (error) {
        console.error(`Failed to load court ${courtId}:`, error);
        return {
            courtId: courtId,
            isActive: false,
            player1: { name: 'N/A', score: 0, games: 0 },
            player2: { name: 'N/A', score: 0, games: 0 },
            timerSeconds: 0
        };
    }
}

function displayCurrentPage() {
    const grid = document.getElementById('courtsGrid');
    const noMatchesMsg = document.getElementById('noMatchesMessage');
    const pageIndicator = document.getElementById('pageIndicator');
    const pageInfo = document.getElementById('pageInfo');

    if (activeCourts.length === 0) {
        grid.style.display = 'none';
        noMatchesMsg.style.display = 'block';
        pageIndicator.style.display = 'none';
        return;
    }

    noMatchesMsg.style.display = 'none';
    grid.style.display = 'grid';

    // Calculate total pages
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);

    // Update page indicator
    if (totalPages > 1) {
        pageIndicator.style.display = 'block';
        pageInfo.textContent = `Side ${currentPage + 1} af ${totalPages}`;
    } else {
        pageIndicator.style.display = 'none';
    }

    // Calculate which courts to show on current page
    const startIndex = currentPage * COURTS_PER_PAGE;
    const endIndex = startIndex + COURTS_PER_PAGE;
    const courtsToShow = activeCourts.slice(startIndex, endIndex);

    // Render courts
    grid.innerHTML = courtsToShow.map(court => renderCourtCard(court)).join('');
}

function renderCourtCard(court) {
    const isDoubles = court.isDoubles || false;

    // Calculate elapsed time from matchStartTime (same as TV display)
    const timerSeconds = calculateElapsedTime(court.courtId);

    // Format timer
    const timerDisplay = formatTimer(timerSeconds);

    // Render player names (including doubles partner if applicable)
    const player1Names = isDoubles && court.player1.name2
        ? `<div class="player-name">${escapeHtml(court.player1.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player1.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player1.name)}</div>`;

    const player2Names = isDoubles && court.player2.name2
        ? `<div class="player-name">${escapeHtml(court.player2.name)}</div>
           <div class="player-name-partner">${escapeHtml(court.player2.name2)}</div>`
        : `<div class="player-name">${escapeHtml(court.player2.name)}</div>`;

    // Rest break badge
    const restBreakBadge = court.restBreakActive
        ? `<div class="rest-break-badge">PAUSE ${court.restBreakSecondsLeft}s</div>`
        : '';

    // Court banner
    const bannerHtml = court.courtBanner
        ? `<div class="court-card-footer">
               <img src="/uploads/${court.courtBanner.filename}"
                    alt="Court Banner"
                    class="court-banner-small">
           </div>`
        : '';

    return `
        <div class="court-card" data-court-id="${court.courtId}">
            ${restBreakBadge}
            <div class="court-card-header">
                <div class="court-number">BANE ${court.courtId}</div>
                <div class="court-timer" id="timer-${court.courtId}">${timerDisplay}</div>
            </div>

            <div class="court-players">
                <div class="player-row">
                    <div class="player-info">
                        ${player1Names}
                    </div>
                    <div class="player-stats">
                        <div class="player-score">${court.player1.score}</div>
                        <div class="player-games">
                            <span class="games-label">Sæt:</span>
                            <span class="games-value">${court.player1.games}</span>
                        </div>
                    </div>
                </div>

                <div class="vs-divider">VS</div>

                <div class="player-row">
                    <div class="player-info">
                        ${player2Names}
                    </div>
                    <div class="player-stats">
                        <div class="player-score">${court.player2.score}</div>
                        <div class="player-games">
                            <span class="games-label">Sæt:</span>
                            <span class="games-value">${court.player2.games}</span>
                        </div>
                    </div>
                </div>
            </div>

            ${bannerHtml}
        </div>
    `;
}

function calculateElapsedTime(courtId) {
    const matchTimes = courtMatchTimes[courtId];

    if (!matchTimes || !matchTimes.matchStartTime) {
        return 0;
    }

    // Calculate elapsed time from server timestamp (same as TV display)
    const startTime = new Date(matchTimes.matchStartTime);
    const endTime = matchTimes.matchEndTime ? new Date(matchTimes.matchEndTime) : new Date();
    const elapsedMs = endTime - startTime;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    return Math.max(0, elapsedSeconds);
}

function formatTimer(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    } else {
        return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function hideLoading() {
    const loadingIndicator = document.getElementById('loadingIndicator');
    loadingIndicator.style.display = 'none';
}

function startAutoRefresh() {
    // Refresh court data every 2 seconds
    refreshTimer = setInterval(async () => {
        await loadAllCourts();
    }, REFRESH_INTERVAL);
}

function startAutoScroll() {
    // Auto-scroll to next page every 10 seconds if there are more than 6 active courts
    scrollTimer = setInterval(() => {
        if (activeCourts.length > COURTS_PER_PAGE) {
            nextPage();
        }
    }, SCROLL_INTERVAL);
}

function startLocalTimers() {
    // Update timer displays every second based on matchStartTime
    localTimerInterval = setInterval(() => {
        updateTimerDisplays();
    }, 1000);
}

function updateTimerDisplays() {
    // Update only the timer elements for visible courts
    for (const courtId in courtMatchTimes) {
        const timerElement = document.getElementById(`timer-${courtId}`);
        if (timerElement) {
            const elapsedSeconds = calculateElapsedTime(courtId);
            timerElement.textContent = formatTimer(elapsedSeconds);
        }
    }
}

function nextPage() {
    const totalPages = Math.ceil(activeCourts.length / COURTS_PER_PAGE);

    // Move to next page, wrap around to 0 if at end
    currentPage = (currentPage + 1) % totalPages;

    // Display new page immediately without animation
    displayCurrentPage();
}

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshTimer) clearInterval(refreshTimer);
    if (scrollTimer) clearInterval(scrollTimer);
    if (localTimerInterval) clearInterval(localTimerInterval);
});
