const express = require('express');
const router = express.Router();
const { query, queryOne, transaktion } = require('../config/database');
const { authMiddleware, requireWriteAuthInClubMode } = require('../middleware/auth');
const { requirePage } = require('../middleware/pagePermission');
const { ikkeQrSession } = require('../middleware/qrSession');
const { publishGameStateChange } = require('../events/gameStateEvents');
const { invalidateCourtTokens } = require('./matchSessionTokens');
const { fetchAndParseTournamentMatches, resolveClubNames, buildPlayerClubRows, filtrerSpillesteder } = require('./importTournament');
const { currentTenant } = require('../config/tenantPools');
const { banensStartTid } = require('../config/matchTiming');
const baneTildeling = require('../config/baneTildeling');
const turneringEnhed = require('../config/turneringEnhed');
const { rydBaneEfterResultat } = require('../config/banerydning');
const { historikSide } = require('../config/historikSide');
const demo = require('../config/demo');

// ── Import-fremskridt (in-memory) ──
// Klub-opsamlingen kører i baggrunden efter kampene er indsat; frontend poller
// GET /:id/import-progress for at vise en progressbar. Ryddes ~2 min efter færdig.
// Nøgle = "tenant:tournamentId" — to klubber kan have samme turnerings-id
// (auto-increment pr. klub-database), så uden tenant ville de kollidere.
const importProgress = new Map();

function progressKey(tournamentId) {
    return `${currentTenant()}:${tournamentId}`;
}

function setImportProgress(tournamentId, data) {
    importProgress.set(progressKey(tournamentId), { ...data, updatedAt: Date.now() });
}

function clearImportProgressLater(tournamentId, delayMs = 120000) {
    // Nøglen beregnes NU, mens tenant-konteksten er aktiv — timeout-callbacken
    // kører senere uden for konteksten, hvor currentTenant() ikke længere gælder.
    const key = progressKey(tournamentId);
    setTimeout(() => {
        const p = importProgress.get(key);
        // Ryd kun hvis den er i en slut-tilstand (undgå at rydde et nyt job der er startet igen)
        if (p && (p.phase === 'done' || p.phase === 'error')) {
            importProgress.delete(key);
        }
    }, delayMs).unref?.();
}

// Best-effort: hent klub pr. spiller fra TS og upsert i tournament_player_clubs.
// Må ALDRIG kaste videre — klub-logoer er sekundære ift. selve importen.
// prefetchedMatches: genbrug allerede hentede kampe (sync-flowet har dem lige
// ved hånden) i stedet for at hente alle kampsider fra TS én gang til.
// trackProgress: hvis true, opdateres importProgress-storen undervejs så frontend
// kan vise en progressbar. Kaldes uden (false) fra sync-flows der ikke har brug for det.
async function captureTournamentClubs(tournamentId, sourceTournamentId, prefetchedMatches = null, trackProgress = false) {
    if (!sourceTournamentId) return;
    if (trackProgress) setImportProgress(tournamentId, { phase: 'fetching-matches', current: 0, total: 0 });
    try {
        const matches = prefetchedMatches || filtrerSpillesteder(
            (await fetchAndParseTournamentMatches(sourceTournamentId)).matches,
            await turneringensSpillesteder(tournamentId));

        const onProgress = trackProgress
            ? (done, total) => setImportProgress(tournamentId, { phase: 'fetching-clubs', current: done, total })
            : null;
        const clubIdToName = await resolveClubNames(sourceTournamentId, matches, onProgress);

        const rows = buildPlayerClubRows(matches, clubIdToName);
        if (trackProgress) setImportProgress(tournamentId, { phase: 'saving', current: rows.length, total: rows.length });
        for (const r of rows) {
            await query(
                `INSERT INTO tournament_player_clubs (tournament_id, player_name, club, source_player_id)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE club = VALUES(club), source_player_id = VALUES(source_player_id)`,
                [tournamentId, r.player_name, r.club, r.source_player_id]
            );
        }
        console.log(`✓ Klub-opsamling: ${rows.length} spiller-klubber for turnering ${tournamentId}`);
        if (trackProgress) {
            setImportProgress(tournamentId, { phase: 'done', current: rows.length, total: rows.length });
            clearImportProgressLater(tournamentId);
        }
    } catch (e) {
        console.error(`Klub-opsamling fejlede for turnering ${tournamentId}:`, e.message);
        if (trackProgress) {
            setImportProgress(tournamentId, { phase: 'error', error: e.message || 'Klub-opsamling fejlede' });
            clearImportProgressLater(tournamentId);
        }
    }
}

// Et "rigtigt" navn er en faktisk spiller — ikke tomt, ikke en TS-placeholder.
// Bruges både til indkommende TS-navne og til at afgøre om en DB-værdi allerede
// er udfyldt (så vi ikke overskriver en rigtig spiller med "?"/tomt ved sync).
function isRealName(s) {
    if (!s) return false;
    const t = String(s).trim();
    if (!t || t === '?') return false;
    const lower = t.toLowerCase();
    if (lower === 'bye' || lower.startsWith('winner of') || lower.startsWith('vinder af')) return false;
    // Kun et seed-mærke som "[1]" eller "[3/4]" uden navn
    if (/^\[[^\]]*\]$/.test(t)) return false;
    return true;
}

// Normaliser et navn til sammenligning: fjern seed-suffiks ("[1]", "[3/4]") og kollaps whitespace.
function normalizeName(s) {
    return String(s || '').replace(/\s*\[[^\]]*\]\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Trunkér til kolonne-grænsen (VARCHAR(100)) så et langt navn ikke fejler hele UPDATE'en.
function clampName(s) {
    if (s == null) return s;
    const t = String(s);
    return t.length > 100 ? t.substring(0, 100) : t;
}

// Beregn hvilke navne-/doubles-kolonner der skal opdateres for en pending-kamp ved sync.
// Regel (brugerens valg): skriv kun et indkommende TS-navn hvis det er RIGTIGT — så både
// "?"→navn og spiller-udskiftninger propagerer. Overskriv ALDRIG et eksisterende navn med
// tomt/"?" (ingen regression til placeholder). Returnerer {kolonne: ny værdi} for ændringer.
function computeFillOnlyChanges(row, incoming) {
    const dbS1 = [row.side1_player1, row.side1_player2];
    const dbS2 = [row.side2_player1, row.side2_player2];
    let inS1 = [incoming.side1Player1, incoming.side1Player2];
    let inS2 = [incoming.side2Player1, incoming.side2Player2];

    // Side-mapping: hvis DB allerede har rigtige navne, afgør via navne-overlap om TS
    // viser siderne ombyttet, så vi ikke lander navne på den forkerte side. Ingen overlap
    // (ren placeholder) → behold rækkefølgen (uskadeligt, der var intet at bytte om).
    const overlap = (a, b) => {
        const bset = new Set(b.filter(isRealName).map(normalizeName));
        return a.filter(isRealName).map(normalizeName).filter(n => bset.has(n)).length;
    };
    if (overlap(inS1, dbS2) + overlap(inS2, dbS1) > overlap(inS1, dbS1) + overlap(inS2, dbS2)) {
        const t = inS1; inS1 = inS2; inS2 = t;
    }

    const changes = {};
    const apply = (dbVal, inVal, col) => {
        if (isRealName(inVal) && String(inVal) !== String(dbVal || '')) {
            changes[col] = clampName(inVal);
        }
    };
    apply(dbS1[0], inS1[0], 'side1_player1');
    apply(dbS1[1], inS1[1], 'side1_player2');
    apply(dbS2[0], inS2[0], 'side2_player1');
    apply(dbS2[1], inS2[1], 'side2_player2');

    if (!!incoming.doubles !== !!row.doubles) changes.doubles = incoming.doubles ? 1 : 0;
    return changes;
}

// ---- Parring af TS-kampe med vores rækker ved sync (nr. 74) ----
//
// Kilde-id'et er "draw#runde#løbenummer" efter TS' rækkefølge. Flytter TS en
// kamp (ny dag/tid), skifter løbenumrene, og før parrede sync alene på id'et:
// en ventende række kunne få en anden kamps spillere — også en færdigspillet
// kamps. Nu parres der først på spillerne, så på id'et (hvis spillerne ikke
// modsiger det), så med en tom pladsholder i samme runde. En kamp, der ikke
// kan parres, får et nyt, unikt id (id~n), hvis dens id allerede er brugt.

// "draw#runde" for et kilde-id (uden løbenummer og ~n)
function rundeScopeOf(sourceMatchId) {
    const base = String(sourceMatchId || '').split('~')[0];
    const i = base.lastIndexOf('#');
    return i === -1 ? base : base.slice(0, i);
}

function ordinalOf(sourceMatchId) {
    const n = parseInt(String(sourceMatchId || '').split('~')[0].split('#').pop(), 10);
    return Number.isFinite(n) ? n : 0;
}

// Rigtige navne pr. side, normaliseret
function sideNavne(a, b) {
    return [a, b].filter(isRealName).map(normalizeName).sort();
}
function kampNavne(x, erRaekke) {
    return erRaekke
        ? { s1: sideNavne(x.side1_player1, x.side1_player2), s2: sideNavne(x.side2_player1, x.side2_player2) }
        : { s1: sideNavne(x.side1Player1, x.side1Player2), s2: sideNavne(x.side2Player1, x.side2Player2) };
}
const ensListe = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const begge = (n) => n.s1.length > 0 && n.s2.length > 0;

// Samme spillere på begge sider (siderne må være byttet)
function sammeSpillere(a, b) {
    if (!begge(a) || !begge(b)) return false;
    return (ensListe(a.s1, b.s1) && ensListe(a.s2, b.s2)) || (ensListe(a.s1, b.s2) && ensListe(a.s2, b.s1));
}

// Begge kender mindst én spiller, men ikke én spiller er fælles: en anden
// kamp. (En udskiftning af én spiller deler stadig mindst én.) Før skulle
// begge kende begge sider — så kunne en walkover med en afmeldt spiller
// ("C mod [WDN]") parres på id med en helt anden kamp ("A mod B").
function modsigerHinanden(a, b) {
    const a2 = [...a.s1, ...a.s2];
    const b2 = new Set([...b.s1, ...b.s2]);
    if (!a2.length || !b2.size) return false;
    return !a2.some(n => b2.has(n));
}

// Alle TS' rigtige navne findes i rækken (og der er mindst ét): sikkert nok
// til at flytte et resultat fra TS over på rækken.
function navneForenelige(row, m) {
    const r = kampNavne(row, true);
    const i = kampNavne(m, false);
    const rs = new Set([...r.s1, ...r.s2]);
    const is = [...i.s1, ...i.s2];
    return is.length > 0 && is.every(n => rs.has(n));
}

// TS viser kampens sider ombyttet ift. rækken (afgjort på navne-overlap)
function sideOmbyttet(row, m) {
    const r = kampNavne(row, true);
    const i = kampNavne(m, false);
    const faelles = (a, b) => a.filter(n => b.includes(n)).length;
    return faelles(i.s1, r.s2) + faelles(i.s2, r.s1) > faelles(i.s1, r.s1) + faelles(i.s2, r.s2);
}

// Resultatet fra TS som kolonner (vinder/sæt), når TS har kampen som spillet
// eller walkover — ellers null. s1/s2 er rækkens holdnavne (side 1/2), byttet =
// TS' sider er ombyttet ift. rækken. Sættene skrives i banernes format
// ("A 21-15 B, A 18-21 B"), så Turnering og Kamphistorik viser dem som ellers.
function tsResultat(m, s1, s2, byttet = false) {
    if (m.tsStatus !== 'walkover' && m.tsStatus !== 'spillet') return null;
    let vinder = m.tsWinner === 1 || m.tsWinner === 2 ? m.tsWinner : null;
    if (vinder && byttet) vinder = 3 - vinder;
    let saet = 'W.O.';
    if (m.tsStatus === 'spillet') {
        const sets = (m.tsSets || []).map(([a, b]) => (byttet ? [b, a] : [a, b]));
        saet = sets.length ? sets.map(([a, b]) => `${s1} ${a}-${b} ${s2}`).join(', ') : null;
    }
    return { winner_team: vinder, set_scores: saet ? saet.substring(0, 200) : null };
}

const holdNavn = (a, b) => [a, b].filter(Boolean).join(' / ');

// Planlagt tidspunkt fra TS ("YYYY-MM-DD HH:MM") eller null
const planlagt = (m) => (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(m.plannedAt || '') ? m.plannedAt : null);

/**
 * Parrer indkommende TS-kampe med eksisterende rækker. Ren funktion.
 * Returnerer [{ m, row, sourceMatchId }] i incoming-rækkefølge; row er null for
 * en ny kamp, og sourceMatchId er det id, en ny kamp skal gemmes med.
 */
function parSyncKampe(existing, incoming) {
    const raekker = existing.filter(r => r.source_match_id)
        .map(r => ({ r, navne: kampNavne(r, true), scope: rundeScopeOf(r.source_match_id) }));
    const byKey = new Map(raekker.map(x => [x.r.source_match_id, x]));
    const taget = new Set();
    const ind = incoming.map(m => ({ m, navne: kampNavne(m, false), scope: rundeScopeOf(m.sourceMatchId), row: null }));

    // 1. Samme spillere i samme draw og runde — uanset løbenummer
    for (const x of ind) {
        if (!x.m.sourceMatchId || !begge(x.navne)) continue;
        const kandidater = raekker.filter(y => !taget.has(y) && y.scope === x.scope && sammeSpillere(x.navne, y.navne));
        const valgt = kandidater.find(y => y.r.source_match_id === x.m.sourceMatchId) || kandidater[0];
        if (valgt) { x.row = valgt; taget.add(valgt); }
    }
    // 2. Samme id, hvis spillerne ikke modsiger det
    for (const x of ind) {
        if (x.row || !x.m.sourceMatchId) continue;
        const y = byKey.get(x.m.sourceMatchId);
        if (y && !taget.has(y) && !modsigerHinanden(x.navne, y.navne)) { x.row = y; taget.add(y); }
    }
    // 3. En ventende pladsholder (ingen navne) i samme draw og runde, nærmest
    //    i løbenummer — to pladsholdere, der har byttet plads, finder hinanden
    for (const x of ind) {
        if (x.row || !x.m.sourceMatchId) continue;
        const ord = ordinalOf(x.m.sourceMatchId);
        const fri = raekker
            .filter(y => !taget.has(y) && y.scope === x.scope && y.r.status === 'pending'
                && !y.navne.s1.length && !y.navne.s2.length)
            .sort((a, b) => Math.abs(ordinalOf(a.r.source_match_id) - ord) - Math.abs(ordinalOf(b.r.source_match_id) - ord));
        if (fri[0]) { x.row = fri[0]; taget.add(fri[0]); }
    }
    // 4. Nye kampe: unikt id, hvis TS-id'et allerede er brugt af en anden række
    const brugt = new Set(raekker.map(y => y.r.source_match_id));
    return ind.map(x => {
        if (x.row) return { m: x.m, row: x.row.r, sourceMatchId: x.row.r.source_match_id };
        let id = x.m.sourceMatchId || null;
        if (id && brugt.has(id)) {
            let n = 2;
            while (brugt.has(`${id}~${n}`)) n++;
            id = `${id}~${n}`;
        }
        if (id) brugt.add(id);
        return { m: x.m, row: null, sourceMatchId: id };
    });
}

// Per-turnering in-flight guard mod samtidige sync-kald (dobbeltklik / overlap /
// scheduler-kørsel). Keyet med tenant + id — samme turnerings-id kan findes i
// flere klub-databaser.
const _syncingTournaments = new Set();

// Seneste auto-sync-resultat pr. turnering ("tenant:id" -> {at, updated,
// newCandidates, error}). Vises i admin-UI'et så man kan se at serveren kører,
// og få besked når der ligger nye TS-kampe der kræver manuel bekræftelse.
const _autoSyncStatus = new Map();

function tenantSyncKey(tenant, tournamentId) {
    return `${tenant || 'direct'}:${tournamentId}`;
}

// ---- Demoen og tournamentsoftware (nr. 91, lofterne i config/demo.js) ----
// Hvornår en turnering i demoen sidst er set (GET /active — admin, TV og
// oversigt henter den) og sidst hentet fra tournamentsoftware. Kun i hukommelsen:
// efter en genstart regnes alle som set ved opstarten.
const _demoStart = Date.now();
const _demoSidstSet = new Map();      // turnering-id -> ms
const _demoSidstHentet = new Map();   // turnering-id -> ms

// Sekunder til turneringen må hentes igen (0 = nu, og hentningen noteres)
function demoSyncVent(id, nu = Date.now()) {
    const sidst = _demoSidstHentet.get(Number(id));
    if (sidst && nu - sidst < demo.DEMO_SYNC_PAUSE_MS) return Math.ceil((demo.DEMO_SYNC_PAUSE_MS - (nu - sidst)) / 1000);
    _demoSidstHentet.set(Number(id), nu);
    return 0;
}
const demoUset = (id, nu = Date.now()) => nu - (_demoSidstSet.get(Number(id)) || _demoStart) > demo.DEMO_AUTO_SYNC_USET_MS;

// Hjælper: hent alle matches for en turnering — efter TS' planlagte tidspunkt
// (kampe uden tidspunkt sidst), ellers i den rækkefølge, de blev tilføjet
async function getMatchesForTournament(tournamentId) {
    return query(
        `SELECT id, match_order, label, planned_time, doubles, source_match_id,
                side1_player1, side1_player2, side2_player1, side2_player2,
                court_number, status, winner_team, set_scores, created_at,
                started_at, finished_at
         FROM tournament_matches
         WHERE tournament_id = ?
         ORDER BY planned_time IS NULL, planned_time, match_order ASC`,
        [tournamentId]
    );
}

// Én række til tournament_matches ud fra en kamp fra import/kandidater/sync.
// Har TS allerede kampen som spillet eller walkover, gemmes den som færdig.
function nyKampRaekke(tournamentId, matchOrder, m, kilde) {
    const s1 = [clampName(m.side1Player1) || null, clampName(m.side1Player2) || null];
    const s2 = [clampName(m.side2Player1) || null, clampName(m.side2Player2) || null];
    const res = tsResultat(m, holdNavn(s1[0], s1[1]), holdNavn(s2[0], s2[1]));
    return {
        sql: `INSERT INTO tournament_matches
              (tournament_id, match_order, label, planned_time, doubles, source_match_id,
               side1_player1, side1_player2, side2_player1, side2_player2,
               status, winner_team, set_scores, finished_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${res ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
        params: [
            tournamentId, matchOrder, m.label || null, planlagt(m), m.doubles ? 1 : 0, kilde,
            s1[0], s1[1], s2[0], s2[1],
            res ? 'finished' : 'pending', res ? res.winner_team : null, res ? res.set_scores : null
        ]
    };
}

// GET /api/tournaments/active - Alle aktive turneringer med matches (public)
router.get('/active', async (req, res, next) => {
    try {
        const tournaments = await query(
            `SELECT id, name, status, source_tournament_id, source_locations, auto_sync, created_at
             FROM tournaments WHERE status = 'active'
             ORDER BY created_at DESC`
        );

        const tenant = req.clubDbName || 'direct';
        if (demo.erDemo(req)) for (const t of tournaments) _demoSidstSet.set(t.id, Date.now());
        const result = [];
        for (const t of tournaments) {
            const matches = await getMatchesForTournament(t.id);
            result.push({
                ...t,
                auto_sync: !!t.auto_sync,
                source_locations: laesSpillesteder(t.source_locations),
                matches,
                // Seneste serverbaserede auto-sync-kørsel (null hvis ingen endnu)
                autoSyncStatus: _autoSyncStatus.get(tenantSyncKey(tenant, t.id)) || null
            });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// GET /api/tournaments/court/:courtNumber - Den turneringskamp, der spilles på
// banen (public, som /active). Tabletten spørger her i stedet for at hente
// hele turneringen ved hvert point — med 200-300 kampe var det ~100 kB pr.
// point pr. tablet. Svarer { tournament: { id, name, matches: [kampen] } }
// eller { tournament: null }.
router.get('/court/:courtNumber', async (req, res, next) => {
    try {
        const bane = parseInt(req.params.courtNumber, 10);
        if (!Number.isFinite(bane)) return res.status(400).json({ error: 'Ugyldig bane' });
        const m = await queryOne(
            `SELECT m.id, m.tournament_id, m.match_order, m.label, m.planned_time, m.doubles, m.source_match_id,
                    m.side1_player1, m.side1_player2, m.side2_player1, m.side2_player2,
                    m.court_number, m.status, m.winner_team, m.set_scores, m.created_at,
                    m.started_at, m.finished_at, t.name AS tournament_name
             FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
             WHERE t.status = 'active' AND m.court_number = ? AND m.status = 'active'
             ORDER BY t.created_at DESC LIMIT 1`,
            [bane]
        );
        if (!m) return res.json({ tournament: null });
        const { tournament_id, tournament_name, ...kamp } = m;
        res.json({ tournament: { id: tournament_id, name: tournament_name, matches: [kamp] } });
    } catch (error) {
        next(error);
    }
});

// GET /api/tournaments/export.csv - alle afsluttede turneringskampe (også i
// turneringer, der stadig er i gang — som historik-fanen) som CSV til Excel
// (nr. 48). Samme adgang som historikken; hentes i bidder (config/historikEksport.js).
router.get('/export.csv', authMiddleware, requirePage('history'), async (req, res, next) => {
    const eksport = require('../config/historikEksport');
    try {
        await eksport.skrivCsv(res, eksport.filnavn('turneringskampe'), eksport.TURNERING_HOVED,
            (efter, antal) => query(
                `SELECT m.id, m.label, m.match_order, m.court_number, m.winner_team, m.set_scores,
                        m.side1_player1, m.side1_player2, m.side2_player1, m.side2_player2,
                        m.started_at, m.finished_at, t.name AS tournament_name
                 FROM tournament_matches m JOIN tournaments t ON t.id = m.tournament_id
                 WHERE m.status = 'finished' ${efter === null ? '' : 'AND m.id < ?'}
                 ORDER BY m.id DESC LIMIT ${Number(antal)}`,
                efter === null ? [] : [efter]),
            eksport.turneringRaekke);
    } catch (error) {
        if (res.headersSent) { console.error('Eksport af turneringskampe fejlede:', error.message); return res.destroy(); }
        next(error);
    }
});

// GET /api/tournaments/history - afsluttede turneringer, nyeste først. Kun admin
// (siden Kamphistorik) og højst 200 pr. side (?limit=, ?offset=) — nr. 88: før
// uden login og uden loft. Oversigt og TV bruger /active.
router.get('/history', authMiddleware, requirePage('history'), async (req, res, next) => {
    try {
        const { limit, offset } = historikSide(req.query);
        const tournaments = await query(
            `SELECT id, name, status, created_at
             FROM tournaments WHERE status = 'finished'
             ORDER BY created_at DESC
             LIMIT ${limit} OFFSET ${offset}`
        );

        const result = [];
        for (const t of tournaments) {
            const matches = await getMatchesForTournament(t.id);
            result.push({ ...t, matches });
        }

        res.json(result);
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments - Opret turnering (kræver auth)
router.post('/', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { name, sourceTournamentId } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Navn er påkrævet' });
        }

        // Bloker hvis der findes en aktiv holdkamp — én type ad gangen
        const activeTeamMatch = await queryOne(
            `SELECT id, team1_name, team2_name FROM team_matches WHERE status = 'active' LIMIT 1`
        );
        if (activeTeamMatch) {
            return res.status(409).json({
                error: `Du har en aktiv holdkamp ("${activeTeamMatch.team1_name} vs ${activeTeamMatch.team2_name}"). Afslut eller slet den før du opretter en turnering.`
            });
        }

        const result = await query(
            `INSERT INTO tournaments (name, status, source_tournament_id) VALUES (?, 'active', ?)`,
            [name.trim(), sourceTournamentId || null]
        );

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        next(error);
    }
});

// POST /api/tournaments/:id/matches - Tilføj kamp (kræver auth)
router.post('/:id/matches', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const {
            label, doubles,
            side1Player1, side1Player2,
            side2Player1, side2Player2
        } = req.body;

        const tournament = await queryOne('SELECT id FROM tournaments WHERE id = ?', [id]);
        if (!tournament) {
            return res.status(404).json({ error: 'Turnering ikke fundet' });
        }

        const maxRow = await queryOne(
            'SELECT COALESCE(MAX(match_order), 0) AS max_order FROM tournament_matches WHERE tournament_id = ?',
            [id]
        );
        const matchOrder = (maxRow?.max_order || 0) + 1;

        const result = await query(
            `INSERT INTO tournament_matches
             (tournament_id, match_order, label, doubles,
              side1_player1, side1_player2, side2_player1, side2_player2)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, matchOrder, label || null, doubles ? 1 : 0,
                side1Player1 || null, side1Player2 || null,
                side2Player1 || null, side2Player2 || null
            ]
        );

        res.json({ success: true, id: result.insertId, matchOrder });
    } catch (error) {
        next(error);
    }
});

// Indsæt kampe i en turnering inde i en transaktion (tx fra transaktion()).
// Kampe med et kilde-id, turneringen allerede har (eller som står to gange i
// listen), springes over — databasen har UNIQUE (tournament_id, source_match_id).
async function indsaetKampe(tx, tournamentId, matches) {
    const maxRow = await tx.queryOne(
        'SELECT COALESCE(MAX(match_order), 0) AS max_order FROM tournament_matches WHERE tournament_id = ?',
        [tournamentId]
    );
    const kendte = new Set((await tx.query(
        'SELECT source_match_id FROM tournament_matches WHERE tournament_id = ? AND source_match_id IS NOT NULL',
        [tournamentId]
    )).map(r => r.source_match_id));
    let nextOrder = (maxRow?.max_order || 0) + 1;
    let inserted = 0, skipped = 0;
    for (const m of matches) {
        const kilde = m.sourceMatchId || null;
        if (kilde && kendte.has(kilde)) { skipped++; continue; }
        if (m.tsStatus === 'aflyst') { skipped++; continue; } // aflyst på TS — spilles ikke
        if (kilde) kendte.add(kilde);
        const r = nyKampRaekke(tournamentId, nextOrder++, m, kilde);
        await tx.query(r.sql, r.params);
        inserted++;
    }
    return { inserted, skipped };
}

// Turneringens valgte spillesteder (navne) eller null = alle (migration 058)
async function turneringensSpillesteder(tournamentId) {
    const t = await queryOne('SELECT source_locations FROM tournaments WHERE id = ?', [tournamentId]);
    return laesSpillesteder(t && t.source_locations);
}

function laesSpillesteder(v) {
    if (!v) return null;
    try {
        const a = JSON.parse(v);
        return Array.isArray(a) && a.length ? a.filter(s => typeof s === 'string') : null;
    } catch (e) {
        return null;
    }
}

// Spillesteder fra importen: navne (højst 50, hver højst 200 tegn) eller null
function rensSpillesteder(v) {
    if (!Array.isArray(v)) return null;
    const navne = [...new Set(v.filter(s => typeof s === 'string').map(s => s.trim()).filter(Boolean))];
    if (navne.length === 0 || navne.length > 50 || navne.some(s => s.length > 200)) return null;
    return navne;
}

// Klub-opsamling for en TS-importeret turnering — i BAGGRUNDEN (ikke await'et),
// så HTTP-svaret kommer straks; frontend poller GET /:id/import-progress.
async function startKlubOpsamling(id) {
    const t = await queryOne('SELECT source_tournament_id FROM tournaments WHERE id = ?', [id]);
    const clubCapture = !!(t && t.source_tournament_id);
    if (clubCapture) {
        setImportProgress(id, { phase: 'fetching-matches', current: 0, total: 0 });
        captureTournamentClubs(id, t.source_tournament_id, null, true);
    }
    return clubCapture;
}

// POST /api/tournaments/import — opret en importeret turnering med alle dens
// kampe i ÉN transaktion (nr. 75/81). Før var det to kald (opret, så kampe):
// fejlede det andet (fx for stor JSON-krop), stod der en tom, aktiv turnering,
// som spærrede holdkamp-køen, og et nyt forsøg lavede en turnering mere.
router.post('/import', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { name, sourceTournamentId, matches, sourceLocations } = req.body || {};
        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Navn er påkrævet' });
        }
        if (!Array.isArray(matches) || matches.length === 0) {
            return res.status(400).json({ error: 'Ingen kampe at importere' });
        }
        // Valgte spillesteder (null/tom = alle) — gemmes, så opdateringen
        // heller ikke henter de andre steders kampe ind
        const spillesteder = rensSpillesteder(sourceLocations);
        if (Array.isArray(sourceLocations) && sourceLocations.length > 0 && !spillesteder) {
            return res.status(400).json({ error: 'Ugyldige spillesteder' });
        }
        if (matches.length > 5000) {
            return res.status(400).json({ error: 'For mange kampe (højst 5000)' });
        }
        const svar = await transaktion(async (tx) => {
            const aktiv = await tx.queryOne(
                `SELECT id, team1_name, team2_name FROM team_matches WHERE status = 'active' LIMIT 1`
            );
            if (aktiv) {
                const err = new Error(`Du har en aktiv holdkamp ("${aktiv.team1_name} vs ${aktiv.team2_name}"). Afslut eller slet den før du opretter en turnering.`);
                err.status = 409;
                throw err;
            }
            const r = await tx.query(
                `INSERT INTO tournaments (name, status, source_tournament_id, source_locations) VALUES (?, 'active', ?, ?)`,
                [String(name).trim(), sourceTournamentId || null,
                    sourceTournamentId && spillesteder ? JSON.stringify(spillesteder) : null]
            );
            const { inserted, skipped } = await indsaetKampe(tx, r.insertId, matches);
            return { id: r.insertId, inserted, skipped };
        });
        const clubCapture = await startKlubOpsamling(svar.id);
        res.json({ success: true, ...svar, clubCapture });
    } catch (error) {
        if (error.status === 409) return res.status(409).json({ error: error.message });
        next(error);
    }
});

// POST /api/tournaments/:id/matches/bulk - Tilføj mange kampe på én gang (kræver auth)
// Bruges når brugeren tilføjer nye kampe fra "Opdater" (kandidaterne).
router.post('/:id/matches/bulk', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const { matches } = req.body;

        if (!Array.isArray(matches) || matches.length === 0) {
            return res.status(400).json({ error: 'Ingen kampe at tilføje' });
        }

        const tournament = await queryOne('SELECT id FROM tournaments WHERE id = ?', [id]);
        if (!tournament) {
            return res.status(404).json({ error: 'Turnering ikke fundet' });
        }

        // Alle eller ingen (nr. 81). En kamp, hvis kilde-id allerede findes (fx
        // auto-tilføjet af synken, mens kandidat-listen stod åben), springes over.
        const { inserted, skipped } = await transaktion((tx) => indsaetKampe(tx, id, matches));
        const clubCapture = await startKlubOpsamling(id);
        res.json({ success: true, inserted, skipped, clubCapture });
    } catch (error) {
        next(error);
    }
});

// GET /api/tournaments/:id/import-progress - Status for baggrunds-klub-opsamling.
// Bruges af frontend til at vise en progressbar under import. Ukendt/ryddet id
// (fx job færdigt og udløbet) svarer { phase: 'done' } så polling altid kan stoppe.
router.get('/:id/import-progress', authMiddleware, requirePage('tournament'), (req, res) => {
    const p = importProgress.get(progressKey(req.params.id));
    if (!p) return res.json({ phase: 'done' });
    res.json(p);
});

// POST /api/tournaments/:id/sync-import - Genhent TS-data og opdatér turneringen (kræver auth).
// Opdaterer KUN pending-kampe (fill-only, jf. computeFillOnlyChanges), rører aldrig
// aktive/afsluttede kampe, og returnerer nye TS-kampe som kandidater (indsættes ikke her —
// brugeren bekræfter dem via det normale bulk-endpoint).
// Draw-scopet er første segment af source_match_id ("draw#runde#ordinal") — dvs.
// puljen/lodtrækningen. Bruges til at afgøre om en ny TS-kamp er bracket-
// progression (samme draw som eksisterende kampe, fx en semifinale der får navne)
// eller en genuint ny kategori der stadig kræver manuel godkendelse.
function drawScopeOf(sourceMatchId) {
    if (!sourceMatchId) return null;
    const i = sourceMatchId.indexOf('#');
    return i === -1 ? sourceMatchId : sourceMatchId.slice(0, i);
}

// Kerne for TS-opdatering: opdaterer pending-kampe og returnerer resultatet.
// Bruges af sync-ruten (manuel opdatering fra UI) og af schedulerens
// serverbaserede auto-opdatering. Kalderen ejer in-flight-guarden og skal
// køre i korrekt tenant-kontekst.
//
// Navne-fills håndteres på TO måder, begge uden manuel godkendelse:
//  1. Eksisterende pending-kamp får sit "?" udfyldt → computeFillOnlyChanges
//  2. En bracket-kamp (fx semifinale) der først dukker op i TS-feedet når
//     spillerne er afgjort → auto-tilføjes HVIS den hører til en draw/pulje
//     vi allerede har kampe fra, og mindst ét rigtigt navn er kendt.
// Genuint nye kategorier (draw vi ikke kender) forbliver manuelle kandidater.
async function syncTournamentCore(tournament, { skipClubs = false, idag = null } = {}) {
    const existing = await getMatchesForTournament(tournament.id);
    // Den automatiske opdatering (idag sat) skåner TS: kun dagens kampe og
    // Swiss-rækker uden ventende kampe hentes hver gang — se
    // fetchAndParseTournamentMatches. En Swiss-række med ventende kampe kan
    // ikke få en ny runde endnu.
    const auto = idag ? { idag, travleSwiss: travleSwissRaekker(existing) } : null;
    const { matches: alleSteder } = await fetchAndParseTournamentMatches(tournament.source_tournament_id, auto);
    // Kun de spillesteder, turneringen er importeret med (migration 058)
    const incoming = filtrerSpillesteder(alleSteder, await turneringensSpillesteder(tournament.id));

    const knownDraws = new Set();
    for (const row of existing) {
        if (row.source_match_id) {
            const scope = drawScopeOf(row.source_match_id);
            if (scope) knownDraws.add(scope);
        }
    }

    let updated = 0, unchanged = 0, skipped = 0, added = 0;
    const newCandidates = []; // kræver manuel godkendelse (ny draw/kategori)
    const autoAdd = [];       // bracket-progression i kendt draw → tilføjes automatisk

    // Aflyste kampe på TS spilles ikke: de tilføjes ikke og parres ikke (en
    // aflyst kamp har ofte kun afmeldte spillere uden navn og ville ellers
    // blive tilbudt som "ny kamp" ved hver opdatering)
    const spilbare = incoming.filter(m => m.tsStatus !== 'aflyst');

    // Spillerne først, så id'et (nr. 74) — se parSyncKampe
    for (const { m, row, sourceMatchId } of parSyncKampe(existing, spilbare)) {
        if (!row) {
            const cand = {
                sourceMatchId,
                label: m.round ? `${m.category} — ${m.round}` : m.category,
                category: m.category,
                round: m.round,
                dayLabel: m.dayLabel || '',
                plannedAt: planlagt(m) || '',
                tsStatus: m.tsStatus || '',
                tsWinner: m.tsWinner || null,
                tsSets: m.tsSets || [],
                doubles: !!m.doubles,
                side1Player1: m.side1Player1, side1Player2: m.side1Player2,
                side2Player1: m.side2Player1, side2Player2: m.side2Player2
            };
            // Auto-tilføj hvis: kampen har et matchbart source-id (så den ikke
            // gen-tilføjes næste sync), hører til en draw vi allerede tracker,
            // og mindst ét rigtigt spillernavn er kendt.
            const inKnownDraw = sourceMatchId && knownDraws.has(drawScopeOf(sourceMatchId));
            const hasName = [m.side1Player1, m.side1Player2, m.side2Player1, m.side2Player2].some(isRealName);
            if (inKnownDraw && hasName) {
                autoAdd.push(cand);
            } else {
                newCandidates.push(cand);
            }
            continue;
        }

        if (row.status !== 'pending') { skipped++; continue; } // aktiv/afsluttet — rør aldrig

        const changes = computeFillOnlyChanges(row, m);

        // TS' planlagte tidspunkt følger med, når TS flytter kampen
        const tid = planlagt(m);
        if (tid && tid !== (row.planned_time || null)) changes.planned_time = tid;

        // Spillet eller walkover på TS (fx tastet på stævnekontoret, eller
        // spillet på en bane uden tablet): kampen er færdig og skal ikke kunne
        // sættes på en bane. Kun når TS' navne alle findes i rækken.
        let afslut = '';
        if ((m.tsStatus === 'walkover' || m.tsStatus === 'spillet') && navneForenelige(row, m)) {
            const n = { ...row, ...changes };
            const res = tsResultat(m, holdNavn(n.side1_player1, n.side1_player2),
                holdNavn(n.side2_player1, n.side2_player2), sideOmbyttet(row, m));
            if (res) {
                changes.status = 'finished';
                changes.winner_team = res.winner_team;
                changes.set_scores = res.set_scores;
                afslut = ', finished_at = CURRENT_TIMESTAMP';
            }
        }

        if (Object.keys(changes).length === 0) { unchanged++; continue; }

        const cols = Object.keys(changes);
        const setSql = cols.map(c => `${c} = ?`).join(', ') + afslut;
        const vals = cols.map(c => changes[c]);
        // status='pending'-guard: hvis en bane lige har aktiveret kampen midt i sync,
        // rammer UPDATE'en 0 rækker → tæl som skipped i stedet for at overskrive.
        const result = await query(
            `UPDATE tournament_matches SET ${setSql} WHERE id = ? AND status = 'pending'`,
            [...vals, row.id]
        );
        if (result.affectedRows > 0) updated++; else skipped++;
    }

    // Auto-tilføj bracket-progressionskampe (fx semifinaler med udfyldte navne).
    // Appendes efter eksisterende kampe i match_order.
    if (autoAdd.length) {
        const maxRow = await queryOne(
            'SELECT COALESCE(MAX(match_order), 0) AS max_order FROM tournament_matches WHERE tournament_id = ?',
            [tournament.id]
        );
        let nextOrder = (maxRow?.max_order || 0) + 1;
        for (const c of autoAdd) {
            const r = nyKampRaekke(tournament.id, nextOrder++, c, c.sourceMatchId || null);
            await query(r.sql, r.params);
            added++;
        }
    }

    // Klub-opsamling genbruger de allerede hentede kampe. Auto-opdateringer
    // (skipClubs) springer den helt over — klub-logoer ændrer sig ikke hvert
    // 2. minut, og det sparer klubside-kald mod TS.
    if (!skipClubs) {
        await captureTournamentClubs(tournament.id, tournament.source_tournament_id, incoming);
    }

    return { updated, unchanged, skipped, added, newCandidates };
}

// Kør auto-sync for alle aktive turneringer med auto_sync slået til.
// Kaldes af scheduleren hvert 2. minut — SKAL køres i tenant-kontekst
// (runWithTenant) med dbLabel som matcher req.clubDbName-konventionen.
async function runTournamentAutoSync(dbLabel, nu = new Date()) {
    const tournaments = await query(
        `SELECT id, source_tournament_id FROM tournaments
         WHERE status = 'active' AND auto_sync = 1 AND source_tournament_id IS NOT NULL
         ORDER BY id DESC`
    );
    const { dato, time } = koebenhavnNu(nu);

    // Demoen (nr. 91): højst DEMO_AUTO_SYNC_MAKS (de nyeste — fx efter en
    // gendannet backup), og en turnering, ingen har set i et døgn, slås fra
    const erDemo = demo.erDemoDb(dbLabel);
    for (const [i, t] of tournaments.entries()) {
        if (!erDemo) continue;
        if (i >= demo.DEMO_AUTO_SYNC_MAKS || demoUset(t.id)) {
            await query('UPDATE tournaments SET auto_sync = 0 WHERE id = ?', [t.id]);
            console.log(`  ⏹ ${dbLabel}: demoens turnering ${t.id} — automatisk opdatering slået fra (${i >= demo.DEMO_AUTO_SYNC_MAKS ? 'over loftet' : 'ikke set i et døgn'})`);
            t.fra = true;
        }
    }

    for (const t of tournaments) {
        if (t.fra) continue;
        const key = tenantSyncKey(dbLabel, t.id);
        if (_syncingTournaments.has(key)) continue; // manuel opdatering i gang
        const dageRaekker = await query(
            `SELECT DISTINCT LEFT(planned_time, 10) AS d FROM tournament_matches
             WHERE tournament_id = ? AND planned_time IS NOT NULL ORDER BY d`,
            [t.id]
        );
        const dage = (Array.isArray(dageRaekker) ? dageRaekker : [])
            .map(r => r && r.d).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d || ''));
        const plan = autoPlan({ nu: nu.getTime(), dato, time, dage, tidligere: _autoSyncPlan.get(key) });
        const status = _autoSyncStatus.get(key);
        if (!plan.koer) {
            if (status || plan.pause !== 'venter') _autoSyncStatus.set(key, { ...(status || {}), pause: plan.pause, naeste: plan.naeste || null });
            continue;
        }
        if (erDemo && demoSyncVent(t.id) > 0) continue; // lige hentet manuelt

        _syncingTournaments.add(key);
        try {
            const res = await syncTournamentCore(t, { skipClubs: true, idag: dato });
            const naeste = plan.turneringsdag ? 0 : nu.getTime() + AUTO_UDEN_FOR_DAGE_MS;
            _autoSyncPlan.set(key, { fejl: 0, naeste });
            _autoSyncStatus.set(key, {
                at: Date.now(),
                updated: res.updated,
                added: res.added,
                newCandidates: res.newCandidates.length,
                error: null,
                pause: plan.turneringsdag ? null : 'udenfor',
                naeste: naeste || null
            });
            if (res.updated > 0 || res.added > 0 || res.newCandidates.length > 0) {
                console.log(`  ↻ ${dbLabel}: turnering ${t.id} auto-opdateret — ${res.updated} opdateret, ${res.added} tilføjet, ${res.newCandidates.length} nye kandidater`);
            }
        } catch (e) {
            // Venter længere for hver fejl i træk (5, 10, 20, 30 min), så vi ikke
            // bliver ved med at ramme TS, hvis den siger fra eller er nede
            const fejl = ((_autoSyncPlan.get(key) || {}).fejl || 0) + 1;
            const naeste = nu.getTime() + AUTO_FEJL_PAUSE_MIN[Math.min(fejl, AUTO_FEJL_PAUSE_MIN.length) - 1] * 60000;
            _autoSyncPlan.set(key, { fejl, naeste });
            _autoSyncStatus.set(key, { at: Date.now(), updated: 0, added: 0, newCandidates: 0, error: e.message || String(e), pause: 'fejl', naeste });
            console.error(`❌ Auto-opdatering fejlede for turnering ${t.id} (${dbLabel}, fejl nr. ${fejl}):`, e.message);
        } finally {
            _syncingTournaments.delete(key);
        }
    }
}

// ---- Den automatiske opdaterings rytme ----
//
// Scheduleren kalder hvert 2. minut. På turneringens dage hentes der hver
// gang (dagens kampe — resten genbruges, se fetchAndParseTournamentMatches),
// andre dage højst hver halve time, aldrig om natten (22-7) og ikke når
// turneringens sidste dag er ovre. Fejler TS, ventes der længere og længere.
const AUTO_UDEN_FOR_DAGE_MS = 30 * 60 * 1000;
const AUTO_FEJL_PAUSE_MIN = [5, 10, 20, 30];
const AUTO_NAT_FRA = 22, AUTO_NAT_TIL = 7;
const _autoSyncPlan = new Map(); // "tenant:id" -> { fejl, naeste }

// Dato ("YYYY-MM-DD") og time (0-23) i Danmark
function koebenhavnNu(nu = new Date()) {
    const dato = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nu);
    const time = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hour: '2-digit', hourCycle: 'h23' }).format(nu));
    return { dato, time };
}

// Skal den automatiske opdatering køre nu? Ren funktion.
// dage: turneringens datoer (fra TS' tidspunkter), tidligere: { fejl, naeste }.
// → { koer: true, turneringsdag } eller { koer: false, pause: 'nat'|'slut'|'fejl'|'venter', naeste? }
function autoPlan({ nu, dato, time, dage, tidligere }) {
    if (time >= AUTO_NAT_FRA || time < AUTO_NAT_TIL) return { koer: false, pause: 'nat' };
    if (dage.length && dato > dage[dage.length - 1]) return { koer: false, pause: 'slut' };
    if (tidligere && tidligere.naeste && nu < tidligere.naeste) {
        return { koer: false, pause: tidligere.fejl ? 'fejl' : 'venter', naeste: tidligere.naeste };
    }
    return { koer: true, turneringsdag: dage.length === 0 || dage.includes(dato) };
}

// Swiss-rækker (draw med runde "?") hvor vi stadig har ventende kampe
function travleSwissRaekker(rows) {
    const travle = new Set();
    for (const r of rows) {
        if (r.status !== 'pending' || !r.source_match_id) continue;
        if (rundeScopeOf(r.source_match_id).endsWith('#?')) travle.add(drawScopeOf(r.source_match_id));
    }
    return travle;
}

router.post('/:id/sync-import', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    const { id } = req.params;
    const key = tenantSyncKey(req.clubDbName, id);
    if (_syncingTournaments.has(key)) {
        return res.status(409).json({ error: 'Opdatering kører allerede for denne turnering — vent til den er færdig.' });
    }
    const vent = demo.erDemo(req) ? demoSyncVent(id) : 0;
    if (vent > 0) {
        return res.status(429).json({ error: `Demoen henter højst hvert ${demo.DEMO_SYNC_PAUSE_MS / 60000}. minut fra tournamentsoftware — prøv igen om ${vent} sekunder.` });
    }
    _syncingTournaments.add(key);
    try {
        const tournament = await queryOne(
            'SELECT id, source_tournament_id FROM tournaments WHERE id = ?', [id]
        );
        if (!tournament) return res.status(404).json({ error: 'Turnering ikke fundet' });
        if (!tournament.source_tournament_id) {
            return res.status(400).json({
                error: 'Denne turnering er ikke importeret fra Tournament Software og kan ikke opdateres automatisk. Genimportér for at aktivere opdatering.'
            });
        }

        const result = await syncTournamentCore(tournament, {
            skipClubs: req.query.skipClubs === 'true'
        });

        res.json(result);
    } catch (error) {
        if (error.name === 'TimeoutError' || error.name === 'AbortError') {
            return res.status(504).json({ error: 'Forbindelsen til tournamentsoftware.com timed out — prøv igen' });
        }
        console.error('Tournament sync-import failed:', error);
        res.status(502).json({ error: error.message || 'Opdatering fejlede' });
    } finally {
        _syncingTournaments.delete(key);
    }
});

// PUT /api/tournaments/:id/auto-sync - Slå serverbaseret auto-opdatering til/fra (kræver auth)
// Flaget gemmes i databasen, så schedulerens 2-minutters job kører uafhængigt
// af om admin-siden (eller browseren) er åben.
router.put('/:id/auto-sync', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id } = req.params;
        const enabled = !!(req.body && req.body.enabled === true);

        const tournament = await queryOne(
            `SELECT id, source_tournament_id FROM tournaments WHERE id = ? AND status = 'active'`,
            [id]
        );
        if (!tournament) return res.status(404).json({ error: 'Turnering ikke fundet' });
        if (enabled && !tournament.source_tournament_id) {
            return res.status(400).json({ error: 'Denne turnering er ikke importeret fra Tournament Software.' });
        }
        if (enabled && demo.erDemo(req)) {
            const andre = await queryOne(
                `SELECT COUNT(*) AS n FROM tournaments WHERE status = 'active' AND auto_sync = 1 AND id <> ?`, [id]);
            if (andre && Number(andre.n) >= demo.DEMO_AUTO_SYNC_MAKS) {
                return res.status(409).json({ error: `Demoen kan højst have ${demo.DEMO_AUTO_SYNC_MAKS} turneringer med automatisk opdatering. Slå den fra på en anden først.` });
            }
            _demoSidstSet.set(Number(id), Date.now());
        }

        await query('UPDATE tournaments SET auto_sync = ? WHERE id = ?', [enabled ? 1 : 0, id]);

        // Kør første opdatering med det samme (fire-and-forget) så brugeren ikke
        // skal vente op til 2 minutter på effekten. Tenant-konteksten følger med
        // promise-kæden (AsyncLocalStorage).
        if (enabled) {
            const key = tenantSyncKey(req.clubDbName, tournament.id);
            // Demoen: ikke en hentning pr. til/fra-klik (nr. 91) — scheduleren tager den
            if (!_syncingTournaments.has(key) && !(demo.erDemo(req) && demoSyncVent(tournament.id) > 0)) {
                _syncingTournaments.add(key);
                syncTournamentCore(tournament, { skipClubs: true })
                    .then(r => _autoSyncStatus.set(key, { at: Date.now(), updated: r.updated, added: r.added, newCandidates: r.newCandidates.length, error: null }))
                    .catch(e => _autoSyncStatus.set(key, { at: Date.now(), updated: 0, added: 0, newCandidates: 0, error: e.message || String(e) }))
                    .finally(() => _syncingTournaments.delete(key));
            }
        }

        res.json({ success: true, autoSync: enabled });
    } catch (error) {
        next(error);
    }
});

// PUT /api/tournaments/:id/matches/:matchId - Opdater kamp (bruges fra court-siden;
// i club-mode kræves device/club_admin-token ligesom game-states)
router.put('/:id/matches/:matchId', requireWriteAuthInClubMode, requirePage('tournament'), ikkeQrSession, async (req, res, next) => {
    try {
        const { id, matchId } = req.params;
        const {
            courtNumber, status, winnerTeam, setScores,
            label, doubles, matchOrder,
            side1Player1, side1Player2, side2Player1, side2Player2
        } = req.body;

        const match = await queryOne(
            `SELECT id, court_number, status, started_at,
                    side1_player1, side1_player2, side2_player1, side2_player2
               FROM tournament_matches WHERE id = ? AND tournament_id = ?`,
            [matchId, id]
        );
        if (!match) {
            return res.status(404).json({ error: 'Kamp ikke fundet' });
        }

        // En tablet må kun ændre den kamp, der står 'active' på dens egen bane.
        // En tablet, der stadig er bundet til en kamp, admin har byttet ud (eller
        // tastet W.O.), skrev ellers den nye kamps resultat på den gamle. Svaret er
        // 200 uden ændring — den uændrede tablet tager stille imod (nr. 105)
        if (turneringEnhed.erEnhed(req)) {
            const grund = await turneringEnhed.enhedMaaIkkeAendre(req, match, status);
            if (grund) {
                console.log(`Turneringskamp #${match.id}: enhedens ændring (${status || 'ingen status'}) ignoreret — ${grund}`);
                return res.json({ success: true, uaendret: true });
            }
        }

        const fields = [];
        const values = [];

        if (courtNumber !== undefined) {
            // Spilles der på mål-banen, afvises admins tildeling, til admin
            // bekræfter (force). Før stod den igangværende kamps stilling videre
            // under den nye kamps navne og blev meldt ind som dens resultat (nr. 78)
            if (courtNumber !== null && req.user?.role !== 'device'
                && Number(courtNumber) !== Number(match.court_number)) {
                const afvist = await baneTildeling.tjekOgRydBane(courtNumber, req);
                if (afvist) return res.status(409).json(afvist);
                // Står forrige kamps slutstilling stadig på banen, ryddes den, så
                // den nye kamp starter fra 0-0 — som holdkampens tildeling (nr. 104)
                const mangler = await baneTildeling.rydAfsluttetFoerTildeling(courtNumber, req, Number(matchId));
                if (mangler) return res.status(409).json(mangler);
            }
            // Frigør banen fra andre matches i samme turnering hvis den re-allokeres.
            // started_at nulstilles: en kamp, der sættes på en bane igen, starter
            // forfra — ellers genbrugte COALESCE nedenfor den gamle tid, og værnet
            // mod en ældre stilling (resultatMelding.startetFoerTildeling) slog ikke til
            if (courtNumber !== null) {
                await query(
                    `UPDATE tournament_matches
                     SET court_number = NULL, status = 'pending', started_at = NULL
                     WHERE tournament_id = ? AND court_number = ? AND id != ? AND status != 'finished'`,
                    [id, courtNumber, matchId]
                );
            }
            fields.push('court_number = ?');
            values.push(courtNumber);
        }
        if (status !== undefined) {
            fields.push('status = ?'); values.push(status);
            if (status === 'active') {
                // Starttid = tildelingen til banen (fallback). Ved afslutning
                // erstattes den af banens rigtige starttid (foerste serv).
                // En ny tildeling får altid en frisk tid — også en kamp, der står
                // 'pending' med en gammel started_at fra før nr. 104 blev rettet.
                // Kun når kampen allerede står 'active' på samme bane (admin gemmer
                // bane-dialogen igen), beholdes tiden. Ellers satte en gammel tid
                // værnet resultatMelding.startetFoerTildeling ud af spil.
                const sammeTildeling = match.status === 'active'
                    && (courtNumber === undefined || Number(courtNumber) === Number(match.court_number));
                fields.push(sammeTildeling
                    ? 'started_at = COALESCE(started_at, CURRENT_TIMESTAMP)'
                    : 'started_at = CURRENT_TIMESTAMP');
            }
            // Tilbage til afventer (tabletten eller admin frigiver kampen): næste
            // tildeling får en frisk starttid (nr. 104)
            if (status === 'pending') fields.push('started_at = NULL');
            // Naar en kamp markeres 'finished', stempler vi tidspunktet saa
            // admin-baneoversigtens "Seneste kamp" kan sortere paa tvaers af
            // match_history, tournament_matches og team_match_games — og saa
            // Kamphistorik kan vise varighed (finished_at - started_at).
            // En rettelse af en kamp, der allerede er færdig, flytter ikke dens
            // tider — ellers blev varighed og rækkefølge forkerte (nr. 106)
            if (status === 'finished' && match.status !== 'finished') {
                fields.push('finished_at = CURRENT_TIMESTAMP');
                const start = await banensStartTid(match.court_number, match.started_at);
                if (start) { fields.push('started_at = ?'); values.push(start); }
            }
        }
        if (winnerTeam !== undefined) { fields.push('winner_team = ?'); values.push(winnerTeam); }
        if (setScores !== undefined) { fields.push('set_scores = ?'); values.push(setScores); }
        if (label !== undefined) { fields.push('label = ?'); values.push(label || null); }
        if (doubles !== undefined) { fields.push('doubles = ?'); values.push(doubles ? 1 : 0); }
        if (matchOrder !== undefined) { fields.push('match_order = ?'); values.push(matchOrder); }
        if (side1Player1 !== undefined) { fields.push('side1_player1 = ?'); values.push(side1Player1 || null); }
        if (side1Player2 !== undefined) { fields.push('side1_player2 = ?'); values.push(side1Player2 || null); }
        if (side2Player1 !== undefined) { fields.push('side2_player1 = ?'); values.push(side2Player1 || null); }
        if (side2Player2 !== undefined) { fields.push('side2_player2 = ?'); values.push(side2Player2 || null); }

        if (fields.length === 0) {
            return res.status(400).json({ error: 'Ingen felter at opdatere' });
        }

        // Admins manuelle resultat fra Turnering-siden rydder banen (rydBane = banens
        // nummer) — men kun, hvis kampen stadig står 'active' på netop den bane nu.
        // Før ryddede admin selv banen bagefter ud fra sin egen kopi af listen, som
        // kunne være forældet: så blev den kamp, der spilles der nu, ryddet (nr. 106)
        const rydBane = req.body.rydBane;
        const rydNu = status === 'finished' && rydBane !== undefined && rydBane !== null
            && !turneringEnhed.erEnhed(req)
            && match.status === 'active' && match.court_number != null
            && Number(match.court_number) === Number(rydBane);

        values.push(matchId);
        await query(`UPDATE tournament_matches SET ${fields.join(', ')} WHERE id = ?`, values);

        if (rydNu) await rydBaneEfterResultat(match.court_number, req);

        // Poke SSE-lyttere for beroerte baner — baade den kampen kom fra
        // (frigivelse/flytning) og den den lander paa
        const affectedCourts = new Set();
        if (match.court_number) affectedCourts.add(match.court_number);
        if (courtNumber !== undefined && courtNumber !== null) affectedCourts.add(courtNumber);
        for (const c of affectedCourts) publishGameStateChange(req, c, 'assignment');

        // Officiel kamp tildelt en bane → ryd evt. guest QR-session, så TV'et
        // ikke viser en "overtag kampen"-QR under en turneringskamp
        if (courtNumber !== undefined && courtNumber !== null) {
            try { await invalidateCourtTokens(courtNumber); } catch (e) { console.error('QR-token oprydning fejlede:', e); }
            // Banen er nu en turneringsbane: en tidligere badmintonplanner-
            // tildeling må ikke få kampens resultat meldt ind som sit (nr. 78)
            await baneTildeling.fjernPlannerTildeling(courtNumber);
        }

        res.json({ success: true, ...(rydBane !== undefined && rydBane !== null ? { ryddet: rydNu } : {}) });
    } catch (error) {
        next(error);
    }
});

// PUT /api/tournaments/:id/finish - Marker turnering som afsluttet (kræver auth)
router.put('/:id/finish', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id } = req.params;

        // Baner med kampe i denne turnering skal have besked
        const assignedMatches = await query(
            `SELECT DISTINCT court_number FROM tournament_matches
             WHERE tournament_id = ? AND court_number IS NOT NULL`,
            [id]
        );

        await query(`UPDATE tournaments SET status = 'finished' WHERE id = ?`, [id]);

        for (const row of assignedMatches) publishGameStateChange(req, row.court_number, 'assignment');

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments - Slet alle AFSLUTTEDE turneringer (kræver auth)
// Bevarer aktive turneringer — det er en "ryd historik"-handling, ikke en nuke.
// CASCADE på tournament_matches.tournament_id fjerner deres kampe automatisk.
// NB: skal stå FØR /:id-routen ellers fanger den ikke den tomme path.
router.delete('/', authMiddleware, requirePage('history'), async (req, res, next) => {
    try {
        const result = await query(`DELETE FROM tournaments WHERE status = 'finished'`);
        res.json({ success: true, deleted: result.affectedRows || 0 });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments/:id/matches/:matchId - Slet enkelt kamp (kræver auth)
router.delete('/:id/matches/:matchId', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id, matchId } = req.params;
        await query(
            'DELETE FROM tournament_matches WHERE id = ? AND tournament_id = ?',
            [matchId, id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/tournaments/:id - Slet turnering (kræver auth, cascade fjerner matches)
router.delete('/:id', authMiddleware, requirePage('tournament'), async (req, res, next) => {
    try {
        const { id } = req.params;
        await query('DELETE FROM tournaments WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
// Eksportér auto-sync-kørslen til scheduleren (routeren er en funktion,
// så app.use(...) virker stadig — samme mønster som importTournament.js).
module.exports.runTournamentAutoSync = runTournamentAutoSync;
module.exports._demo = { sidstSet: _demoSidstSet, sidstHentet: _demoSidstHentet, demoSyncVent };
// Rene hjælpere til unit-tests (tests/unit/pakke-k.test.js)
module.exports.parSyncKampe = parSyncKampe;
module.exports.rundeScopeOf = rundeScopeOf;
module.exports.computeFillOnlyChanges = computeFillOnlyChanges;
module.exports.navneForenelige = navneForenelige;
module.exports.sideOmbyttet = sideOmbyttet;
module.exports.tsResultat = tsResultat;
module.exports.nyKampRaekke = nyKampRaekke;
module.exports.syncTournamentCore = syncTournamentCore;
module.exports._spillesteder = { rensSpillesteder, laesSpillesteder };
module.exports.autoPlan = autoPlan;
module.exports.koebenhavnNu = koebenhavnNu;
module.exports.travleSwissRaekker = travleSwissRaekker;
