const express = require('express');
const router = express.Router();
const { query, queryOne } = require('../config/database');
const { authMiddleware, requireWriteAuthInClubMode } = require('../middleware/auth');
const { ikkeQrSession } = require('../middleware/qrSession');
const { clubAdminAuth } = require('../middleware/clubAdminAuth');
const { requirePage } = require('../middleware/pagePermission');
const { klientIp, uploadLimiter } = require('../middleware/rateLimiter');
const upload = require('../config/multer');
const { validateImageMagic } = require('../config/imageUpload');
const { UPLOAD_DIR, klubMappe } = require('../config/sponsorFiler');
const { gyldigtToken } = require('../screens/pcRapport');
const ls = require('../screens/livestream');
const masterDb = require('../config/masterDatabase');
const LogoMatch = require('../config/logoMatch');
const youtube = require('../config/youtube');
const { krypter, dekrypter } = require('../config/hemmelig');
const sharp = require('sharp');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

// Livestream fra TV-PC'ernes USB-kamera — se screens/livestream.js

const tenantKey = (req) => req.clubDbName || 'direct';

// ---- YouTube-kanalen (config/youtube.js) ----
// Kun for klubberne — demoen (app.) er åben for alle. Lokalt/i test kan det
// slås til i direct-mode med YOUTUBE_DIREKTE=1.
const ytTilladt = (req) => youtube.konfigureret() &&
    (req.accessMode === 'club' || (req.accessMode === 'direct' && process.env.YOUTUBE_DIREKTE === '1'));

// Klubbens forbindelse ({ …række, refresh }) eller null
async function ytForbindelse(req) {
    if (!ytTilladt(req)) return null;
    const r = await queryOne('SELECT * FROM livestream_youtube WHERE id = 1');
    return r ? { ...r, refresh: dekrypter(r.refresh_token) } : null;
}

// Forbindelsen virker (ellers bruges den indtastede nøgle, hvis der er en)
const ytBrugbar = (f) => !!(f && f.refresh && !f.fejl);

// Adgang til kanalen. Udløbet/fjernet adgang skrives på forbindelsen, så
// admin kan se, at kanalen skal forbindes igen
async function ytToken(req, f) {
    try {
        return await youtube.adgangsToken(tenantKey(req), f.refresh);
    } catch (e) {
        if (e.grund === 'invalid_grant' || e.grund === 'unauthorized_client') {
            await query('UPDATE livestream_youtube SET fejl = ? WHERE id = 1', [e.message.slice(0, 255)]);
            console.log(`[livestream] ${tenantKey(req)}: YouTube-adgangen virker ikke længere — ${e.message}`);
        }
        throw e;
    }
}

const ytStreamFelter = 'yt_stream_id = NULL, yt_ingest_url = NULL, yt_stream_key = NULL, ' +
    'yt_broadcast_id = NULL, yt_broadcast_tjek = NULL, yt_fejl = NULL, yt_fejl_tid = NULL';

// Udsendelsens titel: holdkampens hold, ellers navnene i scoreboardet
async function ytTitelFor(req, bane, b, rk, dbl) {
    const hk = b.grund === 'holdkamp' ? await queryOne(
        `SELECT tm.team1_name, tm.team2_name FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
          WHERE g.court_number = ? AND tm.status = 'active' ORDER BY g.status = 'active' DESC, g.started_at DESC LIMIT 1`,
        [bane]) : null;
    const t = rk ? ls.overlayTavle(rk, dbl, bane) : null;
    const klubnavn = (await klubLogoData(req).catch(() => ({}))).klubnavn || null;
    return {
        titel: ls.ytTitel({ grund: b.grund, bane, hold: hk && [hk.team1_name, hk.team2_name], navne: t && t.navne, klubnavn }),
        beskrivelse: ls.ytBeskrivelse(klubnavn)
    };
}

// Én ad gangen pr. bane (PC'en spørger igen, før YouTube har svaret)
const _ytLaas = new Set();

// Banens stream og udsendelse på YouTube, som beslutningen siger (ls.ytHandling).
// Returnerer { url, noegle } at sende til — eller null (så bruges den
// indtastede nøgle). En fejl hos YouTube stopper aldrig streamen: den gemmes
// på banen, vises i admin, og der prøves igen om lidt.
async function ytStyr(req, f, bane, o, b, { rk, dbl, senderNu, tvingTjek }) {
    const laas = `${tenantKey(req)}:${bane}`;
    const gemt = o.yt_stream_key ? { url: o.yt_ingest_url, noegle: o.yt_stream_key } : null;
    if (_ytLaas.has(laas)) return gemt;
    const handling = ls.ytHandling({ send: b.send, udsendelse: o.yt_broadcast_id,
        tjek: tvingTjek ? null : o.yt_broadcast_tjek, fejlTid: o.yt_fejl_tid });
    if (!handling && (gemt || !b.send)) return gemt;
    _ytLaas.add(laas);
    let stream = gemt;
    try {
        const token = await ytToken(req, f);
        if (b.send && !stream) {
            const s = await youtube.opretStream(token, `Badmintonapp – bane ${bane}`);
            await query('UPDATE court_streams SET yt_stream_id = ?, yt_ingest_url = ?, yt_stream_key = ? WHERE court_number = ?',
                [s.id, s.url, s.noegle, bane]);
            o = { ...o, yt_stream_id: s.id };
            stream = { url: s.url, noegle: s.noegle };
            console.log(`[livestream] ${tenantKey(req)} bane ${bane}: stream-nøgle oprettet på YouTube`);
        }
        if (handling === 'opret') {
            const { titel, beskrivelse } = await ytTitelFor(req, bane, b, rk, dbl);
            const indst = await hentIndstillinger();
            const id = await youtube.opretUdsendelse(token, { titel, beskrivelse, synlighed: indst.ytSynlighed,
                boern: indst.ytBoern, streamId: o.yt_stream_id });
            // Første tjek efter et minut: gik den live, da billedet kom?
            await query(`UPDATE court_streams SET yt_broadcast_id = ?, yt_broadcast_tjek = ?, yt_fejl = NULL, yt_fejl_tid = NULL
                          WHERE court_number = ?`, [id, new Date(Date.now() - ls.YT_TJEK_MS + 60 * 1000), bane]);
            console.log(`[livestream] ${tenantKey(req)} bane ${bane}: YouTube-udsendelse oprettet "${titel}" (${id})`);
        } else if (handling === 'tjek') {
            const status = await youtube.udsendelsesStatus(token, o.yt_broadcast_id);
            if (!status || status === 'complete' || status === 'revoked') {
                // Afsluttet på YouTube (i Studio, eller billedet var væk i over et minut) — en ny oprettes
                await query('UPDATE court_streams SET yt_broadcast_id = NULL, yt_broadcast_tjek = NULL WHERE court_number = ?', [bane]);
                console.log(`[livestream] ${tenantKey(req)} bane ${bane}: YouTube-udsendelsen er ${status || 'væk'} — opretter en ny`);
            } else {
                // Billedet kommer, men udsendelsen er ikke gået live af sig selv
                if (status === 'ready' && senderNu) {
                    await youtube.gaaLive(token, o.yt_broadcast_id);
                    console.log(`[livestream] ${tenantKey(req)} bane ${bane}: YouTube-udsendelsen sat live`);
                }
                await query('UPDATE court_streams SET yt_broadcast_tjek = UTC_TIMESTAMP(), yt_fejl = NULL, yt_fejl_tid = NULL WHERE court_number = ?', [bane]);
            }
        } else if (handling === 'afslut') {
            const hvad = await youtube.afslut(token, o.yt_broadcast_id);
            await query('UPDATE court_streams SET yt_broadcast_id = NULL, yt_broadcast_tjek = NULL, yt_fejl = NULL, yt_fejl_tid = NULL WHERE court_number = ?', [bane]);
            console.log(`[livestream] ${tenantKey(req)} bane ${bane}: YouTube-udsendelsen ${hvad}`);
        }
    } catch (e) {
        if (!(e instanceof youtube.YoutubeFejl)) throw e;
        await query('UPDATE court_streams SET yt_fejl = ?, yt_fejl_tid = UTC_TIMESTAMP() WHERE court_number = ?',
            [e.message.slice(0, 255), bane]);
        // Streamen findes ikke længere på kanalen (slettet i Studio): en ny næste gang
        if (e.status === 404 && /stream/i.test(e.grund)) {
            await query(`UPDATE court_streams SET ${ytStreamFelter}, yt_fejl = ?, yt_fejl_tid = UTC_TIMESTAMP() WHERE court_number = ?`,
                [e.message.slice(0, 255), bane]);
            stream = null;
        }
        // Udsendelsen findes ikke længere: glem den
        if (handling === 'afslut' && e.status === 404) {
            await query('UPDATE court_streams SET yt_broadcast_id = NULL WHERE court_number = ?', [bane]);
        }
        if (o.yt_fejl !== e.message) console.log(`[livestream] ${tenantKey(req)} bane ${bane}: YouTube-fejl (${handling || 'nøgle'}): ${e.message}`);
    } finally {
        _ytLaas.delete(laas);
    }
    return stream;
}

// Klubbens fælles indstillinger (settings 'livestream', se ls.laesIndstillinger)
const hentIndstillinger = async () => ls.laesIndstillinger(
    (await queryOne("SELECT setting_value FROM settings WHERE setting_key = 'livestream'"))?.setting_value);
const gemIndstillinger = (indst) => query(
    "INSERT INTO settings (setting_key, setting_value) VALUES ('livestream', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [JSON.stringify(indst)]);

const logoUrl = (req, fil) => fil ? `/uploads/${klubMappe(req)}/${fil}` : null;
const logoSti = (req, fil) => ls.gyldigLogoFil(fil) ? path.join(UPLOAD_DIR, klubMappe(req), fil) : null;

// Banens sponsor-banner lige nu (som TV'ets bundbjælke), eller null
async function sponsorPaaBane(bane) {
    const bannere = await query(
        `SELECT s.filename FROM sponsor_images s
          WHERE s.type = 'court' AND s.is_active = TRUE
            AND (s.court_scope = 'alle' OR EXISTS (SELECT 1 FROM sponsor_image_courts c
                  WHERE c.sponsor_image_id = s.id AND c.court_number = ?))
          ORDER BY s.display_order, s.upload_date DESC`, [bane]);
    const varighed = (await queryOne('SELECT banner_duration FROM sponsor_settings LIMIT 1'))?.banner_duration;
    const fil = ls.sponsorNu(bannere, varighed);
    return fil ? `/uploads/${fil}` : null;
}

// ---- Klublogoer: den centrale logo-database (master) og klubbens spillere ----
// PC'en spørger hvert 3. sekund, så listerne huskes et minut ad gangen. Ændres
// et logo, står det rigtigt i streamen senest et minut efter.
const LOGO_CACHE_MS = 60 * 1000;
let _logoer = null;              // { t, logos } — fælles for alle klubber
const _klubLogoData = new Map(); // tenant -> { t, klubnavn, playerLogos, clubByName }

async function centraleLogoer() {
    if (_logoer && Date.now() - _logoer.t < LOGO_CACHE_MS) return _logoer.logos;
    const rows = await masterDb.query('SELECT id, club_name, aliases, filename FROM club_logos');
    const logos = rows.map(r => ({ id: r.id, club_name: r.club_name, aliases: r.aliases, url: `/uploads/${r.filename}` }));
    _logoer = { t: Date.now(), logos };
    return logos;
}

async function klubLogoData(req) {
    const gemt = _klubLogoData.get(tenantKey(req));
    if (gemt && Date.now() - gemt.t < LOGO_CACHE_MS) return gemt;
    const [klub, playerLogos, info, tpc] = await Promise.all([
        req.clubSubdomain ? masterDb.queryOne('SELECT name FROM clubs WHERE subdomain = ?', [req.clubSubdomain]) : null,
        query('SELECT player_name, logo_id FROM player_logos'),
        query('SELECT name, club FROM player_info'),
        query('SELECT player_name AS name, club FROM tournament_player_clubs')
    ]);
    // Som /api/player-clubs: player_info vinder over turneringernes klubber
    const clubByName = {};
    for (const r of [...tpc, ...info]) {
        if (r.name && r.club) clubByName[LogoMatch.normalizeName(r.name)] = r.club;
    }
    const data = { t: Date.now(), klubnavn: klub ? klub.name : null, playerLogos, clubByName };
    _klubLogoData.set(tenantKey(req), data);
    return data;
}

// Klubbens logo i streamen: det uploadede, ellers klubbens eget fra logo-databasen
async function klubLogo(req, indst) {
    const upload = logoUrl(req, indst.logo);
    const database = ls.klubLogoFraDatabase((await klubLogoData(req)).klubnavn, await centraleLogoer());
    return { upload, database, url: upload || (database && database.url) || null };
}

// Logoerne ud for navnene: holdkampens delkamp på banen (også en afgjort, så
// logoerne bliver stående de sidste minutter), ellers spillernes klubber
async function navneLogoer(req, rk, double, bane) {
    const r = await queryOne(
        `SELECT tm.team1_name, tm.team2_name, tm.team1_logo_id, tm.team2_logo_id,
                g.team1_player1, g.team1_player2, g.team2_player1, g.team2_player2
           FROM team_match_games g JOIN team_matches tm ON tm.id = g.team_match_id
          WHERE g.court_number = ? AND tm.status = 'active'
          ORDER BY g.status = 'active' DESC, g.started_at DESC LIMIT 1`, [bane]);
    const holdkamp = r && { ...r, game: r };
    const d = await klubLogoData(req);
    return ls.spillerLogoer(rk, double, { holdkamp, logos: await centraleLogoer(),
        playerLogos: d.playerLogos, clubByName: d.clubByName });
}

// Samme adgang som Adgangslinks (siden devicetokens); i direct-mode det lokale login
const livestreamAdmin = (req, res, next) => {
    if (req.accessMode !== 'club') return authMiddleware(req, res, next);
    clubAdminAuth(req, res, (err) => {
        if (err) return next(err);
        requirePage('devicetokens')(req, res, next);
    });
};

const baneNr = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
};

const plannerPaaBane = (bane) => queryOne(
    `SELECT a.court_number FROM planner_court_assignments a
       JOIN planner_rounds r ON r.id = a.round_id WHERE a.court_number = ?`, [bane]);

// Den igangværende holdkamp, banen har haft en delkamp i — kun holdkampe
// sendes af sig selv, og hele holdkampen i ét (se ls.holdkampNu). null: ingen
const holdkampPaaBane = async (bane) => {
    const r = await queryOne(
        `SELECT SUM(g.status <> 'finished') AS mangler, SUM(g.status = 'active') AS igang,
                MAX(g.finished_at) AS slut, MAX(g.started_at) AS start
           FROM team_matches tm JOIN team_match_games g ON g.team_match_id = tm.id
          WHERE tm.status = 'active'
            AND tm.id IN (SELECT team_match_id FROM team_match_games WHERE court_number = ?)`, [bane]);
    return r && r.mangler != null ? r : null;
};

// Tablettens og admins oversigt over én bane
async function baneStatus(req, bane) {
    const opsaetning = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
    const link = await queryOne(
        'SELECT id FROM device_tokens WHERE camera_court = ? AND is_active = 1 LIMIT 1', [bane]);
    return ls.tabletStatus({
        opsaetning,
        kamera: !!link,
        pc: link ? ls.statusFor(tenantKey(req))[link.id] : null,
        holdkamp: await holdkampPaaBane(bane),
        planner: !!await plannerPaaBane(bane),
        youtube: ytBrugbar(await ytForbindelse(req)),
        efterMin: (await hentIndstillinger()).efterMin
    });
}

// GET /api/livestream — banernes opsætning og TV-PC'erne, der kan have kamera
router.get('/', livestreamAdmin, async (req, res, next) => {
    try {
        const baner = await query('SELECT court_number FROM courts ORDER BY court_number');
        const opsaetning = new Map((await query('SELECT * FROM court_streams')).map(r => [r.court_number, r]));
        const links = await query(
            `SELECT id, name, destination, camera_court FROM device_tokens
              WHERE is_active = 1 AND token_type = 'permanent' AND destination LIKE 'tv%'
              ORDER BY name`);
        const status = ls.statusFor(tenantKey(req));
        const indst = await hentIndstillinger();
        const klub = await klubLogo(req, indst).catch(() => ({ upload: logoUrl(req, indst.logo), database: null }));
        const yt = await ytForbindelse(req);
        res.json({
            standardUrl: ls.STANDARD_URL,
            indstillinger: { ...indst, logo: logoUrl(req, indst.logo) },
            // null: YouTube-API'et er ikke sat op på serveren (eller demoen)
            youtube: ytTilladt(req) ? {
                forbundet: !!yt,
                kanal: yt ? yt.kanal_navn : null,
                fejl: yt ? (yt.fejl || (yt.refresh ? null : 'Adgangen kan ikke læses længere — forbind kanalen igen')) : null
            } : null,
            // Klubbens logo: det uploadede vinder over logo-databasens
            klubLogo: { upload: klub.upload, database: klub.database, klubnavn: _klubLogoData.get(tenantKey(req))?.klubnavn || null },
            baner: baner.map(({ court_number: n }) => {
                const o = opsaetning.get(n);
                const s = ls.startet(o);
                return {
                    bane: n,
                    enabled: !!(o && o.enabled),
                    streamUrl: o ? o.stream_url : ls.STANDARD_URL,
                    noegle: o ? ls.noegleSlut(o.stream_key) : null,
                    overlay: o ? !!o.overlay : true,
                    vend: !!(o && o.flip_180),
                    spejl: !!(o && o.mirror),
                    autofokus: !!(o && o.autofocus),
                    lyd: !!(o && o.sound),
                    logo: (o && o.logo) || 'klub',
                    // Banens stream og udsendelse på den forbundne kanal
                    yt: yt && o ? { noegle: !!o.yt_stream_key, udsendelse: o.yt_broadcast_id || null, fejl: o.yt_fejl || null } : null,
                    start: s ? s.start : null,
                    til: s && s.til ? new Date(s.til).toISOString() : null
                };
            }),
            kameraer: links.map(l => ({
                tokenId: l.id,
                navn: l.name,
                destination: l.destination,
                bane: l.camera_court,
                status: status[l.id] || null
            }))
        });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/indstillinger — klubbens fælles indstillinger for streamen
router.put('/indstillinger', livestreamAdmin, async (req, res, next) => {
    try {
        const indst = ls.rensIndstillinger(req.body, await hentIndstillinger());
        if (indst.fejl) return res.status(400).json({ error: indst.fejl });
        await gemIndstillinger(indst);
        console.log(`[livestream] ${tenantKey(req)}: indstillinger ${indst.oploesning}p ${indst.billeder} bill./s ` +
            `${indst.kvalitet}, overlay ${indst.placering} ${indst.stoerrelse}, ${indst.efterMin} min efter`);
        res.json({ success: true, indstillinger: { ...indst, logo: logoUrl(req, indst.logo) } });
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/logo — klubbens logo i streamen (felt "logo"). Gemmes
// som PNG (gennemsigtighed bevares) i højst 600x240, så PC'en ikke skal skalere meget
router.post('/logo', uploadLimiter, livestreamAdmin, upload.single('logo'), validateImageMagic, async (req, res, next) => {
    const fil = req.file;
    try {
        if (!fil) return res.status(400).json({ error: 'Vælg et billede' });
        const navn = `livestream-logo-${crypto.randomBytes(8).toString('hex')}.png`;
        await sharp(fil.path).rotate().resize(600, 240, { fit: 'inside', withoutEnlargement: true })
            .png().toFile(logoSti(req, navn));
        const foer = await hentIndstillinger();
        await gemIndstillinger({ ...foer, logo: navn });
        const gammel = logoSti(req, foer.logo);
        if (gammel) await fs.unlink(gammel).catch(() => {});
        console.log(`[livestream] ${tenantKey(req)}: nyt klublogo`);
        res.json({ success: true, logo: logoUrl(req, navn) });
    } catch (error) {
        next(error);
    } finally {
        if (fil) await fs.unlink(fil.path).catch(() => {});
    }
});

router.delete('/logo', livestreamAdmin, async (req, res, next) => {
    try {
        const foer = await hentIndstillinger();
        await gemIndstillinger({ ...foer, logo: null });
        const gammel = logoSti(req, foer.logo);
        if (gammel) await fs.unlink(gammel).catch(() => {});
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/baner/:bane — til/fra, adresse, nøgle, overlay og kameraet
// (vend, spejl, autofokus, lyd, logo — felter, der ikke er med, er uændrede)
router.put('/baner/:bane', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane || !await queryOne('SELECT id FROM courts WHERE court_number = ?', [bane])) {
            return res.status(404).json({ error: 'Bane ikke fundet' });
        }
        const o = ls.rensOpsaetning(req.body);
        if (o.fejl) return res.status(400).json({ error: o.fejl });
        const nu = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
        const noegle = o.stream_key === undefined ? (nu ? nu.stream_key : null) : o.stream_key;
        if (o.enabled && !noegle && !ytBrugbar(await ytForbindelse(req))) {
            return res.status(400).json({ error: 'Indtast stream-nøglen (eller forbind YouTube-kanalen), før banen slås til' });
        }
        const kamera = (kolonne, standard) => o[kolonne] !== undefined ? o[kolonne] : nu ? nu[kolonne] : standard;
        await query(
            `INSERT INTO court_streams (court_number, enabled, stream_url, stream_key, overlay,
                flip_180, mirror, autofocus, sound, logo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), stream_url = VALUES(stream_url),
                stream_key = VALUES(stream_key), overlay = VALUES(overlay), flip_180 = VALUES(flip_180),
                mirror = VALUES(mirror), autofocus = VALUES(autofocus), sound = VALUES(sound), logo = VALUES(logo)`,
            [bane, o.enabled, o.stream_url, noegle, o.overlay, !!kamera('flip_180', false), !!kamera('mirror', false),
                !!kamera('autofocus', false), !!kamera('sound', false), kamera('logo', 'klub')]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: ${o.enabled ? 'slået til' : 'slået fra'}` +
            (o.stream_key !== undefined ? (o.stream_key ? ', ny nøgle' : ', nøgle fjernet') : ''));
        res.json({ success: true, noegle: ls.noegleSlut(noegle) });
    } catch (error) {
        next(error);
    }
});

// ---- YouTube-kanalen: forbind (Google-login) og fjern ----
//
// 1. Admin trykker "Forbind YouTube-kanal": POST /youtube/forbind giver adressen
//    til Googles login med en signeret state (klubbens adresse, 15 minutter).
// 2. Google sender tilbage til den fælles adresse (https://badmintonapp.dk/youtube/callback
//    → nginx → GET /youtube/svar på roddomænet), der sender videre til klubbens
//    eget subdomæne — Google tillader ikke *.badmintonapp.dk som adresse.
// 3. Klubbens GET /youtube/svar bytter koden til en varig adgang og gemmer den krypteret.

const STATE_LEVETID = '15m';
const tekst255 = (v) => String(v || '').slice(0, 255);
const _brugteStates = new Map(); // nonce -> udløb (ms): en state kan kun bruges én gang

router.post('/youtube/forbind', livestreamAdmin, async (req, res, next) => {
    try {
        if (!ytTilladt(req)) return res.status(404).json({ error: 'YouTube er ikke sat op på serveren' });
        const state = jwt.sign({ typ: 'youtube', vaert: req.hostname, tenant: tenantKey(req),
            n: crypto.randomBytes(12).toString('hex') }, process.env.JWT_SECRET, { expiresIn: STATE_LEVETID });
        res.json({ url: youtube.loginAdresse(state) });
    } catch (error) {
        next(error);
    }
});

router.get('/youtube/svar', async (req, res, next) => {
    let s;
    try {
        s = jwt.verify(String(req.query.state || ''), process.env.JWT_SECRET);
        if (s.typ !== 'youtube') throw new Error('forkert state');
    } catch {
        return res.status(400).type('text/plain; charset=utf-8')
            .send('Linket er udløbet eller ugyldigt. Gå tilbage til admin → Livestream og tryk "Forbind YouTube-kanal" igen.');
    }
    // Roddomænet: videre til klubbens eget subdomæne med det samme svar fra Google
    if (req.accessMode === 'marketing') {
        const domaene = process.env.APP_DOMAIN;
        if (!domaene || !String(s.vaert).endsWith('.' + domaene)) return res.status(400).send('Ugyldig adresse');
        const q = new URLSearchParams(req.query).toString();
        return res.redirect(302, `https://${s.vaert}/api/livestream/youtube/svar?${q}`);
    }
    const tilAdmin = (status, besked) => res.redirect(302,
        `/admin.html?youtube=${status}${besked ? `&besked=${encodeURIComponent(besked)}` : ''}#livestream`);
    try {
        if (!ytTilladt(req) || s.vaert !== req.hostname || s.tenant !== tenantKey(req)) {
            return res.status(400).send('Ugyldig adresse');
        }
        const nu = Date.now();
        for (const [n, udloeb] of _brugteStates) if (udloeb < nu) _brugteStates.delete(n);
        if (_brugteStates.has(s.n)) return tilAdmin('fejl', 'Linket er allerede brugt — prøv igen');
        _brugteStates.set(s.n, s.exp * 1000);
        // Afbrudt hos Google (fx "Annuller")
        if (req.query.error || !req.query.code) return tilAdmin('afbrudt');

        const t = await youtube.byttKode(String(req.query.code));
        const k = await youtube.kanal(t.access_token);
        if (!k) {
            await youtube.tilbagekald(t.refresh_token);
            return tilAdmin('fejl', 'Google-kontoen har ingen YouTube-kanal. Opret kanalen på YouTube, eller vælg en anden konto');
        }
        await query(
            `INSERT INTO livestream_youtube (id, refresh_token, kanal_id, kanal_navn, fejl) VALUES (1, ?, ?, ?, NULL)
             ON DUPLICATE KEY UPDATE refresh_token = VALUES(refresh_token), kanal_id = VALUES(kanal_id),
                kanal_navn = VALUES(kanal_navn), fejl = NULL, forbundet = CURRENT_TIMESTAMP`,
            [krypter(t.refresh_token), k.id, tekst255(k.navn)]);
        // Nøglerne hører til kanalen — en anden (eller samme igen) får nye
        await query(`UPDATE court_streams SET ${ytStreamFelter}`);
        youtube.glemAdgang(tenantKey(req));
        console.log(`[livestream] ${tenantKey(req)}: YouTube-kanalen "${k.navn}" er forbundet`);
        tilAdmin('forbundet');
    } catch (error) {
        if (error instanceof youtube.YoutubeFejl) return tilAdmin('fejl', error.message);
        next(error);
    }
});

// DELETE /api/livestream/youtube — fjern forbindelsen: igangværende udsendelser
// afsluttes, adgangen tilbagekaldes hos Google, og banerne bruger igen den
// indtastede nøgle (hvis der er en)
router.delete('/youtube', livestreamAdmin, async (req, res, next) => {
    try {
        const f = await ytForbindelse(req);
        if (f && f.refresh) {
            const igang = await query('SELECT court_number, yt_broadcast_id FROM court_streams WHERE yt_broadcast_id IS NOT NULL');
            if (igang.length) {
                const token = await ytToken(req, f).catch(() => null);
                for (const r of igang) {
                    if (token) await youtube.afslut(token, r.yt_broadcast_id).catch(() => {});
                }
            }
            await youtube.tilbagekald(f.refresh);
        }
        await query('DELETE FROM livestream_youtube WHERE id = 1');
        await query(`UPDATE court_streams SET ${ytStreamFelter}`);
        youtube.glemAdgang(tenantKey(req));
        console.log(`[livestream] ${tenantKey(req)}: YouTube-kanalen er fjernet`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/kamera/:tokenId — kameraet ved denne TV-PC filmer bane N
// (null = intet kamera). Ét adgangslink pr. bane: to PC'er på samme nøgle
// afviser hinanden — og bruger flere PC'er linket, sender kun én (POST /pc)
router.put('/kamera/:tokenId', livestreamAdmin, async (req, res, next) => {
    try {
        const id = Number(req.params.tokenId);
        const link = Number.isInteger(id) && await queryOne(
            "SELECT id FROM device_tokens WHERE id = ? AND token_type = 'permanent'", [id]);
        if (!link) return res.status(404).json({ error: 'Adgangslinket findes ikke' });
        const bane = req.body && req.body.bane != null ? baneNr(req.body.bane) : null;
        if (req.body && req.body.bane != null && !bane) return res.status(400).json({ error: 'Ugyldig bane' });
        if (bane) await query('UPDATE device_tokens SET camera_court = NULL WHERE camera_court = ? AND id <> ?', [bane, id]);
        await query('UPDATE device_tokens SET camera_court = ? WHERE id = ?', [bane, id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// POST/DELETE /api/livestream/baner/:bane/hele-dagen — admin starter banen
// for resten af dagen (en turnering): alt sendes, også mellem kampene, til
// TV-PC'en slukker kl. 23:59
router.post('/baner/:bane/hele-dagen', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        const o = bane && await queryOne('SELECT enabled, stream_key FROM court_streams WHERE court_number = ?', [bane]);
        if (!o || !o.enabled || (!o.stream_key && !ytBrugbar(await ytForbindelse(req)))) {
            return res.status(400).json({ error: 'Banen skal have en stream-nøgle (eller en forbundet YouTube-kanal) og flueben i "Livestream slået til" først' });
        }
        await query('UPDATE court_streams SET all_day_until = ? WHERE court_number = ?', [new Date(ls.dagensSlut()), bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: sendes hele dagen`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

router.delete('/baner/:bane/hele-dagen', livestreamAdmin, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        await query('UPDATE court_streams SET all_day_until = NULL, armed_until = NULL, manual_since = NULL WHERE court_number = ?', [bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: stoppet i admin`);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// Tabletten på banen (Indstillinger → Start livestream). Ikke QR-telefoner:
// det er klubbens tablet, der beslutter, om kampen kommer på YouTube
const tablet = [requireWriteAuthInClubMode, ikkeQrSession];

// GET /api/livestream/bane/:bane — kan banen sendes, og er den startet?
router.get('/bane/:bane', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/bane/:bane/start — kampen på banen sendes, eller den
// næste, hvis den starter inden 5 minutter
router.post('/bane/:bane/start', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        const foer = await baneStatus(req, bane);
        if (!foer.kan) return res.status(409).json({ error: 'Livestream er ikke sat op til banen i admin' });
        if (foer.start !== 'hele-dagen') {
            await query('UPDATE court_streams SET armed_until = ?, manual_since = NULL WHERE court_number = ?',
                [new Date(Date.now() + ls.KLAR_MS), bane]);
            console.log(`[livestream] ${tenantKey(req)} bane ${bane}: startet på tabletten`);
        }
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/bane/:bane/stop — tablettens start fortrydes. Hele
// dagen stoppes kun i admin, og holdkampe sendes stadig af sig selv
router.post('/bane/:bane/stop', tablet, async (req, res, next) => {
    try {
        const bane = baneNr(req.params.bane);
        if (!bane) return res.status(404).json({ error: 'Bane ikke fundet' });
        await query('UPDATE court_streams SET armed_until = NULL, manual_since = NULL WHERE court_number = ?', [bane]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: stoppet på tabletten`);
        res.json(await baneStatus(req, bane));
    } catch (error) {
        next(error);
    }
});

// POST /api/livestream/pc — TV-PC'ens stream-tjeneste (kiosk: stream) spørger
// hvert par sekunder, om den skal sende, og fortæller, hvordan det går. Ingen
// login: adgangslinkets token i X-Adgangslink, som rapporten (pc-rapport).
// Nøglen er kun med, når der skal sendes.
router.post('/pc', async (req, res, next) => {
    try {
        if (req.accessMode !== 'club' && req.accessMode !== 'direct') {
            return res.status(404).json({ error: 'Endpoint ikke fundet' });
        }
        const token = req.get('X-Adgangslink');
        if (!gyldigtToken(token)) return res.status(401).json({ error: 'Mangler adgangslink' });
        const link = await queryOne(
            'SELECT id, camera_court FROM device_tokens WHERE token = ? AND is_active = 1', [token]);
        if (!link) return res.status(403).json({ error: 'Ugyldigt eller tilbagekaldt adgangslink' });

        const pc = ls.rensStatus(req.body);
        const tenant = tenantKey(req);
        const bane = link.camera_court;
        // Én PC pr. adgangslink sender (se ls.maaBrugeKamera). De andre får
        // "anden-pc" og ser ikke nøglen; banen og statussen røres ikke
        if (bane && !ls.maaBrugeKamera(tenant, link.id, ls.pcNoegle(pc, klientIp(req)), !!pc.kamera)) {
            ls.registrerAnden(tenant, link.id, pc, klientIp(req));
            return res.json({ kamera: true, bane, send: false, grund: 'anden-pc' });
        }
        const foer = ls.statusFor(tenant)[link.id];
        let svar = { kamera: false, send: false, grund: 'intet-kamera' };
        let livetavle = null;   // til live-siden — også når overlayet er slået fra
        if (bane) {
            const court = await queryOne('SELECT id, is_doubles FROM courts WHERE court_number = ?', [bane]);
            const opsaetning = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
            const gs = court && await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
            const sidste = court && !gs && await queryOne('SELECT * FROM last_finished_matches WHERE court_id = ?', [court.id]);
            const planner = await plannerPaaBane(bane);
            const indst = await hentIndstillinger();
            const yt = await ytForbindelse(req);
            const b = court
                ? ls.beslutning({ opsaetning, gs, sidste, planner, holdkamp: await holdkampPaaBane(bane),
                    senderNu: !!(foer && foer.online && foer.sender), efterMs: indst.efterMin * 60 * 1000,
                    youtube: ytBrugbar(yt) })
                : { send: false, grund: 'ingen-bane' };
            // Tablettens "Start livestream" gælder nu kampen på banen — og kun den
            if (b.vaelg) {
                await query('UPDATE court_streams SET manual_since = UTC_TIMESTAMP(), armed_until = NULL WHERE court_number = ?', [bane]);
            } else if (b.glem) {
                await query('UPDATE court_streams SET manual_since = NULL WHERE court_number = ?', [bane]);
            }
            // Hele dagen mellem kampene: et tomt scoreboard (gennemsigtigt billede)
            const rk = b.kilde === 'gs' ? gs : b.kilde === 'sidste' ? sidste : null;
            const dbl = rk && rk.is_doubles != null ? !!rk.is_doubles : !!(court && court.is_doubles);
            // YouTube-kanalen forbundet: banens nøgle derfra, en ny udsendelse, når
            // banen begynder at sende, og den afsluttes, når banen holder op
            const ytKilde = ytBrugbar(yt) && opsaetning && (b.send || opsaetning.yt_broadcast_id)
                ? await ytStyr(req, yt, bane, opsaetning, b, { rk, dbl,
                    senderNu: !!(foer && foer.sender && pc.sender && Date.now() - foer.senderSiden > 60 * 1000),
                    tvingTjek: !!(pc.sender && foer && !foer.sender) })
                : null;
            const kilde = ytKilde ||
                (opsaetning && opsaetning.stream_key ? { url: opsaetning.stream_url, noegle: opsaetning.stream_key } : null);
            svar = { kamera: true, bane, send: b.send && !!kilde, grund: b.send && !kilde ? 'youtube-fejl' : b.grund };
            if (svar.send) {
                svar.url = kilde.url;
                svar.noegle = kilde.noegle;
                svar.overlay = !!opsaetning.overlay;
                svar.linjer = opsaetning.overlay ? ls.overlayLinjer(rk, dbl) : [];
                // Klublogoerne ud for navnene (som på TV'et) — en fejl i logoerne må
                // aldrig stoppe streamen
                const navnLogoer = opsaetning.overlay && rk
                    ? await navneLogoer(req, rk, dbl, bane).catch(e => { console.error('[livestream] logoer:', e.message); return null; })
                    : null;
                svar.tavle = opsaetning.overlay ? ls.overlayTavle(rk, dbl, bane, navnLogoer) : null;
                // Nye Badminton TV-versioner: opløsning, kvalitet, kameraet og logoet (ældre ser bort fra det)
                svar.video = ls.videoTilPc(indst, opsaetning);
                svar.logo = opsaetning.logo === 'klub'
                    ? (await klubLogo(req, indst).catch(() => ({ url: logoUrl(req, indst.logo) }))).url
                    : opsaetning.logo === 'sponsor' ? await sponsorPaaBane(bane) : null;
                livetavle = svar.tavle || ls.overlayTavle(rk, dbl, bane);
            }
        }
        const { ny } = ls.registrer(tenant, link.id, { ...pc, bane: bane || null, grund: svar.grund, skalSende: !!svar.send, tavle: livetavle }, klientIp(req));
        // Til backend-loggen, når PC'en begynder/holder op med at sende eller får en ny fejl
        if (!foer || foer.sender !== ny.sender || (ny.fejl && foer.fejl !== ny.fejl)) {
            console.log(`[livestream] ${tenant} "${ny.navn || link.id}" bane ${bane || '-'}: ` +
                (ny.fejl ? `fejl: ${ny.fejl}` : ny.sender ? 'sender' : `sender ikke (${svar.grund})`));
        }
        res.json(svar);
    } catch (error) {
        next(error);
    }
});

// ---- Klubbens live-side (/live) ----
// Offentlig som oversigten: banerne, der sender lige nu, med stillingen og
// YouTube-udsendelsen. Kun det, seerne alligevel kan se — private udsendelser
// vises ikke. Svaret gemmes et par sekunder, så mange seere ikke giver mange opslag.
const LIVE_CACHE_MS = 3000;
const _live = new Map();   // tenant -> { t, data }
const INDLEJR_CACHE_MS = 10 * 60 * 1000;
const _indlejr = new Map(); // video-id -> { t, ok }

// Må udsendelsen vises på andre sider? YouTubes oEmbed svarer 401, når kanalen
// ikke tillader indlejring (så viser live-siden et billede med link i stedet)
async function kanIndlejres(id) {
    const gemt = _indlejr.get(id);
    if (gemt && Date.now() - gemt.t < INDLEJR_CACHE_MS) return gemt.ok;
    let ok = false;
    try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' +
            encodeURIComponent(`https://www.youtube.com/watch?v=${id}`), { signal: AbortSignal.timeout(5000) });
        ok = r.ok;
    } catch { /* YouTube kunne ikke nås: link i stedet */ }
    _indlejr.set(id, { t: Date.now(), ok });
    if (_indlejr.size > 500) _indlejr.delete(_indlejr.keys().next().value);
    return ok;
}

// GET /api/livestream/live — til live-siden, uden login
router.get('/live', async (req, res, next) => {
    try {
        if (req.accessMode !== 'club' && req.accessMode !== 'direct') {
            return res.status(404).json({ error: 'Endpoint ikke fundet' });
        }
        const tenant = tenantKey(req);
        const gemt = _live.get(tenant);
        if (gemt && Date.now() - gemt.t < LIVE_CACHE_MS) return res.json(gemt.data);

        const indst = await hentIndstillinger();
        const yt = await ytForbindelse(req);
        const video = ytBrugbar(yt) && indst.ytSynlighed !== 'private';
        const udsendelser = new Map((await query('SELECT court_number, yt_broadcast_id FROM court_streams'))
            .map(r => [r.court_number, r.yt_broadcast_id]));
        const baner = ls.liveBaner(ls.statusFor(tenant), udsendelser, { video });
        for (const b of baner) if (b.video) b.video.indlejres = await kanIndlejres(b.video.id);
        const klub = await klubLogoData(req).catch(() => ({}));
        const logo = await klubLogo(req, indst).catch(() => ({ url: null }));
        const data = {
            klub: klub.klubnavn || null,
            logo: logo.url || null,
            kanal: yt && yt.kanal_id && video
                ? { navn: yt.kanal_navn || '', url: `https://www.youtube.com/channel/${encodeURIComponent(yt.kanal_id)}` } : null,
            baner
        };
        _live.set(tenant, { t: Date.now(), data });
        res.set('Cache-Control', 'no-store');
        res.json(data);
    } catch (error) {
        next(error);
    }
});

module.exports = router;
