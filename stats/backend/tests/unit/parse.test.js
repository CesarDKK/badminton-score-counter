/**
 * Unit-tests af holdseddel-parsningen — især interne klubkampe, hvor BEGGE
 * sider hører til klubben og skal tælles hver på sit hold.
 * Ingen netværk: markup'en er syntetisk men følger badmintonplayers struktur
 * (enkelt-citerede attributter, matchinfo + matchresultschema).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../parse');

const erLyngby = (navn) => /^lyngby(\s|$|\d)/i.test(String(navn || '').trim());
const kunLyngby3 = (navn) => String(navn || '').trim() === 'Lyngby 3';

// Lyngby 3 (hjemme) mod Lyngby 5 (ude). HD vundet af hjemme 2-0, DD af ude 0-2.
const INTERN = `
<table class='matchinfo'>
  <tr><td>Kampnr</td><td>999</td></tr>
  <tr><td>Tid</td><td>lø 11-04-2026 10:30</td></tr>
  <tr><td>Resultat</td><td>1-1</td></tr>
</table>
<table class='matchresultschema showmatch'>
  <tr><th>Disciplin</th><th>Lyngby 3</th><th>Lyngby 5</th><th></th></tr>
  <tr>
    <td>1. HD</td>
    <td><a href='/DBF/Spiller/VisSpiller/#111'>Anna</a> <a href='/DBF/Spiller/VisSpiller/#112'>Bo</a></td>
    <td><a href='/DBF/Spiller/VisSpiller/#211'>Cai</a> <a href='/DBF/Spiller/VisSpiller/#212'>Do</a></td>
    <td>21-10</td><td>21-15</td><td></td>
  </tr>
  <tr>
    <td>2. DD</td>
    <td><a href='/DBF/Spiller/VisSpiller/#111'>Anna</a> <a href='/DBF/Spiller/VisSpiller/#113'>Eva</a></td>
    <td><a href='/DBF/Spiller/VisSpiller/#211'>Cai</a> <a href='/DBF/Spiller/VisSpiller/#213'>Fie</a></td>
    <td>10-21</td><td>15-21</td><td></td>
  </tr>
</table>`;

// Samme kamp, men 1. HD har sætcifre til hjemme OG en W.O.-markering til ude.
const MED_WO = INTERN.replace(
    "<td>21-10</td><td>21-15</td><td></td>",
    "<td>21-10</td><td>21-15</td><td><span title='Lyngby 5'>L</span></td>"
);

test('intern kamp: side er "begge" og alle 8 deltagelser fanges', () => {
    const k = P.parseMatch(INTERN, erLyngby);
    assert.equal(k.side, 'begge');
    assert.equal(k.hjemme, 'Lyngby 3');
    assert.equal(k.ude, 'Lyngby 5');
    assert.equal(k.spillere.length, 8);
    const ids = new Set(k.spillere.map(s => s.id));
    assert.ok(['111', '112', '113', '211', '212', '213'].every(id => ids.has(id)));
});

test('intern kamp: hver spiller får sin side, og sejren tilskrives rette side', () => {
    const k = P.parseMatch(INTERN, erLyngby);
    const hd = (id) => k.spillere.find(s => s.disciplin.startsWith('1.') && s.id === id);
    assert.equal(hd('111').side, 'hjemme');
    assert.equal(hd('111').vundet, true);
    assert.equal(hd('211').side, 'ude');
    assert.equal(hd('211').vundet, false);
    const dd = (id) => k.spillere.find(s => s.disciplin.startsWith('2.') && s.id === id);
    assert.equal(dd('111').vundet, false);
    assert.equal(dd('211').vundet, true);
});

test('almindelig kamp: kun klubbens egen side parses', () => {
    const k = P.parseMatch(INTERN, kunLyngby3);
    assert.equal(k.side, 'hjemme');
    assert.equal(k.spillere.length, 4);
    assert.ok(k.spillere.every(s => s.side === 'hjemme'));
});

test('klubben deltager ikke: side null og ingen spillere', () => {
    const k = P.parseMatch(INTERN, () => false);
    assert.equal(k.side, null);
    assert.deepEqual(k.spillere, []);
});

test('W.O.-markeringen vejer tungere end sætcifrene', () => {
    const k = P.parseMatch(MED_WO, erLyngby);
    const hjemme = k.spillere.find(s => s.disciplin.startsWith('1.') && s.id === '111');
    const ude = k.spillere.find(s => s.disciplin.startsWith('1.') && s.id === '211');
    assert.equal(hjemme.vundet, false, 'hjemme udgik trods førende sæt');
    assert.equal(ude.vundet, true);
    assert.equal(ude.wo, true);
});

test('kampinfo (nr, tid, resultat) læses fra matchinfo-tabellen', () => {
    const k = P.parseMatch(INTERN, erLyngby);
    assert.equal(k.kampnr, '999');
    assert.equal(k.tid, 'lø 11-04-2026 10:30');
    assert.equal(k.resultat, '1-1');
});

test('attr() læser både enkelt-, dobbelt- og ucitererede attributter', () => {
    assert.equal(P.attr("class='matchinfo'", 'class'), 'matchinfo');
    assert.equal(P.attr('class="matchinfo"', 'class'), 'matchinfo');
    assert.equal(P.attr('class=matchinfo id=x', 'class'), 'matchinfo');
    assert.equal(P.attr('id=x', 'class'), '');
});

test('markup uden resultat-skema giver null', () => {
    assert.equal(P.parseMatch('<table class="matchinfo"></table>', erLyngby), null);
});
