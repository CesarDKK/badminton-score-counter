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
            showError(err.message || 'Login mislykkedes');
            loginBtn.disabled = false;
            loginBtn.textContent = 'Log Ind';
            passwordInput.value = '';
            passwordInput.focus();
        }
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
    }

    loginBtn.addEventListener('click', handleLogin);
    // keydown (ikke det forældede keypress) saa Enter altid udloeser login —
    // keypress fyrer ikke paalideligt i alle browsere/password-managere.
    passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleLogin(); } });
    usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); passwordInput.focus(); } });
});
