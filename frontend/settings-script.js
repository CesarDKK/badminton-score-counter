// Settings Page JavaScript
const api = window.BadmintonAPI;

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeSettings();
    setupEventListeners();
});

function initializeSettings() {
    if (api.token) {
        showSettingsDashboard();
    }
    showDeviceTokensNavIfClubAdmin();
}

async function showDeviceTokensNavIfClubAdmin() {
    try {
        const mode = await api.getMode();
        if (mode.mode === 'club' && api.isClubAdminSession()) {
            const btn = document.getElementById('deviceTokensNavBtn');
            if (btn) btn.style.display = 'inline-block';
            // Club admin: vis "nuværende adgangskode"-felt
            const wrap = document.getElementById('currentPasswordWrap');
            if (wrap) wrap.style.display = 'block';
        }
    } catch {}
}

function setupEventListeners() {
    // Login
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('adminPassword').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
    });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Court Count
    document.getElementById('saveCourtBtn').addEventListener('click', saveCourtCount);

    // Reset Button Toggle
    document.getElementById('showResetButton').addEventListener('change', toggleResetButton);

    // QR-kode på TV
    document.getElementById('hideTvQr').addEventListener('change', toggleTvQr);

    // Password
    document.getElementById('changePasswordBtn').addEventListener('click', changePassword);

    // Court Version
    document.getElementById('saveCourtVersionBtn').addEventListener('click', saveCourtVersion);

    // TV Version
    document.getElementById('saveTVVersionBtn').addEventListener('click', saveTVVersion);

    // Game Mode
    document.getElementById('saveGameModeBtn').addEventListener('click', saveDefaultGameMode);

    // Backup
    document.getElementById('downloadBackupBtn').addEventListener('click', downloadBackup);
    document.getElementById('chooseRestoreFileBtn').addEventListener('click', () =>
        document.getElementById('restoreFileInput').click()
    );
    document.getElementById('restoreFileInput').addEventListener('change', onRestoreFileChosen);
    document.getElementById('restoreBtn').addEventListener('click', doRestore);

    // Message overlay
    document.getElementById('messageOkBtn').addEventListener('click', hideMessage);
}

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        showMessage('Fejl', 'Indtast venligst en adgangskode!');
        return;
    }

    try {
        await api.login(password);
        showSettingsDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('Fejl', 'Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    api.logout();
    document.getElementById('settingsDashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminPassword').value = '';
}

async function showSettingsDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('settingsDashboard').style.display = 'block';

    await loadSettings();
}

async function loadSettings() {
    try {
        const settings = await api.getSettings();
        document.getElementById('courtCount').value = settings.courtCount;
        // Invert logic: checked = tournament mode ON (showResetButton false)
        document.getElementById('showResetButton').checked = settings.showResetButton === false;
        document.getElementById('hideTvQr').checked = settings.hideTvQr === true;
        document.getElementById('courtVersion').value = settings.courtVersion || 'v2';
        document.getElementById('tvVersion').value = settings.tvVersion || 'v2';
        document.getElementById('defaultGameMode').value = settings.defaultGameMode || '21';
    } catch (error) {
        console.error('Failed to load settings:', error);
        showMessage('Fejl', 'Kunne ikke indlæse indstillinger');
    }
}

async function saveCourtCount() {
    const courtCount = parseInt(document.getElementById('courtCount').value);

    if (courtCount < 1 || courtCount > 20) {
        showMessage('Fejl', 'Antal baner skal være mellem 1 og 20');
        return;
    }

    try {
        await api.updateCourtCount(courtCount);
        showMessage('Succes', 'Antal baner opdateret!');
    } catch (error) {
        console.error('Failed to update court count:', error);
        showMessage('Fejl', error.message);
    }
}

async function changePassword() {
    const newPassword = document.getElementById('newPassword').value;
    const isClubAdmin = api.isClubAdminSession();

    if (!newPassword || newPassword.length < 4) {
        showMessage('Fejl', 'Adgangskode skal være mindst 4 tegn');
        return;
    }

    try {
        if (isClubAdmin) {
            // Club-mode: skift klub-adminens adgangskode (kræver nuværende)
            const currentPassword = document.getElementById('currentPassword').value;
            if (!currentPassword) {
                showMessage('Fejl', 'Indtast venligst din nuværende adgangskode');
                return;
            }
            await api.changeClubAdminPassword(currentPassword, newPassword);
            document.getElementById('currentPassword').value = '';
        } else {
            // Lokal/direkte installation: skift simpel admin-adgangskode
            await api.updatePassword(newPassword);
        }
        showMessage('Succes', 'Adgangskode ændret!');
        document.getElementById('newPassword').value = '';
    } catch (error) {
        console.error('Failed to change password:', error);
        showMessage('Fejl', error.message);
    }
}

async function toggleResetButton() {
    const tournamentModeChecked = document.getElementById('showResetButton').checked;
    // Invert: checked = tournament mode ON, so send showResetButton = false
    const showResetButton = !tournamentModeChecked;

    try {
        await api.updateResetButtonVisibility(showResetButton);
        showMessage('Succes', tournamentModeChecked ?
            'Turnerings tilstand aktiveret - kontrol knapper er nu skjult på banesiden' :
            'Turnerings tilstand deaktiveret - alle knapper er nu synlige');
    } catch (error) {
        console.error('Failed to toggle reset button:', error);
        showMessage('Fejl', error.message);
        // Revert checkbox on error
        document.getElementById('showResetButton').checked = !tournamentModeChecked;
    }
}

async function toggleTvQr() {
    const hide = document.getElementById('hideTvQr').checked;
    try {
        await api.updateTvQrVisibility(hide);
        showMessage('Succes', hide
            ? 'QR-kode skjult på TV-siden'
            : 'QR-kode vises igen på TV-siden');
    } catch (error) {
        console.error('Failed to toggle TV QR:', error);
        showMessage('Fejl', error.message);
        document.getElementById('hideTvQr').checked = !hide;
    }
}

async function saveCourtVersion() {
    const courtVersion = document.getElementById('courtVersion').value;

    try {
        await api.updateCourtVersion(courtVersion);
        showMessage('Succes', `Bane version opdateret til ${courtVersion === 'v2' ? 'Klassisk' : 'Ny Version'}!`);
    } catch (error) {
        console.error('Failed to update court version:', error);
        showMessage('Fejl', error.message);
    }
}

async function saveTVVersion() {
    const tvVersion = document.getElementById('tvVersion').value;

    try {
        await api.updateTVVersion(tvVersion);
        const versionName = tvVersion === 'v2' ? 'Klassisk' : 'Minimalistisk';
        showMessage('Succes', `TV version opdateret til ${versionName}!`);
    } catch (error) {
        console.error('Failed to update TV version:', error);
        showMessage('Fejl', error.message);
    }
}

async function saveDefaultGameMode() {
    const gameMode = document.getElementById('defaultGameMode').value;
    try {
        await api.updateDefaultGameMode(gameMode);
        const label = gameMode === '21' ? '21/30 point' : '15/21 point';
        showMessage('Succes', `Standard kamptilstand sat til ${label}!`);
    } catch (error) {
        showMessage('Fejl', error.message);
    }
}

// ==================== BACKUP ====================

async function downloadBackup() {
    const btn = document.getElementById('downloadBackupBtn');
    btn.disabled = true;
    btn.textContent = 'Henter backup...';
    try {
        const token = api.token || sessionStorage.getItem('authToken');
        const res = await fetch('/api/backup', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());

        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : 'backup.json';

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        showMessage('Fejl', 'Backup fejlede: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Download Backup';
    }
}

let restoreFile = null;

function onRestoreFileChosen(e) {
    restoreFile = e.target.files[0] || null;
    const info = document.getElementById('restoreFileInfo');
    const btn = document.getElementById('restoreBtn');
    if (restoreFile) {
        const kb = (restoreFile.size / 1024).toFixed(1);
        info.textContent = `Valgt fil: ${restoreFile.name} (${kb} KB)`;
        info.style.display = 'block';
        btn.style.display = 'block';
    } else {
        info.style.display = 'none';
        btn.style.display = 'none';
    }
}

async function doRestore() {
    if (!restoreFile) return;
    if (!confirm('Er du sikker? Alle nuværende data vil blive overskrevet med data fra backup-filen. Denne handling kan ikke fortrydes.')) return;

    const btn = document.getElementById('restoreBtn');
    btn.disabled = true;
    btn.textContent = 'Gendanner...';
    try {
        const token = api.token || sessionStorage.getItem('authToken');
        const form = new FormData();
        form.append('backup', restoreFile);

        const res = await fetch('/api/backup/restore', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);

        const rows = Object.entries(data.restored)
            .map(([t, n]) => `${t}: ${n} rækker`)
            .join('\n');
        showMessage('Gendannelse fuldført', `Data er gendannet.\n\n${rows}\nBilleder: ${data.files}`, true);
    } catch (err) {
        showMessage('Fejl', 'Gendannelse fejlede: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Gendan Nu';
    }
}

function showMessage(title, text, requireReload = false) {
    const overlay = document.getElementById('messageOverlay');
    document.getElementById('messageTitle').textContent = title;
    document.getElementById('messageText').textContent = text;

    const okBtn = document.getElementById('messageOkBtn');
    okBtn.onclick = () => {
        hideMessage();
        if (requireReload) {
            location.reload();
        }
    };

    overlay.style.display = 'flex';
}

function hideMessage() {
    document.getElementById('messageOverlay').style.display = 'none';
}
