// Landing page JavaScript
document.addEventListener('DOMContentLoaded', function() {
    loadCourtButtons();
    loadTVButtons();
});

function loadCourtButtons() {
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
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

function loadTVButtons() {
    const courtCount = parseInt(localStorage.getItem('courtCount') || '4');
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