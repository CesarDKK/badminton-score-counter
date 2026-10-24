// TV-PC'ens egen rapport (kiosk: /usr/lib/badminton-tv/rapport): hvordan forrige
// kørsel sluttede (frøs, kernenedbrud, tænd/sluk-knappen …) og browser-vagtens
// genstarter. PC'en sender med sit adgangslinks token (X-Adgangslink), så kun
// en PC med et gyldigt link kan skrive i klubbens hændelseslog.
//
// Ren logik (validering og loft) — ruten ligger i routes/screens.js.

const TYPER = new Set(['pc-brat', 'pc-panik', 'pc-knap', 'pc-genstart', 'browser-genstart']);
const MAX_PR_RAPPORT = 10;
const MAX_TEKST = 300;
const MAX_LOG = 32 * 1024;
const MAX_ALDER_MS = 30 * 24 * 3600 * 1000;
// Loft pr. adgangslink: en PC, der genstarter i ring, må ikke fylde loggen
const MAX_PR_TIME = 30;

const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
const heltal = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};

// Et adgangslinks token, som det står i /t/<token> (se routes/deviceTokens.js)
function gyldigtToken(t) {
    return typeof t === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(t);
}

// Validerer rapporten. Returnerer { navn, kioskVersion, haendelser } eller null.
function rensRapport(body, nu = Date.now()) {
    if (!body || typeof body !== 'object') return null;
    const navn = tekst(body.navn, 60);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/i.test(navn)) return null;
    const kv = tekst(body.kioskVersion, 30);
    const kioskVersion = /^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,3}([.-][0-9A-Za-z.-]+)?$/.test(kv) ? kv : '';
    if (!Array.isArray(body.haendelser) || !body.haendelser.length || body.haendelser.length > MAX_PR_RAPPORT) {
        return null;
    }
    const haendelser = [];
    for (const h of body.haendelser) {
        if (!h || typeof h !== 'object' || !TYPER.has(h.type)) continue;
        const fra = heltal(h.fra, nu - MAX_ALDER_MS, nu + 3600 * 1000);
        if (fra === null) continue;
        const til = h.til == null ? null : heltal(h.til, fra, nu + 3600 * 1000);
        if (h.til != null && til === null) continue;
        const ud = { type: h.type, fra, til, sek: til === null ? null : Math.round((til - fra) / 1000),
                     tekst: tekst(h.tekst, MAX_TEKST) || null };
        if (typeof h.log === 'string' && h.log) {
            // Er der for meget, er slutningen den interessante (der frøs PC'en)
            ud.log = h.log.length > MAX_LOG ? '… (afkortet)\n' + h.log.slice(-MAX_LOG) : h.log;
        }
        haendelser.push(ud);
    }
    return haendelser.length ? { navn, kioskVersion, haendelser } : null;
}

// Hvilken skærm i hændelsesloggen: samme navn som TV-sidens livstegn (kiosk.conf
// NAVN), så PC'ens og sidens hændelser står under den samme skærm
function skaermFor(navn, deviceToken) {
    const dest = String(deviceToken.destination || '');
    const m = dest.match(/^(?:tv|court)\/(\d+)$/);
    return {
        klientId: `pc-${navn}`.slice(0, 40),
        navn,
        side: dest === 'oversigt' ? 'oversigt' : 'tv',
        bane: m ? Number(m[1]) : null,
        tokenId: deviceToken.id
    };
}

const modtaget = new Map();   // nøgle -> [tidspunkter]

// Må denne PC melde `antal` hændelser mere i denne time?
function indenforLoft(noegle, antal, nu = Date.now()) {
    const tider = (modtaget.get(noegle) || []).filter(t => nu - t < 3600 * 1000);
    if (tider.length + antal > MAX_PR_TIME) {
        modtaget.set(noegle, tider);
        return false;
    }
    for (let i = 0; i < antal; i++) tider.push(nu);
    modtaget.set(noegle, tider);
    return true;
}

function _nulstil() { modtaget.clear(); }

module.exports = { rensRapport, skaermFor, gyldigtToken, indenforLoft, _nulstil, TYPER, MAX_PR_TIME, MAX_LOG };
