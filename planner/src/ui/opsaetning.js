// Trin 1 (Fil) og trin 2 (Turneringen) (design § 8, designkritikken 2026-10-09). Tegner trinene som HTML ud fra
// projektet og sender ændringer tilbage gennem "handlers". Ingen tilstand her.
import { esc, datoTekst, procent, tal } from './dom.js';
import { kapacitetPrDag, kampePrKategori, slotsForDag, baneSlots, FYLDNINGSGRAD } from '../kapacitet.js';
import { foerSkoledag } from '../rules.js';
import { minutter } from '../tp-reader.js';
import { reglerFor, STANDARD_REGLER } from '../store.js';
import { FORM_VALG, FORM_VALG_TEKST, formTekst, effektivForm, minKampeSamlet } from '../form.js';
import { KRITERIER, VAEGT_SKABELONER, vaegteFor } from '../kriterier.js';
import { anbefaletKamplaengde, bedsteKamplaengde, SAESONDATA, SKIFTE_MIN, MARGEN, FORSINKELSE_GRAENSE } from '../kamplaengde.js';
import { PRIS, STANDARD_PRIS_ORDEN, prisOrden } from '../kampprogram.js';

const FORM_TEKST = {
    'pulje': 'Pulje', 'pulje-cup': 'Pulje + cup', 'cup': 'Cup', 'dobbelt-pulje': 'Dobbelt pulje',
    'dobbelt-pulje-cup': 'Dobbelt pulje + cup', 'swiss': 'Swiss Ladder', 'ingen lodtrækning': 'Ingen lodtrækning',
};

// Trin 2 følger arbejdsgangen: lodtrækningen i TP → dage og baner → kamplængde og pauser → rækker og kategorier →
// kapacitet → "Lav kampprogram". Kun det, maskinen ikke kan vide, står fremme; resten er foldet væk eller under Avanceret.
const AFSNIT = [
    ['afsnit-lodtraekning', 'Lodtrækningen'],
    ['afsnit-dage', 'Dage og baner'],
    ['afsnit-kamplaengde', 'Kamplængde'],
    ['afsnit-raekker', 'Rækker og kategorier'],
    ['afsnit-kapacitet', 'Kapacitet'],
    ['afsnit-avanceret', 'Avanceret'],
];

// Fold-ud-bokse, brugeren selv har åbnet eller lukket, bevares, når trinnet tegnes forfra ved hver ændring
function tegn(container, html, projekt, handlers) {
    const aabne = new Map([...container.querySelectorAll('details[data-id]')].map((d) => [d.dataset.id, d.open]));
    container.innerHTML = html;
    for (const d of container.querySelectorAll('details[data-id]')) if (aabne.has(d.dataset.id)) d.open = aabne.get(d.dataset.id);
    // Lytterne sættes på beholderen én gang og læser det aktuelle projekt herfra, så de ikke hober sig op
    container._projekt = projekt;
    if (!container.dataset.bundet) {
        bind(container, () => container._projekt, handlers);
        container.dataset.bundet = '1';
    }
}

/** Trin 1: åbn en fil — eller, når et projekt er åbent, turneringen og filens knapper. */
export function renderFil(container, projekt, handlers) {
    tegn(container, projekt ? turneringPanel(projekt) : filPanel(), projekt, handlers);
}

// ui.sammenligning: resultatet af "Sammenlign kamplængder"; ui.tjek: Tjeks problemer (til forhåndstjekket af lodtrækningen)
export function renderOpsaetning(container, projekt, handlers, ui = {}) {
    if (!projekt) {
        tegn(container, `<section class="panel"><h2>Turneringen</h2><p class="panel-sub">Åbn en .TP-fil først.</p>
            <p style="margin-top:12px"><button type="button" class="knap" data-handling="gaa-fil">Til trin 1: Fil</button></p></section>`, projekt, handlers);
        return;
    }
    const paneler = [lodtraekningPanel(projekt, ui.tjek), dagePanel(projekt), kamplaengdePanel(projekt, ui), raekkePanel(projekt), kapacitetPanel(projekt), avanceretPanel(projekt)].filter(Boolean);
    tegn(container, afsnitNav(paneler.join('')) + '<p class="besked" data-besked></p>' + paneler.join(''), projekt, handlers);
}

// ── Paneler ───────────────────────────────────────────────────

// Fil-knapperne (åbn .TP-fil / projektfil) — både i den store filzone og i turneringens hoved
const filKnapper = (sekundaer) => `
                <label class="knap${sekundaer ? ' knap--sekundaer' : ''}">${sekundaer ? 'Åbn anden .TP-fil' : 'Åbn .TP-fil'}<input type="file" id="tpFil" accept=".tp,.TP,application/octet-stream" hidden></label>
                <label class="knap knap--sekundaer">Åbn projektfil<input type="file" id="projektFil" accept=".json,application/json" hidden></label>`;

function filPanel() {
    return `
    <section class="panel" id="filPanel">
        <h2>Fil</h2>
        <p class="panel-sub">Åbn en .TP-fil fra Tournament Planner, hvor tilmeldinger, par og lodtrækning er på plads. Du kan også åbne et gemt planner-projekt.</p>
        <div class="filzone" id="filzone">
            <div class="knapper">${filKnapper(false)}
            </div>
            <p>… eller træk filen herind. Filen læses i din browser og forlader ikke din computer.</p>
        </div>
        <p class="besked" id="filBesked" data-besked></p>
    </section>`;
}

/** Hop-links til fanens afsnit — kun dem, der er tegnet. */
function afsnitNav(html) {
    const links = AFSNIT.filter(([id]) => html.includes(`id="${id}"`))
        .map(([id, navn]) => `<a href="#${id}" data-afsnit="${id}">${navn}</a>`).join('');
    return `<div class="afsnit-nav" role="navigation" aria-label="Afsnit på siden">${links}</div>`;
}

// Turneringen og filen i ét panel; hele panelet tager imod en fil, der trækkes ind
function turneringPanel(p) {
    const antalSpillere = Object.keys(p.spillere).length;
    const medTid = Object.keys(p.plan).length;
    const bem = p.bemaerkninger || [];
    return `
    <section class="panel filzone--panel" id="afsnit-turnering" data-filzone>
        <div class="panel-hoved">
            <div>
                <h2>${esc(p.turnering.navn || 'Turnering')}${p.turnering.hal ? ` <span class="daempet">· ${esc(p.turnering.hal)}</span>` : ''}</h2>
                <p class="panel-sub">${p.turnering.dage.map((d) => datoTekst(d)).join(' og ')} · fra <code>${esc(p.kilde.filnavn || 'ukendt fil')}</code>${p.kilde.tagTiderMed ? ' · TP’s tidsplan er taget med' : ' · startet med tomt gitter'}</p>
            </div>
            <div class="raekke-knapper">${filKnapper(true)}
                <button class="knap knap--sekundaer" data-handling="gem-projekt">Gem projektfil</button>
                <button class="knap knap--sekundaer" data-handling="start-forfra">Start forfra</button>
            </div>
        </div>
        <p class="besked" id="filBesked" data-besked></p>
        <div class="noegletal">
            <div class="tal-kort"><div class="vaerdi">${p.kampe.length}</div><span class="etiket">Kampe</span></div>
            <div class="tal-kort"><div class="vaerdi">${p.kategorier.length}</div><span class="etiket">Kategorier</span></div>
            <div class="tal-kort"><div class="vaerdi">${antalSpillere}</div><span class="etiket">Spillere</span></div>
            <div class="tal-kort"><div class="vaerdi">${medTid}</div><span class="etiket">Kampe med tid</span></div>
            <div class="tal-kort"><div class="vaerdi">${p.tpGitter?.advarsler ?? 0}</div><span class="etiket">TP-advarsler i filen</span></div>
        </div>
        ${bem.length ? `<ul class="bemaerkninger">${bem.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
        <div class="videre">
            <span class="daempet">Næste trin: vælg hvilke dage rækkerne spiller, og tjek dage og baner.</span>
            <button type="button" class="knap" data-handling="gaa-turnering">Videre til Turneringen →</button>
        </div>
    </section>`;
}

/**
 * Forhåndstjek af lodtrækningen i TP: kategorier, hvor spillerne ikke er sikret reglementets minimum af kampe.
 * Før stod det som advarsler i Tjek, EFTER programmet var lagt; her vælger man, før der planlægges.
 */
function lodtraekningPanel(p, tjek) {
    if (!p.kampe.length) return '';
    const problemer = (tjek?.problemer || []).filter((x) => x.type === 'form');
    if (!problemer.length) {
        return `
    <section class="panel panel--kompakt" id="afsnit-lodtraekning">
        <h2><span class="er-groen">✓</span> Lodtrækningen</h2>
        <p class="panel-sub">Alle spillere er sikret mindst reglementets antal kampe med den lodtrækning, der bruges.</p>
    </section>`;
    }
    const katMap = new Map(p.kategorier.map((k) => [k.id, k]));
    const linjer = problemer.map((x) => {
        const katId = (x.noegle || '').split(':')[0];
        const k = katMap.get(katId);
        const egen = k && (k.formValg || 'tp') !== 'tp';
        const knapper = !k ? '' : egen
            ? `<button type="button" class="knap knap--sekundaer knap--lille" data-handling="form-valg" data-kat="${esc(k.id)}" data-form-valg="tp">Brug TP's lodtrækning</button>`
            : `<button type="button" class="knap knap--sekundaer knap--lille" data-handling="form-valg" data-kat="${esc(k.id)}" data-form-valg="swiss" title="Planneren bygger selv kampene som Swiss Ladder (4–6 runder). Opskriften til lodtrækningen i TP står under trin 4.">Lad planneren lave Swiss Ladder</button>
               <button type="button" class="knap knap--sekundaer knap--lille" data-handling="form-valg" data-kat="${esc(k.id)}" data-form-valg="auto" title="Planneren vælger den form, der opfylder minimum med færrest bane-slots">Lad planneren vælge form</button>`;
        return `<li><span>${esc(x.tekst.replace(/ Rettes i TP\.$| Vælg en anden form under Turneringen\.$| En ekstra runde eller en anden form under Turneringen løser det\.$/, ''))}</span>
            <span class="problem-knapper">${knapper}
                ${x.noegle ? `<button type="button" class="knap knap--sekundaer knap--lille" data-handling="kvitter-form" data-noegle="${esc(x.noegle)}">Behold</button>` : ''}</span></li>`;
    }).join('');
    return `
    <section class="panel panel--advarsel" id="afsnit-lodtraekning">
        <h2>Lodtrækningen <span class="maerke maerke--advarsel">${problemer.length}</span></h2>
        <p class="panel-sub">Med denne lodtrækning er nogle spillere ikke sikret reglementets minimum af kampe. Ret lodtrækningen i TP, lad planneren bygge kampene, eller behold den.</p>
        <ul class="problemer">${linjer}</ul>
    </section>`;
}

function dagePanel(p) {
    const { slotMin, dage } = p.opsaetning;
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
            <td><label class="valg" title="Dagen før en skoledag slutter tidsvinduet 2 timer tidligere (§ 4 stk. 5.1)"><input type="checkbox" data-skoledag="${d.dato}" ${foerSkoledag(d) ? 'checked' : ''}> ja</label></td>
            <td class="tal">${slots}</td>
            <td class="tal">${baneSlots(d, slotMin)}</td>
            <td class="kan-bryde">${spaerringer}
                <details class="spaer-fold" data-id="spaer-${d.dato}"><summary>Spær baner …</summary>
                <span class="spaerring-ny">
                    <input type="time" step="300" data-ny="fra" data-dato="${d.dato}" aria-label="Spærret fra" placeholder="fra">
                    <input type="time" step="300" data-ny="til" data-dato="${d.dato}" aria-label="Spærret til">
                    <input type="number" min="1" max="60" value="1" data-ny="baner" data-dato="${d.dato}" aria-label="Antal baner">
                    <button type="button" class="knap knap--sekundaer knap--lille" data-handling="tilfoej-spaerring" data-dato="${d.dato}">Spær baner</button>
                </span></details>
            </td>
        </tr>`;
    }).join('');
    return `
    <section class="panel" id="afsnit-dage">
        <h2>Dage og baner</h2>
        <p class="panel-sub">Tiderne fra TP-filens gitter er foreslået. Kapaciteten er antal hele baner pr. slot; spær baner i et tidsrum, hvis de ikke kan bruges.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Dag</th><th>Start</th><th>Slut</th><th>Baner</th><th title="Dagen før en skoledag slutter tidsvinduet 2 timer tidligere (§ 4 stk. 5.1)">Før skoledag</th><th class="tal">Slots</th><th class="tal">Bane-slots</th><th>Spærrede baner</th></tr></thead>
                <tbody>${raekker}</tbody>
            </table>
        </div>
    </section>`;
}

function kamplaengdePanel(p, ui = {}) {
    const { slotMin, pauseMin } = p.opsaetning;
    const udenPause = !pauseMin.ABCD && !pauseMin.M && !pauseMin.E && !pauseMin.faelles;
    const pause = (klasse, tekst) => `
        <label class="felt"><span class="etiket">${tekst}</span>
            <input type="number" min="0" max="60" step="1" value="${pauseMin[klasse] ?? ''}" data-pause="${klasse}"> min</label>`;
    return `
    <section class="panel" id="afsnit-kamplaengde">
        <h2>Kamplængde og pauser</h2>
        <p class="panel-sub">Vælges automatisk, når du trykker "Lav kampprogram" — ud fra en sammenligning af kamplængderne. Nu: <b>${slotMin} min, ${udenPause ? 'pausen gives på dagen' : 'reglementets pause i planen'}</b>. Turneringen har én kamplængde, som også sættes i TP.</p>
        <details class="fold" data-id="kamplaengde-ret">
            <summary><span class="fold-titel">Sæt den selv eller sammenlign</span></summary>
            <p class="panel-sub">Reglementet: mindst 10 min pause i A–D-rækker, 15 i M, 20 i E, og 12 når M og A–D spilles i samme turnering.</p>
            <div class="felter">
                <label class="felt" title="Turneringens ene kamplængde, som også sættes i TP. Den bestemmer slot-gitteret."><span class="etiket">Kamplængde (slot)</span>
                    <input type="number" min="5" max="90" step="5" value="${slotMin}" data-felt="slotMin"> min</label>
                ${pause('ABCD', 'Pause A/B/C/D')}
                ${pause('M', 'Pause M')}
                ${pause('E', 'Pause E')}
                ${pause('faelles', 'Fælles pause (M + ABCD)')}
            </div>
            ${kamplaengdeBoks(p, ui.sammenligning)}
        </details>
    </section>`;
}

// Anbefalet kamplængde ud fra programmets kampe (sæsondata) — TP har kun én kamplængde for hele
// turneringen — og evt. sammenligningen af kamplængder.
function kamplaengdeBoks(p, sammenligning) {
    const a = anbefaletKamplaengde(p);
    if (!a.antal) return '';
    const nu = p.opsaetning.slotMin;
    const komma = (x) => String(x).replace('.', ',');
    const grund = a.minutter > a.fraData ? ` Reglementets minimum for programmets rækker er ${a.reglement} min (§ 4 stk. 5).` : '';
    const knap = nu === a.minutter
        ? '<span class="kamplaengde-ok">✓ Bruges nu</span>'
        : `<button type="button" class="knap knap--sekundaer knap--lille" data-handling="brug-kamplaengde" data-min="${a.minutter}">Brug ${a.minutter} min</button>`;
    const fordeling = a.kategorier.map((k) => `<tr><td>${esc(k.id)}</td><td class="tal">${k.antal}</td><td class="tal">${komma(k.minutter)} min</td></tr>`).join('');
    return `
        <div class="kamplaengde">
            <div class="kamplaengde-top">
                <div><strong>Anbefalet kamplængde: ${a.minutter} min</strong>
                    <span class="daempet">Programmets ${a.antal} kampe varer forventet ${komma(a.gennemsnit)} min i gennemsnit + ${SKIFTE_MIN} min skifte + ${Math.round((MARGEN - 1) * 100)} % margen, rundet op til hele 5 min.${grund}</span></div>
                <div class="raekke-knapper">${knap}
                    <button type="button" class="knap knap--sekundaer knap--lille" data-handling="sammenlign-kamplaengder">Sammenlign kamplængder</button></div>
            </div>
            <details class="kamplaengde-detaljer" data-id="kamplaengde-udregning"><summary>Sådan er gennemsnittet regnet ud</summary>
                <p class="panel-sub">Hver kamp får en forventet varighed efter årgang, single/double/mix og niveau fra ${esc(SAESONDATA.tekst)}. TP har kun én kamplængde, så anbefalingen er gennemsnittet vægtet efter antal kampe.</p>
                <div class="tabel-hylster"><table class="tabel"><thead><tr><th>Kategori</th><th class="tal">Kampe</th><th class="tal">Forventet</th></tr></thead><tbody>${fordeling}</tbody></table></div>
            </details>
            ${sammenligning ? sammenligningTabel(sammenligning, a.minutter, p.opsaetning) : ''}
        </div>`;
}

// Hver række er en kamplængde med reglementets pause i planen eller uden pause i planen
function sammenligningTabel(rk, anbefalet, opsaetning) {
    const bedst = bedsteKamplaengde(rk);
    const samme = (a, b) => ['ABCD', 'M', 'E', 'faelles'].every((x) => (a?.[x] ?? null) === (b?.[x] ?? null));
    const bruges = (r) => r.minutter === opsaetning.slotMin && (samme(r.pauseMin, opsaetning.pauseMin) || (r.ogsaaUdenPause && ['ABCD', 'M', 'E', 'faelles'].every((x) => !opsaetning.pauseMin?.[x])));
    const raekker = rk.map((r) => {
        const mark = [r === bedst ? '<span class="kamplaengde-ok">bedst samlet</span>' : '', r.minutter === anbefalet && !r.udenPause ? 'anbefalet' : '', bruges(r) ? 'bruges nu' : ''].filter(Boolean).join(', ');
        // Den forventede sluttid vises kun, når den ligger mindst 5 min efter planen (ellers er det støj)
        const senere = (d) => minutter(d.forventetSlut) - minutter(d.planSlut) >= 5;
        const slut = r.dage.map((d) => `${datoTekst(d.dato, { kort: true })}: ${d.planSlut}${senere(d) ? ` <span class="er-roed">→ ca. ${d.forventetSlut}</span>` : ''}`).join('<br>');
        return `<tr>
            <td><strong>${r.minutter} min</strong><br><span class="daempet">${r.udenPause ? 'uden pause' : r.ogsaaUdenPause ? 'med/uden pause' : 'med pause'}</span>${mark ? `<br><span class="daempet">${mark}</span>` : ''}</td>
            <td class="tal">${r.udenTid ? `<span class="er-roed">${r.udenTid}</span>` : '0'}</td>
            <td class="tal">${r.fejl ? `<span class="er-roed">${r.fejl}</span>` : '0'}</td>
            <td class="tal">${r.muligeBrud ? `<span class="er-gul">${r.muligeBrud}</span>` : '0'}</td>
            <td class="tal">${r.haltidGnsMin} min</td>
            <td>${slut}</td>
            <td class="tal">${r.forsinkelseMax > FORSINKELSE_GRAENSE ? `<span class="er-roed">${r.forsinkelseMax} min</span>` : `${r.forsinkelseMax} min`}</td>
            <td>${bruges(r) ? '' : `<button type="button" class="knap knap--sekundaer knap--lille" data-handling="brug-kamplaengde" data-min="${r.minutter}" data-uden-pause="${r.udenPause ? '1' : '0'}">Brug</button>`}</td>
        </tr>`;
    }).join('');
    return `
            <div class="tabel-hylster" style="margin-top:12px"><table class="tabel">
                <thead><tr><th title="Kamplængde og pause i planen">Kamplængde</th><th class="tal">Uden tid</th><th class="tal" title="Tjeks fejl: reglen brydes med sikkerhed">Regelbrud</th><th class="tal" title="Tjeks pause-advarsler: reglen brydes, hvis bestemte spillere går videre (fx kort pause før en finale)">Mulige brud</th><th class="tal">Tid i hal</th><th>Slut (plan → forventet)</th><th class="tal">Forsinkelse</th><th></th></tr></thead>
                <tbody>${raekker}</tbody></table></div>
            <p class="panel-sub">Hver kamplængde er afprøvet med reglementets pause i planen og uden pause i planen, hver med et nyt forslag fra planlæggeren og en simulering af dagen med de forventede kamptider: kampen tager den bane, der bliver ledig først, og spillerne får altid reglementets pause — er den ikke i planen, venter kampen på dagen. Forsinkelsen viser altså, hvad en plan uden pause koster i hallen. Den viser risikoen, ikke en garanti. "Bedst samlet" er længden med færrest kampe uden tid, færrest regelbrud, mindst forsinkelse ud over ${FORSINKELSE_GRAENSE} min, færrest mulige brud og kortest tid i hallen — i den rækkefølge. Den kan afvige fra anbefalingen, fordi pausen spiller ind: 20 min kamp + 10 min pause = 30 min, så med 25-min slots skal en spiller vente to slots mellem sine kampe.</p>`;
}

// Indstillinger, der sjældent ændres: forslagets valg, reglementets grænser og de bløde vægte.
// Hver boks viser i overskriften, om noget er ændret, så man ikke skal folde dem ud for at se det.
function avanceretPanel(p) {
    return `
    <section class="panel" id="afsnit-avanceret">
        <h2>Avanceret</h2>
        <p class="panel-sub">Behøver normalt ikke ændres. Ændrede værdier markeres med gult.</p>
        ${forslagBoks(p)}
        ${reglerBoks(p)}
        ${prisBoks(p)}
        ${vaegtBoks(p)}
    </section>`;
}

function forslagBoks(p) {
    const o = p.opsaetning;
    const valg = [o.autoLoeser === false ? 'løseren kun på knap' : '', o.kampVarighed === 'slot' ? 'en kamp = et helt slot' : '', o.antiSamtidighed !== false ? 'single og double ikke samtidig' : 'single og double må ligge samtidig', o.puljerunderSynkront ? 'puljerunder synkront' : '', `advar ved ventetid over ${o.maxVentetidMin ?? 90} min`].filter(Boolean).join(' · ');
    return `
        <details class="fold" data-id="avanceret-forslag">
            <summary><span class="fold-titel">Forslag og tjek</span> <span class="daempet">${esc(valg)}</span></summary>
            <div class="felter">
                <label class="felt" title='Med "minimumstid" må to 20-min-kampe for samme spiller ligge i naboslots ved 30-min slots (20 + 10 = 30); med "et helt slot" skal der være slot + pause mellem starttiderne.'><span class="etiket">En kamp regnes til</span>
                    <select data-felt="kampVarighed">
                        <option value="minimum" ${(o.kampVarighed || 'minimum') === 'minimum' ? 'selected' : ''}>reglementets minimumstid (som TP)</option>
                        <option value="slot" ${o.kampVarighed === 'slot' ? 'selected' : ''}>et helt slot (streng)</option>
                    </select></label>
                <label class="felt" title="Gælder kategorier, hvor formen er sat til 'automatisk'"><span class="etiket">Automatisk form vælger</span>
                    <select data-felt="formKriterie">
                        <option value="faerrest" ${(o.formKriterie || 'faerrest') === 'faerrest' ? 'selected' : ''}>færrest bane-slots, der opfylder minimum</option>
                        <option value="flest" ${o.formKriterie === 'flest' ? 'selected' : ''}>flest kampe pr. spiller (op til 6)</option>
                    </select></label>
            </div>
            <div class="felter">
                <label class="valg" title="Når 'Lav kampprogram' har lavet et program, der går op, sender planneren det anonymiserede regnestykke til løseren, som forbedrer det i op til den valgte tid. Du kan stoppe undervejs og fortryde bagefter."><input type="checkbox" data-opsaetning="autoLoeser" ${o.autoLoeser !== false ? 'checked' : ''}> forbedr automatisk med løseren efter "Lav kampprogram"</label>
                <label class="valg" title="Fra din gamle prompt (regel A3): i samme række må HS og HD ikke ligge samtidig, DS og DD ikke, og MD ikke sammen med nogen af dem. Tjek advarer, og forslaget undgår det."><input type="checkbox" data-opsaetning="antiSamtidighed" ${o.antiSamtidighed !== false ? 'checked' : ''}> undgå single og double samtidig i samme række</label>
                <label class="valg" title="Blødt mål i forslaget: alle puljers runde 1 spilles før runde 2 osv. inden for hvert event. Giver et mere overskueligt program, men ofte lidt længere haltid."><input type="checkbox" data-opsaetning="puljerunderSynkront" ${o.puljerunderSynkront ? 'checked' : ''}> puljerunder synkront på tværs af puljer</label>
                <label class="felt" title="Tjek advarer, når en spiller venter længere end dette mellem to af sine egne kampe samme dag. Tallet vises også i statuslinjen og under Alternativer."><span class="etiket">Advar ved ventetid over</span>
                    <input type="number" min="0" max="600" step="5" value="${o.maxVentetidMin ?? 90}" data-opsaetning-tal="maxVentetidMin"> min</label>
            </div>
        </details>`;
}

function reglerBoks(p) {
    const r = reglerFor(p);
    const std = STANDARD_REGLER;
    const aargange = [...new Set(p.raekker.map((x) => x.aargang))].sort();
    const alleAargange = [...new Set([...aargange, ...Object.keys(std.tidsvindue)])];
    let antalAendret = 0;
    const aendret = (sti, v) => {
        const s = sti.split('.').reduce((o, k) => o?.[k], std);
        if (JSON.stringify(s) === JSON.stringify(v)) return '';
        antalAendret += 1;
        return ' er-aendret';
    };
    const tal = (sti, v, tekst, enhed = '') => `
        <label class="felt regel${aendret(sti, v)}"><span class="etiket">${tekst}</span>
            <input type="number" min="0" max="999" step="1" value="${v}" data-regel="${sti}" data-type="tal"> ${enhed}</label>`;
    const tid = (sti, v, tekst) => `
        <label class="felt regel${aendret(sti, v)}"><span class="etiket">${tekst}</span>
            <input type="time" step="300" value="${esc(v)}" data-regel="${sti}" data-type="tid"></label>`;
    const vinduer = alleAargange.map((a) => `
        <tr class="${aargange.includes(a) ? '' : 'daempet'}">
            <td>${a}${aargange.includes(a) ? '' : ' <span class="daempet">(ikke i turneringen)</span>'}</td>
            <td>${tid(`tidsvindue.${a}.0`, r.tidsvindue[a][0], '')}</td>
            <td>${tid(`tidsvindue.${a}.1`, r.tidsvindue[a][1], '')}</td>
        </tr>`).join('');
    const indhold = `
            <p class="panel-sub">Standardværdierne er reglementets. Ret dem, hvis du har dispensation eller vil planlægge strammere/løsere. Pauserne står under kamplængde og pauser.</p>
            <div class="felter">
                ${tal('maxKampePrDag', r.maxKampePrDag, 'Max kampe pr. dag')}
                ${tal('maxKampePrDagEnDag', r.maxKampePrDagEnDag, 'Max kampe, éndagsturnering')}
                ${tal('foerSkoledagTimer', r.foerSkoledagTimer, 'Tidligere før skoledag', 'timer')}
                ${tal('seniorMaxPrKategori', r.seniorMaxPrKategori, 'Senior E/M pr. kategori pr. dag')}
            </div>
            <div class="felter">
                ${tal('minKampMin.ungdomABCD', r.minKampMin.ungdomABCD, 'Min. kamptid ungdom A–D', 'min')}
                ${tal('minKampMin.ungdomEM', r.minKampMin.ungdomEM, 'Ungdom E/M', 'min')}
                ${tal('minKampMin.seniorABCD', r.minKampMin.seniorABCD, 'Senior A–D', 'min')}
                ${tal('minKampMin.seniorEM', r.minKampMin.seniorEM, 'Senior E/M', 'min')}
            </div>
            <div class="felter">
                ${tal('minKampe.MA', r.minKampe.MA, 'Min. kampe M/A')}
                ${tal('minKampe.BCDSingle', r.minKampe.BCDSingle, 'B–D single')}
                ${tal('minKampe.BCDDouble', r.minKampe.BCDDouble, 'B–D double')}
                ${tal('minKampe.U9U11Single', r.minKampe.U9U11Single, 'U9/U11 single')}
                ${tal('minKampe.swissRunder', r.minKampe.swissRunder, 'Swiss Ladder-runder')}
                ${tid('eTidligst', r.eTidligst, 'E-rækker tidligst')}
                ${tid('eFinale.0', r.eFinale[0], 'E-finaler fra')}
                ${tid('eFinale.1', r.eFinale[1], 'E-finaler til')}
            </div>
            <div class="tabel-hylster">
                <table class="tabel tabel--smal">
                    <thead><tr><th>Tidsvindue pr. årgang</th><th>Fra</th><th>Til</th></tr></thead>
                    <tbody>${vinduer}</tbody>
                </table>
            </div>
            <div class="raekke-knapper" style="margin-top:14px"><button class="knap knap--sekundaer knap--lille" data-handling="nulstil-regler">Nulstil til reglementet</button></div>`;
    // Overskriften tælles efter indholdet er bygget (aendret() tæller undervejs)
    return `
        <details class="fold" data-id="avanceret-regler" ${antalAendret ? 'open' : ''}>
            <summary><span class="fold-titel">Reglementets grænser</span> ${antalAendret ? `<span class="maerke maerke--advarsel">${antalAendret} ændret</span>` : '<span class="daempet">som reglementet</span>'}</summary>
            ${indhold}
        </details>`;
}

/** Rækkefølgen af det, der må give sig, når kampprogrammet ikke går op — bestemmer, hvilken løsning der anbefales. */
function prisBoks(p) {
    const orden = prisOrden(p);
    const egen = orden.join() !== STANDARD_PRIS_ORDEN.join();
    const navn = Object.fromEntries(PRIS.map((x) => [x.id, x.navn]));
    return `
        <details class="fold" data-id="avanceret-pris">
            <summary><span class="fold-titel">Når programmet ikke går op</span> ${egen ? '<span class="maerke maerke--advarsel">egen rækkefølge</span>' : '<span class="daempet">standardrækkefølge</span>'}</summary>
            <p class="panel-sub">"Lav kampprogram" afprøver løsninger og anbefaler den, der står højest her blandt dem, der virker. Du vælger stadig selv på kortet.</p>
            <ol class="pris-liste">${orden.map((id, i) => `
                <li><span>${esc(navn[id])}</span>
                    <span class="pris-knapper">
                        <button type="button" class="knap knap--sekundaer knap--lille" data-handling="pris-op" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Flyt op">↑</button>
                        <button type="button" class="knap knap--sekundaer knap--lille" data-handling="pris-ned" data-id="${id}" ${i === orden.length - 1 ? 'disabled' : ''} aria-label="Flyt ned">↓</button>
                    </span></li>`).join('')}
            </ol>
            ${egen ? '<button type="button" class="knap knap--sekundaer knap--lille" data-handling="pris-nulstil">Brug standardrækkefølgen</button>' : ''}
        </details>`;
}

/** Bløde kriterier med vægte (kriterier.js): skabelon + enkeltvægte. */
function vaegtBoks(p) {
    const v = vaegteFor(p);
    const skabelon = p.opsaetning.vaegtSkabelon || 'standard';
    const navn = skabelon === 'egen' ? 'egne vægte' : VAEGT_SKABELONER[skabelon]?.navn || skabelon;
    return `
        <details class="fold" data-id="avanceret-vaegte" ${skabelon === 'egen' ? 'open' : ''}>
            <summary><span class="fold-titel">Bløde ønsker og vægte</span> ${skabelon === 'egen' ? `<span class="maerke maerke--advarsel">${esc(navn)}</span>` : `<span class="daempet">${esc(navn)}</span>`}</summary>
            <p class="panel-sub">Planens score er den vægtede sum af disse kriterier — lavere er bedre. Scoren vises under Program, rangerer alternativerne og er målet for "Optimér". Hårde regler (pauser, max haltid, tidsvinduer) er ikke vægte; de må aldrig brydes.</p>
            <div class="felter">
                <label class="felt"><span class="etiket">Skabelon</span>
                    <select data-felt="vaegtSkabelon">
                        ${Object.entries(VAEGT_SKABELONER).map(([id, s]) => `<option value="${id}" ${skabelon === id ? 'selected' : ''}>${esc(s.navn)}</option>`).join('')}
                        ${skabelon === 'egen' ? '<option value="egen" selected>egne vægte</option>' : ''}
                    </select></label>
            </div>
            <div class="felter">
                ${KRITERIER.map((k) => `<label class="felt" title="${esc(k.beskrivelse)}"><span class="etiket">${esc(k.navn)} (${esc(k.enhed)})</span>
                    <input type="number" min="0" max="100" step="0.1" value="${v[k.id] ?? 0}" data-vaegt="${k.id}"></label>`).join('')}
            </div>
        </details>`;
}

function raekkePanel(p) {
    const prKat = kampePrKategori(p);
    const dage = p.turnering.dage;
    const blokke = p.raekker.map((r) => {
        const kategorier = p.kategorier.filter((k) => k.raekke === r.id);
        const kampe = kategorier.reduce((sum, k) => sum + (prKat.get(k.id)?.ialt || 0), 0);
        const flereDage = r.dage.length > 1;
        const kraeverDisp = flereDage && (['B', 'C', 'D'].includes(r.raekke) || (r.aargang === 'U11' && r.raekke === 'A'));
        const dagValg = dage.map((d) => `
                    <label class="valg"><input type="checkbox" data-raekke-dag="${d}" data-raekke="${esc(r.id)}" ${r.dage.includes(d) ? 'checked' : ''}> ${datoTekst(d, { kort: true })}</label>`).join('');
        const maerker = [
            !r.dage.length ? '<span class="maerke maerke--fejl">ingen dag valgt</span>' : '',
            kraeverDisp ? (r.dispensationFlereDage ? '<span class="maerke maerke--ok">dispensation givet</span>' : '<span class="maerke maerke--advarsel">kræver dispensation</span>') : '',
        ].filter(Boolean).join(' ');
        // Det, der er sat i den foldede del, vises i overskriften, så man ikke skal folde ud for at se det
        const sat = [
            r.tidligst || r.senest ? `${r.tidligst || '–'}–${r.senest || '–'}` : '',
            r.reserveredeBaner ? `${r.reserveredeBaner} reserverede baner${kategorier.some((k) => k.halvBane) ? ` (${r.reserveredeBaner * 2} halve)` : ''}` : '',
            r.maxHaltidMin ? `singler max ${r.maxHaltidMin} min` : '',
            r.maxDage ? `max ${r.maxDage} ${r.maxDage === 1 ? 'dag' : 'dage'}` : '',
            minKampeSamlet(r) ? 'min. kampe samlet' : '',
            kategorier.some((k) => (k.formValg || 'tp') !== 'tp') ? 'planneren bygger kampe' : '',
        ].filter(Boolean).join(' · ');
        return `
        <div class="raekke-blok">
            <div class="raekke-blok-hoved">
                <h3>${esc(r.id)} <span class="maerke">pause ${r.pauseKlasse}</span> ${maerker}</h3>
                <span class="daempet">${kategorier.length} ${kategorier.length === 1 ? 'kategori' : 'kategorier'} · ${kampe} kampe</span>
            </div>
            <div class="raekke-indstillinger">
                <div class="felt"><span class="etiket">Spilledage</span>
                    <div class="valg-gruppe">${dagValg}</div></div>
            </div>
            <div class="tabel-hylster">
                <table class="tabel tabel--kategorier tabel--kategorier-kort">
                    <thead><tr><th>Kategori</th><th>Form</th><th class="tal">Tilmeldte</th><th class="tal">Kampe</th><th>Fordeling</th><th class="tal">Med tid</th></tr></thead>
                    <tbody>${kategorier.map((k) => kategoriLinje(k, prKat)).join('')}</tbody>
                </table>
            </div>
            <details class="fold raekke-fold" data-id="raekke-${esc(r.id)}">
                <summary><span class="fold-titel">Flere indstillinger</span> <span class="daempet">${esc(sat || 'tidsrum, reserverede baner, turneringsform, prioritet …')}</span></summary>
                <div class="raekke-indstillinger">
                    <div class="felt" title="Valgfrit: rækkens eget tidsrum på dagen (fx U9 kun 12:00–17:00). Forslaget holder sig inden for det; Tjek advarer, hvis kampe ligger udenfor."><span class="etiket">Tidsrum (valgfrit)</span>
                        <div class="valg-gruppe"><input type="time" step="300" value="${esc(r.tidligst || '')}" data-raekke-tid="tidligst" data-raekke="${esc(r.id)}" aria-label="Tidligst">–<input type="time" step="300" value="${esc(r.senest || '')}" data-raekke-tid="senest" data-raekke="${esc(r.id)}" aria-label="Senest"></div></div>
                    <label class="felt" title="Valgfrit: baner der er reserveret til rækken i dens tidsrum (hele dagen, hvis intet tidsrum). Rækken bruger kun dem, og de øvrige rækker deler resten — fx 5 baner til U9, der deles i 10 halve."><span class="etiket">Reserverede baner</span>
                        <input type="number" min="0" max="60" value="${r.reserveredeBaner || 0}" data-raekke-baner="${esc(r.id)}"></label>
                    <label class="felt" title="Hård regel: højst så mange minutter til afviklingen af rækkens SINGLEKAMPE — fra dagens første til dagens sidste singlekamp (U9/U11-vejledningen: U9 240, U11 360; doublerne tæller ikke med). Forslaget og løseren overholder den; Tjek melder brud som fejl."><span class="etiket">Max varighed, singler</span>
                        <input type="number" min="0" max="900" step="30" value="${r.maxHaltidMin ?? ''}" data-raekke-tal="maxHaltidMin" data-raekke="${esc(r.id)}"> min</label>
                    <label class="felt" title="Hård regel: højst så mange spilledage (tomt = ingen grænse)."><span class="etiket">Max dage</span>
                        <input type="number" min="0" max="9" step="1" value="${r.maxDage ?? ''}" data-raekke-tal="maxDage" data-raekke="${esc(r.id)}"></label>
                    <div class="felt"><span class="etiket">Valg</span>
                        <div class="valg-gruppe valg-gruppe--lodret">
                            <label class="valg" title="AFVIGER FRA REGLEMENTET, som stiller minimumskravet pr. kategori (fx 3 kampe i single OG 2 i double). Sættes flueben, tælles spillerens single, double og mix i stedet sammen — i Tjek, i nedskæringsforslagene, og når planneren selv vælger turneringsform."><input type="checkbox" data-min-samlet="${esc(r.id)}" ${minKampeSamlet(r) ? 'checked' : ''}> min. kampe tælles samlet</label>
                            ${kraeverDisp ? `<label class="valg"><input type="checkbox" data-disp="${esc(r.id)}" ${r.dispensationFlereDage ? 'checked' : ''}> dispensation til flere dage</label>` : ''}
                        </div></div>
                </div>
                <div class="tabel-hylster">
                    <table class="tabel tabel--kategorier">
                        <colgroup><col class="k-navn"><col class="k-form"><col class="k-valg"></colgroup>
                        <thead><tr><th>Kategori</th><th>Turneringsform</th><th>Valg</th></tr></thead>
                        <tbody>${kategorier.map((k) => kategoriIndstillinger(k)).join('')}</tbody>
                    </table>
                </div>
            </details>
        </div>`;
    }).join('');
    return `
    <section class="panel" id="afsnit-raekker">
        <h2>Rækker og kategorier</h2>
        <p class="panel-sub">Vælg hvilke dage hver række spiller. Turneringsformen kommer fra TP's lodtrækning; under "Flere indstillinger" kan planneren bygge kampene selv, og rækken kan få sit eget tidsrum og reserverede baner.</p>
        ${blokke}
    </section>`;
}

/** Den synlige linje pr. kategori: form, tilmeldte og kampe. */
function kategoriLinje(k, prKat) {
    const t = prKat.get(k.id) || { pulje: 0, cup: 0, swiss: 0, ialt: 0, medTid: 0 };
    const fordeling = [t.pulje ? `${t.pulje} pulje` : '', t.cup ? `${t.cup} cup` : '', t.swiss ? `${t.swiss} Swiss` : ''].filter(Boolean).join(' + ');
    const formValg = k.formValg || 'tp';
    const form = formValg === 'tp'
        ? `${esc(FORM_TEKST[k.form] || k.form)}${k.runder ? ` · ${k.runder} runder` : ''}`
        : `<span class="${k.formForslag?.opfylderKrav === false ? 'maerke maerke--advarsel' : ''}">${esc(formTekst(k.formForslag))}</span> <span class="maerke">planneren</span>`;
    return `
                <tr>
                    <td><strong>${esc(k.id)}</strong>${k.halvBane ? ' <span class="daempet">½ bane</span>' : ''}</td>
                    <td class="kan-bryde">${form}</td>
                    <td class="tal">${k.tilmelde}</td>
                    <td class="tal">${t.ialt}</td>
                    <td class="daempet kan-bryde">${fordeling}</td>
                    <td class="tal">${t.medTid}</td>
                </tr>`;
}

/** De foldede indstillinger pr. kategori: turneringsform, prioritet, halv bane og Swiss-valg. */
function kategoriIndstillinger(k) {
    const formValg = k.formValg || 'tp';
    const pc = k.formForslag?.form === 'pulje-cup';
    const swiss = k.formValg === 'swiss' || k.formForslag?.form === 'swiss';
    return `
                <tr>
                    <td><strong>${esc(k.id)}</strong></td>
                    <td class="kan-bryde">
                        <select data-form="${esc(k.id)}" title="Turneringsform: 'fra TP' bruger filens lodtrækning. Ellers bygger planneren selv kampene ud fra tilmeldingerne — 'automatisk' vælger den form, der opfylder reglementets minimum med færrest bane-slots.">
                            ${FORM_VALG.map((v) => `<option value="${v}" ${formValg === v ? 'selected' : ''}>${esc(FORM_VALG_TEKST[v])}</option>`).join('')}
                        </select>
                        ${pc && formValg !== 'tp' ? `<select data-cuptop="${esc(k.id)}" title="Hvem går videre fra puljerne til cuppen"><option value="1" ${(k.cupTop || 1) === 1 ? 'selected' : ''}>cup for vinderne</option><option value="2" ${k.cupTop === 2 ? 'selected' : ''}>cup for de to bedste</option></select>` : ''}
                        ${swiss && formValg !== 'tp' ? `<select data-swissrunder="${esc(k.id)}" title="Antal runder i Swiss Ladder. 'automatisk' vælger 4–6 efter reglementet og skærer ned, hvis kapaciteten ikke rækker — men holder øje med, at spillerne når minimum, når deres double- og mixkampe tælles med.">
                            <option value="0" ${!(k.swissRunder > 0) ? 'selected' : ''}>runder: automatisk</option>
                            ${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<option value="${n}" ${k.swissRunder === n ? 'selected' : ''}>${n} ${n === 1 ? 'runde' : 'runder'}</option>`).join('')}
                        </select>` : ''}
                    </td>
                    <td class="kan-bryde">
                        <select data-prioritet="${esc(k.id)}" title="Forrang i forslaget: kategorier med høj prioritet får plads først, lav prioritet fylder op til sidst">
                            <option value="1" ${k.prioritet === 1 ? 'selected' : ''}>høj prioritet</option>
                            <option value="0" ${!k.prioritet ? 'selected' : ''}>normal prioritet</option>
                            <option value="-1" ${k.prioritet === -1 ? 'selected' : ''}>lav prioritet</option>
                        </select>
                        ${k.aargang === 'U09' ? `<label class="valg" title="Kun U9 spiller på halv bane (single som standard). En hel bane deles i to halve."><input type="checkbox" data-halv="${esc(k.id)}" ${k.halvBane ? 'checked' : ''}> halv bane</label>` : ''}
                        ${effektivForm(k).form === 'swiss' ? `<label class="valg" title="Swiss Ladder: næste runde må begynde i slottet lige efter forrige rundes sidste kamp, uden pause imellem. Pausen mod kampe i andre kategorier gælder stadig."><input type="checkbox" data-swiss-uden-pause="${esc(k.id)}" ${k.swissUdenPause ? 'checked' : ''}> runder lige efter hinanden</label>` : ''}
                    </td>
                </tr>`;
}

/** Opskrift til lodtrækningen i TP for kategorier, hvor planneren selv har bygget kampene (vises i trin 4, Til TP). */
export function opskriftPanel(p) {
    // Vises kun, når mindst én kategori har en anden form end TP's (valget af form står ud for kategorien)
    const egne = p.kategorier.filter((k) => (k.formValg || 'tp') !== 'tp');
    if (!egne.length) return '';
    return `
    <section class="panel">
        <h2>Turneringsform: opskrift til lodtrækningen i TP <span class="maerke">${egne.length}</span></h2>
        <p class="panel-sub">Disse kategorier bruger planneren-byggede kampe (puljer á 3–5 seedet efter ranglistepoint, Swiss Ladder 4–6 runder). Lav lodtrækningen sådan i TP, gem filen og åbn den igen — så bruges TP's kampe, og "Lav kampprogram" laver planen forfra for dem.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Kategori</th><th>Valg</th><th class="tal">Tilmeldte</th><th>Sådan i TP</th><th class="tal">Kampe</th><th class="tal">Bane-slots</th><th>Kampe pr. spiller</th></tr></thead>
                <tbody>${egne.map((k) => {
                    const f = k.formForslag;
                    const n = (p.tilmeldinger?.[k.id] || []).length;
                    return `<tr>
                        <td>${esc(k.id)}</td>
                        <td>${esc(FORM_VALG_TEKST[k.formValg])}</td>
                        <td class="tal">${n}</td>
                        <td class="kan-bryde">${f ? esc(f.tekst) : '<span class="daempet">ingen kampe (under 2 tilmeldte)</span>'}</td>
                        <td class="tal">${f ? f.kampe : 0}</td>
                        <td class="tal">${f ? tal(f.baneSlots, f.baneSlots % 1 ? 1 : 0) : 0}</td>
                        <td>${f ? `${f.minKampe}–${f.maxKampe}${f.opfylderKrav ? ` <span class="maerke maerke--ok">≥ ${f.krav}</span>` : ` <span class="maerke maerke--advarsel">under kravet på ${f.krav}</span>`}` : ''}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>
    </section>`;
}

function kapacitetPanel(p) {
    const k = kapacitetPrDag(p);
    const rows = k.dage.map((d) => {
        const u = d.udnyttelse;
        const klasse = u > 1 ? 'er-over' : u > FYLDNINGSGRAD ? '' : 'er-ok';
        const maerke = u > 1 ? '<span class="maerke maerke--fejl">for mange kampe</span>' : u > FYLDNINGSGRAD ? '<span class="maerke maerke--advarsel">tæt på</span>' : '<span class="maerke maerke--ok">plads</span>';
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
    <section class="panel" id="afsnit-kapacitet">
        <h2>Kapacitet</h2>
        <p class="panel-sub">Bane-slots til rådighed mod de kampe, rækkernes dage lægger på dagen. "Faste" er kampe i rækker, der kun spiller den dag; "fleksible" spiller over flere dage og er delt ligeligt i "fordelt". U9-singler på halv bane tæller ½. Udnyttelse over ca. 85 % bliver svær at få til at gå op med pauser og rækkefølge.</p>
        <div class="tabel-hylster">
            <table class="tabel">
                <thead><tr><th>Dag</th><th class="tal">Slots</th><th class="tal">Bane-slots</th><th class="tal">Faste</th><th class="tal">Fleksible</th><th class="tal">Fordelt</th><th>Udnyttelse</th><th class="tal"></th><th class="tal">Planlagte</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${k.udenDag ? `<p class="besked fejl">${k.udenDag} kampe hører til rækker uden valgt dag.</p>` : ''}
        <div class="videre">
            <span class="daempet">Planneren vælger selv kamplængde og pause og laver det bedste program. Går det ikke op, får du valgmuligheder.</span>
            <button type="button" class="knap knap--sekundaer" data-handling="vis-plan">Gå til Plan</button>
            <button type="button" class="knap" data-handling="lav-kampprogram">Lav kampprogram →</button>
        </div>
    </section>`;
}

// ── Hændelser ─────────────────────────────────────────────────

function bind(container, projekt, h) {
    // Filzonen og filfelterne gentegnes, så alt går via delegering på beholderen.
    const zone = (e) => e.target.closest?.('#filzone, [data-filzone]');
    container.addEventListener('dragover', (e) => { const z = zone(e); if (z) { e.preventDefault(); z.classList.add('er-over'); } });
    container.addEventListener('dragleave', (e) => { const z = zone(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('er-over'); });
    container.addEventListener('drop', (e) => {
        const z = zone(e);
        if (!z) return;
        e.preventDefault();
        z.classList.remove('er-over');
        const fil = e.dataTransfer.files[0];
        if (!fil) return;
        if (/\.json$/i.test(fil.name)) h.aabnProjekt(fil); else h.aabnTP(fil);
    });

    container.addEventListener('click', (e) => {
        // Hop-links: rul til afsnittet uden at ændre adressen
        const link = e.target.closest('[data-afsnit]');
        if (link) {
            e.preventDefault();
            document.getElementById(link.dataset.afsnit)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        const knap = e.target.closest('[data-handling]');
        if (!knap) return;
        const { handling, dato, index } = knap.dataset;
        if (handling === 'gem-projekt') h.gemProjekt();
        else if (handling === 'start-forfra') h.startForfra();
        else if (handling === 'vis-plan') h.visPlan();
        else if (handling === 'lav-kampprogram') h.lavKampprogram();
        else if (handling === 'gaa-fil') h.gaaTil('fil');
        else if (handling === 'gaa-turnering') h.gaaTil('opsaetning');
        else if (handling === 'form-valg') h.form(knap.dataset.kat, { formValg: knap.dataset.formValg });
        else if (handling === 'kvitter-form') h.kvitter(knap.dataset.noegle);
        else if (handling === 'pris-op' || handling === 'pris-ned') {
            const orden = prisOrden(projekt());
            const i = orden.indexOf(knap.dataset.id), j = i + (handling === 'pris-op' ? -1 : 1);
            if (i < 0 || j < 0 || j >= orden.length) return;
            [orden[i], orden[j]] = [orden[j], orden[i]];
            h.prisOrden(orden);
        } else if (handling === 'pris-nulstil') h.prisOrden([]);
        else if (handling === 'nulstil-regler') h.nulstilRegler();
        else if (handling === 'brug-kamplaengde') {
            // Fra sammenligningen: kamplængde og pause; fra anbefalingen: kun kamplængden
            if (knap.dataset.udenPause !== undefined) h.brugKamplaengde(Number(knap.dataset.min), knap.dataset.udenPause === '1');
            else h.slotMin(Number(knap.dataset.min));
        }
        else if (handling === 'sammenlign-kamplaengder') h.sammenlignKamplaengder();
        else if (handling === 'fjern-spaerring') {
            const dag = projekt().opsaetning.dage.find((d) => d.dato === dato);
            h.dag(dato, { spaerret: dag.spaerret.filter((_, i) => i !== Number(index)) });
        } else if (handling === 'tilfoej-spaerring') {
            const felt = (navn) => container.querySelector(`[data-ny="${navn}"][data-dato="${dato}"]`);
            const fra = felt('fra').value, til = felt('til').value, baner = Number(felt('baner').value) || 1;
            if (!fra || !til || til <= fra) { h.besked('Angiv fra og til for spærringen (til skal være efter fra).', true); return; }
            const dag = projekt().opsaetning.dage.find((d) => d.dato === dato);
            h.dag(dato, { spaerret: [...(dag.spaerret || []), { fra, til, baner }].sort((a, b) => a.fra.localeCompare(b.fra)) });
        }
    });

    container.addEventListener('change', (e) => {
        const el = e.target;
        if (el instanceof HTMLSelectElement) {
            if (el.dataset.felt === 'kampVarighed') h.opsaetning({ kampVarighed: el.value });
            else if (el.dataset.felt === 'formKriterie') h.formKriterie(el.value);
            else if (el.dataset.felt === 'vaegtSkabelon') { if (el.value !== 'egen') h.vaegtSkabelon(el.value); }
            else if (el.dataset.prioritet) h.kategori(el.dataset.prioritet, { prioritet: Number(el.value) || 0 });
            else if (el.dataset.form) h.form(el.dataset.form, { formValg: el.value });
            else if (el.dataset.cuptop) h.form(el.dataset.cuptop, { cupTop: Number(el.value) || 1 });
            else if (el.dataset.swissrunder) h.form(el.dataset.swissrunder, { swissRunder: Number(el.value) || 0 });
            return;
        }
        if (!(el instanceof HTMLInputElement)) return;
        if (el.dataset.opsaetning) { h.opsaetning({ [el.dataset.opsaetning]: el.checked }); return; }
        if (el.dataset.opsaetningTal) { h.opsaetning({ [el.dataset.opsaetningTal]: Math.max(0, Number(el.value) || 0) }); return; }
        if (el.id === 'tpFil' || el.id === 'projektFil') {
            const fil = el.files[0];
            if (fil) (el.id === 'tpFil' ? h.aabnTP : h.aabnProjekt)(fil);
            el.value = '';
            return;
        }
        const d = el.dataset;
        if (d.regel) {
            if (d.type === 'tal') h.regler(d.regel, Math.max(0, Number(el.value) || 0));
            else if (el.value) h.regler(d.regel, el.value);
            return;
        }
        if (d.vaegt) { h.vaegt(d.vaegt, el.value); return; }
        if (d.raekkeTal) { h.raekke(d.raekke, { [d.raekkeTal]: el.value === '' || Number(el.value) <= 0 ? null : Number(el.value) }); return; }
        if (d.raekkeTid) { h.raekke(d.raekke, { [d.raekkeTid]: el.value || null }); return; }
        if (d.raekkeBaner) { h.raekke(d.raekkeBaner, { reserveredeBaner: Math.max(0, Number(el.value) || 0) }); return; }
        if (d.skoledag) h.dag(d.skoledag, { foerSkoledag: el.checked });
        else if (d.felt === 'slotMin') h.slotMin(el.value);
        else if (d.felt && d.dato) {
            if (d.felt === 'baner') h.dag(d.dato, { baner: Math.max(1, Number(el.value) || 1) });
            else if (el.value) h.dag(d.dato, { [d.felt]: el.value });
        } else if (d.pause) h.pause(d.pause, el.value);
        else if (d.raekkeDag) {
            const r = projekt().raekker.find((x) => x.id === d.raekke);
            const dage = el.checked ? [...new Set([...r.dage, d.raekkeDag])].sort() : r.dage.filter((x) => x !== d.raekkeDag);
            h.raekke(d.raekke, { dage });
        } else if (d.disp) h.raekke(d.disp, { dispensationFlereDage: el.checked });
        else if (d.minSamlet) h.minKampeSamlet(d.minSamlet, el.checked);
        else if (d.halv) h.kategori(d.halv, { halvBane: el.checked });
        else if (d.swissUdenPause) h.kategori(d.swissUdenPause, { swissUdenPause: el.checked });
    });
}
