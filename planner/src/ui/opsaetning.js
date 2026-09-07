// Fane 1: Fil og opsætning (design § 8). Tegner hele fanen som HTML ud fra
// projektet og sender ændringer tilbage gennem "handlers". Ingen tilstand her.
import { esc, datoTekst, procent, tal } from './dom.js';
import { kapacitetPrDag, kampePrKategori, slotsForDag, baneSlots } from '../kapacitet.js';

const FORM_TEKST = {
    'pulje': 'Pulje', 'pulje-cup': 'Pulje + cup', 'cup': 'Cup', 'dobbelt-pulje': 'Dobbelt pulje',
    'dobbelt-pulje-cup': 'Dobbelt pulje + cup', 'swiss': 'Swiss Ladder', 'ingen lodtrækning': 'Ingen lodtrækning',
};

export function renderOpsaetning(container, projekt, handlers) {
    container.innerHTML = [filPanel(projekt), ...(projekt ? [turneringPanel(projekt), dagePanel(projekt), raekkePanel(projekt), kapacitetPanel(projekt)] : [])].join('');
    bind(container, projekt, handlers);
}

// ── Paneler ───────────────────────────────────────────────────

function filPanel(projekt) {
    return `
    <section class="panel" id="filPanel">
        <div class="panel-hoved">
            <div>
                <h2>Fil</h2>
                <p class="panel-sub">Åbn en .TP-fil fra Tournament Planner, hvor tilmeldinger, par og lodtrækning er på plads. Du kan også åbne et gemt planner-projekt.</p>
            </div>
            ${projekt ? `<div class="raekke-knapper">
                <button class="knap knap--sekundaer" data-handling="gem-projekt">Gem projektfil</button>
                <button class="knap knap--sekundaer" data-handling="start-forfra">Start forfra</button>
            </div>` : ''}
        </div>
        <div class="filzone" id="filzone">
            <div class="knapper">
                <label class="knap">Åbn .TP-fil<input type="file" id="tpFil" accept=".tp,.TP,application/octet-stream" hidden></label>
                <label class="knap knap--sekundaer">Åbn projektfil<input type="file" id="projektFil" accept=".json,application/json" hidden></label>
            </div>
            <p>… eller træk filen herind. Filen læses i din browser og forlader ikke din computer.</p>
        </div>
        <p class="besked" id="filBesked"></p>
    </section>`;
}

function turneringPanel(p) {
    const antalSpillere = Object.keys(p.spillere).length;
    const medTid = Object.keys(p.plan).length;
    const bem = p.bemaerkninger || [];
    return `
    <section class="panel">
        <div class="panel-hoved">
            <div>
                <h2>${esc(p.turnering.navn || 'Turnering')}${p.turnering.hal ? ` <span class="daempet">· ${esc(p.turnering.hal)}</span>` : ''}</h2>
                <p class="panel-sub">${p.turnering.dage.map((d) => datoTekst(d)).join(' og ')} · fra <code>${esc(p.kilde.filnavn || 'ukendt fil')}</code>${p.kilde.tagTiderMed ? ' · TP’s tidsplan er taget med' : ' · startet med tomt gitter'}</p>
            </div>
        </div>
        <div class="noegletal">
            <div class="tal-kort"><div class="vaerdi">${p.kampe.length}</div><span class="etiket">Kampe</span></div>
            <div class="tal-kort"><div class="vaerdi">${p.kategorier.length}</div><span class="etiket">Kategorier</span></div>
            <div class="tal-kort"><div class="vaerdi">${antalSpillere}</div><span class="etiket">Spillere</span></div>
            <div class="tal-kort"><div class="vaerdi">${medTid}</div><span class="etiket">Kampe med tid</span></div>
            <div class="tal-kort"><div class="vaerdi">${p.tpGitter?.advarsler ?? 0}</div><span class="etiket">TP-advarsler i filen</span></div>
        </div>
        ${bem.length ? `<ul class="bemaerkninger">${bem.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    </section>`;
}

function dagePanel(p) {
    const { slotMin, pauseMin, dage } = p.opsaetning;
    const raekker = dage.map((d) => {
        const slots = slotsForDag(d, slotMin).length;
        const spaerringer = (d.spaerret || []).map((s, i) => `
            <span class="spaerring">${esc(s.fra)}–${esc(s.til)}: ${s.baner} ${s.baner === 1 ? 'bane' : 'baner'}
                <button type="button" title="Fjern spærring" data-handling="fjern-spaerring" data-dato="${d.dato}" data-index="${i}">✕</button></span>`).join('');
        return `
        <tr data-dato="${d.dato}">
            <td><strong>${datoTekst(d.dato)}</strong></td>
            <td><input type="time" step="300" value="${esc(d.start)}" data-felt="start" data-dato="${d.dato}" aria-label="Start"></td>
            <td><input type="time" step="300" value="${esc(d.slut)}" data-felt="slut" data-dato="${d.dato}" aria-label="Slut"></td>
            <td><input type="number" min="1" max="60" value="${d.baner}" data-felt="baner" data-dato="${d.dato}" aria-label="Baner"></td>
            <td class="tal">${slots}</td>
            <td class="tal">${baneSlots(d, slotMin)}</td>
            <td>${spaerringer}
                <span class="spaerring-ny">
                    <input type="time" step="300" data-ny="fra" data-dato="${d.dato}" aria-label="Spærret fra" placeholder="fra">
                    <input type="time" step="300" data-ny="til" data-dato="${d.dato}" aria-label="Spærret til">
                    <input type="number" min="1" max="60" value="1" data-ny="baner" data-dato="${d.dato}" aria-label="Antal baner">
                    <button type="button" class="knap knap--sekundaer knap--lille" data-handling="tilfoej-spaerring" data-dato="${d.dato}">Spær baner</button>
                </span>
            </td>
        </tr>`;
    }).join('');
    const pause = (klasse, tekst) => `
        <label class="felt"><span class="etiket">${tekst}</span>
            <input type="number" min="0" max="60" step="1" value="${pauseMin[klasse] ?? ''}" data-pause="${klasse}"> min</label>`;
    return `
    <section class="panel">
        <h2>Dage, tider og baner</h2>
        <p class="panel-sub">Tiderne fra TP-filens gitter er foreslået. Kapaciteten er antal hele baner pr. slot; spær baner i et tidsrum, hvis de ikke kan bruges.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Dag</th><th>Start</th><th>Slut</th><th>Baner</th><th class="tal">Slots</th><th class="tal">Bane-slots</th><th>Spærrede baner</th></tr></thead>
                <tbody>${raekker}</tbody>
            </table>
        </div>
        <div class="raekke-knapper" style="margin-top:18px; gap:22px">
            <label class="felt"><span class="etiket">Slotlængde</span>
                <input type="number" min="5" max="90" step="5" value="${slotMin}" data-felt="slotMin"> min</label>
            ${pause('ABCD', 'Pause A/B/C/D')}
            ${pause('M', 'Pause M')}
            ${pause('E', 'Pause E')}
            ${pause('faelles', 'Fælles pause (M + ABCD)')}
        </div>
        <p class="panel-sub">Reglementet: mindst 10 min pause i A–D-rækker, 15 i M, 20 i E, og 12 når M og A–D spilles i samme turnering. Kampen regnes til ét slot, så to kampe for samme spiller ligger mindst slot + pause fra hinanden.</p>
    </section>`;
}

function raekkePanel(p) {
    const prKat = kampePrKategori(p);
    const dage = p.turnering.dage;
    const rows = [];
    for (const r of p.raekker) {
        const dagValg = dage.map((d) => `
            <label class="valg"><input type="checkbox" data-raekke-dag="${d}" data-raekke="${esc(r.id)}" ${r.dage.includes(d) ? 'checked' : ''}> ${datoTekst(d, { kort: true })}</label>`).join('');
        const flereDage = r.dage.length > 1;
        const kraeverDisp = flereDage && (['B', 'C', 'D'].includes(r.raekke) || (r.aargang === 'U11' && r.raekke === 'A'));
        rows.push(`
        <tr class="raekke-hoved">
            <td colspan="2">${esc(r.id)} <span class="maerke">pause ${r.pauseKlasse}</span></td>
            <td colspan="5">${dagValg}
                ${kraeverDisp ? `<label class="valg"><input type="checkbox" data-disp="${esc(r.id)}" ${r.dispensationFlereDage ? 'checked' : ''}> dispensation til flere dage</label>
                ${r.dispensationFlereDage ? '<span class="maerke maerke--ok">dispensation givet</span>' : '<span class="maerke maerke--advarsel">kræver dispensation</span>'}` : ''}
                ${!r.dage.length ? '<span class="maerke maerke--fejl">ingen dag valgt</span>' : ''}
            </td>
        </tr>`);
        for (const katId of p.kategorier.filter((k) => k.raekke === r.id).map((k) => k.id)) {
            const k = p.kategorier.find((x) => x.id === katId);
            const t = prKat.get(k.id) || { pulje: 0, cup: 0, swiss: 0, ialt: 0, medTid: 0 };
            const fordeling = [t.pulje ? `${t.pulje} pulje` : '', t.cup ? `${t.cup} cup` : '', t.swiss ? `${t.swiss} Swiss` : ''].filter(Boolean).join(' + ');
            rows.push(`
            <tr>
                <td class="indrykket">${esc(k.id)}</td>
                <td>${esc(FORM_TEKST[k.form] || k.form)}${k.runder ? ` <span class="daempet">· ${k.runder} runder</span>` : ''}</td>
                <td class="tal">${k.tilmelde}</td>
                <td class="tal">${t.ialt}</td>
                <td class="daempet">${fordeling}</td>
                <td class="tal">${t.medTid}</td>
                <td>${k.type === 'single' ? `<label class="valg"><input type="checkbox" data-halv="${esc(k.id)}" ${k.halvBane ? 'checked' : ''}> halv bane</label>` : ''}</td>
            </tr>`);
        }
    }
    return `
    <section class="panel">
        <h2>Rækker og kategorier</h2>
        <p class="panel-sub">Vælg hvilke dage hver række spiller. Turneringsformen kommer fra TP og ændres der. U9-single spilles på halv bane; en hel bane deles i to og kan så ikke bruges til andre kampe i det slot.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Kategori</th><th>Form</th><th class="tal">Tilmeldte</th><th class="tal">Kampe</th><th>Fordeling</th><th class="tal">Med tid</th><th></th></tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>
        </div>
    </section>`;
}

function kapacitetPanel(p) {
    const k = kapacitetPrDag(p);
    const rows = k.dage.map((d) => {
        const u = d.udnyttelse;
        const klasse = u > 1 ? 'er-over' : u > 0.85 ? '' : 'er-ok';
        const maerke = u > 1 ? '<span class="maerke maerke--fejl">for mange kampe</span>' : u > 0.85 ? '<span class="maerke maerke--advarsel">tæt på</span>' : '<span class="maerke maerke--ok">plads</span>';
        return `
        <tr>
            <td><strong>${datoTekst(d.dato)}</strong></td>
            <td class="tal">${d.slots}</td>
            <td class="tal">${d.baneSlots}</td>
            <td class="tal">${tal(d.faste, d.faste % 1 ? 1 : 0)}</td>
            <td class="tal">${tal(d.fleksible, d.fleksible % 1 ? 1 : 0)}</td>
            <td class="tal">${tal(d.fordelt, 1)}</td>
            <td><div class="bar"><div class="bar-fill ${klasse}" style="width:${Math.min(100, Math.round((Number.isFinite(u) ? u : 1) * 100))}%"></div></div></td>
            <td class="tal">${procent(u)} ${maerke}</td>
            <td class="tal">${d.planlagte}</td>
        </tr>`;
    }).join('');
    return `
    <section class="panel">
        <h2>Kapacitet</h2>
        <p class="panel-sub">Bane-slots til rådighed mod de kampe, rækkernes dage lægger på dagen. "Faste" er kampe i rækker, der kun spiller den dag; "fleksible" spiller over flere dage og er delt ligeligt i "fordelt". U9-singler på halv bane tæller ½. Udnyttelse over ca. 85 % bliver svær at få til at gå op med pauser og rækkefølge.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Dag</th><th class="tal">Slots</th><th class="tal">Bane-slots</th><th class="tal">Faste</th><th class="tal">Fleksible</th><th class="tal">Fordelt</th><th>Udnyttelse</th><th class="tal"></th><th class="tal">Planlagte</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${k.udenDag ? `<p class="besked fejl">${k.udenDag} kampe hører til rækker uden valgt dag.</p>` : ''}
    </section>`;
}

// ── Hændelser ─────────────────────────────────────────────────

function bind(container, projekt, h) {
    const zone = container.querySelector('#filzone');
    const tpFil = container.querySelector('#tpFil');
    const projektFil = container.querySelector('#projektFil');
    tpFil?.addEventListener('change', () => { if (tpFil.files[0]) h.aabnTP(tpFil.files[0]); tpFil.value = ''; });
    projektFil?.addEventListener('change', () => { if (projektFil.files[0]) h.aabnProjekt(projektFil.files[0]); projektFil.value = ''; });
    if (zone) {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('er-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('er-over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('er-over');
            const fil = e.dataTransfer.files[0];
            if (!fil) return;
            if (/\.json$/i.test(fil.name)) h.aabnProjekt(fil); else h.aabnTP(fil);
        });
    }

    container.addEventListener('click', (e) => {
        const knap = e.target.closest('[data-handling]');
        if (!knap) return;
        const { handling, dato, index } = knap.dataset;
        if (handling === 'gem-projekt') h.gemProjekt();
        else if (handling === 'start-forfra') h.startForfra();
        else if (handling === 'fjern-spaerring') {
            const dag = projekt.opsaetning.dage.find((d) => d.dato === dato);
            h.dag(dato, { spaerret: dag.spaerret.filter((_, i) => i !== Number(index)) });
        } else if (handling === 'tilfoej-spaerring') {
            const felt = (navn) => container.querySelector(`[data-ny="${navn}"][data-dato="${dato}"]`);
            const fra = felt('fra').value, til = felt('til').value, baner = Number(felt('baner').value) || 1;
            if (!fra || !til || til <= fra) { h.besked('Angiv fra og til for spærringen (til skal være efter fra).', true); return; }
            const dag = projekt.opsaetning.dage.find((d) => d.dato === dato);
            h.dag(dato, { spaerret: [...(dag.spaerret || []), { fra, til, baner }].sort((a, b) => a.fra.localeCompare(b.fra)) });
        }
    });

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (!(el instanceof HTMLInputElement)) return;
        const d = el.dataset;
        if (d.felt === 'slotMin') h.slotMin(el.value);
        else if (d.felt && d.dato) {
            if (d.felt === 'baner') h.dag(d.dato, { baner: Math.max(1, Number(el.value) || 1) });
            else if (el.value) h.dag(d.dato, { [d.felt]: el.value });
        } else if (d.pause) h.pause(d.pause, el.value);
        else if (d.raekkeDag) {
            const r = projekt.raekker.find((x) => x.id === d.raekke);
            const dage = el.checked ? [...new Set([...r.dage, d.raekkeDag])].sort() : r.dage.filter((x) => x !== d.raekkeDag);
            h.raekke(d.raekke, { dage });
        } else if (d.disp) h.raekke(d.disp, { dispensationFlereDage: el.checked });
        else if (d.halv) h.kategori(d.halv, { halvBane: el.checked });
    });
}
