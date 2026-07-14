// Theme Settings Page JavaScript
const api = window.BadmintonAPI;

// Theme Presets
const THEME_PRESETS = {
    default: {
        name: 'Standard',
        colorPrimary: '#533483',
        colorAccent: '#e94560',
        colorBgDark: '#1a1a2e',
        colorBgContainer: '#16213e',
        colorBgCard: '#0f3460'
    },
    ocean: {
        name: 'Ocean',
        colorPrimary: '#2563eb',
        colorAccent: '#06b6d4',
        colorBgDark: '#0c1f2e',
        colorBgContainer: '#0f2942',
        colorBgCard: '#0a1f3d'
    },
    forest: {
        name: 'Skov',
        colorPrimary: '#16a34a',
        colorAccent: '#84cc16',
        colorBgDark: '#0f1f0f',
        colorBgContainer: '#1a2e1a',
        colorBgCard: '#0d2615'
    },
    sunset: {
        name: 'Solnedgang',
        colorPrimary: '#dc2626',
        colorAccent: '#f97316',
        colorBgDark: '#1f0f0f',
        colorBgContainer: '#2e1a1a',
        colorBgCard: '#260d0d'
    },
    royal: {
        name: 'Kongeligt',
        colorPrimary: '#7c3aed',
        colorAccent: '#ec4899',
        colorBgDark: '#1a0f2e',
        colorBgContainer: '#251642',
        colorBgCard: '#1d0f3d'
    },
    monochrome: {
        name: 'Monokrom',
        colorPrimary: '#6b7280',
        colorAccent: '#9ca3af',
        colorBgDark: '#111827',
        colorBgContainer: '#1f2937',
        colorBgCard: '#374151'
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeTheme();
    setupEventListeners();
});

function initializeTheme() {
    // Verificér tokenet før dashboardet vises — et device-token eller et udløbet
    // token åbnede før dashboardet, hvorefter alle skrivninger fejlede stille.
    if (hasValidAdminToken()) {
        showThemeDashboard();
    }
}

function hasValidAdminToken() {
    const p = api.getTokenPayload && api.getTokenPayload();
    if (!p) return false;
    if (p.role === 'device') return false;                 // device-token må ikke redigere tema
    if (p.exp && Date.now() / 1000 > p.exp) return false;  // udløbet
    return true;
}

function setupEventListeners() {
    // Login (keydown — keypress er forældet og upålideligt med password managers)
    document.getElementById('loginBtn').addEventListener('click', handleLogin);
    document.getElementById('adminPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); handleLogin(); }
    });

    // Preview-bjælkens knapper
    document.getElementById('previewSaveBtn').addEventListener('click', commitPreview);
    document.getElementById('previewCancelBtn').addEventListener('click', cancelPreview);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', handleLogout);

    // Theme Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.theme));
    });

    // Custom Theme
    document.getElementById('saveCustomThemeBtn').addEventListener('click', saveCustomTheme);
    document.getElementById('previewThemeBtn').addEventListener('click', previewTheme);

    // Color picker sync
    syncColorPickers();

    // Message overlay: OK-knappens handler sættes i showMessage() (så en evt.
    // reload-parameter respekteres) — ingen ekstra listener her, ellers kørte
    // hideMessage to gange.
}

function syncColorPickers() {
    const colorInputs = [
        { color: 'colorPrimary', hex: 'colorPrimaryHex' },
        { color: 'colorAccent', hex: 'colorAccentHex' },
        { color: 'colorBgDark', hex: 'colorBgDarkHex' },
        { color: 'colorBgContainer', hex: 'colorBgContainerHex' },
        { color: 'colorBgCard', hex: 'colorBgCardHex' }
    ];

    colorInputs.forEach(({ color, hex }) => {
        const colorInput = document.getElementById(color);
        const hexInput = document.getElementById(hex);

        colorInput.addEventListener('input', (e) => {
            hexInput.value = e.target.value;
        });

        hexInput.addEventListener('input', (e) => {
            const value = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
                colorInput.value = value;
            }
        });
    });
}

async function handleLogin() {
    const password = document.getElementById('adminPassword').value;

    if (!password) {
        showMessage('Fejl', 'Indtast venligst en adgangskode!');
        return;
    }

    try {
        await api.login(password);
        showThemeDashboard();
    } catch (error) {
        console.error('Login failed:', error);
        showMessage('Fejl', 'Forkert adgangskode!');
        document.getElementById('adminPassword').value = '';
    }
}

function handleLogout() {
    api.logout();
    document.getElementById('themeDashboard').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('adminPassword').value = '';
}

async function showThemeDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('themeDashboard').style.display = 'block';

    await loadCurrentTheme();
}

async function loadCurrentTheme() {
    try {
        const theme = await api.getTheme();

        // Update custom color inputs
        document.getElementById('colorPrimary').value = theme.color_primary;
        document.getElementById('colorPrimaryHex').value = theme.color_primary;
        document.getElementById('colorAccent').value = theme.color_accent;
        document.getElementById('colorAccentHex').value = theme.color_accent;
        document.getElementById('colorBgDark').value = theme.color_bg_dark;
        document.getElementById('colorBgDarkHex').value = theme.color_bg_dark;
        document.getElementById('colorBgContainer').value = theme.color_bg_container;
        document.getElementById('colorBgContainerHex').value = theme.color_bg_container;
        document.getElementById('colorBgCard').value = theme.color_bg_card;
        document.getElementById('colorBgCardHex').value = theme.color_bg_card;

        // Highlight active preset
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.theme === theme.theme_name) {
                btn.classList.add('active');
            }
        });

        // Display current theme
        displayCurrentTheme(theme);
    } catch (error) {
        console.error('Failed to load theme:', error);
        // 401: token er udløbet/ugyldigt — tilbage til login i stedet for at
        // vise et dashboard hvor alt fejler stille
        if (error && error.status === 401) {
            handleLogout();
            showMessage('Session udløbet', 'Log venligst ind igen.');
            return;
        }
        // Andre fejl: vis en synlig fejl med genforsøg i stedet for evig "Indlæser..."
        const display = document.getElementById('currentThemeDisplay');
        if (display) {
            display.innerHTML = '<p class="theme-name">Kunne ikke indlæse tema</p>';
            const retry = document.createElement('button');
            retry.className = 'btn-secondary';
            retry.textContent = 'Prøv igen';
            retry.style.marginTop = '12px';
            retry.addEventListener('click', loadCurrentTheme);
            display.appendChild(retry);
        }
    }
}

function displayCurrentTheme(theme) {
    const display = document.getElementById('currentThemeDisplay');
    const themeName = THEME_PRESETS[theme.theme_name]?.name || 'Tilpasset';

    // Farveværdierne kommer fra databasen og indsættes i innerHTML (både i
    // style="..." og som tekst). En ugyldig/manipuleret værdi som
    // '#fff"><img src=x onerror=...>' ville ellers køre script — vis kun rene
    // 6-cifrede hex, fald tilbage til '#000000' ved alt andet.
    const safeHex = (v) => /^#[0-9A-Fa-f]{6}$/.test(v) ? v : '#000000';
    const primary = safeHex(theme.color_primary);
    const accent = safeHex(theme.color_accent);
    const bgDark = safeHex(theme.color_bg_dark);

    display.innerHTML = `
        <p class="theme-name">${themeName}</p>
        <div class="theme-colors">
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${primary};"></div>
                <div>
                    <div class="theme-color-label">Primær</div>
                    <div class="theme-color-value">${primary}</div>
                </div>
            </div>
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${accent};"></div>
                <div>
                    <div class="theme-color-label">Accent</div>
                    <div class="theme-color-value">${accent}</div>
                </div>
            </div>
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${bgDark};"></div>
                <div>
                    <div class="theme-color-label">Baggrund</div>
                    <div class="theme-color-value">${bgDark}</div>
                </div>
            </div>
        </div>
    `;
}

// Klik på et preset GEMMER ikke længere med det samme — det starter en
// forhåndsvisning. Temaet gemmes først når man klikker "Gem på alle skærme" i
// preview-bjælken, så ét klik ikke ændrer temaet på hele hallens skærme.
function applyPreset(presetName) {
    const preset = THEME_PRESETS[presetName];
    if (!preset) return;

    // Update color inputs
    document.getElementById('colorPrimary').value = preset.colorPrimary;
    document.getElementById('colorPrimaryHex').value = preset.colorPrimary;
    document.getElementById('colorAccent').value = preset.colorAccent;
    document.getElementById('colorAccentHex').value = preset.colorAccent;
    document.getElementById('colorBgDark').value = preset.colorBgDark;
    document.getElementById('colorBgDarkHex').value = preset.colorBgDark;
    document.getElementById('colorBgContainer').value = preset.colorBgContainer;
    document.getElementById('colorBgContainerHex').value = preset.colorBgContainer;
    document.getElementById('colorBgCard').value = preset.colorBgCard;
    document.getElementById('colorBgCardHex').value = preset.colorBgCard;

    // Markér preset visuelt og start forhåndsvisning (ingen gemning)
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === presetName);
    });
    enterPreviewMode(presetName, preset);
}

// ── Forhåndsvisnings-tilstand ──
// Anvender farver lokalt på CSS-variablerne og viser preview-bjælken. Selve
// gemningen sker først via commitPreview(); cancelPreview() ruller tilbage.
let _pendingPreview = null;
function enterPreviewMode(themeName, colors) {
    _pendingPreview = { themeName, colors };
    applyColorsLocally(colors);
    document.getElementById('previewBar').style.display = 'flex';
}

function applyColorsLocally(colors) {
    const root = document.documentElement;
    root.style.setProperty('--color-primary', colors.colorPrimary);
    root.style.setProperty('--color-accent', colors.colorAccent);
    root.style.setProperty('--color-bg-dark', colors.colorBgDark);
    root.style.setProperty('--color-bg-container', colors.colorBgContainer);
    root.style.setProperty('--color-bg-card', colors.colorBgCard);
    root.style.setProperty('--gradient-primary',
        `linear-gradient(135deg, ${colors.colorPrimary} 0%, ${colors.colorAccent} 100%)`);
}

async function commitPreview() {
    if (!_pendingPreview) return;
    const { themeName, colors } = _pendingPreview;
    _pendingPreview = null;
    document.getElementById('previewBar').style.display = 'none';
    await saveTheme(themeName, colors);
}

// Fortryd: rul tilbage til det gemte tema. window.loadTheme() (fra
// theme-loader.js) genhenter og genanvender det aktuelt gemte tema.
async function cancelPreview() {
    _pendingPreview = null;
    document.getElementById('previewBar').style.display = 'none';
    if (window.loadTheme) await window.loadTheme();
    await loadCurrentTheme(); // gendan farveinputs + aktiv-markering
}

async function saveCustomTheme() {
    const theme = {
        colorPrimary: document.getElementById('colorPrimaryHex').value,
        colorAccent: document.getElementById('colorAccentHex').value,
        colorBgDark: document.getElementById('colorBgDarkHex').value,
        colorBgContainer: document.getElementById('colorBgContainerHex').value,
        colorBgCard: document.getElementById('colorBgCardHex').value
    };

    // Validate all colors
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    const invalidColors = Object.values(theme).filter(color => !hexRegex.test(color));

    if (invalidColors.length > 0) {
        showMessage('Fejl', 'Nogle farveværdier er ugyldige. Brug formatet #RRGGBB');
        return;
    }

    await saveTheme('custom', theme);
}

async function saveTheme(themeName, colors) {
    try {
        await api.updateTheme({
            themeName,
            colorPrimary: colors.colorPrimary,
            colorAccent: colors.colorAccent,
            colorBgDark: colors.colorBgDark,
            colorBgContainer: colors.colorBgContainer,
            colorBgCard: colors.colorBgCard
        });

        // Apply theme immediately
        const root = document.documentElement;
        root.style.setProperty('--color-primary', colors.colorPrimary);
        root.style.setProperty('--color-accent', colors.colorAccent);
        root.style.setProperty('--color-bg-dark', colors.colorBgDark);
        root.style.setProperty('--color-bg-container', colors.colorBgContainer);
        root.style.setProperty('--color-bg-card', colors.colorBgCard);
        const gradient = `linear-gradient(135deg, ${colors.colorPrimary} 0%, ${colors.colorAccent} 100%)`;
        root.style.setProperty('--gradient-primary', gradient);

        // Update preset button active states
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.theme === themeName) {
                btn.classList.add('active');
            }
        });

        // Update current theme display
        const theme = {
            theme_name: themeName,
            color_primary: colors.colorPrimary,
            color_accent: colors.colorAccent,
            color_bg_dark: colors.colorBgDark
        };
        displayCurrentTheme(theme);

        // Opdatér også theme-loader-cachen så denne side ikke selv flasher
        // det gamle tema ved næste navigation
        try { localStorage.setItem('cachedTheme', JSON.stringify({
            theme_name: themeName,
            color_primary: colors.colorPrimary,
            color_accent: colors.colorAccent,
            color_bg_dark: colors.colorBgDark,
            color_bg_container: colors.colorBgContainer,
            color_bg_card: colors.colorBgCard
        })); } catch {}

        showMessage('Succes', 'Tema gemt! Åbne TV- og oversigtsskærme opdaterer ved næste genindlæsning.');
    } catch (error) {
        console.error('Failed to save theme:', error);
        showMessage('Fejl', 'Kunne ikke gemme tema: ' + error.message);
    }
}

function previewTheme() {
    const colors = {
        colorPrimary: document.getElementById('colorPrimaryHex').value,
        colorAccent: document.getElementById('colorAccentHex').value,
        colorBgDark: document.getElementById('colorBgDarkHex').value,
        colorBgContainer: document.getElementById('colorBgContainerHex').value,
        colorBgCard: document.getElementById('colorBgCardHex').value
    };

    // Validér før forhåndsvisning så ugyldige hex ikke giver NaN-farver
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    if (Object.values(colors).some(c => !hexRegex.test(c))) {
        showMessage('Fejl', 'Nogle farveværdier er ugyldige. Brug formatet #RRGGBB');
        return;
    }

    // Custom-farver: intet navngivet preset er aktivt
    document.querySelectorAll('.preset-btn').forEach(btn => btn.classList.remove('active'));
    enterPreviewMode('custom', colors);
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
