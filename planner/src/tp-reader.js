// TP-læser: oversætter tabellerne i en Tournament Planner-fil (.TP, en
// Access/Jet-database) til planner-modellen fra docs/planner-design.md § 6.
//
// Modulet er en ren funktion uden DOM og uden kendskab til mdb-reader: det får
// et "tabeller"-objekt med hent(navn) → rækker, så det kan køre både i
// browseren (tp-bundle.js) og i Node-tests. Brug tabellerFraMDB() til at pakke
// en MDBReader ind.
//
// Vigtigt om datoer: Jet gemmer klokkeslæt uden tidszone, og mdb-reader
// leverer dem som UTC-Date med vægurets tid. Derfor læses ALT med getUTC*.

export const DRAWTYPE = { CUP: 1, PULJE: 2, DOBBELT_PULJE: 4, SWISS: 17 };

const NIVEAU_BOGSTAV = { 1: 'E', 2: 'M', 3: 'A', 4: 'B', 5: 'C', 6: 'D' };
const TP_TOM_DATO_AAR = 1900; // 1899-12-30 er Jets "ingen dato"

/** Pakker en MDBReader-instans ind i det tabel-interface, laesTP forventer. */
export function tabellerFraMDB(reader) {
    const navne = new Set(reader.getTableNames());
    return {
        har: (navn) => navne.has(navn),
        hent: (navn) => (navne.has(navn) ? reader.getTable(navn).getData() : []),
    };
}

// ── Små hjælpere ──────────────────────────────────────────────

function erGyldigDato(d) {
    return d instanceof Date && !Number.isNaN(d.getTime()) && d.getUTCFullYear() > TP_TOM_DATO_AAR;
}

function to(n) { return String(n).padStart(2, '0'); }

/** Date (UTC-vægur) → "ÅÅÅÅ-MM-DD" */
export function datoStr(d) {
    return `${d.getUTCFullYear()}-${to(d.getUTCMonth() + 1)}-${to(d.getUTCDate())}`;
}

/** Date (UTC-vægur) → "TT:MM" */
export function klokkeStr(d) {
    return `${to(d.getUTCHours())}:${to(d.getUTCMinutes())}`;
}

/** "TT:MM" → minutter siden midnat */
export function minutter(klokke) {
    const [t, m] = klokke.split(':').map(Number);
    return t * 60 + m;
}

/** minutter siden midnat → "TT:MM" */
export function klokkeFraMinutter(min) {
    return `${to(Math.floor(min / 60) % 24)}:${to(min % 60)}`;
}

function hyppigst(vaerdier, standard) {
    const taelling = new Map();
    for (const v of vaerdier) taelling.set(v, (taelling.get(v) || 0) + 1);
    let bedst = standard, bedstAntal = 0;
    for (const [v, n] of taelling) if (n > bedstAntal) { bedst = v; bedstAntal = n; }
    return bedst;
}

function aargangFraAlder(maxAlder) {
    if (maxAlder == null || maxAlder <= 0 || maxAlder >= 19) return 'SEN';
    // TP: U09 = max_age 8, U11 = 10, … (årgangen er alderen + 1, rundet op til ulige)
    let u = maxAlder + 1;
    if (u % 2 === 0) u += 1;
    return `U${to(u)}`;
}

/** "U11 B HS" → { aargang: 'U11', raekke: 'B', katNavn: 'HS' } (med fallback fra alder/niveau) */
export function tolkEventNavn(navn, { maxAlder, niveau } = {}) {
    const dele = String(navn || '').trim().split(/\s+/).filter(Boolean);
    if (dele.length >= 3 && /^U\d{1,2}$|^SEN$|^\+\d+$|^SEN\+?$/i.test(dele[0])) {
        return { aargang: dele[0].toUpperCase(), raekke: dele[1].toUpperCase(), katNavn: dele.slice(2).join(' ') };
    }
    return {
        aargang: aargangFraAlder(maxAlder),
        raekke: NIVEAU_BOGSTAV[niveau] || (dele[1] || '?').toUpperCase(),
        katNavn: dele.length ? dele[dele.length - 1] : '?',
    };
}

/** Rækkens pauseklasse efter reglementet (§ 4 stk. 5): E, M eller ABCD. */
export function pauseKlasse(raekke) {
    if (raekke === 'E') return 'E';
    if (raekke === 'M') return 'M';
    return 'ABCD';
}

function katFraEvent(ev, katNavn) {
    const dobbelt = ev.eventtype === 2;
    if (!dobbelt) return ev.gender === 2 ? 'DS' : 'HS';
    if (ev.gender === 1) return 'HD';
    if (ev.gender === 2) return 'DD';
    // gender 6 = "any gender" (U9-double, som TP kalder "D") eller mix
    return /^M/i.test(katNavn) ? 'MD' : katNavn || 'MD';
}

// ── Hovedfunktion ─────────────────────────────────────────────

/**
 * Læser en TP-fil til planner-modellen.
 * @param {{har(navn):boolean, hent(navn):object[]}} tabeller
 * @param {{filnavn?: string, nu?: Date}} [valg]
 */
export function laesTP(tabeller, valg = {}) {
    const bemaerkninger = [];
    const settings = new Map(tabeller.hent('Settings').map((s) => [s.name, s.value]));

    // ── Spillere og klubber ──
    const klubber = new Map(tabeller.hent('Club').map((c) => [c.id, c.name || '']));
    const niveauer = new Map();
    for (const n of tabeller.hent('PlayerlevelEntry')) {
        niveauer.set(n.playerid, { single: n.level1 ?? null, double: n.level2 ?? null, mix: n.level3 ?? null });
    }
    const spillere = {};
    const spillerNavn = new Map();
    for (const p of tabeller.hent('Player')) {
        const id = `p${p.id}`;
        const fornavn = (p.firstname || '').trim();
        const efternavn = (p.name || '').trim();
        spillere[id] = {
            id,
            fornavn,
            efternavn,
            koen: p.gender === 2 ? 'D' : 'H',
            foedt: erGyldigDato(p.dob) ? datoStr(p.dob) : null,
            klub: klubber.get(p.club) || '',
            memberid: p.memberid || null,
            niveau: niveauer.get(p.id) || { single: null, double: null, mix: null },
        };
        spillerNavn.set(id, `${fornavn} ${efternavn}`.trim());
    }

    // ── Tilmeldinger (entry → spillere) ──
    const entrySpillere = new Map();
    for (const e of tabeller.hent('Entry')) {
        const ids = [e.player1, e.player2].filter((x) => x != null && x !== 0).map((x) => `p${x}`).filter((id) => spillere[id]);
        entrySpillere.set(e.id, ids);
    }
    const entryNavn = (entryId) => (entrySpillere.get(entryId) || []).map((id) => spillerNavn.get(id)).join(' / ') || `Tilmelding ${entryId}`;

    // Ranglistepoint pr. spiller pr. kategori (RankingCategory: HS, DS, HD, DD, MD) — til seedning,
    // når planneren selv bygger puljer (form.js).
    const rankKat = new Map(tabeller.hent('RankingCategory').map((c) => [c.ID ?? c.id, c.name]));
    for (const r of tabeller.hent('RankingEntry')) {
        const s = spillere[`p${r.playerid}`];
        if (!s) continue;
        const navn = rankKat.get(r.rankingcategory) || `kat${r.rankingcategory}`;
        if (!s.point) s.point = {};
        if (r.points != null) s.point[navn] = r.points;
    }

    // ── Kategorier (Event) og rækker ──
    const events = tabeller.hent('Event');
    const kategorier = [];
    const kategoriPrEvent = new Map();
    const raekkeMap = new Map();
    for (const ev of events) {
        const { aargang, raekke, katNavn } = tolkEventNavn(ev.name, { maxAlder: ev.max_age, niveau: ev.level });
        const kat = katFraEvent(ev, katNavn);
        const raekkeId = `${aargang} ${raekke}`;
        const k = {
            id: ev.name,
            eventId: ev.id,
            raekke: raekkeId,
            aargang,
            kat,
            type: ev.eventtype === 2 ? 'double' : 'single',
            mix: kat === 'MD',
            form: 'ukendt',
            tilmeldte: 0,
            kampe: 0,
            runder: 0,
            halvBane: aargang === 'U09' && ev.eventtype !== 2,
        };
        kategorier.push(k);
        kategoriPrEvent.set(ev.id, k);
        if (!raekkeMap.has(raekkeId)) {
            raekkeMap.set(raekkeId, { id: raekkeId, aargang, raekke, pauseKlasse: pauseKlasse(raekke), kategorier: [] });
        }
        raekkeMap.get(raekkeId).kategorier.push(k.id);
    }
    // Tilmeldinger uden lodtrækning tælles direkte; ellers tælles positionerne
    // i lodtrækningen (reserver og udelukkede har ingen position), se nedenfor.
    const tilmeldingerUdenDraw = new Map();
    const tilmeldinger = {}; // kategoriId → [{ entry, spillere }] — alle gyldige tilmeldinger (til form.js)
    for (const e of tabeller.hent('Entry')) {
        const k = kategoriPrEvent.get(e.event);
        if (k && !e.exclude && (entrySpillere.get(e.id) || []).length) {
            tilmeldingerUdenDraw.set(k.id, (tilmeldingerUdenDraw.get(k.id) || 0) + 1);
            (tilmeldinger[k.id] = tilmeldinger[k.id] || []).push({ entry: e.id, spillere: entrySpillere.get(e.id) });
        }
    }

    // ── Lodtrækninger (Draw) og kampe (PlayerMatch) ──
    const draws = tabeller.hent('Draw');
    const links = new Map(tabeller.hent('Link').map((l) => [l.id, l]));
    const rowsPrDraw = new Map();
    for (const r of tabeller.hent('PlayerMatch')) {
        if (!rowsPrDraw.has(r.draw)) rowsPrDraw.set(r.draw, []);
        rowsPrDraw.get(r.draw).push(r);
    }

    const kampe = [];
    const kampePrDraw = new Map();       // drawId → [kamp-id]
    const drawtyperPrEvent = new Map();  // eventId → Set(drawtype)
    const tid = (r) => (erGyldigDato(r.plandate) ? { dag: datoStr(r.plandate), slot: klokkeStr(r.plandate) } : null);

    const tilfoej = (kamp) => {
        kampe.push(kamp);
        const liste = kampePrDraw.get(kamp.tpRef.draw) || [];
        liste.push(kamp.id);
        kampePrDraw.set(kamp.tpRef.draw, liste);
    };

    // Alle spillere der optræder i en lodtrækning (positioner med tilmelding,
    // eller — for cup — dem der kan komme ind via Link). Bruges til "mulige spillere".
    const spillereIDrawCache = new Map();
    const spillereIDraw = (drawId, set = new Set(), besoegt = new Set()) => {
        if (besoegt.has(drawId)) return set;
        besoegt.add(drawId);
        if (spillereIDrawCache.has(drawId)) { for (const s of spillereIDrawCache.get(drawId)) set.add(s); return set; }
        const egen = new Set();
        for (const r of rowsPrDraw.get(drawId) || []) {
            if (r.entry) for (const s of entrySpillere.get(r.entry) || []) egen.add(s);
            else if (r.link && links.has(r.link)) spillereIDraw(links.get(r.link).src_draw, egen, besoegt);
        }
        spillereIDrawCache.set(drawId, egen);
        for (const s of egen) set.add(s);
        return set;
    };

    // Puljer læses før cupper, så cup-afhængigheder kan pege på puljekampe.
    const ordnedeDraws = [...draws].sort((a, b) => (a.drawtype === DRAWTYPE.CUP) - (b.drawtype === DRAWTYPE.CUP) || a.id - b.id);

    for (const draw of ordnedeDraws) {
        const kategori = kategoriPrEvent.get(draw.event);
        if (!kategori) continue;
        const rows = rowsPrDraw.get(draw.id) || [];
        if (!drawtyperPrEvent.has(draw.event)) drawtyperPrEvent.set(draw.event, new Set());
        drawtyperPrEvent.get(draw.event).add(draw.drawtype);

        if (draw.drawtype === DRAWTYPE.PULJE || draw.drawtype === DRAWTYPE.DOBBELT_PULJE) {
            laesPulje(draw, rows, kategori, draw.drawtype === DRAWTYPE.DOBBELT_PULJE);
        } else if (draw.drawtype === DRAWTYPE.SWISS) {
            laesSwiss(draw, rows, kategori);
        } else if (draw.drawtype === DRAWTYPE.CUP) {
            laesCup(draw, rows, kategori);
        } else {
            bemaerkninger.push(`Ukendt lodtrækningstype ${draw.drawtype} i "${kategori.id} / ${draw.name}" — læst som pulje.`);
            laesPulje(draw, rows, kategori, true);
        }
    }

    function positioner(rows) {
        const pos = new Map(); // planning (pos*1000) → entry
        for (const r of rows) if (r.planning % 1000 === 0 && r.entry) pos.set(r.planning, r.entry);
        return pos;
    }

    function laesPulje(draw, rows, kategori, alleRaekkerErKampe) {
        const pos = positioner(rows);
        const set = new Set();
        const kampRows = rows
            .filter((r) => r.van1 && r.van2 && r.planning % 1000 !== 0)
            .sort((a, b) => a.planning - b.planning);
        const prRunde = new Map();
        const nye = [];
        for (const r of kampRows) {
            const a = Math.min(r.van1, r.van2), b = Math.max(r.van1, r.van2);
            if (!alleRaekkerErKampe) {
                const noegle = `${a}:${b}`;
                if (set.has(noegle)) continue; // spejlet række
                set.add(noegle);
            }
            const spillereA = entrySpillere.get(pos.get(r.van1)) || [];
            const spillereB = entrySpillere.get(pos.get(r.van2)) || [];
            const kamp = {
                id: `d${draw.id}:${r.planning}`,
                kategori: kategori.id,
                fase: 'pulje',
                gruppe: draw.name,
                runde: r.roundnr || 0,
                navn: `${draw.name} #${a / 1000} – #${b / 1000}`,
                spillere: [...spillereA, ...spillereB],
                muligeSpillere: [...spillereA, ...spillereB],
                afhaengerAf: [],
                tpRef: { draw: draw.id, planning: r.planning, van1: r.van1, van2: r.van2, matchnr: r.matchnr || 0 },
                tpTid: tid(r),
                varighed: r.duration || 0,
            };
            nye.push(kamp);
            if (!prRunde.has(kamp.runde)) prRunde.set(kamp.runde, []);
            prRunde.get(kamp.runde).push(kamp.id);
        }
        // Puljerunde r+1 efter runde r (design § 7.3 nr. 4)
        for (const kamp of nye) {
            const forrige = prRunde.get(kamp.runde - 1);
            if (forrige) kamp.afhaengerAf = [...forrige];
            tilfoej(kamp);
        }
    }

    function laesSwiss(draw, rows, kategori) {
        const pos = positioner(rows);
        const alle = [...new Set([...pos.values()].flatMap((e) => entrySpillere.get(e) || []))];
        const set = new Set();
        const runde1 = [];
        for (const r of rows.filter((r) => r.roundnr === 1 && r.van1 && r.van2).sort((a, b) => a.planning - b.planning)) {
            const a = Math.min(r.van1, r.van2), b = Math.max(r.van1, r.van2);
            const noegle = `${a}:${b}`;
            if (set.has(noegle)) continue;
            set.add(noegle);
            const spillereA = entrySpillere.get(pos.get(r.van1)) || [];
            const spillereB = entrySpillere.get(pos.get(r.van2)) || [];
            runde1.push({
                id: `d${draw.id}:${r.planning}`,
                kategori: kategori.id,
                fase: 'swiss',
                gruppe: draw.name,
                runde: 1,
                navn: `${kategori.id} runde 1: #${a / 1000} – #${b / 1000}`,
                spillere: [...spillereA, ...spillereB],
                muligeSpillere: [...spillereA, ...spillereB],
                afhaengerAf: [],
                tpRef: { draw: draw.id, planning: r.planning, van1: r.van1, van2: r.van2, matchnr: r.matchnr || 0 },
                tpTid: tid(r),
                varighed: r.duration || 0,
            });
        }
        const antalRunder = Math.max(draw.drawrounds || 0, ...rows.map((r) => r.roundnr || 0));
        const kampePrRunde = runde1.length || Math.floor(pos.size / 2);
        kategori.runder = antalRunder;
        let forrige = [];
        for (const k of runde1) tilfoej(k);
        forrige = runde1.map((k) => k.id);
        for (let runde = 2; runde <= antalRunder; runde += 1) {
            const rundeRow = rows.find((r) => r.roundnr === runde && r.planning % 1000 !== 0);
            const rundeTid = rundeRow ? tid(rundeRow) : null;
            const nye = [];
            for (let i = 1; i <= kampePrRunde; i += 1) {
                nye.push({
                    id: `d${draw.id}:r${runde}:${i}`,
                    kategori: kategori.id,
                    fase: 'swiss',
                    gruppe: draw.name,
                    runde,
                    navn: `${kategori.id} runde ${runde}, kamp ${i}`,
                    spillere: [],
                    muligeSpillere: alle,
                    afhaengerAf: [...forrige],
                    tpRef: { draw: draw.id, planning: null, van1: 0, van2: 0, matchnr: 0, swissRunde: runde, swissKamp: i },
                    tpTid: rundeTid,
                    varighed: 0,
                });
            }
            for (const k of nye) tilfoej(k);
            forrige = nye.map((k) => k.id);
        }
    }

    function laesCup(draw, rows, kategori) {
        const node = new Map(rows.map((r) => [r.planning, r]));
        const erBlad = (r) => !r.van1 && !r.van2;
        const erBye = (r) => erBlad(r) && !r.entry && !r.link;
        const kampNoder = rows.filter((r) => r.van1 && r.van2 && (r.roundnr || 0) >= 1);
        const antalRunder = Math.max(0, ...kampNoder.map((r) => r.roundnr));
        const rundeNavn = (r) => {
            const fraSlut = antalRunder - r;
            return ['Finale', 'Semifinale', 'Kvartfinale', '1/8-finale'][fraSlut] || `${r}. runde`;
        };
        const erRigtigKamp = new Map(); // planning → bool (ikke bye)
        const rigtig = (r) => {
            if (erRigtigKamp.has(r.planning)) return erRigtigKamp.get(r.planning);
            const b1 = node.get(r.van1), b2 = node.get(r.van2);
            const ok = !!(b1 && b2) && !erBye(b1) && !erBye(b2);
            erRigtigKamp.set(r.planning, ok);
            return ok;
        };
        const kampId = (r) => `d${draw.id}:${r.planning}`;

        // Beskrivelse, mulige spillere og afhængigheder for en node
        const beskriv = (r) => {
            if (erBlad(r)) {
                if (r.entry) return entryNavn(r.entry);
                if (r.link && links.has(r.link)) return links.get(r.link).name || `Link ${r.link}`;
                return 'Oversidder';
            }
            if (rigtig(r)) return `Vinder ${r.matchnr ? `kamp ${r.matchnr}` : rundeNavn(r.roundnr).toLowerCase()}`;
            // bye-kamp: vinderen er den der ikke er oversidder
            const b1 = node.get(r.van1), b2 = node.get(r.van2);
            return beskriv(b1 && !erBye(b1) ? b1 : b2);
        };
        const mulige = (r, set = new Set()) => {
            if (erBlad(r)) {
                if (r.entry) for (const s of entrySpillere.get(r.entry) || []) set.add(s);
                else if (r.link && links.has(r.link)) spillereIDraw(links.get(r.link).src_draw, set);
                return set;
            }
            for (const barn of [node.get(r.van1), node.get(r.van2)]) if (barn) mulige(barn, set);
            return set;
        };
        const afhaengigheder = (r, set = new Set()) => {
            if (erBlad(r)) {
                if (r.link && links.has(r.link)) for (const id of kampePrDraw.get(links.get(r.link).src_draw) || []) set.add(id);
                return set;
            }
            if (rigtig(r)) { set.add(kampId(r)); return set; }
            for (const barn of [node.get(r.van1), node.get(r.van2)]) if (barn) afhaengigheder(barn, set);
            return set;
        };

        for (const r of kampNoder.sort((a, b) => a.roundnr - b.roundnr || a.planning - b.planning)) {
            if (!rigtig(r)) continue;
            const b1 = node.get(r.van1), b2 = node.get(r.van2);
            const kendte = erBlad(b1) && erBlad(b2) && b1.entry && b2.entry
                ? [...(entrySpillere.get(b1.entry) || []), ...(entrySpillere.get(b2.entry) || [])]
                : [];
            const deps = new Set();
            afhaengigheder(b1, deps);
            afhaengigheder(b2, deps);
            tilfoej({
                id: kampId(r),
                kategori: kategori.id,
                fase: 'cup',
                gruppe: draw.name,
                runde: r.roundnr,
                rundeNavn: rundeNavn(r.roundnr),
                navn: `${rundeNavn(r.roundnr)}: ${beskriv(b1)} – ${beskriv(b2)}`,
                spillere: kendte,
                muligeSpillere: [...mulige(r)],
                afhaengerAf: [...deps],
                tpRef: { draw: draw.id, planning: r.planning, van1: r.van1, van2: r.van2, matchnr: r.matchnr || 0 },
                tpTid: tid(r),
                varighed: r.duration || 0,
            });
        }
    }

    // Tilmeldte pr. kategori: unikke tilmeldinger med en position i en lodtrækning
    const entriesPrEvent = new Map();
    for (const draw of draws) {
        for (const r of rowsPrDraw.get(draw.id) || []) {
            if (!r.entry || r.planning % 1000 !== 0) continue;
            if (!entriesPrEvent.has(draw.event)) entriesPrEvent.set(draw.event, new Set());
            entriesPrEvent.get(draw.event).add(r.entry);
        }
    }
    for (const k of kategorier) {
        k.tilmeldte = entriesPrEvent.has(k.eventId) ? entriesPrEvent.get(k.eventId).size : (tilmeldingerUdenDraw.get(k.id) || 0);
    }

    // Turneringsform og kampantal pr. kategori
    const FORM = {
        '2': 'pulje', '2,1': 'pulje-cup', '1': 'cup', '4': 'dobbelt-pulje', '4,1': 'dobbelt-pulje-cup', '17': 'swiss',
    };
    for (const k of kategorier) {
        const typer = [...(drawtyperPrEvent.get(k.eventId) || [])].sort((a, b) => (a === 1) - (b === 1) || a - b);
        k.form = typer.length ? (FORM[typer.join(',')] || `type ${typer.join('+')}`) : 'ingen lodtrækning';
        k.kampe = kampe.filter((m) => m.kategori === k.id).length;
    }

    // ── TP's gitter: dage, tider, baner ──
    const courts = tabeller.hent('Court');
    const halve = courts.filter((c) => /½|1\/2/.test(c.name || '')).length;
    const hele = courts.length - halve;

    const tiderPrDag = new Map();
    for (const t of tabeller.hent('TournamentTime')) {
        if (!erGyldigDato(t.tournamentday) || !(t.tournamenttime instanceof Date)) continue;
        const min = t.tournamenttime.getUTCHours() * 60 + t.tournamenttime.getUTCMinutes();
        if (min === 0) continue; // TP fylder op med tomme 00:00-rækker
        const dag = datoStr(t.tournamentday);
        if (!tiderPrDag.has(dag)) tiderPrDag.set(dag, []);
        tiderPrDag.get(dag).push({ min, baner: t.courts || 0 });
    }
    const dage = tabeller.hent('TournamentDay').filter((d) => erGyldigDato(d.tournamentday)).map((d) => datoStr(d.tournamentday));
    for (const dag of tiderPrDag.keys()) if (!dage.includes(dag)) dage.push(dag);
    dage.sort();

    const alleDiff = [];
    for (const tider of tiderPrDag.values()) {
        tider.sort((a, b) => a.min - b.min);
        for (let i = 1; i < tider.length; i += 1) alleDiff.push(tider[i].min - tider[i - 1].min);
    }
    const slotMin = hyppigst(alleDiff.filter((d) => d > 0), 30);
    const gitterDage = dage.map((dag) => {
        const tider = tiderPrDag.get(dag);
        if (!tider || !tider.length) return { dato: dag, start: null, slut: null, baner: null, ekstra: null };
        const baner = hyppigst(tider.map((t) => t.baner), hele);
        // Tidsrum hvor TP har flere baner end normalt (fx U9-vinduet med halve baner)
        const med = tider.filter((t) => t.baner > baner);
        const ekstra = med.length
            ? { fra: klokkeFraMinutter(med[0].min), til: klokkeFraMinutter(med[med.length - 1].min + slotMin), baner: Math.max(...med.map((t) => t.baner)) - baner }
            : null;
        return {
            dato: dag,
            start: klokkeFraMinutter(tider[0].min),
            slut: klokkeFraMinutter(tider[tider.length - 1].min + slotMin),
            baner,
            ekstra,
        };
    });

    const raekker = [...raekkeMap.values()].sort((a, b) => a.id.localeCompare(b.id, 'da'));
    const nu = valg.nu || new Date();

    return {
        version: 1,
        kilde: { filnavn: valg.filnavn || null, laestUtc: nu.toISOString(), tpVersion: settings.get('Version') || null },
        turnering: {
            navn: settings.get('Tournament') || '',
            hal: settings.get('Location') || '',
            dage,
        },
        tpGitter: {
            slotMin,
            dage: gitterDage,
            baner: { hele, halve, navne: courts.map((c) => c.name) },
            harTider: kampe.some((k) => k.tpTid),
            advarsler: tabeller.har('MatchWarning') ? tabeller.hent('MatchWarning').length : 0,
        },
        raekker,
        kategorier,
        spillere,
        kampe,
        tilmeldinger,
        bemaerkninger,
    };
}

/** Planen som TP-filen har den: kamp-id → { dag, slot } for kampe med tid. */
export function planFraTP(model) {
    const plan = {};
    for (const k of model.kampe) if (k.tpTid) plan[k.id] = { ...k.tpTid };
    return plan;
}
