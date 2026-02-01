const rateLimit = require('express-rate-limit');

// Strict rate limit for login endpoint to prevent brute force attacks
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: {
        error: 'For mange login forsøg. Prøv igen om 15 minutter.'
    },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
    validate: { trustProxy: false }, // Disable validation when behind nginx proxy
});

// Moderate rate limit for upload endpoints
const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 requests per window
    message: {
        error: 'For mange upload forsøg. Prøv igen om 15 minutter.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable validation when behind nginx proxy
});

// General rate limit for authenticated admin endpoints
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: {
        error: 'For mange forespørgsler. Prøv igen om 15 minutter.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests from count (optional - allows unlimited success, limits failures)
    skipSuccessfulRequests: false,
    validate: { trustProxy: false }, // Disable validation when behind nginx proxy
});

// Lenient rate limit for public endpoints (TV displays, court pages)
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200, // 200 requests per window
    message: {
        error: 'For mange forespørgsler. Prøv igen senere.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false }, // Disable validation when behind nginx proxy
});

module.exports = {
    loginLimiter,
    uploadLimiter,
    adminLimiter,
    publicLimiter
};
