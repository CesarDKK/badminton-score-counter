/**
 * Adgangslink-vagt til enhederne (TV, bane-tablet, oversigt; loades efter api.js).
 *
 * Enhedens session gælder længe (TV: 180 dage, tablet: 14) og har bane og låsning
 * bagt ind, og TV'ets QR-valg står i adressen. Redigerer admin linket (bane, type,
 * låsning, QR), spørger enheden her hvert minut, om linket stadig peger samme sted
 * hen — og er det ændret, henter den en ny session og skifter side. Navnet alene
 * udløser intet skift.
 *
 * Sessionen fornys også, før den udløber: en tablet i holderen med samme fane
 * åben røg ellers på login-siden præcis 14 dage efter, at linket blev åbnet —
 * samme ugedag og klokkeslæt, typisk midt i den samme ugentlige træning. Er
 * sessionen over FORNY_EFTER_MS gammel (iat), byttes den ud med en ny uden at
 * genindlæse siden. Før blev den først fornyet med under 3 dage tilbage — men en
 * tablet, der sover fra den ene ugentlige træning til den næste, er kun vågen
 * få timer om ugen og ramte sjældent det vindue; en udløbet session kan ikke
 * fornys. Fornyes den hver dag, den er vågen, holder den 14 dage efter sidste
 * træning. 3-dages-reglen er tilbage som reserve for sessioner uden iat.
 * Et spærret eller slettet link kan ikke fornys (siden håndterer det selv).
 */
(function () {
    const api = window.BadmintonAPI;
    const INTERVAL_MS = 60 * 1000;
    const FORNY_EFTER_MS = 24 * 60 * 60 * 1000;
    const FORNY_FOER_MS = 3 * 24 * 60 * 60 * 1000;

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

    // Over et døgn gammel, eller (reserve) under FORNY_FOER_MS tilbage?
    // iat og exp er i sekunder
    function skalFornys(p) {
        const nu = Date.now();
        if (p.iat && nu - p.iat * 1000 > FORNY_EFTER_MS) return true;
        return !!p.exp && p.exp * 1000 - nu < FORNY_FOER_MS;
    }

    // Ny session fra serveren (samme link, samme sted): sessionen i adressen,
    // serveren sender tilbage, tages i brug her — uden genindlæsning, så en kamp
    // midt i det hele ikke forstyrres. Ren funktion, så den kan testes
    function sessionFraAdresse(url) {
        try { return new URL(url, window.location.origin).searchParams.get('dt'); } catch { return null; }
    }
    window.AdgangslinkVagt = { sessionFraAdresse, skalFornys, FORNY_EFTER_MS, FORNY_FOER_MS, tjek: () => tjek() };

    async function forny() {
        const svar = await api.request('/device-tokens/mit/skift', { method: 'POST' }, 1);
        const ny = sessionFraAdresse(svar && svar.url);
        if (!ny) return;
        sessionStorage.setItem('deviceToken', ny);
        api.token = ny;
        console.log('[adgangslink] sessionen er fornyet');
    }

    let igang = false;
    async function tjek() {
        const p = linkSession();
        if (!p || igang) return;
        igang = true;
        try {
            const nu = await api.request('/device-tokens/mit', {}, 1);
            if (!nu || !nu.destination) return;
            if (!erAendret(p, nu)) {
                if (skalFornys(p)) await forny();
                return;
            }
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
    // Også ved start: en tablet, der tændes med to dage tilbage, skal ikke vente
    // på det første minut-tjek — men først når siden er klar
    window.addEventListener('load', () => setTimeout(tjek, 3000));
})();
