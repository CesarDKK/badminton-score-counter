// Landing page JavaScript
const api = window.BadmintonAPI;

document.addEventListener('DOMContentLoaded', async function() {
    await loadPage();
});

async function loadPage() {
    try {
        // Show loading state
        showLoading();

        // Fetch settings from API
        const settings = await api.getSettings();
        const courtCount = settings.courtCount;

        // Load buttons
        loadCourtButtons(courtCount);
        loadTVButtons(courtCount);

        // Hide loading state
        hideLoading();
    } catch (error) {
        console.error('Failed to load page:', error);
        showError('Kunne ikke indlæse baner. Tjek din forbindelse.');
    }
}

function loadCourtButtons(courtCount) {
    const courtButtons = document.getElementById('courtButtons');
    courtButtons.innerHTML = '';

    for (let i = 1; i <= courtCount; i++) {
        const button = document.createElement('a');
        button.href = `court.html?id=${i}`;
        button.className = 'court-button';
        button.innerHTML = `
            <div class="court-number">${i}</div>
            <div class="court-label">Bane</div>
        `;
        courtButtons.appendChild(button);
    }
}

function loadTVButtons(courtCount) {
    const tvButtons = document.getElementById('tvButtons');
    tvButtons.innerHTML = '';

    for (let i = 1; i <= courtCount; i++) {
        const button = document.createElement('a');
        button.href = `tv.html?id=${i}`;
        button.className = 'tv-button';
        button.target = '_blank'; // Open in new window/tab
        button.innerHTML = `
            <div class="tv-icon">📺</div>
            <div class="tv-label">Bane ${i} TV</div>
        `;
        tvButtons.appendChild(button);
    }
}

function showLoading() {
    const courtButtons = document.getElementById('courtButtons');
    const tvButtons = document.getElementById('tvButtons');
    courtButtons.innerHTML = '<p style="text-align: center; color: #999;">Indlæser...</p>';
    tvButtons.innerHTML = '<p style="text-align: center; color: #999;">Indlæser...</p>';
}

function hideLoading() {
    // Loading elements are replaced by actual buttons
}

function showError(message) {
    const courtButtons = document.getElementById('courtButtons');
    courtButtons.innerHTML = `<p style="text-align: center; color: #e94560;">${message}</p>`;
}
