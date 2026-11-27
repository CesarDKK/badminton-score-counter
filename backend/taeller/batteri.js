// Tablets' batteri til admin — kun klubbens egne tablets (et fast adgangslink til
// en bane), aldrig en privat telefon, der tæller via QR-koden eller uret.
//
// Tælleren sender batteriet med sit livstegn hvert 10. sekund (court-script-v3.js,
// navigator.getBattery()). Det er "lige nu"-information som skærmenes status
// (screens/skaermStatus.js): kun i hukommelsen, væk efter en genstart af serveren,
// og tilbage med næste livstegn.

const MAX_ENHEDER = 200;              // pr. klub — et loft mod oversvømmelse
const GLEM_EFTER_MS = 24 * 3600 * 1000;

const register = new Map();           // tenant -> Map(`${tokenId}:${taellerId}` -> enhed)

// Kun et fast adgangslink til en bane (court/N) — ikke QR-sessionen (telefonen),
// ikke uret, ikke skærm-links og ikke admin-login
function erKlubbensTablet(user) {
    return !!user && user.role === 'device' && !!user.tokenId
        && user.tokenType !== 'match_session' && user.via !== 'ur'
        && /^court\/\d+$/.test(user.destination || '');
}

// { niveau: 0..1 eller 0..100, lader: bool } → { procent, lader } eller null
function rensBatteri(b) {
    if (!b || typeof b !== 'object') return null;
    let n = Number(b.niveau);
    if (!Number.isFinite(n) || n < 0) return null;
    if (n <= 1) n *= 100;             // browseren giver 0..1
    if (n > 100) return null;
    return { procent: Math.round(n), lader: b.lader === true };
}

function ryd(enheder, nu) {
    for (const [k, e] of enheder) if (nu - e.sidstSet > GLEM_EFTER_MS) enheder.delete(k);
}

// Registrerer batteriet fra et livstegn. Returnerer enheden eller null.
function registrer(tenant, user, { taellerId, bane, enhed, batteri }, nu = Date.now()) {
    if (!erKlubbensTablet(user) || !taellerId) return null;
    const b = rensBatteri(batteri);
    if (!b) return null;

    let enheder = register.get(tenant);
    if (!enheder) { enheder = new Map(); register.set(tenant, enheder); }
    ryd(enheder, nu);

    const noegle = `${user.tokenId}:${taellerId}`;
    let e = enheder.get(noegle);
    if (!e) {
        if (enheder.size >= MAX_ENHEDER) return null;
        e = { tokenId: user.tokenId, kort: String(taellerId).slice(0, 8) };
        enheder.set(noegle, e);
    }
    const baneNr = parseInt(bane, 10);
    e.bane = Number.isFinite(baneNr) ? baneNr : null;
    e.enhed = String(enhed || 'Tablet').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'Tablet';
    e.procent = b.procent;
    e.lader = b.lader;
    e.sidstSet = nu;
    return e;
}

// Klubbens tablets til admin, nyeste livstegn først
function liste(tenant, nu = Date.now()) {
    const enheder = register.get(tenant);
    if (!enheder) return [];
    ryd(enheder, nu);
    return [...enheder.values()]
        .map(e => ({ ...e, sekunderSiden: Math.max(0, Math.round((nu - e.sidstSet) / 1000)) }))
        .sort((a, b) => a.sekunderSiden - b.sekunderSiden);
}

function _nulstil() { register.clear(); }

module.exports = { erKlubbensTablet, rensBatteri, registrer, liste, _nulstil, GLEM_EFTER_MS };
