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
        const courtCount = Number(settings.courtCount) || 0;

        // Ingen baner konfigureret — vis en forklarende tom-tilstand i stedet
        // for et tomt grid uden kontekst
        if (courtCount < 1) {
            showEmptyState();
            return;
        }

        // Load buttons
        loadCourtButtons(courtCount);
        loadTVButtons(courtCount);
    } catch (error) {
        console.error('Failed to load page:', error);
        showError();
    }
}

function loadCourtButtons(courtCount) {
    const courtButtons = document.getElementById('courtButtons');
    courtButtons.innerHTML = '';

    for (let i = 1; i <= courtCount; i++) {
        const button = document.createElement('a');
        button.href = `court-v3.html?id=${i}`;
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
        button.href = `tv-v3.html?id=${i}`;
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
    courtButtons.innerHTML = '<p class="landing-status" role="status">Indlæser...</p>';
    tvButtons.innerHTML = '<p class="landing-status" role="status">Indlæser...</p>';
}

// Fejl: ryd BEGGE sektioner (før hang TV-sektionen i evig "Indlæser...") og
// tilbyd en "Prøv igen"-knap i stedet for kun en statisk fejltekst.
function showError() {
    const courtButtons = document.getElementById('courtButtons');
    const tvButtons = document.getElementById('tvButtons');
    tvButtons.innerHTML = '';
    courtButtons.innerHTML = `
        <div class="landing-error" role="alert">
            <p>Kunne ikke indlæse baner. Tjek din forbindelse.</p>
            <button type="button" id="retryBtn" class="court-button landing-retry">Prøv igen</button>
        </div>
    `;
    const btn = document.getElementById('retryBtn');
    if (btn) btn.addEventListener('click', loadPage);
}

function showEmptyState() {
    const courtButtons = document.getElementById('courtButtons');
    const tvButtons = document.getElementById('tvButtons');
    tvButtons.innerHTML = '';
    courtButtons.innerHTML = `
        <p class="landing-status">Ingen baner konfigureret endnu. Opsæt antal baner i Admin Panel under Indstillinger.</p>
    `;
}
