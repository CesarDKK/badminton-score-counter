const masterDb = require('../config/masterDatabase');
const { runWithTenant } = require('../config/tenantPools');

const DIRECT_SUBDOMAINS  = new Set(['app', 'api']);
const SKIP_SUBDOMAINS    = new Set(['www', 'mail', 'smtp', 'ftp']);

async function tenantMiddleware(req, res, next) {
    const appDomain = process.env.APP_DOMAIN; // fx 'badmintonapp.dk'
    const hostname  = req.hostname;

    // Ingen APP_DOMAIN, eller hostname matcher ikke domænet (lokal/IP-adgang) → direkte adgang
    if (!appDomain || (!hostname.endsWith('.' + appDomain) && hostname !== appDomain)) {
        req.accessMode = 'direct';
        return next();
    }

    // Udtræk subdomain (tomt streng hvis rod-domæne)
    const subdomain = hostname === appDomain
        ? ''
        : hostname.slice(0, -(appDomain.length + 1));

    // Rod-domæne eller skip-subdomains (www, mail, ...) → marketing
    if (!subdomain || SKIP_SUBDOMAINS.has(subdomain)) {
        req.accessMode = 'marketing';
        return next();
    }

    // app. / api. → direkte adgang til appen
    if (DIRECT_SUBDOMAINS.has(subdomain)) {
        req.accessMode = 'direct';
        return next();
    }

    // admin. → super admin adgang
    if (subdomain === 'admin') {
        req.accessMode = 'admin';
        return next();
    }

    // Klub-subdomain → opslag i master DB
    let club;
    try {
        club = await masterDb.queryOne(
            'SELECT db_name, is_active FROM clubs WHERE subdomain = ?',
            [subdomain]
        );
    } catch (error) {
        console.error('Tenant lookup fejl:', error.message);
        return res.status(500).json({ error: 'Serverfejl' });
    }

    if (!club) {
        return res.status(404).send('Klub ikke fundet');
    }

    if (!club.is_active) {
        return res.status(403).send('Klub er deaktiveret');
    }

    req.accessMode = 'club';
    req.clubSubdomain = subdomain;
    req.clubDbName = club.db_name;

    runWithTenant(club.db_name, next);
}

module.exports = tenantMiddleware;
