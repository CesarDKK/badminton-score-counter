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
        color_bg_card:      '#252347'
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

    // Knapflade (F2): hvid tekst skal have mindst 4,5:1. Er accenten for lys til
    // det (standardrøden #e94560 giver 3,8:1), gøres fladen gradvist mørkere.
    // Lyse accenter med mørk tekst (fx lime) bruges som de er.
    const luminans = rgb => {
        const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const tilHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const knapFlade = hex => {
        const h = hex.replace('#', '');
        let rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
        if (onColor(hex) !== '#ffffff') return { flade: hex, hover: tilHex(rgb.map(v => v * 0.9)) };
        for (let i = 0; i < 20 && 1.05 / (luminans(rgb) + 0.05) < 4.5; i++) rgb = rgb.map(v => v * 0.95);
        return { flade: tilHex(rgb), hover: tilHex(rgb.map(v => v * 0.88)) };
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
        const knap = knapFlade(accent);
        root.style.setProperty('--color-knap',       knap.flade);
        root.style.setProperty('--color-knap-hover', knap.hover);

        // Faste betydningsfarver og tekstniveauer ligger i fundament.css (E1),
        // som alle sider inkl. TV henter — her sættes kun klubbens tema.
        root.style.setProperty('--gradient-primary', `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)`);

        // Grønt tema (fx Skov): den faste vinder-grøn drukner i temaets grønne,
        // så TV og oversigt viser vundne sæt/vinderen lyst i stedet (data-groent-tema).
        if (erGroen(primary) || erGroen(accent)) root.setAttribute('data-groent-tema', '');
        else root.removeAttribute('data-groent-tema');
    }

    // Farvetone 75–165° med tydelig mætning = grøn (lime og mellemgrøn i Skov)
    function erGroen(hex) {
        const h = hex.replace('#', '');
        const r = parseInt(h.slice(0,2),16) / 255, g = parseInt(h.slice(2,4),16) / 255, b = parseInt(h.slice(4,6),16) / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        if (max !== g || d === 0) return false;
        const maet = d / (1 - Math.abs(max + min - 1));
        const tone = 60 * ((b - r) / d + 2);
        return maet >= 0.35 && tone >= 75 && tone <= 165;
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
            // Timeout: en hængende forbindelse (halvåben TCP efter et netudfald)
            // må aldrig holde den kaldende side fast — TV'et ventede her for evigt
            const ctrl = new AbortController(); // ikke AbortSignal.timeout — kræver nyere browser
            const t = setTimeout(() => ctrl.abort(), 10000);
            const response = await fetch('/api/settings/theme', { signal: ctrl.signal })
                .finally(() => clearTimeout(t));
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

    // ── PWA-bootstrap (kører på alle sider, da theme-loader inkluderes overalt) ──
    // Sørger for at manifest-linket og service worker-registreringen findes på
    // enhver side, ikke kun court-v3 — så PWA-installation kan udløses fra fx
    // landing (manifestets start_url) og admin-siderne.
    (function initPwa() {
        // Injicér <link rel="manifest"> hvis den ikke allerede står i HTML'en
        if (!document.querySelector('link[rel="manifest"]')) {
            const link = document.createElement('link');
            link.rel = 'manifest';
            link.href = '/manifest.json';
            document.head.appendChild(link);
        }
        // Registrér service worker (idempotent — samme URL registreres kun én gang)
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js').catch(() => {});
            });
        }
    })();
})();
