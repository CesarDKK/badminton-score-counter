/**
 * KameraVisning — banens USB-kamera på TV'et, så kameraet kan stilles op.
 *
 * Admin → Livestream → "Vis kamera på TV'et": serveren sender et config-event
 * ('kamera-visning'), og TV-siden på PC'en med kameraet viser kameraet i fuld
 * skærm i 5 minutter — levende og uden forsinkelse, direkte fra kameraet i
 * PC'ens browser (intet går over nettet). Ovenpå:
 *   - hjælpelinjer (tredjedele og midten), så kameraet kan stilles lige
 *   - et eksempel på streamens scoreboard der, hvor det kommer til at stå (med
 *     en stiplet ramme for den plads, lange navne kan fylde), og logoets plads
 *   - en bjælke med nedtællingen
 * Billedet vendes og spejles som i streamen, og banens opløsning bruges, så
 * udsnittet er det, YouTube vil få.
 *
 * Kun på en Badminton TV-PC (?kioskversion=): dens browser må åbne kameraet
 * fra klubbens server (Chromium-politik, kiosk: setup). Serveren afgør, om
 * kameraet skal vises (GET /api/livestream/tv/kamera-visning) — og lukker
 * visningen, når banen skal sendes, så streamen kan få kameraet.
 *
 * Brug: KameraVisning.start({ skaermNavn, kiosk }) ved indlæsning og
 * KameraVisning.tjek() ved config-eventet 'kamera-visning'.
 */
(function () {
    'use strict';

    const TJEK_AKTIV_MS = 5000;      // mens kameraet vises: vend/spejl/luk slår igennem efter højst så længe
    const TJEK_LEDIG_MS = 30000;     // sikkerhedsnet, hvis config-eventet ikke nåede frem
    const KAMERA_FORSOEG = 10;       // kameraet optaget (fx et prøvebillede): prøv igen så mange gange …
    const KAMERA_PAUSE_MS = 2000;    // … med så lang pause
    // Streamens scoreboard (kiosk: stream, tegn_tavle_billede): mål til 1280 px
    // bredde i størrelsen "normal" — ganges med billedets bredde / 1280
    const STOERRELSE = { lille: 0.8, normal: 1.0, stor: 1.25 };
    const TAVLE = {
        kant: 28, top: 26, raekke: 48, luft: 14, prik: 18, logo: 46, efterNavn: 14,
        kol: 42, nu: 62, nuLuft: 6, fane: 28, navnEksempel: 250, navnMax: 520
    };

    let cfg = { skaermNavn: '', kiosk: false };
    let tilstand = null;        // seneste svar fra serveren, når kameraet vises
    let strom = null;           // MediaStream fra kameraet
    let kameraId = null;        // browserens deviceId for det valgte kamera …
    let kameraFor = null;       // … fundet ud fra PC'ens kamera (navn og USB-id)
    let slutKl = 0;             // performance.now() for, hvornår visningen lukker
    let tjekTimer = null;
    let urTimer = null;
    let aabner = null;          // løfte, mens kameraet åbnes
    let visningNr = 0;          // tælles op, når visningen lukkes: et kamera, der åbner for sent, lukkes igen
    let el = null;              // { rod, billede, video, tavle, ramme, logo, tid, besked }

    function start(opts) {
        cfg = { ...cfg, ...(opts || {}) };
        if (!cfg.kiosk || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        tjek();
    }

    function planlaegTjek(ms) {
        clearTimeout(tjekTimer);
        tjekTimer = setTimeout(tjek, ms);
    }

    async function tjek() {
        if (!cfg.kiosk) return;
        clearTimeout(tjekTimer);
        let svar = null;
        try {
            svar = await window.BadmintonAPI.request('/livestream/tv/kamera-visning', {}, 1);
        } catch (e) {
            // Intet net eller ældre server: behold visningen til dens egen nedtælling er slut
            planlaegTjek(tilstand ? TJEK_AKTIV_MS : TJEK_LEDIG_MS);
            return;
        }
        const minPc = !svar || !svar.navn || !cfg.skaermNavn ||
            String(svar.navn).toLowerCase() === String(cfg.skaermNavn).toLowerCase();
        if (svar && svar.aktiv && minPc) {
            await vis(svar);
            planlaegTjek(TJEK_AKTIV_MS);
        } else {
            luk();
            planlaegTjek(TJEK_LEDIG_MS);
        }
    }

    // ── Visningen ──

    async function vis(svar) {
        const foer = tilstand;
        tilstand = svar;
        slutKl = performance.now() + Math.max(0, Number(svar.sekunder) || 0) * 1000;
        byg();
        el.rod.hidden = false;
        document.documentElement.classList.add('kamera-visning-aaben');
        tegnOverlay();
        opdaterUr();
        if (!urTimer) urTimer = setInterval(opdaterUr, 1000);
        // Samme kamera og opløsning som sidst: kun overlay og vending ændres
        const sammeKamera = foer && strom && JSON.stringify(foer.kamera) === JSON.stringify(svar.kamera) &&
            foer.video.bredde === svar.video.bredde && foer.video.billeder === svar.video.billeder;
        if (!sammeKamera && !aabner) {
            // Ny opløsning eller et andet kamera: slip det gamle først (ét program ad gangen)
            stopStrom();
            aabner = aabnKamera(visningNr).finally(() => { aabner = null; });
            await aabner;
        }
    }

    function luk() {
        if (!tilstand && !strom && (!el || el.rod.hidden)) return;
        visningNr++;
        tilstand = null;
        stopStrom();
        clearInterval(urTimer);
        urTimer = null;
        if (el) {
            el.rod.hidden = true;
            el.video.srcObject = null;
        }
        document.documentElement.classList.remove('kamera-visning-aaben');
    }

    function stopStrom() {
        if (strom) strom.getTracks().forEach(t => t.stop());
        strom = null;
    }

    function opdaterUr() {
        if (!tilstand || !el) return;
        const sek = Math.max(0, Math.round((slutKl - performance.now()) / 1000));
        el.tid.textContent = `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
        if (sek <= 0) {
            luk();
            planlaegTjek(1000);
        }
    }

    function besked(tekst) {
        if (!el) return;
        el.besked.hidden = !tekst;
        el.besked.textContent = tekst || '';
    }

    // ── Kameraet ──

    const pause = (ms) => new Promise(r => setTimeout(r, ms));
    const normNavn = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

    async function aabnKamera(nr) {
        besked('Åbner kameraet …');
        const lukket = () => nr !== visningNr || !tilstand;
        for (let forsoeg = 1; forsoeg <= KAMERA_FORSOEG; forsoeg++) {
            if (lukket()) return;
            try {
                // Har PC'en skiftet kamera (admin valgte et andet), findes det igen
                const hvem = JSON.stringify(tilstand.kamera || null);
                if (hvem !== kameraFor) { kameraId = null; kameraFor = hvem; }
                if (!kameraId) kameraId = await findKamera(tilstand.kamera);
                if (lukket()) return;
                const v = tilstand.video || {};
                const ny = await navigator.mediaDevices.getUserMedia({
                    audio: false,
                    video: {
                        deviceId: { exact: kameraId },
                        width: { ideal: v.bredde || 1280 },
                        height: { ideal: v.hoejde || 720 },
                        frameRate: { ideal: v.billeder || 30 }
                    }
                });
                // Lukket, mens kameraet åbnede: slip det med det samme (streamen venter på det)
                if (lukket()) { ny.getTracks().forEach(t => t.stop()); return; }
                stopStrom();
                strom = ny;
                el.video.srcObject = strom;
                await el.video.play().catch(() => {});
                besked('');
                return;
            } catch (e) {
                const navn = e && e.name;
                if (navn === 'NotAllowedError' || navn === 'SecurityError') {
                    besked('Browseren må ikke bruge kameraet — opdatér Badminton TV på PC\'en');
                    return;
                }
                if (navn === 'NotFoundError' || navn === 'OverconstrainedError') {
                    // Kameraet er taget ud eller sat i et andet stik: find det igen
                    kameraId = null;
                }
                besked(navn === 'NotFoundError' ? 'Intet kamera fundet — er det sat i?' : 'Venter på kameraet …');
                await pause(KAMERA_PAUSE_MS);
            }
        }
        besked('Kameraet kunne ikke åbnes — luk kameravisningen og prøv igen');
    }

    // Det samme kamera som streamen: Chromium kalder kameraet "<kort> (<usb>)", fx
    // "Lenovo 500 RGB Camera (17ef:4831)". Har flere kameraer samme navn (et
    // Windows Hello-kamera har ofte en infrarød node med samme navn), vinder det med
    // flest farver i billedet — det infrarøde er gråt.
    async function findKamera(kamera) {
        let enheder = await videoEnheder();
        if (enheder.length && !enheder.some(d => d.label)) {
            // Navnene vises først, når siden har haft et kamera åbent
            const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            s.getTracks().forEach(t => t.stop());
            enheder = await videoEnheder();
        }
        if (!enheder.length) {
            const e = new Error('Intet kamera');
            e.name = 'NotFoundError';
            throw e;
        }
        const kort = normNavn(kamera && (kamera.kort || kamera.navn));
        const usb = kamera && kamera.usb ? `(${kamera.usb})` : null;
        const point = (d) => {
            const label = normNavn(d.label);
            return (usb && label.includes(usb) ? 2 : 0) + (kort && label.startsWith(kort) ? 1 : 0);
        };
        const bedst = Math.max(...enheder.map(point));
        const kandidater = bedst > 0 ? enheder.filter(d => point(d) === bedst) : enheder;
        if (kandidater.length === 1) return kandidater[0].deviceId;
        let valgt = kandidater[0].deviceId, mest = -1;
        for (const d of kandidater) {
            const farve = await farvemaetning(d.deviceId).catch(() => -1);
            if (farve > mest) { mest = farve; valgt = d.deviceId; }
        }
        return valgt;
    }

    async function videoEnheder() {
        return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    }

    // Gennemsnitlig farvemætning (0–255) i et lille billede fra kameraet
    async function farvemaetning(deviceId) {
        const s = await navigator.mediaDevices.getUserMedia({
            audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 640 } }
        });
        try {
            const v = document.createElement('video');
            v.muted = true;
            v.playsInline = true;
            v.srcObject = s;
            await v.play();
            await pause(600);   // lysmålingen skal lige finde sig til rette
            const c = document.createElement('canvas');
            c.width = 64;
            c.height = 36;
            const ctx = c.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) {
                sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
            }
            v.srcObject = null;
            return sum / (d.length / 4);
        } finally {
            s.getTracks().forEach(t => t.stop());
        }
    }

    // ── Opbygning og overlay ──

    function lav(tag, klasse, tekst) {
        const e = document.createElement(tag);
        if (klasse) e.className = klasse;
        if (tekst) e.textContent = tekst;
        return e;
    }

    function byg() {
        if (el) return;
        const rod = lav('div', 'kv');
        rod.hidden = true;
        rod.setAttribute('role', 'dialog');
        rod.setAttribute('aria-label', 'Kameravisning');
        const billede = lav('div', 'kv-billede');
        const video = lav('video', 'kv-video');
        video.muted = true;
        video.playsInline = true;
        video.autoplay = true;
        const linjer = lav('div', 'kv-linjer');
        ['v1', 'v2', 'h1', 'h2', 'mv', 'mh'].forEach(k => linjer.appendChild(lav('span', `kv-linje kv-linje--${k}`)));
        const ramme = lav('div', 'kv-ramme');
        ramme.appendChild(lav('span', 'kv-etiket', 'Plads til lange navne'));
        const tavle = lav('div', 'kv-tavle');
        const logo = lav('div', 'kv-logo');
        logo.appendChild(lav('span', 'kv-etiket', 'Logo'));
        billede.append(video, linjer, ramme, tavle, logo);
        const bjaelke = lav('div', 'kv-bjaelke');
        const titel = lav('span', 'kv-titel', 'Kameravisning');
        const tid = lav('span', 'kv-tid');
        const hjaelp = lav('span', 'kv-hjaelp', 'Luk i admin → Livestream · lukker af sig selv om');
        bjaelke.append(titel, hjaelp, tid);
        const besked = lav('div', 'kv-besked');
        besked.hidden = true;
        rod.append(billede, bjaelke, besked);
        document.body.appendChild(rod);
        el = { rod, billede, video, tavle, ramme, logo, tid, bjaelke, titel, besked };
        window.addEventListener('resize', tegnOverlay);
    }

    const px = (n) => `${Math.round(n)}px`;
    function placer(e, x, y, b, h) {
        e.style.left = px(x);
        e.style.top = px(y);
        e.style.width = px(b);
        e.style.height = px(h);
    }

    function tegnOverlay() {
        if (!el || !tilstand) return;
        const v = tilstand.video || {};
        // Billedet fylder så meget af skærmen som muligt i streamens format (16:9)
        const forhold = (v.bredde && v.hoejde) ? v.bredde / v.hoejde : 16 / 9;
        const B = Math.min(window.innerWidth, window.innerHeight * forhold);
        const H = B / forhold;
        el.billede.style.width = px(B);
        el.billede.style.height = px(H);

        // Vendt 180° = vandret + lodret; spejlvendt = vandret (som ffmpeg i streamen)
        const vandret = !!v.vend !== !!v.spejl;
        el.video.style.transform = `scale(${vandret ? -1 : 1}, ${v.vend ? -1 : 1})`;

        el.titel.textContent = tilstand.bane ? `Kameravisning · bane ${tilstand.bane}` : 'Kameravisning';

        const placering = v.placering || 'top-venstre';
        const hoejre = placering.endsWith('hoejre');
        const nederst = placering.startsWith('bund');
        // Bjælken i den modsatte side af scoreboardet, så den ikke dækker det
        el.rod.classList.toggle('kv--bjaelke-top', nederst);

        const s = B / 1280 * (STOERRELSE[v.stoerrelse] || 1);
        const t = TAVLE;
        const x0 = t.kant * s, y0 = t.top * s, hoejde = t.raekke * 2 * s, fane = t.fane * s;

        // Scoreboardet: et eksempel med to afsluttede sæt og stillingen nu
        const visTavle = tilstand.overlay !== false;
        el.tavle.hidden = !visTavle;
        el.ramme.hidden = !visTavle;
        if (visTavle) {
            const saet = 2;
            const panelB = (t.luft + t.prik + t.logo + t.navnEksempel + t.efterNavn + t.kol * saet + t.nu + t.nuLuft) * s;
            const maxB = (t.luft + t.prik + t.logo + t.navnMax + t.efterNavn + t.kol * 3 + t.nu + t.nuLuft) * s;
            const top = nederst ? H - y0 - hoejde : y0;
            const fx = (b) => hoejre ? B - x0 - b : x0;
            placer(el.tavle, fx(panelB), top, panelB, hoejde);
            // Rammen: den største plads, scoreboardet kan fylde (lange navne, tre sæt) — med fanen
            placer(el.ramme, fx(maxB), nederst ? top - fane : top, maxB, hoejde + fane);
            el.ramme.classList.toggle('kv-ramme--hoejre', hoejre);   // etiketten i den side, der er fri
            tegnTavle(s, saet, hoejre, nederst, panelB);
        }

        // Logoet i den modsatte side: højst en fjerdedel af bredden og scoreboardets højde
        el.logo.hidden = !tilstand.logo;
        if (tilstand.logo) {
            const lb = B * 0.25;
            placer(el.logo, hoejre ? x0 : B - x0 - lb, nederst ? H - y0 - hoejde : y0, lb, hoejde);
        }
    }

    // Eksemplets indhold i streamens mål: prik for serven, logo, navn, sæt og stillingen nu
    function tegnTavle(s, saet, hoejre, nederst, panelB) {
        const t = TAVLE;
        const tavle = el.tavle;
        tavle.textContent = '';
        tavle.style.setProperty('--kv-s', String(s));
        tavle.classList.toggle('kv-tavle--hoejre', hoejre);
        tavle.classList.toggle('kv-tavle--nederst', nederst);
        const raekker = [
            { navn: 'Spiller A / Spiller B', saet: [21, 19], nu: 11, serv: true },
            { navn: 'Spiller C / Spiller D', saet: [17, 21], nu: 8, serv: false }
        ];
        raekker.forEach((r, i) => {
            const raekke = lav('div', 'kv-raekke');
            raekke.style.top = px(t.raekke * i * s);
            raekke.style.height = px(t.raekke * s);
            const prik = lav('span', 'kv-prik' + (r.serv ? ' kv-prik--serv' : ''));
            prik.style.left = px(t.luft * s);
            const logo = lav('span', 'kv-klublogo');
            logo.style.left = px((t.luft + t.prik) * s);
            const navn = lav('span', 'kv-navn', r.navn);
            navn.style.left = px((t.luft + t.prik + t.logo) * s);
            navn.style.width = px(t.navnEksempel * s);
            raekke.append(prik, logo, navn);
            for (let k = 0; k < saet; k++) {
                const vundet = raekker[i].saet[k] > raekker[1 - i].saet[k];
                const tal = lav('span', 'kv-saet' + (vundet ? '' : ' kv-saet--tabt'), String(r.saet[k]));
                tal.style.left = px((t.luft + t.prik + t.logo + t.navnEksempel + t.efterNavn + t.kol * k) * s);
                tal.style.width = px(t.kol * s);
                raekke.appendChild(tal);
            }
            tavle.appendChild(raekke);
        });
        const nu = lav('div', 'kv-nu');
        placer(nu, panelB - (t.nu + t.nuLuft) * s, t.nuLuft * s, t.nu * s, (t.raekke * 2 - t.nuLuft * 2) * s);
        raekker.forEach(r => nu.appendChild(lav('span', 'kv-nu-tal', String(r.nu))));
        tavle.appendChild(nu);
        const fane = lav('div', 'kv-fane', tilstand.bane ? `BANE ${tilstand.bane}` : 'BANE');
        tavle.appendChild(fane);
    }

    window.KameraVisning = { start, tjek, luk };
})();
