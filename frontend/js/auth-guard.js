/**
 * Auth Guard — beskytter sider der tilgås via et klub-subdomain.
 * Inkludér dette script på sider der kræver auth.
 * Kompatibel med api.js.
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
    let   deviceToken = sessionStorage.getItem('deviceToken');

    // JWT-payload er base64URL (kan indeholde - og _) — normalisér før atob,
    // ellers kaster atob og et GYLDIGT token bliver fejlagtigt kasseret
    function decodeJwtPayload(jwt) {
        const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(atob(b64));
    }

    // Ryd udløbne tokens så de ikke blokerer for korrekt re-auth
    function isExpired(jwt) {
        try {
            const exp = decodeJwtPayload(jwt).exp;
            return exp && Date.now() / 1000 > exp;
        } catch { return true; }
    }
    if (authToken && isExpired(authToken)) {
        sessionStorage.removeItem('authToken');
    }
    if (deviceToken && isExpired(deviceToken)) {
        sessionStorage.removeItem('deviceToken');
        deviceToken = null;
    }

    // Ingen gyldig auth — send til klub-login med redirect tilbage
    const validAuth   = sessionStorage.getItem('authToken');
    const validDevice = deviceToken;
    if (!validAuth && !validDevice) {
        const redirect = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = '/club-login.html?redirect=' + redirect;
        return;
    }

    // Device token: håndhæv locked destination
    if (!validAuth && validDevice) {
        try {
            const payload = decodeJwtPayload(validDevice);
            if (payload.locked) {
                let expectedPath;
                const dest = payload.destination;
                if (dest.startsWith('court/')) {
                    expectedPath = `/court-v3.html?court=${dest.split('/')[1]}`;
                } else if (dest.startsWith('tv/')) {
                    expectedPath = `/tv-v3.html?court=${dest.split('/')[1]}`;
                } else {
                    const legacyMap = { tv: '/tv-v3.html', 'tv-v3': '/tv-v3.html', oversigt: '/oversigt.html' };
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
