// Fane 3: Tjek (design § 8). Alle fejl og advarsler fra rules.js som liste;
// klik hopper til kampen i gitteret, advarsler med nøgle kan kvitteres.
import { esc, datoTekst } from './dom.js';
import { loesningsforslag } from '../scheduler.js';

const TYPE_TEKST = {
    'kapacitet': 'For mange kampe i et slot',
    'dobbeltbooket': 'Spiller i to kampe samtidig',
    'pause': 'For kort pause',
    'raekkefoelge': 'Forkert rækkefølge',
    'afhaengighed-uden-tid': 'Bygger på kamp uden tid',
    'tidsvindue': 'Uden for tidsvinduet',
    'uden-for-dagen': 'Uden for dagens slots',
    'ukendt-dag': 'Ukendt dag',
    'max-kampe': 'For mange kampe pr. dag',
    'flere-dage': 'Række over flere dage',
    'uden-for-raekkens-dage': 'Uden for rækkens dage',
    'raekke-tidsrum': 'Uden for rækkens eget tidsrum',
    'lang-ventetid': 'Spiller venter længe mellem egne kampe',
    'max-haltid': 'Spiller over rækkens max haltid',
    'anti-samtidighed': 'Single og double samtidig i samme række',
    'e-sidste-dag': 'E-række: sidste dag',
    'e-tidligst': 'E-række: for tidligt på dagen',
    'pause-under-reglementet': 'Pausen er lavere end reglementet',
    'e-finale-tid': 'E-finale uden for 10–13',
    'senior-max-3': 'Senior E/M: over 3 kampe',
    'senior-finalerunder': 'Senior E/M: finalerunder samme dag',
    'senior-finaledag': 'Senior A/B: finaledagen',
    'swiss-runde': 'Swiss Ladder: runder for tæt',
    'slot-for-kort': 'Slotlængde under minimum',
    'form': 'Turneringsform (rettes i TP)',
    'uden-tid': 'Kampe uden tid',
};

// Tre niveauer i stedet for fejl/advarsler/info (designkritikken 2026-10-09): det, der SKAL rettes (Tjeks fejl),
// det, der bør ses (mulige regelbrud), og det, der er til orientering (ventetid, lodtrækningen i TP — den tjekkes
// også under Turneringen, før programmet laves).
const TIL_ORIENTERING = new Set(['lang-ventetid', 'form']);
export function niveauFor(p) {
    if (p.alvor === 'fejl') return 'skal';
    if (p.alvor === 'info' || TIL_ORIENTERING.has(p.type)) return 'orientering';
    return 'boer';
}

export function renderTjek(container, projekt, tjek, handlers) {
    if (!projekt) {
        container.innerHTML = '<div class="panel"><h2>Problemer</h2><p class="panel-sub">Åbn en .TP-fil under trin 1 (Fil) først.</p></div>';
        return;
    }
    const grupper = new Map();
    for (const p of tjek.problemer) {
        const n = `${niveauFor(p)}|${p.type}`;
        if (!grupper.has(n)) grupper.set(n, []);
        grupper.get(n).push(p);
    }
    const afsnit = (niveau, titel, tom, klasse, aaben) => {
        const liste = [...grupper.entries()].filter(([n]) => n.startsWith(`${niveau}|`));
        const antal = liste.reduce((sum, [, ps]) => sum + ps.length, 0);
        return `
        <section class="panel">
            <h2>${titel} <span class="maerke ${antal ? klasse : 'maerke--ok'}">${antal}</span></h2>
            ${liste.length ? liste.map(([n, ps]) => {
                const noegler = ps.map((p) => p.noegle).filter(Boolean);
                return `
                <details ${aaben ? 'open' : ''}>
                    <summary>${esc(TYPE_TEKST[n.split('|')[1]] || n.split('|')[1])} <span class="daempet">${ps.length}</span>
                        ${noegler.length > 1 ? `<button class="knap knap--sekundaer knap--lille gruppe-kvitter" data-kvitter-alle="${esc(JSON.stringify(noegler))}" title="Accepter alle ${noegler.length} i gruppen">Kvittér alle ${noegler.length}</button>` : ''}</summary>
                    <ul class="problemer">${ps.map((p) => `
                        <li>
                            <span>${esc(p.tekst)}</span>
                            <span class="problem-knapper">
                                ${p.kampe.length ? `<button class="knap knap--sekundaer knap--lille" data-vis="${esc(p.kampe.join(','))}" data-dag="${esc(p.dag || '')}">Vis${p.dag ? ` ${datoTekst(p.dag, { kort: true })}` : ''}</button>` : ''}
                                ${p.noegle ? `<button class="knap knap--sekundaer knap--lille" data-kvitter="${esc(p.noegle)}">Kvittér</button>` : ''}
                            </span>
                        </li>`).join('')}</ul>
                </details>`;
            }).join('') : `<p class="panel-sub">${tom}</p>`}
        </section>`;
    };
    const kvitterede = projekt.kvitteret || [];
    const sidste = projekt.sidsteForslag;
    const forslag = sidste?.ikkePlaceret?.length ? loesningsforslag(projekt, sidste.ikkePlaceret) : [];
    container.innerHTML = `
        ${forslag.length ? `
        <section class="panel">
            <h2>Kampe placeret med regelbrud i sidste forslag <span class="maerke maerke--advarsel">${sidste.ikkePlaceret.length}</span></h2>
            <p class="panel-sub">Alle kampe har fået en tid, men disse kunne kun placeres ved at bryde en regel. Sådan kan det løses:</p>
            <ul class="problemer">${forslag.map((f) => `<li><span>${esc(f.tekst)}</span></li>`).join('')}</ul>
        </section>` : ''}
        ${afsnit('skal', 'Skal rettes', 'Intet — planen overholder de hårde regler.', 'maerke--fejl', true)}
        ${afsnit('boer', 'Bør ses', 'Intet at se på.', 'maerke--advarsel', true)}
        ${afsnit('orientering', 'Til orientering', 'Intet.', '', false)}
        <section class="panel">
            <h2>Kvitterede <span class="maerke">${kvitterede.length}</span></h2>
            ${kvitterede.length ? `<details><summary>Vis de ${kvitterede.length} kvitterede</summary><ul class="problemer">${kvitterede.map((n) => `<li><span>${esc(n)}</span><span class="problem-knapper"><button class="knap knap--sekundaer knap--lille" data-afkvitter="${esc(n)}">Fortryd</button></span></li>`).join('')}</ul></details>` : '<p class="panel-sub">Advarsler, du har accepteret, samles her.</p>'}
        </section>`;

    container.onclick = (e) => {
        const vis = e.target.closest('[data-vis]');
        if (vis) { handlers.visKampe(vis.dataset.vis.split(','), vis.dataset.dag || null); return; }
        const alle = e.target.closest('[data-kvitter-alle]');
        if (alle) { e.preventDefault(); handlers.kvitterAlle(JSON.parse(alle.dataset.kvitterAlle)); return; }
        const kv = e.target.closest('[data-kvitter]');
        if (kv) { handlers.kvitter(kv.dataset.kvitter, true); return; }
        const af = e.target.closest('[data-afkvitter]');
        if (af) handlers.kvitter(af.dataset.afkvitter, false);
    };
}
