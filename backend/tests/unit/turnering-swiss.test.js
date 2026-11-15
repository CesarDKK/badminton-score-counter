/**
 * Turnering fra Tournament Software med Swiss ladder (Lyngby, november 2026).
 *
 * - Kampe-siden: planlagt tidspunkt og TS' status (walkover/spillet/aflyst)
 * - Swiss-rækker: kampe uden dato hentes fra rækkens egen kampliste
 * - Opdateringen: ny runde tilføjes, walkover/spillet på TS afslutter den
 *   ventende kamp, aflyste kampe springes over, en walkover med en afmeldt
 *   spiller parres ikke med en anden kamp
 *
 * TS' sider efterlignes med en falsk fetch, og databasen med en optager.
 * Kør: npm run test:unit
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ---------- Falsk database ----------
const db = require('../../config/database');
let svar = async () => [];
let kald = [];
db.query = async (sql, params) => { kald.push({ sql, params }); return svar(sql, params); };
db.queryOne = async (sql, params) => { const r = await db.query(sql, params); return (Array.isArray(r) ? r[0] : r) || null; };
db.transaktion = async (fn) => fn({ query: db.query, queryOne: db.queryOne });
const nulstil = (fn = async () => []) => { svar = fn; kald = []; };

const imp = require('../../routes/importTournament');
const tournaments = require('../../routes/tournaments');

const TID = '4902eaeb-1b2c-491d-8c8b-0e187dec6745';

// ---------- TS' HTML ----------
let pid = 1;
const spiller = (navn) => navn.startsWith('~')
    // Afmeldt spiller: navnet står gennemstreget og kommer ikke med
    ? `<a href="/sport/player.aspx?id=${TID}&amp;player=${pid++}" data-player-id="${pid}" data-club-id="" data-nationality-id="" class="nav-link"><span class="nav-link__value"><s title="Frasorteret/Afmeldt">${navn.slice(1)} [WDN]</s></span>\n</a>`
    : `<a href="/sport/player.aspx?id=${TID}&amp;player=${pid++}" data-player-id="${pid}" data-club-id="" data-nationality-id="" class="nav-link"><span class="nav-link__value">${navn}</span>\n</a>`;

function kamp({ draw = 1, kat = 'U11 D HS', runde = '', s1, s2, vinder = 0, besked = '', saet = [] }) {
    const raekke = (navne, vandt) => `<div class="match__row ${vandt ? 'has-won' : ''}">
        <div class="match__row-title">${navne.map(n => `<div class="match__row-title-value"><span class="match__row-title-value-content">${spiller(n)}</span></div>`).join('')}</div>
        ${besked ? `<span class="tag--warning tag match__message">${besked}</span>` : ''}
    </div>`;
    return `<li class="match-group__item">
<div class="match match--list">
    <div class="match__header">
        <ul class="match__header-title">
            <li class="match__header-title-item"><a href="/sport/draw.aspx?id=${TID}&amp;draw=${draw}" class="nav-link"><span class="nav-link__value">${kat}</span></a></li>
            ${runde ? `<li class="match__header-title-item"><span title="${runde}" class="nav-link"><span class="nav-link__value">${runde}</span></span></li>` : ''}
        </ul>
    </div>
    <div class="match__body">
        <div class="match__row-wrapper">${raekke(s1, vinder === 1)}${raekke(s2, vinder === 2)}</div>
        <div class="match__result">${saet.map(([a, b]) => `<ul class="points"><li class="points__cell"> ${a}\n</li><li class="points__cell"> ${b}\n</li></ul>`).join('')}
        </div>
    </div>
    <div class="match__footer"></div>
</div>
</li>`;
}

const gruppe = (tid, kampe) => `<li class="match-group__item"><div class="match-group__wrapper">
<h5 class="sticky is-sticky match-group__header">
  ${tid}
</h5>
<ol class="match-group">${kampe.join('\n')}</ol></div></li>`;

const dagside = (grupper) => `<html><body><ol class="match-group">${grupper.join('\n')}</ol></body></html>`;

const hovedside = `<html><head><title>Lyngby | TS</title></head><body>
<h2 class="hgroup__heading">Lyngby</h2>
<a href="/tournament/${TID}/matches/20261121" data-value="20261121" class="js-tab" data-href="/tournament/${TID}/Matches/MatchesInDay?date=20261121"><time class="nav-link__value date"><span class="date__weekday">l&#248;</span><span class="date__day">21</span><b class="date__month">nov</b></time></a>
</body></html>`;

// Rækkens kampliste (drawmatches.aspx)
function rækkeside(draw, kampe) {
    const navn = (n, i) => `<tr><td><a href="player.aspx?id=${TID}&player=${100 + i}">${n}</a></td></tr>`;
    return `<html><body><table class="ruler matches"><caption>Kampoversigt</caption><thead><tr><td>Tid</td></tr></thead><tbody>
${kampe.map(k => `<tr><td></td><td class="plannedtime" align="right">${k.tid ? `lø 21-11-2026 <span class="time">${k.tid}</span>` : ''}</td>
<td align="right"><table align="Right">${k.s1.map(navn).join('')}</table></td><td align="center">-</td>
<td><table>${k.s2.map(navn).join('')}</table></td><td><span class="score">${k.score || ''}</span></td><td></td>
<td><a href="/match-info/${TID.toUpperCase()}/${draw}/${k.id}?returnurl=x" class="icon-information"></a></td></tr>`).join('\n')}
</tbody></table></body></html>`;
}

// ---------- Falsk fetch ----------
let sider = {};
let hentet = [];
global.fetch = async (url) => {
    const u = String(url);
    hentet.push(u);
    if (u.includes('/cookiewall')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'st=c=1; path=/' } });
    }
    for (const [noegle, html] of Object.entries(sider)) {
        if (u.endsWith(noegle) || u.includes(noegle + '&') || u.endsWith(noegle)) {
            return new Response(html, { status: 200 });
        }
    }
    return new Response('ukendt', { status: 404 });
};

// ---------- Kampe-siden ----------

test('Kampe-siden: tidspunkt fra gruppens overskrift, status og sæt fra TS', () => {
    const html = dagside([
        gruppe('09:00', [
            kamp({ s1: ['Anna'], s2: ['Berit'], vinder: 2, saet: [[8, 15], [10, 15]] }),
            kamp({ s1: ['Carl'], s2: ['~Dorte'], vinder: 1, besked: 'Walkover' }),
        ]),
        gruppe('9:30', [
            kamp({ s1: ['~Gry'], s2: ['~Hans'], besked: 'Aflyst' }),
            kamp({ s1: ['Eva'], s2: ['Finn'], runde: 'Runde 2', draw: 7, kat: 'U11 C DS' }),
        ]),
    ]);
    const k = imp.parseMatchesHtml(html);
    assert.equal(k.length, 4);
    assert.deepEqual(k.map(m => m.plannedTime), ['09:00', '09:00', '09:30', '09:30']);
    assert.deepEqual(k.map(m => m.tsStatus), ['spillet', 'walkover', 'aflyst', '']);
    assert.deepEqual(k.map(m => m.tsWinner), [2, 1, null, null]);
    assert.deepEqual(k[0].tsSets, [[8, 15], [10, 15]]);
    // Den afmeldte spiller kommer ikke med som navn
    assert.equal(k[1].side1Player1, 'Carl');
    assert.equal(k[1].side2Player1, '');
    assert.equal(k[3].round, 'Runde 2');
    assert.equal(k[0].round, '', 'Swiss-kampe har ingen runde på TS');
});

test('Rækkens kampliste: TS-kamp-nr, tidspunkt (også uden) og walkover', () => {
    const k = imp.parseDrawMatchesHtml(rækkeside(1, [
        { id: 22, tid: '09:00', s1: ['Anna [1]'], s2: ['Berit'] },
        { id: 31, s1: ['Anna [1]'], s2: ['Carl'] },
        { id: 32, tid: '10:00', s1: ['Eva', 'Fie'], s2: ['Gry', 'Ida'], score: 'w.o.' },
    ]));
    assert.deepEqual(k.map(m => m.tsId), ['22', '31', '32']);
    assert.deepEqual(k.map(m => m.plannedAt), ['2026-11-21 09:00', '', '2026-11-21 10:00']);
    assert.deepEqual(k[2].side2, ['Gry', 'Ida']);
    assert.deepEqual(k.map(m => m.walkover), [false, false, true]);
});

// ---------- Hele kæden: hent → opdatér ----------

// Lyngby efter 1. runde: A–B spillet på vores bane, C–D walkover på TS,
// E–F tastet på TS. 2. runde: A–C planlagt kl. 11, B–E endnu uden dato.
// G–H aflyst. Plus en udslagsrække (draw 7) som ikke er Swiss.
function tsEfterRunde1(ekstra = []) {
    sider = {
        [`/tournament/${TID}/Matches`]: hovedside,
        [`/tournament/${TID}/matches/20261121`]: dagside([
            gruppe('09:00', [
                kamp({ s1: ['Anna [1]'], s2: ['Berit'], vinder: 1, saet: [[15, 3], [15, 4]] }),
                kamp({ s1: ['Carl'], s2: ['~Dorte'], vinder: 1, besked: 'Walkover' }),
                kamp({ s1: ['Finn'], s2: ['Eva'], vinder: 1, saet: [[15, 12], [9, 15], [15, 13]] }),
                kamp({ s1: ['~Gry'], s2: ['~Hans'], besked: 'Aflyst' }),
                kamp({ draw: 7, kat: 'U11 C DS', runde: 'Finale', s1: ['Ole'], s2: ['Per'] }),
            ]),
            gruppe('11:00', [kamp({ s1: ['Anna [1]'], s2: ['Carl'] })]),
            ...ekstra,
        ]),
        'drawmatches.aspx?id=4902eaeb-1b2c-491d-8c8b-0e187dec6745&draw=1': rækkeside(1, [
            { id: 22, tid: '09:00', s1: ['Anna [1]'], s2: ['Berit'] },
            { id: 23, tid: '09:00', s1: ['Carl'], s2: ['Dorte'], score: 'w.o.' },
            { id: 24, tid: '09:00', s1: ['Finn'], s2: ['Eva'] },
            { id: 30, tid: '11:00', s1: ['Anna [1]'], s2: ['Carl'] },
            { id: 31, s1: ['Berit'], s2: ['Eva'] },        // ny runde, ingen dato endnu
            { id: 32, s1: ['Finn'], s2: [] },              // oversidder
        ]),
    };
}

test('Hent: Swiss-rækkens kampe uden dato kommer med, og kun Swiss-rækker hentes', async () => {
    tsEfterRunde1();
    hentet = [];
    const r = await imp.fetchAndParseTournamentMatches(TID);
    const ids = r.matches.map(m => m.sourceMatchId);
    assert.ok(ids.includes('1#?#u31'), 'B–E uden dato er med');
    assert.equal(ids.filter(i => i.includes('#u')).length, 1, 'kampe der står på Kampe-siden, tilføjes ikke igen');
    const be = r.matches.find(m => m.sourceMatchId === '1#?#u31');
    assert.equal(be.plannedAt, '');
    assert.equal(be.category, 'U11 D HS');
    assert.equal(r.matches.find(m => m.side1Player1 === 'Anna [1]' && m.side2Player1 === 'Carl').plannedAt, '2026-11-21 11:00');
    assert.ok(hentet.some(u => u.includes('draw=1')));
    assert.ok(!hentet.some(u => u.includes('draw=7')), 'udslagsrækken (med runder) hentes ikke');
});

test('Opdatér: ny runde tilføjes, walkover og TS-resultat afslutter, aflyst springes over', async () => {
    tsEfterRunde1();
    const raekke = (id, sid, s1, s2, status = 'pending', planned = '2026-11-21 09:00') => ({
        id, source_match_id: sid, status, planned_time: planned, doubles: 0,
        side1_player1: s1, side1_player2: null, side2_player1: s2, side2_player2: null
    });
    const eksisterende = [
        raekke(1, '1#?#0', 'Anna [1]', 'Berit', 'finished'),
        raekke(2, '1#?#1', 'Carl', 'Dorte'),
        raekke(3, '1#?#2', 'Eva', 'Finn'),          // TS viser siderne ombyttet
        raekke(4, '1#?#3', 'Gry', 'Hans'),
        raekke(5, '7#Finale#0', 'Ole', 'Per', 'pending', null),
    ];
    nulstil(async (sql) => {
        if (/FROM tournament_matches\s+WHERE tournament_id = \?\s+ORDER BY/.test(sql)) return eksisterende;
        if (/MAX\(match_order\)/.test(sql)) return [{ max_order: 5 }];
        return { affectedRows: 1, insertId: 99 };
    });
    const res = await tournaments.syncTournamentCore({ id: 3, source_tournament_id: TID }, { skipClubs: true });

    const opd = kald.filter(k => /^UPDATE tournament_matches/.test(k.sql.trim()));
    const ny = kald.filter(k => /^INSERT INTO tournament_matches/.test(k.sql.trim()));

    // C–D: walkover, Carl vandt
    const cd = opd.find(k => k.params[k.params.length - 1] === 2);
    assert.match(cd.sql, /status = \?/);
    assert.match(cd.sql, /finished_at = CURRENT_TIMESTAMP/);
    assert.ok(cd.params.includes('finished') && cd.params.includes('W.O.'));
    const cdKol = cd.sql.match(/SET (.*) WHERE/)[1].split(',').map(s => s.trim().split(' ')[0]);
    assert.equal(cd.params[cdKol.indexOf('winner_team')], 1);

    // E–F: tastet på TS med Finn på side 1 — vinderen og sættene vendes til rækken
    const ef = opd.find(k => k.params[k.params.length - 1] === 3);
    const efKol = ef.sql.match(/SET (.*) WHERE/)[1].split(',').map(s => s.trim().split(' ')[0]);
    assert.equal(ef.params[efKol.indexOf('winner_team')], 2, 'Finn (rækkens side 2) vandt');
    assert.equal(ef.params[efKol.indexOf('set_scores')], 'Eva 12-15 Finn, Eva 15-9 Finn, Eva 13-15 Finn');

    // Den færdige kamp og den aflyste røres ikke
    assert.ok(!opd.some(k => k.params[k.params.length - 1] === 1));
    assert.ok(!opd.some(k => k.params[k.params.length - 1] === 4));

    // Finalen (draw 7) får sit tidspunkt
    const fin = opd.find(k => k.params[k.params.length - 1] === 5);
    assert.deepEqual(fin.params.slice(0, -1), ['2026-11-21 09:00']);

    // 2. runde: A–C (kl. 11) og B–E (ingen dato) tilføjes automatisk
    assert.equal(res.added, 2);
    assert.equal(ny.length, 2);
    const ac = ny.find(k => k.params.includes('Carl'));
    assert.equal(ac.params[3], '2026-11-21 11:00');
    assert.equal(ac.params[10], 'pending');
    const be = ny.find(k => k.params.includes('1#?#u31'));
    assert.equal(be.params[3], null);
    assert.deepEqual(res.newCandidates, [], 'den aflyste kamp tilbydes ikke som ny kamp');
});

test('Opdatér igen, når B–E har fået en dato: samme række, intet nyt', async () => {
    // B–E står nu på Kampe-siden kl. 12 (rækkesiden har den stadig uden dato)
    tsEfterRunde1([gruppe('12:00', [kamp({ s1: ['Eva'], s2: ['Berit'] })])]);
    const eksisterende = [{
        id: 9, source_match_id: '1#?#u31', status: 'pending', planned_time: null, doubles: 0,
        side1_player1: 'Berit', side1_player2: null, side2_player1: 'Eva', side2_player2: null
    }];
    nulstil(async (sql) => {
        if (/FROM tournament_matches\s+WHERE tournament_id = \?\s+ORDER BY/.test(sql)) return eksisterende;
        if (/MAX\(match_order\)/.test(sql)) return [{ max_order: 9 }];
        return { affectedRows: 1 };
    });
    const res = await tournaments.syncTournamentCore({ id: 3, source_tournament_id: TID }, { skipClubs: true });
    const opd = kald.filter(k => /^UPDATE tournament_matches/.test(k.sql.trim()));
    const ber = opd.find(k => k.params[k.params.length - 1] === 9);
    assert.deepEqual(ber.params, ['2026-11-21 12:00', 9]);
    assert.ok(!kald.some(k => /^INSERT INTO tournament_matches/.test(k.sql.trim())
        && k.params.includes('Berit') && k.params.includes('Eva')), 'B–E tilføjes ikke en gang til');
    // Kun finalen i den ukendte række (draw 7) skal godkendes
    assert.deepEqual(res.newCandidates.map(c => c.sourceMatchId), ['7#Finale#0']);
});

test('En walkover med en afmeldt spiller parres ikke på id med en anden kamp', () => {
    const existing = [{
        id: 1, source_match_id: '1#?#3', status: 'pending',
        side1_player1: 'Anna', side1_player2: null, side2_player1: 'Berit', side2_player2: null
    }];
    const incoming = [{ sourceMatchId: '1#?#3', side1Player1: 'Carl', side1Player2: '', side2Player1: '', side2Player2: '' }];
    const [p] = tournaments.parSyncKampe(existing, incoming);
    assert.equal(p.row, null);
    assert.equal(p.sourceMatchId, '1#?#3~2');
});

test('Seed-mærker som [3/4] sammenlignes uden mærket', () => {
    const row = { side1_player1: 'Daksh Artham', side2_player1: 'Mathias' };
    const m = { side1Player1: 'Daksh Artham [3/4]', side2Player1: 'Mathias', tsStatus: 'walkover' };
    assert.ok(tournaments.navneForenelige(row, m));
    assert.ok(!tournaments.navneForenelige(row, { side1Player1: 'Ukendt', side2Player1: 'Mathias' }));
    assert.ok(!tournaments.navneForenelige(row, { side1Player1: '', side2Player1: '' }));
});

test('tsResultat: kun spillet/walkover, vinder og sæt vendes ved ombyttede sider', () => {
    assert.equal(tournaments.tsResultat({ tsStatus: '' }, 'A', 'B'), null);
    assert.equal(tournaments.tsResultat({ tsStatus: 'aflyst' }, 'A', 'B'), null);
    assert.deepEqual(tournaments.tsResultat({ tsStatus: 'walkover', tsWinner: 2 }, 'A', 'B'), { winner_team: 2, set_scores: 'W.O.' });
    assert.deepEqual(tournaments.tsResultat({ tsStatus: 'spillet', tsWinner: 1, tsSets: [[15, 9]] }, 'A / B', 'C / D', true),
        { winner_team: 2, set_scores: 'A / B 9-15 C / D' });
});

test('Ny kamp fra TS: tidspunkt gemmes, en walkover gemmes som færdig', () => {
    const r = tournaments.nyKampRaekke(3, 1, { label: 'U11 D HS', plannedAt: '2026-11-21 09:00', side1Player1: 'A', side2Player1: 'B' }, '1#?#0');
    assert.equal(r.params[3], '2026-11-21 09:00');
    assert.equal(r.params[10], 'pending');
    assert.match(r.sql, /NULL\)$/);
    const wo = tournaments.nyKampRaekke(3, 2, { plannedAt: 'noget andet', tsStatus: 'walkover', tsWinner: 1, side1Player1: 'A', side2Player1: 'B' }, null);
    assert.equal(wo.params[3], null);
    assert.deepEqual(wo.params.slice(10), ['finished', 1, 'W.O.']);
    assert.match(wo.sql, /CURRENT_TIMESTAMP\)$/);
});

test('Tabletten henter kun sin egen kamp', async () => {
    nulstil(async (sql, params) => (/m\.court_number = \?/.test(sql)
        ? [{ id: 4, tournament_id: 3, tournament_name: 'Lyngby', court_number: params[0], status: 'active', side1_player1: 'A' }]
        : []));
    const lag = tournaments.stack.find(l => l.route && l.route.path === '/court/:courtNumber');
    let ud;
    await lag.route.stack[0].handle({ params: { courtNumber: '5' } }, { json: (x) => { ud = x; }, status() { return this; } }, (e) => { throw e; });
    assert.deepEqual(ud, { tournament: { id: 3, name: 'Lyngby', matches: [{ id: 4, court_number: 5, status: 'active', side1_player1: 'A' }] } });
});
