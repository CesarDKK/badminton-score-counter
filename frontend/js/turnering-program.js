/**
 * Turneringsprogrammet på telefonen (oversigt.html; Jesper 2026-11-27).
 *
 * Oversigten viser "her og nu" på hallens TV. Åbnes den på en telefon, mens en
 * turnering er i gang, får den tre faner øverst:
 *   Afsluttet — de spillede kampe med resultat, nyeste først
 *   Nu        — den almindelige oversigt (banerne lige nu)
 *   Program   — kampe i gang og kommende, efter TS' planlagte tid
 * Man kan søge en spiller eller klub frem, trykke på et navn for at se den
 * spillers kampe (fx modstanderens), og telefonen kan huske "mig".
 *
 * Fanerne må aldrig komme på TV'et: de vises kun på en enhed, hvor berøring er
 * den primære indtastning (ingen mus), aldrig fra kiosk-PC'en (?skaerm= /
 * ?kioskversion=) eller et adgangslink — eller når adressen selv beder om det
 * (?vis=program / afsluttet / nu, fx fra en QR-plakat).
 */
(function () {
    const FANER = ['afsluttet', 'nu', 'program'];
    const OPDATER_MS = 30 * 1000;
    const MIG_NOEGLE = 'tpMig';
    const FOER_TID = ' (afsluttet før tid)';

    const tilstand = {
        fane: 'nu',
        data: [],          // [{ id, navn, kampe, klubber }]
        hentet: 0,
        turneringId: null,
        tekst: '',
        valgt: null,       // { type: 'spiller' | 'klub', navn }
        mig: null
    };
    let timer = null;
    let henter = null;

    // ── Rene hjælpere (testes i backend/tests/unit/turnering-program.test.js) ──

    function norm(s) {
        return String(s || '').toLocaleLowerCase('da').normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    }

    function esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function spillere(k) { return [...(k.side1 || []), ...(k.side2 || [])]; }

    // Passer kampen til filteret? valgt (præcis spiller/klub) går forud for fritekst
    function passer(k, klubber, tekst, valgt) {
        if (valgt) {
            if (valgt.type === 'spiller') return spillere(k).includes(valgt.navn);
            return spillere(k).some(n => klubber[n] === valgt.navn);
        }
        const q = norm(tekst);
        if (!q) return true;
        return spillere(k).some(n => norm(n).includes(q) || norm(klubber[n]).includes(q))
            || norm(k.raekke).includes(q);
    }

    // Forslag mens man skriver: spillere og klubber, hvis navn indeholder teksten
    function forslag(turnering, tekst, max = 8) {
        const q = norm(tekst);
        if (!q || !turnering) return { spillere: [], klubber: [] };
        const sp = new Set(), kl = new Set();
        for (const k of turnering.kampe) {
            for (const n of spillere(k)) {
                if (norm(n).includes(q)) sp.add(n);
                const c = turnering.klubber[n];
                if (c && norm(c).includes(q)) kl.add(c);
            }
        }
        const sorter = (a, b) => {
            // Navne, der starter med teksten, først
            const sa = norm(a).startsWith(q) ? 0 : 1, sb = norm(b).startsWith(q) ? 0 : 1;
            return sa - sb || a.localeCompare(b, 'da');
        };
        return { spillere: [...sp].sort(sorter).slice(0, max), klubber: [...kl].sort(sorter).slice(0, 3) };
    }

    // "2026-11-21 09:30" → { dag: '2026-11-21', kl: '09:30' }
    function delTid(tid) {
        const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/.exec(tid || '');
        return m ? { dag: m[1], kl: m[2] } : null;
    }

    function dagTekst(dag) {
        const [y, mo, d] = dag.split('-').map(Number);
        const t = new Date(y, mo - 1, d).toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long' });
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    // Lokal dato (YYYY-MM-DD) og klokkeslæt for et ISO-tidspunkt
    function lokalTid(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return null;
        const p = (n) => String(n).padStart(2, '0');
        return { dag: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, kl: `${p(d.getHours())}:${p(d.getMinutes())}` };
    }

    // Programmet: i gang + venter, efter planlagt tid (uden tid sidst)
    function programKampe(kampe) {
        return kampe.filter(k => k.status !== 'finished').sort((a, b) => {
            if (!a.tid !== !b.tid) return a.tid ? -1 : 1;
            return (a.tid || '').localeCompare(b.tid || '') || a.id - b.id;
        });
    }

    // Afsluttet: nyeste først
    function afsluttedeKampe(kampe) {
        return kampe.filter(k => k.status === 'finished').sort((a, b) =>
            (b.slut || '').localeCompare(a.slut || '') || (b.tid || '').localeCompare(a.tid || '') || b.id - a.id);
    }

    // Sættene set fra side 1: [[21,15],[18,21]] — strengen er "A 21-15 B, A 18-21 B"
    // med navnene på den side, der stod til venstre i sættet
    function saetFraSide1(k) {
        const raa = String(k.saet || '').replace(FOER_TID, '');
        if (!raa || raa === 'W.O.') return [];
        const side1 = norm((k.side1 || []).join(' / '));
        const navne = (s) => norm(String(s).replace(/\s*[/&]\s*/g, ' / '));
        return raa.split(', ').map(del => {
            const m = /^(.*?)\s*(\d+)-(\d+)\s*(.*?)$/.exec(del.trim());
            if (!m) return null;
            const a = Number(m[2]), b = Number(m[3]);
            return m[4] && navne(m[4]) === side1 && navne(m[1]) !== side1 ? [b, a] : [a, b];
        }).filter(Boolean);
    }

    // Grupperer en sorteret liste efter dag og klokkeslæt
    function grupper(kampe, tidAf) {
        const dage = [];
        for (const k of kampe) {
            const t = tidAf(k);
            const dag = t ? t.dag : '';
            const kl = t ? t.kl : '';
            let d = dage[dage.length - 1];
            if (!d || d.dag !== dag) dage.push(d = { dag, tider: [] });
            let g = d.tider[d.tider.length - 1];
            if (!g || g.kl !== kl) d.tider.push(g = { kl, kampe: [] });
            g.kampe.push(k);
        }
        return dage;
    }

    // ── Skal fanerne vises? ──

    function erTelefon() {
        return !!(window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches);
    }

    function erSkaerm(p) {
        if (p.has('skaerm') || p.has('kioskversion')) return true;
        try { return !!sessionStorage.getItem('deviceToken'); } catch { return false; }
    }

    function valgtFane(p) {
        const v = (p.get('vis') || '').toLowerCase();
        return FANER.includes(v) ? v : null;
    }

    // ── Data ──

    async function hent(tving) {
        if (henter) return henter;
        if (!tving && Date.now() - tilstand.hentet < 10 * 1000) return;
        henter = (async () => {
            try {
                const data = await window.BadmintonAPI.getTurneringsprogram();
                if (Array.isArray(data)) {
                    tilstand.data = data;
                    tilstand.hentet = Date.now();
                    if (!data.some(t => t.id === tilstand.turneringId)) tilstand.turneringId = data[0] ? data[0].id : null;
                    saetFejl(false);
                }
            } catch {
                saetFejl(!!tilstand.hentet);
            } finally {
                henter = null;
            }
        })();
        return henter;
    }

    function turnering() {
        return tilstand.data.find(t => t.id === tilstand.turneringId) || null;
    }

    // ── Opbygning ──

    function byg() {
        document.body.classList.add('ov-faner');
        const nav = document.createElement('nav');
        nav.className = 'tp-faner';
        nav.setAttribute('role', 'tablist');
        nav.setAttribute('aria-label', 'Turnering');
        nav.innerHTML = [['afsluttet', 'Afsluttet'], ['nu', 'Nu'], ['program', 'Program']]
            .map(([id, tekst]) => `<button type="button" role="tab" class="tp-fane" data-fane="${id}" id="tpFane-${id}" aria-controls="${id === 'nu' ? 'ovNu' : 'tpVisning'}">${tekst}</button>`)
            .join('');
        nav.addEventListener('click', (e) => {
            const b = e.target.closest('[data-fane]');
            if (b) visFane(b.dataset.fane, true);
        });
        document.body.insertBefore(nav, document.body.firstChild);

        const sek = document.createElement('section');
        sek.className = 'tp-visning';
        sek.id = 'tpVisning';
        sek.setAttribute('role', 'tabpanel');
        sek.innerHTML = `
            <div class="tp-top">
                <div class="tp-turneringer" id="tpTurneringer"></div>
                <div class="tp-soeg">
                    <label class="tp-skjult" for="tpSoeg">Søg spiller eller klub</label>
                    <input type="search" id="tpSoeg" class="tp-soeg__felt" placeholder="Søg spiller eller klub" autocomplete="off" enterkeyhint="search">
                </div>
                <div class="tp-filter" id="tpFilter"></div>
            </div>
            <div class="tp-fejl" id="tpFejl" hidden>Kunne ikke hente programmet — prøver igen.</div>
            <div class="tp-liste" id="tpListe" aria-live="polite"></div>`;
        document.body.insertBefore(sek, nav.nextSibling);

        const container = document.querySelector('.overview-container');
        if (container) {
            container.id = container.id || 'ovNu';
            const tom = document.createElement('div');
            tom.className = 'tp-nu-tom';
            tom.textContent = 'Ingen kampe på banerne lige nu.';
            container.appendChild(tom);
        }

        const felt = sek.querySelector('#tpSoeg');
        felt.addEventListener('input', () => {
            tilstand.tekst = felt.value;
            tilstand.valgt = null;
            tegn();
        });
        sek.addEventListener('click', (e) => {
            const el = e.target.closest('[data-handling]');
            if (!el) return;
            const h = el.dataset.handling;
            if (h === 'spiller' || h === 'klub') vaelg({ type: h, navn: el.dataset.navn });
            else if (h === 'ryd') { vaelg(null); felt.focus(); }
            else if (h === 'mig') saetMig(tilstand.valgt && tilstand.valgt.navn !== tilstand.mig ? tilstand.valgt.navn : null);
            else if (h === 'turnering') { tilstand.turneringId = Number(el.dataset.id); tegn(); }
        });
    }

    function vaelg(valgt) {
        tilstand.valgt = valgt;
        tilstand.tekst = '';
        const felt = document.getElementById('tpSoeg');
        if (felt) { felt.value = ''; if (valgt) felt.blur(); }
        tegn();
        if (valgt) window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function saetMig(navn) {
        tilstand.mig = navn;
        try {
            if (navn) localStorage.setItem(MIG_NOEGLE, navn);
            else localStorage.removeItem(MIG_NOEGLE);
        } catch { /* privat vindue — huskes bare ikke */ }
        tegn();
    }

    function saetFejl(vis) {
        const el = document.getElementById('tpFejl');
        if (el) el.hidden = !vis;
    }

    function visFane(fane, afBruger) {
        tilstand.fane = fane;
        document.body.classList.toggle('tp-liste-vist', fane !== 'nu');
        document.querySelectorAll('.tp-fane').forEach(b => {
            const valgt = b.dataset.fane === fane;
            b.classList.toggle('tp-fane--valgt', valgt);
            b.setAttribute('aria-selected', valgt ? 'true' : 'false');
        });
        try {
            const url = new URL(location.href);
            url.searchParams.set('vis', fane);
            history.replaceState(null, '', url);
        } catch { /* ok */ }
        if (afBruger) window.scrollTo(0, 0);
        if (fane !== 'nu') {
            tegn();
            hent(false).then(tegn);
        }
        planlaeg();
    }

    function planlaeg() {
        clearTimeout(timer);
        if (tilstand.fane === 'nu' || document.hidden) return;
        timer = setTimeout(async () => {
            await hent(true);
            tegn();
            planlaeg();
        }, OPDATER_MS);
    }

    // ── Tegning ──

    function navnKnap(navn, klubber, fremhaev) {
        const klub = klubber[navn];
        return `<button type="button" class="tp-navn${fremhaev ? ' tp-navn--valgt' : ''}" data-handling="spiller" data-navn="${esc(navn)}">${esc(navn)}</button>`
            + (klub ? `<span class="tp-klub">${esc(klub)}</span>` : '');
    }

    function sideHtml(navne, klubber, valgt) {
        if (!navne.length) return '<span class="tp-ukendt">Ikke kendt endnu</span>';
        return navne.map(n => `<span class="tp-spiller">${navnKnap(n, klubber, valgt && valgt.type === 'spiller' && valgt.navn === n)}</span>`).join('');
    }

    function programKort(k, klubber, valgt) {
        const status = k.status === 'active'
            ? `<span class="tp-maerke tp-maerke--igang">${k.bane ? `Bane ${esc(k.bane)} · ` : ''}i gang</span>`
            : '';
        return `
        <article class="tp-kort${k.status === 'active' ? ' tp-kort--igang' : ''}">
            <div class="tp-kort__hoved">
                <span class="tp-raekke">${esc(k.raekke || 'Kamp')}</span>${status}
            </div>
            <div class="tp-side">${sideHtml(k.side1, klubber, valgt)}</div>
            <div class="tp-mod">mod</div>
            <div class="tp-side">${sideHtml(k.side2, klubber, valgt)}</div>
        </article>`;
    }

    function resultatKort(k, klubber, valgt) {
        const wo = k.saet === 'W.O.';
        const foerTid = String(k.saet || '').endsWith(FOER_TID);
        const saet = saetFraSide1(k);
        const slut = k.slut ? lokalTid(k.slut) : null;
        const raekke = (side, nr) => {
            const vandt = k.vinder === nr;
            const tal = saet.map(s => {
                const mine = s[nr - 1], deres = s[2 - nr];
                return `<span class="tp-tal${mine > deres ? ' tp-tal--vundet' : ''}">${mine}</span>`;
            }).join('');
            return `
            <div class="tp-resultat__raekke${vandt ? ' tp-resultat__raekke--vinder' : ''}">
                <div class="tp-side">${sideHtml(side, klubber, valgt)}</div>
                <div class="tp-tallene">${tal}</div>
                <span class="tp-vinder" aria-label="${vandt ? 'Vandt' : ''}">${vandt ? '✓' : ''}</span>
            </div>`;
        };
        const note = wo ? 'Walkover' : foerTid ? 'Afsluttet før tid' : (!saet.length ? 'Spillet' : '');
        return `
        <article class="tp-kort tp-kort--resultat">
            <div class="tp-kort__hoved">
                <span class="tp-raekke">${esc(k.raekke || 'Kamp')}</span>
                <span class="tp-tid-lille">${note ? `${note}${slut ? ' · ' : ''}` : ''}${slut ? `kl. ${slut.kl}` : ''}</span>
            </div>
            ${raekke(k.side1 || [], 1)}
            ${raekke(k.side2 || [], 2)}
        </article>`;
    }

    function tegnTurneringer() {
        const el = document.getElementById('tpTurneringer');
        if (!el) return;
        const t = turnering();
        if (tilstand.data.length > 1) {
            el.innerHTML = tilstand.data.map(x => `<button type="button" class="tp-chip${x.id === tilstand.turneringId ? ' tp-chip--valgt' : ''}" data-handling="turnering" data-id="${x.id}">${esc(x.navn)}</button>`).join('');
        } else {
            el.innerHTML = t ? `<h1 class="tp-titel">${esc(t.navn)}</h1>` : '';
        }
    }

    function tegnFilter(t) {
        const el = document.getElementById('tpFilter');
        if (!el) return;
        const v = tilstand.valgt;
        if (v) {
            const erMig = v.type === 'spiller' && v.navn === tilstand.mig;
            const klub = v.type === 'spiller' && t ? t.klubber[v.navn] : null;
            el.innerHTML = `
                <div class="tp-valgt">
                    <div class="tp-valgt__navn">
                        <span class="tp-valgt__hvem">${v.type === 'klub' ? 'Klub' : erMig ? 'Mine kampe' : 'Spiller'}</span>
                        <strong>${esc(v.navn)}</strong>${klub ? ` <span class="tp-klub">${esc(klub)}</span>` : ''}
                    </div>
                    <button type="button" class="tp-knap" data-handling="ryd">Vis alle</button>
                </div>
                ${v.type === 'spiller' ? `<button type="button" class="tp-mig${erMig ? ' tp-mig--valgt' : ''}" data-handling="mig" aria-pressed="${erMig}">
                    ${erMig ? '★ Det er mig — telefonen husker det' : '☆ Det er mig — husk på telefonen'}</button>` : ''}`;
            return;
        }
        const f = forslag(t, tilstand.tekst);
        if (!f.spillere.length && !f.klubber.length) { el.innerHTML = ''; return; }
        el.innerHTML = `<div class="tp-forslag">`
            + f.spillere.map(n => `<button type="button" class="tp-chip" data-handling="spiller" data-navn="${esc(n)}">${esc(n)}</button>`).join('')
            + f.klubber.map(n => `<button type="button" class="tp-chip tp-chip--klub" data-handling="klub" data-navn="${esc(n)}">Klub: ${esc(n)}</button>`).join('')
            + `</div>`;
    }

    function tegnListe(t) {
        const el = document.getElementById('tpListe');
        if (!el) return;
        if (!t) {
            el.innerHTML = `<p class="tp-tom">${tilstand.hentet ? 'Der er ingen turnering i gang lige nu.' : 'Henter programmet …'}</p>`;
            return;
        }
        const v = tilstand.valgt;
        const kampe = t.kampe.filter(k => passer(k, t.klubber, tilstand.tekst, v));
        const program = tilstand.fane === 'program';
        const liste = program ? programKampe(kampe) : afsluttedeKampe(kampe);
        const filtreret = !!(v || norm(tilstand.tekst));

        if (!liste.length) {
            const hvem = v ? esc(v.navn) : filtreret ? 'søgningen' : '';
            el.innerHTML = `<p class="tp-tom">${program
                ? (hvem ? `Ingen kommende kampe for ${hvem}.` : 'Alle kampe er spillet.')
                : (hvem ? `Ingen spillede kampe for ${hvem} endnu.` : 'Ingen kampe er spillet endnu.')}</p>`
                + (program ? noteHtml() : '');
            return;
        }

        const dage = grupper(liste, program ? (k => delTid(k.tid)) : (k => (k.slut ? lokalTid(k.slut) : delTid(k.tid))));
        const flereDage = new Set(t.kampe.map(k => (delTid(k.tid) || {}).dag).filter(Boolean)).size > 1;
        let html = '';
        for (const d of dage) {
            if (flereDage || !d.dag) html += `<h2 class="tp-dag">${d.dag ? esc(dagTekst(d.dag)) : (program ? 'Uden tidspunkt' : 'Spillet')}</h2>`;
            if (program) {
                for (const g of d.tider) {
                    html += `<section class="tp-gruppe">${g.kl ? `<h3 class="tp-kl">${esc(g.kl)}</h3>` : ''}`
                        + g.kampe.map(k => programKort(k, t.klubber, v)).join('') + `</section>`;
                }
            } else {
                html += d.tider.map(g => g.kampe.map(k => resultatKort(k, t.klubber, v)).join('')).join('');
            }
        }
        el.innerHTML = html + (program ? noteHtml() : '');
    }

    function noteHtml() {
        return '<p class="tp-note">Tiderne er de planlagte fra Turneringsservice — er hallen bagud, kommer kampene senere. Senere runder kommer til, når de er trukket.</p>';
    }

    function tegn() {
        if (tilstand.fane === 'nu') return;
        const t = turnering();
        // Den huskede spiller vælges af sig selv — kun første gang, programmet
        // tegnes (bagefter bestemmer man selv, fx med "Vis alle")
        if (t && !tilstand.migBrugt) {
            tilstand.migBrugt = true;
            const mig = tilstand.mig;
            if (mig && !tilstand.valgt && t.kampe.some(k => spillere(k).includes(mig))) tilstand.valgt = { type: 'spiller', navn: mig };
        }
        tegnTurneringer();
        tegnFilter(t);
        tegnListe(t);
    }

    // ── Start ──

    async function start() {
        const p = new URLSearchParams(location.search);
        const tvunget = valgtFane(p);
        if (!tvunget) {
            if (!erTelefon() || erSkaerm(p)) return;
            await hent(true);
            // Uden turnering er der intet program: oversigten som altid
            if (!tilstand.data.some(t => t.kampe.length)) return;
        }
        try { tilstand.mig = localStorage.getItem(MIG_NOEGLE) || null; } catch { /* ok */ }
        byg();
        visFane(tvunget || 'nu', false);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { clearTimeout(timer); return; }
            if (tilstand.fane !== 'nu') hent(false).then(tegn);
            planlaeg();
        });
    }

    window.TurneringProgram = {
        _test: { norm, passer, forslag, delTid, programKampe, afsluttedeKampe, saetFraSide1, grupper, erSkaerm }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
})();
