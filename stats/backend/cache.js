/**
 * Diskcache for indsamlede sæsoner.
 *
 * En hel klubsæson koster ~300 kald mod badmintonplayer og tager minutter, så
 * resultatet gemmes og genbruges. Rådata gemmes (ikke det færdigregnede), så
 * statistikken kan laves om uden at hente alt igen.
 */

const fs = require('fs');
const path = require('path');

const DIR = process.env.CACHE_DIR || '/data/cache';
const TTL_TIMER = Number(process.env.CACHE_TTL_HOURS) || 24;
// Et tomt resultat (0 hold) kan skyldes en forbigående fejl eller et forkert
// klubnavn — det holder derfor kun kort, så det ikke sætter sig fast et døgn.
const TOM_TTL_TIMER = Number(process.env.CACHE_EMPTY_TTL_HOURS) || 1;

function erTomt(data) {
    return !data || !Array.isArray(data.hold) || data.hold.length === 0;
}

/**
 * Hæves når indsamlingen begynder at gemme noget nyt (fx sejr/nederlag pr.
 * disciplin). Gamle filer regnes så for forældede: de vises stadig med det
 * samme, men hentes forfra i baggrunden i stedet for at mangle felter.
 */
const DATA_VERSION = 3;

function sikreMappe() {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function fil(clubId, season) {
    return path.join(DIR, `klub-${String(clubId).replace(/\D/g, '')}-${String(season).replace(/\D/g, '')}.json`);
}

function laes(clubId, season) {
    try {
        const p = fil(clubId, season);
        if (!fs.existsSync(p)) return null;
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        const alder = Date.now() - new Date(data.hentet).getTime();
        const nyNok = (data.version || 1) >= DATA_VERSION;
        const ttl = (erTomt(data) ? TOM_TTL_TIMER : TTL_TIMER) * 3600 * 1000;
        return { data, alderMs: alder, frisk: nyNok && alder < ttl };
    } catch {
        return null;
    }
}

function skriv(clubId, season, raw) {
    sikreMappe();
    // Anti-forgiftning: et tomt resultat (0 hold) må aldrig fortrænge gode data.
    // Et forkert klubnavn eller en opstrømsfejl kan give 0 hold — findes der
    // allerede en hentning med hold, beholder vi den. Er der ingen gamle data,
    // gemmes også det tomme (med kort TTL), så vi ikke genhenter i en løkke.
    if (erTomt(raw)) {
        const gammel = laes(clubId, season);
        if (gammel && !erTomt(gammel.data)) return gammel.data;
    }
    const data = { ...raw, version: DATA_VERSION, hentet: new Date().toISOString() };
    fs.writeFileSync(fil(clubId, season), JSON.stringify(data), 'utf8');
    return data;
}

module.exports = { laes, skriv, TTL_TIMER, DIR, DATA_VERSION };
