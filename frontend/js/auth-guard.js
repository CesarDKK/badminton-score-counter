/**
 * Auth Guard — beskytter sider der tilgås via et klub-subdomain.
 * Inkludér dette script på sider der kræver auth.
 * Kompatibel med både api.js og api-v2.js.
 */
(async function authGuard() {
    // Hent mode direkte fra backend (fungerer uanset hvilken api.js version der bruges)
    let mode;
    try {
        const res = await fetch('/api/mode');
        if (!res.ok) return;
        mode = await res.json();
    } catch {
        return; // Kan ikke nå backend — blokér ikke siden
    }

    // Direkte adgang (lokal/IP/app.) eller admin-subdomain — ingen auth krævet
    if (mode.mode !== 'club') return;

    // Tjek om ?dt= er i URL (device token) — gem i sessionStorage og fjern fra URL
    const params = new URLSearchParams(window.location.search);
    const dtParam = params.get('dt');
    if (dtParam) {
        sessionStorage.setItem('deviceToken', dtParam);
        params.delete('dt');
        const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        window.history.replaceState({}, '', clean);
    }

    const authToken   = sessionStorage.getItem('authToken');
    const deviceToken = sessionStorage.getItem('deviceToken');

    // Ingen auth — send til klub-login med redirect tilbage
    if (!authToken && !deviceToken) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = '/club-login.html?redirect=' + redirect;
        return;
    }

    // Device token: håndhæv locked destination
    if (!authToken && deviceToken) {
        try {
            const payload = JSON.parse(atob(deviceToken.split('.')[1]));
            if (payload.locked) {
                let expectedPath;
                const dest = payload.destination;
                if (dest.startsWith('court/')) {
                    expectedPath = `/court-v3.html?court=${dest.split('/')[1]}`;
                } else if (dest.startsWith('tv/')) {
                    expectedPath = `/tv-v3.html?court=${dest.split('/')[1]}`;
                } else {
                    const legacyMap = { tv: '/tv.html', 'tv-v3': '/tv-v3.html', oversigt: '/oversigt.html' };
                    expectedPath = legacyMap[dest] || '/';
                }
                const currentBase  = window.location.pathname;
                const expectedBase = expectedPath.split('?')[0];
                if (currentBase !== expectedBase) {
                    window.location.href = expectedPath;
                }
            }
        } catch {}
    }
})();
