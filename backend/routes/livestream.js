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
const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

// Livestream fra TV-PC'ernes USB-kamera — se screens/livestream.js

const tenantKey = (req) => req.clubDbName || 'direct';

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
        planner: !!await plannerPaaBane(bane)
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
        res.json({
            standardUrl: ls.STANDARD_URL,
            indstillinger: { ...indst, logo: logoUrl(req, indst.logo) },
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
                    logo: (o && o.logo) || 'ingen',
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
        if (o.enabled && !noegle) return res.status(400).json({ error: 'Indtast stream-nøglen, før banen slås til' });
        const kamera = (kolonne, standard) => o[kolonne] !== undefined ? o[kolonne] : nu ? nu[kolonne] : standard;
        await query(
            `INSERT INTO court_streams (court_number, enabled, stream_url, stream_key, overlay,
                flip_180, mirror, autofocus, sound, logo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), stream_url = VALUES(stream_url),
                stream_key = VALUES(stream_key), overlay = VALUES(overlay), flip_180 = VALUES(flip_180),
                mirror = VALUES(mirror), autofocus = VALUES(autofocus), sound = VALUES(sound), logo = VALUES(logo)`,
            [bane, o.enabled, o.stream_url, noegle, o.overlay, !!kamera('flip_180', false), !!kamera('mirror', false),
                !!kamera('autofocus', false), !!kamera('sound', false), kamera('logo', 'ingen')]);
        console.log(`[livestream] ${tenantKey(req)} bane ${bane}: ${o.enabled ? 'slået til' : 'slået fra'}` +
            (o.stream_key !== undefined ? (o.stream_key ? ', ny nøgle' : ', nøgle fjernet') : ''));
        res.json({ success: true, noegle: ls.noegleSlut(noegle) });
    } catch (error) {
        next(error);
    }
});

// PUT /api/livestream/kamera/:tokenId — kameraet ved denne TV-PC filmer bane N
// (null = intet kamera). Én PC pr. bane: to PC'er på samme nøgle afviser hinanden
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
        if (!o || !o.enabled || !o.stream_key) {
            return res.status(400).json({ error: 'Slå "Send banen" til med en stream-nøgle først' });
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
        const foer = ls.statusFor(tenant)[link.id];
        const bane = link.camera_court;
        let svar = { kamera: false, send: false, grund: 'intet-kamera' };
        if (bane) {
            const court = await queryOne('SELECT id, is_doubles FROM courts WHERE court_number = ?', [bane]);
            const opsaetning = await queryOne('SELECT * FROM court_streams WHERE court_number = ?', [bane]);
            const gs = court && await queryOne('SELECT * FROM game_states WHERE court_id = ?', [court.id]);
            const sidste = court && !gs && await queryOne('SELECT * FROM last_finished_matches WHERE court_id = ?', [court.id]);
            const planner = await plannerPaaBane(bane);
            const indst = await hentIndstillinger();
            const b = court
                ? ls.beslutning({ opsaetning, gs, sidste, planner, holdkamp: await holdkampPaaBane(bane),
                    senderNu: !!(foer && foer.online && foer.sender), efterMs: indst.efterMin * 60 * 1000 })
                : { send: false, grund: 'ingen-bane' };
            // Tablettens "Start livestream" gælder nu kampen på banen — og kun den
            if (b.vaelg) {
                await query('UPDATE court_streams SET manual_since = UTC_TIMESTAMP(), armed_until = NULL WHERE court_number = ?', [bane]);
            } else if (b.glem) {
                await query('UPDATE court_streams SET manual_since = NULL WHERE court_number = ?', [bane]);
            }
            svar = { kamera: true, bane, send: b.send, grund: b.grund };
            if (b.send) {
                // Hele dagen mellem kampene: et tomt scoreboard (gennemsigtigt billede)
                const rk = b.kilde === 'gs' ? gs : b.kilde === 'sidste' ? sidste : null;
                const dbl = rk && rk.is_doubles != null ? !!rk.is_doubles : !!court.is_doubles;
                svar.url = opsaetning.stream_url;
                svar.noegle = opsaetning.stream_key;
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
            }
        }
        const { ny } = ls.registrer(tenant, link.id, { ...pc, bane: bane || null, grund: svar.grund }, klientIp(req));
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

module.exports = router;
