const rateLimit = require('express-rate-limit');

// Skip rate limiting for requests fra localhost og private netværk (LAN-enheder, TV-skærme, tablets m.m.)
const skipPrivateNetwork = (req) => {
    const ip = (req.ip || '').replace('::ffff:', '');
    if (ip === '127.0.0.1' || ip === '::1') return true;
    // RFC1918 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (/^192\.168\./.test(ip)) return true;
    return false;
};

// Strict rate limit for login endpoint to prevent brute force attacks
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 10, // 10 requests per window
    message: { error: 'For mange login forsøg. Prøv igen om 5 minutter.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPrivateNetwork,
    validate: { trustProxy: false },
});

// Moderate rate limit for upload endpoints
const uploadLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 20, // 20 requests per window
    message: { error: 'For mange upload forsøg. Prøv igen om 5 minutter.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPrivateNetwork,
    validate: { trustProxy: false },
});

// General rate limit for authenticated admin endpoints
const adminLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 200, // 200 requests per window
    message: { error: 'For mange forespørgsler. Prøv igen om 5 minutter.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    skip: skipPrivateNetwork,
    validate: { trustProxy: false },
});

// Lenient rate limit for public endpoints (TV displays, court pages)
const publicLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 400, // 400 requests per window
    message: { error: 'For mange forespørgsler. Prøv igen senere.' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipPrivateNetwork,
    validate: { trustProxy: false },
});

// Klientens rigtige IP bag Cloudflare. X-Forwarded-For kan forfalskes af
// klienten (trust proxy: true stoler paa hele kaeden), CF-Connecting-IP saettes
// af Cloudflare selv. Uden Cloudflare (lokalt) falder vi tilbage til req.ip.
const klientIp = (req) => String(req.headers['cf-connecting-ip'] || req.ip || '').replace('::ffff:', '');

// badmintonplanner.dk-integrationen: eet kald pr. runde er normalen, saa 30 kald
// i minuttet pr. noegle er rigeligt til genforsoeg og stopper et loebsk system.
// Noeglen kendes foerst efter token-opslaget (req.plannerToken); indtil da
// taelles paa IP. Ingen fritagelse for private net — kaldene kommer udefra.
const plannerTokenLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => 'planner-token:' + (req.plannerToken ? req.plannerToken.id : klientIp(req)),
    message: { error: 'For mange kald. Vent lidt og prøv igen.', code: 'rate_limited' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});

// Ydre graense pr. IP (ogsaa for kald med ugyldig noegle), saa en gaettende
// klient ikke kan hamre paa token-opslaget.
const plannerIpLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 120,
    keyGenerator: (req) => 'planner-ip:' + klientIp(req),
    message: { error: 'For mange kald fra denne adresse. Prøv igen om lidt.', code: 'rate_limited' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
});

module.exports = {
    loginLimiter,
    uploadLimiter,
    adminLimiter,
    publicLimiter,
    plannerTokenLimiter,
    plannerIpLimiter,
    klientIp
};
