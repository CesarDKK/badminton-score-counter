/**
 * statistik.badmintonapp.dk — backend.
 *
 * Selvstændig service, adskilt fra pointtællingens backend, så en langvarig
 * indsamling aldrig kan påvirke en kamp der er i gang.
 *
 * Al kontakt med badmintonplayer.dk sker herfra (browseren kan ikke selv, både
 * på grund af CORS og fordi vi skal kunne styre tempoet). Der køres ét job ad
 * gangen, med pause mellem hvert kald opstrøms, og resultatet caches et døgn.
 */

const express = require('express');
const bp = require('./badmintonplayer');
const { harvestClub } = require('./harvest');
const { aggregate } = require('./aggregate');
const cache = require('./cache');

const app = express();
const PORT = Number(process.env.PORT) || 3002;

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// ── Jobs ────────────────────────────────────────────────────────────────────
// Ét job ad gangen. Resten venter i kø, så vi aldrig kører to indsamlinger
// samtidig mod badmintonplayer.
const jobs = new Map();
const koe = [];
let koerer = false;
let jobTaeller = 0;

function jobNoegle(clubId, season) { return `${clubId}:${season}`; }

function findJob(clubId, season) {
    const n = jobNoegle(clubId, season);
    for (const j of jobs.values()) {
        if (j.noegle === n && (j.status === 'venter' || j.status === 'kører')) return j;
    }
    return null;
}

function opretJob({ clubId, clubName, season }) {
    const eksisterende = findJob(clubId, season);
    if (eksisterende) return eksisterende;

    const job = {
        id: `j${++jobTaeller}`,
        noegle: jobNoegle(clubId, season),
        clubId, clubName, season,
        status: 'venter',
        fase: 'i kø',
        faerdig: 0,
        total: 0,
        koePlads: koe.length + (koerer ? 1 : 0),
        startet: null,
        sluttet: null,
        fejl: null
    };
    jobs.set(job.id, job);
    koe.push(job);
    behandlKoe();
    return job;
}

async function behandlKoe() {
    if (koerer) return;
    const job = koe.shift();
    if (!job) return;
    koerer = true;
    job.status = 'kører';
    job.startet = new Date().toISOString();
    job.fase = 'starter';
    try {
        const raw = await harvestClub({
            clubId: job.clubId,
            clubName: job.clubName,
            season: job.season,
            onProgress: ({ fase, faerdig, total }) => {
                job.fase = fase; job.faerdig = faerdig; job.total = total;
            }
        });
        cache.skriv(job.clubId, job.season, raw);
        job.status = 'færdig';
    } catch (e) {
        job.status = 'fejlet';
        job.fejl = String(e && e.message ? e.message : e);
    }
    job.sluttet = new Date().toISOString();
    koerer = false;
    // Opdatér købesked til dem der stadig venter
    koe.forEach((j, i) => { j.koePlads = i; });
    setTimeout(behandlKoe, 250);
}

// Ryd op i gamle jobs så kortet ikke vokser i det uendelige
setInterval(() => {
    const graense = Date.now() - 3600 * 1000;
    for (const [id, j] of jobs) {
        if (j.sluttet && new Date(j.sluttet).getTime() < graense) jobs.delete(id);
    }
}, 600 * 1000).unref();

// ── Simpel per-IP-bremse på at starte nye indsamlinger ───────────────────────
const startTider = new Map();
const START_MAKS = Number(process.env.START_MAKS) || 5;
const START_VINDUE_MS = 60 * 60 * 1000;

function maaStarte(ip) {
    const nu = Date.now();
    const liste = (startTider.get(ip) || []).filter((t) => nu - t < START_VINDUE_MS);
    if (liste.length >= START_MAKS) { startTider.set(ip, liste); return false; }
    liste.push(nu);
    startTider.set(ip, liste);
    return true;
}

// ── Ruter ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => res.json({ ok: true, koerer, iKoe: koe.length }));

/** Sæsoner, nyeste først. Badmintonplayer har data fra 2010/2011 og frem. */
app.get('/api/seasons', (req, res) => {
    const nu = new Date();
    // Sæsonen skifter om sommeren: fra og med juli hører vi til det nye år.
    const nyeste = nu.getMonth() >= 6 ? nu.getFullYear() : nu.getFullYear() - 1;
    const ud = [];
    for (let aar = nyeste; aar >= 2010; aar--) ud.push({ id: String(aar), navn: `${aar}/${aar + 1}` });
    res.json({ seasons: ud });
});

app.get('/api/clubs', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.status(400).json({ fejl: 'Skriv mindst to bogstaver af klubnavnet.' });
    try {
        const r = await bp.searchClub(q);
        res.json(r);
    } catch (e) {
        res.status(502).json({ fejl: 'Kunne ikke søge hos badmintonplayer.dk lige nu.', detalje: String(e.message || e) });
    }
});

/**
 * Statistik for en klub og sæson.
 * 200 → data ligger klar. 202 → indsamling er sat i gang, spørg /api/jobs/:id.
 */
app.get('/api/stats', (req, res) => {
    const clubId = String(req.query.clubId || '').trim();
    const clubName = String(req.query.clubName || '').trim();
    const season = String(req.query.season || '').trim();
    if (!/^\d+$/.test(clubId) || !/^\d{4}$/.test(season) || !clubName) {
        return res.status(400).json({ fejl: 'clubId, clubName og season skal angives.' });
    }

    const cached = cache.laes(clubId, season);

    if (cached) {
        // Er data blevet gamle, sendes de alligevel med det samme — og en ny
        // indsamling sættes i gang i baggrunden, så næste besøgende får friske
        // tal uden at nogen skal vente i fem minutter.
        if (!cached.frisk && !findJob(clubId, season)) opretJob({ clubId, clubName, season });
        return res.json({
            status: 'klar',
            forældet: !cached.frisk,
            alderTimer: Math.round(cached.alderMs / 3600000),
            data: aggregate(cached.data)
        });
    }

    const igangvaerende = findJob(clubId, season);
    if (igangvaerende) return res.status(202).json({ status: 'i gang', job: igangvaerende });

    if (!maaStarte(req.ip)) {
        return res.status(429).json({ fejl: 'Der er hentet mange klubber fra denne forbindelse den seneste time. Prøv igen senere.' });
    }
    const job = opretJob({ clubId, clubName, season });
    res.status(202).json({ status: 'i gang', job });
});

app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ fejl: 'Ukendt job — det kan være ryddet op. Søg igen.' });
    res.json({ job });
});

/** CSV-eksport af det viste. */
app.get('/api/export', (req, res) => {
    const clubId = String(req.query.clubId || '');
    const season = String(req.query.season || '');
    const type = String(req.query.type || 'spillere');
    const cached = cache.laes(clubId, season);
    if (!cached) return res.status(404).json({ fejl: 'Ingen data at eksportere endnu.' });

    const data = aggregate(cached.data);
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    let linjer;

    if (type === 'hold') {
        linjer = ['aargang;hold;raekker;spillere;kampe',
            ...data.hold.map((h) => [q(h.aargang), q(h.hold), q(h.raekker.join(' | ')), h.spillere, h.kampe].join(';'))];
    } else if (type === 'spiller-hold') {
        linjer = ['spiller;spiller_id;hold;kampe'];
        for (const s of data.spillere) {
            for (const h of s.hold) linjer.push([q(s.navn), q(s.id), q(h.navn), h.kampe].join(';'));
        }
    } else {
        linjer = ['spiller;spiller_id;kampe_i_alt;antal_hold;single;double;hold',
            ...data.spillere.map((s) => [q(s.navn), q(s.id), s.kampe, s.antalHold, s.single, s.double,
                q(s.hold.map((h) => `${h.navn} (${h.kampe})`).join(', '))].join(';'))];
    }

    const navn = `${data.klub}-${season}-${type}.csv`.replace(/[^\w.\-]+/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${navn}"`);
    res.send('﻿' + linjer.join('\n'));
});

app.use((req, res) => res.status(404).json({ fejl: 'Ukendt endpoint.' }));

app.listen(PORT, () => {
    console.log(`Statistik-backend lytter på ${PORT} (cache: ${cache.DIR}, TTL ${cache.TTL_TIMER}t)`);
});
