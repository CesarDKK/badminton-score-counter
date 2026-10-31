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
    { key: 'devicetokens', label: 'Adgangslinks' },
    { key: 'planner',    label: 'Badmintonplanner' }
];

// Bygger HTML for et rettigheds-vaelger-saet. permissions = null betyder alle sider.
// De enkelte sider er altid synlige; "Alle sider" er blot en vælg-alle-knap.
function permissionCheckboxesHtml(idPrefix, permissions) {
    const all = permissions === null || permissions === undefined;
    const allowed = new Set(all ? PAGE_OPTIONS.map(p => p.key) : permissions);
    const rows = PAGE_OPTIONS.map(p => `
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;color:var(--text-primary, #eaeaea);cursor:pointer;">
            <input type="checkbox" class="${idPrefix}-page" value="${p.key}" ${allowed.has(p.key) ? 'checked' : ''} onchange="syncPermAll('${idPrefix}')">
            ${p.label}
        </label>`).join('');
    return `
        <label style="display:flex;align-items:center;gap:8px;font-size:0.9em;color:var(--text-primary, #eaeaea);cursor:pointer;margin-bottom:8px;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.08);padding-bottom:8px;">
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
let currentFootballAdmins = [];
let selectedFootballClubId = null;
let pendingDeleteFootballClubId = null;
let pendingDeleteFootballAdminId = null;
let activeApp = 'badminton'; // 'badminton' | 'football'

document.addEventListener('DOMContentLoaded', function () {
    // Fold-ud-kortene sættes op før dashboardet vises (listerne skriver i overskrifterne)
    opsaetFoldKort();

    // Hvis allerede logget ind som super admin
    if (api.isSuperAdminSession()) {
        // Et must-change-token (fx efter genindlæsning midt i skiftet) skal
        // sende brugeren til skift-skærmen, ikke til dashboardet (som ville
        // fejle med 403 på alle kald).
        const payload = api.getTokenPayload && api.getTokenPayload();
        if (payload && payload.mustChange) {
            showForcedPasswordChange('');
        } else {
            showDashboard();
        }
    }

    // Login
    document.getElementById('saLoginBtn').addEventListener('click', handleLogin);
    // keydown (ikke det forældede keypress) saa Enter altid udloeser login.
    document.getElementById('saPassword').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleLogin(); } });
    document.getElementById('saUsername').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('saPassword').focus(); } });

    // Tvunget password-skift
    document.getElementById('fpSubmitBtn').addEventListener('click', handleForcedPasswordChange);
    document.getElementById('fpConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleForcedPasswordChange(); } });

    // Logout
    document.getElementById('saLogoutBtn').addEventListener('click', handleLogout);

    // Opret klub
    document.getElementById('createClubBtn').addEventListener('click', handleCreateClub);

    // Opdater klubber
    document.getElementById('refreshClubsBtn').addEventListener('click', loadClubs);
    document.getElementById('klubSoeg').addEventListener('input', renderClubs);
    document.getElementById('klubFilter').addEventListener('change', renderClubs);

    // Skærm-hændelser
    document.getElementById('refreshSkaermLogBtn').addEventListener('click', loadSkaermLog);
    document.getElementById('skaermLogDage').addEventListener('change', loadSkaermLog);
    ['skaermLogKlub', 'skaermLogType'].forEach(id => document.getElementById(id).addEventListener('change', function () {
        this.dataset.valgt = this.value;
        renderSkaermLog();
    }));

    // Klub-logoer
    document.getElementById('logoSoeg').addEventListener('input', visLogos);
    document.getElementById('udenLogoSoeg').addEventListener('input', visMissingLogos);
    document.getElementById('uploadLogoBtn').addEventListener('click', handleUploadLogo);
    document.getElementById('refreshLogosBtn').addEventListener('click', loadLogos);
    document.getElementById('refreshMissingLogosBtn').addEventListener('click', loadMissingLogos);
    document.getElementById('downloadSeedBundleBtn').addEventListener('click', downloadSeedBundle);
    document.getElementById('importSeedBundleBtn').addEventListener('click', triggerImportSeedBundle);

    // YouTube (login-klienten hos Google)
    document.getElementById('ytGemBtn').addEventListener('click', gemYoutube);
    document.getElementById('ytFjernBtn').addEventListener('click', fjernYoutube);
    document.getElementById('ytKvoteGemBtn').addEventListener('click', gemYoutubeKvote);
    document.getElementById('ytKopierBtn').addEventListener('click', kopierYoutubeAdresse);
    bindEnterSubmit(['ytClientId', 'ytClientSecret'], gemYoutube);

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

    // Enter-submit på opret-/skift-felter, så man ikke skal klikke knappen med musen.
    // Sidste felt i hver gruppe udløser handleren; øvrige felter springer til næste.
    bindEnterSubmit(['newClubName', 'newClubSubdomain'], handleCreateClub);
    bindEnterSubmit(['newAdminUsername', 'newAdminPassword', 'newAdminEmail'], handleCreateAdmin);
    bindEnterSubmit(['currentPassword', 'newPassword', 'confirmPassword'], handleChangeSuperAdminPassword);
    bindEnterSubmit(['newFootballClubName', 'newFootballClubSubdomain'], handleCreateFootballClub);
    bindEnterSubmit(['newFootballAdminUsername', 'newFootballAdminPassword', 'newFootballAdminEmail'], handleCreateFootballAdmin);

    // Auto-route based on hash so admin.footballapp.dk eller #football opens Football tab
    const hostHasFootball = window.location.host.includes('footballapp.dk');
    const hashWantsFootball = window.location.hash === '#football';
    if (hostHasFootball || hashWantsFootball) activeApp = 'football';
});

// Bind Enter på en række felter: sidste felt kalder submit-handleren, de
// øvrige flytter fokus til næste felt. Manglende felter springes stille over.
function bindEnterSubmit(ids, handler) {
    ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('keydown', e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (i < ids.length - 1) {
                const next = document.getElementById(ids[i + 1]);
                if (next) next.focus();
            } else {
                handler();
            }
        });
    });
}

// ==================== FOLD-UD-KORT OG LANGE LISTER ====================
// Kortene med data-fold foldes ud/sammen ved klik på overskriften, så siden
// ikke bliver uendelig lang. Valget huskes i browseren; kan localStorage ikke
// bruges (privat vindue), gælder kortets standard (data-fold-standard).

const FOLD_NOEGLE = 'superAdminFold';
const LISTE_TRIN = 25;     // rækker ad gangen i de lange lister
const visAntal = {};       // liste → antal viste rækker (Infinity = alle)
const hentet = new Set();  // lister hvis data er hentet (før det står spinneren)
const LISTER = {
    skaerm: () => renderSkaermLog(),
    'uden-logo': () => visMissingLogos(),
    logoer: () => visLogos()
};

function foldValg() {
    try { return JSON.parse(localStorage.getItem(FOLD_NOEGLE)) || {}; } catch (e) { return {}; }
}

function gemFoldValg(valg) {
    try { localStorage.setItem(FOLD_NOEGLE, JSON.stringify(valg)); } catch (e) { /* privat vindue */ }
}

function opsaetFoldKort() {
    const valg = foldValg();
    document.querySelectorAll('.card[data-fold]').forEach(kort => {
        const titel = kort.querySelector('.card-header > .card-title');
        const knap = document.createElement('button');
        knap.type = 'button';
        knap.className = 'fold-knap';
        knap.innerHTML = '<svg class="fold-pil" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
        titel.replaceWith(knap);
        const tekst = Object.assign(document.createElement('span'), { className: 'fold-tekst' });
        tekst.append(titel, Object.assign(document.createElement('span'), { className: 'fold-resume' }));
        knap.append(tekst);
        knap.addEventListener('click', () => foldKort(kort.dataset.fold, !kort.classList.contains('card--sammen')));
        const navn = kort.dataset.fold;
        saetFold(kort, navn in valg ? !!valg[navn] : kort.dataset.foldStandard === 'sammen');
    });
    document.getElementById('foldAltUdBtn').addEventListener('click', () => foldAlt(false));
    document.getElementById('foldAltSammenBtn').addEventListener('click', () => foldAlt(true));
}

function saetFold(kort, sammen) {
    kort.classList.toggle('card--sammen', sammen);
    kort.querySelector('.fold-knap').setAttribute('aria-expanded', String(!sammen));
}

// Fold ét kort ud eller sammen og husk det
function foldKort(navn, sammen) {
    const kort = document.querySelector(`.card[data-fold="${navn}"]`);
    if (!kort) return;
    saetFold(kort, sammen);
    const valg = foldValg();
    valg[navn] = sammen;
    gemFoldValg(valg);
}

// Alle kort; "ud" viser også alle rækker i de lange lister, "sammen" går
// tilbage til de første LISTE_TRIN. Filtrene lades være — dem har man valgt.
function foldAlt(sammen) {
    const valg = foldValg();
    document.querySelectorAll('.card[data-fold]').forEach(kort => {
        saetFold(kort, sammen);
        valg[kort.dataset.fold] = sammen;
    });
    gemFoldValg(valg);
    Object.keys(LISTER).forEach(liste => {
        visAntal[liste] = sammen ? LISTE_TRIN : Infinity;
        if (hentet.has(liste)) LISTER[liste]();
    });
}

// Kort tekst efter overskriften (antal), så man kan se indholdet sammenfoldet
function saetResume(navn, tekst) {
    const el = document.querySelector(`.card[data-fold="${navn}"] .fold-resume`);
    if (el) el.textContent = tekst || '';
}

// De første rækker af en lang liste + knapper til resten
function begraens(liste, raekker) {
    const n = visAntal[liste] || LISTE_TRIN;
    const resten = raekker.length - n;
    if (resten <= 0) return { viste: raekker, flere: '' };
    const mere = resten > LISTE_TRIN
        ? `<button type="button" class="btn-secondary btn-sm" onclick="visFlere('${liste}', ${LISTE_TRIN})">Vis ${LISTE_TRIN} mere</button>`
        : '';
    return {
        viste: raekker.slice(0, n),
        flere: `<div class="vis-flere">${mere}<button type="button" class="btn-secondary btn-sm" onclick="visFlere('${liste}', Infinity)">Vis ${resten > LISTE_TRIN ? `alle (${resten} mere)` : `de sidste ${resten}`}</button></div>`
    };
}

function visFlere(liste, flere) {
    visAntal[liste] = (visAntal[liste] || LISTE_TRIN) + flere;
    LISTER[liste]();
}

// Søgefeltets tekst, til sammenligning uden store/små bogstaver
function soegeOrd(id) {
    return document.getElementById(id).value.trim().toLocaleLowerCase('da');
}

function passer(ord, ...felter) {
    return !ord || felter.some(f => (f || '').toLocaleLowerCase('da').includes(ord));
}

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
        const result = await api.loginAsSuperAdmin(username, password);
        if (result && result.mustChangePassword) {
            showForcedPasswordChange(password);
        } else {
            showDashboard();
        }
    } catch (err) {
        showMsg(errEl, err.message || 'Login mislykkedes', 'error');
        btn.disabled = false;
        btn.textContent = 'Log ind';
        document.getElementById('saPassword').value = '';
    }
}

// Tvunget password-skift: vises når man logger ind med standard-adgangskoden.
// Kan ikke springes over — backenden afviser alle andre kald indtil skiftet.
function showForcedPasswordChange(currentPassword) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboard').style.display = 'none';
    document.getElementById('forcedPwScreen').style.display = 'block';
    const cur = document.getElementById('fpCurrent');
    if (currentPassword) cur.value = currentPassword; // forudfyld fra login
    document.getElementById('fpNew').focus();
}

async function handleForcedPasswordChange() {
    const current = document.getElementById('fpCurrent').value;
    const nyt = document.getElementById('fpNew').value;
    const gentag = document.getElementById('fpConfirm').value;
    const btn = document.getElementById('fpSubmitBtn');
    const errEl = document.getElementById('fpError');
    errEl.style.display = 'none';

    if (!current || !nyt) { return showMsg(errEl, 'Udfyld alle felter', 'error'); }
    if (nyt.length < 8) { return showMsg(errEl, 'Ny adgangskode skal være mindst 8 tegn', 'error'); }
    if (nyt !== gentag) { return showMsg(errEl, 'De to nye adgangskoder er ikke ens', 'error'); }
    if (nyt === current) { return showMsg(errEl, 'Vælg en anden adgangskode end den nuværende', 'error'); }

    btn.disabled = true;
    btn.textContent = 'Skifter...';
    try {
        await api.changeSuperAdminPassword(current, nyt);
        document.getElementById('forcedPwScreen').style.display = 'none';
        showDashboard();
    } catch (err) {
        showMsg(errEl, err.message || 'Skift mislykkedes', 'error');
        btn.disabled = false;
        btn.textContent = 'Skift og fortsæt';
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
        loadSkaermLog();
        loadLogos();
        loadMissingLogos();
        loadYoutube();
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
        saetResume('klubber', '');
        listEl.innerHTML = '<div class="empty-state">Ingen klubber endnu — opret den første ovenfor</div>';
        return;
    }

    const ord = soegeOrd('klubSoeg');
    const filter = document.getElementById('klubFilter').value;
    const viste = clubs.filter(club => passer(ord, club.name, club.subdomain, club.db_name) && (
        !filter
        || (filter === 'skaerm' && club.skaerm_haendelser_doegn > 0)
        || (filter === 'login' && sidstLoginGammel(club.last_login_at))
        || (filter === 'backup' && !!club.last_auto_backup_error)
        || (filter === 'inaktiv' && !club.is_active)));
    saetResume('klubber', `${clubs.length} ${clubs.length === 1 ? 'klub' : 'klubber'}`
        + (viste.length < clubs.length ? ` · ${viste.length} vist` : ''));
    if (!viste.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen klubber passer til søgningen</div>';
        return;
    }

    listEl.innerHTML = '<div class="club-list">' + viste.map(club => `
        <div class="club-item" id="club-${club.id}">
            <div class="club-info">
                <div class="club-name">${escapeHtml(club.name)}</div>
                <div class="club-meta">
                    <span>${Ikon('globus')} ${escapeHtml(club.subdomain)}</span>
                    <span>${Ikon('database')} ${escapeHtml(club.db_name)}</span>
                    <span>${Ikon('kalender')} ${formatDate(club.created_at)}</span>
                    <span class="club-sidst-login${sidstLoginGammel(club.last_login_at) ? ' club-sidst-login--gammel' : ''}"
                        title="Seneste login af en klub-admin">
                        ${Ikon('noegle')} Sidst logget ind: ${sidstLoginTekst(club.last_login_at)}${club.last_login_user ? ` · ${escapeHtml(club.last_login_user)}` : ''}
                    </span>
                    ${autoBackupLinje(club)}
                    ${skaermLinje(club)}
                </div>
            </div>
            <div class="club-actions">
                <span class="badge ${club.is_active ? 'badge-active' : 'badge-inactive'}">
                    ${club.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
                <button class="btn-secondary" onclick="openAdminModal(${club.id})">
                    Admins
                </button>
                <button class="btn-secondary" onclick="downloadClubBackup(${club.id})">
                    Backup
                </button>
                <button class="btn-secondary" onclick="triggerClubRestore(${club.id})">
                    Gendan
                </button>
                <button class="btn-danger" onclick="handleToggleClub(${club.id})">
                    ${club.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
                ${!club.is_active ? `
                <button class="btn-danger"
                    onclick="handleDeleteClub(${club.id})">
                    ${Ikon('slet')} Slet
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

    // Client-side format-tjek (serveren validerer også): kun små bogstaver, tal
    // og bindestreg, må ikke starte/slutte med bindestreg, 2-63 tegn (DNS-label).
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
        showMsg(msgEl, 'Subdomæne må kun indeholde små bogstaver, tal og bindestreg (ikke først/sidst)', 'error');
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
        btn.textContent = 'Opret klub';
    }
}

let pendingDeleteId = null;

function handleDeleteClub(id) {
    // Navnet slås op i stedet for at blive sendt gennem onclick-strengen —
    // et navn med ' eller " ville ellers bryde/injecte JS i inline-handleren.
    const club = clubs.find(c => c.id === id);
    pendingDeleteId = id;
    document.getElementById('deleteModalText').textContent =
        `Du er ved at slette klubben "${club ? club.name : ''}" permanent. Denne handling kan ikke fortrydes.`;
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
        notify('Fejl: ' + err.message, 'error');
    }
}

function openAdminModal(clubId) {
    const club = clubs.find(c => c.id === clubId);
    selectedClubId = clubId;
    document.getElementById('adminModalTitle').textContent = `Admins — ${club ? club.name : ''}`;
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
                <div class="admin-email" style="opacity:0.8;">Sidst logget ind: ${sidstLoginTekst(a.last_login_at)}</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary btn-sm"
                    onclick="showEditPermissions(${a.id})">
                    Adgang
                </button>
                <button class="btn-secondary btn-sm"
                    onclick="showEditEmail(${a.id})">
                    Mail
                </button>
                <button class="btn-secondary btn-sm"
                    onclick="showChangePassword(${a.id})">
                    Skift kode
                </button>
                <button class="btn-danger btn-sm"
                    onclick="handleDeleteAdmin(${a.id})">
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
        <div style="font-size:0.82em;color:var(--text-muted, rgba(255, 255, 255, 0.62));margin-bottom:8px;">
            Sideadgang for <strong>${escapeHtml(admin.username)}</strong>
        </div>
        ${permissionCheckboxesHtml('editPerm', admin.page_permissions)}
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px;">
            <button class="btn-primary btn-sm"
                onclick="handleSavePermissions(${adminId})">Gem adgang</button>
            <button class="btn-secondary btn-sm"
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

function showChangePassword(adminId) {
    const admin = currentAdmins.find(a => a.id === adminId);
    const username = admin ? admin.username : '';
    // Fjern evt. eksisterende inline-formular
    const existing = document.getElementById('change-pw-form');
    if (existing) existing.remove();

    const row = document.getElementById(`admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'change-pw-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:var(--text-muted, rgba(255, 255, 255, 0.62));margin-bottom:8px;">
            Ny adgangskode til <strong>${escapeHtml(username)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="password" id="changePwInput" placeholder="Min. 8 tegn"
                style="flex:1;background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.1);
                border-radius:6px;padding:8px 10px;color:var(--text-primary, #eaeaea);font-family:'DM Sans',sans-serif;font-size:0.9em;">
            <button class="btn-primary btn-sm"
                onclick="handleChangePassword(${adminId})">Gem</button>
            <button class="btn-secondary btn-sm"
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
        await api.setClubAdminPassword(selectedClubId, adminId, pw);
        document.getElementById('change-pw-form').remove();
    } catch (err) {
        showMsg(msgEl, err.message || 'Fejl', 'error');
    }
}

// Inline-formular til at sætte/ændre/fjerne en admins mail — den kan bruges
// i stedet for brugernavnet ved login.
function showEditEmail(adminId) {
    const existing = document.getElementById('edit-mail-form');
    if (existing) existing.remove();

    const admin = currentAdmins.find(a => a.id === adminId);
    if (!admin) return;

    const row = document.getElementById(`admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'edit-mail-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:var(--text-muted, rgba(255, 255, 255, 0.62));margin-bottom:8px;">
            Mail til <strong>${escapeHtml(admin.username)}</strong> — kan bruges i stedet for brugernavnet ved login. Tom = ingen mail.
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="email" id="editMailInput" placeholder="email@klub.dk" value="${escapeHtml(admin.email || '')}"
                style="flex:1;background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.1);
                border-radius:6px;padding:8px 10px;color:var(--text-primary, #eaeaea);font-family:'DM Sans',sans-serif;font-size:0.9em;">
            <button class="btn-primary btn-sm"
                onclick="handleSaveEmail(${adminId})">Gem</button>
            <button class="btn-secondary btn-sm"
                onclick="document.getElementById('edit-mail-form').remove()">Annuller</button>
        </div>
        <div id="editMailMsg" class="msg" style="display:none;margin-top:8px;"></div>
    `;
    row.insertAdjacentElement('afterend', form);
    bindEnterSubmit(['editMailInput'], () => handleSaveEmail(adminId));
    document.getElementById('editMailInput').focus();
}

async function handleSaveEmail(adminId) {
    const email = document.getElementById('editMailInput').value.trim();
    const msgEl = document.getElementById('editMailMsg');
    try {
        await api.setClubAdminEmail(selectedClubId, adminId, email);
        document.getElementById('edit-mail-form').remove();
        loadAdmins();
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme mail', 'error');
    }
}

let pendingDeleteAdminId = null;

function handleDeleteAdmin(adminId) {
    const admin = currentAdmins.find(a => a.id === adminId);
    pendingDeleteAdminId = adminId;
    document.getElementById('deleteAdminModalText').textContent =
        `Er du sikker på at du vil slette admin "${admin ? admin.username : ''}"? Dette kan ikke fortrydes.`;
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
    if (password.length < 8) {
        showMsg(msgEl, 'Adgangskode skal være mindst 8 tegn', 'error');
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
        btn.textContent = 'Opret admin';
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
        btn.textContent = 'Skift adgangskode';
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

async function downloadClubBackup(clubId) {
    const club = clubs.find(c => c.id === clubId);
    const subdomain = club ? club.subdomain : clubId;
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
        notify('Backup fejlede: ' + err.message, 'error');
    }
}

async function triggerClubRestore(clubId) {
    if (!await confirmModal('Gendan klub', 'Er du sikker? Alle data for denne klub vil blive overskrevet. Kan ikke fortrydes.', { danger: true, okText: 'Gendan' })) return;
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
        notify(`Gendannelse fuldført! Billeder: ${data.files}`, 'success');
    } catch (err) {
        notify('Gendannelse fejlede: ' + err.message, 'error');
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
    saetResume('fb-klubber', footballClubs.length ? `${footballClubs.length} ${footballClubs.length === 1 ? 'klub' : 'klubber'}` : '');
    if (footballClubs.length === 0) {
        listEl.innerHTML = '<div class="empty-state">Ingen football-klubber endnu — opret den første ovenfor</div>';
        return;
    }
    listEl.innerHTML = '<div class="club-list">' + footballClubs.map(club => `
        <div class="club-item" id="football-club-${club.id}">
            <div class="club-info">
                <div class="club-name">${escapeHtml(club.name)}</div>
                <div class="club-meta">
                    <span>${Ikon('globus')} ${escapeHtml(club.subdomain)}.footballapp.dk</span>
                    <span>${Ikon('personer')} ${club.admin_count ?? 0} admin${(club.admin_count ?? 0) === 1 ? '' : 's'}</span>
                    <span>${Ikon('kalender')} ${formatDate(club.created_at)}</span>
                </div>
            </div>
            <div class="club-actions">
                <span class="badge ${club.is_active ? 'badge-active' : 'badge-inactive'}">
                    ${club.is_active ? 'Aktiv' : 'Inaktiv'}
                </span>
                <button class="btn-secondary" onclick="openFootballAdminModal(${club.id})">
                    Admins
                </button>
                <button class="btn-danger" onclick="handleToggleFootballClub(${club.id})">
                    ${club.is_active ? 'Deaktiver' : 'Aktiver'}
                </button>
                ${!club.is_active ? `
                <button class="btn-danger"
                    onclick="handleDeleteFootballClub(${club.id})">
                    ${Ikon('slet')} Slet
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
        btn.textContent = 'Opret klub';
    }
}

async function handleToggleFootballClub(id) {
    try {
        const result = await api.toggleFootballClub(id);
        const club = footballClubs.find(c => c.id === id);
        if (club) club.is_active = result.is_active;
        renderFootballClubs();
    } catch (err) {
        notify('Fejl: ' + err.message, 'error');
    }
}

async function handleDeleteFootballClub(id) {
    const club = footballClubs.find(c => c.id === id);
    if (!await confirmModal('Slet football-klub', `Slet football-klubben "${club ? club.name : ''}" permanent? Dette sletter alle dens turneringer, kampe og admins. Denne handling kan ikke fortrydes.`, { danger: true, okText: 'Slet' })) return;
    try {
        await api.deleteFootballClub(id);
        footballClubs = footballClubs.filter(c => c.id !== id);
        renderFootballClubs();
    } catch (err) {
        notify('Fejl: ' + (err.message || err), 'error');
    }
}

function openFootballAdminModal(clubId) {
    const club = footballClubs.find(c => c.id === clubId);
    selectedFootballClubId = clubId;
    document.getElementById('footballAdminModalTitle').textContent = `Admins — ${club ? club.name : ''}`;
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
    currentFootballAdmins = admins;
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
                <button class="btn-secondary btn-sm"
                    onclick="showChangeFootballPassword(${a.id})">
                    Skift kode
                </button>
                <button class="btn-danger btn-sm"
                    onclick="handleDeleteFootballAdmin(${a.id})">
                    Slet
                </button>
            </div>
        </div>
    `).join('');
}

function showChangeFootballPassword(adminId) {
    const admin = currentFootballAdmins.find(a => a.id === adminId);
    const username = admin ? admin.username : '';
    const existing = document.getElementById('football-change-pw-form');
    if (existing) existing.remove();

    const row = document.getElementById(`football-admin-row-${adminId}`);
    const form = document.createElement('div');
    form.id = 'football-change-pw-form';
    form.style.cssText = 'background:rgba(255,255,255,0.04);border-radius:8px;padding:12px 14px;margin-top:4px;';
    form.innerHTML = `
        <div style="font-size:0.82em;color:var(--text-muted, rgba(255, 255, 255, 0.62));margin-bottom:8px;">
            Ny adgangskode til <strong>${escapeHtml(username)}</strong>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
            <input type="password" id="footballChangePwInput" placeholder="Min. 8 tegn"
                style="flex:1;background:var(--color-bg-card);border:1px solid rgba(255,255,255,0.1);
                border-radius:6px;padding:8px 10px;color:var(--text-primary, #eaeaea);font-family:'DM Sans',sans-serif;font-size:0.9em;">
            <button class="btn-primary btn-sm"
                onclick="handleChangeFootballPassword(${adminId})">Gem</button>
            <button class="btn-secondary btn-sm"
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

async function handleDeleteFootballAdmin(adminId) {
    const admin = currentFootballAdmins.find(a => a.id === adminId);
    if (!await confirmModal('Slet admin', `Slet admin "${admin ? admin.username : ''}"? Dette kan ikke fortrydes.`, { danger: true, okText: 'Slet' })) return;
    try {
        await api.deleteFootballClubAdmin(selectedFootballClubId, adminId);
        loadFootballAdmins();
    } catch (err) {
        notify('Fejl: ' + (err.message || err), 'error');
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
        btn.textContent = 'Opret admin';
    }
}

// ==================== YOUTUBE ====================

async function loadYoutube() {
    try {
        renderYoutube(await api.getSuperAdminYoutube());
    } catch (err) {
        document.getElementById('ytStatus').textContent = 'Fejl: ' + (err.message || 'kunne ikke hente YouTube-opsætningen');
    }
}

function renderYoutube(s) {
    const status = document.getElementById('ytStatus');
    document.getElementById('ytTilbage').textContent = s.tilbageAdresse;
    const env = s.kilde === 'env';
    if (env) {
        status.innerHTML = `<strong>✓ Sat op i serverens .env</strong> <small>(${escapeHtml(s.clientId)}) — ændres der, ikke her</small>`;
    } else if (s.kilde === 'admin') {
        const dato = s.opdateret ? ` · gemt ${escapeHtml(formatDate(s.opdateret))}` : '';
        status.innerHTML = `<strong>✓ Sat op</strong> <small>${escapeHtml(s.clientId)}${dato}</small><br><small>Klubberne kan forbinde deres kanal. Gem nye nøgler herunder for at skifte dem — så skal klubberne forbinde igen.</small>`;
    } else if (s.ulaeselig) {
        status.innerHTML = '<strong>Den gemte secret kan ikke læses</strong> <small>(serverens JWT_SECRET er skiftet) — indtast nøglerne igen</small>';
    } else {
        status.innerHTML = '<strong>Ikke sat op</strong> <small>— klubberne kan ikke forbinde YouTube endnu</small>';
    }
    saetResume('youtube', s.kilde ? 'Sat op' : s.ulaeselig ? 'Secret kan ikke læses' : 'Ikke sat op');
    document.getElementById('ytFelter').style.display = env ? 'none' : '';
    document.getElementById('ytFjernBtn').style.display = s.kilde === 'admin' ? '' : 'none';
    document.getElementById('ytVejledning').open = !s.kilde;
    const idFelt = document.getElementById('ytClientId');
    if (!idFelt.value) idFelt.value = s.kilde === 'admin' ? s.clientId : '';
    renderYoutubeKvote(s.kilde ? s.kvote : null);
}

// En udsendelse koster ca. 175 enheder: opret + kobl + afslut (50 hver) og
// statustjek (1 hver 5. minut)
const YT_ENHEDER_PR_UDSENDELSE = 175;
const ytTal = (n) => Number(n).toLocaleString('da-DK');

function renderYoutubeKvote(k) {
    const boks = document.getElementById('ytKvote');
    boks.style.display = k ? '' : 'none';
    if (!k) return;
    const pct = Math.min(100, Math.round(k.enheder / k.graense * 100));
    document.getElementById('ytKvoteTal').textContent = `${ytTal(k.enheder)} af ${ytTal(k.graense)} enheder (${pct} %)`;
    const fyld = document.getElementById('ytKvoteFyld');
    fyld.style.width = `${pct}%`;
    fyld.className = k.opbrugt ? 'yt-kvote--opbrugt' : pct >= 80 ? 'yt-kvote--hoej' : '';
    const tilbage = Math.max(0, Math.floor((k.graense - k.enheder) / YT_ENHEDER_PR_UDSENDELSE));
    const kl = new Date(k.nulstilles).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    const plads = k.opbrugt || tilbage === 0
        ? 'Ikke plads til flere udsendelser i dag'
        : `Plads til ca. ${ytTal(tilbage)} ${tilbage === 1 ? 'udsendelse' : 'udsendelser'} mere i dag`;
    document.getElementById('ytKvoteInfo').textContent =
        `${plads} (ca. ${YT_ENHEDER_PR_UDSENDELSE} enheder pr. udsendelse) · ${ytTal(k.kald)} kald. ` +
        `Google nulstiller kvoten kl. ${kl} dansk tid. Fælles for alle klubber.`;
    const advarsel = document.getElementById('ytKvoteAdvarsel');
    const formular = '<a href="https://support.google.com/youtube/contact/yt_api_form" target="_blank" rel="noopener">Googles formular</a>';
    if (k.opbrugt) {
        advarsel.innerHTML = `<strong>Kvoten blev brugt op i dag</strong> — der kunne ikke oprettes flere udsendelser, før den nulstilles. Baner med en egen stream-nøgle sendte videre med den. Søg om mere kvote med ${formular}.`;
    } else if (pct >= 80) {
        advarsel.innerHTML = `Over 80 % af dagens kvote er brugt. Sker det ofte, så søg om mere kvote med ${formular}.`;
    }
    advarsel.style.display = k.opbrugt || pct >= 80 ? '' : 'none';
    const hist = (k.historik || []).map(h => {
        const [, m, d] = h.dag.split('-');
        return `${+d}/${+m}: ${ytTal(h.enheder)}${h.opbrugt ? ' (opbrugt)' : ''}`;
    });
    document.getElementById('ytKvoteHistorik').textContent = hist.length ? `Seneste dage: ${hist.join(' · ')}` : '';
    const felt = document.getElementById('ytKvoteGraense');
    if (document.activeElement !== felt) felt.value = k.graense;
}

async function gemYoutubeKvote() {
    const msgEl = document.getElementById('ytMsg');
    const graense = Number(document.getElementById('ytKvoteGraense').value);
    try {
        renderYoutube(await api.saveSuperAdminYoutubeKvote(graense));
        showMsg(msgEl, `Daglig kvote sat til ${ytTal(graense)} enheder`, 'success');
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme kvoten', 'error');
    }
}

async function gemYoutube() {
    const msgEl = document.getElementById('ytMsg');
    const btn = document.getElementById('ytGemBtn');
    const clientId = document.getElementById('ytClientId').value.trim();
    const clientSecret = document.getElementById('ytClientSecret').value.trim();
    if (!clientId || !clientSecret) return showMsg(msgEl, 'Udfyld både Client ID og Client secret', 'error');
    btn.disabled = true;
    btn.textContent = 'Tjekker hos Google…';
    try {
        const s = await api.saveSuperAdminYoutube(clientId, clientSecret);
        document.getElementById('ytClientSecret').value = '';
        renderYoutube(s);
        showMsg(msgEl, 'Gemt — Google kender nøglerne. Klubberne kan nu forbinde deres kanal under Livestream.', 'success');
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke gemme', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Gem';
    }
}

async function fjernYoutube() {
    const ok = await confirmModal('Fjern YouTube-nøglerne?',
        'Klubberne kan ikke længere oprette udsendelser på YouTube. Baner med en indtastet stream-nøgle sender stadig til den.',
        { danger: true, okText: 'Fjern' });
    if (!ok) return;
    const msgEl = document.getElementById('ytMsg');
    try {
        document.getElementById('ytClientId').value = '';
        renderYoutube(await api.removeSuperAdminYoutube());
        showMsg(msgEl, 'Nøglerne er fjernet', 'success');
    } catch (err) {
        showMsg(msgEl, err.message || 'Kunne ikke fjerne', 'error');
    }
}

async function kopierYoutubeAdresse() {
    const tekst = document.getElementById('ytTilbage').textContent;
    try {
        await navigator.clipboard.writeText(tekst);
        notify('Adressen er kopieret', 'success');
    } catch {
        notify('Kunne ikke kopiere — markér adressen og kopiér den selv', 'error');
    }
}

// Helpers
function showMsg(el, msg, type) {
    el.textContent = msg;
    el.className = 'msg msg-' + type;
    el.style.display = 'block';
}

// Temastylet bekræftelse (erstatter native confirm) — returnerer Promise<boolean>.
function confirmModal(title, text, opts = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById('genericConfirmModal');
        document.getElementById('genericConfirmTitle').textContent = title;
        document.getElementById('genericConfirmText').textContent = text;
        const okBtn = document.getElementById('genericConfirmOk');
        const cancelBtn = document.getElementById('genericConfirmCancel');
        okBtn.className = (opts.danger ? 'btn-danger' : 'btn-primary');
        okBtn.textContent = opts.okText || 'OK';
        const cleanup = (result) => {
            modal.style.display = 'none';
            okBtn.onclick = null; cancelBtn.onclick = null;
            document.removeEventListener('keydown', onKey);
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') cleanup(false);
            else if (e.key === 'Enter') cleanup(true);
        };
        okBtn.onclick = () => cleanup(true);
        cancelBtn.onclick = () => cleanup(false);
        document.addEventListener('keydown', onKey);
        modal.style.display = 'flex';
        okBtn.focus();
    });
}

// Temastylet besked (erstatter native alert). type: 'info' | 'success' | 'error'.
let _toastTimer = null;
function notify(text, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    const palette = {
        info:    { bg: 'rgba(var(--color-info-rgb, 52,152,219), 0.96)',   fg: '#fff' },
        success: { bg: 'rgba(var(--color-win-rgb, 69,209,126), 0.96)',    fg: '#0d1117' },
        error:   { bg: 'rgba(var(--color-danger-rgb, 217,44,63), 0.96)',  fg: '#fff' }
    };
    const c = palette[type] || palette.info;
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.style.display = 'block';
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { el.style.display = 'none'; }, type === 'error' ? 6000 : 3500);
}

function escapeHtml(str) {
    // ?? '' så null/undefined ikke renderer teksten 'null'/'undefined' (samme
    // som js/utils.js — bør på sigt konsolideres til den ene delte kopi).
    return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('da-DK', { day: '2-digit', month: 'short', year: 'numeric' });
}

// "i dag kl. 14.32", "i går kl. 19.05", "12. okt. 2026 (for 4 dage siden)"
function sidstLoginTekst(dateStr) {
    if (!dateStr) return 'Aldrig';
    const d = new Date(dateStr);
    const kl = d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
    const dagStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dage = Math.round((dagStart(new Date()) - dagStart(d)) / 86400000);
    if (dage <= 0) return `i dag kl. ${kl}`;
    if (dage === 1) return `i går kl. ${kl}`;
    return `${formatDate(dateStr)} (for ${dage} dage siden)`;
}

// Den automatiske ugentlige backup (mandag kl. 02.00): seneste, antal gemte og
// en fejl fremhævet. Deaktiverede klubber tages der ikke backup af.
function autoBackupLinje(club) {
    let tekst, fejl = false;
    if (club.last_auto_backup_error) {
        fejl = true;
        tekst = `Automatisk backup fejlede: ${escapeHtml(club.last_auto_backup_error)}`
            + (club.last_auto_backup_at ? ` (seneste gode: ${sidstLoginTekst(club.last_auto_backup_at)})` : '');
    } else if (club.last_auto_backup_at) {
        tekst = `Seneste automatiske backup: ${sidstLoginTekst(club.last_auto_backup_at)} · ${club.auto_backups || 0} gemt`;
    } else {
        tekst = club.is_active ? 'Automatisk backup: første tages mandag kl. 02.00' : 'Automatisk backup: ikke for deaktiverede klubber';
    }
    return `<span class="club-sidst-login${fejl ? ' club-sidst-login--gammel' : ''}" title="Automatisk backup hver mandag kl. 02.00 — de 4 nyeste gemmes">
                ${Ikon(fejl ? 'advarsel' : 'database')} ${tekst}
            </span>`;
}

// Skærm-hændelser det seneste døgn — klik viser klubbens hændelser i loggen nedenfor
function skaermLinje(club) {
    const n = club.skaerm_haendelser_doegn || 0;
    if (!n) return '';
    return `<span class="club-sidst-login" title="TV-skærme/oversigter der har stået stille, mistet forbindelsen eller er startet forfra">
                ${Ikon('advarsel')} <a class="club-skaerm-link" onclick="visSkaermLogForKlub('${escapeHtml(club.db_name)}')">${n} skærm-${n === 1 ? 'hændelse' : 'hændelser'} seneste døgn</a>
            </span>`;
}

// ==================== SKÆRM-HÆNDELSER (alle klubber) ====================

let skaermLogCache = [];

function skaermVarighed(sek) {
    if (sek < 90) return `${sek} s`;
    if (sek < 5400) return `${Math.round(sek / 60)} min`;
    return `${Math.round(sek / 3600)} t`;
}

// Samme tekster som klubbens hændelseslog under Adgangslinks (admin-script.js)
function skaermHaendelseTekst(h) {
    const v = skaermVarighed(h.sek || 0);
    switch (h.type) {
        case 'frys': return `Browseren stod stille i ${v}`;
        case 'net': return `Ingen forbindelse til serveren i ${v}`;
        case 'genstart': return `Væk i ${v} og startet forfra — genstartet, eller den frøs`;
        case 'vaek': return `Ingen livstegn i ${v} — kom tilbage af sig selv`;
        // TV-PC'ens egen rapport — teksten kommer fra PC'en (kiosk: rapport)
        case 'pc-brat': return h.tekst || "PC'en stoppede brat — frøs, eller mistede strømmen";
        case 'pc-panik': return h.tekst || "Kernenedbrud — PC'en genstartede af sig selv";
        case 'pc-knap': return h.tekst || 'Slukket på tænd/sluk-knappen';
        case 'pc-genstart': return h.tekst || "PC'en blev genstartet";
        case 'net-wifi': return h.tekst || 'WiFi-forbindelsen var væk og kom igen';
        case 'net-server': return h.tekst || 'Ingen forbindelse til serveren, men hallens netværk virkede';
        case 'net-genstart': return h.tekst || "Ingen WiFi-forbindelse — PC'en blev genstartet";
        case 'net-kort': return h.tekst || "WiFi-kortet svarer ikke — træk strømstikket ud i 1 minut";
        case 'browser-genstart': return 'Browseren frøs og blev genstartet af browser-vagten'
            + (h.tekst ? ` (${h.tekst})` : '');
        default: return h.tekst || h.type;
    }
}

// Loguddrag fra TV-PC'ens rapporter (Vis log) — hentes, når der klikkes
const haendelseLogs = new Map();
const aabneLogs = new Set();

async function visHaendelseLog(id) {
    if (aabneLogs.has(id)) {
        aabneLogs.delete(id);
    } else {
        if (!haendelseLogs.has(id)) {
            try { haendelseLogs.set(id, await api.getScreenEventLog(id, true)); }
            catch (e) { haendelseLogs.set(id, `Loggen kunne ikke hentes: ${e.message}`); }
        }
        aabneLogs.add(id);
    }
    renderSkaermLog();
}

function haendelseLogHtml(h) {
    if (!h.har_log) return '';
    const aaben = aabneLogs.has(h.id);
    return ` <a href="#" onclick="visHaendelseLog(${Number(h.id)});return false;" class="haendelse-log-link">${aaben ? 'Skjul log' : 'Vis log'}</a>`
        + (aaben ? `<pre class="haendelse-log">${escapeHtml(haendelseLogs.get(h.id) || '')}</pre>` : '');
}

async function loadSkaermLog() {
    const listEl = document.getElementById('skaermLogList');
    if (!listEl) return;
    const dage = document.getElementById('skaermLogDage').value;
    try {
        skaermLogCache = await api.getAllScreenEvents(dage);
        hentet.add('skaerm');
        renderSkaermLog();
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${escapeHtml(err.message)}</div>`;
    }
}

function visSkaermLogForKlub(dbName) {
    const valg = document.getElementById('skaermLogKlub');
    valg.dataset.valgt = dbName;
    document.getElementById('skaermLogType').dataset.valgt = '';
    document.getElementById('skaermLogDage').value = '1';
    foldKort('skaerm', false);
    loadSkaermLog().then(() => valg.closest('.card').scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// Slags-filteret samler hændelsestyperne i grupper; ukendte typer er "Andet"
const SKAERM_SLAGS = [
    { navn: 'frys', tekst: 'Frosset', typer: ['frys', 'browser-genstart'] },
    { navn: 'net', tekst: 'Netværk og WiFi', typer: ['net', 'net-wifi', 'net-server', 'net-genstart', 'net-kort'] },
    { navn: 'genstart', tekst: 'Genstart, strøm og væk', typer: ['genstart', 'vaek', 'pc-brat', 'pc-panik', 'pc-knap', 'pc-genstart'] }
];

function skaermSlags(h) {
    const s = SKAERM_SLAGS.find(g => g.typer.includes(h.type));
    return s ? s.navn : 'andet';
}

function renderSkaermLog() {
    const listEl = document.getElementById('skaermLogList');
    const valg = document.getElementById('skaermLogKlub');
    const slagsValg = document.getElementById('skaermLogType');
    const klubNavn = (h) => h.klub_navn || h.klub;

    // Klubvalget: alle klubber med hændelser i perioden
    const klubber = [...new Map(skaermLogCache.map(h => [h.klub, klubNavn(h)])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1], 'da'));
    const valgt = klubber.some(([k]) => k === valg.dataset.valgt) ? valg.dataset.valgt : '';
    valg.innerHTML = `<option value="">Alle klubber</option>`
        + klubber.map(([k, n]) => `<option value="${escapeHtml(k)}"${k === valgt ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('');

    // Slags-valget med antal for den valgte klub; kun slags der findes i perioden
    const iKlub = skaermLogCache.filter(h => !valgt || h.klub === valgt);
    const antal = {};
    iKlub.forEach(h => { const s = skaermSlags(h); antal[s] = (antal[s] || 0) + 1; });
    const slags = [...SKAERM_SLAGS, { navn: 'andet', tekst: 'Andet' }].filter(g => antal[g.navn]);
    const valgtSlags = slags.some(g => g.navn === slagsValg.dataset.valgt) ? slagsValg.dataset.valgt : '';
    slagsValg.innerHTML = `<option value="">Alle slags (${iKlub.length})</option>`
        + slags.map(g => `<option value="${g.navn}"${g.navn === valgtSlags ? ' selected' : ''}>${g.tekst} (${antal[g.navn]})</option>`).join('');

    const viste = iKlub.filter(h => !valgtSlags || skaermSlags(h) === valgtSlags);
    const periode = document.getElementById('skaermLogDage').selectedOptions[0];
    saetResume('skaerm', `${skaermLogCache.length} ${skaermLogCache.length === 1 ? 'hændelse' : 'hændelser'} · ${periode ? periode.textContent.toLowerCase() : ''}`
        + (viste.length < skaermLogCache.length ? ` · ${viste.length} vist` : ''));
    if (!viste.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen skærm-hændelser i perioden</div>';
        return;
    }
    const { viste: raekker, flere } = begraens('skaerm', viste);
    let sidsteDag = '';
    listEl.innerHTML = raekker.map(h => {
        const d = new Date(h.fra);
        const dag = d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
        const overskrift = dag !== sidsteDag ? `<div class="skaerm-log-dag">${escapeHtml(dag)}</div>` : '';
        sidsteDag = dag;
        const hvor = h.side === 'oversigt' ? 'Oversigt' : `Bane ${h.bane || '?'}`;
        return `${overskrift}
            <div class="skaerm-log-raekke">
                <span class="tid">${d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="klub">${escapeHtml(klubNavn(h))}</span>
                <span class="skaerm"><strong>${escapeHtml(h.navn || h.klient_id)}</strong> <small>${hvor}</small></span>
                <span class="hvad">${escapeHtml(skaermHaendelseTekst(h))}${haendelseLogHtml(h)}</span>
            </div>`;
    }).join('') + flere;
}

// Ingen login i en måned (eller aldrig): fremhæves, så inaktive klubber springer i øjnene
function sidstLoginGammel(dateStr) {
    return !dateStr || Date.now() - new Date(dateStr).getTime() > 30 * 86400000;
}

// ==================== KLUB-LOGOER ====================

let logoCache = [];
let missingLogoCache = [];

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
    logoCache = logos || [];
    hentet.add('logoer');
    visLogos();
}

// Biblioteket filtreret efter søgefeltet, LISTE_TRIN ad gangen
function visLogos() {
    const listEl = document.getElementById('logoList');
    saetResume('logoer', logoCache.length ? `${logoCache.length} ${logoCache.length === 1 ? 'logo' : 'logoer'}` : '');
    if (logoCache.length === 0) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen logoer endnu</div>';
        return;
    }
    const ord = soegeOrd('logoSoeg');
    const fundne = logoCache.filter(l => passer(ord, l.club_name, l.aliases));
    if (!fundne.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen logoer passer til søgningen</div>';
        return;
    }
    const { viste, flere } = begraens('logoer', fundne);
    listEl.innerHTML = (ord ? `<div class="sa-antal">${fundne.length} af ${logoCache.length}</div>` : '') + viste.map(l => `
        <div class="admin-item" id="logo-row-${l.id}" style="gap:12px;">
            <img src="${escapeHtml(l.url)}" alt="" loading="lazy" style="width:48px;height:48px;object-fit:contain;background:rgba(255,255,255,0.06);border-radius:6px;flex-shrink:0;">
            <div style="flex:1; min-width:0;">
                <div class="admin-name">${escapeHtml(l.club_name)}</div>
                ${l.aliases ? `<div class="admin-email">${escapeHtml(l.aliases)}</div>` : ''}
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-secondary btn-sm"
                    onclick="showEditLogo(${l.id})">Rediger</button>
                <button class="btn-danger btn-sm"
                    onclick="handleDeleteLogo(${l.id})">Slet</button>
            </div>
        </div>
    `).join('') + flere;
}

// ---- Klubber uden logo ----
async function loadMissingLogos() {
    const listEl = document.getElementById('missingLogoList');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    try {
        const [names, logos] = await Promise.all([api.getKnownClubNames(), api.getLogos()]);
        logoCache = logos || [];
        const missing = (names || []).filter(c =>
            !(window.LogoMatch && LogoMatch.matchLogo(c.name, logoCache)));
        renderMissingLogos(missing);
    } catch (err) {
        listEl.innerHTML = `<div class="empty-state">Fejl: ${escapeHtml(err.message || 'kunne ikke hente klubber')}</div>`;
    }
}

function renderMissingLogos(list) {
    // Navnene sendes ikke gennem onclick-strengen (JS-injektion via ' og \) —
    // knapperne refererer i stedet et indeks i den cachede liste.
    missingLogoCache = list;
    hentet.add('uden-logo');
    visMissingLogos();
}

// Listen filtreret efter søgefeltet; indekset er stadig det i missingLogoCache
function visMissingLogos() {
    const listEl = document.getElementById('missingLogoList');
    const list = missingLogoCache;
    saetResume('uden-logo', list.length ? `${list.length} ${list.length === 1 ? 'klub' : 'klubber'}` : 'Alle har logo');
    if (!list.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Alle kendte klubber har et logo</div>';
        return;
    }
    const ord = soegeOrd('udenLogoSoeg');
    const fundne = list.map((c, i) => [c, i]).filter(([c]) => passer(ord, c.name));
    if (!fundne.length) {
        listEl.innerHTML = '<div class="empty-state" style="padding:12px;">Ingen klubber passer til søgningen</div>';
        return;
    }
    const opts = logoCache.map(l => `<option value="${l.id}">${escapeHtml(l.club_name)}</option>`).join('');
    const { viste, flere } = begraens('uden-logo', fundne);
    listEl.innerHTML = (ord ? `<div class="sa-antal">${fundne.length} af ${list.length}</div>` : '') + viste.map(([c, i]) => {
        const safe = escapeHtml(c.name);
        return `
        <div class="admin-item" style="gap:10px; flex-wrap:wrap;">
            <div style="flex:1; min-width:160px;">
                <div class="admin-name">${safe}</div>
                <div class="admin-email">${c.sources.join(', ')} · ${c.count}×</div>
            </div>
            <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
                <button class="btn-primary btn-sm" onclick="prefillUploadLogo(${i})">Upload logo</button>
                <select class="link-existing-sel" style="font-size:0.8em; padding:5px;">
                    <option value="">Knyt til…</option>${opts}
                </select>
                <button class="btn-secondary btn-sm" onclick="linkClubToLogo(${i}, this.previousElementSibling)">Knyt</button>
            </div>
        </div>`;
    }).join('') + flere;
}

function prefillUploadLogo(index) {
    const entry = missingLogoCache[index];
    if (!entry) return;
    foldKort('logoer', false);
    const inp = document.getElementById('newLogoClubName');
    if (inp) { inp.value = entry.name; inp.focus(); inp.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}

async function linkClubToLogo(index, selectEl) {
    const entry = missingLogoCache[index];
    if (!entry) return;
    const name = entry.name;
    const id = selectEl && selectEl.value ? parseInt(selectEl.value, 10) : 0;
    if (!id) { notify('Vælg et logo at knytte til', 'error'); return; }
    const logo = logoCache.find(l => l.id === id);
    if (!logo) return;
    const aliases = (logo.aliases || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!aliases.some(a => a.toLowerCase() === name.toLowerCase())) aliases.push(name);
    try {
        await api.updateLogo(id, logo.club_name, aliases.join(', '));
        await loadLogos();
        await loadMissingLogos();
    } catch (err) {
        notify('Kunne ikke knytte: ' + (err.message || 'ukendt fejl'), 'error');
    }
}
window.prefillUploadLogo = prefillUploadLogo;
window.linkClubToLogo = linkClubToLogo;

async function downloadSeedBundle() {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    try {
        const res = await fetch('/api/super-admin/logos/seed-bundle', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'seed_logos_bundle.zip'; a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        notify('Seed-bundle fejlede: ' + err.message, 'error');
    }
}

// Skjult file-input til seed-bundle-import
const _importBundleInput = (() => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.zip,application/zip';
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
        if (inp.files[0]) doImportSeedBundle(inp.files[0]);
        inp.value = '';
    });
    return inp;
})();

async function triggerImportSeedBundle() {
    if (!await confirmModal('Importer seed-bundle', 'Importer logoer fra seed-bundle?\n\nEksisterende klubber med samme navn FÅR overskrevet billede og aliasser.', { okText: 'Importer' })) return;
    _importBundleInput.click();
}

async function doImportSeedBundle(file) {
    const token = sessionStorage.getItem('superAdminToken') || sessionStorage.getItem('authToken');
    const form = new FormData();
    form.append('bundle', file);
    try {
        const res = await fetch('/api/super-admin/logos/import-bundle', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || res.statusText);
        notify(`✓ Import færdig: ${data.imported} nye, ${data.updated} opdateret, ${data.skipped} sprunget over, ${data.errors} fejl`, 'success');
        await loadLogos();
        await loadMissingLogos();
    } catch (err) {
        notify('Import fejlede: ' + (err.message || 'ukendt fejl'), 'error');
    }
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
            <button class="btn-primary btn-sm" onclick="handleSaveLogo(${id})">Gem</button>
            <button class="btn-secondary btn-sm" onclick="document.getElementById('edit-logo-form').remove()">Annuller</button>
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
    if (!await confirmModal('Slet logo', 'Slet dette logo permanent?', { danger: true, okText: 'Slet' })) return;
    try {
        await api.deleteLogo(id);
        loadLogos();
    } catch (err) {
        notify(err.message || 'Sletning mislykkedes', 'error');
    }
}
