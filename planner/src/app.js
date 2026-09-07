// planner.badmintonapp.dk — indgang. Holder projektet i hukommelsen, gemmer det
// i localStorage ved hver ændring og tegner den aktive fane.
import { laesTP, tabellerFraMDB } from './tp-reader.js';
import * as store from './store.js';
import { renderOpsaetning } from './ui/opsaetning.js';
import { esc } from './ui/dom.js';

let projekt = store.hentLokalt();
let besked = { tekst: '', fejl: false };

const faneKnapper = document.querySelectorAll('.fane');
const opsaetningEl = document.getElementById('fane-opsaetning');
const navStatus = document.getElementById('navStatus');
const dialog = document.getElementById('importValg');

// ── Faner ─────────────────────────────────────────────────────

for (const knap of faneKnapper) {
    knap.addEventListener('click', () => vaelgFane(knap.dataset.fane));
}

function vaelgFane(navn) {
    for (const knap of faneKnapper) {
        const aktiv = knap.dataset.fane === navn;
        knap.classList.toggle('er-aktiv', aktiv);
        knap.setAttribute('aria-selected', String(aktiv));
    }
    for (const sektion of document.querySelectorAll('.fane-indhold')) {
        sektion.hidden = sektion.id !== `fane-${navn}`;
    }
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
    renderOpsaetning(opsaetningEl, projekt, handlers);
    visBesked(besked.tekst, besked.fejl);
    navStatus.textContent = projekt
        ? `${projekt.turnering.navn || 'Turnering'} · ${projekt.kampe.length} kampe · gemt i browseren`
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

// ── Handlinger ────────────────────────────────────────────────

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
    dag: (dato, aendringer) => saet(store.opdaterDag(projekt, dato, aendringer)),
    raekke: (id, aendringer) => saet(store.opdaterRaekke(projekt, id, aendringer)),
    kategori: (id, aendringer) => saet(store.opdaterKategori(projekt, id, aendringer)),
    pause: (klasse, v) => saet(store.opdaterPause(projekt, klasse, v)),
};

render();
