// Settings Page JavaScript
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
    }
};

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    initializeSettings();
    setupEventListeners();
});

function initializeSettings() {
    if (api.token) {
        showSettingsDashboard();
    }
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

    // Password
    document.getElementById('changePasswordBtn').addEventListener('click', changePassword);

    // Theme Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => applyPreset(btn.dataset.theme));
    });

    // Custom Theme
    document.getElementById('saveCustomThemeBtn').addEventListener('click', saveCustomTheme);
    document.getElementById('previewThemeBtn').addEventListener('click', previewTheme);

    // Color picker sync
    syncColorPickers();

    // Message overlay
    document.getElementById('messageOkBtn').addEventListener('click', hideMessage);
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
    await loadCurrentTheme();
}

async function loadSettings() {
    try {
        const settings = await api.getSettings();
        document.getElementById('courtCount').value = settings.courtCount;
    } catch (error) {
        console.error('Failed to load settings:', error);
        showMessage('Fejl', 'Kunne ikke indlæse indstillinger');
    }
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
    }
}

function displayCurrentTheme(theme) {
    const display = document.getElementById('currentThemeDisplay');
    const themeName = THEME_PRESETS[theme.theme_name]?.name || 'Tilpasset';

    display.innerHTML = `
        <p class="theme-name">${themeName}</p>
        <div class="theme-colors">
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${theme.color_primary};"></div>
                <div>
                    <div class="theme-color-label">Primær</div>
                    <div class="theme-color-value">${theme.color_primary}</div>
                </div>
            </div>
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${theme.color_accent};"></div>
                <div>
                    <div class="theme-color-label">Accent</div>
                    <div class="theme-color-value">${theme.color_accent}</div>
                </div>
            </div>
            <div class="theme-color-item">
                <div class="theme-color-swatch" style="background: ${theme.color_bg_dark};"></div>
                <div>
                    <div class="theme-color-label">Baggrund</div>
                    <div class="theme-color-value">${theme.color_bg_dark}</div>
                </div>
            </div>
        </div>
    `;
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

    if (!newPassword || newPassword.length < 4) {
        showMessage('Fejl', 'Adgangskode skal være mindst 4 tegn');
        return;
    }

    try {
        await api.updatePassword(newPassword);
        showMessage('Succes', 'Adgangskode ændret!');
        document.getElementById('newPassword').value = '';
    } catch (error) {
        console.error('Failed to change password:', error);
        showMessage('Fejl', error.message);
    }
}

async function applyPreset(presetName) {
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

    // Save preset and wait for completion
    await saveTheme(presetName, preset);
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

        showMessage('Succes', 'Tema gemt og anvendt! Ændringerne er nu aktive på alle sider.');
    } catch (error) {
        console.error('Failed to save theme:', error);
        showMessage('Fejl', 'Kunne ikke gemme tema: ' + error.message);
    }
}

function previewTheme() {
    const primary = document.getElementById('colorPrimaryHex').value;
    const accent = document.getElementById('colorAccentHex').value;
    const bgDark = document.getElementById('colorBgDarkHex').value;
    const bgContainer = document.getElementById('colorBgContainerHex').value;
    const bgCard = document.getElementById('colorBgCardHex').value;

    // Apply temporarily to CSS variables
    const root = document.documentElement;
    root.style.setProperty('--color-primary', primary);
    root.style.setProperty('--color-accent', accent);
    root.style.setProperty('--color-bg-dark', bgDark);
    root.style.setProperty('--color-bg-container', bgContainer);
    root.style.setProperty('--color-bg-card', bgCard);

    const gradient = `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`;
    root.style.setProperty('--gradient-primary', gradient);

    showMessage('Forhåndsvisning', 'Denne forhåndsvisning er midlertidig. Klik "Gem Tilpasset Tema" for at gemme ændringerne permanent.');
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
