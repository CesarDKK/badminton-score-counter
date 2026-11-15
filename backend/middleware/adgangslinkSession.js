const jwt = require('jsonwebtoken');

// Enhedens session og adresse for et adgangslink (device_tokens-rækken).
// Bruges, når enheden åbner sit link (/t/:token), og når et redigeret link
// skal slå igennem på en enhed, der allerede kører (/api/device-tokens/mit/skift).
//
// Faste enheder (TV/bane-tablet) får en lang session, så de ikke skal åbne
// adgangslinket igen midt i en turnering. Match-session (QR-tæller) er kortlivet
// pr. kamp og bevarer 12t. TV og oversigt kører i kiosk, uden at nogen rører
// dem — står PC'en tændt i over 14 dage, endte TV'et på login-siden ved næste
// auto-opdatering. Et spærret eller slettet link afvises stadig ved hver request.
function adgangslinkSession(deviceToken, clubSubdomain) {
    const erSkaerm = /^(tv|oversigt)/.test(deviceToken.destination || '');
    const sessionTtl = deviceToken.token_type === 'match_session' ? '12h' : (erSkaerm ? '180d' : '14d');
    const sessionToken = jwt.sign(
        {
            role: 'device',
            tokenId: deviceToken.id,
            destination: deviceToken.destination,
            locked: deviceToken.locked,
            tokenType: deviceToken.token_type || 'permanent',
            clubSubdomain
        },
        process.env.JWT_SECRET,
        { expiresIn: sessionTtl }
    );
    return { sessionToken, url: adgangslinkAdresse(deviceToken, sessionToken) };
}

// Siden, linket åbner — v2-siderne er udfaset, alt peger på v3
function adgangslinkAdresse(deviceToken, sessionToken) {
    const dest = deviceToken.destination;
    if (dest.startsWith('tv/')) {
        // QR-flag per-token: tilladelsen kombineres med klub-mode på TV-siden
        const qrFlag = deviceToken.show_qr_on_tv ? '1' : '0';
        return `/tv-v3.html?court=${dest.split('/')[1]}&dt=${sessionToken}&qr=${qrFlag}`;
    }
    if (dest.startsWith('court/')) {
        return `/court-v3.html?court=${dest.split('/')[1]}&dt=${sessionToken}`;
    }
    // Legacy destinations
    const legacyMap = { tv: '/tv-v3.html', 'tv-v3': '/tv-v3.html', oversigt: '/oversigt.html' };
    return `${legacyMap[dest] || sikkerSti(dest)}?dt=${sessionToken}`;
}

// Destinationen kan komme fra data, admin ikke har indtastet her — fx en
// gendannet backup (nr. 92). '/' + '/evil.com' gav '//evil.com?dt=<session>':
// en omdirigering til en fremmed vært, der fik sessionen med. Kun en relativ
// sti på egen vært (bogstaver, tal, . _ - og /, begyndende med et bogstav
// eller tal, uden '..') — alt andet åbner forsiden.
function sikkerSti(dest) {
    const d = String(dest || '');
    return /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9._-]+)*$/i.test(d) && !d.split('/').includes('..') ? '/' + d : '/';
}

module.exports = { adgangslinkSession, sikkerSti };
