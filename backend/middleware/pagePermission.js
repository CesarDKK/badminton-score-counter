// Håndhæver side-rettigheder (super-admin tildeler dem pr. klub-admin) på
// backend-siden. Før blev de kun brugt til at skjule menupunkter i admin-UI'et,
// så en admin med adgang til fx kun Holdkamp kunne ændre indstillinger, sponsorer,
// spillere og historik — og gendanne en backup — med direkte kald til API'et.
//
// Bruges EFTER authMiddleware/requireWriteAuthInClubMode (som sætter req.user).
// permissions = null betyder alle sider; super-admin, adgangslinks (device) og det
// simple direct-mode-login berøres ikke.
const harBegrænsning = (u) => !!u && u.role === 'club_admin' && Array.isArray(u.permissions);

function requirePage(pageKey) {
    return (req, res, next) => {
        const u = req.user;
        if (harBegrænsning(u) && !u.permissions.includes(pageKey)) {
            return res.status(403).json({ error: 'Din adgang omfatter ikke denne side' });
        }
        next();
    };
}

// Backup og gendannelse rører alle klubbens data (også holdkampe, historik og
// adgangslinks), så de kræver adgang til alle sider.
function requireFuldAdgang(req, res, next) {
    if (harBegrænsning(req.user)) {
        return res.status(403).json({ error: 'Backup og gendannelse kræver adgang til alle sider' });
    }
    next();
}

module.exports = { requirePage, requireFuldAdgang };
