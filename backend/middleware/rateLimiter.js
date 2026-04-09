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

module.exports = {
    loginLimiter,
    uploadLimiter,
    adminLimiter,
    publicLimiter
};
