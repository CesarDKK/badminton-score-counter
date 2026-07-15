/**
 * Theme Loader - Dynamically loads color theme from database
 * Must be loaded BEFORE any other scripts to prevent FOUC (Flash of Unstyled Content)
 *
 * FOUC-strategi: temaet fra sidste besøg caches i localStorage og anvendes
 * SYNKRONT allerede når dette (blokerende) head-script parses — så siden males
 * med det rigtige tema fra første frame. Derefter revalideres der mod API'et i
 * baggrunden, og cachen opdateres hvis temaet er ændret. Fjerner farve-blinket
 * ved hvert sideskift og gør temaet robust hvis backend er langsom/offline.
 */
(function () {
    const CACHE_KEY = 'cachedTheme';

    const DEFAULTS = {
        color_primary:      '#533483',
        color_accent:       '#e94560',
        color_bg_dark:      '#1a1a2e',
        color_bg_container: '#16213e',
        color_bg_card:      '#0f3460'
    };

    const isHex = v => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v);

    const toRgb = hex => {
        const h = hex.replace('#', '');
        return `${parseInt(h.slice(0,2),16)}, ${parseInt(h.slice(2,4),16)}, ${parseInt(h.slice(4,6),16)}`;
    };

    // Kontrastfarve til tekst oven på accent/primary — mørk tekst på lyse
    // farver (fx lime i Skov-temaet), hvid på mørke. YIQ-vægtet lysstyrke.
    const onColor = hex => {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
        const yiq = (r * 299 + g * 587 + b * 114) / 1000;
        return yiq >= 150 ? '#0d1117' : '#ffffff';
    };

    // Anvend et tema-objekt på CSS-variablerne. Ugyldige/manglende værdier
    // falder tilbage til defaults, så en korrupt cache aldrig giver NaN-farver.
    function applyTheme(theme) {
        theme = theme || {};
        const root = document.documentElement;
        const primary     = isHex(theme.color_primary)      ? theme.color_primary      : DEFAULTS.color_primary;
        const accent      = isHex(theme.color_accent)       ? theme.color_accent       : DEFAULTS.color_accent;
        const bgDark      = isHex(theme.color_bg_dark)      ? theme.color_bg_dark      : DEFAULTS.color_bg_dark;
        const bgContainer = isHex(theme.color_bg_container) ? theme.color_bg_container : DEFAULTS.color_bg_container;
        const bgCard      = isHex(theme.color_bg_card)      ? theme.color_bg_card      : DEFAULTS.color_bg_card;

        root.style.setProperty('--color-primary',      primary);
        root.style.setProperty('--color-accent',       accent);
        root.style.setProperty('--color-bg-dark',      bgDark);
        root.style.setProperty('--color-bg-container', bgContainer);
        root.style.setProperty('--color-bg-card',      bgCard);

        // RGB-komponent variabler — muliggør rgba(var(--color-primary-rgb), 0.15)
        root.style.setProperty('--color-primary-rgb',   toRgb(primary));
        root.style.setProperty('--color-accent-rgb',    toRgb(accent));
        root.style.setProperty('--color-bg-dark-rgb',   toRgb(bgDark));
        root.style.setProperty('--color-bg-card-rgb',   toRgb(bgCard));

        root.style.setProperty('--color-on-accent',  onColor(accent));
        root.style.setProperty('--color-on-primary', onColor(primary));

        // Semantisk advarselsfarve (offline-/forbindelsesbadges) — fast, uafhængig
        // af klub-tema. Sættes her (ikke i styles.css) fordi det er det ENESTE
        // stylesheet-uafhængige sted alle sider inkl. TV loader; tv-v3.html
        // loader ikke styles.css, så et token dér ville være udefineret på TV.
        root.style.setProperty('--color-warning', '#ffb02e');
        root.style.setProperty('--color-warning-rgb', '255, 176, 46');

        root.style.setProperty('--gradient-primary', `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`);
    }

    // 1) Anvend cachet tema SYNKRONT (før første paint) — fjerner FOUC
    try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) applyTheme(JSON.parse(cached));
    } catch { /* korrupt cache — CSS-defaults bruges indtil API svarer */ }

    // 2) Revalidér mod API'et og opdatér cache. Global så tema-siden kan kalde
    //    den igen for at annullere en forhåndsvisning.
    window.loadTheme = async function () {
        try {
            const response = await fetch('/api/settings/theme');
            // Tjek response.ok — en 500 med fejl-body ville ellers blive parset
            // som JSON, anvendt (→ default-farver) og skrevet i cachen, så en
            // forbigående backend-fejl overskrev et gyldigt cachet tema.
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const theme = await response.json();
            applyTheme(theme);
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(theme)); } catch {}
            return theme;
        } catch (error) {
            console.error('Failed to load theme, using cached/defaults:', error);
            return null;
        }
    };

    // Eksponér applyTheme så tema-siden kan forhåndsvise med SAMME variabelsæt
    // (inkl. --color-*-rgb og --color-on-*) i stedet for en delmængde.
    window.applyTheme = applyTheme;

    window.loadTheme();
})();
