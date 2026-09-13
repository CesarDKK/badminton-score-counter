// Håndhæver side-rettigheder (super-admin tildeler dem pr. klub-admin) på
// backend-siden. Hidtil blev de kun brugt til at skjule menupunkter i admin-UI'et;
// for integrationsfanen skal API'et selv afvise, så en admin uden adgang ikke
// kan oprette nøgler eller ændre tidsvinduer via et direkte kald.
//
// Bruges EFTER authMiddleware (som sætter req.user). permissions = null betyder
// alle sider; super-admin og det simple direct-mode-login har altid adgang.
function requirePage(pageKey) {
    return (req, res, next) => {
        const u = req.user;
        if (u && u.role === 'club_admin' && Array.isArray(u.permissions) && !u.permissions.includes(pageKey)) {
            return res.status(403).json({ error: 'Din adgang omfatter ikke denne side' });
        }
        next();
    };
}

module.exports = { requirePage };
