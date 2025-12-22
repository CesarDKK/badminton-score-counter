/**
 * Theme Loader - Dynamically loads color theme from database
 * Must be loaded BEFORE any other scripts to prevent FOUC (Flash of Unstyled Content)
 */

// Theme loading function that can be called multiple times
window.loadTheme = async function() {
    try {
        const response = await fetch('/api/settings/theme');
        const theme = await response.json();

        // Apply theme colors to CSS custom properties
        const root = document.documentElement;
        root.style.setProperty('--color-primary', theme.color_primary || '#533483');
        root.style.setProperty('--color-accent', theme.color_accent || '#e94560');
        root.style.setProperty('--color-bg-dark', theme.color_bg_dark || '#1a1a2e');
        root.style.setProperty('--color-bg-container', theme.color_bg_container || '#16213e');
        root.style.setProperty('--color-bg-card', theme.color_bg_card || '#0f3460');

        // Update gradient
        const gradient = `linear-gradient(135deg, ${theme.color_primary || '#533483'} 0%, ${theme.color_accent || '#e94560'} 100%)`;
        root.style.setProperty('--gradient-primary', gradient);

        console.log('Theme loaded:', theme.theme_name || 'default');
        return theme;
    } catch (error) {
        console.error('Failed to load theme, using defaults:', error);
        // Defaults are already set in CSS :root
        return null;
    }
};

// Load theme immediately on page load
(async function() {
    await window.loadTheme();
})();
