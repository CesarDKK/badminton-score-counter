// planner.badmintonapp.dk — indgang. Holder projektet i hukommelsen, gemmer det
// i localStorage ved hver ændring, kører reglerne og tegner den aktive fane.
import { laesTP, tabellerFraMDB } from './tp-reader.js';
import * as store from './store.js';
import { tjekPlan } from './rules.js';
import { lavForslag, lavAlternativer, bedoemPlan } from './scheduler.js';
import { optimer, stopLoeser, stopVedLukning, nytJobId, diagnoseTekst, aendretUnderOptimering, flettetPlan } from './solver-klient.js';
import { scorePlan } from './kriterier.js';
import { alleNedskaeringer, anvendNedskaering, kapacitetsRegnskab, swissKandidater } from './nedskaering.js';
import { renderOpsaetning } from './ui/opsaetning.js';
import { renderPlan } from './ui/plan.js';
import { renderTjek } from './ui/tjek.js';
import { renderListe } from './ui/liste.js';
import { esc } from './ui/dom.js';

const gemtVedStart = store.hentLokaltMedStatus();
let projekt = gemtVedStart.projekt;
let gemt = true; // blev seneste ændring gemt i browseren?
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
    const forrige = projekt;
    projekt = nyt;
    // Tegn først, gem bagefter: et projekt, der ikke kan vises, må aldrig blive gemt — ellers starter
    // siden tom næste gang og kan kun reddes ved at rydde browserdata.
    try { render(); } catch (err) {
        console.error(err);
        projekt = forrige;
        try { render(); } catch { /* vis i det mindste beskeden */ }
        visBesked(`Projektet kunne ikke vises (${err.message || err}). Ændringen er ikke gemt.`, true);
        return;
    }
    if (projekt) gemt = store.gemLokalt(projekt); else { store.rydLokalt(); gemt = true; }
    visStatus();
}

/** Ændringer af opsætningen bygger kampene på ny (formvalget afhænger af plads og regler) — og fortæller, hvis en form skiftede. */
function saetOpsaetning(nyt) {
    const r = store.genberegnEfterOpsaetning(projekt, nyt);
    saet(r.projekt);
    if (!r.aendringer.length) return;
    const tider = r.mistedeTider ? ` ${r.mistedeTider} ${r.mistedeTider === 1 ? 'kamp' : 'kampe'} mistede deres tid, fordi de ikke længere findes.` : '';
    visBesked(`Ændringen gav en ny automatisk form for ${r.aendringer.map((a) => a.kategori).join(', ')}.${tider} Se "Turneringsform" nedenfor.`);
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
    visStatus();
}

function visStatus() {
    navStatus.textContent = projekt
        ? `${projekt.turnering.navn || 'Turnering'} · ${projekt.kampe.length} kampe · ${tjek.antal.fejl} fejl, ${tjek.antal.advarsel} advarsler · ${gemt ? 'gemt i browseren' : 'IKKE gemt i browseren — hent projektfilen under "Fil og opsætning"'}`
        : 'Intet projekt åbnet';
    navStatus.classList.toggle('er-ikke-gemt', !!projekt && !gemt);
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
            saet(store.normaliserHalvBane(obj));
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
    slotMin: (v) => saetOpsaetning(store.saetSlotMin(projekt, v)),
    opsaetning: (aendringer) => saet(store.opdaterOpsaetning(projekt, aendringer)),
    dag: (dato, aendringer) => saetOpsaetning(store.opdaterDag(projekt, dato, aendringer)),
    raekke: (id, aendringer) => saetOpsaetning(store.opdaterRaekke(projekt, id, aendringer)),
    minKampeSamlet: (id, vaerdi) => saetOpsaetning(store.opdaterRaekke(projekt, id, { minKampeSamlet: vaerdi })),
    kategori: (id, aendringer) => saetOpsaetning(store.opdaterKategori(projekt, id, aendringer)),
    pause: (klasse, v) => saet(store.opdaterPause(projekt, klasse, v)),
    regler: (sti, v) => saetOpsaetning(store.opdaterRegler(projekt, sti, v)),
    nulstilRegler: () => saetOpsaetning(store.nulstilRegler(projekt)),
    form: (id, aendringer) => saet(store.saetForm(projekt, id, aendringer)),
    vaegt: (id, v) => saet(store.opdaterVaegt(projekt, id, v)),
    vaegtSkabelon: (navn) => saet(store.saetVaegtSkabelon(projekt, navn)),
    formKriterie: (v) => saet(store.opdaterFormKriterie(projekt, v)),
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

    // Optimér: CP-SAT-løseren (planner-solver) minimerer scoren under alle hårde regler.
    // Den grådige plan bruges som startløsning og vises ved siden af til sammenligning.
    optimerSek(n) { tilstand.optimerSek = n; },
    async optimer({ udenSpoergsmaal = false } = {}) {
        if (tilstand.optimerer) return;
        const antalLaast = (projekt.laast || []).length;
        if (!udenSpoergsmaal && Object.keys(projekt.plan).length > antalLaast && !window.confirm(`Optimér alle kampe? Kun låste kampe (${antalLaast}) beholder deres tid. Du kan fortryde bagefter.`)) return;
        const sekunder = tilstand.optimerSek || 60;
        // Løseren regner på projektet, som det er NU. Ændrer brugeren noget imens (op til 6 min), må
        // resultatet ikke bare lægges ind oven i det — se aendretUnderOptimering nedenfor.
        const udgangspunkt = projekt;
        const graadig = lavForslag(udgangspunkt);
        tilstand.ventendeOptimering = null;
        const job = nytJobId();
        tilstand.optimerer = true;
        tilstand.optimerJob = job;
        tilstand.optimerStopper = false;
        tilstand.forslag = { tekst: `Løseren regner i op til ${sekunder >= 120 ? `${sekunder / 60} minutter` : `${sekunder} sekunder`}. Du kan stoppe undervejs og bruge den bedste plan, den har fundet.`, ikkePlaceret: [] };
        render();
        // Uret opdateres direkte i knappen, så gitteret ikke tegnes om hvert sekund
        const start = Date.now();
        const visUr = () => { const el = document.querySelector('[data-optimer-ur]'); if (el) el.textContent = `${Math.round((Date.now() - start) / 1000)} s`; };
        const ur = setInterval(visUr, 1000);
        let afbryd = null;
        const faerdig = () => { clearInterval(ur); tilstand.optimerer = false; tilstand.optimerJob = null; tilstand.optimerStopper = false; tilstand.optimerDiagnose = false; tilstand.optimerAfbryd = null; };
        try {
            let ventede = false;
            const vedStatus = (s) => {
                if (s.status === 'VENTER') {
                    // Løseren har én plads: vi står i kø og prøver selv igen. "Stop" afbryder ventetiden.
                    const om = s.ledigOmSekunder ? ` Den er ledig om højst ${s.ledigOmSekunder >= 90 ? `${Math.round(s.ledigOmSekunder / 60)} min` : `${s.ledigOmSekunder} s`}.` : '';
                    tilstand.forslag = { tekst: s.graense ? 'Der er kaldt for ofte til løseren — prøver igen om lidt.' : `Løseren er optaget af en anden kørsel.${om} Du står i kø, og kørslen starter af sig selv — eller tryk "Stop" for at opgive.`, ikkePlaceret: [] };
                    ventede = true;
                    render(); visUr();
                } else if (ventede) {
                    ventede = false;
                    tilstand.forslag = { tekst: 'Løseren er blevet fri og regner nu på din plan. Du kan stoppe undervejs og bruge den bedste plan, den har fundet.', ikkePlaceret: [] };
                    render(); visUr();
                } else if (s.fase === 'diagnose' && !tilstand.optimerDiagnose) { tilstand.optimerDiagnose = true; render(); visUr(); }
            };
            afbryd = new AbortController();
            tilstand.optimerAfbryd = afbryd;
            const svar = await optimer(udgangspunkt, { sekunder, hintPlan: graadig.brud.length ? null : graadig.plan, job, vedStatus, signal: afbryd.signal });
            faerdig();
            const lovlig = svar.status === 'OPTIMAL' || svar.status === 'FEASIBLE';
            const aendring = aendretUnderOptimering(udgangspunkt, projekt);
            if (aendring === 'lukket' || aendring === 'andet-projekt') {
                // Projektet er lukket eller skiftet ud imens: resultatet hører til en anden turnering
                tilstand.forslag = projekt ? { tekst: 'Løseren blev færdig, men du har åbnet et andet projekt imens, så dens plan er kasseret.', ikkePlaceret: [] } : null;
                render();
                return;
            }
            // Lægger løserens plan ind i projektet, som det ser ud NU: kampe, der er låst, beholder deres tid,
            // og "Fortryd" går tilbage til planen, som den var lige før — også det, brugeren nåede at flytte.
            const visLoeserensPlan = () => {
                const foer = { ...projekt.plan };
                const plan = flettetPlan(projekt, svar.plan);
                const graadigAlt = { navn: 'Grådig planlægger', beskrivelse: 'Det hurtige forslag fra "Lav forslag" — til sammenligning.', plan: flettetPlan(projekt, graadig.plan), ikkePlaceret: graadig.ikkePlaceret, brud: graadig.brud, statistik: graadig.statistik, score: scorePlan({ ...projekt, plan: flettetPlan(projekt, graadig.plan) }).total };
                const p2 = { ...projekt, plan };
                const opt = { navn: svar.status === 'OPTIMAL' ? 'Optimeret (bevist bedst mulig)' : 'Optimeret (CP-SAT)', beskrivelse: svar.stoppet ? `Stoppet efter ${svar.sekunder} s — den bedste plan, løseren havde fundet. Se Tjek for regler, løseren ikke kender (fx senior-reglerne).` : `Løseren minimerede scoren under de hårde regler på ${svar.sekunder} s.`, plan, ikkePlaceret: [], brud: [], statistik: bedoemPlan(p2), score: scorePlan(p2).total };
                const liste = [opt, graadigAlt].sort((x, y) => (x.brud.length - y.brud.length) || (x.score - y.score));
                tilstand.forslag = { tekst: `Løseren fandt en plan med score ${opt.score} på ${svar.sekunder} s (grådig: ${graadigAlt.score}). Bladr med ◀ ▶ og vælg "Brug dette".`, ikkePlaceret: [] };
                tilstand.alternativer = { liste, index: 0, foer };
                planHandlers.visAlternativ();
            };
            if (aendring === 'aendret') {
                // Brugeren har flyttet, låst eller rettet opsætningen, mens løseren regnede: intet overskrives uden et valg
                tilstand.ventendeOptimering = lovlig ? visLoeserensPlan : null;
                tilstand.forslag = {
                    tekst: lovlig
                        ? `Løseren er færdig (${svar.sekunder} s), men du har ændret projektet, mens den regnede. Dens plan er derfor IKKE lagt ind. Den bygger på projektet, som det var, da du trykkede "Optimér" — viser du den alligevel, beholder låste kampe deres tid, og "Fortryd" bringer dig tilbage til din nuværende plan.`
                        : 'Løseren blev færdig uden en plan, og du har ændret projektet imens. Din plan er ikke rørt — tryk "Optimér" igen for at regne på det, du har nu.',
                    handlinger: lovlig ? [{ tekst: 'Vis løserens plan alligevel', type: 'vis-ventende' }, { tekst: 'Kassér løserens plan', type: 'kasser-ventende' }] : [],
                    ikkePlaceret: [],
                };
                render();
                return;
            }
            if (lovlig) visLoeserensPlan();
            else if (svar.status === 'INFEASIBLE') {
                const diag = diagnoseTekst(svar.diagnose, projekt.opsaetning.dage.map((d) => d.dato));
                const brud = [...graadig.brud, ...graadig.ikkePlaceret];
                tilstand.forslag = { tekst: `Løseren regnede kun ${svar.sekunder} s, fordi den hurtigt kunne bevise, at der IKKE findes en plan, der overholder alle hårde regler. Årsag: ${diag.tekst} Herunder er den hurtige plan med de nødvendige regelbrud:`, handlinger: diag.handlinger, ikkePlaceret: brud.map((x) => ({ ...x, kategori: projekt.kampe.find((k) => k.id === x.id)?.kategori || '', navn: projekt.kampe.find((k) => k.id === x.id)?.navn || x.id })) };
                saet({ ...store.anvendForslag(projekt, graadig), sidsteForslag: { ikkePlaceret: brud } });
            } else {
                tilstand.forslag = { tekst: `${svar.besked || 'Løseren fandt ingen plan inden for tiden.'} Prøv med længere tid, eller brug "Lav forslag".`, ikkePlaceret: [] };
                render();
            }
        } catch (err) {
            faerdig();
            tilstand.forslag = afbryd?.signal.aborted
                ? { tekst: 'Du opgav at vente på løseren. Din plan er ikke rørt.', ikkePlaceret: [] }
                : { tekst: `Løseren gav ingen plan: ${err.message || err}. "Lav forslag" og "Alternativer" virker uden den.`, ikkePlaceret: [] };
            render();
        }
    },

    // Forslag, der får kabalen til at gå op: færre Swiss-runder eller to dage — afprøvet med planlæggeren
    findNedskaering() {
        const regnskab = kapacitetsRegnskab(projekt);
        const liste = alleNedskaeringer(projekt);
        let besked = '';
        if (!liste.length) besked = swissKandidater(projekt).length
            ? 'Planlæggeren kan lægge alle kampe uden regelbrud, som opsætningen er nu — tryk "Lav forslag".'
            : 'Kampene kommer fra TP\'s lodtrækning, så planneren kan ikke selv ændre antallet. Sæt kategorierne til "Swiss Ladder" eller "automatisk" i fane 1 — eller ret lodtrækningen i TP.';
        tilstand.nedskaering = { liste, regnskab, besked };
        render();
    },
    brugNedskaering(index) {
        const f = tilstand.nedskaering?.liste[index];
        if (!f) return;
        const r = anvendNedskaering(projekt, f);
        const brud = [...r.forslag.brud, ...r.forslag.ikkePlaceret];
        const katMap = new Map(r.projekt.kampe.map((k) => [k.id, k]));
        tilstand.nedskaering = null;
        tilstand.alternativer = null;
        tilstand.forslag = {
            tekst: `"${f.navn}" er taget i brug: ${f.kampeFoer} → ${r.projekt.kampe.length} kampe, og alle har tid${brud.length ? `, men ${brud.length} med regelbrud.` : ' uden regelbrud.'} ${f.spillereUnderKravEfter} spillere får færre kampe end reglementets minimum — se advarslerne i Tjek. Rundetallene står nu på kategorierne i fane 1.`,
            ikkePlaceret: brud.map((x) => ({ ...x, kategori: katMap.get(x.id)?.kategori || '', navn: katMap.get(x.id)?.navn || x.id })),
        };
        saet({ ...r.projekt, sidsteForslag: { ikkePlaceret: brud } });
    },
    lukNedskaering() { tilstand.nedskaering = null; render(); },

    // Knapperne under løserens diagnose: ret rækkens indstilling og optimér igen
    diagnoseHandling(index) {
        const h = tilstand.forslag?.handlinger?.[index];
        if (!h) return;
        if (h.type === 'vis-ventende' || h.type === 'kasser-ventende') {
            const vis = h.type === 'vis-ventende' ? tilstand.ventendeOptimering : null;
            tilstand.ventendeOptimering = null;
            tilstand.forslag = null;
            if (vis) vis(); else render();
            return;
        }
        tilstand.forslag = null;
        saetOpsaetning(store.opdaterRaekke(projekt, h.raekke, h.aendring));
        planHandlers.optimer({ udenSpoergsmaal: true });
    },

    async stopOptimer() {
        if (!tilstand.optimerer || !tilstand.optimerJob || tilstand.optimerStopper) return;
        tilstand.optimerStopper = true;
        render();
        // Står vi stadig i kø, findes jobbet ikke hos løseren endnu: så er "Stop" at opgive ventetiden
        try { if (!(await stopLoeser(tilstand.optimerJob))) tilstand.optimerAfbryd?.abort(); } catch { /* svaret på optimer() afgør resten */ }
    },

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

// Lukkes siden, mens løseren regner, får den besked med det samme (ellers opdager den det selv efter ca. 30 s)
window.addEventListener('pagehide', () => { if (tilstand.optimerer && tilstand.optimerJob) stopVedLukning(tilstand.optimerJob); });

if (gemtVedStart.fejl) besked = { tekst: `Det projekt, der lå gemt i browseren, kunne ikke åbnes: ${gemtVedStart.fejl} Det bliver liggende, til du åbner en ny fil.`, fejl: true };
try { render(); } catch (err) {
    console.error(err);
    projekt = null; // det gemte bliver liggende i browseren, til brugeren åbner noget nyt
    besked = { tekst: `Det gemte projekt kunne ikke vises (${err.message || err}). Åbn .TP-filen eller projektfilen igen.`, fejl: true };
    render();
}
