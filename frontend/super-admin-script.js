const api = window.BadmintonAPI;
let clubs = [];
let selectedClubId = null;
let currentAdmins = []; // klub-admins vist i admin-modalen (til opslag ved redigering af adgang)

// De Admin-sider der kan til-/fravælges pr. klub-admin. Nøgler matcher
// data-page i admin.html og VALID_PAGE_KEYS i backend/routes/superAdmin.js.
const PAGE_OPTIONS = [
    { key: 'holdkamp',   label: 'Holdkamp' },
    { key: 'tournament', label: 'Turnering' },
    { key: 'history',    label: 'Kamphistorik' },
    { key: 'playerinfo', label: 'Spiller info' },
    { key: 'settings',   label: 'Indstillinger' },
    { key: 'sponsors',   label: 'Sponsorer' },
    { key: 'devicetokens', label: 'Adgangslinks' }
];

// Bygger HTML for et rettigheds-vaelger-saet. permissions = null betyder alle sider.
// De enkelte sider er altid synlige; "Alle sider" er blot en vælg-alle-knap.
function permissionCheckboxesHtml(idPrefix, permissions) {
    const all = permissions === null || permissions === undefined;
    const allowed = new Set(all ? PAGE_OPTIONS.map(p => p.key) : permissions);
    const rows = PAGE_OPTIONS.map(p => `
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;color:#eaeaea;cursor:pointer;">
            <input type="checkbox" class="${idPrefix}-page" value="${p.key}" ${allowed.has(p.key) ? 'checked' : ''} onchange="syncPermAll('${idPrefix}')">
            ${p.label}
        </label>`).join('');
    return `
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;color:#eaeaea;cursor:pointer;margin-bottom:8px;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
            <input type="checkbox" id="${idPrefix}-all" ${all ? 'checked' : ''} onchange="togglePermAll('${idPrefix}')">
            Alle sider
        </label>
        <div id="${idPrefix}-list" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;padding-left:6px;">
            ${rows}
        </div>`;
}

// "Alle sider" som vælg-alle: sætter alle enkeltbokse til samme tilstand.
function togglePermAll(idPrefix) {
    const allEl = document.getElementById(`${idPrefix}-all`);
    if (!allEl) return;
    document.querySelectorAll(`.${idPrefix}-page`).forEach(c => { c.checked = allEl.checked; });
}

// Når en enkeltboks ændres: hold "Alle sider" markeret kun hvis alle er valgt.
function syncPermAll(idPrefix) {
    const allEl = document.getElementById(`${idPrefix}-all`);
    if (!allEl) return;
    const checks = Array.from(document.querySelectorAll(`.${idPrefix}-page`));
    allEl.checked = checks.length > 0 && checks.every(c => c.checked);
}

// Læser valget: null = alle sider (= fuld adgang), ellers array af valgte side-nøgler.
function readPermissionSelection(idPrefix) {
    const checks = Array.from(document.querySelectorAll(`.${idPrefix}-page`));
    const selected = checks.filter(c => c.checked).map(c => c.value);
    if (selected.length === PAGE_OPTIONS.length) return null;
    return selected;
}

// Kort tekst-resumé af en admins adgang til visning i listen.
function permissionsSummary(permissions) {
    if (permissions === null || permissions === undefined) return 'Alle sider';
    if (permissions.length === 0) return 'Ingen sider';
    return permissions
        .map(k => (PAGE_OPTIONS.find(p => p.key === k) || {}).label || k)
        .join(', ');
}

// Football-state — adskilt fra badminton-state så vi ikke krydsforurener
let footballClubs = [];
let selectedFootballClubId = null;
let pendingDeleteFootballClubId = null;
let pendingDeleteFootballAdminId = null;
let activeApp = 'badminton'; // 'badminton' | 'football'

document.addEventListener('DOMContentLoaded', function () {
    // Hvis allerede logget ind som super admin
    if (api.isSuperAdminSession()) {
        showDashboard();
    }

    // Login
    document.getElementById('saLoginBtn').addEventListener('click', handleLogin);
    // keydown (ikke det forældede keypress) saa Enter altid udloeser login.
    document.getElementById('saPassword').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleLogin(); } });
    document.getElementById('saUsername').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('saPassword').focus(); } });

    // Logout
    document.getElementById('saLogoutBtn').addEventListener('click', handleLogout);

    // Opret klub
    document.getElementById('createClubBtn').addEventListener('click', handleCreateClub);

    // Opdater klubber
    document.getElementById('refreshClubsBtn').addEventListener('click', loadClubs);

    // Klub-logoer
    document.getElementById('uploadLogoBtn').addEventListener('click', handleUploadLogo);
    document.getElementById('refreshLogosBtn').addEventListener('click', loadLogos);

    // Admin modal
    document.getElementById('adminModalClose').addEventListener('click', closeModal);
    document.getElementById('createAdminBtn').addEventListener('click', handleCreateAdmin);

    // Slet klub-modal
    document.getElementById('deleteCancelBtn').addEventListener('click', closeDeleteModal);
    document.getElementById('deleteConfirmBtn').addEventListener('click', confirmDeleteClub);
    document.getElementById('deleteConfirmInput').addEventListener('input', function () {
        document.getElementById('deleteConfirmBtn').disabled = this.value !== 'SLET';
    });

    // Slet admin-modal
    document.getElementById('deleteAdminCancelBtn').addEventListener('click', closeDeleteAdminModal);
    document.getElementById('deleteAdminConfirmBtn').addEventListener('click', confirmDeleteAdmin);

    // Skift adgangskode
    document.getElementById('changePasswordBtn').addEventListener('click', handleChangeSuperAdminPassword);

    // App-tabs (Badminton / Football)
    document.getElementById('tabBadminton').addEventListener('click', () => switchApp('badminton'));
    document.getElementById('tabFootball').addEventListener('click', () => switchApp('football'));

    // Football-flow
    document.getElementById('createFootballClubBtn').addEventListener('click', handleCreateFootballClub);
    document.getElementById('refreshFootballClubsBtn').addEventListener('click', loadFootballClubs);
    document.getElementById('footballAdminModalClose').addEventListener('click', closeFootballAdminModal);
    document.getElementById('createFootballAdminBtn').addEventListener('click', handleCreateFootballAdmin);

    // Auto-route based on hash so admin.footballapp.dk eller #football opens Football tab
    const hostHasFootball = window.location.host.includes('footballapp.dk');
    const hashWantsFootball = window.location.hash === '#football';
    if (hostHasFootball || hashWantsFootball) activeApp = 'football';
});

async function handleLogin() {
    const username = document.getElementById('saUsername').value.trim();
    const password = document.getElementById('saPassword').value;
    const btn = document.getElementById('saLoginBtn');
    const errEl = document.getElementById('loginError');

    if (!username || !password) {
        showMsg(errEl, 'Udfyld brugernavn og adgangskode', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Logger ind...';
    errEl.style.display = 'none';

    try {
        await api.loginAsSuperAdmin(username, password);
        showDashboard();
    } catch (err) {
        showMsg(errEl, err.message || 'Login mislykkedes', 'error');
        btn.disabled = false;
        btn.textContent = 'Log Ind';
        document.getElementById('saPassword').value = '';
    }
}

function handleLogout() {
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('superAdminToken');
    window.location.reload();
}

function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    switchApp(activeApp);
}

function switchApp(app) {
    activeApp = app;
    const isBadminton = app === 'badminton';

    document.getElementById('badmintonSection').style.display = isBadminton ? 'block' : 'none';
    document.getElementById('footballSection').style.display = isBadminton ? 'none' : 'block';

    document.getElementById('tabBadminton').classList.toggle('app-tab-active', isBadminton);
    document.getElementById('tabFootball').classList.toggle('app-tab-active', !isBadminton);

    if (isBadminton) {
        loadClubs();
        loadLogos();
    } else {
        loadFootballClubs();
    }
}

async function loadClubs() {
    const listEl = document.getElementById('clubList');
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

    try {
        clubs = await api.getSuperAdminClubs();
        renderClubs();
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${err.message}</div>`;
    }
}

function renderClubs() {
    const listEl = document.getElementById('clubList');

    if (clubs.length === 0) {
        listEl.innerHTML = '<div class="empty-state">Ingen klubber endnu — opret den første ovenfor</div>';
        return;
    }

    listEl.innerHTML = '<div class="club-list">' + clubs.map(club => `
        <div class="club-item" id="club-${club.id}">
            <div class="club-info">
                <div class="club-name">${escapeHtml(club.name)}</div>
                <div class="club-meta">
                    <span>🌐 ${escapeHtml(club.subdomain)}</span>
                    <span>🗄️ ${escapeHtml(club.db_name)}</span>
                    <span>📅 ${formatDate(club.created_at)}</span>
                </div>
            </div>
            <div class="club-actions">
                <span class="badge ${club.is_active ? 'badge-active' : 'badge-inactive'}">
                    ${club.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
                <button class="btn-secondary" onclick="openAdminModal(${club.id}, '${escapeHtml(club.name)}')">
                    Admins
                </button>
                <button class="btn-secondary" onclick="downloadClubBackup(${club.id}, '${escapeHtml(club.subdomain)}')">
                    Backup
                </button>
                <button class="btn-secondary" onclick="triggerClubRestore(${club.id})">
                    Gendan
                </button>
                <button class="btn-danger" onclick="handleToggleClub(${club.id})">
                    ${club.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
                ${!club.is_active ? `
                <button class="btn-danger" style="background:rgba(233,69,96,0.3);border-color:rgba(233,69,96,0.5);"
                    onclick="handleDeleteClub(${club.id}, '${escapeHtml(club.name)}')">
                    🗑 Slet
                </button>` : ''}
            </div>
        </div>
    `).join('') + '</div>';
}

async function handleCreateClub() {
    const name = document.getElementById('newClubName').value.trim();
    const subdomain = document.getElementById('newClubSubdomain').value.trim().toLowerCase();
    const btn = document.getElementById('createClubBtn');
    const msgEl = document.getElementById('createClubMsg');

    if (!name || !subdomain) {
        showMsg(msgEl, 'Udfyld navn og subdomain', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    msgEl.style.display = 'none';

    try {
        const club = await api.createClub(name, subdomain);
        clubs.unshift(club);
        renderClubs();
        document.getElementById('newClubName').value = '';
        document.getElementById('newClubSubdomain').value = '';
        showMsg(msgEl, `✓ ${club.name} er oprettet (${club.subdomain}.badmintonapp.dk)`, 'success');
    } catch (err) {
        showMsg(msgEl, err.message || 'Oprettelse mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Opret Klub';
    }
}

let pendingDeleteId = null;

function handleDeleteClub(id, name) {
    pendingDeleteId = id;
    document.getElementById('deleteModalText').textContent =
        `Du er ved at slette klubben "${name}" permanent. Denne handling kan ikke fortrydes.`;
    document.getElementById('deleteConfirmInput').value = '';
    document.getElementById('deleteConfirmBtn').disabled = true;
    document.getElementById('deleteModalMsg').style.display = 'none';
    document.getElementById('deleteModal').style.display = 'flex';
    document.getElementById('deleteConfirmInput').focus();
}

function closeDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    pendingDeleteId = null;
}

async function confirmDeleteClub() {
    if (!pendingDeleteId) return;
    const btn = document.getElementById('deleteConfirmBtn');
    const msgEl = document.getElementById('deleteModalMsg');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
        await api.deleteClub(pendingDeleteId);
        clubs = clubs.filter(c => c.id !== pendingDeleteId);
        closeDeleteModal();
        renderClubs();
    } catch (err) {
        showMsg(msgEl, err.message || 'Sletning mislykkedes', 'error');
        btn.disabled = false;
        btn.textContent = 'Slet klub permanent';
    }
}

async function handleToggleClub(id) {
    try {
        const result = await api.toggleClub(id);
        const club = clubs.find(c => c.id === id);
        if (club) club.is_active = result.is_active;
        renderClubs();
    } catch (err) {
        alert('Fejl: ' + err.message);
    }
}

function openAdminModal(clubId, clubName) {
    selectedClubId = clubId;
    document.getElementById('adminModalTitle').textContent = `Admins — ${clubName}`;
    document.getElementById('newAdminUsername').value = '';
    document.getElementById('newAdminPassword').value = '';
    document.getElementById('newAdminEmail').value = '';
    document.getElementById('newAdminPermissions').innerHTML = permissionCheckboxesHtml('newAdminPerm', null);
    document.getElementById('createAdminMsg').style.display = 'none';
    document.getElementById('adminModal').style.display = 'flex';
    loadAdmins();
}

async function loadAdmins() {
    const listEl = document.getElementById('adminModalList');
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const admins = await api.getClubAdmins(selectedClubId);
        renderAdmins(admins);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${err.message}</div>`;
    }
}

function renderAdmins(admins) {
    currentAdmins = admins;
    const listEl = document.getElementById('adminModalList');
    if (admins.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen admins endnu</div>';
        return;
    }
    listEl.innerHTML = admins.map(a => `
        <div class="admin-item" id="admin-row-${a.id}">
            <div>
                <div class="admin-name">${escapeHtml(a.username)}</div>
                ${a.email ? `<div class="admin-email">${escapeHtml(a.email)}</div>` : ''}
                <div class="admin-email" style="opacity:0.8;">Adgang: ${escapeHtml(permissionsSummary(a.page_permissions))}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;"
                    onclick="showEditPermissions(${a.id})">
                    Adgang
                </button>
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;"
                    onclick="showChangePassword(${a.id}, '${escapeHtml(a.username)}')">
                    Skift kode
                </button>
                <button class="btn-danger" style="font-size:0.8em; padding:5px 10px;"
                    onclick="handleDeleteAdmin(${a.id}, '${escapeHtml(a.username)}')">
                    Slet
                </button>
            </div>
        </div>
    `).join('');
}

// Inline-formular til at redigere en eksisterende admins sideadgang.
function showEditPermissions(adminId) {
    const existing = document.getElementById('edit-perm-form');
    if (existing) existing.remove();

    const admin = currentAdmins.find(a => a.id === adminId);
    if (!admin) return;

    const row = document.getElementById(`admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'edit-perm-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:rgba(255,255,255,0.5);margin-bottom:8px;">
            Sideadgang for <strong>${escapeHtml(admin.username)}</strong>
        </div>
        ${permissionCheckboxesHtml('editPerm', admin.page_permissions)}
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
            <button class="btn-primary" style="padding:8px 14px;font-size:0.85em;"
                onclick="handleSavePermissions(${adminId})">Gem adgang</button>
            <button class="btn-secondary" style="padding:8px 12px;font-size:0.85em;"
                onclick="document.getElementById('edit-perm-form').remove()">Annuller</button>
        </div>
        <div id="editPermMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
}

async function handleSavePermissions(adminId) {
    const msgEl = document.getElementById('editPermMsg');
    const perms = readPermissionSelection('editPerm');
    try {
        await api.updateClubAdminPermissions(selectedClubId, adminId, perms);
        document.getElementById('edit-perm-form').remove();
        loadAdmins();
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme adgang', 'error');
    }
}

function showChangePassword(adminId, username) {
    // Fjern evt. eksisterende inline-formular
    const existing = document.getElementById('change-pw-form');
    if (existing) existing.remove();

    const row = document.getElementById(`admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'change-pw-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:rgba(255,255,255,0.5);margin-bottom:8px;">
            Ny adgangskode til <strong>${escapeHtml(username)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="password" id="changePwInput" placeholder="Min. 8 tegn"
                style="flex:1;background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.1);
                border-radius:6px;padding:8px 10px;color:#eaeaea;font-family:'DM Sans',sans-serif;font-size:0.9em;">
            <button class="btn-primary" style="padding:8px 14px;font-size:0.85em;"
                onclick="handleChangePassword(${adminId})">Gem</button>
            <button class="btn-secondary" style="padding:8px 12px;font-size:0.85em;"
                onclick="document.getElementById('change-pw-form').remove()">Annuller</button>
        </div>
        <div id="changePwMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
    document.getElementById('changePwInput').focus();
}

async function handleChangePassword(adminId) {
    const pw = document.getElementById('changePwInput').value;
    const msgEl = document.getElementById('changePwMsg');
    if (!pw || pw.length < 8) {
        showMsg(msgEl, 'Adgangskode skal være mindst 8 tegn', 'error');
        return;
    }
    try {
        await api.changeClubAdminPassword(selectedClubId, adminId, pw);
        document.getElementById('change-pw-form').remove();
    } catch (err) {
        showMsg(msgEl, err.message || 'Fejl', 'error');
    }
}

let pendingDeleteAdminId = null;

function handleDeleteAdmin(adminId, username) {
    pendingDeleteAdminId = adminId;
    document.getElementById('deleteAdminModalText').textContent =
        `Er du sikker på at du vil slette admin "${username}"? Dette kan ikke fortrydes.`;
    document.getElementById('deleteAdminModalMsg').style.display = 'none';
    document.getElementById('deleteAdminConfirmBtn').disabled = false;
    document.getElementById('deleteAdminConfirmBtn').textContent = 'Slet';
    document.getElementById('deleteAdminModal').style.display = 'flex';
}

function closeDeleteAdminModal() {
    document.getElementById('deleteAdminModal').style.display = 'none';
    pendingDeleteAdminId = null;
}

async function confirmDeleteAdmin() {
    if (!pendingDeleteAdminId) return;
    const btn = document.getElementById('deleteAdminConfirmBtn');
    const msgEl = document.getElementById('deleteAdminModalMsg');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    try {
        await api.deleteClubAdmin(selectedClubId, pendingDeleteAdminId);
        closeDeleteAdminModal();
        loadAdmins();
    } catch (err) {
        showMsg(msgEl, err.message || 'Sletning mislykkedes', 'error');
        btn.disabled = false;
        btn.textContent = 'Slet';
    }
}

function closeModal() {
    document.getElementById('adminModal').style.display = 'none';
    selectedClubId = null;
}

async function handleCreateAdmin() {
    const username = document.getElementById('newAdminUsername').value.trim();
    const password = document.getElementById('newAdminPassword').value;
    const email = document.getElementById('newAdminEmail').value.trim();
    const btn = document.getElementById('createAdminBtn');
    const msgEl = document.getElementById('createAdminMsg');

    if (!username || !password) {
        showMsg(msgEl, 'Brugernavn og adgangskode er påkrævet', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Opretter...';
    msgEl.style.display = 'none';

    try {
        const pagePermissions = readPermissionSelection('newAdminPerm');
        const admin = await api.createClubAdmin(selectedClubId, username, password, email || undefined, pagePermissions);
        showMsg(msgEl, `✓ Admin "${admin.username}" er oprettet`, 'success');
        document.getElementById('newAdminUsername').value = '';
        document.getElementById('newAdminPassword').value = '';
        document.getElementById('newAdminEmail').value = '';
        document.getElementById('newAdminPermissions').innerHTML = permissionCheckboxesHtml('newAdminPerm', null);
        loadAdmins();
    } catch (err) {
        showMsg(msgEl, err.message || 'Oprettelse mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Opret Admin';
    }
}

// ==================== SKIFT ADGANGSKODE ====================

async function handleChangeSuperAdminPassword() {
    const current = document.getElementById('currentPassword').value;
    const newPw = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;
    const btn = document.getElementById('changePasswordBtn');
    const msgEl = document.getElementById('changePasswordMsg');

    if (!current || !newPw || !confirm) {
        showMsg(msgEl, 'Udfyld alle felter', 'error');
        return;
    }
    if (newPw.length < 8) {
        showMsg(msgEl, 'Ny adgangskode skal være mindst 8 tegn', 'error');
        return;
    }
    if (newPw !== confirm) {
        showMsg(msgEl, 'Ny adgangskode og bekræftelse stemmer ikke overens', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    msgEl.style.display = 'none';

    try {
        await api.changeSuperAdminPassword(current, newPw);
        showMsg(msgEl, '✓ Adgangskode er skiftet', 'success');
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
    } catch (err) {
        showMsg(msgEl, err.message || 'Skift af adgangskode mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Skift Adgangskode';
    }
}

// ==================== BACKUP / RESTORE ====================

let _restoreClubId = null;
const _restoreInput = (() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
        if (inp.files[0] && _restoreClubId) doClubRestore(_restoreClubId, inp.files[0]);
        inp.value = '';
    });
    return inp;
})();

async function downloadClubBackup(clubId, subdomain) {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    try {
        const res = await fetch(`/api/super-admin/clubs/${clubId}/backup`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const cd = res.headers.get('Content-Disposition') || '';
        const match = cd.match(/filename="([^"]+)"/);
        const filename = match ? match[1] : `backup_${subdomain}.json`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Backup fejlede: ' + err.message);
    }
}

function triggerClubRestore(clubId) {
    if (!confirm(`Er du sikker? Alle data for denne klub vil blive overskrevet. Kan ikke fortrydes.`)) return;
    _restoreClubId = clubId;
    _restoreInput.click();
}

async function doClubRestore(clubId, file) {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    const form = new FormData();
    form.append('backup', file);
    try {
        const res = await fetch(`/api/super-admin/clubs/${clubId}/restore`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        alert(`Gendannelse fuldført!\nBilleder: ${data.files}`);
    } catch (err) {
        alert('Gendannelse fejlede: ' + err.message);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// FOOTBALL CLUB MANAGEMENT
// Spejler badminton-flowet, men scoped til football_tournament-DB.
// Klubber identificeres ved subdomain → footballapp.dk i stedet for
// badmintonapp.dk. Football-klubber har ikke db_name (delt DB) eller
// backup-funktionalitet — det er en simplere model.
// ═══════════════════════════════════════════════════════════════════════

async function loadFootballClubs() {
    const listEl = document.getElementById('footballClubList');
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        footballClubs = await api.getFootballClubs();
        renderFootballClubs();
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${err.message}</div>`;
    }
}

function renderFootballClubs() {
    const listEl = document.getElementById('footballClubList');
    if (footballClubs.length === 0) {
        listEl.innerHTML = '<div class="empty-state">Ingen football-klubber endnu — opret den første ovenfor</div>';
        return;
    }
    listEl.innerHTML = '<div class="club-list">' + footballClubs.map(club => `
        <div class="club-item" id="football-club-${club.id}">
            <div class="club-info">
                <div class="club-name">${escapeHtml(club.name)}</div>
                <div class="club-meta">
                    <span>🌐 ${escapeHtml(club.subdomain)}.footballapp.dk</span>
                    <span>👥 ${club.admin_count ?? 0} admin${(club.admin_count ?? 0) === 1 ? '' : 's'}</span>
                    <span>📅 ${formatDate(club.created_at)}</span>
                </div>
            </div>
            <div class="club-actions">
                <span class="badge ${club.is_active ? 'badge-active' : 'badge-inactive'}">
                    ${club.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
                <button class="btn-secondary" onclick="openFootballAdminModal(${club.id}, '${escapeHtml(club.name)}')">
                    Admins
                </button>
                <button class="btn-danger" onclick="handleToggleFootballClub(${club.id})">
                    ${club.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
                ${!club.is_active ? `
                <button class="btn-danger" style="background:rgba(233,69,96,0.3);border-color:rgba(233,69,96,0.5);"
                    onclick="handleDeleteFootballClub(${club.id}, '${escapeHtml(club.name)}')">
                    🗑 Slet
                </button>` : ''}
            </div>
        </div>
    `).join('') + '</div>';
}

async function handleCreateFootballClub() {
    const name = document.getElementById('newFootballClubName').value.trim();
    const subdomain = document.getElementById('newFootballClubSubdomain').value.trim().toLowerCase();
    const btn = document.getElementById('createFootballClubBtn');
    const msgEl = document.getElementById('createFootballClubMsg');

    if (!name || !subdomain) {
        showMsg(msgEl, 'Udfyld navn og subdomain', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';
    msgEl.style.display = 'none';

    try {
        const club = await api.createFootballClub(name, subdomain);
        footballClubs.unshift(club);
        renderFootballClubs();
        document.getElementById('newFootballClubName').value = '';
        document.getElementById('newFootballClubSubdomain').value = '';
        showMsg(msgEl, `✓ ${club.name} er oprettet (${club.subdomain}.footballapp.dk)`, 'success');
    } catch (err) {
        showMsg(msgEl, err.message || 'Oprettelse mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Opret Klub';
    }
}

async function handleToggleFootballClub(id) {
    try {
        const result = await api.toggleFootballClub(id);
        const club = footballClubs.find(c => c.id === id);
        if (club) club.is_active = result.is_active;
        renderFootballClubs();
    } catch (err) {
        alert('Fejl: ' + err.message);
    }
}

async function handleDeleteFootballClub(id, name) {
    if (!confirm(`Slet football-klubben "${name}" permanent? Dette sletter alle dens turneringer, kampe og admins. Denne handling kan ikke fortrydes.`)) return;
    try {
        await api.deleteFootballClub(id);
        footballClubs = footballClubs.filter(c => c.id !== id);
        renderFootballClubs();
    } catch (err) {
        alert('Fejl: ' + (err.message || err));
    }
}

function openFootballAdminModal(clubId, clubName) {
    selectedFootballClubId = clubId;
    document.getElementById('footballAdminModalTitle').textContent = `Admins — ${clubName}`;
    document.getElementById('newFootballAdminUsername').value = '';
    document.getElementById('newFootballAdminPassword').value = '';
    document.getElementById('newFootballAdminEmail').value = '';
    document.getElementById('createFootballAdminMsg').style.display = 'none';
    document.getElementById('footballAdminModal').style.display = 'flex';
    loadFootballAdmins();
}

function closeFootballAdminModal() {
    document.getElementById('footballAdminModal').style.display = 'none';
    selectedFootballClubId = null;
}

async function loadFootballAdmins() {
    const listEl = document.getElementById('footballAdminModalList');
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const admins = await api.getFootballClubAdmins(selectedFootballClubId);
        renderFootballAdmins(admins);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${err.message}</div>`;
    }
}

function renderFootballAdmins(admins) {
    const listEl = document.getElementById('footballAdminModalList');
    if (admins.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen admins endnu</div>';
        return;
    }
    listEl.innerHTML = admins.map(a => `
        <div class="admin-item" id="football-admin-row-${a.id}">
            <div>
                <div class="admin-name">${escapeHtml(a.username)}</div>
                ${a.email ? `<div class="admin-email">${escapeHtml(a.email)}</div>` : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;"
                    onclick="showChangeFootballPassword(${a.id}, '${escapeHtml(a.username)}')">
                    Skift kode
                </button>
                <button class="btn-danger" style="font-size:0.8em; padding:5px 10px;"
                    onclick="handleDeleteFootballAdmin(${a.id}, '${escapeHtml(a.username)}')">
                    Slet
                </button>
            </div>
        </div>
    `).join('');
}

function showChangeFootballPassword(adminId, username) {
    const existing = document.getElementById('football-change-pw-form');
    if (existing) existing.remove();

    const row = document.getElementById(`football-admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'football-change-pw-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:rgba(255,255,255,0.5);margin-bottom:8px;">
            Ny adgangskode til <strong>${escapeHtml(username)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="password" id="footballChangePwInput" placeholder="Min. 8 tegn"
                style="flex:1;background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.1);
                border-radius:6px;padding:8px 10px;color:#eaeaea;font-family:'DM Sans',sans-serif;font-size:0.9em;">
            <button class="btn-primary" style="padding:8px 14px;font-size:0.85em;"
                onclick="handleChangeFootballPassword(${adminId})">Gem</button>
            <button class="btn-secondary" style="padding:8px 12px;font-size:0.85em;"
                onclick="document.getElementById('football-change-pw-form').remove()">Annuller</button>
        </div>
        <div id="footballChangePwMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
    document.getElementById('footballChangePwInput').focus();
}

async function handleChangeFootballPassword(adminId) {
    const pw = document.getElementById('footballChangePwInput').value;
    const msgEl = document.getElementById('footballChangePwMsg');
    if (!pw || pw.length < 8) {
        showMsg(msgEl, 'Adgangskode skal være mindst 8 tegn', 'error');
        return;
    }
    try {
        await api.changeFootballClubAdminPassword(selectedFootballClubId, adminId, pw);
        document.getElementById('football-change-pw-form').remove();
    } catch (err) {
        showMsg(msgEl, err.message || 'Fejl', 'error');
    }
}

async function handleDeleteFootballAdmin(adminId, username) {
    if (!confirm(`Slet admin "${username}"? Dette kan ikke fortrydes.`)) return;
    try {
        await api.deleteFootballClubAdmin(selectedFootballClubId, adminId);
        loadFootballAdmins();
    } catch (err) {
        alert('Fejl: ' + (err.message || err));
    }
}

async function handleCreateFootballAdmin() {
    const username = document.getElementById('newFootballAdminUsername').value.trim();
    const password = document.getElementById('newFootballAdminPassword').value;
    const email = document.getElementById('newFootballAdminEmail').value.trim();
    const btn = document.getElementById('createFootballAdminBtn');
    const msgEl = document.getElementById('createFootballAdminMsg');

    if (!username || !password) {
        showMsg(msgEl, 'Udfyld brugernavn og adgangskode', 'error');
        return;
    }
    if (password.length < 8) {
        showMsg(msgEl, 'Adgangskode skal være mindst 8 tegn', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Opretter...';
    try {
        await api.createFootballClubAdmin(selectedFootballClubId, username, password, email || null);
        document.getElementById('newFootballAdminUsername').value = '';
        document.getElementById('newFootballAdminPassword').value = '';
        document.getElementById('newFootballAdminEmail').value = '';
        showMsg(msgEl, `✓ Admin '${username}' oprettet`, 'success');
        loadFootballAdmins();
        // Bump admin count i klub-listen
        const club = footballClubs.find(c => c.id === selectedFootballClubId);
        if (club) {
            club.admin_count = (club.admin_count || 0) + 1;
            renderFootballClubs();
        }
    } catch (err) {
        showMsg(msgEl, err.message || 'Oprettelse mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Opret Admin';
    }
}

// Helpers
function showMsg(el, msg, type) {
    el.textContent = msg;
    el.className = 'msg msg-' + type;
    el.style.display = 'block';
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ==================== KLUB-LOGOER ====================

let logoCache = [];

async function loadLogos() {
    const listEl = document.getElementById('logoList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const logos = await api.getLogos();
        renderLogos(logos);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${escapeHtml(err.message || 'kunne ikke hente logoer')}</div>`;
    }
}

function renderLogos(logos) {
    const listEl = document.getElementById('logoList');
    logoCache = logos || [];
    if (!logos || logos.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen logoer endnu</div>';
        return;
    }
    listEl.innerHTML = logos.map(l => `
        <div class="admin-item" id="logo-row-${l.id}" style="gap:12px;">
            <img src="${escapeHtml(l.url)}" alt="" style="width:48px;height:48px;object-fit:contain;background:rgba(255,255,255,0.06);border-radius:6px;flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div class="admin-name">${escapeHtml(l.club_name)}</div>
                ${l.aliases ? `<div class="admin-email">${escapeHtml(l.aliases)}</div>` : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary" style="font-size:0.8em; padding:5px 10px;"
                    onclick="showEditLogo(${l.id})">Rediger</button>
                <button class="btn-danger" style="font-size:0.8em; padding:5px 10px;"
                    onclick="handleDeleteLogo(${l.id})">Slet</button>
            </div>
        </div>
    `).join('');
}

async function handleUploadLogo() {
    const clubName = document.getElementById('newLogoClubName').value.trim();
    const aliases = document.getElementById('newLogoAliases').value.trim();
    const fileInput = document.getElementById('newLogoFile');
    const file = fileInput.files[0];
    const msgEl = document.getElementById('uploadLogoMsg');
    const btn = document.getElementById('uploadLogoBtn');

    if (!file) { showMsg(msgEl, 'Vælg en logo-fil', 'error'); return; }
    if (!clubName) { showMsg(msgEl, 'Klubnavn er påkrævet', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Uploader...';
    msgEl.style.display = 'none';
    try {
        await api.uploadLogo(file, clubName, aliases);
        showMsg(msgEl, '✓ Logo uploadet', 'success');
        document.getElementById('newLogoClubName').value = '';
        document.getElementById('newLogoAliases').value = '';
        fileInput.value = '';
        loadLogos();
    } catch (err) {
        showMsg(msgEl, err.message || 'Upload mislykkedes', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Upload logo';
    }
}

function showEditLogo(id) {
    const existing = document.getElementById('edit-logo-form');
    if (existing) existing.remove();
    const logo = logoCache.find(l => l.id === id);
    if (!logo) return;
    const row = document.getElementById(`logo-row-${id}`);
    const form = document.createElement('div');
    form.id = 'edit-logo-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div class="form-group" style="margin-bottom:8px;">
            <label>Klubnavn</label>
            <input type="text" id="editLogoClubName" value="${escapeHtml(logo.club_name)}">
        </div>
        <div class="form-group" style="margin-bottom:8px;">
            <label>Aliasser (komma-separeret)</label>
            <input type="text" id="editLogoAliases" value="${escapeHtml(logo.aliases || '')}">
        </div>
        <div style="display:flex; gap:8px;">
            <button class="btn-primary" style="padding:8px 14px;font-size:0.85em;" onclick="handleSaveLogo(${id})">Gem</button>
            <button class="btn-secondary" style="padding:8px 12px;font-size:0.85em;" onclick="document.getElementById('edit-logo-form').remove()">Annuller</button>
        </div>
        <div id="editLogoMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
}

async function handleSaveLogo(id) {
    const clubName = document.getElementById('editLogoClubName').value.trim();
    const aliases = document.getElementById('editLogoAliases').value.trim();
    const msgEl = document.getElementById('editLogoMsg');
    if (!clubName) { showMsg(msgEl, 'Klubnavn er påkrævet', 'error'); return; }
    try {
        await api.updateLogo(id, clubName, aliases);
        document.getElementById('edit-logo-form').remove();
        loadLogos();
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme', 'error');
    }
}

async function handleDeleteLogo(id) {
    if (!confirm('Slet dette logo permanent?')) return;
    try {
        await api.deleteLogo(id);
        loadLogos();
    } catch (err) {
        alert(err.message || 'Sletning mislykkedes');
    }
}
