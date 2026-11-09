// Eksempeldata til salgssidens skærmbilleder (spillet til 15, som altid)
const BASE = 'http://badminton-frontend/_wt/';

// Spillestand som JS-udtryk, der regnes ud i siden (tider relativt til nu)
function gs(o) {
    const d = {
        courtId: 1, isDoubles: false, gameMode: '15', isActive: true, matchCompleted: false,
        decidingGameSwitched: false, restBreakActive: false, restBreakSecondsLeft: 0, restBreakTitle: '',
        servingPlayer: null, servingTeam: null, planner: null, version: 7, matchEndTime: null,
        ...o.d,
    };
    const start = o.min != null ? `new Date(Date.now() - ${o.min * 1000}).toISOString()` : 'null';
    const slut = o.sluttetFor != null ? `new Date(Date.now() - ${o.sluttetFor * 1000}).toISOString()` : 'null';
    return `NU:Object.assign(${JSON.stringify(d)}, { timerSeconds: ${o.min || 0}, matchStartTime: ${start}${o.sluttetFor != null ? `, matchEndTime: ${slut}` : ''} })`;
}
const s = (a, b, c, d2) => ({ name: a, name2: b || '', score: c, games: d2 });
const hist = (p1, p1b, p2, p2b, ...scores) => scores.map(score => ({ player1Name: p1, player1Name2: p1b || null, player2Name: p2, player2Name2: p2b || null, score }));
const sek = (m, x) => m * 60 + x;

const mf = s('Mathilde', 'Freja'), lk = s('Line', 'Katrine');

const tvKamp = gs({ min: sek(28, 39), d: { courtId: 1, isDoubles: true, servingTeam: 1,
    player1: { ...mf, score: 11, games: 1 }, player2: { ...lk, score: 9, games: 0 },
    setScoresHistory: hist('Mathilde', 'Freja', 'Line', 'Katrine', '15-12') } });
const tvAfgjort = gs({ min: sek(41, 20), sluttetFor: 20, d: { courtId: 1, isDoubles: true, matchCompleted: true,
    player1: { ...mf, score: 0, games: 2 }, player2: { ...lk, score: 0, games: 1 },
    setScoresHistory: hist('Mathilde', 'Freja', 'Line', 'Katrine', '15-12', '13-15', '15-11') } });
const tvPause = gs({ min: sek(31, 5), d: { courtId: 3, isDoubles: true,
    restBreakActive: true, restBreakSecondsLeft: 87, restBreakTitle: 'Pause mellem sæt - 2 minutter',
    player1: { ...mf, score: 0, games: 1 }, player2: { ...lk, score: 0, games: 1 },
    setScoresHistory: hist('Mathilde', 'Freja', 'Line', 'Katrine', '12-15', '15-10') } });
const tvLedig = gs({ d: { courtId: 3, isActive: false,
    player1: s('Spiller 1', 'Makker 1', 0, 0), player2: s('Spiller 2', 'Makker 2', 0, 0), setScoresHistory: [] } });
const taeller = gs({ min: sek(20, 45), d: { courtId: 1, servingPlayer: 1,
    player1: s('Mathilde', '', 11, 1), player2: s('Freja', '', 9, 0),
    setScoresHistory: hist('Mathilde', '', 'Freja', '', '15-12') } });

// Oversigten: seks baner
const baner = [
    { min: sek(30, 2), d: { courtId: 1, isDoubles: true, servingTeam: 1, player1: { ...mf, score: 11, games: 1 }, player2: { ...lk, score: 9, games: 0 }, setScoresHistory: hist('Mathilde', 'Freja', 'Line', 'Katrine', '15-12') } },
    { min: sek(8, 12), d: { courtId: 2, servingPlayer: 2, player1: s('Oliver', '', 6, 0), player2: s('Noah', '', 8, 0), setScoresHistory: [] } },
    { min: sek(27, 40), d: { courtId: 3, isDoubles: true, restBreakActive: true, restBreakSecondsLeft: 43, restBreakTitle: 'Pause mellem sæt - 2 minutter', player1: s('Emma', 'Ida', 0, 1), player2: s('Sofie', 'Laura', 0, 1), setScoresHistory: hist('Emma', 'Ida', 'Sofie', 'Laura', '15-13', '11-15') } },
    { min: sek(24, 10), sluttetFor: 60, d: { courtId: 4, matchCompleted: true, player1: s('William', '', 0, 2), player2: s('Lucas', '', 0, 0), setScoresHistory: hist('William', '', 'Lucas', '', '15-10', '15-12') } },
    { min: sek(5, 50), d: { courtId: 5, servingPlayer: 1, player1: s('Victor', '', 8, 0), player2: s('Anders', '', 5, 0), setScoresHistory: [] } },
    { min: sek(3, 42), d: { courtId: 6, isDoubles: true, servingTeam: 2, player1: s('Peter', 'Lars', 4, 0), player2: s('Jens', 'Ulf', 3, 0), setScoresHistory: [] } },
];
const alleBaner = 'NU:[' + baner.map(b => gs(b).slice(3)).join(',') + ']';

// Holdkamp: Lyngby BK – Gentofte, 13-kamps format, 6–3 med fire delkampe i gang
const g = (n, category, t1a, t1b, t2a, t2b, court, status, winner, sets) => ({
    id: 900 + n, game_number: n, category, team1_player1: t1a, team1_player2: t1b, team2_player1: t2a, team2_player2: t2b,
    court_number: court, status, winner_team: winner, set_scores: sets, finished_at: status === 'finished' ? '2026-11-08T10:00:00.000Z' : null });
const hkSpil = [
    g(1, 'HS', 'Oskar', null, 'Emil', null, 1, 'finished', 1, '15-10, 15-8'),
    g(2, 'HS', 'Rasmus', null, 'Mads', null, 2, 'active', null, '15-12'),
    g(3, 'HS', 'Jonas', null, 'Malthe', null, 3, 'finished', 1, '13-15, 15-12, 15-13'),
    g(4, 'HS', 'Magnus', null, 'Noah', null, 4, 'finished', 2, '12-15, 11-15'),
    g(5, 'DS', 'Ella', null, 'Alma', null, 5, 'finished', 1, '15-6, 15-9'),
    g(6, 'DS', 'Freja', null, 'Katrine', null, 6, 'active', null, ''),
    g(7, 'HD', 'Oskar', 'Jonas', 'Emil', 'Malthe', 7, 'finished', 1, '15-13, 15-11'),
    g(8, 'HD', 'Magnus', 'Rasmus', 'Noah', 'Mads', 8, 'finished', 2, '16-14, 12-15, 13-15'),
    g(9, 'HD', 'Peter', 'Lars', 'Jens', 'Ulf', 9, 'active', null, '15-11'),
    g(10, 'DD', 'Ella', 'Freja', 'Alma', 'Katrine', 10, 'finished', 1, '15-9, 15-12'),
    g(11, 'DD', 'Ida', 'Sara', 'Mia', 'Liv', 11, 'active', null, '11-15, 15-13'),
    g(12, 'MD', 'Oskar', 'Ella', 'Emil', 'Alma', 12, 'finished', 1, '15-12, 15-13'),
    g(13, 'MD', 'Jonas', 'Sara', 'Malthe', 'Mia', 13, 'finished', 2, '10-15, 12-15'),
];
const holdkamp = [{ id: 77, format: '13kamps', team1_name: 'Lyngby BK', team2_name: 'Gentofte', team1_logo_id: null, team2_logo_id: null, status: 'active', created_at: '2026-11-08T09:00:00.000Z', games: hkSpil }];
const hkBaner = 'NU:[' + [
    { min: sek(22, 0), d: { courtId: 2, servingPlayer: 1, player1: s('Rasmus', '', 11, 1), player2: s('Mads', '', 9, 0), setScoresHistory: hist('Rasmus', '', 'Mads', '', '15-12') } },
    { min: sek(9, 0), d: { courtId: 6, servingPlayer: 1, player1: s('Freja', '', 6, 0), player2: s('Katrine', '', 8, 0), setScoresHistory: [] } },
    { min: sek(19, 0), d: { courtId: 9, isDoubles: true, servingTeam: 1, player1: s('Peter', 'Lars', 5, 1), player2: s('Jens', 'Ulf', 3, 0), setScoresHistory: hist('Peter', 'Lars', 'Jens', 'Ulf', '15-11') } },
    { min: sek(38, 0), d: { courtId: 11, isDoubles: true, servingTeam: 1, player1: s('Ida', 'Sara', 13, 1), player2: s('Mia', 'Liv', 14, 1), setScoresHistory: hist('Ida', 'Sara', 'Mia', 'Liv', '11-15', '15-13') } },
].map(b => gs(b).slice(3)).join(',') + ']';

const fælles = [['/sponsor', []], ['/player-logos', []], ['/logos', []], ['/player-clubs', []], ['/team-matches/court/', null]];
const tema = `window.applyTheme && window.applyTheme({ color_primary: '#4a5c6a', color_accent: '#e94560', color_bg_dark: '#11212d', color_bg_container: '#253745', color_bg_card: '#06141b' });`;

export default {
    'tv-kamp':    { url: BASE + 'tv-v3.html?court=1', w: 1600, h: 900, stub: [['/game-states/1', tvKamp], ...fælles], setup: tema },
    'tv-afgjort': { url: BASE + 'tv-v3.html?court=1', w: 1600, h: 900, stub: [['/game-states/1', tvAfgjort], ...fælles], setup: tema },
    'tv-pausen':  { url: BASE + 'tv-v3.html?court=3', w: 1600, h: 900, stub: [['/game-states/3', tvPause], ...fælles], setup: tema },
    'tv-ledig':   { url: BASE + 'tv-v3.html?court=3', w: 1600, h: 900, stub: [['/game-states/3', tvLedig], ...fælles], setup: tema, wait: 5000, efter: "for (let i = 1; i < 100000; i++) { clearInterval(i); clearTimeout(i); cancelAnimationFrame(i); } const t = document.querySelector('.screensaver-text'); const r = t.getBoundingClientRect(); t.style.left = Math.round(parseFloat(t.style.left || 0) + innerWidth / 2 - (r.left + r.width / 2)) + 'px'; t.style.top = Math.round(parseFloat(t.style.top || 0) + innerHeight / 2 - (r.top + r.height / 2)) + 'px';" },
    'taeller':    { url: BASE + 'court-v3.html?court=1', w: 960, h: 525, stub: [['/taeller', { ejer: true }], ['/game-states/1', taeller], ...fælles], setup: tema },
    'oversigt-baner':    { url: BASE + 'oversigt.html', w: 1600, h: 900, stub: [['/game-states/batch/all', alleBaner], ['/team-matches/active-all', []], ...fælles], setup: tema },
    'oversigt-holdkamp': { url: BASE + 'oversigt.html', w: 1600, h: 900, stub: [['/game-states/batch/all', hkBaner], ['/team-matches/active-all', holdkamp], ...fælles], setup: tema },
};
export const ekstra = {
    'marketing':        { url: BASE + 'mk/index.html', w: 1440, h: 900, fuld: true, skala: 0.5, setup: 'document.querySelectorAll("img[loading=lazy]").forEach(i => i.loading = "eager"); document.querySelectorAll(".reveal, [data-reveal]").forEach(e => e.classList.add("visible", "in", "shown")); window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 800)); window.scrollTo(0, 0);', wait: 2500 },
    'marketing-mobil':  { url: BASE + 'mk/index.html', w: 390, h: 844, fuld: true, skala: 1, setup: 'document.querySelectorAll("img[loading=lazy]").forEach(i => i.loading = "eager"); window.scrollTo(0, document.body.scrollHeight); await new Promise(r => setTimeout(r, 800)); window.scrollTo(0, 0);', wait: 2500 },
};
