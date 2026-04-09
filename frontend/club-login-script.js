const api = window.BadmintonAPI;

// Hvis allerede logget ind som klub admin — gå til redirect eller landing
if (api.isClubAdminSession()) {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect');
    window.location.href = redirect || '/landing.html';
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
            const params = new URLSearchParams(window.location.search);
            const redirect = params.get('redirect');
            window.location.href = redirect || '/landing.html';
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
    passwordInput.addEventListener('keypress', e => { if (e.key === 'Enter') handleLogin(); });
    usernameInput.addEventListener('keypress', e => { if (e.key === 'Enter') passwordInput.focus(); });
});
