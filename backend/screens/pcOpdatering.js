// "Installér nyeste version nu" fra admin (Adgangslinks): TV-PC'en henter ellers
// selv en ny version efter planen (kiosk: /usr/lib/badminton-tv/opdatering —
// oversigten med det samme, de andre et døgn efter udgivelsen). Kommer der nye
// versioner tit, når de andre aldrig frem — så kan admin bede en PC om at tage
// den nyeste med det samme.
//
// PC'en spørger hvert 2. minut (opdatering spoerg → POST /api/screens/pc-opdatering)
// og melder tilbage, hvordan det gik. At den spørger, viser også, at den har en
// version, der kan det — ellers vises knappen ikke.
//
// Kun i hukommelsen (som skærmenes status): en bestilling, der forsvinder ved en
// genstart af serveren, ses i admin, og knappen kan bare trykkes igen.
//
// Ren logik — ruterne ligger i routes/screens.js.

const KAN_MS = 10 * 60 * 1000;          // har spurgt inden for så lang tid = kan
const BESTILT_MAX_MS = 12 * 3600 * 1000; // en PC, der ikke spørger, glemmer man
const VIS_MS = 24 * 3600 * 1000;         // tilbagemeldingen vises så længe
// Efter "genstarter" er PC'en et par minutter om at spørge igen. Spørger den
// derefter med den gamle version, startede den nye ikke (eller blev ikke godkendt)
const GENSTART_MS = 2 * 60 * 1000;

// Hvad PC'en melder (status i POST'en)
const PC_STATUS = new Set(['i-gang', 'venter', 'genstarter', 'nyeste', 'fra', 'kan-ikke', 'fejl']);
// … og hvornår bestillingen er færdig (PC'en skal ikke spørges igen)
const SLUT = new Set(['genstarter', 'nyeste', 'fra', 'kan-ikke', 'fejl']);

const VERSION = /^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,3}([.-][0-9A-Za-z.-]+)?$/;

const register = new Map();   // tenant -> Map(`${tokenId}:${navn}` -> tilstand)

const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const noegle = (tokenId, navn) => `${tokenId}:${navn}`;

function hent(tenant, tokenId, navn, opret) {
    let pcer = register.get(tenant);
    if (!pcer) {
        if (!opret) return null;
        pcer = new Map();
        register.set(tenant, pcer);
    }
    let t = pcer.get(noegle(tokenId, navn));
    if (!t && opret) {
        if (pcer.size >= 200) return null;   // loft pr. klub, som skærmlisten
        t = { sidstSpurgt: null, bestilt: null, status: null, tekst: '', tid: null, maal: '' };
        pcer.set(noegle(tokenId, navn), t);
    }
    return t;
}

function saetStatus(t, status, tekstStr, nu, maal) {
    t.status = status;
    t.tekst = tekstStr || '';
    t.tid = nu;
    if (maal !== undefined) t.maal = maal;
}

// Validerer PC'ens POST. Returnerer { navn, kioskVersion, status, tekst, maal } eller null.
function rensMelding(body) {
    if (!body || typeof body !== 'object') return null;
    const navn = tekst(body.navn, 60);
    if (!/^[a-z0-9][a-z0-9-]{0,59}$/i.test(navn)) return null;
    const kv = tekst(body.kioskVersion, 30);
    const status = body.status == null || body.status === '' ? null : String(body.status);
    if (status !== null && !PC_STATUS.has(status)) return null;
    const maal = tekst(body.maal, 30);
    return {
        navn,
        kioskVersion: VERSION.test(kv) ? kv : '',
        status,
        tekst: tekst(body.tekst, 300),
        maal: VERSION.test(maal) ? maal : ''
    };
}

// PC'en spørger (og melder evt. status). Returnerer { opdater } — true: hent
// nyeste version nu og genstart, når den er klar.
function spoerg(tenant, tokenId, m, nu = Date.now()) {
    const t = hent(tenant, tokenId, m.navn, true);
    if (!t) return { opdater: false };
    t.sidstSpurgt = nu;
    t.kioskVersion = m.kioskVersion;

    if (m.status) {
        if (t.bestilt || m.status === 'genstarter') {
            saetStatus(t, m.status, m.tekst, nu, m.status === 'genstarter' ? m.maal : t.maal);
        }
        if (SLUT.has(m.status)) t.bestilt = null;
    } else if (t.status === 'genstarter' && m.kioskVersion) {
        // Første spørgsmål efter genstarten: kører den nye version?
        if (m.kioskVersion === t.maal) {
            saetStatus(t, 'opdateret', '', nu);
        } else if (t.maal && nu - t.tid > GENSTART_MS) {
            saetStatus(t, 'mislykket', '', nu);
        }
    } else if (t.status === 'opdateret' && t.maal && m.kioskVersion && m.kioskVersion !== t.maal) {
        // Den nye version startede, men blev ikke godkendt (TV-siden kom ikke frem
        // inden for 20 minutter) — PC'en er gået tilbage til den gamle
        saetStatus(t, 'mislykket', '', nu);
    }

    if (t.bestilt && nu - t.bestilt > BESTILT_MAX_MS) {
        t.bestilt = null;
        saetStatus(t, null, '', null);
    }
    return { opdater: !!t.bestilt };
}

// Admin trykker på knappen. Returnerer 'ok' | 'kan-ikke' (PC'en har ikke
// spurgt for nylig: ældre version, slukket eller uden net).
function bestil(tenant, tokenId, navn, nu = Date.now()) {
    const t = hent(tenant, tokenId, navn, false);
    if (!t || !t.sidstSpurgt || nu - t.sidstSpurgt > KAN_MS) return 'kan-ikke';
    t.bestilt = nu;
    saetStatus(t, 'bestilt', '', nu, '');
    return 'ok';
}

// Admin fortryder, før PC'en er gået i gang. Returnerer true, hvis der var noget at fortryde.
function fortryd(tenant, tokenId, navn) {
    const t = hent(tenant, tokenId, navn, false);
    if (!t || t.status !== 'bestilt') return false;
    t.bestilt = null;
    saetStatus(t, null, '', null);
    return true;
}

// Til admins skærmliste: { kan, status, tekst, tid, maal } eller null
function forSkaerm(tenant, tokenId, navn, nu = Date.now()) {
    if (!navn || tokenId == null) return null;
    const t = hent(tenant, tokenId, navn, false);
    if (!t) return null;
    const vis = t.status && (t.bestilt || nu - t.tid <= VIS_MS);
    return {
        kan: !!t.sidstSpurgt && nu - t.sidstSpurgt <= KAN_MS,
        status: vis ? t.status : null,
        tekst: vis ? t.tekst : '',
        tid: vis ? t.tid : null,
        maal: vis ? t.maal : ''
    };
}

function _nulstil() { register.clear(); }

module.exports = { rensMelding, spoerg, bestil, fortryd, forSkaerm, _nulstil, KAN_MS, BESTILT_MAX_MS, GENSTART_MS };
