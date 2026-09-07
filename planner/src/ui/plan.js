// Fane 2: Plan (design § 8). Gitter pr. dag med slots som rækker og kampe som
// kort, træk-og-slip mellem slots og til/fra "ikke placeret". Tegnes helt
// forfra ved hver ændring; UI-tilstanden (valgt dag, filter, søgning) ligger i
// app.js og gives med som `tilstand`.
import { esc, datoTekst } from './dom.js';
import { slotsForDag, banerISlot } from '../kapacitet.js';
import { alvorForKamp } from '../rules.js';
import { bedoemPlan } from '../scheduler.js';

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
        container.innerHTML = '<div class="panel"><h2>Plan</h2><p class="panel-sub">Åbn en .TP-fil under "Fil og opsætning" først.</p></div>';
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
        return `<div class="${klasser.join(' ')}" draggable="true" data-kamp="${esc(ids.join(','))}" style="--hue:${hueFor(projekt, k.kategori)}" title="${esc(titel)}${laast ? '\n🔒 Låst — dobbeltklik for at låse op' : ''}"><b>${esc(k.kategori)}${laast ? ' 🔒' : ''}</b><span>${esc(tekst)}</span></div>`;
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
        const problemer = tjek.prSlot.get(`${dag.dato}|${slot}`) || [];
        const fejl = problemer.some((p) => p.alvor === 'fejl');
        const klasse = brugt > baner ? 'er-over' : fejl ? 'er-fejl' : brugt === baner && baner ? 'er-fuld' : '';
        return `
        <tr class="slot ${klasse}" data-slot="${slot}">
            <th scope="row"><span class="tid">${slot}</span><span class="fyld">${brugt}/${baner}</span></th>
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
            ${tilstand.filter ? `<button class="knap knap--sekundaer" data-handling="laas-kategori" title="Lås alle placerede kampe i ${esc(tilstand.filter)}, så forslaget ikke flytter dem">Lås ${esc(tilstand.filter)}</button>
            <button class="knap knap--sekundaer" data-handling="laas-op-kategori">Lås op</button>` : ''}
            <button class="knap knap--sekundaer" data-handling="ryd-dag">Ryd dag</button>
            <button class="knap knap--sekundaer" data-handling="forslag-dag" title="Planlægger kun denne dag om; andre dage og låste kampe røres ikke">Forslag for dagen</button>
            <button class="knap" data-handling="forslag" title="Planlægger alle kampe forfra; låste kampe beholder deres tid">Lav forslag</button>
        </div>
    </div>
    <p class="plan-status">
        <span class="maerke ${antalFejl ? 'maerke--fejl' : 'maerke--ok'}">${antalFejl} fejl</span>
        <span class="maerke ${antalAdv ? 'maerke--advarsel' : ''}">${antalAdv} advarsler</span>
        ${laaste.size ? `<span class="maerke">🔒 ${laaste.size} låst</span>` : ''}
        <span class="daempet">${placeret.size} af ${projekt.kampe.length} kampe har tid · ${ikkePlacerede.length} mangler · haltid gns. ${statistik.haltidGnsMin} min pr. spiller pr. dag${Object.keys(statistik.slutPrDag).length ? ` · slut ${Object.entries(statistik.slutPrDag).map(([d, t]) => `${datoTekst(d, { kort: true })} ${t}`).join(', ')}` : ''}. Træk et kort til et slot, eller til listen til højre for at fjerne tiden. Klik viser spillerens andre kampe; dobbeltklik låser.</span>
    </p>
    ${tilstand.forslag ? `<p class="plan-status forslag-info">${esc(tilstand.forslag.tekst)}${tilstand.forslag.ikkePlaceret.length ? ` Ikke placeret: ${tilstand.forslag.ikkePlaceret.slice(0, 6).map((x) => `${esc(x.kategori)} ${esc(x.navn)} (${esc(x.aarsag)})`).join('; ')}${tilstand.forslag.ikkePlaceret.length > 6 ? ' …' : ''}` : ''}</p>` : ''}
    <div class="plan-layout">
        <div class="gitter-hylster">
            <table class="gitter">
                <tbody>${raekker}</tbody>
            </table>
        </div>
        <aside class="sidepanel">
            <section class="ikke-placeret" data-drop="fjern">
                <h3>Ikke placeret <span class="daempet">${ikkePlacerede.length}</span></h3>
                ${sidepanel || '<p class="daempet">Alle kampe har en tid.</p>'}
            </section>
            ${spillerPanel ? `<section class="spillerpanel"><h3>Spillere i den valgte kamp</h3>${spillerPanel}</section>` : ''}
        </aside>
    </div>`;

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
            else if (hd === 'forslag') h.lavForslag(false);
            else if (hd === 'forslag-dag') h.lavForslag(true);
            else if (hd === 'laas-kategori') h.laasKategori(true);
            else if (hd === 'laas-op-kategori') h.laasKategori(false);
            return;
        }
        const li = e.target.closest('li[data-kamp]');
        if (li) { h.visKamp(li.dataset.kamp); return; }
        const kort = e.target.closest('.kort[data-kamp]');
        if (kort) h.vaelgKamp(kort.dataset.kamp.split(',')[0]);
    });
    container.addEventListener('dblclick', (e) => {
        const kort = e.target.closest('.kort[data-kamp]');
        if (kort) { e.preventDefault(); h.laasKamp(kort.dataset.kamp); }
    });
    container.addEventListener('change', (e) => {
        if (e.target.dataset.felt === 'filter') h.filter(e.target.value);
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
