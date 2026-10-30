/**
 * YouTube-API'ets dagskvote — fælles for hele serveren (alle klubber bruger
 * Badmintonapps login-klient hos Google).
 *
 * Google giver 10.000 enheder om dagen og nulstiller ved midnat Pacific-tid.
 * Et opslag koster 1 enhed, alt der opretter, ændrer eller sletter 50 — en
 * udsendelse koster derfor ca. 150–200. config/youtube.js tæller hvert kald
 * her; super-admin viser forbruget, så man kan se, hvornår der skal søges om
 * mere kvote. Tallene gemmes i master-tabellen indstillinger (de seneste 14
 * dage), så en genstart ikke nulstiller dem.
 */

const NOEGLE = 'youtube_kvote';
const STANDARD_GRAENSE = 10000;
const DAGE = 14;
const GEM_EFTER_MS = 5000;
const TZ = 'America/Los_Angeles';

let _data = { dage: {}, graense: STANDARD_GRAENSE };
let _gemTimer = null;
let _indlaest = false;   // de gemte tal er læst — før det må de ikke overskrives
let _gemmes = true;      // testene slår gemningen fra (ingen database)

const dele = (t, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(t).map(p => [p.type, p.value]));

// Googles døgn: datoen i Pacific-tid ('2026-10-30')
function googleDag(nu = Date.now()) {
    const d = dele(nu, TZ);
    return `${d.year}-${d.month}-${d.day}`;
}

// Hvornår kvoten nulstilles næste gang (midnat Pacific-tid) som ms
function nulstilles(nu = Date.now()) {
    const d = dele(nu, TZ);
    const midnat = Date.UTC(+d.year, +d.month - 1, +d.day + 1, 0, 0);
    // midnat er 00:00 UTC — læg tidszonens forskydning på det tidspunkt til
    const x = dele(midnat, TZ);
    return midnat - (Date.UTC(+x.year, +x.month - 1, +x.day, +x.hour, +x.minute) - midnat);
}

// Et kald til YouTube: enheder brugt; opbrugt = Google svarede, at kvoten er brugt op
function tael(enheder, { opbrugt = false, nu = Date.now() } = {}) {
    const dag = googleDag(nu);
    const d = _data.dage[dag] || (_data.dage[dag] = { enheder: 0, kald: 0, opbrugt: null });
    d.enheder += enheder;
    d.kald += 1;
    if (opbrugt && !d.opbrugt) d.opbrugt = new Date(nu).toISOString();
    for (const gammel of Object.keys(_data.dage).sort().slice(0, -DAGE)) delete _data.dage[gammel];
    planlaegGem();
}

function status(nu = Date.now()) {
    const dag = googleDag(nu);
    const d = _data.dage[dag] || { enheder: 0, kald: 0, opbrugt: null };
    return {
        dag,
        enheder: d.enheder,
        kald: d.kald,
        opbrugt: d.opbrugt,
        graense: _data.graense,
        nulstilles: new Date(nulstilles(nu)).toISOString(),
        // De foregående dage (nyeste først), til at se mønstret over en uge
        historik: Object.keys(_data.dage).filter(k => k < dag).sort().reverse().slice(0, 7)
            .map(k => ({ dag: k, enheder: _data.dage[k].enheder, opbrugt: !!_data.dage[k].opbrugt }))
    };
}

// Når Google har givet mere kvote, skrives den nye grænse i super-admin
function saetGraense(n) {
    _data.graense = n;
    planlaegGem();
}

function planlaegGem() {
    if (_gemTimer || !_gemmes) return;
    _gemTimer = setTimeout(() => {
        _gemTimer = null;
        gem().catch(e => console.error('✗ YouTube-kvoten kunne ikke gemmes:', e.message));
    }, GEM_EFTER_MS);
    if (_gemTimer.unref) _gemTimer.unref();
}

async function gem() {
    if (!_indlaest) await indlaes();
    const masterDb = require('./masterDatabase');
    await masterDb.query(
        `INSERT INTO indstillinger (noegle, vaerdi) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE vaerdi = VALUES(vaerdi)`,
        [NOEGLE, JSON.stringify(_data)]);
}

async function indlaes() {
    const masterDb = require('./masterDatabase');
    const rows = await masterDb.query('SELECT vaerdi FROM indstillinger WHERE noegle = ?', [NOEGLE]);
    let gemt = null;
    try { gemt = rows[0] && JSON.parse(rows[0].vaerdi); } catch { /* ødelagt: start forfra */ }
    if (gemt && typeof gemt === 'object') {
        // Kald talt, før tallene var læst (lige efter opstart), lægges oven i
        const dage = gemt.dage && typeof gemt.dage === 'object' ? gemt.dage : {};
        for (const [dag, d] of Object.entries(_data.dage)) {
            const g = dage[dag] || { enheder: 0, kald: 0, opbrugt: null };
            dage[dag] = { enheder: g.enheder + d.enheder, kald: g.kald + d.kald, opbrugt: g.opbrugt || d.opbrugt };
        }
        _data = { dage, graense: Number.isInteger(gemt.graense) && gemt.graense > 0 ? gemt.graense : STANDARD_GRAENSE };
    }
    _indlaest = true;
}

// Kun til testene
function nulstil({ gem = true } = {}) {
    _data = { dage: {}, graense: STANDARD_GRAENSE };
    _indlaest = false;
    _gemmes = gem;
    clearTimeout(_gemTimer);
    _gemTimer = null;
}

module.exports = { STANDARD_GRAENSE, googleDag, nulstilles, tael, status, saetGraense, indlaes, gem, nulstil };
