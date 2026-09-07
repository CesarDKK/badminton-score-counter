// Fane 4: Liste (design § 8) — planen pr. kategori i TP's rækkefølge, klar til
// at taste ind i Tournament Planner. byggListe er en ren funktion (testes i
// Node); renderListe tegner den med udskrift og kopiering.
import { esc, datoTekst } from './dom.js';

const RUNDE_ORDEN = { '1/8-finale': 1, 'Kvartfinale': 2, 'Semifinale': 3, 'Finale': 4 };

function tidTekst(p) {
    return p ? `${datoTekst(p.dag, { kort: true })} ${p.slot}` : '— ingen tid —';
}

/**
 * Listen til indtastning: pr. kategori → grupper (pulje / cup-runde / Swiss-runde)
 * → linjer med kampens navn i TP, dag og klokkeslæt.
 * Swiss Ladder-runder får én linje pr. runde med rundens første slot (TP har
 * én tid pr. runde) og en bemærkning, hvis runden spænder over flere slots.
 */
export function byggListe(projekt) {
    const liste = [];
    for (const kat of projekt.kategorier) {
        const kampe = projekt.kampe.filter((k) => k.kategori === kat.id);
        if (!kampe.length) continue;
        const grupper = [];
        const prGruppe = new Map();
        const nøgleFor = (k) => (k.fase === 'cup' ? `cup|${k.runde}` : k.fase === 'swiss' ? `swiss|${k.runde}` : `pulje|${k.gruppe}`);
        for (const k of kampe) {
            const n = nøgleFor(k);
            if (!prGruppe.has(n)) prGruppe.set(n, []);
            prGruppe.get(n).push(k);
        }
        const sorteret = [...prGruppe.entries()].sort(([a, ka], [b, kb]) => {
            const fa = a.split('|')[0], fb = b.split('|')[0];
            const orden = { pulje: 0, swiss: 1, cup: 2 };
            if (orden[fa] !== orden[fb]) return orden[fa] - orden[fb];
            if (fa === 'pulje') return (ka[0].gruppe || '').localeCompare(kb[0].gruppe || '', 'da', { numeric: true });
            return (ka[0].runde || 0) - (kb[0].runde || 0);
        });
        for (const [n, gk] of sorteret) {
            const fase = n.split('|')[0];
            if (fase === 'swiss') {
                const tider = gk.map((k) => projekt.plan[k.id]).filter(Boolean).sort((a, b) => `${a.dag}T${a.slot}`.localeCompare(`${b.dag}T${b.slot}`));
                const foerste = tider[0] || null;
                const sidste = tider[tider.length - 1] || null;
                const flereSlots = foerste && sidste && (foerste.dag !== sidste.dag || foerste.slot !== sidste.slot);
                grupper.push({
                    navn: `Runde ${gk[0].runde}`,
                    linjer: [{
                        tekst: `Runde ${gk[0].runde} (${gk.length} kampe)`,
                        tid: foerste,
                        tidTekst: tidTekst(foerste) + (flereSlots ? ` – ${sidste.slot}` : ''),
                        bemaerkning: tider.length < gk.length ? `${gk.length - tider.length} kampe uden tid` : flereSlots ? `runden fylder flere slots (${foerste.slot}–${sidste.slot}); TP får starttiden` : '',
                        kampe: gk.map((k) => k.id),
                    }],
                });
                continue;
            }
            const linjer = gk
                .map((k) => ({ k, p: projekt.plan[k.id] }))
                .sort((a, b) => (a.k.tpRef.matchnr || 0) - (b.k.tpRef.matchnr || 0) || (a.k.runde || 0) - (b.k.runde || 0) || a.k.id.localeCompare(b.k.id))
                .map(({ k, p }) => ({
                    tekst: fase === 'pulje'
                        ? `${k.tpRef.matchnr ? `Kamp ${k.tpRef.matchnr}: ` : ''}${k.navn.replace(/^.*?(#\d+ – #\d+)$/, '$1')}${k.runde ? ` (runde ${k.runde})` : ''}`
                        : `${k.tpRef.matchnr ? `Kamp ${k.tpRef.matchnr}: ` : ''}${k.navn.replace(/^[^:]+: /, '')}`,
                    tid: p || null,
                    tidTekst: tidTekst(p),
                    bemaerkning: '',
                    kampe: [k.id],
                }));
            grupper.push({ navn: fase === 'pulje' ? gk[0].gruppe : (gk[0].rundeNavn || `Runde ${gk[0].runde}`), linjer });
        }
        liste.push({ kategori: kat.id, form: kat.form, grupper, antal: kampe.length, medTid: kampe.filter((k) => projekt.plan[k.id]).length });
    }
    return liste;
}

/** Listen som ren tekst (til kopiering). */
export function listeSomTekst(projekt) {
    const ud = [];
    for (const kat of byggListe(projekt)) {
        ud.push(`${kat.kategori} (${kat.medTid}/${kat.antal} kampe med tid)`);
        for (const g of kat.grupper) {
            ud.push(`  ${g.navn}`);
            for (const l of g.linjer) ud.push(`    ${l.tekst.padEnd(44)} ${l.tidTekst}${l.bemaerkning ? `  [${l.bemaerkning}]` : ''}`);
        }
        ud.push('');
    }
    return ud.join('\n');
}

export function renderListe(container, projekt, handlers) {
    if (!projekt) {
        container.innerHTML = '<div class="panel"><h2>Liste</h2><p class="panel-sub">Åbn en .TP-fil under "Fil og opsætning" først.</p></div>';
        return;
    }
    const liste = byggListe(projekt);
    const udenTid = projekt.kampe.filter((k) => !projekt.plan[k.id]).length;
    container.innerHTML = `
    <div class="panel liste-hoved udskriv-skjul">
        <div class="panel-hoved">
            <div>
                <h2>Liste til indtastning i TP</h2>
                <p class="panel-sub">Pr. kategori i TP's rækkefølge med kampnummer, dag og klokkeslæt. Swiss Ladder-runder har én tid pr. runde.${udenTid ? ` <strong>${udenTid} kampe mangler tid.</strong>` : ''}</p>
            </div>
            <div class="raekke-knapper">
                <button class="knap knap--sekundaer" data-handling="kopier">Kopiér som tekst</button>
                <button class="knap knap--sekundaer" data-handling="gem-projekt">Gem projektfil</button>
                <button class="knap" data-handling="udskriv">Udskriv</button>
            </div>
        </div>
        <p class="besked" id="listeBesked"></p>
    </div>
    <div class="udskrift-hoved">
        <h1>${esc(projekt.turnering.navn)} — spilleprogram</h1>
        <p>${projekt.turnering.dage.map((d) => datoTekst(d)).join(' og ')}${projekt.turnering.hal ? ` · ${esc(projekt.turnering.hal)}` : ''}</p>
    </div>
    ${liste.map((kat) => `
    <section class="panel liste-kategori">
        <h2>${esc(kat.kategori)} <span class="daempet">${kat.medTid}/${kat.antal} kampe</span></h2>
        ${kat.grupper.map((g) => `
        <h3>${esc(g.navn)}</h3>
        <table class="tabel tabel--liste">
            <tbody>${g.linjer.map((l) => `
                <tr class="${l.tid ? '' : 'er-uden-tid'}" data-kampe="${esc(l.kampe.join(','))}">
                    <td>${esc(l.tekst)}</td>
                    <td class="tal">${esc(l.tidTekst)}</td>
                    <td class="daempet">${esc(l.bemaerkning)}</td>
                </tr>`).join('')}</tbody>
        </table>`).join('')}
    </section>`).join('')}`;

    container.onclick = (e) => {
        const knap = e.target.closest('[data-handling]');
        if (knap) {
            if (knap.dataset.handling === 'udskriv') window.print();
            else if (knap.dataset.handling === 'gem-projekt') handlers.gemProjekt();
            else if (knap.dataset.handling === 'kopier') {
                const tekst = listeSomTekst(projekt);
                const besked = container.querySelector('#listeBesked');
                (navigator.clipboard?.writeText(tekst) || Promise.reject(new Error('ingen udklipsholder')))
                    .then(() => { besked.textContent = 'Listen er kopieret til udklipsholderen.'; })
                    .catch(() => { besked.textContent = 'Kunne ikke kopiere automatisk — markér teksten og kopiér selv.'; });
            }
            return;
        }
        const raekke = e.target.closest('tr[data-kampe]');
        if (raekke) handlers.visKampe(raekke.dataset.kampe.split(','));
    };
}
