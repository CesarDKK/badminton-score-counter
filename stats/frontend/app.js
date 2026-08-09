/* statistik.badmintonapp.dk — klientlogik og grafer.
   Ingen eksterne biblioteker: graferne tegnes som SVG direkte.

   Alt hænger sammen: man kan klikke sig fra en søjle til en spiller, fra en
   spiller til et hold, fra et hold til en kamp og fra kampen tilbage til en
   spiller. Navigationen går gennem aabnSpiller() og aabnHold(), så det er de to
   steder tilstanden styres. */

(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const el = {
        form: $('soegForm'), klub: $('klub'), saeson: $('saeson'), soegKnap: $('soegKnap'),
        besked: $('besked'), klubValg: $('klubValg'), klubliste: $('klubliste'),
        fremdrift: $('fremdrift'), fremdriftTitel: $('fremdriftTitel'), fremdriftTekst: $('fremdriftTekst'),
        barFill: $('barFill'), fremdriftMeta: $('fremdriftMeta'),
        resultat: $('resultat'), klubNavn: $('klubNavn'), klubMeta: $('klubMeta'),
        noegletal: $('noegletal'), holdTabel: $('holdTabel'), spillerTabel: $('spillerTabel'),
        filter: $('filter'), tabelTom: $('tabelTom'), kilde: $('kilde'),
        filterbjaelke: $('filterbjaelke'), filterTekst: $('filterTekst'), filterRyd: $('filterRyd'),
        csvSpillere: $('csvSpillere'), csvSpillerHold: $('csvSpillerHold'), csvHold: $('csvHold')
    };

    let data = null;
    let aktuel = null;          // { klub, season }
    let holdKort = new Map();   // holdnøgle → spillerne på holdet
    let navneKort = new Map();  // spiller-id → navn
    let kampeKort = null;       // holdnøgle → kampene
    let kampeHenter = null;     // igangværende hentning af kampe
    let sorter = { felt: 'kampe', ned: true };
    let groft = null;           // aktivt filter sat ved klik i en graf
    let pollTimer = null;

    const nf = new Intl.NumberFormat('da-DK');
    const nf1 = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function besked(tekst, erFejl) {
        el.besked.textContent = tekst || '';
        el.besked.classList.toggle('fejl', !!erFejl);
    }

    function vis(node, synlig) { node.hidden = !synlig; }

    /** Spillerens profil hos badmintonplayer. Åbnes altid i en ny fane. */
    const profilUrl = (id) => `https://www.badmintonplayer.dk/DBF/Spiller/VisSpiller/#${encodeURIComponent(id)}`;

    /** Et spillernavn er altid et link til profilen — resten af feltet folder ud. */
    function spillerLink(id, navn, ekstraKlasse = '') {
        return `<a class="spiller-link ${ekstraKlasse}" href="${esc(profilUrl(id))}" target="_blank" rel="noopener"
            title="Åbn ${esc(navn)} på badmintonplayer.dk">${esc(navn)}<span class="ud" aria-hidden="true">↗</span></a>`;
    }

    async function hentJson(url) {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        let json = null;
        try { json = await res.json(); } catch { /* tom krop */ }
        return { ok: res.ok, status: res.status, json: json || {} };
    }

    // ── Opstart ─────────────────────────────────────────────────────────────
    async function init() {
        const { json } = await hentJson('/api/seasons');
        const seasons = json.seasons || [];
        el.saeson.innerHTML = seasons.map((s) => `<option value="${esc(s.id)}">${esc(s.navn)}</option>`).join('');

        // Den nyeste sæson har sjældent data endnu i sommerpausen — vælg den forrige.
        if (seasons.length > 1) el.saeson.value = seasons[1].id;

        const p = new URLSearchParams(location.search);
        if (p.get('saeson') && seasons.some((s) => s.id === p.get('saeson'))) el.saeson.value = p.get('saeson');
        if (p.get('klub')) { el.klub.value = p.get('klub'); el.form.requestSubmit(); }
    }

    el.form.addEventListener('submit', (e) => {
        e.preventDefault();
        soeg(el.klub.value.trim(), el.saeson.value);
    });

    async function soeg(navn, season) {
        if (navn.length < 2) return besked('Skriv mindst to bogstaver af klubnavnet.', true);
        stopPoll();
        vis(el.klubValg, false);
        vis(el.fremdrift, false);
        vis(el.resultat, false);
        besked('Søger …');
        el.soegKnap.disabled = true;

        const { ok, json } = await hentJson('/api/clubs?q=' + encodeURIComponent(navn));
        el.soegKnap.disabled = false;
        if (!ok) return besked(json.fejl || 'Kunne ikke søge lige nu.', true);

        const klubber = json.klubber || [];
        if (!klubber.length) return besked(`Ingen klub hos badmintonplayer.dk hedder noget med "${navn}".`, true);
        if (klubber.length === 1) return vaelgKlub(klubber[0], season);

        besked(`${klubber.length} klubber matcher "${navn}".`);
        el.klubliste.innerHTML = klubber
            .map((k) => `<button type="button" class="klubvalg" data-id="${esc(k.id)}" data-navn="${esc(k.navn)}">${esc(k.navn)}</button>`)
            .join('');
        vis(el.klubValg, true);
    }

    el.klubliste.addEventListener('click', (e) => {
        const knap = e.target.closest('.klubvalg');
        if (!knap) return;
        vaelgKlub({ id: knap.dataset.id, navn: knap.dataset.navn }, el.saeson.value);
    });

    async function vaelgKlub(klub, season) {
        vis(el.klubValg, false);
        besked(`${klub.navn} — sæson ${sæsonNavn(season)}`);
        const url = new URL(location.href);
        url.searchParams.set('klub', klub.navn);
        url.searchParams.set('saeson', season);
        history.replaceState(null, '', url);
        hentStatistik(klub, season);
    }

    function sæsonNavn(id) {
        const o = [...el.saeson.options].find((x) => x.value === id);
        return o ? o.textContent : id;
    }

    // ── Hentning + fremdrift ────────────────────────────────────────────────
    async function hentStatistik(klub, season) {
        const q = `clubId=${encodeURIComponent(klub.id)}&clubName=${encodeURIComponent(klub.navn)}&season=${encodeURIComponent(season)}`;
        const { ok, status, json } = await hentJson('/api/stats?' + q);

        if (status === 429) { vis(el.fremdrift, false); return besked(json.fejl, true); }
        if (status === 202 && json.job) { visFremdrift(json.job); return følgJob(json.job.id, klub, season); }
        if (!ok) { vis(el.fremdrift, false); return besked(json.fejl || 'Noget gik galt.', true); }

        vis(el.fremdrift, false);
        data = json.data;
        aktuel = { klub, season };
        kampeKort = null;
        kampeHenter = null;
        render(json);
    }

    const FASER = {
        'i kø': { tekst: 'Venter på at komme til …', vaegt: 0, andel: 0 },
        'starter': { tekst: 'Starter …', vaegt: 0, andel: 0.01 },
        'raekker': { tekst: 'Finder klubbens rækker', vaegt: 0, andel: 0.02 },
        'hold': { tekst: 'Finder holdene i hver pulje', vaegt: 0.02, andel: 0.15 },
        'kampprogram': { tekst: 'Henter kampprogrammer', vaegt: 0.17, andel: 0.15 },
        'holdsedler': { tekst: 'Læser holdsedler kamp for kamp', vaegt: 0.32, andel: 0.68 }
    };

    function visFremdrift(job) {
        vis(el.resultat, false);
        vis(el.fremdrift, true);
        besked('');
        opdaterFremdrift(job);
    }

    function opdaterFremdrift(job) {
        const f = FASER[job.fase] || { tekst: job.fase, vaegt: 0, andel: 0 };
        const delvis = job.total ? job.faerdig / job.total : 0;
        const pct = Math.min(99, Math.round((f.vaegt + f.andel * delvis) * 100));
        el.barFill.style.width = pct + '%';
        el.fremdriftTitel.textContent = `Henter ${job.clubName} ${sæsonNavn(job.season)}`;
        el.fremdriftTekst.textContent = f.tekst;

        if (job.status === 'venter') {
            el.fremdriftMeta.textContent = job.koePlads > 0
                ? `Nummer ${job.koePlads + 1} i køen — en anden klub hentes lige nu.`
                : 'Klar til at gå i gang …';
        } else if (job.total) {
            el.fremdriftMeta.textContent = `${nf.format(job.faerdig)} af ${nf.format(job.total)} · ${pct} %`;
        } else {
            el.fremdriftMeta.textContent = pct + ' %';
        }
    }

    function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; } }

    function følgJob(jobId, klub, season) {
        stopPoll();
        const tik = async () => {
            const { ok, json } = await hentJson('/api/jobs/' + encodeURIComponent(jobId));
            if (!ok) { vis(el.fremdrift, false); return besked(json.fejl || 'Mistede forbindelsen til jobbet.', true); }
            const job = json.job;
            opdaterFremdrift(job);
            if (job.status === 'færdig') {
                el.barFill.style.width = '100%';
                return hentStatistik(klub, season);
            }
            if (job.status === 'fejlet') {
                vis(el.fremdrift, false);
                return besked('Indsamlingen fejlede: ' + job.fejl, true);
            }
            pollTimer = setTimeout(tik, 2000);
        };
        pollTimer = setTimeout(tik, 1200);
    }

    // ── Visning ─────────────────────────────────────────────────────────────
    function render(svar) {
        const { klub, season } = aktuel;
        groft = null;
        el.filter.value = '';

        el.klubNavn.textContent = data.klub;
        const alder = svar.forældet
            ? ` · hentet for ${svar.alderTimer} timer siden`
            : (svar.alderTimer ? ` · opdateret for ${svar.alderTimer} timer siden` : ' · lige hentet');
        el.klubMeta.textContent = `Sæson ${sæsonNavn(season)}${alder}`;

        navneKort = new Map(data.spillere.map((s) => [s.id, s.navn]));

        const n = data.noegletal;
        const snit = n.spillere ? nf1.format(sumKampe() / n.spillere) : '0';
        el.noegletal.innerHTML = [
            ['Spillere', nf.format(n.spillere)],
            ['Hold', nf.format(n.hold)],
            ['Holdkampe', nf.format(n.kampeMedHoldseddel)],
            ['Rækker', nf.format(n.raekker)],
            ['Kampe pr. spiller', snit]
        ].map(([etiket, v]) => `<div class="tal-kort"><span class="vaerdi">${esc(v)}</span><span class="etiket">${esc(etiket)}</span></div>`).join('');

        tegnTop();
        tegnAargang();
        tegnFordeling();
        tegnMaaned();
        tegnHoldTabel();
        tegnSpillere();
        opdaterFilterbjaelke();

        const q = `clubId=${encodeURIComponent(klub.id)}&season=${encodeURIComponent(season)}`;
        el.csvSpillere.href = `/api/export?${q}&type=spillere`;
        el.csvSpillerHold.href = `/api/export?${q}&type=spiller-hold`;
        el.csvHold.href = `/api/export?${q}&type=hold`;

        el.kilde.textContent = `Kilde: badmintonplayer.dk, holdturneringen. ${nf.format(n.kampeFundet)} kampe fundet, `
            + `heraf ${nf.format(n.kampeMedHoldseddel)} med holdseddel. En spiller tælles én gang pr. holdkamp, `
            + 'også hvis vedkommende spillede flere kampe i den. Tal opdateres højst én gang i døgnet.';

        vis(el.resultat, true);
        besked('');
        el.resultat.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function sumKampe() { return data.spillere.reduce((s, p) => s + p.kampe, 0); }

    // ── Grafer ──────────────────────────────────────────────────────────────
    const FORLOEB = `<defs><linearGradient id="stat-forloeb" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#533483"/><stop offset="100%" stop-color="#e94560"/></linearGradient>
        <linearGradient id="stat-lodret" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#533483"/><stop offset="100%" stop-color="#e94560"/></linearGradient></defs>`;

    function tom(node, tekst) { node.innerHTML = `<p class="graf-tom">${esc(tekst)}</p>`; }

    /** Vandrette søjler — klik åbner spilleren i tabellen. */
    function tegnTop() {
        const node = $('grafTop');
        const raekker = data.spillere.slice(0, 20);
        if (!raekker.length) return tom(node, 'Ingen spillere fundet.');

        const H = 26, pad = 8, navnBredde = 210, talBredde = 44;
        const bredde = 760;
        const hoejde = raekker.length * H + pad * 2;
        const maks = raekker[0].kampe || 1;
        const sporBredde = bredde - navnBredde - talBredde;

        // Navnet og søjlen er adskilt: navnet linker til profilen, søjlen åbner
        // spilleren i tabellen nedenfor.
        const dele = raekker.map((s, i) => {
            const y = pad + i * H;
            const w = Math.max(2, (s.kampe / maks) * sporBredde);
            return `<a class="navn-link" href="${esc(profilUrl(s.id))}" target="_blank" rel="noopener">
                    <rect class="ramme" x="0" y="${y}" width="${navnBredde - 8}" height="${H - 2}" rx="4"></rect>
                    <text class="etiket" x="0" y="${y + 15}">${esc(kort(s.navn, 28))}</text>
                    <title>Åbn ${esc(s.navn)} på badmintonplayer.dk</title></a>
                <g class="klikbar" data-spiller="${esc(s.id)}">
                    <rect class="ramme" x="${navnBredde - 6}" y="${y}" width="${bredde - navnBredde + 6}" height="${H - 2}" rx="4"></rect>
                    <rect class="soejle" x="${navnBredde}" y="${y + 4}" width="${w}" height="15" rx="4"></rect>
                    <text class="vaerdi" x="${navnBredde + w + 8}" y="${y + 16}">${s.kampe}</text>
                    <title>${esc(s.navn)} — ${s.kampe} kampe på ${s.antalHold} hold</title></g>`;
        }).join('');

        node.innerHTML = `<svg viewBox="0 0 ${bredde} ${hoejde}" role="img"
            aria-label="De 20 spillere med flest kampe">${FORLOEB}${dele}</svg>`;
    }

    /** Grupperede søjler — klik filtrerer til én årgang. */
    function tegnAargang() {
        const node = $('grafAargang');
        const raekker = data.aargange;
        if (!raekker.length) return tom(node, 'Ingen årgange fundet.');

        const bredde = 520, hoejde = 260, bund = 42, top = 14, venstre = 34;
        const maks = Math.max(...raekker.map((r) => Math.max(r.kampe, r.spillere)), 1);
        const spor = (bredde - venstre - 8) / raekker.length;
        const bw = Math.min(16, spor / 2.6);
        const y = (v) => hoejde - bund - (v / maks) * (hoejde - bund - top);

        let gitter = '';
        for (let i = 0; i <= 4; i++) {
            const v = Math.round(maks * i / 4);
            gitter += `<line class="gitter" x1="${venstre}" y1="${y(v)}" x2="${bredde - 4}" y2="${y(v)}"></line>`
                + `<text class="akse" x="0" y="${y(v) + 4}">${v}</text>`;
        }

        const dele = raekker.map((r, i) => {
            const x = venstre + i * spor + spor / 2;
            return `<g class="klikbar" data-aargang="${esc(r.aargang)}">
                <rect class="ramme" x="${x - spor / 2}" y="${top - 8}" width="${spor}" height="${hoejde - bund - top + 8}" rx="4"></rect>
                <rect class="soejle" x="${x - bw - 2}" y="${y(r.kampe)}" width="${bw}" height="${hoejde - bund - y(r.kampe)}" rx="3"></rect>
                <rect class="soejle--alt" x="${x + 2}" y="${y(r.spillere)}" width="${bw}" height="${hoejde - bund - y(r.spillere)}" rx="3"></rect>
                <text class="akse" x="${x}" y="${hoejde - bund + 16}" text-anchor="middle"
                    transform="rotate(-40 ${x} ${hoejde - bund + 16})">${esc(r.aargang)}</text>
                <title>${esc(r.aargang)} — ${r.kampe} kampe, ${r.spillere} spillere</title></g>`;
        }).join('');

        node.innerHTML = `<svg viewBox="0 0 ${bredde} ${hoejde}" role="img"
            aria-label="Kampe og spillere pr. årgang">${FORLOEB}${gitter}${dele}</svg>`
            + `<div class="forklaring"><span><i style="background:linear-gradient(90deg,#533483,#e94560)"></i>Kampe</span>`
            + `<span><i style="background:rgba(83,52,131,0.75)"></i>Spillere</span></div>`;
    }

    /** Klik viser netop de spillere der er brugt på så mange hold. */
    function tegnFordeling() {
        const node = $('grafFordeling');
        const poster = Object.entries(data.holdFordeling)
            .map(([k, v]) => ({ antal: Number(k), spillere: v }))
            .sort((a, b) => a.antal - b.antal);
        if (!poster.length) return tom(node, 'Ingen data.');

        const bredde = 520, hoejde = 260, bund = 46, top = 18, venstre = 34;
        const maks = Math.max(...poster.map((p) => p.spillere), 1);
        const spor = (bredde - venstre - 8) / poster.length;
        const bw = Math.min(56, spor * 0.55);
        const y = (v) => hoejde - bund - (v / maks) * (hoejde - bund - top);

        let gitter = '';
        for (let i = 0; i <= 4; i++) {
            const v = Math.round(maks * i / 4);
            gitter += `<line class="gitter" x1="${venstre}" y1="${y(v)}" x2="${bredde - 4}" y2="${y(v)}"></line>`
                + `<text class="akse" x="0" y="${y(v) + 4}">${v}</text>`;
        }

        const dele = poster.map((p, i) => {
            const x = venstre + i * spor + spor / 2;
            return `<g class="klikbar" data-antalhold="${p.antal}">
                <rect class="ramme" x="${x - spor / 2}" y="${top - 12}" width="${spor}" height="${hoejde - bund - top + 12}" rx="4"></rect>
                <rect fill="url(#stat-lodret)" x="${x - bw / 2}" y="${y(p.spillere)}" width="${bw}" height="${hoejde - bund - y(p.spillere)}" rx="4"></rect>
                <text class="vaerdi" x="${x}" y="${y(p.spillere) - 6}" text-anchor="middle">${p.spillere}</text>
                <text class="akse" x="${x}" y="${hoejde - bund + 18}" text-anchor="middle">${p.antal} hold</text>
                <title>${p.spillere} spillere har spillet for ${p.antal} hold</title></g>`;
        }).join('');

        node.innerHTML = `<svg viewBox="0 0 ${bredde} ${hoejde}" role="img"
            aria-label="Antal spillere fordelt på hvor mange hold de har spillet for">${FORLOEB}${gitter}${dele}</svg>`;
    }

    /** Kampe måned for måned. */
    function tegnMaaned() {
        const node = $('grafMaaned');
        const raekker = data.perMaaned;
        if (raekker.length < 2) return tom(node, 'For få kampe med dato til at tegne en kurve.');

        const bredde = 760, hoejde = 240, bund = 38, top = 18, venstre = 36;
        const maks = Math.max(...raekker.map((r) => r.kampe), 1);
        const x = (i) => venstre + (i / (raekker.length - 1)) * (bredde - venstre - 12);
        const y = (v) => hoejde - bund - (v / maks) * (hoejde - bund - top);

        let gitter = '';
        for (let i = 0; i <= 4; i++) {
            const v = Math.round(maks * i / 4);
            gitter += `<line class="gitter" x1="${venstre}" y1="${y(v)}" x2="${bredde - 6}" y2="${y(v)}"></line>`
                + `<text class="akse" x="0" y="${y(v) + 4}">${v}</text>`;
        }

        const punkter = raekker.map((r, i) => `${x(i)},${y(r.kampe)}`).join(' ');
        const flade = `${venstre},${hoejde - bund} ${punkter} ${x(raekker.length - 1)},${hoejde - bund}`;
        const prikker = raekker.map((r, i) => `<circle class="prik" cx="${x(i)}" cy="${y(r.kampe)}" r="3.5"><title>${esc(maanedNavn(r.maaned))}: ${r.kampe} kampe</title></circle>`).join('');
        const akse = raekker.map((r, i) => (raekker.length > 9 && i % 2) ? '' :
            `<text class="akse" x="${x(i)}" y="${hoejde - bund + 18}" text-anchor="middle">${esc(maanedKort(r.maaned))}</text>`).join('');

        node.innerHTML = `<svg viewBox="0 0 ${bredde} ${hoejde}" role="img" aria-label="Antal holdkampe måned for måned">
            ${gitter}<polygon class="flade" points="${flade}"></polygon>
            <polyline class="linje" points="${punkter}"></polyline>${prikker}${akse}</svg>`;
    }

    const MAANEDER = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
    const MAANEDER_KORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    function maanedNavn(m) { const [a, b] = m.split('-'); return `${MAANEDER[Number(b) - 1]} ${a}`; }
    function maanedKort(m) { const [a, b] = m.split('-'); return `${MAANEDER_KORT[Number(b) - 1]} ${a.slice(2)}`; }
    function kort(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

    // Klik i graferne
    $('grafTop').addEventListener('click', (e) => {
        const g = e.target.closest('[data-spiller]');
        if (g) aabnSpiller(g.dataset.spiller);
    });
    $('grafAargang').addEventListener('click', (e) => {
        const g = e.target.closest('[data-aargang]');
        if (g) saetFilter({ type: 'aargang', vaerdi: g.dataset.aargang });
    });
    $('grafFordeling').addEventListener('click', (e) => {
        const g = e.target.closest('[data-antalhold]');
        if (g) saetFilter({ type: 'antalHold', vaerdi: Number(g.dataset.antalhold) });
    });

    // ── Filter sat fra en graf ──────────────────────────────────────────────
    function saetFilter(nyt) {
        const samme = groft && groft.type === nyt.type && groft.vaerdi === nyt.vaerdi;
        groft = samme ? null : nyt;
        opdaterFilterbjaelke();
        tegnHoldTabel();
        tegnSpillere();
        if (groft) el.filterbjaelke.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function rydFilter() {
        if (!groft) return;
        groft = null;
        opdaterFilterbjaelke();
        tegnHoldTabel();
        tegnSpillere();
    }

    el.filterRyd.addEventListener('click', rydFilter);

    function opdaterFilterbjaelke() {
        vis(el.filterbjaelke, !!groft);
        if (!groft) { el.filterTekst.textContent = ''; return; }
        el.filterTekst.textContent = groft.type === 'aargang'
            ? `Viser kun ${groft.vaerdi}`
            : `Viser kun spillere der har spillet for ${groft.vaerdi === 1 ? 'ét hold' : groft.vaerdi + ' hold'}`;
    }

    function spillerePassererFilter(s) {
        if (!groft) return true;
        if (groft.type === 'antalHold') return s.antalHold === groft.vaerdi;
        return s.hold.some((h) => holdAargang(h.navn) === groft.vaerdi);
    }

    /** Holdnøglen er "ÅRGANG Holdnavn" — årgangen er alt før første mellemrum. */
    function holdAargang(noegle) { return String(noegle).split(' ')[0]; }

    // ── Kampe (hentes først når nogen folder et hold ud) ────────────────────
    function sikrKampe() {
        if (kampeKort) return Promise.resolve(kampeKort);
        if (kampeHenter) return kampeHenter;
        const q = `clubId=${encodeURIComponent(aktuel.klub.id)}&season=${encodeURIComponent(aktuel.season)}`;
        kampeHenter = hentJson('/api/matches?' + q).then(({ ok, json }) => {
            kampeKort = new Map();
            if (ok) {
                for (const k of json.kampe || []) {
                    if (!kampeKort.has(k.hold)) kampeKort.set(k.hold, []);
                    kampeKort.get(k.hold).push(k);
                }
                for (const liste of kampeKort.values()) liste.sort((a, b) => datoTal(a.tid) - datoTal(b.tid));
            }
            kampeHenter = null;
            return kampeKort;
        });
        return kampeHenter;
    }

    /** "lø 11-04-2026 10:30" → sorterbart tal. */
    function datoTal(tid) {
        const m = /(\d{2})[-.](\d{2})[-.](\d{4})(?:\s+(\d{2}):(\d{2}))?/.exec(String(tid || ''));
        if (!m) return 0;
        return Number(`${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}`);
    }

    function kortDato(tid) {
        const m = /(\w{2})\s+(\d{2})[-.](\d{2})[-.](\d{4})\s*(\d{2}:\d{2})?/.exec(String(tid || ''));
        return m ? `${m[1]} ${m[2]}-${m[3]} ${m[5] || ''}`.trim() : (tid || '—');
    }

    // ── Holdtabellen ────────────────────────────────────────────────────────
    /** Holdnøgle → spillerne på holdet, flest kampe først. Udledt af spillerlisten. */
    function spillerePrHold() {
        const kort = new Map();
        for (const s of data.spillere) {
            for (const h of s.hold) {
                if (!kort.has(h.navn)) kort.set(h.navn, []);
                kort.get(h.navn).push({ id: s.id, navn: s.navn, kampe: h.kampe });
            }
        }
        for (const liste of kort.values()) {
            liste.sort((a, b) => b.kampe - a.kampe || a.navn.localeCompare(b.navn, 'da'));
        }
        return kort;
    }

    function tegnHoldTabel() {
        holdKort = spillerePrHold();
        const raekker = groft && groft.type === 'aargang'
            ? data.hold.filter((h) => h.aargang === groft.vaerdi)
            : data.hold;

        el.holdTabel.tBodies[0].innerHTML = raekker.map((h) => `<tr class="hold" data-noegle="${esc(h.noegle)}">
            <td>${esc(h.aargang)}</td>
            <td>${esc(h.hold)}</td>
            <td class="navn">${esc(h.raekker.join(' · '))}</td>
            <td class="tal">${h.spillere}</td>
            <td class="tal">${h.kampe}</td></tr>`).join('');
    }

    function lukAlle(tbody) {
        [...tbody.querySelectorAll('tr.detaljer')].forEach((r) => r.remove());
        [...tbody.querySelectorAll('tr.aaben')].forEach((r) => r.classList.remove('aaben'));
    }

    async function aabnHold(noegle, scroll) {
        // Er holdet filtreret væk, ryddes filteret — ellers klikker man i blinde.
        if (groft && groft.type === 'aargang' && holdAargang(noegle) !== groft.vaerdi) rydFilter();
        const tbody = el.holdTabel.tBodies[0];
        const tr = [...tbody.querySelectorAll('tr.hold')].find((t) => t.dataset.noegle === noegle);
        if (!tr) return;
        lukAlle(tbody);
        tr.classList.add('aaben');

        const spillere = holdKort.get(noegle) || [];
        const chips = spillere.length
            ? spillere.map((s) => `<a class="hold-chip" href="${esc(profilUrl(s.id))}" target="_blank" rel="noopener"
                title="Åbn ${esc(s.navn)} på badmintonplayer.dk">${esc(s.navn)} <b>${s.kampe}</b><span class="ud" aria-hidden="true">↗</span></a>`).join('')
            : '<span class="ingen">Ingen holdsedler indtastet for dette hold.</span>';

        const rad = document.createElement('tr');
        rad.className = 'detaljer';
        rad.innerHTML = `<td colspan="5">
            <span class="detalje-hoved">${esc(noegle)} — ${spillere.length} spillere</span>
            <div class="chips">${chips}</div>
            <div class="kamp-blok" data-hold="${esc(noegle)}"><span class="ingen">Henter kampene …</span></div></td>`;
        tr.after(rad);
        if (scroll) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });

        const kort = await sikrKampe();
        const blok = rad.querySelector('.kamp-blok');
        if (!blok || !document.body.contains(blok)) return;
        const kampe = kort.get(noegle) || [];
        blok.innerHTML = kampe.length
            ? `<span class="detalje-hoved">${kampe.length} kampe — klik for opstillingen</span>
               <table class="minitabel"><tbody>${kampe.map((k) => `<tr class="kamp" data-nr="${esc(k.nr)}">
                    <td class="dato">${esc(kortDato(k.tid))}</td>
                    <td class="modstander">${esc(k.hjemme)} <span class="mod">–</span> ${esc(k.ude)}</td>
                    <td class="tal res">${esc(k.resultat || '')}</td>
                    <td class="tal antal">${k.spillere.length} spillere</td></tr>`).join('')}</tbody></table>`
            : '<span class="ingen">Ingen kampe med holdseddel.</span>';
    }

    el.holdTabel.tBodies[0].addEventListener('click', (e) => {
        // Spillernavne er links til badmintonplayer — lad browseren om dem.
        if (e.target.closest('a')) return;

        // Klik på en kamp → vis opstillingen
        const kamp = e.target.closest('tr.kamp');
        if (kamp) { visOpstilling(kamp); return; }

        const tr = e.target.closest('tr.hold');
        if (!tr) return;
        if (tr.classList.contains('aaben')) { lukAlle(el.holdTabel.tBodies[0]); return; }
        aabnHold(tr.dataset.noegle, false);
    });

    function visOpstilling(tr) {
        const tbody = tr.parentElement;
        const naeste = tr.nextElementSibling;
        const aaben = naeste && naeste.classList.contains('opstilling');
        [...tbody.querySelectorAll('tr.opstilling')].forEach((r) => r.remove());
        [...tbody.querySelectorAll('tr.kamp')].forEach((r) => r.classList.remove('aaben'));
        if (aaben) return;

        const holdNoegle = tr.closest('.kamp-blok').dataset.hold;
        const kamp = (kampeKort.get(holdNoegle) || []).find((k) => k.nr === tr.dataset.nr);
        if (!kamp) return;

        const chips = kamp.spillere.length
            ? kamp.spillere.map(([id, disc]) => {
                const navn = navneKort.get(id) || id;
                return `<a class="hold-chip hold-chip--lille" href="${esc(profilUrl(id))}" target="_blank" rel="noopener"
                    title="Åbn ${esc(navn)} på badmintonplayer.dk">
                    <span class="disc">${esc(disc)}</span> ${esc(navn)}<span class="ud" aria-hidden="true">↗</span></a>`;
            }).join('')
            : '<span class="ingen">Ingen opstilling indtastet.</span>';

        const rad = document.createElement('tr');
        rad.className = 'opstilling';
        rad.innerHTML = `<td colspan="4">
            <span class="detalje-hoved">Kamp ${esc(kamp.nr)} · ${esc(kamp.hjemme)} – ${esc(kamp.ude)} ${esc(kamp.resultat || '')}</span>
            <div class="chips">${chips}</div></td>`;
        tr.classList.add('aaben');
        tr.after(rad);
    }

    // ── Spillertabellen ─────────────────────────────────────────────────────
    function tegnSpillere() {
        const filter = el.filter.value.trim().toLowerCase();
        let raekker = data.spillere.filter(spillerePassererFilter);
        if (filter) {
            raekker = raekker.filter((s) => s.navn.toLowerCase().includes(filter)
                || s.hold.some((h) => h.navn.toLowerCase().includes(filter)));
        }
        const f = sorter.felt, ned = sorter.ned;
        raekker = [...raekker].sort((a, b) => {
            if (f === 'navn') return (ned ? -1 : 1) * a.navn.localeCompare(b.navn, 'da');
            return (ned ? -1 : 1) * (a[f] - b[f]) || a.navn.localeCompare(b.navn, 'da');
        });

        el.spillerTabel.tBodies[0].innerHTML = raekker.map((s) => `<tr class="spiller" data-id="${esc(s.id)}">
            <td class="navn">${spillerLink(s.id, s.navn)}</td>
            <td class="tal">${s.kampe}</td>
            <td class="tal">${s.antalHold}</td>
            <td class="tal">${s.single}</td>
            <td class="tal">${s.double}</td></tr>`).join('');

        vis(el.tabelTom, raekker.length === 0);
        [...el.spillerTabel.tHead.rows[0].cells].forEach((th) => th.classList.toggle('aktiv', th.dataset.sort === f));
    }

    function aabnSpiller(id, scroll = true) {
        // Er spilleren filtreret væk, ryddes filteret så man ikke klikker i blinde.
        const s = data.spillere.find((x) => x.id === id);
        if (!s) return;
        if (!spillerePassererFilter(s) || el.filter.value.trim()) {
            el.filter.value = '';
            groft = null;
            opdaterFilterbjaelke();
            tegnHoldTabel();
            tegnSpillere();
        }
        const tbody = el.spillerTabel.tBodies[0];
        const tr = [...tbody.querySelectorAll('tr.spiller')].find((t) => t.dataset.id === id);
        if (!tr) return;
        lukAlle(tbody);
        tr.classList.add('aaben');

        const chips = s.hold.map((h) =>
            `<button type="button" class="hold-chip" data-hold="${esc(h.navn)}">${esc(h.navn)} <b>${h.kampe}</b></button>`).join('');
        const rad = document.createElement('tr');
        rad.className = 'detaljer';
        rad.innerHTML = `<td colspan="5">
            <span class="detalje-hoved">${spillerLink(s.id, s.navn, 'hoved-link')} — ${s.kampe} kampe, ${s.single} single og ${s.double} double</span>
            <div class="chips">${chips}</div></td>`;
        tr.after(rad);
        if (scroll) tr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    el.spillerTabel.tHead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const felt = th.dataset.sort;
        if (sorter.felt === felt) sorter.ned = !sorter.ned;
        else sorter = { felt, ned: felt !== 'navn' };
        tegnSpillere();
    });

    el.spillerTabel.tBodies[0].addEventListener('click', (e) => {
        // Spillernavnet er et link til badmintonplayer — lad browseren om det.
        if (e.target.closest('a')) return;

        // Klik på en holdchip → hop til holdet i holdtabellen
        const chip = e.target.closest('.hold-chip[data-hold]');
        if (chip) { aabnHold(chip.dataset.hold, true); return; }

        const tr = e.target.closest('tr.spiller');
        if (!tr) return;
        if (tr.classList.contains('aaben')) { lukAlle(el.spillerTabel.tBodies[0]); return; }
        aabnSpiller(tr.dataset.id, false);
    });

    let filterTimer = null;
    el.filter.addEventListener('input', () => {
        clearTimeout(filterTimer);
        filterTimer = setTimeout(tegnSpillere, 150);
    });

    init();
})();
