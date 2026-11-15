// Loft over live-strømmene (SSE, GET /api/game-states/events/stream) — nr. 93.
//
// Endpointet kræver ikke login (TV, oversigt, tablets, /live og admin holder
// hver én forbindelse), og hver forbindelse er to i nginx og en lytter i
// backenden, der lever, til klienten går. Uden loft kunne én klient åbne
// tusindvis og løbe nginx' forbindelser tør for alle klubber.
//
//   - pr. adresse (CF-Connecting-IP; IPv6 pr. /64): SSE_MAKS_PR_IP. En hal bag én
//     NAT-adresse kan have 10–15 skærme, en tablet pr. bane og spillernes
//     telefoner — derfor rummeligt. Lokale net (lokal installation) tælles ikke.
//   - pr. klub: SSE_MAKS_PR_KLUB.
// Over loftet afvises den NYE forbindelse med 429 — at lukke den ældste ville
// lade én udefra smide hallens skærme af. Klienten (js/live-updates.js) poller
// imens og prøver igen, når dens vagthund slår til. Én log-linje pr. minut.

const { graenseIp, erLokaltNet } = require('../middleware/rateLimiter');

const SSE_MAKS_PR_IP = 60;
const SSE_MAKS_PR_KLUB = 300;

const _antal = new Map();       // nøgle -> åbne forbindelser
const _logget = new Map();      // nøgle -> ms for seneste log-linje

const op = (k) => _antal.set(k, (_antal.get(k) || 0) + 1);
const ned = (k) => {
    const n = (_antal.get(k) || 0) - 1;
    if (n > 0) _antal.set(k, n); else _antal.delete(k);
};

function log(noegle, tekst, nu) {
    if (nu - (_logget.get(noegle) || 0) < 60000) return;
    _logget.set(noegle, nu);
    console.warn(`[sse] ${tekst}`);
}

// Returnerer { slip } (kald slip(), når forbindelsen lukkes — flere kald er
// ufarlige) eller { afvist: tekst }
function optagSse(req, nu = Date.now()) {
    const klub = 'klub:' + (req.clubDbName || 'direct');
    const ip = erLokaltNet(req) ? null : 'ip:' + graenseIp(req);
    if (ip && (_antal.get(ip) || 0) >= SSE_MAKS_PR_IP) {
        log(ip, `${klub}: ${SSE_MAKS_PR_IP} live-strømme fra ${ip.slice(3)} — flere afvises`, nu);
        return { afvist: 'For mange åbne live-forbindelser fra denne adresse' };
    }
    if ((_antal.get(klub) || 0) >= SSE_MAKS_PR_KLUB) {
        log(klub, `${klub}: ${SSE_MAKS_PR_KLUB} live-strømme i klubben — flere afvises (sidst fra ${ip ? ip.slice(3) : 'lokalt net'})`, nu);
        return { afvist: 'For mange åbne live-forbindelser i klubben' };
    }
    op(klub);
    if (ip) op(ip);
    let sluppet = false;
    return {
        slip() {
            if (sluppet) return;
            sluppet = true;
            ned(klub);
            if (ip) ned(ip);
        }
    };
}

const _antalFor = (noegle) => _antal.get(noegle) || 0;

module.exports = { optagSse, SSE_MAKS_PR_IP, SSE_MAKS_PR_KLUB, _antalFor };
