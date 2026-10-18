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
    loadTabletAppInfo();
    loadTvBilleder();
}

// TV-skærmenes billeder (PC-USB og Raspberry Pi) ligger som GitHub-udgivelse
// (tag tv-usb-v…, lavet af .github/workflows/tv-usb.yml). De er ~700 MB — for
// store til /downloads/ bag Cloudflare. Udgivelsens filer udløber ikke; den
// nyeste tv-usb-udgivelse slås op her, så knapperne altid peger på den.
const TV_REPO = 'CesarDKK/badminton-score-counter';

async function loadTvBilleder() {
    const info = document.getElementById('tvBillederInfo');
    if (!info) return;
    try {
        const r = await fetch(`https://api.github.com/repos/${TV_REPO}/releases?per_page=20`, {
            headers: { Accept: 'application/vnd.github+json' }
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const udgivelse = (await r.json()).find(u => !u.draft && !u.prerelease && /^tv-usb-v/.test(u.tag_name));
        if (!udgivelse) throw new Error('ingen udgivelse');
        const fil = (re) => (udgivelse.assets || []).find(a => re.test(a.name));
        const mb = (a) => a ? ` (${Math.round(a.size / 1048576)} MB)` : '';
        const saet = (id, a, tekst) => {
            const el = document.getElementById(id);
            if (!el || !a) return;
            el.href = a.browser_download_url;
            el.removeAttribute('target');
            el.textContent = tekst + mb(a);
        };
        const zip = fil(/^badminton-tv-usb-.*\.zip$/), img = fil(/^badminton-tv-usb-.*\.img$/);
        saet('tvPcZip', zip, 'PC: USB-nøgle (zip)');
        saet('tvPiImg', fil(/^badminton-tv-pi-.*\.img\.xz$/), 'Raspberry Pi: SD-kort');
        const version = udgivelse.tag_name.replace(/^tv-usb-v/, '');
        const dato = udgivelse.published_at ? new Date(udgivelse.published_at).toLocaleDateString('da-DK') : '';
        info.textContent = `Version ${version}${dato ? ` · udgivet ${dato}` : ''}`;
        const ekstra = document.getElementById('tvBillederEkstra');
        if (ekstra) {
            const dele = [];
            if (img) dele.push(`<a href="${img.browser_download_url}" style="color:var(--color-accent);">PC som .img</a> (til balenaEtcher/Rufus)`);
            const sum = fil(/^SHA256SUMS/);
            if (sum) dele.push(`<a href="${sum.browser_download_url}" style="color:var(--color-accent);">kontrolsummer</a>`);
            dele.push(`<a href="${udgivelse.html_url}" target="_blank" rel="noopener" style="color:var(--color-accent);">alle filer og ændringer</a>`);
            ekstra.innerHTML = 'Også: ' + dele.join(' · ');
        }
    } catch {
        // GitHub tillader 60 opslag i timen pr. IP uden login — knapperne peger
        // så bare på udgivelsessiden, hvor filerne ligger
        info.textContent = 'Versionsoplysninger kunne ikke hentes — knapperne åbner udgivelsessiden på GitHub.';
    }
}

// Tablet-appen: version, størrelse og byggedato fra /downloads/badminton-app.json
// (skrives af android-app/build-apk.ps1 -Release sammen med selve APK'en).
async function loadTabletAppInfo() {
    const el = document.getElementById('tabletAppInfo');
    if (!el) return;
    try {
        // Cloudflare cacher /downloads/ i 4 timer uanset vores no-cache. Manifestet
        // hentes derfor med et tidsstempel (altid frisk), og hent-linket bærer
        // versionsnummeret, så en ny version er en ny adresse — tablets får aldrig
        // en gammel APK fra cachen.
        const r = await fetch(`/downloads/badminton-app.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const m = await r.json();
        const mb = m.sizeBytes ? (m.sizeBytes / 1048576).toFixed(1).replace('.', ',') + ' MB' : '';
        const dato = m.builtAt ? new Date(m.builtAt).toLocaleDateString('da-DK') : '';
        el.textContent = `Version ${m.version || '?'}${dato ? ` · bygget ${dato}` : ''}${mb ? ` · ${mb}` : ''}${m.minAndroid ? ` · kræver Android ${m.minAndroid} eller nyere` : ''}`;
        const link = document.getElementById('tabletAppDownload');
        if (link && (m.versionCode || m.version)) {
            link.href = `/downloads/${m.file || 'BadmintonApp.apk'}?v=${encodeURIComponent(m.versionCode || m.version)}`;
        }
    } catch {
        el.textContent = 'Versionsoplysninger kunne ikke hentes — knappen virker stadig.';
    }
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
    // keydown (ikke det forældede keypress) saa Enter altid udloeser login,
    // ogsaa naar felterne er udfyldt af en password manager.
    document.getElementById('adminPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleLogin();
        }
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

    // Game Mode
    document.getElementById('saveGameModeBtn').addEventListener('click', saveDefaultGameMode);

    // Backup
    document.getElementById('downloadBackupBtn').addEventListener('click', downloadBackup);
    document.getElementById('chooseRestoreFileBtn').addEventListener('click', () =>
        document.getElementById('restoreFileInput').click()
    );
    document.getElementById('restoreFileInput').addEventListener('change', onRestoreFileChosen);
    document.getElementById('restoreBtn').addEventListener('click', doRestore);

    // Ryd alle banedata (flyttet hertil fra Baneoversigten i admin.html)
    document.getElementById('clearAllDataBtn').addEventListener('click', clearAllData);

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

async function handleLogout() {
    // Klub-subdomæne: til klub-login (brugernavn + kode) i stedet for sidens eget kodeord-login
    if (await api.logoutTilLogin()) return;
    api.logout();
    document.getElementById('settingsDashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminPassword').value = '';
}

async function showSettingsDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('settingsDashboard').style.display = 'block';

    await loadSettings();
    loadAutoBackups();
}

async function loadSettings() {
    try {
        const settings = await api.getSettings();
        document.getElementById('courtCount').value = settings.courtCount;
        // Invert logic: checked = tournament mode ON (showResetButton false)
        document.getElementById('showResetButton').checked = settings.showResetButton === false;
        document.getElementById('hideTvQr').checked = settings.hideTvQr === true;
        document.getElementById('defaultGameMode').value = settings.defaultGameMode || '15';
    } catch (error) {
        console.error('Failed to load settings:', error);
        showMessage('Fejl', 'Kunne ikke indlæse indstillinger');
    }
}

async function saveCourtCount() {
    const courtCount = parseInt(document.getElementById('courtCount').value, 10);

    // isNaN-tjek først: uden det passerer et tomt/ugyldigt felt valideringen
    // (NaN < 1 og NaN > 20 er begge false) og sender NaN videre til serveren.
    if (isNaN(courtCount) || courtCount < 1 || courtCount > 20) {
        showMessage('Fejl', 'Antal baner skal være et tal mellem 1 og 20');
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
    const newPasswordConfirm = document.getElementById('newPasswordConfirm').value;
    const isClubAdmin = api.isClubAdminSession();

    if (!newPassword || newPassword.length < 8) {
        showMessage('Fejl', 'Adgangskode skal være mindst 8 tegn');
        return;
    }
    // Bekræftelsesfelt: fanger en tastefejl, så admin ikke låser sig selv ude
    if (newPassword !== newPasswordConfirm) {
        showMessage('Fejl', 'De to adgangskoder er ikke ens');
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
        document.getElementById('newPasswordConfirm').value = '';
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
            'Turneringstilstand aktiveret - kontrolknapperne er nu skjult på banesiden' :
            'Turneringstilstand deaktiveret - alle knapper er nu synlige');
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

// Hent en backup som fil i browseren (serveren navngiver filen)
async function hentBackupFil(url) {
    const token = api.token || sessionStorage.getItem('authToken');
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) {
        const fejl = await res.json().catch(() => ({}));
        throw new Error(fejl.error || res.statusText);
    }
    const blob = await res.blob();
    const match = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = match ? match[1] : 'backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
}

async function downloadBackup() {
    const btn = document.getElementById('downloadBackupBtn');
    btn.disabled = true;
    btn.textContent = 'Henter backup...';
    try {
        await hentBackupFil('/api/backup');
    } catch (err) {
        showMessage('Fejl', 'Backup fejlede: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Download backup';
    }
}

// ── Automatiske ugentlige backups (mandag kl. 02.00, de 4 nyeste gemmes) ──
// Lige før en gendannelse tager serveren en "før gendannelse"-backup af det
// nuværende, så en gendannelse kan fortrydes — den står også på listen.

const DK_DATO = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
const DK_KL = { hour: '2-digit', minute: '2-digit' };

function backupTidspunkt(iso) {
    const d = new Date(iso);
    const dato = d.toLocaleDateString('da-DK', DK_DATO);
    return `${dato.charAt(0).toUpperCase()}${dato.slice(1)} kl. ${d.toLocaleTimeString('da-DK', DK_KL)}`;
}

function backupStoerrelse(bytes) {
    return bytes >= 1048576
        ? `${(bytes / 1048576).toLocaleString('da-DK', { maximumFractionDigits: 1 })} MB`
        : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function loadAutoBackups() {
    const boks = document.getElementById('autoBackupBox');
    if (!boks) return;
    let data;
    try {
        data = await api.request('/backup/automatisk', {}, 1);
    } catch (err) {
        return; // fx ingen fuld adgang — knapperne giver selv besked
    }
    if (!data.aktiv) {
        document.getElementById('autoBackupDemo').style.display = 'block';
        return;
    }

    const naeste = data.naeste ? backupTidspunkt(data.naeste).toLowerCase() : null;
    document.getElementById('autoBackupInfo').textContent =
        `Der tages automatisk en backup hver mandag kl. 02.00, og de ${data.behold} nyeste gemmes.`
        + (naeste ? ` Næste: ${naeste}.` : '');
    document.getElementById('restoreAdvarsel').textContent =
        'Gendannelse overskriver alle nuværende data. Lige før gemmes en backup af det nuværende ("Før gendannelse"), så det kan fortrydes.';

    const liste = document.getElementById('autoBackupList');
    liste.innerHTML = '';
    if (!data.backups.length) {
        liste.innerHTML = '<p class="auto-backup-info">Ingen backups endnu — den første tages på mandag.</p>';
    }
    for (const b of data.backups) {
        const raekke = document.createElement('div');
        raekke.className = 'auto-backup-row';
        const type = b.type === 'auto' ? 'Ugentlig backup' : 'Før gendannelse';
        raekke.innerHTML = `
            <span class="auto-backup-hvornaar">${backupTidspunkt(b.tidspunkt)}
                <span class="auto-backup-type">${type} · ${backupStoerrelse(b.stoerrelse)}</span></span>
            <button class="btn-secondary" data-handling="hent">Download</button>
            <button class="btn-danger" data-handling="gendan">Gendan</button>`;
        raekke.querySelector('[data-handling="hent"]').addEventListener('click', async (e) => {
            e.target.disabled = true;
            try { await hentBackupFil(`/api/backup/automatisk/${encodeURIComponent(b.fil)}`); }
            catch (err) { showMessage('Fejl', 'Backuppen kunne ikke hentes: ' + err.message); }
            finally { e.target.disabled = false; }
        });
        raekke.querySelector('[data-handling="gendan"]').addEventListener('click', () => gendanAutoBackup(b));
        liste.appendChild(raekke);
    }
    boks.style.display = 'block';
}

async function gendanAutoBackup(b) {
    const ok = await showConfirmTekst(
        'Gendan backup?',
        `Alle klubbens nuværende data erstattes med backuppen fra ${backupTidspunkt(b.tidspunkt).toLowerCase()}. Skriv GENDAN for at fortsætte.`,
        'GENDAN',
        'Gendan'
    );
    if (!ok) return;
    showMessage('Gendanner...', 'Et øjeblik — klubbens data gendannes.');
    const okBtn = document.getElementById('messageOkBtn');
    okBtn.style.display = 'none';
    try {
        const data = await api.request(`/backup/automatisk/${encodeURIComponent(b.fil)}/gendan`,
            { method: 'POST', timeout: 120000 }, 1);
        okBtn.style.display = '';
        visGendannelsesResultat(data);
    } catch (err) {
        okBtn.style.display = '';
        showMessage('Fejl', 'Gendannelse fejlede: ' + err.message);
    }
}

function visGendannelsesResultat(data) {
    const rows = Object.entries(data.restored)
        .map(([t, n]) => `${t}: ${n} rækker`)
        .join('\n');
    const fortryd = data.foerGendannelse
        ? '\n\nDet, der var før, er gemt som "Før gendannelse" under Backup & Gendannelse.'
        : '';
    showMessage('Gendannelse fuldført', `Data er gendannet.\n\n${rows}\nBilleder: ${data.files}${fortryd}`, true);
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
    if (!await showConfirmTekst('Gendan fra fil?',
        `Alle klubbens nuværende data erstattes med indholdet af ${restoreFile.name}. Skriv GENDAN for at fortsætte.`,
        'GENDAN', 'Gendan')) return;

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

        visGendannelsesResultat(data);
    } catch (err) {
        showMessage('Fejl', 'Gendannelse fejlede: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Gendan nu';
    }
}

// Nulstiller knapperne efter en bekræftelse (showConfirm låner samme overlay)
function resetMessageButtons() {
    const okBtn = document.getElementById('messageOkBtn');
    okBtn.textContent = 'OK';
    okBtn.className = 'btn-primary';
    const cancelBtn = document.getElementById('messageCancelBtn');
    cancelBtn.style.display = 'none';
    cancelBtn.onclick = null;
}

// Bekræftelse med Annuller + en farlig knap. Giver true, hvis brugeren bekræfter.
function showConfirm(title, text, confirmLabel) {
    return new Promise(resolve => {
        document.getElementById('messageTitle').textContent = title;
        document.getElementById('messageText').textContent = text;
        const okBtn = document.getElementById('messageOkBtn');
        const cancelBtn = document.getElementById('messageCancelBtn');
        okBtn.textContent = confirmLabel;
        okBtn.className = 'btn-danger';
        cancelBtn.style.display = '';
        const done = answer => {
            hideMessage();
            resetMessageButtons();
            resolve(answer);
        };
        okBtn.onclick = () => done(true);
        cancelBtn.onclick = () => done(false);
        document.getElementById('messageOverlay').style.display = 'flex';
    });
}

// Bekræftelse, hvor brugeren skal skrive et ord (fx GENDAN), før den farlige
// knap virker. Giver true, hvis brugeren bekræfter.
async function showConfirmTekst(title, text, ord, confirmLabel) {
    const felt = document.createElement('input');
    felt.type = 'text';
    felt.className = 'bekraeft-tekst';
    felt.autocomplete = 'off';
    felt.setAttribute('aria-label', `Skriv ${ord}`);
    felt.placeholder = ord;
    document.getElementById('messageText').after(felt);
    const okBtn = document.getElementById('messageOkBtn');
    const tjek = () => { okBtn.disabled = felt.value.trim().toUpperCase() !== ord; };
    felt.addEventListener('input', tjek);
    const svar = showConfirm(title, text, confirmLabel);
    tjek();
    felt.focus();
    const ok = await svar;
    felt.remove();
    okBtn.disabled = false;
    return ok;
}

async function clearAllData() {
    if (!await showConfirm('Ryd alle banedata?',
        'Point og spiltilstand nulstilles på alle baner, og banerne sættes til single.', 'Ja, fortsæt')) return;
    if (!await showConfirm('Er du helt sikker?',
        'Igangværende kampe på alle baner bliver nulstillet. Det kan ikke fortrydes.', 'Ja, ryd alle baner')) return;

    const btn = document.getElementById('clearAllDataBtn');
    btn.disabled = true;
    try {
        const settings = await api.getSettings();
        const courtCount = settings.courtCount || 4;
        for (let i = 1; i <= courtCount; i++) {
            await api.resetGameState(i);
            await api.updateCourt(i, { isDoubles: false });
        }
        showMessage('Færdig', 'Alle baner er nulstillet og sat til single.');
    } catch (error) {
        console.error('Failed to clear all data:', error);
        showMessage('Fejl', 'Kunne ikke nulstille banerne. Tjek din forbindelse.');
    } finally {
        btn.disabled = false;
    }
}

function showMessage(title, text, requireReload = false) {
    const overlay = document.getElementById('messageOverlay');
    document.getElementById('messageTitle').textContent = title;
    document.getElementById('messageText').textContent = text;
    resetMessageButtons();

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
