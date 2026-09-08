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
    'anti-samtidighed': 'Single og double samtidig i samme række',
    'e-sidste-dag': 'E-række: sidste dag',
    'e-finale-tid': 'E-finale uden for 10–13',
    'senior-max-3': 'Senior E/M: over 3 kampe',
    'senior-finalerunder': 'Senior E/M: finalerunder samme dag',
    'senior-finaledag': 'Senior A/B: finaledagen',
    'swiss-runde': 'Swiss Ladder: runder for tæt',
    'slot-for-kort': 'Slotlængde under minimum',
    'form': 'Turneringsform (rettes i TP)',
    'uden-tid': 'Kampe uden tid',
};

export function renderTjek(container, projekt, tjek, handlers) {
    if (!projekt) {
        container.innerHTML = '<div class="panel"><h2>Tjek</h2><p class="panel-sub">Åbn en .TP-fil under "Fil og opsætning" først.</p></div>';
        return;
    }
    const grupper = new Map();
    for (const p of tjek.problemer) {
        const n = `${p.alvor}|${p.type}`;
        if (!grupper.has(n)) grupper.set(n, []);
        grupper.get(n).push(p);
    }
    const afsnit = (alvor, titel, tom) => {
        const liste = [...grupper.entries()].filter(([n]) => n.startsWith(`${alvor}|`));
        return `
        <section class="panel">
            <h2>${titel} <span class="maerke ${alvor === 'fejl' ? 'maerke--fejl' : alvor === 'advarsel' ? 'maerke--advarsel' : ''}">${tjek.antal[alvor]}</span></h2>
            ${liste.length ? liste.map(([n, ps]) => `
                <details open>
                    <summary>${esc(TYPE_TEKST[n.split('|')[1]] || n.split('|')[1])} <span class="daempet">${ps.length}</span></summary>
                    <ul class="problemer">${ps.map((p) => `
                        <li>
                            <span>${esc(p.tekst)}</span>
                            <span class="problem-knapper">
                                ${p.kampe.length ? `<button class="knap knap--sekundaer knap--lille" data-vis="${esc(p.kampe.join(','))}" data-dag="${esc(p.dag || '')}">Vis${p.dag ? ` ${datoTekst(p.dag, { kort: true })}` : ''}</button>` : ''}
                                ${p.noegle ? `<button class="knap knap--sekundaer knap--lille" data-kvitter="${esc(p.noegle)}">Kvittér</button>` : ''}
                            </span>
                        </li>`).join('')}</ul>
                </details>`).join('') : `<p class="panel-sub">${tom}</p>`}
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
        ${afsnit('fejl', 'Fejl', 'Ingen fejl — planen overholder de hårde regler.')}
        ${afsnit('advarsel', 'Advarsler', 'Ingen advarsler.')}
        ${afsnit('info', 'Til orientering', 'Alle kampe har en tid.')}
        <section class="panel">
            <h2>Kvitterede advarsler <span class="maerke">${kvitterede.length}</span></h2>
            ${kvitterede.length ? `<ul class="problemer">${kvitterede.map((n) => `<li><span>${esc(n)}</span><span class="problem-knapper"><button class="knap knap--sekundaer knap--lille" data-afkvitter="${esc(n)}">Fortryd</button></span></li>`).join('')}</ul>` : '<p class="panel-sub">Advarsler, du har accepteret, samles her.</p>'}
        </section>`;

    container.onclick = (e) => {
        const vis = e.target.closest('[data-vis]');
        if (vis) { handlers.visKampe(vis.dataset.vis.split(','), vis.dataset.dag || null); return; }
        const kv = e.target.closest('[data-kvitter]');
        if (kv) { handlers.kvitter(kv.dataset.kvitter, true); return; }
        const af = e.target.closest('[data-afkvitter]');
        if (af) handlers.kvitter(af.dataset.afkvitter, false);
    };
}
