// Fjernstatus for TV-skærme: hvert TV sender et livstegn hvert 20. sekund med
// sit navn (fra kiosk-PC'ens config-fil), bane og evt. hændelser — huller i
// nettet ('net') eller perioder hvor browseren stod stille ('frys'). Admin ser
// listen under Adgangslinks, så en skærm kan undersøges uden at køre ud til den.
//
// Kun i hukommelsen (som SSE-hubben): statussen er "lige nu"-information, og
// hændelserne skrives desuden i backend-loggen, så de overlever en genstart.

const MAX_SKAERME = 200;          // pr. klub — et loft mod oversvømmelse
const MAX_HAENDELSER = 20;        // pr. skærm, nyeste først
const GLEM_EFTER_MS = 24 * 3600 * 1000;
// Advarsler (stod stille / uden forbindelse) vises kun den første time — ellers
// stod en enkelt gammel hændelse som en advarsel resten af dagen
const VIS_HAENDELSE_MS = 3600 * 1000;
// Et kort hul i forbindelsen (ét tabt livstegn: wifi-hik, Cloudflare, serveren
// genstartet ved deploy) er ikke en advarsel værd — først fra 1 minut, dvs.
// mindst 3 livstegn i træk der ikke kom igennem
const MIN_NET_SEK = 60;

const register = new Map();       // tenant -> Map(klientId -> skærm)

const tekst = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
const heltal = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
};

// Validerer og normaliserer en hændelse fra TV'et; null hvis den er ugyldig.
function rensHaendelse(h, nu) {
    if (!h || typeof h !== 'object') return null;
    const fra = heltal(h.fra, nu - GLEM_EFTER_MS, nu + 60000);
    if (fra === null) return null;
    if (h.type === 'frys') {
        const sek = heltal(h.sek, 1, 24 * 3600);
        return sek === null ? null : { type: 'frys', fra, sek };
    }
    if (h.type === 'net') {
        const til = heltal(h.til, fra, nu + 60000);
        return til === null ? null : { type: 'net', fra, til, sek: Math.round((til - fra) / 1000) };
    }
    return null;
}

// Registrerer et livstegn. Returnerer { skaerm, nye, ny, tilbageEfterSek }:
// nye = de hændelser der kom med dette livstegn (til logning), ny = første
// livstegn fra denne skærm, tilbageEfterSek = sekunder siden forrige livstegn,
// hvis skærmen har været tavs i over 2 minutter (ellers null).
function registrer(tenant, data, meta, nu = Date.now()) {
    const klientId = tekst(data && data.klientId, 40);
    if (!/^[a-z0-9-]{6,40}$/i.test(klientId)) return null;

    let skaerme = register.get(tenant);
    if (!skaerme) { skaerme = new Map(); register.set(tenant, skaerme); }
    ryd(skaerme, nu);

    let s = skaerme.get(klientId);
    const ny = !s;
    if (ny) {
        if (skaerme.size >= MAX_SKAERME) return null;
        s = { klientId, foersteGang: nu, haendelser: [] };
        skaerme.set(klientId, s);
    }
    const tilbageEfterSek = !ny && nu - s.sidstSet > 120000 ? Math.round((nu - s.sidstSet) / 1000) : null;

    s.navn = tekst(data.navn, 60);
    // Samme navn på samme link er samme fysiske skærm, der er startet forfra
    // (genstart, ny version, ny browserprofil) — den gamle række erstattes, så
    // den ikke står tilbage med rød lampe
    if (s.navn) {
        for (const [id, anden] of skaerme) {
            if (id !== klientId && anden.navn === s.navn && anden.tokenId === (meta.tokenId || null)) {
                // Hændelserne følger med — "stod stille" fra før en genstart er
                // netop det, man vil kunne se bagefter
                s.haendelser = [...s.haendelser, ...anden.haendelser]
                    .sort((a, b) => b.fra - a.fra).slice(0, MAX_HAENDELSER);
                skaerme.delete(id);
            }
        }
    }
    s.bane = heltal(data.bane, 1, 99);
    s.version = tekst(data.version, 20);
    s.dataAlderSek = heltal(data.dataAlderSek, 0, 7 * 24 * 3600);
    s.tokenId = meta.tokenId || null;
    s.ip = tekst(meta.ip, 64);
    s.sidstSet = nu;

    const nye = (Array.isArray(data.haendelser) ? data.haendelser : [])
        .slice(0, 10)
        .map(h => rensHaendelse(h, nu))
        .filter(Boolean);
    // TV'et sender dem i tidsorden; listen gemmes nyeste først
    s.haendelser = [...[...nye].reverse(), ...s.haendelser].slice(0, MAX_HAENDELSER);

    return { skaerm: s, nye, ny, tilbageEfterSek };
}

function ryd(skaerme, nu) {
    for (const [id, s] of skaerme) {
        if (nu - s.sidstSet > GLEM_EFTER_MS) skaerme.delete(id);
    }
}

// Hvornår en hændelse sluttede (frys: start + varighed, net: til)
const slut = (h) => h.type === 'net' ? h.til : h.fra + h.sek * 1000;

// Klubbens skærme, senest sete først, med sekunder siden sidste livstegn.
// Kun hændelser fra den seneste time kommer med.
function liste(tenant, nu = Date.now()) {
    const skaerme = register.get(tenant);
    if (!skaerme) return [];
    ryd(skaerme, nu);
    return [...skaerme.values()]
        .map(s => ({
            ...s,
            haendelser: s.haendelser.filter(h =>
                nu - slut(h) <= VIS_HAENDELSE_MS && !(h.type === 'net' && h.sek < MIN_NET_SEK)),
            sekunderSiden: Math.max(0, Math.round((nu - s.sidstSet) / 1000))
        }))
        .sort((a, b) => a.sekunderSiden - b.sekunderSiden);
}

// Admin fjerner en skærm fra listen (fx en PC der er taget ned). Sender den
// livstegn igen, kommer den bare tilbage.
function fjern(tenant, klientId) {
    const skaerme = register.get(tenant);
    return !!skaerme && skaerme.delete(String(klientId || ''));
}

function _nulstil() { register.clear(); }

module.exports = { registrer, liste, fjern, rensHaendelse, _nulstil, MAX_SKAERME, MIN_NET_SEK };
