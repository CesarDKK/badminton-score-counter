const api = window.BadmintonAPI;

// Open redirect-værn: accepter kun interne stier ("/..."), aldrig "//evil.dk"
// eller absolutte URL'er — ellers kan et phishing-link sende brugeren til et
// fremmed site EFTER korrekt login.
function safeRedirectTarget() {
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    if (redirect && redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/\\')) {
        return redirect;
    }
    return '/landing.html';
}

// Hvis allerede logget ind som klub admin — gå til redirect eller landing
if (api.isClubAdminSession()) {
    window.location.href = safeRedirectTarget();
}

document.addEventListener('DOMContentLoaded', function () {
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const errorMsg = document.getElementById('errorMsg');

    async function handleLogin() {
        const username = usernameInput.value.trim();
        const password = passwordInput.value;

        if (!username || !password) {
            showError('Udfyld venligst brugernavn og adgangskode');
            return;
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'Logger ind...';
        errorMsg.style.display = 'none';

        try {
            await api.loginAsClubAdmin(username, password);
            window.location.href = safeRedirectTarget();
        } catch (err) {
            showError(friendlyLoginError(err));
            loginBtn.disabled = false;
            loginBtn.textContent = 'Log Ind';
            passwordInput.value = '';
            passwordInput.focus();
        }
    }

    // Oversæt rå fejl til en brugervenlig besked: forkerte logins skal ikke
    // afsløre server-interne detaljer, og netværksfejl skal kunne skelnes.
    function friendlyLoginError(err) {
        const status = err && err.status;
        if (status === 401 || status === 403) {
            return 'Forkert brugernavn eller adgangskode';
        }
        if (status === 429) {
            return 'For mange forsøg. Vent et øjeblik, og prøv igen.';
        }
        if (status >= 500) {
            return 'Serverfejl. Prøv igen om lidt.';
        }
        if (err && (err.name === 'TypeError' || /fetch|network/i.test(err.message || ''))) {
            return 'Kunne ikke få forbindelse. Tjek din internetforbindelse.';
        }
        return 'Login mislykkedes. Prøv igen.';
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
    }

    // Et rigtigt <form> giver password managers og Enter-tasten native submit.
    loginForm.addEventListener('submit', e => { e.preventDefault(); handleLogin(); });
});
