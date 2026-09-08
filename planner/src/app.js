// planner.badmintonapp.dk — indgang. Holder projektet i hukommelsen, gemmer det
// i localStorage ved hver ændring, kører reglerne og tegner den aktive fane.
import { laesTP, tabellerFraMDB } from './tp-reader.js';
import * as store from './store.js';
import { tjekPlan } from './rules.js';
import { lavForslag, lavAlternativer } from './scheduler.js';
import { renderOpsaetning } from './ui/opsaetning.js';
import { renderPlan } from './ui/plan.js';
import { renderTjek } from './ui/tjek.js';
import { renderListe } from './ui/liste.js';
import { esc } from './ui/dom.js';

let projekt = store.hentLokalt();
let tjek = null;
let besked = { tekst: '', fejl: false };
// UI-tilstand der ikke gemmes: aktiv fane, valgt dag, filter, søgning, valgt kamp, fremhævede kampe
const tilstand = { fane: 'opsaetning', dag: null, filter: '', soeg: '', valgtKamp: null, fremhaev: [] };

const faneKnapper = document.querySelectorAll('.fane');
const sektioner = {
    opsaetning: document.getElementById('fane-opsaetning'),
    plan: document.getElementById('fane-plan'),
    tjek: document.getElementById('fane-tjek'),
    liste: document.getElementById('fane-liste'),
};
const navStatus = document.getElementById('navStatus');
const dialog = document.getElementById('importValg');

// ── Faner ─────────────────────────────────────────────────────

for (const knap of faneKnapper) {
    knap.addEventListener('click', () => vaelgFane(knap.dataset.fane));
}

function vaelgFane(navn) {
    tilstand.fane = navn;
    for (const knap of faneKnapper) {
        const aktiv = knap.dataset.fane === navn;
        knap.classList.toggle('er-aktiv', aktiv);
        knap.setAttribute('aria-selected', String(aktiv));
    }
    for (const [n, sektion] of Object.entries(sektioner)) sektion.hidden = n !== navn;
    render();
}

// ── Tilstand ──────────────────────────────────────────────────

function saet(nyt) {
    projekt = nyt;
    if (projekt) store.gemLokalt(projekt); else store.rydLokalt();
    render();
}

function visBesked(tekst, fejl = false) {
    besked = { tekst, fejl };
    const el = document.getElementById('filBesked');
    if (el) { el.textContent = tekst; el.classList.toggle('fejl', fejl); }
}

function render() {
    tjek = projekt ? tjekPlan(projekt) : null;
    if (projekt && !projekt.opsaetning.dage.some((d) => d.dato === tilstand.dag)) tilstand.dag = projekt.opsaetning.dage[0]?.dato || null;
    if (tilstand.fane === 'opsaetning') {
        renderOpsaetning(sektioner.opsaetning, projekt, handlers);
        visBesked(besked.tekst, besked.fejl);
    } else if (tilstand.fane === 'plan') {
        renderPlan(sektioner.plan, projekt, tjek, tilstand, planHandlers);
        tilstand.fremhaev = [];
    } else if (tilstand.fane === 'tjek') {
        renderTjek(sektioner.tjek, projekt, tjek, tjekHandlers);
    } else if (tilstand.fane === 'liste') {
        renderListe(sektioner.liste, projekt, { gemProjekt: () => handlers.gemProjekt(), visKampe: (ids) => tjekHandlers.visKampe(ids, null) });
    }
    for (const knap of faneKnapper) {
        if (knap.dataset.fane === 'tjek') knap.textContent = tjek && (tjek.antal.fejl || tjek.antal.advarsel) ? `Tjek (${tjek.antal.fejl}/${tjek.antal.advarsel})` : 'Tjek';
    }
    navStatus.textContent = projekt
        ? `${projekt.turnering.navn || 'Turnering'} · ${projekt.kampe.length} kampe · ${tjek.antal.fejl} fejl, ${tjek.antal.advarsel} advarsler · gemt i browseren`
        : 'Intet projekt åbnet';
}

// ── Import-valg (design § 6) ──────────────────────────────────

function spoerg(titel, tekst, valg) {
    return new Promise((resolve) => {
        document.getElementById('importTitel').textContent = titel;
        document.getElementById('importTekst').textContent = tekst;
        const knapper = document.getElementById('importKnapper');
        knapper.innerHTML = valg.map((v, i) => `
            <button type="button" class="knap ${i ? 'knap--sekundaer' : ''}" data-valg="${i}">${esc(v.tekst)}${v.under ? `<small>${esc(v.under)}</small>` : ''}</button>`).join('')
            + '<button type="button" class="knap knap--sekundaer" data-valg="-1">Annullér</button>';
        const luk = (i) => { dialog.close(); resolve(i >= 0 ? valg[i].vaerdi : null); };
        knapper.onclick = (e) => { const b = e.target.closest('[data-valg]'); if (b) luk(Number(b.dataset.valg)); };
        dialog.oncancel = (e) => { e.preventDefault(); luk(-1); };
        dialog.showModal();
    });
}

async function vaelgImport(model) {
    const harTider = model.tpGitter.harTider;
    if (!projekt) {
        if (!harTider) return { handling: 'nyt', tagTiderMed: false };
        return spoerg('Tidsplanen i filen',
            'Filen indeholder allerede tider på kampene. Skal de med ind i planneren?', [
                { tekst: 'Tag tidsplanen med', under: 'Kampene lægges i gitteret, hvor TP har dem, og planneren viser konflikter i den eksisterende plan.', vaerdi: { handling: 'nyt', tagTiderMed: true } },
                { tekst: 'Kun spillere, rækker og kampe', under: 'Gitteret er tomt, så du kan lave en helt ny tidsplan uden at skele til den gamle.', vaerdi: { handling: 'nyt', tagTiderMed: false } },
            ]);
    }
    const valg = [
        { tekst: 'Genindlæs i det åbne projekt', under: 'Opsætning, dage og rækker bevares. Tider beholdes på de kampe, der stadig findes i filen.', vaerdi: { handling: 'genindlaes', behold: true } },
        { tekst: 'Genindlæs og ryd alle tider', under: 'Opsætning bevares, men gitteret tømmes.', vaerdi: { handling: 'genindlaes', behold: false } },
    ];
    if (harTider) valg.push({ tekst: 'Nyt projekt med TP’s tidsplan', under: 'Det åbne projekt erstattes.', vaerdi: { handling: 'nyt', tagTiderMed: true } });
    valg.push({ tekst: 'Nyt projekt med tomt gitter', under: 'Det åbne projekt erstattes.', vaerdi: { handling: 'nyt', tagTiderMed: false } });
    return spoerg('Der er allerede et projekt åbent', `Hvad skal der ske med "${projekt.turnering.navn || 'det åbne projekt'}"?`, valg);
}

// ── Handlinger: fane 1 ────────────────────────────────────────

const handlers = {
    async aabnTP(fil) {
        try {
            if (!window.MDBReader || !window.TPBuffer) throw new Error('tp-bundle.js er ikke indlæst.');
            visBesked(`Læser ${fil.name} …`);
            const buf = await fil.arrayBuffer();
            const t0 = performance.now();
            const reader = new window.MDBReader(window.TPBuffer.from(new Uint8Array(buf)));
            const model = laesTP(tabellerFraMDB(reader), { filnavn: fil.name });
            const ms = Math.round(performance.now() - t0);
            if (!model.kampe.length) {
                visBesked(`${fil.name} indeholder ingen kampe. Er lodtrækningen lavet i TP?`, true);
                return;
            }
            const valg = await vaelgImport(model);
            if (!valg) { visBesked('Indlæsning annulleret.'); return; }
            const nyt = valg.handling === 'genindlaes'
                ? store.genindlaes(projekt, model, { behold: valg.behold })
                : store.nytProjekt(model, { tagTiderMed: valg.tagTiderMed });
            besked = { tekst: `${fil.name} læst på ${ms} ms: ${model.kampe.length} kampe i ${model.kategorier.length} kategorier.`, fejl: false };
            saet(nyt);
        } catch (err) {
            console.error(err);
            visBesked(`Kunne ikke læse ${fil.name}: ${err.message || err}. Er det en .TP-fil fra Tournament Planner?`, true);
        }
    },

    async aabnProjekt(fil) {
        try {
            const obj = JSON.parse(await fil.text());
            const fejl = store.validerProjekt(obj);
            if (fejl) { visBesked(fejl, true); return; }
            if (projekt && !window.confirm(`Erstat det åbne projekt "${projekt.turnering.navn}" med ${fil.name}?`)) return;
            besked = { tekst: `${fil.name} åbnet.`, fejl: false };
            saet(obj);
        } catch (err) {
            visBesked(`Kunne ikke åbne ${fil.name}: ${err.message || err}`, true);
        }
    },

    gemProjekt() {
        const blob = new Blob([JSON.stringify(projekt, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = store.projektFilnavn(projekt);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        visBesked(`Projektet er gemt som ${a.download}.`);
    },

    startForfra() {
        if (!window.confirm('Ryd projektet fra browseren? Gem det først som fil, hvis du vil kunne åbne det igen.')) return;
        besked = { tekst: 'Projektet er ryddet.', fejl: false };
        saet(null);
    },

    besked: visBesked,
    slotMin: (v) => saet(store.saetSlotMin(projekt, v)),
    opsaetning: (aendringer) => saet(store.opdaterOpsaetning(projekt, aendringer)),
    dag: (dato, aendringer) => saet(store.opdaterDag(projekt, dato, aendringer)),
    raekke: (id, aendringer) => saet(store.opdaterRaekke(projekt, id, aendringer)),
    kategori: (id, aendringer) => saet(store.opdaterKategori(projekt, id, aendringer)),
    pause: (klasse, v) => saet(store.opdaterPause(projekt, klasse, v)),
    regler: (sti, v) => saet(store.opdaterRegler(projekt, sti, v)),
    nulstilRegler: () => saet(store.nulstilRegler(projekt)),
};

// ── Handlinger: fane 2 og 3 ───────────────────────────────────

const planHandlers = {
    vaelgDag(dag) { tilstand.dag = dag; render(); },
    filter(kat) { tilstand.filter = kat; render(); },
    soeg(tekst) {
        tilstand.soeg = tekst;
        // Kun kortene opdateres, så søgefeltet beholder fokus
        clearTimeout(planHandlers._t);
        planHandlers._t = setTimeout(() => {
            const felt = sektioner.plan.querySelector('[data-felt="soeg"]');
            const pos = felt?.selectionStart;
            render();
            const nyt = sektioner.plan.querySelector('[data-felt="soeg"]');
            if (nyt) { nyt.focus(); if (pos != null) nyt.setSelectionRange(pos, pos); }
        }, 150);
    },
    vaelgKamp(id) { tilstand.valgtKamp = tilstand.valgtKamp === id ? null : id; render(); },
    visKamp(id) {
        const p = projekt.plan[id];
        if (p) tilstand.dag = p.dag;
        tilstand.valgtKamp = id;
        tilstand.fremhaev = [id];
        render();
    },
    // id kan være flere kampe adskilt af komma (Swiss Ladder-runder flyttes samlet)
    flyt(id, dag, slot) { let p = projekt; for (const x of id.split(',')) p = store.flytKamp(p, x, dag, slot); saet(p); },
    fjern(id) { let p = projekt; for (const x of id.split(',')) p = store.fjernFraPlan(p, x); saet(p); },
    rydDag() {
        if (!window.confirm(`Fjern tiden på alle kampe ${tilstand.dag}?`)) return;
        tilstand.forslag = null;
        saet(store.rydDag(projekt, tilstand.dag));
    },
    lavForslag(kunDenneDag) {
        const antalLaast = (projekt.laast || []).length;
        const hvad = kunDenneDag ? `alle kampe ${tilstand.dag}` : 'alle kampe';
        if (Object.keys(projekt.plan).length > antalLaast && !window.confirm(`Planlæg ${hvad} forfra? Kun låste kampe (${antalLaast}) beholder deres tid.`)) return;
        const t0 = performance.now();
        const f = lavForslag(projekt, kunDenneDag ? { kunDage: [tilstand.dag] } : {});
        const ms = Math.round(performance.now() - t0);
        const katMap = new Map(projekt.kampe.map((k) => [k.id, k]));
        const brud = [...f.brud, ...f.ikkePlaceret];
        tilstand.forslag = {
            tekst: `Forslag lavet på ${ms} ms: alle ${Object.keys(f.plan).length} kampe har tid${brud.length ? `, men ${brud.length} kunne kun placeres ved at bryde en regel — se forslagene nedenfor og fejlene i Tjek.` : ' uden regelbrud.'}`,
            ikkePlaceret: brud.map((x) => ({ ...x, kategori: katMap.get(x.id)?.kategori || '', navn: katMap.get(x.id)?.navn || x.id })),
        };
        saet({ ...store.anvendForslag(projekt, f), sidsteForslag: { ikkePlaceret: brud } });
    },
    laasKamp(id) {
        const ids = id.split(',');
        const vaerdi = !(projekt.laast || []).includes(ids[0]);
        let p = projekt;
        for (const x of ids) p = store.laasKamp(p, x, vaerdi);
        saet(p);
    },
    laasKategori(vaerdi) { if (tilstand.filter) saet(store.laasKategori(projekt, tilstand.filter, vaerdi)); },

    // Alternative forslag: bladr mellem dem (planen skiftes med det samme, så
    // gitteret viser forslaget), "Brug dette" beholder det, "Fortryd" går tilbage.
    lavAlternativer() {
        const antalLaast = (projekt.laast || []).length;
        if (Object.keys(projekt.plan).length > antalLaast && !window.confirm(`Lav alternative forslag for alle kampe? Kun låste kampe (${antalLaast}) beholder deres tid. Du kan fortryde bagefter.`)) return;
        const t0 = performance.now();
        const liste = lavAlternativer(projekt);
        const ms = Math.round(performance.now() - t0);
        if (!liste.length) { visBesked('Kunne ikke lave forslag.', true); return; }
        tilstand.forslag = { tekst: `${liste.length} forskellige forslag lavet på ${ms} ms. Bladr med ◀ ▶ og vælg "Brug dette".`, ikkePlaceret: [] };
        tilstand.alternativer = { liste, index: 0, foer: { ...projekt.plan } };
        planHandlers.visAlternativ();
    },
    visAlternativ() {
        const alt = tilstand.alternativer;
        const a = alt.liste[alt.index];
        const nyt = store.anvendForslag(projekt, a);
        const t = tjekPlan(nyt);
        alt.fejl = t.antal.fejl;
        alt.advarsler = t.antal.advarsel;
        saet(nyt);
    },
    bladreAlternativ(retning) {
        const alt = tilstand.alternativer;
        if (!alt) return;
        alt.index = Math.max(0, Math.min(alt.liste.length - 1, alt.index + retning));
        planHandlers.visAlternativ();
    },
    brugAlternativ() {
        const alt = tilstand.alternativer;
        if (!alt) return;
        const a = alt.liste[alt.index];
        const katMap = new Map(projekt.kampe.map((k) => [k.id, k]));
        const brud = [...(a.brud || []), ...a.ikkePlaceret];
        tilstand.forslag = {
            tekst: `Forslaget "${a.navn}" er valgt: alle ${Object.keys(a.plan).length} kampe har tid${brud.length ? `, ${brud.length} med regelbrud — se forslagene nedenfor og Tjek.` : ' uden regelbrud.'}`,
            ikkePlaceret: brud.map((x) => ({ ...x, kategori: katMap.get(x.id)?.kategori || '', navn: katMap.get(x.id)?.navn || x.id })),
        };
        tilstand.alternativer = null;
        saet({ ...projekt, sidsteForslag: { ikkePlaceret: brud } });
    },
    fortrydAlternativ() {
        const alt = tilstand.alternativer;
        if (!alt) return;
        tilstand.alternativer = null;
        tilstand.forslag = null;
        saet({ ...projekt, plan: alt.foer });
    },
};

const tjekHandlers = {
    visKampe(ids, dag) {
        const foerste = ids.find((id) => projekt.plan[id]);
        tilstand.dag = dag || (foerste ? projekt.plan[foerste].dag : tilstand.dag);
        tilstand.fremhaev = ids;
        tilstand.valgtKamp = null;
        tilstand.filter = '';
        tilstand.soeg = '';
        vaelgFane('plan');
    },
    kvitter(noegle, vaerdi) { saet(store.kvitter(projekt, noegle, vaerdi)); },
};

render();
