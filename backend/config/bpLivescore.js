'use strict';
/**
 * Livescore til badmintonplayer.dk (holdkampe) — Badminton Danmark har sagt
 * god for det (Jesper 2026-11-23).
 *
 * Badmintonplayers egen tælleside (livescore.badmintonplayer.dk) gør sådan:
 *   1. Henter holdkampen: GET https://badmintonplayer.dk/api/LeagueMatch/{kampnr}
 *      ?password=&isLiveScore=true → delkampene (combinedTeamMatches) med hver
 *      sit id (leagueMatchIndividualMatchId), disciplin og spillere (playerId),
 *      og om hjemmeklubben har åbnet for livescore (liveScoreEnabled) med en
 *      kode (liveScoreCode — hjemmeklubben laver den under "Indberet resultat").
 *   2. Forbinder til SignalR-hubben https://badmintonplayer.dk/api/ws/livescore/leaguematch,
 *      melder sig i delkampens gruppe (sendConnectionId) og sender stillingen
 *      ved hvert point: matchSendResult({ matchResults, playersLocation,
 *      parentMatchId, matchId, currentPlayerServeId, venueId, courtNumber, … }).
 *
 * Vi gør det samme fra serveren med stillingen fra tabletten, så ingen skal
 * tælle to gange. Kun holdkampe hentet fra badmintonplayer (aktiv_kilde_id =
 * kampnummeret), og kun når admin har slået det til med klubbens kode.
 *
 * Denne fil: de rene funktioner (kobling af delkampe, beskeden der sendes) og
 * forbindelsen til hubben. Ruterne og databasen: routes/bpLivescore.js.
 */

const API = 'https://badmintonplayer.dk/api';
const HUB = `${API}/ws/livescore/leaguematch`;

// ── Delkampe og spillere ────────────────────────────────────────────────────

/** Navne sammenlignes uden store/små bogstaver og ekstra mellemrum. */
function normNavn(s) {
    return String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function spillereFra(ctm, holdId) {
    return ((ctm.teamPlayers && ctm.teamPlayers[holdId]) || [])
        .slice()
        .sort((a, b) => (a.playerIndex || 0) - (b.playerIndex || 0))
        .map(p => ({
            navn: (p.player && p.player.name) || '',
            playerId: p.playerId,
            clubId: (p.player && p.player.clubId) != null ? Number(p.player.clubId) : null,
        }));
}

const navneSaet = (navne) => navne.map(normNavn).filter(Boolean).sort().join('|');

/**
 * Kobl vores delkampe (team_match_games) til badmintonplayers delkampe.
 *
 * Først på spillernes navne (begge hold), så rækkefølgen er ligegyldig, og et
 * hold, der står "omvendt", også findes. Delkampe uden navne kobles på
 * nummeret (game_number = matchIndex — holdsedlen står i samme rækkefølge),
 * hvis badmintonplayers delkamp ikke allerede er brugt.
 *
 * games: [{ id, game_number, team1_player1, team1_player2, team2_player1, team2_player2 }]
 * model: svaret fra GET LeagueMatch/{kampnr}
 * → { koblinger: Map(gameId → { bpKampId, hjemme, ude, hold1ErHjemme }), ukoblede: [gameId] }
 */
function kobDelkampe(games, model) {
    const m = model && model.match;
    const ctms = (model && model.combinedTeamMatches) || [];
    const koblinger = new Map();
    const ukoblede = [];
    if (!m) return { koblinger, ukoblede: games.map(g => g.id) };

    const bp = ctms.map(c => {
        const hjemme = spillereFra(c, m.leagueGroupTeamId1);
        const ude = spillereFra(c, m.leagueGroupTeamId2);
        return {
            bpKampId: c.leagueMatchIndividualMatchId, nr: c.matchIndex,
            hjemme, ude, h: navneSaet(hjemme.map(p => p.navn)), u: navneSaet(ude.map(p => p.navn)),
        };
    });
    const brugt = new Set();

    const vores = games.map(g => ({
        g,
        h1: navneSaet([g.team1_player1, g.team1_player2]),
        h2: navneSaet([g.team2_player1, g.team2_player2]),
    }));

    // 1. Navnene på begge hold
    for (const v of vores) {
        if (!v.h1 || !v.h2) continue;
        let fund = bp.find(b => !brugt.has(b.bpKampId) && b.h === v.h1 && b.u === v.h2);
        let hold1ErHjemme = true;
        if (!fund) {
            fund = bp.find(b => !brugt.has(b.bpKampId) && b.h === v.h2 && b.u === v.h1);
            hold1ErHjemme = false;
        }
        if (fund) {
            brugt.add(fund.bpKampId);
            koblinger.set(v.g.id, { bpKampId: fund.bpKampId, hjemme: fund.hjemme, ude: fund.ude, hold1ErHjemme });
        }
    }
    // 2. Nummeret (fx et golden set eller en delkamp, hvor et navn er rettet)
    for (const v of vores) {
        if (koblinger.has(v.g.id)) continue;
        const fund = bp.find(b => !brugt.has(b.bpKampId) && Number(b.nr) === Number(v.g.game_number));
        if (fund) {
            brugt.add(fund.bpKampId);
            koblinger.set(v.g.id, { bpKampId: fund.bpKampId, hjemme: fund.hjemme, ude: fund.ude, hold1ErHjemme: true });
        } else {
            ukoblede.push(v.g.id);
        }
    }
    return { koblinger, ukoblede };
}

/**
 * Har hjemmeklubben åbnet for livescore, og passer koden? Samme tjek som
 * badmintonplayers egen tælleside: er der ingen kode, må alle tælle.
 */
function kodeTjek(model, kode) {
    const m = model && model.match;
    if (!m) return { ok: false, grund: 'Holdkampen findes ikke på badmintonplayer.dk' };
    // liveScore: hjemmeklubben har åbnet for livescore på kampen. liveScoreEnabled
    // er kun, at funktionen findes for rækken (den er sand på gamle kampe også).
    if (!m.liveScore) {
        return { ok: false, grund: 'Livescore er ikke åbnet for holdkampen. Hjemmeklubben åbner den på badmintonplayer.dk under klubnavn → "Indberet resultat" → "Åben for Live Score".' };
    }
    const rigtig = String(m.liveScoreCode || '');
    if (rigtig && rigtig !== String(kode || '').trim()) {
        return { ok: false, grund: 'Livescore-koden passer ikke. Den står på badmintonplayer.dk under "Indberet resultat".' };
    }
    return { ok: true };
}

// ── Stillingen på banen → beskeden til badmintonplayer ──────────────────────

/**
 * Står vores hold 1 i banens player1 ('lige') eller player2 ('byttet', efter
 * sideskift)? Ud fra navnene, som tabletten selv gør. null: kan ikke afgøres.
 */
function orientering(p1Navne, p2Navne, game) {
    const hold1 = [game.team1_player1, game.team1_player2].map(normNavn).filter(Boolean);
    const hold2 = [game.team2_player1, game.team2_player2].map(normNavn).filter(Boolean);
    const har = (navne, hold) => navne.map(normNavn).some(n => n && hold.includes(n));
    if (har(p1Navne, hold1) || har(p2Navne, hold2)) return 'lige';
    if (har(p1Navne, hold2) || har(p2Navne, hold1)) return 'byttet';
    return null;
}

function parseHistorik(raa) {
    if (Array.isArray(raa)) return raa;
    try { const v = JSON.parse(raa || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/**
 * Beskeden til matchSendResult — eller null, hvis der intet er at sende
 * (ingen kamp, eller holdene kan ikke genkendes på banen).
 *
 * gs:      game_states-rækken for banen
 * game:    delkampen (team_match_games)
 * kobling: fra kobDelkampe (bpKampId, hjemme, ude, hold1ErHjemme)
 * bp:      { leagueMatchId, venueId }
 */
function byggeBesked({ gs, game, kobling, bp, bane }) {
    if (!gs || !game || !kobling) return null;
    const p1 = [gs.player1_name, gs.player1_name2];
    const p2 = [gs.player2_name, gs.player2_name2];
    const o = orientering(p1, p2, game);
    if (!o) return null;
    // Er banens player1 hjemmeholdet?
    const p1ErHold1 = o === 'lige';
    const p1ErHjemme = p1ErHold1 === kobling.hold1ErHjemme;

    // Afsluttede sæt (hvert sæt ved selv, hvem der stod hvor) + det igangværende
    const saet = [];
    for (const s of parseHistorik(gs.set_scores_history)) {
        const m = String((s && s.score) || '').match(/^(\d+)\s*-\s*(\d+)$/);
        if (!m) continue;
        const a = Number(m[1]), b = Number(m[2]);
        let sp1Hold1;
        if (typeof s.byttet === 'boolean' && normNavn(s.player1Name) === normNavn(s.player2Name)) {
            sp1Hold1 = !s.byttet;
        } else {
            const so = orientering([s.player1Name, s.player1Name2], [s.player2Name, s.player2Name2], game);
            sp1Hold1 = so ? so === 'lige' : p1ErHold1;
        }
        const sp1Hjemme = sp1Hold1 === kobling.hold1ErHjemme;
        saet.push(sp1Hjemme ? [a, b] : [b, a]);
    }
    const s1 = Number(gs.player1_score) || 0, s2 = Number(gs.player2_score) || 0;
    if (!gs.match_completed && (saet.length === 0 || s1 > 0 || s2 > 0)) {
        saet.push(p1ErHjemme ? [s1, s2] : [s2, s1]);
    }
    if (!saet.length) saet.push([0, 0]);
    const matchResults = saet.map(([score1, score2], setIndex) => ({ score1, score2, setIndex }));

    // Spillerne som badmintonplayers tæller stiller dem op (QE): A/B hjemme, C/D ude
    const hj = kobling.hjemme, ud = kobling.ude;
    const plads = (p, side) => p ? { name: p.navn, clubId: p.clubId, playerId: p.playerId, side } : undefined;
    const playersLocation = {
        playerA: plads(hj[1], 0), playerB: plads(hj[0], 0),
        playerC: plads(ud[0], 1), playerD: plads(ud[1], 1),
    };

    // Hvem server: banens side (1 = player1) → hjemme/ude → spilleren ud fra navnet
    let currentPlayerServeId = null;
    const side = gs.is_doubles ? gs.serving_team : gs.serving_player;
    if (side === 1 || side === 2) {
        const sideNavne = side === 1 ? p1 : p2;
        const navn = gs.is_doubles ? sideNavne[gs.serving_player_on_team === 2 ? 1 : 0] : sideNavne[0];
        const sideErHjemme = (side === 1) === p1ErHjemme;
        const holdet = sideErHjemme ? hj : ud;
        const spiller = holdet.find(p => normNavn(p.navn) === normNavn(navn)) || holdet[0];
        currentPlayerServeId = spiller ? spiller.playerId : null;
    }

    return {
        matchResults,
        playersLocation,
        parentMatchId: Number(bp.leagueMatchId),
        matchId: Number(kobling.bpKampId),
        currentPlayerServeId,
        venueId: bp.venueId != null ? Number(bp.venueId) : null,
        courtNumber: bane != null ? Number(bane) : null,
        courtId: null,
        courtExtId: null,
    };
}

// ── badmintonplayer.dk ──────────────────────────────────────────────────────

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function hentHoldkamp(kampnr, { fetchFn = fetch } = {}) {
    if (!/^\d{1,12}$/.test(String(kampnr))) throw new Error('Ugyldigt kampnummer');
    const resp = await fetchFn(`${API}/LeagueMatch/${kampnr}?password=&isLiveScore=true`, {
        headers: { 'Accept': 'application/json', 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`badmintonplayer.dk svarede med HTTP ${resp.status}`);
    return resp.json();
}

/**
 * Én forbindelse til hubben for hele serveren (alle klubber). Den åbnes, når
 * der første gang er noget at sende, og genopretter sig selv. Efter en
 * genforbindelse meldes alle grupper igen, og den seneste stilling for hver
 * delkamp sendes igen, så seerne ikke står med en gammel stilling.
 */
class Hub {
    constructor({ lavForbindelse } = {}) {
        this._lav = lavForbindelse || standardForbindelse;
        this._forb = null;
        this._starter = null;
        this._grupper = new Set();     // matchId'er meldt i grupper på denne forbindelse
        this._seneste = new Map();     // matchId → { besked, tid } (til genafsendelse)
    }

    async _klar() {
        if (this._forb && this._forb.state === 'Connected') return this._forb;
        if (this._starter) return this._starter;
        this._starter = (async () => {
            if (!this._forb) {
                this._forb = this._lav(HUB);
                this._forb.onreconnected(() => this._genmeld().catch(() => {}));
                this._forb.onclose(() => { this._grupper.clear(); });
            }
            if (this._forb.state === 'Disconnected') {
                this._grupper.clear();
                await this._forb.start();
            }
            return this._forb;
        })();
        try { return await this._starter; } finally { this._starter = null; }
    }

    async _meld(forb, matchId) {
        if (this._grupper.has(matchId)) return;
        await forb.invoke('sendConnectionId', forb.connectionId, String(matchId));
        this._grupper.add(matchId);
    }

    async _genmeld() {
        this._grupper.clear();
        const forb = this._forb;
        const graense = Date.now() - 30 * 60 * 1000;
        for (const [matchId, { besked, tid }] of this._seneste) {
            if (tid < graense) { this._seneste.delete(matchId); continue; }
            await this._meld(forb, matchId);
            await forb.invoke('matchSendResult', besked);
        }
    }

    async send(besked) {
        const forb = await this._klar();
        await this._meld(forb, besked.matchId);
        this._seneste.set(besked.matchId, { besked, tid: Date.now() });
        return forb.invoke('matchSendResult', besked);
    }

    async stop() {
        if (this._forb) await this._forb.stop().catch(() => {});
        this._forb = null;
        this._grupper.clear();
    }
}

function standardForbindelse(url) {
    const signalR = require('@microsoft/signalr');
    return new signalR.HubConnectionBuilder()
        .withUrl(url)
        .withAutomaticReconnect([0, 2000, 10000, 30000, 60000])
        .configureLogging(signalR.LogLevel.Warning)
        .build();
}

module.exports = {
    API, HUB,
    normNavn, kobDelkampe, kodeTjek, orientering, byggeBesked,
    hentHoldkamp, Hub,
};
