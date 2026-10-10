// Fane 2: Plan (design § 8). Gitter pr. dag med slots som rækker og kampe som
// kort, træk-og-slip mellem slots og til/fra "ikke placeret". Tegnes helt
// forfra ved hver ændring; UI-tilstanden (valgt dag, filter, søgning) ligger i
// app.js og gives med som `tilstand`.
import { esc, datoTekst } from './dom.js';
import { slotsForDag, banerISlot, puljeKapacitet } from '../kapacitet.js';
import { alvorForKamp } from '../rules.js';
import { bedoemPlan, loesningsforslag } from '../scheduler.js';
import { scorePlan } from '../kriterier.js';
import { renderTjek } from './tjek.js';

/** Panelet med forslag, der får kabalen til at gå op (nedskaering.js) — valget træffes på oplyst grundlag. */
function nedskaeringPanel(ned) {
    const tal = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
    const r = ned.regnskab;
    const regnskab = r ? `<p class="ned-regnskab">På de fælles baner kræver kampene <b>${tal(r.faelles.behov)} bane-slots</b>, og der er højst <b>${tal(r.faelles.plads)}</b> lovlige — i praksis kan ca. ${Math.round(r.fyldningsgrad * 100)} % (${tal(r.faelles.plads * r.fyldningsgrad)}) bruges, fordi pauser og runder giver huller.${r.reserveret.filter((x) => x.ubrugt >= 1).map((x) => ` <b>${esc(x.raekke)}</b> har reserveret ${tal(x.plads)} bane-slots, men bruger ${tal(x.behov)} — ${tal(x.ubrugt)} står ubrugt. Færre reserverede baner, et kortere tidsrum eller kun den dag, rækken spiller (under Turneringen), giver plads til de andre uden at skære i kampene.`).join('')}</p>` : '';
    if (!ned.liste.length) return `<div class="panel nedskaering"><h3>Forslag, der får kabalen til at gå op</h3>${regnskab}<p class="panel-sub">${esc(ned.besked || 'Planneren kan ikke selv skære ned her.')}</p><button class="knap knap--sekundaer" data-handling="ned-luk">Luk</button></div>`;
    const kort = ned.liste.map((f, i) => `
        <div class="ned-kort">
            <h4>${esc(f.navn)} <span class="maerke ${f.loest ? 'maerke--ok' : 'maerke--advarsel'}">${f.loest ? 'går op: 0 regelbrud' : `${f.brudEfter} regelbrud tilbage`}</span></h4>
            <p class="daempet">${esc(f.beskrivelse)}</p>
            <p><b>${f.kampeFoer} → ${f.kampeEfter} kampe</b> · regelbrud ${f.brudFoer} → ${f.brudEfter} · <span class="${f.spillereUnderKravEfter > f.spillereUnderKravFoer ? 'er-roed' : ''}">${f.spillereUnderKravEfter} spillere får færre kampe end reglementets minimum</span> (før: ${f.spillereUnderKravFoer})${f.raekkerToDage?.length ? ` · <b>${f.raekkerToDage.map(esc).join(', ')}</b> spiller over to dage (kræver dispensation)` : ''}</p>
            ${f.aendringer.length ? `<table class="ned-tabel"><thead><tr><th>Kategori</th><th>Runder</th><th>Kampe</th><th>Sikret pr. spiller</th><th>Krav</th><th>Under kravet</th></tr></thead><tbody>${f.aendringer.map((a) => `<tr><td>${esc(a.kategori)}</td><td>${a.fra === a.til ? `${a.fra} <span class="daempet">(uændret)</span>` : `${a.fra} → <b>${a.til}</b>`}</td><td>${a.kampeFoer} → ${a.kampeEfter}</td><td>${a.faerrestFoer} → ${a.faerrestEfter}</td><td>${a.krav}</td><td class="${a.underKravEfter ? 'er-roed' : ''}">${a.opTilEfter ? 'op til ' : ''}${a.underKravEfter} spillere${a.opTilEfter ? ' <span class="daempet">(oversiddere)</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="daempet">Ingen runder skæres.</p>'}
            <button class="knap" data-handling="ned-brug" data-index="${i}">Brug dette</button>
        </div>`).join('');
    return `<div class="panel nedskaering"><h3>Forslag, der får kabalen til at gå op</h3>
        <p class="panel-sub">Hvert forslag er afprøvet med planlæggeren. "Brug dette" sætter rundetallene på kategorierne (de kan ses og rettes under Turneringen), bygger kampene igen og lægger planen. Spillere under minimum vises bagefter som advarsler i Tjek, som du kan kvittere.</p>
        ${regnskab}${kort}
        <button class="knap knap--sekundaer" data-handling="ned-luk">Luk uden at ændre</button></div>`;
}

const udenPauseI = (p) => !p?.ABCD && !p?.M && !p?.E && !p?.faelles;
const kamplaengdeTekst = (min, udenPause) => `${min} min, ${udenPause ? 'pausen gives på dagen (0 min i planen)' : 'reglementets pause i planen'}`;

/**
 * Resultatet af "Lav kampprogram": går det op, hvad blev valgt for brugeren, og — hvis ikke — ét beslutningskort
 * pr. problem med løsninger, der allerede er afprøvet (kampprogram.js). Det anbefalede valg står først.
 */
function kampprogramPanel(kp, aabneKort) {
    const v = kp.valg;
    const gaarOp = kp.beslutninger.brud === 0;
    const beholdt = kp.beslutninger.kort.length - aabneKort.length;
    let valgTekst;
    if (v.grund === 'laast') valgTekst = `Kamplængden er ikke ændret (${kamplaengdeTekst(v.minutter, v.udenPause)}), fordi der er låste kampe.`;
    else if (v.grund === 'fast' || v.grund === 'tidligere') valgTekst = `Kamplængde: ${kamplaengdeTekst(v.minutter, v.udenPause)}.`;
    else if (v.aendret) valgTekst = `Valgt for dig ud fra sammenligningen af kamplængder: <b>${esc(kamplaengdeTekst(v.minutter, v.udenPause))}</b>. Husk at sætte den samme kamplængde i TP.`;
    else valgTekst = `Kamplængden passer allerede bedst: ${kamplaengdeTekst(v.minutter, v.udenPause)}.`;
    const tilbage = v.aendret && v.grund !== 'tidligere'
        ? ` <button class="knap knap--sekundaer knap--lille" data-handling="kp-tidligere">Brug ${esc(kamplaengdeTekst(v.foer.slotMin, udenPauseI(v.foer.pauseMin)))} som før</button>` : '';
    const kort = aabneKort.map((k) => {
        const i = kp.beslutninger.kort.indexOf(k);
        const valg = k.valg.map((x, j) => {
            const effekt = x.gaarOp ? '<span class="er-groen">går op</span>' : x.loest ? `løser dette — ${x.brudEfter} regelbrud andre steder` : `${x.brudEfter} regelbrud tilbage`;
            return `<label class="beslutning-valg"><input type="radio" name="kort-${i}" value="${j}" ${j === 0 ? 'checked' : ''}>
                <span><b>${esc(x.tekst)}</b>${j === 0 ? ' <span class="maerke maerke--ok">anbefalet</span>' : ''}${x.pris === 'dispensation' ? ' <span class="maerke maerke--advarsel">kræver dispensation</span>' : ''}
                <span class="daempet">— ${effekt}${x.konsekvens.length ? ` · ${esc(x.konsekvens.join(' · '))}` : ''}</span></span></label>`;
        }).join('');
        return `<div class="beslutning" data-kort="${i}">
            <h4>${esc(k.titel)}</h4>${k.flere?.length ? `<ul class="beslutning-flere">${k.flere.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
            ${k.valg.length ? '<p class="daempet">Hver løsning er afprøvet med planlæggeren.</p>' : '<p class="daempet">Planneren fandt ingen ændring af opsætningen, der hjælper her. Kampene ligger med regelbrud — se dem i Tjek.</p>'}
            <div class="beslutning-liste">${valg}
                <label class="beslutning-valg"><input type="radio" name="kort-${i}" value="behold" ${k.valg.length ? '' : 'checked'}>
                    <span><b>Behold</b> <span class="daempet">— ${k.antal} ${k.antal === 1 ? 'kamp' : 'kampe'} bryder reglen og vises som fejl/advarsel i Tjek</span></span></label>
            </div>
            <button class="knap ${k === aabneKort[0] ? '' : 'knap--sekundaer'}" data-handling="beslutning">${k.valg.length ? 'Brug valget og lav programmet igen' : 'OK'}</button>
        </div>`;
    }).join('');
    // Løseren har bevist, at der ingen lovlig plan er (kp.note), selv om planlæggeren ikke fandt noget at rette
    const loeserNej = !!kp.note && gaarOp;
    const titel = loeserNej ? 'Løseren fandt ingen plan, der overholder alle de hårde regler'
        : gaarOp ? 'Kampprogrammet går op' : aabneKort.length
            ? `Kampprogrammet går ikke helt op — ${aabneKort.length} ting at tage stilling til`
            : `Kampprogrammet er lavet med ${kp.beslutninger.brud} regelbrud, som du har valgt at beholde`;
    return `
    <section class="kampprogram ${loeserNej || aabneKort.length ? 'er-valg' : gaarOp ? 'er-ok' : ''}">
        <div class="kampprogram-hoved">
            <h3>${gaarOp && !loeserNej ? '<span class="er-groen">✓</span> ' : ''}${esc(titel)}</h3>
            <button class="knap knap--sekundaer knap--lille" data-handling="kp-fortryd" title="Går tilbage til planen og opsætningen fra før">Fortryd</button>
        </div>
        ${kp.note ? `<p class="kampprogram-valg">${esc(kp.note)}</p>` : ''}
        ${kp.handlinger?.length ? `<p class="diagnose-knapper">${kp.handlinger.map((x, i) => `<button class="knap knap--sekundaer knap--lille" data-handling="diagnose" data-index="${i}">${esc(x.tekst)}</button>`).join(' ')}</p>` : ''}
        <p class="kampprogram-valg">${valgTekst}${tilbage}</p>
        ${kp.udfoert.length ? `<p class="daempet">Gjort undervejs: ${esc(kp.udfoert.join(' · '))}.</p>` : ''}
        ${beholdt && aabneKort.length ? `<p class="daempet">${beholdt} beholdt som det er.</p>` : ''}
        ${kort}
    </section>`;
}

const OPTIMER_TIDER = [10, 30, 60, 120, 240, 360];
const FASE_KORT = { pulje: 'P', cup: '', swiss: 'R' };
const RUNDE_KORT = { 'Finale': 'Finale', 'Semifinale': 'Semi', 'Kvartfinale': 'Kvart', '1/8-finale': '1/8' };

/** Farvetone pr. kategori — fast ud fra kategoriens plads i listen. */
export function hueFor(projekt, kategoriId) {
    const i = projekt.kategorier.findIndex((k) => k.id === kategoriId);
    return Math.round(((i < 0 ? 0 : i) * 137.508) % 360);
}

/** Kort navn til kortet: "P1 #1–#2", "Semi: Pulje 1 #1 – …", "R2 k3". */
export function kortNavn(kamp) {
    if (kamp.fase === 'pulje') {
        const m = kamp.navn.match(/#(\d+) – #(\d+)$/);
        const gruppe = (kamp.gruppe || '').replace(/^Pulje\s*0*/i, 'P');
        return m ? `${gruppe} #${m[1]}–#${m[2]}` : kamp.navn;
    }
    if (kamp.fase === 'swiss') return kamp.spillere.length ? `R${kamp.runde} ${kamp.navn.replace(/^.*: /, '')}` : `R${kamp.runde} k${kamp.tpRef.swissKamp || ''}`;
    const r = RUNDE_KORT[kamp.rundeNavn] || kamp.rundeNavn || 'Cup';
    return `${r}${kamp.tpRef.matchnr ? ` #${kamp.tpRef.matchnr}` : ''}`;
}

function spillerTekst(projekt, id) {
    const s = projekt.spillere[id];
    return s ? `${s.fornavn} ${s.efternavn} (${s.klub})` : id;
}

function tooltip(projekt, tjek, kamp) {
    const linjer = [`${kamp.kategori} — ${kamp.navn}`];
    if (kamp.spillere.length) linjer.push(...kamp.spillere.map((s) => '• ' + spillerTekst(projekt, s)));
    else if (kamp.muligeSpillere.length) linjer.push(`Mulige spillere: ${kamp.muligeSpillere.length}`);
    for (const p of tjek.prKamp.get(kamp.id) || []) linjer.push(`${p.alvor === 'fejl' ? '✖' : p.alvor === 'advarsel' ? '▲' : 'ℹ'} ${p.tekst}`);
    return linjer.join('\n');
}

export function renderPlan(container, projekt, tjek, tilstand, handlers) {
    if (!projekt) {
        container.innerHTML = '<div class="panel"><h2>Program</h2><p class="panel-sub">Åbn en .TP-fil under trin 1 (Fil) først.</p></div>';
        return;
    }
    const dage = projekt.opsaetning.dage;
    const dag = dage.find((d) => d.dato === tilstand.dag) || dage[0];
    const slotMin = projekt.opsaetning.slotMin;
    const katMap = new Map(projekt.kategorier.map((k) => [k.id, k]));
    const soeg = (tilstand.soeg || '').trim().toLowerCase();
    const soegSpillere = new Set();
    if (soeg) for (const s of Object.values(projekt.spillere)) if (`${s.fornavn} ${s.efternavn} ${s.klub}`.toLowerCase().includes(soeg)) soegSpillere.add(s.id);
    const laaste = new Set(projekt.laast || []);
    const statistik = bedoemPlan(projekt);
    const score = scorePlan(projekt);
    const scoreTitel = score.dele.map((d) => `${d.navn}: ${d.vaerdi} ${d.enhed} × ${d.vaegt} = ${d.bidrag}`).join('\n');
    const valgt = projekt.kampe.find((k) => k.id === tilstand.valgtKamp);
    const valgtSpillere = new Set(valgt ? valgt.spillere : []);
    const fremhaev = new Set(tilstand.fremhaev || []);

    const passer = (k) => {
        if (tilstand.filter && k.kategori !== tilstand.filter) return false;
        if (soeg) {
            const kat = k.kategori.toLowerCase();
            if (!kat.includes(soeg) && !k.navn.toLowerCase().includes(soeg) && !k.spillere.some((s) => soegSpillere.has(s))) return false;
        }
        return true;
    };

    // Swiss Ladder-runder vises som én blok pr. runde i et slot (design § 7.2):
    // TP har én tid pr. runde, og blokken trækkes, låses og fjernes samlet.
    const kampMap = new Map(projekt.kampe.map((k) => [k.id, k]));
    const grupper = (kampe) => {
        const ud = [];
        const blokke = new Map();
        for (const k of kampe) {
            if (k.fase !== 'swiss') { ud.push({ k, ids: [k.id] }); continue; }
            const n = `${k.kategori}|${k.tpRef.draw}|${k.runde}`;
            if (!blokke.has(n)) { const g = { k, ids: [] }; blokke.set(n, g); ud.push(g); }
            blokke.get(n).ids.push(k.id);
        }
        return ud;
    };
    const rang = { fejl: 3, advarsel: 2, info: 1 };
    const kort = (k, ids = [k.id]) => {
        const kat = katMap.get(k.kategori);
        const blok = ids.length > 1 || k.fase === 'swiss';
        const alle = ids.map((id) => kampMap.get(id)).filter(Boolean);
        let alvor = null;
        for (const id of ids) { const a = alvorForKamp(tjek, id); if (a && (!alvor || rang[a] > rang[alvor])) alvor = a; }
        const klasser = ['kort'];
        if (kat?.halvBane && !blok) klasser.push('er-halv');
        if (blok) klasser.push('er-blok');
        if (alvor) klasser.push(`er-${alvor}`);
        if (!alle.some(passer)) klasser.push('er-daempet');
        if (ids.includes(tilstand.valgtKamp)) klasser.push('er-valgt');
        else if (valgtSpillere.size && alle.some((x) => x.spillere.some((s) => valgtSpillere.has(s)))) klasser.push('er-relateret');
        if (ids.some((id) => fremhaev.has(id))) klasser.push('er-fremhaevet');
        if (!k.spillere.length) klasser.push('er-ukendt');
        const laast = ids.every((id) => laaste.has(id));
        if (laast) klasser.push('er-laast');
        let titel, tekst;
        if (blok) {
            const kendte = alle.filter((x) => x.spillere.length);
            titel = [`${k.kategori} — Swiss Ladder runde ${k.runde}, ${ids.length} kampe i dette slot`,
                ...kendte.map((x) => '• ' + x.spillere.map((s) => spillerTekst(projekt, s)).join(' – ')),
                ...[...new Set(ids.flatMap((id) => (tjek.prKamp.get(id) || []).map((p) => `${p.alvor === 'fejl' ? '✖' : '▲'} ${p.tekst}`)))]].join('\n');
            tekst = `Runde ${k.runde} · ${ids.length} ${ids.length === 1 ? 'kamp' : 'kampe'}${kat?.halvBane ? ' · halve baner' : ''}`;
        } else {
            titel = tooltip(projekt, tjek, k);
            tekst = kortNavn(k);
        }
        return `<div class="${klasser.join(' ')}" draggable="true" tabindex="0" role="button" data-kamp="${esc(ids.join(','))}" style="--hue:${hueFor(projekt, k.kategori)}" title="${esc(titel)}${laast ? '\n🔒 Låst — dobbeltklik for at låse op' : ''}"><b>${esc(k.kategori)}${laast ? ' 🔒' : ''}</b><span>${esc(tekst)}</span></div>`;
    };

    // Kampe pr. slot på den valgte dag
    const prSlot = new Map();
    const placeret = new Set();
    for (const k of projekt.kampe) {
        const p = projekt.plan[k.id];
        if (!p) continue;
        placeret.add(k.id);
        if (p.dag !== dag.dato) continue;
        if (!prSlot.has(p.slot)) prSlot.set(p.slot, []);
        prSlot.get(p.slot).push(k);
    }
    const slots = slotsForDag(dag, slotMin);
    const ekstraSlots = [...prSlot.keys()].filter((s) => !slots.includes(s)).sort();
    const sortKampe = (liste) => liste.sort((a, b) => a.kategori.localeCompare(b.kategori, 'da') || (a.gruppe || '').localeCompare(b.gruppe || '', 'da') || a.runde - b.runde || a.id.localeCompare(b.id));

    const raekker = [...slots, ...ekstraSlots].map((slot) => {
        const kampe = sortKampe(prSlot.get(slot) || []);
        const halve = kampe.filter((k) => katMap.get(k.kategori)?.halvBane).length;
        const brugt = (kampe.length - halve) + Math.ceil(halve / 2);
        const baner = slots.includes(slot) ? banerISlot(dag, slot) : 0;
        const { reserveret } = slots.includes(slot) ? puljeKapacitet(dag, slot, projekt.raekker) : { reserveret: new Map() };
        // Reserverede puljer vises for sig: "U09 D 4/5"
        const puljeTekst = [...reserveret.entries()].map(([rid, b]) => {
            const egne = kampe.filter((k) => katMap.get(k.kategori)?.raekke === rid);
            const h = egne.filter((k) => katMap.get(k.kategori)?.halvBane).length;
            return `${esc(rid)} ${(egne.length - h) + Math.ceil(h / 2)}/${b}`;
        }).join(' · ');
        const problemer = tjek.prSlot.get(`${dag.dato}|${slot}`) || [];
        const fejl = problemer.some((p) => p.alvor === 'fejl');
        const klasse = brugt > baner ? 'er-over' : fejl ? 'er-fejl' : brugt === baner && baner ? 'er-fuld' : '';
        return `
        <tr class="slot ${klasse}" data-slot="${slot}">
            <th scope="row"><span class="tid">${slot}</span><span class="fyld">${brugt}/${baner}</span>${puljeTekst ? `<span class="fyld fyld--pulje">${puljeTekst}</span>` : ''}</th>
            <td class="celle" data-slot="${slot}" data-dag="${dag.dato}">${grupper(kampe).map(({ k, ids }) => kort(k, ids)).join('')}</td>
        </tr>`;
    }).join('');

    // Ikke placerede, grupperet pr. kategori
    const ikkePlacerede = projekt.kampe.filter((k) => !placeret.has(k.id));
    const prKat = new Map();
    for (const k of ikkePlacerede) { if (!prKat.has(k.kategori)) prKat.set(k.kategori, []); prKat.get(k.kategori).push(k); }
    const sidepanel = [...prKat.entries()].map(([kat, kampe]) => `
        <details open>
            <summary><span class="prik" style="--hue:${hueFor(projekt, kat)}"></span>${esc(kat)} <span class="daempet">${kampe.length}</span></summary>
            <div class="kortliste">${grupper(sortKampe(kampe)).map(({ k, ids }) => kort(k, ids)).join('')}</div>
        </details>`).join('');

    // Spillerpanel: den valgte kamps spillere med alle deres kampe og haltid
    let spillerPanel = '';
    if (valgt && valgt.spillere.length) {
        spillerPanel = valgt.spillere.map((s) => {
            const kampe = projekt.kampe.filter((k) => k.spillere.includes(s)).map((k) => ({ k, p: projekt.plan[k.id] }))
                .sort((a, b) => (a.p ? `${a.p.dag}T${a.p.slot}` : '~').localeCompare(b.p ? `${b.p.dag}T${b.p.slot}` : '~'));
            const prDag = new Map();
            for (const { p } of kampe) if (p) { if (!prDag.has(p.dag)) prDag.set(p.dag, []); prDag.get(p.dag).push(p.slot); }
            const haltid = [...prDag.entries()].map(([d, tider]) => `${datoTekst(d, { kort: true })}: ${tider[0]}–${plusMin(tider[tider.length - 1], slotMin)}`).join(', ');
            return `<div class="spiller">
                <h4>${esc(spillerTekst(projekt, s))}</h4>
                <p class="daempet">${kampe.length} kampe${haltid ? ` · i hallen ${esc(haltid)}` : ''}</p>
                <ul>${kampe.map(({ k, p }) => `<li data-kamp="${esc(k.id)}" class="${k.id === valgt.id ? 'er-valgt' : ''}">${p ? `${datoTekst(p.dag, { kort: true })} ${p.slot}` : '<em>ingen tid</em>'} · ${esc(k.kategori)} ${esc(kortNavn(k))}</li>`).join('')}</ul>
            </div>`;
        }).join('');
    }

    const antalFejl = tjek.antal.fejl, antalAdv = tjek.antal.advarsel;
    // Én primær (rød) handling ad gangen: uden plan er det "Lav forslag"; med en plan er det løseren, som er
    // anbefalet — den kører kun, når man trykker (Jesper 2026-10-09)
    const harPlan = placeret.size > 0;
    const problemer = tilstand.visning === 'problemer';
    // Panelet fra 'Lav kampprogram' vises for det projekt, det blev lavet til
    const kp = tilstand.kampprogram?.projekt === projekt ? tilstand.kampprogram : null;
    const aabneKort = kp ? kp.beslutninger.kort.filter((k) => !kp.beholdt.includes(k.noegle)) : [];
    const travl = !!tilstand.arbejder || !!tilstand.optimerer;
    const anbefalLoeser = harPlan && !travl && !tilstand.alternativer && !aabneKort.length && tilstand.forslag?.kilde !== 'loeser';
    const sek = tilstand.optimerSek || 60;
    const slut = Object.entries(statistik.slutPrDag);
    const statusTal = (vaerdi, etiket, klasse = '') => `<div class="status-tal ${klasse}"><b>${esc(String(vaerdi))}</b><span>${esc(etiket)}</span></div>`;
    container.innerHTML = `
    <div class="plan-hoved">
        <div class="dagfaner" role="tablist">
            ${dage.map((d) => `<button class="dagfane ${d.dato === dag.dato ? 'er-aktiv' : ''}" data-dag="${d.dato}">${datoTekst(d.dato)}</button>`).join('')}
        </div>
        <div class="raekke-knapper">
            <select data-felt="filter" aria-label="Filtrér kategori">
                <option value="">Alle kategorier</option>
                ${projekt.kategorier.map((k) => `<option value="${esc(k.id)}" ${tilstand.filter === k.id ? 'selected' : ''}>${esc(k.id)}</option>`).join('')}
            </select>
            <input type="search" data-felt="soeg" placeholder="Søg spiller, klub eller kamp" value="${esc(tilstand.soeg || '')}" aria-label="Søg">
            <button class="knap ${harPlan ? 'knap--sekundaer' : ''}" data-handling="kampprogram" ${travl ? 'disabled' : ''} title="Planneren vælger kamplængde og pause, bygger kampene, laver flere forslag og tager det bedste. Låste kampe beholder deres tid. Går programmet ikke op, får du valgmuligheder, der allerede er afprøvet.">${harPlan ? 'Lav kampprogram igen' : 'Lav kampprogram'}</button>
            <span class="optimer">
                <button class="knap ${harPlan ? '' : 'knap--sekundaer'}" data-handling="optimer" ${tilstand.optimerer ? 'disabled' : ''} title="Sender et anonymiseret planlægningsproblem (kun kamp-id'er og spillernumre) til løseren, som leder efter en bedre plan under alle hårde regler. Låste kampe beholder deres tid.">${tilstand.optimerer ? `${tilstand.optimerDiagnose ? 'Ingen lovlig plan — undersøger hvorfor …' : 'Løseren regner …'} <span data-optimer-ur></span>` : 'Forbedr med løseren'}</button>
                <select data-felt="optimerSek" aria-label="Tid til løseren" title="Hvor længe løseren må regne. Længere tid giver som regel en bedre plan.">
                    ${OPTIMER_TIDER.map((n) => `<option value="${n}" ${sek === n ? 'selected' : ''}>${n < 120 ? `${n} sek` : `${n / 60} min`}</option>`).join('')}
                </select>
                ${tilstand.optimerer ? `<button class="knap knap--sekundaer" data-handling="stopOptimer" ${tilstand.optimerStopper ? 'disabled' : ''} title="Løseren stopper nu og afleverer den bedste plan, den har fundet indtil nu.">${tilstand.optimerStopper ? 'Stopper …' : 'Stop og brug det bedste'}</button>` : ''}
            </span>
            <details class="menu">
                <summary class="knap knap--sekundaer">Mere</summary>
                <div class="menu-liste">
                    <button class="knap knap--sekundaer" data-handling="forslag" title="Planlægger alle kampe forfra på et øjeblik med den kamplængde og pause, der er sat — uden at prøve andre">Lav forslag med nuværende kamplængde</button>
                    <button class="knap knap--sekundaer" data-handling="forslag-dag" title="Planlægger kun denne dag om; andre dage og låste kampe røres ikke">Lav forslag kun for ${esc(datoTekst(dag.dato, { kort: true }))}</button>
                    <button class="knap knap--sekundaer" data-handling="alternativer" title="Laver op til 8 forskellige forslag med forskellige prioriteringer, som du kan bladre imellem">Andre forslag at vælge imellem</button>
                    ${tilstand.filter ? `<button class="knap knap--sekundaer" data-handling="laas-kategori" title="Lås alle placerede kampe i ${esc(tilstand.filter)}, så forslaget ikke flytter dem">Lås ${esc(tilstand.filter)}</button>
                    <button class="knap knap--sekundaer" data-handling="laas-op-kategori">Lås ${esc(tilstand.filter)} op</button>` : ''}
                    <button class="knap knap--sekundaer" data-handling="ryd-dag">Ryd ${esc(datoTekst(dag.dato, { kort: true }))}</button>
                </div>
            </details>
        </div>
    </div>
    ${tilstand.alternativer ? alternativBjaelke(tilstand.alternativer) : ''}
    ${tilstand.arbejder ? `<p class="arbejder" role="status"><span class="spinner" aria-hidden="true"></span>${esc(tilstand.arbejder)}</p>` : ''}
    ${kp ? kampprogramPanel(kp, aabneKort) : ''}
    <div class="status-linje">
        ${statusTal(`${placeret.size}/${projekt.kampe.length}`, 'kampe har tid', ikkePlacerede.length ? 'er-roed' : '')}
        ${statusTal(antalFejl, 'fejl', antalFejl ? 'er-roed' : 'er-ok')}
        ${statusTal(antalAdv, antalAdv === 1 ? 'advarsel' : 'advarsler', antalAdv ? 'er-gul' : '')}
        ${slut.length ? statusTal(slut.map(([, t]) => t).join(' · '), `slut ${slut.map(([d]) => datoTekst(d, { kort: true })).join(' · ')}`) : ''}
        ${harPlan ? statusTal(`${statistik.haltidGnsMin} min`, 'tid i hallen, gns.') : ''}
        ${harPlan ? statusTal(statistik.langeHuller, `venter over ${statistik.maxVentetidMin} min`, statistik.langeHuller ? 'er-gul' : '') : ''}
        ${laaste.size ? statusTal(laaste.size, laaste.size === 1 ? 'låst kamp' : 'låste kampe') : ''}
    </div>
    ${tilstand.fortryd?.efter === projekt ? `<p class="fortryd-bjaelke">${esc(tilstand.fortryd.tekst)} <button class="knap knap--sekundaer knap--lille" data-handling="fortryd">Fortryd</button></p>` : ''}
    ${anbefalLoeser ? `<p class="anbefaling"><b>Anbefalet:</b> tryk "Forbedr med løseren". Den regner i op til ${sek < 120 ? `${sek} sekunder` : `${sek / 60} minutter`} og finder som regel en plan med kortere ventetid og tid i hallen. Du vælger selv, om du vil bruge den.</p>` : ''}
    <div class="visning-skift" role="tablist" aria-label="Visning">
        <button role="tab" class="visning ${problemer ? '' : 'er-aktiv'}" data-visning="gitter" aria-selected="${!problemer}">Plan</button>
        <button role="tab" class="visning ${problemer ? 'er-aktiv' : ''}" data-visning="problemer" aria-selected="${problemer}">Problemer${antalFejl ? ` <span class="maerke maerke--fejl">${antalFejl} fejl</span>` : ''}${antalAdv ? ` <span class="maerke maerke--advarsel">${antalAdv}</span>` : ''}</button>
    </div>
    ${problemer ? '' : `<p class="plan-hjaelp daempet">Træk et kort til et slot — eller klik på kortet og derefter på et slot. Træk det til listen til højre for at fjerne tiden. Dobbeltklik låser. <span title="${esc('Vægtet sum af de bløde kriterier — lavere er bedre. Vægtene står under Avanceret i opsætningen.\n' + scoreTitel)}">Score ${score.total}.</span></p>`}
    ${tilstand.forslag && !kp ? `<p class="plan-status forslag-info">${esc(tilstand.forslag.tekst)}${tilstand.forslag.ikkePlaceret.length ? ` Berørte kampe: ${tilstand.forslag.ikkePlaceret.slice(0, 6).map((x) => `${esc(x.kategori)} ${esc(x.navn)} (${esc(x.brud || x.aarsag)})`).join('; ')}${tilstand.forslag.ikkePlaceret.length > 6 ? ' …' : ''}` : ''}</p>
    ${tilstand.forslag.handlinger?.length ? `<p class="diagnose-knapper">${tilstand.forslag.handlinger.map((x, i) => `<button class="knap knap--sekundaer" data-handling="diagnose" data-index="${i}">${esc(x.tekst)}</button>`).join(' ')}</p>` : ''}
    ${tilstand.forslag.ikkePlaceret.length ? `<ul class="loesninger">${loesningsforslag(projekt, tilstand.forslag.ikkePlaceret).map((f, i) => `<li><span>${esc(f.tekst)}</span>${f.handling ? ` <button class="knap knap--sekundaer knap--lille" data-handling="loesning" data-index="${i}">${esc(f.handling.tekst)} og lav forslag igen</button>` : ''}</li>`).join('')}</ul>
    ${tilstand.nedskaering ? '' : `<p><button class="knap knap--sekundaer" data-handling="ned-find" title="Afprøver færre Swiss Ladder-runder og spil over to dage med planlæggeren, og viser hvad hvert forslag koster i kampe pr. spiller. Intet ændres, før du vælger.">Prøv færre runder eller to dage</button></p>`}` : ''}` : ''}
    ${tilstand.nedskaering ? nedskaeringPanel(tilstand.nedskaering) : ''}
    ${problemer ? '<div class="tjek-indhold"></div>' : `<div class="plan-layout">
        <div class="gitter-hylster">
            <table class="gitter ${tilstand.valgtIds ? 'kan-flyttes' : ''}">
                <tbody>${raekker}</tbody>
            </table>
        </div>
        <aside class="sidepanel">
            <section class="ikke-placeret" data-drop="fjern">
                <h3>Ikke placeret <span class="daempet">${ikkePlacerede.length}</span></h3>
                ${sidepanel || '<p class="daempet">Alle kampe har en tid.</p>'}
            </section>
            ${valgt ? `<section class="spillerpanel"><h3>Den valgte kamp</h3>
                <p class="daempet">Klik på et slot i gitteret for at flytte kampen dertil.</p>
                <p class="raekke-knapper" style="margin:6px 0 4px"><button class="knap knap--sekundaer knap--lille" data-handling="fjern-valgte">Fjern tiden</button><button class="knap knap--sekundaer knap--lille" data-handling="fravaelg">Fravælg</button></p>
                ${spillerPanel}</section>` : ''}
        </aside>
    </div>`}`;
    if (problemer) renderTjek(container.querySelector('.tjek-indhold'), projekt, tjek, handlers.tjek);

    // Lytterne sættes én gang på beholderen (delegering), ikke ved hver gentegning.
    if (!container.dataset.bundet) {
        bind(container, handlers);
        container.dataset.bundet = '1';
    }
    if (tilstand.fremhaev?.length) {
        const el = container.querySelector(`[data-kamp="${CSS.escape(tilstand.fremhaev[0])}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
}

/** Bjælken til at bladre mellem alternative forslag (tilstand.alternativer = { liste, index, foer }). */
function alternativBjaelke(alt) {
    const a = alt.liste[alt.index];
    if (!a) return '';
    const s = a.statistik;
    const slut = Object.entries(s.slutPrDag).map(([d, t]) => `${datoTekst(d, { kort: true })} ${t}`).join(', ');
    return `
    <div class="alternativer">
        <button class="knap knap--sekundaer knap--lille" data-handling="alt-forrige" ${alt.index === 0 ? 'disabled' : ''} aria-label="Forrige forslag">◀</button>
        <div class="alternativ-tekst">
            <strong>Forslag ${alt.index + 1} af ${alt.liste.length}: ${esc(a.navn)}</strong>
            <span class="daempet">${esc(a.beskrivelse)}</span>
            <span>score <b>${a.score ?? '–'}</b> · haltid gns. <b>${s.haltidGnsMin} min</b> · ventetid gns. <b>${s.ventetidGnsMin} min</b> · <b class="${s.langeHuller ? 'er-roed' : ''}">${s.langeHuller} med hul over ${s.maxVentetidMin} min</b> · slut ${esc(slut)} · <b class="${(a.brud?.length || 0) + a.ikkePlaceret.length ? 'er-roed' : ''}">${(a.brud?.length || 0) + a.ikkePlaceret.length} med regelbrud</b>${alt.fejl != null ? ` · <b class="${alt.fejl ? 'er-roed' : ''}">${alt.fejl} fejl</b>, ${alt.advarsler} advarsler` : ''}</span>
        </div>
        <button class="knap knap--sekundaer knap--lille" data-handling="alt-naeste" ${alt.index >= alt.liste.length - 1 ? 'disabled' : ''} aria-label="Næste forslag">▶</button>
        <span class="raekke-knapper">
            <button class="knap knap--lille" data-handling="alt-brug">Brug dette</button>
            <button class="knap knap--sekundaer knap--lille" data-handling="alt-fortryd">Fortryd</button>
        </span>
    </div>`;
}

function plusMin(slot, min) {
    const [t, m] = slot.split(':').map(Number);
    const sum = t * 60 + m + min;
    return `${String(Math.floor(sum / 60)).padStart(2, '0')}:${String(sum % 60).padStart(2, '0')}`;
}

function bind(container, h) {
    container.addEventListener('click', (e) => {
        const dagKnap = e.target.closest('[data-dag]');
        if (dagKnap && dagKnap.classList.contains('dagfane')) { h.vaelgDag(dagKnap.dataset.dag); return; }
        const knap = e.target.closest('[data-handling]');
        if (knap) {
            const hd = knap.dataset.handling;
            if (hd === 'ryd-dag') h.rydDag();
            else if (hd === 'kampprogram') h.lavKampprogram();
            else if (hd === 'beslutning') {
                const kortEl = knap.closest('[data-kort]');
                const valgt = kortEl?.querySelector('input[type=radio]:checked')?.value;
                if (valgt === 'behold') h.beholdBeslutning(Number(kortEl.dataset.kort));
                else if (valgt != null) h.brugBeslutning(Number(kortEl.dataset.kort), Number(valgt));
            }
            else if (hd === 'kp-tidligere') h.brugTidligereKamplaengde();
            else if (hd === 'kp-fortryd') h.fortrydKampprogram();
            else if (hd === 'forslag') h.lavForslag(false);
            else if (hd === 'forslag-dag') h.lavForslag(true);
            else if (hd === 'laas-kategori') h.laasKategori(true);
            else if (hd === 'laas-op-kategori') h.laasKategori(false);
            else if (hd === 'alternativer') h.lavAlternativer();
            else if (hd === 'optimer') h.optimer();
            else if (hd === 'stopOptimer') h.stopOptimer();
            else if (hd === 'alt-forrige') h.bladreAlternativ(-1);
            else if (hd === 'alt-naeste') h.bladreAlternativ(1);
            else if (hd === 'alt-brug') h.brugAlternativ();
            else if (hd === 'alt-fortryd') h.fortrydAlternativ();
            else if (hd === 'diagnose') h.diagnoseHandling(Number(knap.dataset.index));
            else if (hd === 'loesning') h.brugLoesning(Number(knap.dataset.index));
            else if (hd === 'ned-find') h.findNedskaering();
            else if (hd === 'ned-brug') h.brugNedskaering(Number(knap.dataset.index));
            else if (hd === 'ned-luk') h.lukNedskaering();
            else if (hd === 'fortryd') h.fortryd();
            else if (hd === 'fjern-valgte') { const ids = h.valgteIds(); if (ids) { h.vaelgKamp(ids); h.fjern(ids); } }
            else if (hd === 'fravaelg') { const ids = h.valgteIds(); if (ids) h.vaelgKamp(ids); }
            return;
        }
        const vis = e.target.closest('[data-visning]');
        if (vis) { h.visning(vis.dataset.visning); return; }
        const li = e.target.closest('li[data-kamp]');
        if (li) { h.visKamp(li.dataset.kamp); return; }
        const kort = e.target.closest('.kort[data-kamp]');
        if (kort) { h.vaelgKamp(kort.dataset.kamp); return; }
        const celle = e.target.closest('.celle[data-slot]');
        if (celle && h.valgteIds()) h.flytValgte(celle.dataset.dag, celle.dataset.slot);
    });
    // Tastatur: Enter/mellemrum på et kort vælger det
    container.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const kort = e.target.closest?.('.kort[data-kamp]');
        if (kort) { e.preventDefault(); h.vaelgKamp(kort.dataset.kamp); }
    });
    container.addEventListener('dblclick', (e) => {
        const kort = e.target.closest('.kort[data-kamp]');
        if (kort) { e.preventDefault(); h.laasKamp(kort.dataset.kamp); }
    });
    container.addEventListener('change', (e) => {
        if (e.target.dataset.felt === 'filter') h.filter(e.target.value);
        else if (e.target.dataset.felt === 'optimerSek') h.optimerSek(Number(e.target.value) || 60);
    });
    container.addEventListener('input', (e) => {
        if (e.target.dataset.felt === 'soeg') h.soeg(e.target.value);
    });

    // Træk-og-slip
    container.addEventListener('dragstart', (e) => {
        const kort = e.target.closest?.('.kort[data-kamp]');
        if (!kort) return;
        e.dataTransfer.setData('text/plain', kort.dataset.kamp);
        e.dataTransfer.effectAllowed = 'move';
        kort.classList.add('er-traekket');
    });
    container.addEventListener('dragend', (e) => {
        e.target.closest?.('.kort')?.classList.remove('er-traekket');
        for (const el of container.querySelectorAll('.er-drop-over')) el.classList.remove('er-drop-over');
    });
    const maal = (e) => e.target.closest?.('.celle[data-slot], [data-drop="fjern"]');
    container.addEventListener('dragover', (e) => {
        const m = maal(e);
        if (!m) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        m.classList.add('er-drop-over');
    });
    container.addEventListener('dragleave', (e) => {
        const m = maal(e);
        if (m && !m.contains(e.relatedTarget)) m.classList.remove('er-drop-over');
    });
    container.addEventListener('drop', (e) => {
        const m = maal(e);
        if (!m) return;
        e.preventDefault();
        m.classList.remove('er-drop-over');
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        if (m.dataset.drop === 'fjern') h.fjern(id);
        else h.flyt(id, m.dataset.dag, m.dataset.slot);
    });
}
