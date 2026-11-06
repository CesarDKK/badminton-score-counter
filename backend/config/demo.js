// Demoen (app.<domæne>) er bevidst åben: alle kan logge ind med den kendte
// adgangskode. Den deler proces, disk og hukommelse med klubberne, så det, der
// fylder, har et loft dér — ellers kunne hvem som helst fylde serverens disk
// eller optage processen for alle klubber.
//
// Demoen er direkte adgang på en server med klubber (APP_DOMAIN sat). En lokal
// installation uden klubber (ingen APP_DOMAIN) er klubbens egen og har ingen loft.

const MB = 1024 * 1024;

// "Gendan fra fil" på demoen: filen læses i hukommelsen og fortolkes i ét stræk
const DEMO_GENDAN_MAKS = 10 * MB;

// Demoens mappe i uploads/ (sponsorbilleder og livestream-logo) i alt
const DEMO_LAGER_MAKS = 50 * MB;

const erDemo = (req) => req.accessMode === 'direct' && !!process.env.APP_DOMAIN;

module.exports = { erDemo, DEMO_GENDAN_MAKS, DEMO_LAGER_MAKS, MB };
