const jwt = require('jsonwebtoken');

// "Jeg er her stadig" på admin-siderne: et nyt token med samme indhold (rolle,
// klub, side-rettigheder, adgangskode-aftryk) og samme levetid som det, brugeren
// har nu. Kun et gyldigt (ikke udløbet) token kan fornyes — det tjekkes af
// authMiddleware før dette kaldes.
//
// Uden en øvre grænse ville et stjålet token kunne holdes i live for evigt, så
// tokenet bærer tidspunktet for det oprindelige login (loggetInd), og efter en
// uge skal man logge ind igen.
const MAKS_SESSION_SEK = 7 * 24 * 3600;

// Returnerer det nye token, eller null når sessionen har nået ugegrænsen.
function fornyetToken(decoded, nu = Math.floor(Date.now() / 1000)) {
    const { iat, exp, nbf, ...indhold } = decoded;
    if (!iat || !exp) return null;
    const loggetInd = indhold.loggetInd || iat;
    const tilbage = loggetInd + MAKS_SESSION_SEK - nu;
    if (tilbage <= 60) return null;
    return jwt.sign(
        { ...indhold, loggetInd, iat: nu },
        process.env.JWT_SECRET,
        { expiresIn: Math.min(exp - iat, tilbage) }
    );
}

module.exports = { fornyetToken, MAKS_SESSION_SEK };
