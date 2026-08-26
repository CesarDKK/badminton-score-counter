/**
 * Regner rådata om til det som siden viser.
 *
 * En "kamp" er en holdkamp. En spiller tælles én gang pr. holdkamp, også hvis
 * vedkommende spillede både single og double i den — det er sådan man taler om
 * det i klubben ("han har spillet 12 kampe for 3. holdet").
 *
 * Sejre tælles derimod pr. disciplin, for det er der de bliver vundet.
 */

const { AARGANG_ORDEN } = require('./harvest');

/**
 * Holdnavn alene er tvetydigt: "Lyngby 1" findes i både SEN+40, SEN+50 og SEN+60.
 * Vi nøgler derfor altid på årgang + holdnavn.
 */
const holdNoegle = (d) => `${d.aargang} ${d.hold}`;

/**
 * Disciplinkoden står efter nummeret: "1. HS" → HS.
 *   S, HS, DS  → single      (S bruges i ungdomsrækker uden kønsopdeling)
 *   D, HD, DD  → double
 *   MD         → mix
 */
function disciplinType(disciplin) {
    const m = /^\d+\.\s*([A-ZÆØÅ]+)/i.exec(String(disciplin || ''));
    const kode = m ? m[1].toUpperCase() : '';
    if (kode === 'MD') return 'mix';
    if (kode === 'S' || kode === 'HS' || kode === 'DS') return 'single';
    if (kode === 'D' || kode === 'HD' || kode === 'DD') return 'double';
    return 'double';
}

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

const nyTaeller = () => ({ single: 0, double: 0, mix: 0, vundet: 0, tabt: 0, uafgjort: 0 });

function aggregate(raw) {
    const { deltagelser = [], kampe = [], hold = [] } = raw;

    const navne = new Map();
    const spillerKampe = new Map();     // spillerId -> Set(kampnr)
    const spillerHold = new Map();      // spillerId -> Map(holdnøgle -> Set(kampnr))
    const taellere = new Map();         // spillerId -> nyTaeller()
    const makkere = new Map();          // spillerId -> Map(makkerId -> {kampe, vundet})
    const holdSpillere = new Map();
    const holdKampe = new Map();
    const holdMeta = new Map();
    const aargangKampe = new Map();
    const aargangSpillere = new Map();
    const maaned = new Map();

    // Til makkerparrene: hvem stod sammen i samme disciplin i samme holdkamp.
    const disciplinHold = new Map();    // "kampnr|disciplin" -> [deltagelse]

    for (const d of deltagelser) {
        const hk = holdNoegle(d);
        navne.set(d.spillerId, bedsteNavn(navne.get(d.spillerId), d.navn));

        if (!spillerKampe.has(d.spillerId)) spillerKampe.set(d.spillerId, new Set());
        spillerKampe.get(d.spillerId).add(d.kampnr);

        if (!spillerHold.has(d.spillerId)) spillerHold.set(d.spillerId, new Map());
        const hm = spillerHold.get(d.spillerId);
        if (!hm.has(hk)) hm.set(hk, new Set());
        hm.get(hk).add(d.kampnr);

        if (!taellere.has(d.spillerId)) taellere.set(d.spillerId, nyTaeller());
        const t = taellere.get(d.spillerId);
        t[disciplinType(d.disciplin)]++;
        if (d.vundet === true) t.vundet++;
        else if (d.vundet === false) t.tabt++;
        else t.uafgjort++;

        // Siden med i nøglen: i en intern klubkamp spiller BEGGE hold samme
        // disciplin (fx "1. HD"), og uden siden ville de fire spillere havne i
        // samme "par" og ødelægge makker-optællingen.
        const dk = `${d.kampnr}|${d.disciplin}|${d.side || ''}`;
        if (!disciplinHold.has(dk)) disciplinHold.set(dk, []);
        disciplinHold.get(dk).push(d);

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

    // Makkerpar — to spillere i samme disciplin i samme holdkamp
    for (const par of disciplinHold.values()) {
        if (par.length !== 2) continue;
        const [a, b] = par;
        if (a.spillerId === b.spillerId) continue;
        for (const [x, y] of [[a, b], [b, a]]) {
            if (!makkere.has(x.spillerId)) makkere.set(x.spillerId, new Map());
            const m = makkere.get(x.spillerId);
            if (!m.has(y.spillerId)) m.set(y.spillerId, { kampe: 0, vundet: 0 });
            const post = m.get(y.spillerId);
            post.kampe++;
            if (x.vundet === true) post.vundet++;
        }
    }

    for (const k of kampe) {
        const dato = datoAf(k.tid);
        if (!dato) continue;
        const m = dato.slice(0, 7);
        maaned.set(m, (maaned.get(m) || 0) + 1);
    }

    const spillere = [...spillerKampe.entries()].map(([id, set]) => {
        const holdMap = spillerHold.get(id);
        const t = taellere.get(id) || nyTaeller();
        const afgjorte = t.vundet + t.tabt;
        const mk = makkere.get(id) || new Map();
        return {
            id,
            navn: navne.get(id) || id,
            kampe: set.size,
            antalHold: holdMap.size,
            single: t.single,
            double: t.double,
            mix: t.mix,
            vundet: t.vundet,
            tabt: t.tabt,
            uafgjort: t.uafgjort,
            sejrspct: afgjorte ? Math.round((t.vundet / afgjorte) * 100) : null,
            hold: [...holdMap.entries()]
                .map(([navn, s]) => ({ navn, kampe: s.size }))
                .sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da')),
            makkere: [...mk.entries()]
                .map(([mid, v]) => ({ id: mid, navn: navne.get(mid) || mid, kampe: v.kampe, vundet: v.vundet }))
                .sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da'))
                .slice(0, 12)
        };
    }).sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da'));

    // Placeringer pr. hold — et hold kan optræde i både pulje og slutspil
    const placeringer = new Map();
    for (const h of hold) {
        if (!h.placering) continue;
        const noegle = `${h.aargang} ${h.navn}`;
        if (!placeringer.has(noegle)) placeringer.set(noegle, []);
        placeringer.get(noegle).push({
            raekke: h.raekke,
            plads: h.placering.plads,
            antalHold: h.placering.antalHold,
            kampe: h.placering.kampe,
            vundne: h.placering.vundne,
            point: h.placering.point
        });
    }

    const holdListe = [...holdMeta.entries()].map(([noegle, meta]) => ({
        noegle,
        hold: meta.hold,
        aargang: meta.aargang,
        raekker: [...meta.raekker],
        spillere: holdSpillere.get(noegle).size,
        kampe: holdKampe.get(noegle).size,
        placeringer: placeringer.get(noegle) || []
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

    // Single / double / mix — spillet og vundet, til grafen
    const perType = { single: { spillet: 0, vundet: 0, tabt: 0 }, double: { spillet: 0, vundet: 0, tabt: 0 }, mix: { spillet: 0, vundet: 0, tabt: 0 } };
    for (const d of deltagelser) {
        const t = perType[disciplinType(d.disciplin)];
        t.spillet++;
        if (d.vundet === true) t.vundet++;
        else if (d.vundet === false) t.tabt++;
    }
    const disciplinFordeling = Object.entries(perType).map(([type, v]) => ({ type, ...v }));

    const spilledeKampe = new Set(deltagelser.map((d) => d.kampnr)).size;
    const iAlt = spillere.reduce((a, s) => ({ vundet: a.vundet + s.vundet, tabt: a.tabt + s.tabt }), { vundet: 0, tabt: 0 });

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
            raekker: new Set(hold.map((h) => h.raekke)).size,
            discipliner: iAlt.vundet + iAlt.tabt,
            vundet: iAlt.vundet,
            sejrspct: (iAlt.vundet + iAlt.tabt) ? Math.round((iAlt.vundet / (iAlt.vundet + iAlt.tabt)) * 100) : null
        },
        spillere,
        hold: holdListe,
        aargange,
        holdFordeling: fordeling,
        disciplinFordeling,
        perMaaned
    };
}

module.exports = { aggregate, holdNoegle, datoAf, disciplinType };
