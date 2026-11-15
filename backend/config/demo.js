// Demoen (app.<domæne>) er bevidst åben: alle kan logge ind med den kendte
// adgangskode. Den deler proces, disk og hukommelse med klubberne, så det, der
// fylder, har et loft dér — ellers kunne hvem som helst fylde serverens disk
// eller optage processen for alle klubber.
//
// Demoen er alt andet end en klub på en server med klubber (APP_DOMAIN sat): ikke
// kun app. (accessMode 'direct'), men også admin. ('admin') og roden, mail.,
// smtp. og ftp. ('marketing') — dér er databasen og upload-mappen stadig
// demoens, så lofterne kunne omgås ved at sende de samme kald til admin.-
// adressen (nr. 64). Super-admins egne ruter (/api/super-admin) bruger ikke
// erDemo. En lokal installation uden klubber (ingen APP_DOMAIN) er klubbens
// egen og har ingen loft.

const MB = 1024 * 1024;

// "Gendan fra fil" på demoen: filen læses i hukommelsen og fortolkes i ét stræk
const DEMO_GENDAN_MAKS = 10 * MB;

// Demoens mappe i uploads/ (sponsorbilleder og livestream-logo) i alt
const DEMO_LAGER_MAKS = 50 * MB;

const erDemo = (req) => req.accessMode !== 'club' && !!process.env.APP_DOMAIN;

// Det samme for et job i scheduleren: demoens database er 'direct' (klubbernes
// har deres db-navn)
const erDemoDb = (dbLabel) => (dbLabel || 'direct') === 'direct' && !!process.env.APP_DOMAIN;

// Turneringer fra tournamentsoftware med automatisk opdatering (nr. 91): uden
// loft kunne hvem som helst lade serveren hente fra tournamentsoftware hvert
// 4. minut for et vilkårligt antal turneringer — i det uendelige.
const DEMO_AUTO_SYNC_MAKS = 2;                    // turneringer med auto-sync
const DEMO_AUTO_SYNC_USET_MS = 24 * 3600 * 1000;  // stop, når ingen har set den i et døgn
const DEMO_SYNC_PAUSE_MS = 2 * 60 * 1000;         // mellem to hentninger af samme turnering

module.exports = { erDemo, erDemoDb, DEMO_GENDAN_MAKS, DEMO_LAGER_MAKS, MB,
    DEMO_AUTO_SYNC_MAKS, DEMO_AUTO_SYNC_USET_MS, DEMO_SYNC_PAUSE_MS };
