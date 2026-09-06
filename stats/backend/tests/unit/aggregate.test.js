/**
 * Unit-tests af aggregeringen: at deltagelser bliver til de rigtige tal pr.
 * spiller og hold — inkl. interne klubkampe og makkerpar.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregate, disciplinType, datoAf } = require('../../aggregate');

// En intern kamp (kampnr 999): Lyngby 3 vs Lyngby 5, HD til hjemme, DD til ude.
function internKamp() {
    const d = (spillerId, navn, disciplin, side, vundet) => ({
        kampnr: 999, tid: 'lø 11-04-2026 10:30', spillerId, navn, disciplin, vundet, wo: false, side,
        hold: side === 'hjemme' ? 'Lyngby 3' : 'Lyngby 5', raekke: 'Serie 1', aargang: 'SEN'
    });
    return [
        d('111', 'Anna', '1. HD', 'hjemme', true), d('112', 'Bo', '1. HD', 'hjemme', true),
        d('211', 'Cai', '1. HD', 'ude', false), d('212', 'Do', '1. HD', 'ude', false),
        d('111', 'Anna', '2. DD', 'hjemme', false), d('113', 'Eva', '2. DD', 'hjemme', false),
        d('211', 'Cai', '2. DD', 'ude', true), d('213', 'Fie', '2. DD', 'ude', true)
    ];
}

const raw = (deltagelser, ekstra = {}) => ({ klub: 'Lyngby', clubId: '1', season: '2025', deltagelser, kampe: [], hold: [], ...ekstra });

test('intern kamp: begge hold får kampen talt med', () => {
    const a = aggregate(raw(internKamp()));
    const h3 = a.hold.find(h => h.hold === 'Lyngby 3');
    const h5 = a.hold.find(h => h.hold === 'Lyngby 5');
    assert.equal(h3.kampe, 1);
    assert.equal(h5.kampe, 1);
    assert.equal(h3.spillere, 3);
    assert.equal(h5.spillere, 3);
});

test('en spiller tælles én gang pr. holdkamp, men sejre pr. disciplin', () => {
    const a = aggregate(raw(internKamp()));
    const anna = a.spillere.find(s => s.id === '111');
    assert.equal(anna.kampe, 1, 'én holdkamp selvom hun spillede to discipliner');
    assert.equal(anna.double, 2);
    assert.equal(anna.vundet, 1);
    assert.equal(anna.tabt, 1);
    assert.equal(anna.sejrspct, 50);
});

test('makkerpar holdes adskilt pr. side — modstanderen bliver aldrig "makker"', () => {
    const a = aggregate(raw(internKamp()));
    const anna = a.spillere.find(s => s.id === '111');
    const makkere = anna.makkere.map(m => m.id);
    assert.ok(makkere.includes('112'), 'Bo (HD)');
    assert.ok(makkere.includes('113'), 'Eva (DD)');
    assert.ok(!makkere.includes('211') && !makkere.includes('212'), 'ingen fra udeholdet');
    const bo = anna.makkere.find(m => m.id === '112');
    assert.equal(bo.kampe, 1);
    assert.equal(bo.vundet, 1);
});

test('nøgletal: kampe, deltagelser, sejrsprocent samlet', () => {
    const a = aggregate(raw(internKamp()));
    const n = a.noegletal;
    assert.equal(n.kampeMedHoldseddel, 1);
    assert.equal(n.deltagelser, 8);
    assert.equal(n.hold, 2);
    assert.equal(n.spillere, 6);
    assert.equal(n.vundet, 4);
    assert.equal(n.sejrspct, 50);
});

test('disciplinType: S/HS/DS = single, D/HD/DD = double, MD = mix', () => {
    assert.equal(disciplinType('1. HS'), 'single');
    assert.equal(disciplinType('3. S'), 'single');
    assert.equal(disciplinType('2. DD'), 'double');
    assert.equal(disciplinType('4. D'), 'double');
    assert.equal(disciplinType('5. MD'), 'mix');
});

test('datoAf: dansk dato med ugedag bliver til ISO-dato', () => {
    assert.equal(datoAf('lø 11-04-2026 10:30'), '2026-04-11');
    assert.equal(datoAf('11.04.2026'), '2026-04-11');
    assert.equal(datoAf('ukendt'), null);
});

test('tomt input giver tomme lister og null-procent, ikke fejl', () => {
    const a = aggregate(raw([]));
    assert.deepEqual(a.spillere, []);
    assert.deepEqual(a.hold, []);
    assert.equal(a.noegletal.sejrspct, null);
});
