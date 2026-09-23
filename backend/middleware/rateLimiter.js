const rateLimit = require('express-rate-limit');

// Klientens rigtige IP-adresse — det, grænserne tæller på.
//
// Bag Cloudflare sætter Cloudflare selv CF-Connecting-IP. Uden Cloudflare (lokal
// installation) sætter vores egen nginx X-Real-IP til forbindelsens adresse og
// overskriver en medsendt værdi. X-Forwarded-For bruges IKKE: den første adresse
// i kæden skriver klienten selv, så med den kunne man få en ny tæller pr. forsøg
// ("X-Forwarded-For: <tilfældig>") eller slippe helt ("10.0.0.1" = lokalt net).
// (Den, der går uden om Cloudflare, kan stadig sætte CF-Connecting-IP selv —
// det lukkes i nginx/firewallen, ikke her.)
function klientIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const ip = req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '';
    return String(ip).trim().replace('::ffff:', '');
}

// Lokale net (TV'er og tablets i en lokal installation) fritages — men kun når
// trafikken ikke kommer via Cloudflare. Bag Cloudflare er adressen altid klientens
// offentlige, og en "privat" CF-Connecting-IP er forfalsket.
function erLokaltNet(req) {
    if (req.headers['cf-connecting-ip']) return false;
    const ip = klientIp(req);
    if (ip === '127.0.0.1' || ip === '::1') return true;
    // RFC1918 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    return false;
}

// Vi tæller selv på klientIp; express-rate-limit skal ikke advare om trust proxy / X-Forwarded-For
const FAELLES = { standardHeaders: true, legacyHeaders: false, validate: false };

// Login (klub-admin og det simple admin-login): 10 forsøg pr. 5 min pr. IP
const loginLimiter = rateLimit({
    ...FAELLES,
    windowMs: 5 * 60 * 1000,
    max: 10,
    keyGenerator: (req) => 'login:' + klientIp(req),
    message: { error: 'For mange login forsøg. Prøv igen om 5 minutter.' },
    skip: erLokaltNet,
});

// Super-admin styrer alle klubber: strammere grænse og ingen fritagelse
const superAdminLoginLimiter = rateLimit({
    ...FAELLES,
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => 'super-admin-login:' + klientIp(req),
    message: { error: 'For mange login forsøg. Prøv igen om 15 minutter.' },
});

// Upload: 20 pr. 5 min pr. IP
const uploadLimiter = rateLimit({
    ...FAELLES,
    windowMs: 5 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => 'upload:' + klientIp(req),
    message: { error: 'For mange upload forsøg. Prøv igen om 5 minutter.' },
    skip: erLokaltNet,
});

// badmintonplanner.dk-integrationen: eet kald pr. runde er normalen, saa 30 kald
// i minuttet pr. noegle er rigeligt til genforsoeg og stopper et loebsk system.
// Noeglen kendes foerst efter token-opslaget (req.plannerToken); indtil da
// taelles paa IP. Ingen fritagelse for private net — kaldene kommer udefra.
const plannerTokenLimiter = rateLimit({
    ...FAELLES,
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => 'planner-token:' + (req.plannerToken ? req.plannerToken.id : klientIp(req)),
    message: { error: 'For mange kald. Vent lidt og prøv igen.', code: 'rate_limited' },
});

// Ydre graense pr. IP (ogsaa for kald med ugyldig noegle), saa en gaettende
// klient ikke kan hamre paa token-opslaget.
const plannerIpLimiter = rateLimit({
    ...FAELLES,
    windowMs: 5 * 60 * 1000,
    max: 120,
    keyGenerator: (req) => 'planner-ip:' + klientIp(req),
    message: { error: 'For mange kald fra denne adresse. Prøv igen om lidt.', code: 'rate_limited' },
});

module.exports = {
    loginLimiter,
    superAdminLoginLimiter,
    uploadLimiter,
    plannerTokenLimiter,
    plannerIpLimiter,
    klientIp,
    erLokaltNet
};
