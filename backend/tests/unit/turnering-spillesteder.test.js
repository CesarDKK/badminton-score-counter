/**
 * Turnering fra Tournament Software, der spilles flere steder på én gang
 * (fx Valbyhallen, KMB 2010, Gladsaxe Søborg — november 2026). Klubben
 * importerer kun sit eget spillested, og opdateringen må ikke hente de andre
 * steders kampe ind igen.
 *
 * - Kampe-siden: spillestederne fra vælgeren, og hver kamps sted fra
 *   info-knappens title (også "Varighed: 19m | Sted - 06")
 * - Kilde-id'erne er de samme, uanset hvilke steder der vælges
 * - Opdateringen: kun de valgte steders kampe
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

const TID = '0faacf73-ad8f-40ef-8ea6-f4e5e6c50a74';

// ---------- TS' HTML ----------
let pid = 1;
const spiller = (navn) => `<a href="/sport/player.aspx?id=${TID}&amp;player=${pid}" data-player-id="${pid++}" data-club-id="13" data-nationality-id="" class="nav-link"><span class="nav-link__value">${navn}</span>\n</a>`;

function kamp({ draw, kat, runde = 'Runde 1', sted, s1, s2 }) {
    const raekke = (navne) => `<div class="match__row ">
        <div class="match__row-title">${navne.map(n => `<div class="match__row-title-value"><span class="match__row-title-value-content">${spiller(n)}</span></div>`).join('')}</div>
    </div>`;
    return `<li class="match-group__item">
<div class="match match--list">
    <div class="match__header">
        <ul class="match__header-title">
            <li class="match__header-title-item"><a href="/sport/draw.aspx?id=${TID}&amp;draw=${draw}" class="nav-link"><span class="nav-link__value">${kat}</span></a></li>
            <li class="match__header-title-item"><span title="${runde}" class="nav-link"><span class="nav-link__value">${runde}</span></span></li>
        </ul>
        <div class="match__header-aside">
            <span class="nav-link btn--primary btn match__header-aside-block has-tooltip--wide" title="${sted}" data-toggle="tooltip" data-placement="left">
            <svg class="icon-info nav-link__prefix"></svg><span class="nav-link__value"></span></span>
        </div>
    </div>
    <div class="match__body">
        <div class="match__row-wrapper">${raekke(s1)}${raekke(s2)}</div>
    </div>
    <div class="match__footer"></div>
</div>
</li>`;
}

const vaelger = `<select autocomplete="off" name="AsyncTabsWithContent.Content.PageActions.FilterActions[0]" onchange="filterLocation($(this).val(), &#39;20261128&#39;);" class="js-location-selection-select form-select-control js-selectplaceholder has-value" id="x" data-placeholder="Spillested">
    <option value="" disabled>Spillested</option>
    <option value="0" selected>Alle spillesteder</option>
    <option value="1">Valbyhallen</option>
    <option value="2">K&#248;benhavns Badminton Klub</option>
    <option value="5">Gladsaxe S&#248;borg Badmintonklub</option>
    <option value="7">Gladsaxe S&#248;borg U9</option>
</select>`;

const dagside = (kampe) => `<html><body>${vaelger}<ol class="match-group"><li class="match-group__item"><div class="match-group__wrapper">
<h5 class="sticky match-group__header">09:00</h5><ol class="match-group">${kampe.join('\n')}</ol></div></li></ol></body></html>`;

const hovedside = `<html><head><title>Kreds | TS</title></head><body>
<h2 class="hgroup__heading">Kredsturnering</h2>${vaelger}
<a href="/tournament/${TID}/matches/20261128" data-value="20261128" class="js-tab" data-href="/tournament/${TID}/Matches/MatchesInDay?date=20261128"><time class="nav-link__value date"><span class="date__weekday">l&#248;</span><span class="date__day">28</span><b class="date__month">nov</b></time></a>
</body></html>`;

// To puljer i samme række (draw 10) — én i Valbyhallen, én hos KBK —
// og en U9-pulje i Gladsaxe (navnet ligner "Gladsaxe Søborg Badmintonklub")
const kampe = [
    kamp({ draw: 10, kat: 'U11 C HS', sted: 'Valbyhallen', s1: ['Anna'], s2: ['Berit'] }),
    kamp({ draw: 10, kat: 'U11 C HS', sted: 'Varighed: 19m | Københavns Badminton Klub - 06', s1: ['Carl'], s2: ['Dorte'] }),
    kamp({ draw: 10, kat: 'U11 C HS', sted: 'Valbyhallen', s1: ['Eva'], s2: ['Finn'] }),
    kamp({ draw: 20, kat: 'U9 HS', sted: 'Gladsaxe Søborg U9', s1: ['Gry'], s2: ['Hans'] }),
    kamp({ draw: 30, kat: 'U13 DS', sted: 'Gladsaxe S&#248;borg Badmintonklub', s1: ['Ida'], s2: ['Jens'] }),
];

// ---------- Falsk fetch ----------
let sider = {};
global.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/cookiewall')) {
        return new Response('', { status: 200, headers: { 'set-cookie': 'st=c=1; path=/' } });
    }
    for (const [noegle, html] of Object.entries(sider)) {
        if (u.endsWith(noegle)) return new Response(html, { status: 200 });
    }
    return new Response('ukendt', { status: 404 });
};
sider = { '/Matches': hovedside, '/matches/20261128': dagside(kampe) };

test('Spillestederne fra vælgeren: uden "Alle" og pladsholderen, æøå afkodet', () => {
    assert.deepEqual(imp.parseTournamentLocations(hovedside), [
        { id: 1, name: 'Valbyhallen' },
        { id: 2, name: 'Københavns Badminton Klub' },
        { id: 5, name: 'Gladsaxe Søborg Badmintonklub' },
        { id: 7, name: 'Gladsaxe Søborg U9' },
    ]);
    assert.deepEqual(imp.parseTournamentLocations('<html>ingen vælger</html>'), []);
});

test('Kampens sted: også med varighed og bane, det længste navn vinder', () => {
    const steder = [{ name: 'Gladsaxe Søborg' }, { name: 'Gladsaxe Søborg U9' }, { name: 'Engelsborghallen' }];
    assert.equal(imp.kampensSpillested('Varighed: 19m | Engelsborghallen - 06', steder), 'Engelsborghallen');
    assert.equal(imp.kampensSpillested('Gladsaxe Søborg U9 - 03', steder), 'Gladsaxe Søborg U9');
    assert.equal(imp.kampensSpillested('Gladsaxe Søborg', steder), 'Gladsaxe Søborg');
    assert.equal(imp.kampensSpillested('Et andet sted', steder), '');
    assert.equal(imp.kampensSpillested('', steder), '');
});

test('Hent: hver kamp får sit sted, og kilde-id\'erne regnes over alle steder', async () => {
    const r = await imp.fetchAndParseTournamentMatches(TID);
    assert.equal(r.locations.length, 4);
    assert.deepEqual(r.matches.map(m => [m.side1Player1, m.location, m.sourceMatchId]), [
        ['Anna', 'Valbyhallen', '10#Runde 1#0'],
        ['Carl', 'Københavns Badminton Klub', '10#Runde 1#1'],
        ['Eva', 'Valbyhallen', '10#Runde 1#2'],
        ['Gry', 'Gladsaxe Søborg U9', '20#Runde 1#0'],
        ['Ida', 'Gladsaxe Søborg Badmintonklub', '30#Runde 1#0'],
    ]);
    const valby = imp.filtrerSpillesteder(r.matches, ['Valbyhallen']);
    assert.deepEqual(valby.map(m => m.side1Player1), ['Anna', 'Eva']);
    assert.equal(imp.filtrerSpillesteder(r.matches, null).length, 5, 'intet valg = alle');
    assert.equal(imp.filtrerSpillesteder(r.matches, []).length, 5);
});

test('Opdatér: kun de valgte steders kampe — de andre tilbydes ikke som nye', async () => {
    const raekke = (id, sid, s1, s2) => ({
        id, source_match_id: sid, status: 'pending', planned_time: '2026-11-28 09:00', doubles: 0,
        side1_player1: s1, side1_player2: null, side2_player1: s2, side2_player2: null
    });
    const eksisterende = [raekke(1, '10#Runde 1#0', 'Anna', 'Berit'), raekke(2, '10#Runde 1#2', 'Eva', 'Finn')];
    nulstil(async (sql) => {
        if (/FROM tournament_matches\s+WHERE tournament_id = \?\s+ORDER BY/.test(sql)) return eksisterende;
        if (/SELECT source_locations FROM tournaments/.test(sql)) return [{ source_locations: '["Valbyhallen"]' }];
        if (/MAX\(match_order\)/.test(sql)) return [{ max_order: 2 }];
        return { affectedRows: 1, insertId: 99 };
    });
    const res = await tournaments.syncTournamentCore({ id: 4, source_tournament_id: TID }, { skipClubs: true });
    assert.equal(res.added, 0, 'Carl–Dorte (KBK) er i en kendt række, men tilføjes ikke');
    assert.deepEqual(res.newCandidates, [], 'U9 og U13 fra Gladsaxe tilbydes ikke');
    assert.equal(kald.filter(k => /^INSERT INTO tournament_matches/.test(k.sql.trim())).length, 0);

    // Uden valg (gamle turneringer, NULL): som før — alle steder
    nulstil(async (sql) => {
        if (/FROM tournament_matches\s+WHERE tournament_id = \?\s+ORDER BY/.test(sql)) return eksisterende;
        if (/SELECT source_locations FROM tournaments/.test(sql)) return [{ source_locations: null }];
        if (/MAX\(match_order\)/.test(sql)) return [{ max_order: 2 }];
        return { affectedRows: 1, insertId: 99 };
    });
    const alle = await tournaments.syncTournamentCore({ id: 4, source_tournament_id: TID }, { skipClubs: true });
    assert.equal(alle.added, 1, 'Carl–Dorte i den kendte række');
    assert.equal(alle.newCandidates.length, 2);
});

test('Importens valg renses: navne, højst 50, tomt = alle; gemt JSON læses tilbage', () => {
    const { rensSpillesteder, laesSpillesteder } = tournaments._spillesteder;
    assert.deepEqual(rensSpillesteder([' Valbyhallen ', 'Valbyhallen', 'KMB 2010']), ['Valbyhallen', 'KMB 2010']);
    assert.equal(rensSpillesteder([]), null);
    assert.equal(rensSpillesteder(null), null);
    assert.equal(rensSpillesteder('Valbyhallen'), null);
    assert.equal(rensSpillesteder(Array.from({ length: 51 }, (_, i) => `Sted ${i}`)), null);
    assert.equal(rensSpillesteder(['x'.repeat(201)]), null);
    assert.deepEqual(laesSpillesteder('["Valbyhallen"]'), ['Valbyhallen']);
    assert.equal(laesSpillesteder(null), null);
    assert.equal(laesSpillesteder('[]'), null);
    assert.equal(laesSpillesteder('ikke json'), null);
});
