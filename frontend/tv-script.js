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

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    await initializeTVDisplay();
    loadCourtData();
    startAutoRefresh();
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
    // Refresh every 1 second for real-time updates
    refreshInterval = setInterval(loadCourtData, 1000);
}

async function loadCourtData() {
    try {
        // Get game state from API
        const gameState = await api.getGameState(courtId);

        // Check if match is active
        const isMatchActive = gameState.isActive === true;

        if (!isMatchActive) {
            // No active match - show sponsor slideshow
            showSponsorSlideshow();
            return;
        }

        // Match is active - hide slideshow and show scores
        hideSponsorSlideshow();

        // Update display
        document.getElementById('player1Name').textContent = gameState.player1.name;
        document.getElementById('player2Name').textContent = gameState.player2.name;

        // Handle doubles mode
        const isDoubles = gameState.isDoubles || false;
        const player1Name2 = document.getElementById('player1Name2');
        const player2Name2 = document.getElementById('player2Name2');

        if (isDoubles && gameState.player1.name2 && gameState.player2.name2) {
            player1Name2.textContent = gameState.player1.name2;
            player2Name2.textContent = gameState.player2.name2;
            player1Name2.style.display = 'flex';
            player2Name2.style.display = 'flex';
        } else {
            player1Name2.style.display = 'none';
            player2Name2.style.display = 'none';
        }

        document.getElementById('player1Score').textContent = gameState.player1.score;
        document.getElementById('player2Score').textContent = gameState.player2.score;
        document.getElementById('player1Games').textContent = gameState.player1.games;
        document.getElementById('player2Games').textContent = gameState.player2.games;

        // Format timer
        const minutes = Math.floor(gameState.timerSeconds / 60);
        const seconds = gameState.timerSeconds % 60;
        document.getElementById('timerDisplay').textContent =
            `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
            <div class="sponsor-indicator">
                <span>${currentSlideIndex + 1} / ${images.length}</span>
            </div>
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

// Cleanup on page unload
window.addEventListener('beforeunload', function() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    if (slideshowInterval) {
        clearInterval(slideshowInterval);
    }
});
