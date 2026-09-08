// Turneringsform (Jespers ønske 2026-09-08): planneren kan selv foreslå og
// bygge kampene for en kategori ud fra tilmeldingerne — pulje, pulje + cup
// eller Swiss Ladder — når kategorien ikke bruger TP's lodtrækning.
// Rene funktioner uden DOM. Kampene får samme form som fra tp-reader.js,
// så regler, planlægger og gitter virker uændret.
//
// Valg (aftalt med Jesper): cup for puljevinderne som standard (cupTop 1,
// valg pr. kategori: 1 eller 2), puljer á 3–5, Swiss Ladder 4–6 runder,
// kriterie "færrest bane-slots" (alternativ "flest kampe" op til 6),
// seedning efter ranglistepoint fra filen (ellers tilmeldingsrækkefølge).

export const FORM_VALG = ['tp', 'auto', 'pulje-cup', 'pulje', 'swiss'];
export const FORM_VALG_TEKST = { tp: 'fra TP', auto: 'automatisk', 'pulje-cup': 'pulje + cup', pulje: 'pulje', swiss: 'Swiss Ladder' };
export const PULJE_STOERRELSER = [3, 4, 5];
export const SWISS_RUNDER = [4, 5, 6];
export const MAAL_KAMPE = 6; // reglementets anbefaling ved 3 kategorier

/** Reglementets minimum kampe pr. spiller for kategorien (samme logik som rules.js). */
export function minKampeKrav(kategori, raekke, regler) {
    const ungdom = /^U/.test(raekke?.aargang || '');
    let krav = 0;
    if (ungdom && (raekke.raekke === 'M' || raekke.raekke === 'A')) krav = regler.minKampe.MA;
    else if (ungdom && ['B', 'C', 'D'].includes(raekke.raekke)) krav = kategori.type === 'single' ? regler.minKampe.BCDSingle : regler.minKampe.BCDDouble;
    if (ungdom && ['U09', 'U11'].includes(raekke.aargang) && kategori.type === 'single') krav = Math.max(krav, regler.minKampe.U9U11Single);
    return krav;
}

/** Fordeler n deltagere i q puljer så jævnt som muligt: [4,4,3]. */
export function puljeFordeling(n, stoerrelse) {
    const q = Math.max(1, Math.ceil(n / stoerrelse));
    const basis = Math.floor(n / q), rest = n % q;
    return Array.from({ length: q }, (_, i) => basis + (i < rest ? 1 : 0));
}

function cupKampe(deltagere) {
    return deltagere > 1 ? deltagere - 1 : 0;
}

/**
 * Alle mulige former for n deltagere med nøgletal:
 * { form, stoerrelse?, runder?, puljer: [..], kampe, baneSlots, minKampe, maxKampe, tekst }
 */
export function formMuligheder(n, { halvBane = false, cupTop = 1, minSwissRunder = 4 } = {}) {
    const ud = [];
    if (n < 2) return ud;
    const slots = (kampe) => (halvBane ? kampe / 2 : kampe);
    for (const s of PULJE_STOERRELSER) {
        if (n < 3) continue;
        const puljer = puljeFordeling(n, s);
        if (Math.min(...puljer) < 2) continue;
        const pk = puljer.reduce((sum, p) => sum + (p * (p - 1)) / 2, 0);
        const min = Math.min(...puljer) - 1;
        // ren pulje
        if (!ud.some((x) => x.form === 'pulje' && x.puljer.join() === puljer.join())) {
            ud.push({ form: 'pulje', stoerrelse: s, puljer, kampe: pk, baneSlots: slots(pk), minKampe: min, maxKampe: Math.max(...puljer) - 1,
                tekst: puljer.length === 1 ? `én pulje á ${n}` : `${puljer.length} puljer (${puljer.join(', ')})` });
        }
        // pulje + cup for de bedste
        if (puljer.length >= 2) {
            const videre = Math.min(puljer.length * cupTop, n);
            const ck = cupKampe(videre);
            const runder = Math.ceil(Math.log2(videre));
            ud.push({ form: 'pulje-cup', stoerrelse: s, puljer, cupTop, cupDeltagere: videre, cupRunder: runder, kampe: pk + ck, baneSlots: slots(pk + ck), minKampe: min, maxKampe: Math.max(...puljer) - 1 + runder,
                tekst: `${puljer.length} puljer (${puljer.join(', ')}) + cup for ${cupTop === 1 ? 'vinderne' : 'de to bedste'} (${videre} deltagere, ${runder} ${runder === 1 ? 'runde' : 'runder'})` });
        }
    }
    if (n === 2) ud.push({ form: 'pulje', stoerrelse: 2, puljer: [2], kampe: 1, baneSlots: slots(1), minKampe: 1, maxKampe: 1, tekst: 'én kamp' });
    if (n >= 4) {
        for (const r of SWISS_RUNDER) {
            if (r < minSwissRunder) continue;
            if (r > n - 1) continue;
            const prRunde = Math.floor(n / 2);
            const kampe = prRunde * r;
            ud.push({ form: 'swiss', runder: r, kampe, baneSlots: slots(kampe), minKampe: n % 2 ? r - 1 : r, maxKampe: r,
                tekst: `Swiss Ladder, ${r} runder á ${prRunde} kampe${n % 2 ? ' (én oversidder pr. runde)' : ''}` });
        }
    }
    return ud;
}

/**
 * Vælger form for kategorien.
 * valg.form: 'auto' | 'pulje-cup' | 'pulje' | 'swiss'; valg.kriterie: 'faerrest' | 'flest'.
 * Returnerer den valgte mulighed med { opfylderKrav, krav } — eller null hvis n < 2.
 */
export function foreslaaForm(n, kategori, raekke, regler, valg = {}) {
    const krav = minKampeKrav(kategori, raekke, regler);
    const alle = formMuligheder(n, { halvBane: !!kategori.halvBane, cupTop: valg.cupTop || 1, minSwissRunder: regler.minKampe.swissRunder });
    if (!alle.length) return null;
    const oenske = valg.form && valg.form !== 'auto' ? alle.filter((x) => x.form === valg.form) : alle;
    const kandidater = oenske.length ? oenske : alle;
    const opfylder = kandidater.filter((x) => x.minKampe >= krav);
    const formRang = { 'pulje-cup': 0, pulje: 1, swiss: 2 };
    let valgt;
    if (opfylder.length) {
        if (valg.kriterie === 'flest') {
            // flest kampe pr. spiller op til målet, dernæst færrest bane-slots
            opfylder.sort((a, b) => Math.min(b.minKampe, MAAL_KAMPE) - Math.min(a.minKampe, MAAL_KAMPE) || a.baneSlots - b.baneSlots || formRang[a.form] - formRang[b.form]);
        } else {
            opfylder.sort((a, b) => a.baneSlots - b.baneSlots || formRang[a.form] - formRang[b.form] || b.minKampe - a.minKampe);
        }
        valgt = opfylder[0];
    } else {
        // intet opfylder kravet: tag den der giver flest kampe til de færreste
        valgt = [...kandidater].sort((a, b) => b.minKampe - a.minKampe || a.baneSlots - b.baneSlots)[0];
    }
    return { ...valgt, krav, opfylderKrav: valgt.minKampe >= krav, deltagere: n };
}

// ── Bygning af kampe ──────────────────────────────────────────

/** Rundeplan for en pulje (cirkelmetoden): [[ [a,b], [c,d] ], ...] med positioner 1..s. */
export function puljeRunder(s) {
    const pos = Array.from({ length: s }, (_, i) => i + 1);
    if (s % 2) pos.push(0); // oversidder
    const m = pos.length;
    const runder = [];
    for (let r = 0; r < m - 1; r += 1) {
        const par = [];
        for (let i = 0; i < m / 2; i += 1) {
            const a = pos[i], b = pos[m - 1 - i];
            if (a && b) par.push(a < b ? [a, b] : [b, a]);
        }
        runder.push(par);
        pos.splice(1, 0, pos.pop());
    }
    return runder;
}

/** Slangeseedning: deltagere (sorteret bedst først) fordeles i puljer 1..q, q..1, 1..q … */
export function fordelIPuljer(deltagere, puljer) {
    const q = puljer.length;
    const ud = puljer.map(() => []);
    let i = 0, retning = 1, p = 0;
    while (i < deltagere.length) {
        if (ud[p].length < puljer[p]) { ud[p].push(deltagere[i]); i += 1; }
        p += retning;
        if (p >= q) { p = q - 1; retning = -1; } else if (p < 0) { p = 0; retning = 1; }
        // hvis alle resterende puljer er fulde i den retning, spring videre
        if (ud.every((x, j) => x.length >= puljer[j])) break;
    }
    return ud;
}

/**
 * Bygger kampene for en kategori ud fra tilmeldingerne.
 * @param {object} kategori    { id, halvBane, type, ... }
 * @param {Array}  tilmeldinger [{ spillere: [ids] }] i seedet rækkefølge (bedst først)
 * @param {object} form        fra foreslaaForm()
 * @returns kampe i planner-modellens form (id-præfiks "g:<kategori>:")
 */
export function byggKampe(kategori, tilmeldinger, form) {
    const praefiks = `g:${kategori.id}:`;
    const kampe = [];
    const navn = (t) => t.spillere.join('/');
    if (!form || tilmeldinger.length < 2) return kampe;
    if (form.form === 'swiss') {
        const n = tilmeldinger.length;
        const alle = tilmeldinger.flatMap((t) => t.spillere);
        const halv = Math.ceil(n / 2);
        const runde1 = [];
        for (let i = 0; i < Math.floor(n / 2); i += 1) {
            const a = tilmeldinger[i], b = tilmeldinger[i + halv];
            if (!a || !b) continue;
            runde1.push({ id: `${praefiks}r1:${i + 1}`, kategori: kategori.id, fase: 'swiss', gruppe: kategori.id, runde: 1,
                navn: `${kategori.id} runde 1: #${i + 1} – #${i + halv + 1}`, spillere: [...a.spillere, ...b.spillere], muligeSpillere: [...a.spillere, ...b.spillere],
                afhaengerAf: [], tpRef: { draw: praefiks + 'swiss', planning: null, van1: 0, van2: 0, matchnr: i + 1, swissRunde: 1, swissKamp: i + 1 }, tpTid: null, varighed: 0, genereret: true });
        }
        kampe.push(...runde1);
        let forrige = runde1.map((k) => k.id);
        for (let r = 2; r <= form.runder; r += 1) {
            const nye = [];
            for (let i = 1; i <= Math.floor(n / 2); i += 1) {
                nye.push({ id: `${praefiks}r${r}:${i}`, kategori: kategori.id, fase: 'swiss', gruppe: kategori.id, runde: r, navn: `${kategori.id} runde ${r}, kamp ${i}`,
                    spillere: [], muligeSpillere: alle, afhaengerAf: [...forrige], tpRef: { draw: praefiks + 'swiss', planning: null, van1: 0, van2: 0, matchnr: 0, swissRunde: r, swissKamp: i }, tpTid: null, varighed: 0, genereret: true });
            }
            kampe.push(...nye);
            forrige = nye.map((k) => k.id);
        }
        return kampe;
    }
    // Puljer
    const puljer = fordelIPuljer(tilmeldinger, form.puljer);
    const puljeKampeIds = [];
    let matchnr = 0;
    puljer.forEach((deltagere, pi) => {
        const gruppe = `Pulje ${pi + 1}`;
        const draw = `${praefiks}p${pi + 1}`;
        const ids = [];
        const prRunde = new Map();
        puljeRunder(deltagere.length).forEach((par, ri) => {
            for (const [a, b] of par) {
                matchnr += 1;
                const k = { id: `${draw}:${a * 1000 + b}`, kategori: kategori.id, fase: 'pulje', gruppe, runde: ri + 1, navn: `${gruppe} #${a} – #${b}`,
                    spillere: [...deltagere[a - 1].spillere, ...deltagere[b - 1].spillere], muligeSpillere: [...deltagere[a - 1].spillere, ...deltagere[b - 1].spillere],
                    afhaengerAf: [...(prRunde.get(ri) || [])], tpRef: { draw, planning: a * 1000 + b, van1: a * 1000, van2: b * 1000, matchnr }, tpTid: null, varighed: 0, genereret: true };
                kampe.push(k);
                ids.push(k.id);
                if (!prRunde.has(ri + 1)) prRunde.set(ri + 1, []);
                prRunde.get(ri + 1).push(k.id);
            }
        });
        puljeKampeIds.push(ids);
    });
    if (form.form !== 'pulje-cup' || !form.cupDeltagere || form.cupDeltagere < 2) return kampe;
    // Cup: deltagere = pulje 1 #1, pulje 2 #1, … (cupTop 2: derefter #2'erne), seedet 1 vs sidste
    const blade = [];
    for (let plads = 1; plads <= (form.cupTop || 1); plads += 1) {
        puljer.forEach((deltagere, pi) => { if (blade.length < form.cupDeltagere) blade.push({ navn: `Pulje ${pi + 1} #${plads}`, pulje: pi, mulige: deltagere.flatMap((t) => t.spillere) }); });
    }
    const stoerrelse = 2 ** Math.ceil(Math.log2(blade.length));
    // Standardseedning: 1 mod sidste, byes til de bedste
    const orden = seedOrden(stoerrelse);
    const noder = orden.map((seed) => (seed <= blade.length ? blade[seed - 1] : null));
    const draw = `${praefiks}cup`;
    let runde = 1;
    let aktuelle = noder.map((b) => (b ? { blad: b } : null));
    const rundeNavnFor = (r, total) => ['Finale', 'Semifinale', 'Kvartfinale', '1/8-finale'][total - r] || `${r}. runde`;
    const total = Math.log2(stoerrelse);
    let idx = 0;
    while (aktuelle.length > 1) {
        const naeste = [];
        for (let i = 0; i < aktuelle.length; i += 2) {
            const a = aktuelle[i], b = aktuelle[i + 1];
            if (!a || !b) { naeste.push(a || b); continue; } // bye
            idx += 1;
            const beskriv = (x) => (x.blad ? x.blad.navn : `Vinder kamp ${x.kamp.tpRef.matchnr}`);
            const mulige = [...new Set([...(a.blad ? a.blad.mulige : a.kamp.muligeSpillere), ...(b.blad ? b.blad.mulige : b.kamp.muligeSpillere)])];
            const deps = new Set();
            for (const x of [a, b]) { if (x.blad) for (const id of puljeKampeIds[x.blad.pulje]) deps.add(id); else deps.add(x.kamp.id); }
            matchnr += 1;
            const rn = rundeNavnFor(runde, total);
            const k = { id: `${draw}:${runde * 1000 + idx}`, kategori: kategori.id, fase: 'cup', gruppe: kategori.id, runde, rundeNavn: rn, navn: `${rn}: ${beskriv(a)} – ${beskriv(b)}`,
                spillere: [], muligeSpillere: mulige, afhaengerAf: [...deps], tpRef: { draw, planning: runde * 1000 + idx, van1: 0, van2: 0, matchnr }, tpTid: null, varighed: 0, genereret: true };
            kampe.push(k);
            naeste.push({ kamp: k });
        }
        aktuelle = naeste;
        runde += 1;
    }
    return kampe;
}

/** Seedningsrækkefølge i en cup af størrelse 2^k: [1,8,4,5,2,7,3,6] for 8. */
export function seedOrden(stoerrelse) {
    let o = [1];
    while (o.length < stoerrelse) {
        const n = o.length * 2 + 1;
        const ny = [];
        for (const s of o) ny.push(s, n - s);
        o = ny;
    }
    return o;
}

/** Sorterer tilmeldinger bedst først efter ranglistepoint i kategoriens kat (HS/DS/HD/DD/MD); ellers tilmeldingsrækkefølge. */
export function seedTilmeldinger(tilmeldinger, spillere, kat) {
    const noegle = kat === 'D' ? 'MD' : kat;
    const point = (t) => t.spillere.reduce((sum, id) => sum + (spillere[id]?.point?.[noegle] ?? spillere[id]?.point?.MD ?? 0), 0);
    return tilmeldinger.map((t, i) => ({ t, i, p: point(t) })).sort((a, b) => b.p - a.p || a.i - b.i).map((x) => x.t);
}

/** Kort beskrivelse af en valgt form til fane 1 og "opskriften" til TP. */
export function formTekst(form) {
    if (!form) return 'ingen kampe (under 2 tilmeldte)';
    return `${form.tekst} · ${form.kampe} kampe · ${form.minKampe}–${form.maxKampe} kampe pr. spiller${form.opfylderKrav ? '' : ` (under kravet på ${form.krav})`}`;
}
