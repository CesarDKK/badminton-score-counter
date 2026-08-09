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
        return { data, alderMs: alder, frisk: alder < TTL_TIMER * 3600 * 1000 };
    } catch {
        return null;
    }
}

function skriv(clubId, season, raw) {
    sikreMappe();
    const data = { ...raw, hentet: new Date().toISOString() };
    fs.writeFileSync(fil(clubId, season), JSON.stringify(data), 'utf8');
    return data;
}

module.exports = { laes, skriv, TTL_TIMER, DIR };
