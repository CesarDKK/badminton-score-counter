/**
 * Klubbens live-side (/live): banerne, der sender lige nu, med YouTube-
 * udsendelsen og stillingen (backend/routes/livestream.js, GET /api/livestream/live).
 * Offentlig og uden login. Afspillerne bliver stående mellem opdateringerne —
 * kun scoreboardet tegnes igen.
 */
(function () {
    const INTERVAL_MS = 10 * 1000;
    const banerEl = document.getElementById('baner');
    const kort = new Map();   // bane -> { el, videoId }
    let harKanal = false;     // klubbens YouTube-kanal forbundet (ellers kender siden ikke videoerne)

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    // Kun serverens egne logoer (/uploads/…) — aldrig en fremmed adresse
    const logoSti = (s) => typeof s === 'string' && /^\/uploads\/[A-Za-z0-9_./-]+$/.test(s) && !s.includes('..') ? s : null;
    const videoId = (v) => v && typeof v.id === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(v.id) ? v.id : null;

    function videoHtml(v) {
        const id = videoId(v);
        if (!id) return `<div class="live-video-tom">${harKanal ? 'Udsendelsen starter om lidt' : 'Sendes live på klubbens YouTube-kanal'}</div>`;
        const url = `https://www.youtube.com/watch?v=${id}`;
        if (v.indlejres) {
            return `<iframe src="https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0" title="Live fra banen"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
                referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
        }
        return `<a class="live-video-link" href="${url}" target="_blank" rel="noopener" aria-label="Se banen live på YouTube">
            <img src="https://i.ytimg.com/vi/${id}/hqdefault_live.jpg" alt="" loading="lazy"></a>`;
    }

    function tavleHtml(k) {
        if (!k || !Array.isArray(k.navne)) return '<p class="live-mellem">Mellem kampene — næste kamp sendes, når den går i gang.</p>';
        const saet = Array.isArray(k.saet) ? k.saet : [];
        const logoer = Array.isArray(k.logoer) ? k.logoer : [];
        const harLogo = logoer.some(logoSti);
        return [0, 1].map((i) => {
            const logo = logoSti(logoer[i]);
            const saetHtml = saet.map((s) => {
                const egen = Number(s[i]), anden = Number(s[1 - i]);
                return `<span${egen > anden ? ' class="vundet"' : ''}>${esc(egen)}</span>`;
            }).join('');
            return `<div class="live-side${harLogo ? '' : ' live-side--uden-logo'}">
                <span class="live-serve${k.serve === i + 1 ? ' live-serve--ja' : ''}" ${k.serve === i + 1 ? 'title="Server"' : 'aria-hidden="true"'}></span>
                ${harLogo ? (logo ? `<img class="live-logo" src="${esc(logo)}" alt="">` : '<span></span>') : ''}
                <span class="live-navn">${esc(k.navne[i])}</span>
                <span class="live-saet">${saetHtml}</span>
                <span class="live-point">${Array.isArray(k.nu) ? esc(k.nu[i]) : ''}</span>
            </div>`;
        }).join('');
    }

    function tegnBane(b) {
        let k = kort.get(b.bane);
        if (!k) {
            const el = document.createElement('article');
            el.className = 'live-bane';
            el.innerHTML = `
                <div class="live-bane-top"><span class="live-bane-navn">Bane ${esc(b.bane)}</span><span class="live-maerke">LIVE</span></div>
                <div class="live-video"></div>
                <div class="live-tavle"></div>
                <div class="live-bane-bund"></div>`;
            k = { el, videoId: undefined };
            kort.set(b.bane, k);
        }
        const id = videoId(b.video);
        // Afspilleren skiftes kun, når udsendelsen er en anden — ellers starter videoen forfra
        if (k.videoId !== id || k.harKanal !== harKanal) {
            k.el.querySelector('.live-video').innerHTML = videoHtml(b.video);
            k.el.querySelector('.live-bane-bund').innerHTML = id
                ? `<a class="btn-secondary btn-sm" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener">Se på YouTube</a>`
                : '';
            k.videoId = id;
            k.harKanal = harKanal;
        }
        k.el.querySelector('.live-tavle').innerHTML = tavleHtml(b.kamp);
        return k.el;
    }

    function tegn(d) {
        document.getElementById('indlaeser').hidden = true;
        document.getElementById('fejl').hidden = true;
        if (d.klub) {
            document.getElementById('klubNavn').textContent = `${d.klub} live`;
            document.title = `${d.klub} — live`;
        }
        const logo = document.getElementById('klubLogo');
        const logoUrl = logoSti(d.logo);
        if (logoUrl && logo.getAttribute('src') !== logoUrl) logo.src = logoUrl;
        logo.hidden = !logoUrl;
        const kanal = document.getElementById('kanalLink');
        const kanalUrl = d.kanal && /^https:\/\/www\.youtube\.com\/channel\/[A-Za-z0-9_-]+$/.test(d.kanal.url) ? d.kanal.url : null;
        if (kanalUrl) kanal.href = kanalUrl;
        harKanal = !!kanalUrl;
        kanal.hidden = !kanalUrl;

        const baner = Array.isArray(d.baner) ? d.baner : [];
        const nu = new Set(baner.map((b) => b.bane));
        for (const [bane, k] of kort) {
            if (!nu.has(bane)) { k.el.remove(); kort.delete(bane); }
        }
        // Kun nye eller flyttede kort sættes ind — et flyttet iframe genindlæses
        let forrige = null;
        baner.forEach((b) => {
            const el = tegnBane(b);
            const plads = forrige ? forrige.nextSibling : banerEl.firstChild;
            if (el !== plads) banerEl.insertBefore(el, plads);
            forrige = el;
        });
        document.getElementById('ingen').hidden = baner.length > 0;
    }

    async function hent() {
        try {
            const r = await fetch('/api/livestream/live', { cache: 'no-store' });
            if (!r.ok) throw new Error(r.status);
            tegn(await r.json());
        } catch {
            document.getElementById('indlaeser').hidden = true;
            document.getElementById('fejl').hidden = false;
        }
    }

    hent();
    setInterval(() => { if (!document.hidden) hent(); }, INTERVAL_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) hent(); });
})();
