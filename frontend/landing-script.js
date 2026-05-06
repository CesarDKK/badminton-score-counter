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
        const courtVersion = settings.courtVersion || 'v2';
        const tvVersion = settings.tvVersion || 'v2';

        // Load buttons
        loadCourtButtons(courtCount, courtVersion);
        loadTVButtons(courtCount, tvVersion);

        // Hide loading state
        hideLoading();
    } catch (error) {
        console.error('Failed to load page:', error);
        showError('Kunne ikke indlæse baner. Tjek din forbindelse.');
    }
}

function loadCourtButtons(courtCount, courtVersion) {
    const courtButtons = document.getElementById('courtButtons');
    courtButtons.innerHTML = '';

    // Determine which court page to use based on version setting
    const courtPage = courtVersion === 'v3' ? 'court-v3.html' : 'court.html';

    for (let i = 1; i <= courtCount; i++) {
        const button = document.createElement('a');
        button.href = `${courtPage}?id=${i}`;
        button.className = 'court-button';
        button.innerHTML = `
            <div class="court-number">${i}</div>
            <div class="court-label">Bane</div>
        `;
        courtButtons.appendChild(button);
    }
}

function loadTVButtons(courtCount, tvVersion) {
    const tvButtons = document.getElementById('tvButtons');
    tvButtons.innerHTML = '';

    // Determine which TV page to use based on version setting
    const tvPage = tvVersion === 'v3' ? 'tv-v3.html' : 'tv.html';

    for (let i = 1; i <= courtCount; i++) {
        const button = document.createElement('a');
        button.href = `${tvPage}?id=${i}`;
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
    courtButtons.innerHTML = `<p style="text-align: center; color: var(--color-accent);">${message}</p>`;
}
