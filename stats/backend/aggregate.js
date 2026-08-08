/**
 * Regner rådata om til det som siden viser.
 *
 * En "kamp" er en holdkamp. En spiller tælles én gang pr. holdkamp, også hvis
 * vedkommende spillede både single og double i den — det er sådan man taler om
 * det i klubben ("han har spillet 12 kampe for 3. holdet").
 */

const { AARGANG_ORDEN } = require('./harvest');

/**
 * Holdnavn alene er tvetydigt: "Lyngby 1" findes i både SEN+40, SEN+50 og SEN+60.
 * Vi nøgler derfor altid på årgang + holdnavn.
 */
const holdNoegle = (d) => `${d.aargang} ${d.hold}`;

/** Vælger den pæneste navneform — kilden blander versaler og normal skrivemåde. */
function bedsteNavn(nuvaerende, kandidat) {
    if (!nuvaerende) return kandidat;
    const nuErRaab = nuvaerende === nuvaerende.toUpperCase();
    const nyErRaab = kandidat === kandidat.toUpperCase();
    if (nuErRaab && !nyErRaab) return kandidat;
    return nuvaerende;
}

function aargangOrden(a) {
    const i = AARGANG_ORDEN.indexOf(a);
    return i === -1 ? 999 : i;
}

/** "lø 11-04-2026 10:30" → "2026-04-11", ellers null. */
function datoAf(tid) {
    const m = /(\d{2})[-.](\d{2})[-.](\d{4})/.exec(String(tid || ''));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function aggregate(raw) {
    const { deltagelser = [], kampe = [], hold = [] } = raw;

    const navne = new Map();
    const spillerKampe = new Map();     // spillerId -> Set(kampnr)
    const spillerHold = new Map();      // spillerId -> Map(holdnøgle -> Set(kampnr))
    const spillerDiscipliner = new Map(); // spillerId -> {single, double}
    const holdSpillere = new Map();     // holdnøgle -> Set(spillerId)
    const holdKampe = new Map();        // holdnøgle -> Set(kampnr)
    const holdMeta = new Map();         // holdnøgle -> {aargang, hold, raekker:Set}
    const aargangKampe = new Map();
    const aargangSpillere = new Map();
    const maaned = new Map();

    for (const d of deltagelser) {
        const hk = holdNoegle(d);
        navne.set(d.spillerId, bedsteNavn(navne.get(d.spillerId), d.navn));

        if (!spillerKampe.has(d.spillerId)) spillerKampe.set(d.spillerId, new Set());
        spillerKampe.get(d.spillerId).add(d.kampnr);

        if (!spillerHold.has(d.spillerId)) spillerHold.set(d.spillerId, new Map());
        const hm = spillerHold.get(d.spillerId);
        if (!hm.has(hk)) hm.set(hk, new Set());
        hm.get(hk).add(d.kampnr);

        if (!spillerDiscipliner.has(d.spillerId)) spillerDiscipliner.set(d.spillerId, { single: 0, double: 0 });
        const disc = spillerDiscipliner.get(d.spillerId);
        if (/\bS\b|\bHS\b|\bDS\b/.test(d.disciplin)) disc.single++; else disc.double++;

        if (!holdSpillere.has(hk)) {
            holdSpillere.set(hk, new Set());
            holdKampe.set(hk, new Set());
            holdMeta.set(hk, { aargang: d.aargang, hold: d.hold, raekker: new Set() });
        }
        holdSpillere.get(hk).add(d.spillerId);
        holdKampe.get(hk).add(d.kampnr);
        holdMeta.get(hk).raekker.add(d.raekke);

        if (!aargangKampe.has(d.aargang)) { aargangKampe.set(d.aargang, new Set()); aargangSpillere.set(d.aargang, new Set()); }
        aargangKampe.get(d.aargang).add(d.kampnr);
        aargangSpillere.get(d.aargang).add(d.spillerId);
    }

    for (const k of kampe) {
        const dato = datoAf(k.tid);
        if (!dato) continue;
        const m = dato.slice(0, 7);
        maaned.set(m, (maaned.get(m) || 0) + 1);
    }

    const spillere = [...spillerKampe.entries()].map(([id, set]) => {
        const holdMap = spillerHold.get(id);
        const disc = spillerDiscipliner.get(id) || { single: 0, double: 0 };
        return {
            id,
            navn: navne.get(id) || id,
            kampe: set.size,
            antalHold: holdMap.size,
            single: disc.single,
            double: disc.double,
            hold: [...holdMap.entries()]
                .map(([navn, s]) => ({ navn, kampe: s.size }))
                .sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da'))
        };
    }).sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da'));

    const holdListe = [...holdMeta.entries()].map(([noegle, meta]) => ({
        noegle,
        hold: meta.hold,
        aargang: meta.aargang,
        raekker: [...meta.raekker],
        spillere: holdSpillere.get(noegle).size,
        kampe: holdKampe.get(noegle).size
    })).sort((a, b) => aargangOrden(a.aargang) - aargangOrden(b.aargang) || a.hold.localeCompare(b.hold, 'da'));

    const aargange = [...aargangKampe.keys()].map((a) => ({
        aargang: a,
        kampe: aargangKampe.get(a).size,
        spillere: aargangSpillere.get(a).size
    })).sort((a, b) => aargangOrden(a.aargang) - aargangOrden(b.aargang));

    const fordeling = {};
    for (const s of spillere) fordeling[s.antalHold] = (fordeling[s.antalHold] || 0) + 1;

    const perMaaned = [...maaned.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([m, n]) => ({ maaned: m, kampe: n }));

    const spilledeKampe = new Set(deltagelser.map((d) => d.kampnr)).size;

    return {
        klub: raw.klub,
        clubId: raw.clubId,
        season: raw.season,
        hentet: raw.hentet || null,
        noegletal: {
            spillere: spillere.length,
            hold: holdListe.length,
            kampeFundet: kampe.length,
            kampeMedHoldseddel: spilledeKampe,
            deltagelser: deltagelser.length,
            raekker: new Set(hold.map((h) => h.raekke)).size
        },
        spillere,
        hold: holdListe,
        aargange,
        holdFordeling: fordeling,
        perMaaned
    };
}

module.exports = { aggregate, holdNoegle, datoAf };
