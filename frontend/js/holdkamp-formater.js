/**
 * Holdkamp-formater og opstillingsregler (Fælles reglement for
 * ungdomsholdturneringen 2026/27, § 7, § 15 og § 22).
 *
 * Bruges af admin (opret holdkamp, regeltjek, golden set), tælleren (golden
 * set = ét afgørende sæt) og oversigten (kategorinavne). UMD: virker både som
 * <script> (window.HoldkampFormater) og som require() i unit-testene.
 *
 * Kategorier: 'Single' og 'Double' (4 spillere / U9), 'MD','DS','HS','DD','HD'
 * (voksen-/2+2-formater) og 'GS' = golden set (en double, ét sæt).
 * NB: badmintonplayer.dk kalder kampene i "4 piger" for DS og DD (fx kamp
 * 516284: 1.–4. DD og derefter 1.–4. DS). Reglerne herunder skelner derfor
 * kun mellem double (erDouble) og single — ikke mellem 'Double' og 'DD'.
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.HoldkampFormater = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const S = 'Single', D = 'Double';

    const FORMATER = {
        liga11:    { navn: 'Liga (11 kampe)',      kampe: ['MD','MD','DS','DS','HS','HS','HS','DD','DD','HD','HD'] },
        '13kamps': { navn: '13-kamps format',      kampe: ['HS','HS','HS','HS','DS','DS','HD','HD','HD','DD','DD','MD','MD'] },
        '2plus2':  { navn: '2+2-format (8 kampe)', kampe: ['MD','MD','DS','DS','HS','HS','DD','HD'] },
        '4plus2':  { navn: '4+2-format (8 kampe)', kampe: ['MD','DS','HS','HS','HS','DD','HD','HD'] },
        '4plus3':  { navn: '4+3-format (9 kampe)', kampe: ['MD','MD','DS','DS','HS','HS','DD','HD','HD'] },
        // § 7 stk. 1 c–e: 2 doubler og 4 singler, golden set ved 3–3.
        // Rækkefølgen følger badmintonplayer.dk's holdseddel (singler først).
        '4spillere': {
            navn: '4 spillere / 4 piger (6 kampe)',
            kampe: [S, S, S, S, D, D],
            goldenSet: true,
            note: 'Samme spiller må højst spille 1 double og 1 single. Ender kampen 3–3, spilles et golden set (§ 7 stk. 1).'
        },
        // § 7 stk. 1 f og § 15 stk. 9: 2 + 2 doubler og 4 singler, intet golden set.
        '4spillere8': {
            navn: '4 spillere / 4 piger (8 kampe, 2 + 2 doubler)',
            kampe: [D, D, D, D, S, S, S, S],
            note: 'Spilles i rækkefølgen 1. og 4. double, så 2. og 3. double med nye makkere, til sidst de 4 singler (§ 15 stk. 9). ' +
                  'Samme spiller må spille 2 doubler med forskellige makkere og 1 single. Intet golden set.'
        },
        // § 7 stk. 6 og § 15 stk. 8: 1 double og 4 singler. Rækkefølge som badmintonplayer.dk.
        u9_3spillere: {
            navn: 'U9 3 spillere (5 kampe)',
            kampe: [S, S, S, S, D],
            note: 'Samme spiller må højst spille 2 kampe: 1 double og 1 single eller 2 singler. ' +
                  'Den, der spiller 2 singler, skal spille 4. single (§ 15 stk. 8).'
        }
    };

    const DOUBLE_KATEGORIER = ['MD', 'DD', 'HD', 'Double', 'GS'];
    const erDouble = (kat) => DOUBLE_KATEGORIER.includes(kat);
    const erGoldenSet = (kat) => kat === 'GS';

    /** Sæt der skal vindes for at vinde kampen: golden set er ét sæt (spilles som et 3. sæt). */
    const saetForSejr = (kat) => (erGoldenSet(kat) ? 1 : 2);

    /** "Single 3", "MD 1" — og "Golden set" for golden set. */
    function kategoriNavn(kat, nr) {
        if (erGoldenSet(kat)) return 'Golden set';
        return nr ? `${kat} ${nr}` : kat;
    }

    // ---------- Hjælpere ----------

    // Navne sammenlignes uden forskel på store/små bogstaver og mellemrum
    const norm = (n) => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase();

    // Accepterer både API-rækker (team1_player1) og formular-objekter (team1Player1)
    function spillere(g, hold) {
        const p1 = g[`team${hold}_player1`] !== undefined ? g[`team${hold}_player1`] : g[`team${hold}Player1`];
        const p2 = g[`team${hold}_player2`] !== undefined ? g[`team${hold}_player2`] : g[`team${hold}Player2`];
        return [p1, erDouble(g.category) ? p2 : null].map(n => String(n || '').trim()).filter(Boolean);
    }

    const parNoegle = (a, b) => [norm(a), norm(b)].sort().join(' + ');

    /**
     * Delkampe uden golden set, nummereret pr. kategori (1. double, 2. double ...).
     * idx er delkampens plads i den OPRINDELIGE liste.
     */
    function nummerer(games) {
        const t = {};
        const ud = [];
        games.forEach((g, idx) => {
            if (erGoldenSet(g.category)) return;
            t[g.category] = (t[g.category] || 0) + 1;
            ud.push({ g, idx, nr: t[g.category] });
        });
        return ud;
    }

    const ordenstal = (n) => `${n}.`;

    // ---------- Regeltjek af en opstilling ----------

    /**
     * Tjekker en holdopstilling mod reglerne for formatet. Returnerer en liste af
     * { hold, tekst } — tom liste = ingen bemærkninger. Tomme navne springes over,
     * så en halvt udfyldt formular ikke giver falske fejl.
     */
    function tjekOpstilling(format, games, holdnavne = {}) {
        const fund = [];
        const kampe = nummerer(games || []);
        const navnPaaHold = (h) => holdnavne[h] || `Hold ${h}`;

        for (const hold of [1, 2]) {
            // pr. spiller: singler, doubler og makkere
            const pr = new Map();
            const hent = (navn) => {
                const k = norm(navn);
                if (!pr.has(k)) pr.set(k, { navn, singler: [], doubler: [], makkere: [] });
                return pr.get(k);
            };
            for (const { g, nr } of kampe) {
                const sp = spillere(g, hold);
                if (erDouble(g.category)) {
                    sp.forEach((n, i) => {
                        const p = hent(n);
                        p.doubler.push(nr);
                        if (sp[1 - i]) p.makkere.push(norm(sp[1 - i]));
                    });
                } else {
                    sp.forEach(n => hent(n).singler.push(nr));
                }
            }
            const H = navnPaaHold(hold);
            const alleUdfyldt = kampe.every(({ g }) => spillere(g, hold).length === (erDouble(g.category) ? 2 : 1));

            if (format === '4spillere') {
                for (const p of pr.values()) {
                    if (p.singler.length > 1) fund.push({ hold, tekst: `${H}: ${p.navn} spiller ${p.singler.length} singler — højst 1 (§ 7 stk. 1 d).` });
                    if (p.doubler.length > 1) fund.push({ hold, tekst: `${H}: ${p.navn} spiller ${p.doubler.length} doubler — højst 1 (§ 7 stk. 1 d).` });
                }
                if (alleUdfyldt && (pr.size < 4 || pr.size > 8)) fund.push({ hold, tekst: `${H}: ${pr.size} spillere — holdet består af 4–8 spillere (§ 7 stk. 1 b).` });
            }

            if (format === '4spillere8') {
                for (const p of pr.values()) {
                    if (p.singler.length > 1) fund.push({ hold, tekst: `${H}: ${p.navn} spiller ${p.singler.length} singler — højst 1 (§ 7 stk. 1 f).` });
                    if (p.doubler.length > 2) fund.push({ hold, tekst: `${H}: ${p.navn} spiller ${p.doubler.length} doubler — højst 2 (§ 7 stk. 1 f).` });
                    if (p.doubler.length === 2 && p.makkere.length === 2 && p.makkere[0] === p.makkere[1]) {
                        fund.push({ hold, tekst: `${H}: ${p.navn} spiller 2 doubler med samme makker — makkerne skal være forskellige (§ 7 stk. 1 f).` });
                    }
                }
                const dbl = {};
                kampe.filter(k => erDouble(k.g.category)).forEach(k => { dbl[k.nr] = spillere(k.g, hold).map(norm); });
                if (dbl[1] && dbl[4] && dbl[4].some(n => dbl[1].includes(n))) {
                    fund.push({ hold, tekst: `${H}: 4. double skal bestå af to spillere, som ikke spiller 1. double (§ 15 stk. 9 a).` });
                }
                if (dbl[2] && dbl[3] && dbl[2].length === 2 && dbl[3].length === 2 && new Set([...dbl[2], ...dbl[3]]).size < 4) {
                    fund.push({ hold, tekst: `${H}: 2. og 3. double skal være 4 forskellige spillere (§ 15 stk. 9 b).` });
                }
                const tidlige = [dbl[1], dbl[4]].filter(d => d && d.length === 2).map(d => d.slice().sort().join(' + '));
                [2, 3].forEach(nr => {
                    const d = dbl[nr];
                    if (d && d.length === 2 && tidlige.includes(d.slice().sort().join(' + '))) {
                        fund.push({ hold, tekst: `${H}: ${nr}. double er samme par som i 1. eller 4. double — der skal stilles op i en ny konstellation (§ 15 stk. 9 b).` });
                    }
                });
                if (alleUdfyldt && (pr.size < 4 || pr.size > 8)) fund.push({ hold, tekst: `${H}: ${pr.size} spillere — holdet består af 4–8 spillere (§ 7 stk. 1 b).` });
            }

            if (format === 'u9_3spillere') {
                const singleNumre = kampe.filter(k => !erDouble(k.g.category)).map(k => k.nr);
                const sidsteSingle = singleNumre.length ? Math.max(...singleNumre) : 4;
                for (const p of pr.values()) {
                    const ialt = p.singler.length + p.doubler.length;
                    if (ialt > 2) fund.push({ hold, tekst: `${H}: ${p.navn} spiller ${ialt} kampe — højst 2: 1 double og 1 single eller 2 singler (§ 7 stk. 6 c).` });
                    else if (p.singler.length === 2 && !p.singler.includes(sidsteSingle)) {
                        fund.push({ hold, tekst: `${H}: ${p.navn} spiller 2 singler og skal derfor spille ${ordenstal(sidsteSingle)} single (§ 15 stk. 8 a).` });
                    }
                }
                if (alleUdfyldt && (pr.size < 3 || pr.size > 6)) fund.push({ hold, tekst: `${H}: ${pr.size} spillere — holdet består af 3–6 spillere (§ 7 stk. 6 a).` });
            }
        }
        return fund;
    }

    // ---------- U9: samme to spillere mødes to gange i single ----------

    /** Par af singler (1-baserede numre), hvor de samme to spillere mødes igen. */
    function dobbeltMoeder(games) {
        const singler = nummerer(games || []).filter(k => !erDouble(k.g.category));
        const moeder = [];
        for (let a = 0; a < singler.length; a++) {
            for (let b = a + 1; b < singler.length; b++) {
                const [x1] = spillere(singler[a].g, 1), [y1] = spillere(singler[a].g, 2);
                const [x2] = spillere(singler[b].g, 1), [y2] = spillere(singler[b].g, 2);
                if (x1 && y1 && norm(x1) === norm(x2) && norm(y1) === norm(y2)) {
                    moeder.push({ a: singler[a].nr, b: singler[b].nr, spiller1: x1, spiller2: y1 });
                }
            }
        }
        return moeder;
    }

    /**
     * § 7 stk. 6 c: står de samme to spillere til at mødes to gange i single,
     * "kan der byttes rundt på to øvrige singlekampe fra toppen af holdskemaet",
     * hvis begge klubber er enige. Forslaget bytter ét holds spillere i to
     * singler fra toppen — aldrig sidste single, som den der spiller to singler
     * skal spille (§ 15 stk. 8 a). Returnerer { hold, a, b, idxA, idxB } med
     * 1-baserede single-numre og 0-baserede delkamp-indeks, eller null.
     */
    function byttForslag(games) {
        if (!dobbeltMoeder(games).length) return null;
        const singler = nummerer(games).filter(k => !erDouble(k.g.category));
        const topSingler = singler.slice(0, -1); // aldrig sidste single
        for (const hold of [2, 1]) {
            for (let a = 0; a < topSingler.length; a++) {
                for (let b = a + 1; b < topSingler.length; b++) {
                    const proeve = games.map(g => ({ ...g }));
                    const A = proeve[topSingler[a].idx], B = proeve[topSingler[b].idx];
                    const felt = `team${hold}_player1` in A ? `team${hold}_player1` : `team${hold}Player1`;
                    [A[felt], B[felt]] = [B[felt], A[felt]];
                    if (!dobbeltMoeder(proeve).length) {
                        return { hold, a: topSingler[a].nr, b: topSingler[b].nr, idxA: topSingler[a].idx, idxB: topSingler[b].idx };
                    }
                }
            }
        }
        return null;
    }

    // ---------- Golden set (4 spillere, 6 kampe) ----------

    /**
     * Status for golden set i en holdkamp (§ 7 stk. 1 e):
     *   kraeves   alle 6 kampe er spillet, stillingen er 3–3, og der er intet golden set endnu
     *   findes    golden set er oprettet
     *   deltagere pr. hold: spillere der har deltaget i holdkampen
     *   brugtePar pr. hold: doublepar der allerede er brugt (nøgler fra parNoegle)
     */
    function goldenSetStatus(tm) {
        const games = (tm && tm.games) || [];
        const regulaere = games.filter(g => !erGoldenSet(g.category));
        // 4 spillere hedder Single/Double, 4 piger DS/DD på badmintonplayer.dk
        const singler = regulaere.filter(g => !erDouble(g.category)).length;
        const doubler = regulaere.filter(g => erDouble(g.category)).length;
        const formatOk = tm && tm.format === '4spillere' && singler === 4 && doubler === 2;
        const findes = games.some(g => erGoldenSet(g.category));
        const alleSpillet = regulaere.length > 0 && regulaere.every(g => g.status === 'finished');
        const v1 = regulaere.filter(g => g.winner_team === 1).length;
        const v2 = regulaere.filter(g => g.winner_team === 2).length;

        const deltagere = { 1: [], 2: [] };
        const brugtePar = { 1: [], 2: [] };
        for (const hold of [1, 2]) {
            const set = new Map();
            for (const g of regulaere) {
                const sp = spillere(g, hold);
                sp.forEach(n => { if (!set.has(norm(n))) set.set(norm(n), n); });
                if (erDouble(g.category) && sp.length === 2) brugtePar[hold].push(parNoegle(sp[0], sp[1]));
            }
            deltagere[hold] = [...set.values()];
        }
        return {
            muligt: !!formatOk,
            findes,
            kraeves: !!formatOk && !findes && alleSpillet && v1 === 3 && v2 === 3,
            deltagere,
            brugtePar
        };
    }

    /** Fejltekst for et valgt golden set-par for ét hold, eller null hvis parret er lovligt. */
    function tjekGoldenSetPar(status, hold, p1, p2) {
        if (!p1 || !p2) return 'Vælg to spillere';
        if (norm(p1) === norm(p2)) return 'Vælg to forskellige spillere';
        const delt = status.deltagere[hold].map(norm);
        if (!delt.includes(norm(p1)) || !delt.includes(norm(p2))) return 'Begge spillere skal have deltaget i holdkampen';
        if (status.brugtePar[hold].includes(parNoegle(p1, p2))) return 'Parret har allerede spillet double sammen — vælg en ny konstellation';
        return null;
    }

    return {
        FORMATER, DOUBLE_KATEGORIER,
        erDouble, erGoldenSet, saetForSejr, kategoriNavn,
        tjekOpstilling, dobbeltMoeder, byttForslag,
        goldenSetStatus, tjekGoldenSetPar, parNoegle
    };
});
