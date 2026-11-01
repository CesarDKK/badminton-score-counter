// Pointreglerne for en kamp — uden database, net og skærm (unit-testet).
//
// En nøjagtig gengivelse af tablettens regler i frontend/court-script-v3.js
// (addPoint, updateServingPlayer, checkRestBreak, checkGameWin/handleSetWin,
// mellemSaet, switchSides, swapPlayers, selectServer, undoLastAction), så en
// enhed, der ikke selv kan reglerne (uret), kan tælle via serveren og ende i
// præcis samme tilstand som tabletten. Tabletten bruger IKKE dette modul endnu.
// tests/unit/taeller-regler.test.js afspiller kampe, der er spillet på den
// rigtige tablet-side (scripts/taeller-sammenlign), og kræver samme tilstand
// efter hvert tryk — ændres tablettens regler, skal de køres igen.
//
// Tilstanden har tablettens feltnavne (player1/player2, servingTeam, ...), så
// den kan gemmes i game_states og vises af TV, Oversigt og tablet uden
// ændringer. Funktionerne ændrer tilstanden på stedet og returnerer, hvad der
// skete ({ ok, haendelser }), så kalderen kan vise "Sæt vundet" og lignende.

const HISTORIK_MAKS = 20;

// Point i et sæt og loftet: 21/30 eller 15/21
const saetGraense = (st) => (st.gameMode === '21' ? { vind: 21, maks: 30 } : { vind: 15, maks: 21 });
// Pause og sideskift i afgørende sæt ved 11 (21/30) eller 8 (15/21)
const midtpunkt = (st) => (st.gameMode === '21' ? 11 : 8);
// Sæt der skal vindes: 2 — 1 i golden set (holdkamp, § 7 stk. 1 e)
const saetForSejr = (st) => st.setsToWin || 2;

const PAUSE_11 = { sek: 60, titel: 'Pause 1 minut' };
const PAUSE_SAET = { sek: 120, titel: 'Pause mellem Sæt - 2 Minutter' };

function nyKamp({ navne = {}, isDoubles = false, gameMode = '21', setsToWin = 2 } = {}) {
    return {
        player1: { name: navne.p1 || 'Spiller 1', name2: navne.p1b || 'Makker 1', score: 0, games: 0 },
        player2: { name: navne.p2 || 'Spiller 2', name2: navne.p2b || 'Makker 2', score: 0, games: 0 },
        isDoubles: !!isDoubles,
        gameMode: gameMode === '15' ? '15' : '21',
        setsToWin: setsToWin === 1 ? 1 : 2,
        isActive: false,
        matchStartTime: null,
        matchEndTime: null,
        matchCompleted: false,
        decidingGameSwitched: false,
        sidesManuallySwitched: false,
        setScoresHistory: [],
        restBreakTaken: false,
        restBreakActive: false,
        restBreakSecondsLeft: 0,
        restBreakTitle: '',
        restBreakDuration: 60,
        restBreakStartedAt: null,
        servingPlayer: null,
        initialServer: null,
        servingTeam: null,
        servingPlayerOnTeam: null,
        team1RightCourt: 1,
        team2RightCourt: 1,
        betweenSets: false,
        timerSeconds: 0,
        history: []
    };
}

const vend = (n) => (n === 1 ? 2 : 1);

function erSaetAfgjort(st) {
    const { vind, maks } = saetGraense(st);
    const a = st.player1.score, b = st.player2.score;
    return (a >= vind && a - b >= 2) || a === maks || (b >= vind && b - a >= 2) || b === maks;
}

function gemHistorik(st) {
    st.history.push({
        player1: { ...st.player1 },
        player2: { ...st.player2 },
        sidesManuallySwitched: st.sidesManuallySwitched,
        restBreakTaken: st.restBreakTaken,
        servingPlayer: st.servingPlayer,
        servingTeam: st.servingTeam,
        servingPlayerOnTeam: st.servingPlayerOnTeam,
        team1RightCourt: st.team1RightCourt,
        team2RightCourt: st.team2RightCourt,
        betweenSets: st.betweenSets,
        decidingGameSwitched: st.decidingGameSwitched,
        timerSeconds: st.timerSeconds,
        isActive: st.isActive,
        matchCompleted: st.matchCompleted,
        matchEndTime: st.matchEndTime,
        setScoresHistory: st.setScoresHistory.map(s => (s && typeof s === 'object' ? { ...s } : s))
    });
    if (st.history.length > HISTORIK_MAKS) st.history.shift();
}

function startPause(st, { sek, titel }, nu) {
    st.restBreakActive = true;
    st.restBreakStartedAt = nu;
    st.restBreakDuration = sek;
    st.restBreakSecondsLeft = sek;
    st.restBreakTitle = titel;
    if (sek === 60) st.restBreakTaken = true;   // kun pausen ved 11
}

// Begge hold skifter banehalvdel: navne, point, sæt, serv og (double) pladser
function skiftSider(st) {
    [st.player1, st.player2] = [
        { ...st.player1, name: st.player2.name, name2: st.player2.name2, score: st.player2.score, games: st.player2.games },
        { ...st.player2, name: st.player1.name, name2: st.player1.name2, score: st.player1.score, games: st.player1.games }
    ];
    if (st.servingPlayer === 1 || st.servingPlayer === 2) st.servingPlayer = vend(st.servingPlayer);
    if (st.servingTeam === 1 || st.servingTeam === 2) st.servingTeam = vend(st.servingTeam);
    if (st.isDoubles) {
        const t1 = st.team1RightCourt;
        st.team1RightCourt = vend(st.team2RightCourt);
        st.team2RightCourt = vend(t1);
    }
    st.sidesManuallySwitched = true;
}

// Double: serveren står i højre side ved lige point, venstre ved ulige
function retDoubleServeposition(st) {
    if (!st.isDoubles || !st.servingTeam || !st.servingPlayerOnTeam) return;
    const point = st.servingTeam === 1 ? st.player1.score : st.player2.score;
    const server = st.servingPlayerOnTeam;
    const hoejre = point % 2 === 0 ? server : vend(server);
    if (st.servingTeam === 1) st.team1RightCourt = hoejre; else st.team2RightCourt = hoejre;
}

function opdaterServ(st, vinder) {
    if (!st.isDoubles) {
        if (vinder !== st.servingPlayer) st.servingPlayer = vinder;
        return;
    }
    if (vinder === st.servingTeam) {
        // Det serverende hold vandt: samme spiller server, men bytter side
        if (st.servingTeam === 1) st.team1RightCourt = vend(st.team1RightCourt);
        else st.team2RightCourt = vend(st.team2RightCourt);
    } else {
        st.servingTeam = vinder;
    }
    const point = vinder === 1 ? st.player1.score : st.player2.score;
    const hoejre = vinder === 1 ? st.team1RightCourt : st.team2RightCourt;
    st.servingPlayerOnTeam = point % 2 === 0 ? hoejre : vend(hoejre);
    st.servingPlayer = st.servingTeam;
}

// Sætpausen er slut: nyt sæt, siderne byttes (tablettens mellemSaet)
function nytSaet(st) {
    st.player1.score = 0;
    st.player2.score = 0;
    st.restBreakTaken = false;
    // Vinderen af sættet server — samme spiller fortsætter i double
    if (st.player1.games > st.player2.games) {
        st.servingPlayer = 1;
        if (st.isDoubles) { st.servingTeam = 1; st.betweenSets = true; }
    } else if (st.player2.games > st.player1.games) {
        st.servingPlayer = 2;
        if (st.isDoubles) { st.servingTeam = 2; st.betweenSets = true; }
    } else if (st.isDoubles) {
        st.betweenSets = true;   // 1-1: samme server
    }
    st.decidingGameSwitched = false;
    skiftSider(st);
    // Double: serveren starter i højre side
    if (st.isDoubles && st.betweenSets && st.servingTeam && st.servingPlayerOnTeam) {
        if (st.servingTeam === 1) st.team1RightCourt = st.servingPlayerOnTeam;
        else st.team2RightCourt = st.servingPlayerOnTeam;
    }
}

function vaelgServer(st, side) {
    if (st.matchStartTime || (side !== 1 && side !== 2)) return { ok: false, haendelser: [] };
    st.servingTeam = side;
    st.servingPlayer = side;
    st.initialServer = side;
    if (st.isDoubles) st.servingPlayerOnTeam = side === 1 ? st.team1RightCourt : st.team2RightCourt;
    st.isActive = true;
    return { ok: true, haendelser: [] };
}

function startKamp(st, nu = Date.now()) {
    if (!st.servingPlayer || st.matchStartTime) return { ok: false, haendelser: [] };
    st.matchStartTime = nu;
    st.isActive = true;
    return { ok: true, haendelser: ['start'] };
}

// Point til side 1 eller 2 (player1/player2, som de står nu)
function point(st, side, nu = Date.now()) {
    const nej = { ok: false, haendelser: [] };
    if (st.matchCompleted || (side !== 1 && side !== 2)) return nej;
    if (st.restBreakActive && erSaetAfgjort(st)) return nej;   // sætpausen: sættet er vundet
    if (!st.servingPlayer) return nej;

    const haendelser = [];
    gemHistorik(st);

    if (st.betweenSets && st.isDoubles) {
        st.betweenSets = false;
        if (st.servingPlayerOnTeam === null) {
            st.servingPlayerOnTeam = st.servingTeam === 1 ? st.team1RightCourt : st.team2RightCourt;
        }
    }

    const foerste = st.player1.score === 0 && st.player2.score === 0 &&
        st.player1.games === 0 && st.player2.games === 0 && !st.matchStartTime;

    if (side === 1) st.player1.score++; else st.player2.score++;
    opdaterServ(st, side);

    if (foerste) {
        st.matchStartTime = nu;
        st.isActive = true;
        haendelser.push('start');
    }

    // Pausen ved 11 (8) — én gang pr. sæt
    if (!st.restBreakTaken && !st.restBreakActive &&
        (st.player1.score === midtpunkt(st) || st.player2.score === midtpunkt(st))) {
        startPause(st, PAUSE_11, nu);
        haendelser.push('pause');
    }

    // Sideskift ved 11 (8) i det afgørende sæt
    const afgoerende = saetForSejr(st) - 1;
    if (st.player1.games === afgoerende && st.player2.games === afgoerende &&
        (st.player1.score === midtpunkt(st) || st.player2.score === midtpunkt(st)) && !st.decidingGameSwitched) {
        st.decidingGameSwitched = true;
        skiftSider(st);
        retDoubleServeposition(st);
        haendelser.push('sideskift');
    }

    const { vind, maks } = saetGraense(st);
    const a = st.player1.score, b = st.player2.score;
    const vinder = (a >= vind && a - b >= 2) || a === maks ? 1
        : (b >= vind && b - a >= 2) || b === maks ? 2 : 0;
    if (vinder) {
        st.setScoresHistory.push({
            player1Name: st.player1.name,
            player1Name2: st.player1.name2 || null,
            player2Name: st.player2.name,
            player2Name2: st.player2.name2 || null,
            score: `${a}-${b}`
        });
        const v = vinder === 1 ? st.player1 : st.player2;
        v.games++;
        if (v.games >= saetForSejr(st)) {
            st.matchEndTime = nu;
            st.matchCompleted = true;
            haendelser.push('kamp');
        } else {
            startPause(st, PAUSE_SAET, nu);
            haendelser.push('saet');
        }
    }
    return { ok: true, haendelser };
}

// Pausen slutter (tiden er gået, eller den springes over). Var det sætpausen,
// begynder næste sæt
function afslutPause(st) {
    if (!st.restBreakActive) return { ok: false, haendelser: [] };
    const saetVundet = erSaetAfgjort(st);
    st.restBreakActive = false;
    st.restBreakSecondsLeft = 0;
    st.restBreakTitle = '';
    if (saetVundet) {
        nytSaet(st);
        return { ok: true, haendelser: ['nyt-saet'] };
    }
    return { ok: true, haendelser: [] };
}

// Double, før kampen eller mellem sæt: holdets to spillere bytter plads
function bytPladser(st, hold) {
    if (!st.isDoubles || (st.matchStartTime && !st.betweenSets) || (hold !== 1 && hold !== 2)) {
        return { ok: false, haendelser: [] };
    }
    if (hold === 1) st.team1RightCourt = vend(st.team1RightCourt);
    else st.team2RightCourt = vend(st.team2RightCourt);
    if (st.servingTeam) st.servingPlayerOnTeam = st.servingTeam === 1 ? st.team1RightCourt : st.team2RightCourt;
    return { ok: true, haendelser: [] };
}

function fortryd(st) {
    const serverValgt = st.isDoubles ? st.servingTeam : st.servingPlayer;
    const ingenPoint = !st.player1.score && !st.player2.score && !st.player1.games && !st.player2.games;
    if (serverValgt && ingenPoint) {
        // Kun serveren er valgt: valget fortrydes
        st.servingPlayer = null;
        st.initialServer = null;
        st.servingTeam = null;
        st.servingPlayerOnTeam = null;
        st.isActive = false;
        st.matchStartTime = null;
        st.timerSeconds = 0;
        return { ok: true, haendelser: ['server-fortrudt'] };
    }
    const f = st.history.pop();
    if (!f) return { ok: false, haendelser: [] };
    // En kørende pause annulleres — uden at næste sæt begynder
    if (st.restBreakActive) {
        st.restBreakActive = false;
        st.restBreakSecondsLeft = 0;
        st.restBreakTitle = '';
    }
    st.player1 = { ...st.player1, ...f.player1 };
    st.player2 = { ...st.player2, ...f.player2 };
    st.sidesManuallySwitched = f.sidesManuallySwitched || false;
    st.restBreakTaken = f.restBreakTaken || false;
    st.servingPlayer = f.servingPlayer;
    st.servingTeam = f.servingTeam;
    st.servingPlayerOnTeam = f.servingPlayerOnTeam;
    st.team1RightCourt = f.team1RightCourt;
    st.team2RightCourt = f.team2RightCourt;
    st.betweenSets = f.betweenSets;
    st.decidingGameSwitched = f.decidingGameSwitched;
    st.timerSeconds = f.timerSeconds;
    st.isActive = f.isActive;
    st.matchCompleted = f.matchCompleted || false;
    st.matchEndTime = f.matchEndTime || null;
    if (Array.isArray(f.setScoresHistory)) st.setScoresHistory = f.setScoresHistory;
    return { ok: true, haendelser: ['fortrudt'] };
}

// Tilstanden kort, til sammenligning med tabletten og til logs:
// "point|sæt|serv|pladser|mellem sæt, sideskift|pause|slut|navne|sæthistorik"
function signatur(st) {
    const b = (v) => (v ? 1 : 0);
    return [
        `${st.player1.score}-${st.player2.score}`,
        `${st.player1.games}-${st.player2.games}`,
        `s${st.servingPlayer || 0}t${st.servingTeam || 0}p${st.servingPlayerOnTeam || 0}`,
        `r${st.team1RightCourt}${st.team2RightCourt}`,
        `b${b(st.betweenSets)}d${b(st.decidingGameSwitched)}`,
        `P${b(st.restBreakActive)}${st.restBreakActive ? st.restBreakDuration : ''}T${b(st.restBreakTaken)}`,
        `c${b(st.matchCompleted)}a${b(st.isActive)}`,
        `${st.player1.name}/${st.player1.name2};${st.player2.name}/${st.player2.name2}`,
        st.setScoresHistory.map(s => `${s.player1Name}${s.player1Name2 ? '&' + s.player1Name2 : ''} ${s.score} ${s.player2Name}${s.player2Name2 ? '&' + s.player2Name2 : ''}`).join(',')
    ].join('|');
}

module.exports = {
    HISTORIK_MAKS, PAUSE_11, PAUSE_SAET,
    nyKamp, erSaetAfgjort, vaelgServer, startKamp, point, afslutPause, bytPladser, fortryd, signatur
};
