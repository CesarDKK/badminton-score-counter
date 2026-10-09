/**
 * Session-vagt til admin-siderne (loades efter api.js).
 *
 *  - 5 minutter før admin-tokenet udløber: "Er du her stadig?" med nedtælling.
 *    "Jeg er her stadig" henter et nyt token (POST /api/session/forny).
 *  - Når tokenet udløber: logget ud og sendt til login (api.afslutSession).
 *  - På login-siden: beskeden om hvorfor man blev logget ud (loginBesked).
 *
 * Tjekket kører hvert sekund mod tokenets exp i stedet for én lang timer: en
 * timer går i stå, mens computeren sover, og fanen kan have stået i baggrunden.
 * Kun admin-logins vagtes — adgangslinks (TV, tablets) har ingen authToken.
 */
(function () {
    const api = window.BadmintonAPI;
    const VARSEL_MS = 5 * 60 * 1000;

    const CSS = `
        .sv-baggrund { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center;
            justify-content: center; padding: 16px; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); }
        .sv-boks { width: 100%; max-width: 420px; padding: 28px; border-radius: 18px; text-align: center;
            background: var(--color-bg-container, #16213e); color: #eaeaea;
            border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
            font-family: 'DM Sans', 'Segoe UI', sans-serif; }
        .sv-boks h2 { margin: 0 0 10px; font-family: 'Bebas Neue', sans-serif; font-weight: 400;
            font-size: 30px; letter-spacing: 1px; color: #fff; }
        .sv-boks p { margin: 0 0 6px; line-height: 1.5; color: rgba(255, 255, 255, 0.75); }
        .sv-tid { display: block; margin: 14px 0 22px; font-size: 44px; font-weight: 700;
            font-variant-numeric: tabular-nums; color: var(--color-accent, #e94560); }
        .sv-knapper { display: flex; gap: 10px; flex-wrap: wrap; }
        .sv-knapper button { flex: 1 1 140px; padding: 13px 16px; border-radius: 10px; font: inherit;
            font-weight: 600; cursor: pointer; border: 1px solid transparent; }
        .sv-bliv { background: var(--gradient-primary, #e94560); color: var(--color-on-accent, #fff); }
        .sv-bliv:disabled { opacity: 0.6; cursor: wait; }
        .sv-ud { background: transparent; color: rgba(255, 255, 255, 0.75); border-color: rgba(255, 255, 255, 0.2) !important; }
        .sv-fejl { min-height: 1.5em; margin-top: 12px; color: var(--color-danger, #d92c3f); font-size: 14px; }
        .sv-besked { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10000;
            width: calc(100% - 32px); max-width: 520px; padding: 14px 44px 14px 18px; border-radius: 12px;
            background: var(--color-bg-container, #16213e); color: #eaeaea;
            border: 1px solid rgba(var(--color-accent-rgb, 233, 69, 96), 0.6);
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); font-family: 'DM Sans', 'Segoe UI', sans-serif; line-height: 1.4; }
        .sv-besked button { position: absolute; top: 8px; right: 10px; background: none; border: 0;
            color: rgba(255, 255, 255, 0.6); font-size: 22px; line-height: 1; cursor: pointer; }
    `;

    function tilfoejCss() {
        if (document.getElementById('sv-css')) return;
        const s = document.createElement('style');
        s.id = 'sv-css';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    // Admin-tokenets udløb i ms, eller null hvis siden ikke har et admin-login
    function udloeb() {
        const token = sessionStorage.getItem('authToken');
        if (!token) return null;
        try {
            const p = window.decodeJwtPayload(token);
            return p.exp && p.role !== 'device' ? p.exp * 1000 : null;
        } catch { return null; }
    }

    let dialog = null;
    let titel = null;

    function visDialog() {
        if (dialog) return;
        tilfoejCss();
        titel = document.title;
        dialog = document.createElement('div');
        dialog.className = 'sv-baggrund';
        dialog.innerHTML = `
            <div class="sv-boks" role="alertdialog" aria-modal="true" aria-labelledby="sv-overskrift" aria-describedby="sv-tekst">
                <h2 id="sv-overskrift">Er du her stadig?</h2>
                <p id="sv-tekst">Af sikkerhedshensyn bliver du logget ud om</p>
                <span class="sv-tid" aria-live="off">5:00</span>
                <div class="sv-knapper">
                    <button type="button" class="sv-bliv">Jeg er her stadig</button>
                    <button type="button" class="sv-ud">Log ud</button>
                </div>
                <div class="sv-fejl" role="alert"></div>
            </div>`;
        document.body.appendChild(dialog);
        const bliv = dialog.querySelector('.sv-bliv');
        bliv.addEventListener('click', bliver);
        dialog.querySelector('.sv-ud').addEventListener('click', () => api.afslutSession());
        bliv.focus();
    }

    function skjulDialog() {
        if (!dialog) return;
        dialog.remove();
        dialog = null;
        document.title = titel;
    }

    async function bliver() {
        const knap = dialog.querySelector('.sv-bliv');
        const fejl = dialog.querySelector('.sv-fejl');
        knap.disabled = true;
        knap.textContent = 'Et øjeblik …';
        fejl.textContent = '';
        try {
            await api.fornySession();
            skjulDialog();
        } catch (err) {
            // 401 (sessionen gælder ikke længere) sender api.js selv til login
            if (!dialog) return;
            knap.disabled = false;
            knap.textContent = 'Jeg er her stadig';
            fejl.textContent = 'Kunne ikke nå serveren. Prøv igen.';
        }
    }

    function tjek() {
        const exp = udloeb();
        if (exp === null) { skjulDialog(); return; }
        const tilbage = exp - Date.now();
        if (tilbage <= 0) {
            api.sessionUdloebet();
            return;
        }
        if (tilbage > VARSEL_MS) { skjulDialog(); return; }
        visDialog();
        const sek = Math.ceil(tilbage / 1000);
        const tekst = `${Math.floor(sek / 60)}:${String(sek % 60).padStart(2, '0')}`;
        dialog.querySelector('.sv-tid').textContent = tekst;
        // Fanen i baggrunden: vis nedtællingen i fanens titel
        document.title = `Logges ud om ${tekst} – ${titel}`;
    }

    // Beskeden fra sidste udlogning (sat af api.js), vist én gang
    function visLoginBesked() {
        const besked = sessionStorage.getItem('loginBesked');
        if (!besked) return;
        sessionStorage.removeItem('loginBesked');
        if (udloeb() !== null) return; // allerede logget ind igen
        tilfoejCss();
        const el = document.createElement('div');
        el.className = 'sv-besked';
        el.setAttribute('role', 'status');
        el.textContent = besked;
        const luk = document.createElement('button');
        luk.type = 'button';
        luk.setAttribute('aria-label', 'Luk');
        luk.textContent = '×';
        luk.addEventListener('click', () => el.remove());
        el.appendChild(luk);
        document.body.appendChild(el);
    }

    function start() {
        visLoginBesked();
        tjek();
        setInterval(tjek, 1000);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) tjek(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
