/**
 * Adgangslink-vagt til enhederne (TV, bane-tablet, oversigt; loades efter api.js).
 *
 * Enhedens session gælder længe (TV: 180 dage) og har bane og låsning bagt ind,
 * og TV'ets QR-valg står i adressen. Redigerer admin linket (bane, type, låsning,
 * QR), spørger enheden her hvert minut, om linket stadig peger samme sted hen —
 * og er det ændret, henter den en ny session og skifter side. Navnet alene
 * udløser intet skift.
 */
(function () {
    const api = window.BadmintonAPI;
    const INTERVAL_MS = 60 * 1000;

    // Sessionen fra enhedens faste adgangslink — ikke et admin-login eller en QR-tæller
    function linkSession() {
        const token = sessionStorage.getItem('deviceToken');
        if (!token || api.token !== token) return null;
        try {
            const p = window.decodeJwtPayload(token);
            return p.role === 'device' && p.tokenId && p.tokenType !== 'match_session' ? p : null;
        } catch { return null; }
    }

    function erAendret(p, nu) {
        if (nu.destination !== p.destination) return true;
        if (!!nu.locked !== !!p.locked) return true;
        // QR-valget står i TV-adressen (?qr=1/0); ældre adresser uden flag springes over
        const qr = new URLSearchParams(window.location.search).get('qr');
        return nu.destination.startsWith('tv/') && qr !== null && qr !== (nu.showQrOnTv ? '1' : '0');
    }

    let igang = false;
    async function tjek() {
        const p = linkSession();
        if (!p || igang) return;
        igang = true;
        try {
            const nu = await api.request('/device-tokens/mit', {}, 1);
            if (!nu || !nu.destination || !erAendret(p, nu)) return;
            const svar = await api.request('/device-tokens/mit/skift', { method: 'POST' }, 1);
            // Skærmens navn og TV-PC'ens version (fra kiosk-PC'en) følger med videre
            const ny = new URL(svar.url, window.location.origin);
            const her = new URLSearchParams(window.location.search);
            for (const k of ['skaerm', 'kioskversion']) {
                if (her.get(k)) ny.searchParams.set(k, her.get(k));
            }
            console.log('[adgangslink] linket er ændret — skifter til', ny.pathname);
            window.location.replace(ny.pathname + ny.search);
        } catch {
            // Intet net eller tilbagekaldt link (det håndterer siden selv) — prøv igen senere
        } finally {
            igang = false;
        }
    }

    setInterval(tjek, INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) tjek(); });
})();
