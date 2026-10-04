/**
 * Unit-tests af holdkamp-formaterne og opstillingsreglerne
 * (Fælles reglement for ungdomsholdturneringen 2026/27, § 7, § 15, § 22).
 *
 * Referencekampe fra badmintonplayer.dk (sæson 2026/27):
 *   514948  U9 3 spillere: 1.–4. S og 1. D (Chris Tian spiller 3. og 4. single)
 *   516284  4 piger, 8 kampe: 1.–4. DD og derefter 1.–4. DS
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const hf = require('../../config/holdkampFormater');

const g = (category, t1, t2, extra = {}) => ({
    category,
    team1_player1: t1[0] || '', team1_player2: t1[1] || null,
    team2_player1: t2[0] || '', team2_player2: t2[1] || null,
    status: 'pending', winner_team: null, ...extra
});

// Kamp 516284 (4 piger, 8 kampe) — BC37 Amager 5 mod KMB2010 5
const KAMP_516284 = [
    g('DD', ['Luna Nielsen', 'Melissa Abdulrahman Issa'], ['Advika Rudra', 'Ella Herskind Evald']),
    g('DD', ['Luna Nielsen', 'Lilje Amelia Bech Sørensen'], ['Advika Rudra', 'Anna Kjøller Grøndahl']),
    g('DD', ['Melissa Abdulrahman Issa', 'Urvi Rainu'], ['Ella Herskind Evald', 'Ida Kjær-Nielsen']),
    g('DD', ['Lilje Amelia Bech Sørensen', 'Urvi Rainu'], ['Anna Kjøller Grøndahl', 'Ida Kjær-Nielsen']),
    g('DS', ['Luna Nielsen'], ['Ella Herskind Evald']),
    g('DS', ['Melissa Abdulrahman Issa'], ['Ida Kjær-Nielsen']),
    g('DS', ['Lilje Amelia Bech Sørensen'], ['Advika Rudra']),
    g('DS', ['Urvi Rainu'], ['Anna Kjøller Grøndahl'])
];

// Kamp 514948 (U9 3 spillere) — KMB2010 1; modstanderen har ikke afleveret endnu
const KAMP_514948 = [
    g('Single', ['Hjalte Levinsky Svejstrup'], []),
    g('Single', ['Laura Ganesalingam'], []),
    g('Single', ['Chris Tian'], []),
    g('Single', ['Chris Tian'], []),
    g('Double', ['Hjalte Levinsky Svejstrup', 'Laura Ganesalingam'], [])
];

// En lovlig 4 spillere-kamp (6 kampe): 4 spillere pr. hold, 1 single + 1 double hver
const LOVLIG_6 = [
    g('Single', ['A1'], ['B1']), g('Single', ['A2'], ['B2']),
    g('Single', ['A3'], ['B3']), g('Single', ['A4'], ['B4']),
    g('Double', ['A1', 'A3'], ['B1', 'B3']), g('Double', ['A2', 'A4'], ['B2', 'B4'])
];

// ---------- Format ----------

test('detectFormat: 4 spillere, 4 piger (DS/DD), 8-kamps-varianten og U9', () => {
    assert.equal(hf.detectFormat(LOVLIG_6), '4spillere');
    assert.equal(hf.detectFormat(KAMP_516284), '4spillere8');
    assert.equal(hf.detectFormat(KAMP_514948), 'u9_3spillere');
    // 4 piger med 6 kampe: 4 DS + 2 DD
    assert.equal(hf.detectFormat(['DS', 'DS', 'DS', 'DS', 'DD', 'DD'].map(c => ({ category: c }))), '4spillere');
    // voksenformaterne er uændrede (2+2 har også DS/DD, men har MD/HS)
    assert.equal(hf.detectFormat(['MD','MD','DS','DS','HS','HS','DD','HD'].map(c => ({ category: c }))), '2plus2');
    assert.equal(hf.detectFormat(['MD','DS','HS','HS','HS','DD','HD','HD'].map(c => ({ category: c }))), '4plus2');
    assert.equal(hf.detectFormat([]), 'imported');
});

test('formaterne har de rigtige kampe (§ 7 stk. 1 c/f og stk. 6 b)', () => {
    const tael = (f) => {
        const k = hf.FORMATER[f].kampe;
        return [k.filter(c => !hf.erDouble(c)).length, k.filter(c => hf.erDouble(c)).length];
    };
    assert.deepEqual(tael('4spillere'), [4, 2]);
    assert.deepEqual(tael('4spillere8'), [4, 4]);
    assert.deepEqual(tael('u9_3spillere'), [4, 1]);
    assert.equal(hf.FORMATER['4spillere'].goldenSet, true);
    assert.ok(!hf.FORMATER['4spillere8'].goldenSet, 'intet golden set i 8-kamps-varianten');
});

test('golden set er en double og spilles som ét sæt', () => {
    assert.equal(hf.erDouble('GS'), true);
    assert.equal(hf.saetForSejr('GS'), 1);
    assert.equal(hf.saetForSejr('Double'), 2);
    assert.equal(hf.kategoriNavn('GS', 1), 'Golden set');
    assert.equal(hf.kategoriNavn('Single', 3), 'Single 3');
});

// ---------- 4 spillere (6 kampe) ----------

test('4 spillere: lovlig opstilling giver ingen bemærkninger', () => {
    assert.deepEqual(hf.tjekOpstilling('4spillere', LOVLIG_6), []);
});

test('4 spillere: højst 1 single og 1 double pr. spiller (§ 7 stk. 1 d)', () => {
    const kampe = LOVLIG_6.map(x => ({ ...x }));
    kampe[1] = g('Single', ['A1'], ['B2']);                  // A1 spiller 2 singler
    kampe[5] = g('Double', ['A1', 'A4'], ['B2', 'B4']);      // ... og 2 doubler
    const fund = hf.tjekOpstilling('4spillere', kampe, { 1: 'Lyngby 1' }).map(f => f.tekst);
    assert.ok(fund.some(t => /Lyngby 1: A1 spiller 2 singler/.test(t)), fund.join('\n'));
    assert.ok(fund.some(t => /A1 spiller 2 doubler/.test(t)), fund.join('\n'));
});

test('4 spillere: halvt udfyldt formular giver ikke falske fejl', () => {
    const kampe = LOVLIG_6.map(x => ({ ...x, team2_player1: '', team2_player2: '' }));
    assert.deepEqual(hf.tjekOpstilling('4spillere', kampe), []);
});

// ---------- 4 spillere / 4 piger (8 kampe) ----------

test('8 kampe: kamp 516284 overholder alle regler (§ 7 stk. 1 f, § 15 stk. 9)', () => {
    assert.deepEqual(hf.tjekOpstilling('4spillere8', KAMP_516284), []);
});

test('8 kampe: 4. double må ikke have en spiller fra 1. double (§ 15 stk. 9 a)', () => {
    const k = KAMP_516284.map(x => ({ ...x }));
    k[3] = g('DD', ['Luna Nielsen', 'Urvi Rainu'], ['Anna Kjøller Grøndahl', 'Ida Kjær-Nielsen']);
    const fund = hf.tjekOpstilling('4spillere8', k).map(f => f.tekst);
    assert.ok(fund.some(t => /4\. double skal bestå af to spillere, som ikke spiller 1\. double/.test(t)), fund.join('\n'));
});

test('8 kampe: 2. og 3. double skal være 4 forskellige spillere i nye konstellationer (§ 15 stk. 9 b)', () => {
    const k = KAMP_516284.map(x => ({ ...x }));
    k[1] = g('DD', ['Luna Nielsen', 'Melissa Abdulrahman Issa'], ['Advika Rudra', 'Anna Kjøller Grøndahl']); // = 1. double
    k[2] = g('DD', ['Luna Nielsen', 'Urvi Rainu'], ['Ella Herskind Evald', 'Ida Kjær-Nielsen']);              // Luna igen
    const fund = hf.tjekOpstilling('4spillere8', k).map(f => f.tekst);
    assert.ok(fund.some(t => /2\. og 3\. double skal være 4 forskellige spillere/.test(t)), fund.join('\n'));
    assert.ok(fund.some(t => /2\. double er samme par som i 1\. eller 4\. double/.test(t)), fund.join('\n'));
    assert.ok(fund.some(t => /Luna Nielsen spiller 3 doubler — højst 2/.test(t)), fund.join('\n'));
});

test('8 kampe: 2 doubler med samme makker og 2 singler fanges (§ 7 stk. 1 f)', () => {
    const k = [
        g('Double', ['A', 'B'], []), g('Double', ['A', 'B'], []),
        g('Double', ['C', 'D'], []), g('Double', ['C', 'D'], []),
        g('Single', ['A'], []), g('Single', ['A'], []), g('Single', ['C'], []), g('Single', ['D'], [])
    ];
    const fund = hf.tjekOpstilling('4spillere8', k).map(f => f.tekst);
    assert.ok(fund.some(t => /A spiller 2 doubler med samme makker/.test(t)), fund.join('\n'));
    assert.ok(fund.some(t => /A spiller 2 singler — højst 1/.test(t)), fund.join('\n'));
});

// ---------- U9 3 spillere ----------

test('U9: kamp 514948 er lovlig — den der spiller 2 singler spiller 4. single (§ 15 stk. 8 a)', () => {
    assert.deepEqual(hf.tjekOpstilling('u9_3spillere', KAMP_514948), []);
});

test('U9: to singler uden 4. single fanges (§ 15 stk. 8 a)', () => {
    const k = KAMP_514948.map(x => ({ ...x }));
    k[1] = g('Single', ['Chris Tian'], []);       // 2. og 3. single
    k[3] = g('Single', ['Laura Ganesalingam'], []);
    const fund = hf.tjekOpstilling('u9_3spillere', k).map(f => f.tekst);
    assert.ok(fund.some(t => /Chris Tian spiller 2 singler og skal derfor spille 4\. single/.test(t)), fund.join('\n'));
});

test('U9: double og 2 singler er for mange kampe (§ 7 stk. 6 c)', () => {
    const k = KAMP_514948.map(x => ({ ...x }));
    k[4] = g('Double', ['Chris Tian', 'Laura Ganesalingam'], []);
    const fund = hf.tjekOpstilling('u9_3spillere', k).map(f => f.tekst);
    assert.ok(fund.some(t => /Chris Tian spiller 3 kampe — højst 2/.test(t)), fund.join('\n'));
});

test('U9: samme to spillere i 1. og 4. single → byt to singler fra toppen (§ 7 stk. 6 c)', () => {
    const k = [
        g('Single', ['A1'], ['B1']), g('Single', ['A2'], ['B2']),
        g('Single', ['A3'], ['B3']), g('Single', ['A1'], ['B1']),
        g('Double', ['A2', 'A3'], ['B2', 'B3'])
    ];
    assert.deepEqual(hf.dobbeltMoeder(k).map(m => [m.a, m.b]), [[1, 4]]);
    const f = hf.byttForslag(k);
    assert.ok(f, 'der findes et byt');
    assert.ok(f.a < 4 && f.b < 4, '4. single byttes aldrig');
    // Udfør byttet og tjek at dobbeltmødet er væk
    const efter = k.map(x => ({ ...x }));
    const felt = `team${f.hold}_player1`;
    [efter[f.idxA][felt], efter[f.idxB][felt]] = [efter[f.idxB][felt], efter[f.idxA][felt]];
    assert.deepEqual(hf.dobbeltMoeder(efter), []);
    assert.equal(hf.byttForslag(KAMP_514948), null, 'intet dobbeltmøde → intet forslag');
});

// ---------- Golden set ----------

const spillet = (kampe, vindere) => kampe.map((x, i) => ({ ...x, status: 'finished', winner_team: vindere[i] }));

test('golden set kræves kun ved 3–3 i 4 spillere med 6 kampe (§ 7 stk. 1 e)', () => {
    const tm33 = { format: '4spillere', games: spillet(LOVLIG_6, [1, 1, 1, 2, 2, 2]) };
    assert.equal(hf.goldenSetStatus(tm33).kraeves, true);
    const tm42 = { format: '4spillere', games: spillet(LOVLIG_6, [1, 1, 1, 1, 2, 2]) };
    assert.equal(hf.goldenSetStatus(tm42).kraeves, false);
    const iGang = { format: '4spillere', games: spillet(LOVLIG_6, [1, 1, 1, 2, 2, null]).map((x, i) => i === 5 ? { ...x, status: 'active' } : x) };
    assert.equal(hf.goldenSetStatus(iGang).kraeves, false);
    const medGS = { format: '4spillere', games: [...tm33.games, g('GS', ['A1', 'A2'], ['B1', 'B2'])] };
    assert.equal(hf.goldenSetStatus(medGS).kraeves, false);
    assert.equal(hf.goldenSetStatus(medGS).findes, true);
    // aldrig i 8-kamps-varianten eller U9
    assert.equal(hf.goldenSetStatus({ format: '4spillere8', games: spillet(KAMP_516284, [1,1,1,1,2,2,2,2]) }).muligt, false);
    assert.equal(hf.goldenSetStatus({ format: 'u9_3spillere', games: KAMP_514948 }).muligt, false);
    // 4 piger med 6 kampe (DS/DD) har golden set
    const piger = LOVLIG_6.map(x => ({ ...x, category: hf.erDouble(x.category) ? 'DD' : 'DS' }));
    assert.equal(hf.goldenSetStatus({ format: '4spillere', games: spillet(piger, [1, 1, 1, 2, 2, 2]) }).kraeves, true);
});

test('golden set: kun nye par af spillere, der har deltaget', () => {
    const st = hf.goldenSetStatus({ format: '4spillere', games: spillet(LOVLIG_6, [1, 1, 1, 2, 2, 2]) });
    assert.deepEqual(st.deltagere[1].sort(), ['A1', 'A2', 'A3', 'A4']);
    assert.equal(hf.tjekGoldenSetPar(st, 1, 'A1', 'A2'), null);                 // nyt par
    assert.equal(hf.tjekGoldenSetPar(st, 1, ' a2 ', 'A1'), null);               // navne normaliseres
    assert.match(hf.tjekGoldenSetPar(st, 1, 'A3', 'A1'), /allerede spillet double sammen/);
    assert.match(hf.tjekGoldenSetPar(st, 1, 'A1', 'A1'), /to forskellige/);
    assert.match(hf.tjekGoldenSetPar(st, 1, 'A1', 'Reserve'), /deltaget/);
    assert.match(hf.tjekGoldenSetPar(st, 2, '', 'B1'), /Vælg to spillere/);
});
