/* ═══════════════════════════════════════════════════════════════════════
   Sproglag (da/en) for footballapp-frontenden.
   - Sproget gemmes i localStorage ('football_lang'), dansk er standard.
   - Statiske tekster markeres i HTML med data-i18n / data-i18n-placeholder /
     data-i18n-title / data-i18n-aria og opdateres af FI18N.apply().
   - Dynamiske tekster i JS hentes med FI18N.t(key, params).
   - Sider re-renderer selv via FI18N.onChange(fn).
   - En DA/EN-skifter renderes i alle elementer med id/class "langToggle".
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  const STORAGE_KEY = 'football_lang';
  const DICT = {
    /* ── Fælles ── */
    'brand.football': { da: 'Football', en: 'Football' },
    'common.admin': { da: 'Admin', en: 'Admin' },
    'common.back': { da: 'Tilbage', en: 'Back' },
    'common.save': { da: 'Gem', en: 'Save' },
    'common.clear': { da: 'Ryd', en: 'Clear' },
    'common.delete': { da: 'Slet', en: 'Delete' },
    'common.cancel': { da: 'Annuller', en: 'Cancel' },
    'common.close': { da: 'Luk', en: 'Close' },
    'common.upload': { da: 'Upload', en: 'Upload' },
    'common.error': { da: 'Fejl', en: 'Error' },
    'common.loading': { da: 'Indlæser...', en: 'Loading...' },
    'common.vs': { da: 'vs', en: 'vs' },
    'common.tbd': { da: 'Afventer', en: 'TBD' },

    /* ── Status-pills ── */
    'status.setup': { da: 'Opsætning', en: 'Setup' },
    'status.pool_stage': { da: 'Puljespil', en: 'Pool stage' },
    'status.cup_stage': { da: 'Cup-fase', en: 'Cup stage' },
    'status.finished': { da: 'Afsluttet', en: 'Finished' },
    'status.completed': { da: 'Færdigspillet', en: 'Completed' },

    /* ── Public ── */
    'public.title': { da: 'Football-turnering', en: 'Football Tournament' },
    'public.liveTournaments': { da: 'Live-turneringer', en: 'Live tournaments' },
    'public.tournaments': { da: 'Turneringer', en: 'Tournaments' },
    'public.poolStage': { da: 'Puljespil', en: 'Pool stage' },
    'public.cupStage': { da: 'Cup-fase', en: 'Cup stage' },
    'public.noTournaments': { da: 'Ingen turneringer endnu', en: 'No tournaments yet' },
    'public.noTournamentsHint': { da: 'Turneringer vises her, når de er oprettet.', en: "Tournaments will appear here once they're created." },
    'public.meta': { da: '{pools} puljer · {teams} hold pr. pulje', en: '{pools} pools · {teams} teams per pool' },
    'public.apexText': { da: 'Hver klub har sit eget subdomæne — fx <strong>jeresklub.footballapp.dk</strong>.<br>Kontakt din klubadministrator for adgang.', en: 'Each club has its own subdomain — e.g. <strong>yourclub.footballapp.dk</strong>.<br>Contact your club administrator for access.' },
    'public.stats': { da: 'K{p} · V{w} · U{d} · T{l} · MF {gd}', en: 'P{p} · W{w} · D{d} · L{l} · GD {gd}' },
    'public.statsCompact': { da: 'K{p}·V{w}·U{d}·T{l}·MF {gd}', en: 'P{p}·W{w}·D{d}·L{l}·GD {gd}' },

    /* ── Bracket-runder ── */
    'round.final': { da: 'Finale', en: 'Final' },
    'round.semifinal': { da: 'Semifinale', en: 'Semifinal' },
    'round.quarterfinal': { da: 'Kvartfinale', en: 'Quarterfinal' },
    'round.n': { da: 'Runde {n}', en: 'Round {n}' },

    /* ── Login ── */
    'login.title': { da: 'Admin-login — Football', en: 'Admin Login — Football' },
    'login.control': { da: 'Turneringsstyring', en: 'Tournament Control' },
    'login.apexNotice': { da: 'Login skal ske fra jeres klub-subdomæne — fx <code>jeresklub.footballapp.dk/login.html</code>', en: 'Log in from your club subdomain — e.g. <code>yourclub.footballapp.dk/login.html</code>' },
    'login.username': { da: 'Brugernavn', en: 'Username' },
    'login.password': { da: 'Kodeord', en: 'Password' },
    'login.signIn': { da: 'Log ind', en: 'Sign in' },
    'login.backToPublic': { da: '← Tilbage til forsiden', en: '← Back to public site' },
    'login.noClub': { da: 'Ingen klub valgt', en: 'No club selected' },
    'login.failed': { da: 'Login mislykkedes', en: 'Login failed' },

    /* ── Admin: liste ── */
    'admin.view': { da: 'Vis', en: 'View' },
    'admin.viewTitle': { da: 'Offentlig side', en: 'Public site' },
    'admin.logout': { da: 'Log ud', en: 'Log out' },
    'admin.control': { da: 'Turneringsstyring', en: 'Tournament control' },
    'admin.tournaments': { da: 'Turneringer', en: 'Tournaments' },
    'admin.newTournament': { da: 'Ny turnering', en: 'New tournament' },
    'admin.noTournaments': { da: 'Ingen turneringer endnu', en: 'No tournaments yet' },
    'admin.noTournamentsHint': { da: 'Tryk på "Ny turnering" for at oprette den første.', en: 'Tap "New tournament" to create your first one.' },
    'admin.allTournaments': { da: 'Alle turneringer', en: 'All tournaments' },
    'admin.confirmDelete': { da: 'Slet denne turnering? Dette kan ikke fortrydes.', en: 'Delete this tournament? This cannot be undone.' },

    /* ── Admin: wizard ── */
    'wizard.create': { da: 'Opret turnering', en: 'Create tournament' },
    'wizard.stepOf': { da: 'Trin {n} af 4', en: 'Step {n} of 4' },
    'wizard.basics': { da: 'Grundoplysninger', en: 'Basics' },
    'wizard.addLogo': { da: 'Tilføj logo', en: 'Add logo' },
    'wizard.logoHelp': { da: 'Valgfrit. Kvadratiske billeder fungerer bedst.<br />Max 2 MB. PNG, JPG, WebP, SVG.', en: 'Optional. Square images work best.<br />Max 2MB. PNG, JPG, WebP, SVG.' },
    'wizard.tournamentName': { da: 'Turneringens navn', en: 'Tournament name' },
    'wizard.namePlaceholder': { da: 'Forårscup 2026', en: 'Spring Cup 2026' },
    'wizard.pools': { da: 'Puljer', en: 'Pools' },
    'wizard.teamsPerPool': { da: 'Hold pr. pulje', en: 'Teams per pool' },
    'wizard.scoring': { da: 'Point', en: 'Scoring' },
    'wizard.win': { da: 'Sejr', en: 'Win' },
    'wizard.draw': { da: 'Uafgjort', en: 'Draw' },
    'wizard.loss': { da: 'Nederlag', en: 'Loss' },
    'wizard.next': { da: 'Næste →', en: 'Next →' },
    'wizard.prev': { da: '← Tilbage', en: '← Back' },
    'wizard.poolsTeams': { da: 'Puljer og hold', en: 'Pools & teams' },
    'wizard.poolsTeamsHint': { da: 'Skriv holdnavne for hver pulje. I kan tilføje holdlogoer senere.', en: 'Enter team names for each pool. You can upload team logos later.' },
    'wizard.teamPlaceholder': { da: 'Hold {n}', en: 'Team {n}' },
    'wizard.cupSetup': { da: 'Cup-opsætning', en: 'Cup setup' },
    'wizard.cupSetupHint': { da: 'Vælg hvilke puljeplaceringer der går i hvilken cup. Fx med 2 puljer à 4 hold: nr. 1+2 fra hver pulje i "A-Cup" og nr. 3+4 i "B-Cup".', en: 'Define which pool placements feed each cup. E.g. with 2 pools of 4: place 1+2 from each pool in "Championship Cup", and 3+4 in "Plate Cup".' },
    'wizard.addCup': { da: 'Tilføj cup', en: 'Add cup' },
    'wizard.placementsLabel': { da: 'Puljeplaceringer der går i denne cup', en: 'Pool placements feeding this cup' },
    'wizard.teamsWillEnter': { da: '{n} hold går i denne cup', en: '{n} teams will enter this cup' },
    'wizard.review': { da: 'Gennemse og opret', en: 'Review & create' },
    'wizard.reviewMeta': { da: '{pools} puljer × {teams} hold ({total} i alt)', en: '{pools} pools × {teams} teams ({total} total)' },
    'wizard.reviewScoring': { da: 'Point: {pw} / {pd} / {pl} (Sejr / Uafgjort / Nederlag)', en: 'Scoring: {pw} / {pd} / {pl} (Win / Draw / Loss)' },
    'wizard.reviewPools': { da: 'Puljer', en: 'Pools' },
    'wizard.reviewCups': { da: 'Cups', en: 'Cups' },
    'wizard.noCups': { da: 'Ingen cups konfigureret.', en: 'No cups configured.' },
    'wizard.unnamed': { da: '(unavngivet)', en: '(unnamed)' },
    'wizard.reviewCupLine': { da: 'placeringer {placements} → {n} hold', en: 'placements {placements} → {n} teams' },
    'wizard.nameRequired': { da: 'Skriv et navn til turneringen', en: 'Please enter a tournament name' },
    'wizard.defaultPoolPrefix': { da: 'Pulje ', en: 'Pool ' },
    'wizard.defaultCupA': { da: 'A-Cup', en: 'Championship Cup' },
    'wizard.defaultCupB': { da: 'B-Cup', en: 'Plate Cup' },
    'wizard.defaultCupN': { da: 'Cup {n}', en: 'Cup {n}' },
    'wizard.defaultTeamName': { da: 'Hold', en: 'Team' },

    /* ── Admin: kampe og fejl ── */
    'match.invalidScores': { da: 'Indtast gyldige scores (0 eller derover)', en: 'Enter valid non-negative scores' },
    'match.saveFailed': { da: 'Kunne ikke gemme: {msg}', en: 'Save failed: {msg}' },
    'match.clearFailed': { da: 'Kunne ikke rydde: {msg}', en: 'Clear failed: {msg}' },
    'admin.deleteFailed': { da: 'Kunne ikke slette: {msg}', en: 'Delete failed: {msg}' },
    'admin.loadFailed': { da: 'Kunne ikke indlæse: {msg}', en: 'Failed to load: {msg}' },

    /* ── Logo-vælger ── */
    'logo.choose': { da: 'Vælg logo', en: 'Choose logo' },
    'logo.chooseTournament': { da: 'Vælg turneringslogo', en: 'Choose tournament logo' },
    'logo.chooseTeam': { da: 'Vælg holdlogo', en: 'Choose team logo' },
    'logo.search': { da: 'Søg logoer...', en: 'Search logos...' },
    'logo.allTypes': { da: 'Alle typer', en: 'All types' },
    'logo.kindClub': { da: 'Klublogoer', en: 'Club logos' },
    'logo.kindFlag': { da: 'Landeflag', en: 'Country flags' },
    'logo.kindSponsor': { da: 'Sponsorer', en: 'Sponsors' },
    'logo.uploadNew': { da: '+ Upload nyt', en: '+ Upload new' },
    'logo.uploadName': { da: 'Navn (søgbart)', en: 'Name (searchable)' },
    'logo.uploadNamePlaceholder': { da: 'fx Lyngby BK', en: 'e.g. Lyngby BK' },
    'logo.uploadFile': { da: 'Fil', en: 'File' },
    'logo.none': { da: 'Ingen logoer fundet', en: 'No logos found' },
    'logo.fillNameAndFile': { da: 'Udfyld navn og vælg en fil', en: 'Enter a name and choose a file' },
    'logo.uploading': { da: 'Uploader...', en: 'Uploading...' },
    'logo.added': { da: '✓ Logo tilføjet til biblioteket', en: '✓ Logo added to library' },
    'logo.assignFailed': { da: 'Logo-tildeling fejlede: {msg}', en: 'Logo assignment failed: {msg}' },
    'logo.global': { da: 'Global', en: 'Global' },
  };

  let lang = localStorage.getItem(STORAGE_KEY);
  const urlLang = new URLSearchParams(window.location.search).get('lang');
  if (urlLang === 'da' || urlLang === 'en') lang = urlLang;
  if (lang !== 'da' && lang !== 'en') lang = 'da';

  const listeners = [];

  function t(key, params) {
    const entry = DICT[key];
    let text = entry ? (entry[lang] || entry.da) : key;
    if (params) {
      Object.keys(params).forEach((p) => {
        text = text.split('{' + p + '}').join(params[p]);
      });
    }
    return text;
  }

  /* Danske ordenstal skrives "1.", engelske "1st" */
  function ordinal(n) {
    if (lang === 'da') return n + '.';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    scope.querySelectorAll('[data-i18n-step]').forEach((el) => { el.textContent = t('wizard.stepOf', { n: el.dataset.i18nStep }); });
    document.documentElement.lang = lang;
    renderToggles();
  }

  function set(newLang) {
    if (newLang !== 'da' && newLang !== 'en') return;
    lang = newLang;
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
    listeners.forEach((fn) => { try { fn(lang); } catch (e) { console.error(e); } });
  }

  function onChange(fn) { listeners.push(fn); }

  function renderToggles() {
    document.querySelectorAll('#langToggle, .langToggle').forEach((host) => {
      host.innerHTML = '';
      host.style.display = 'inline-flex';
      host.style.gap = '2px';
      host.style.border = '1px solid var(--border-soft, rgba(255,255,255,0.14))';
      host.style.borderRadius = '100px';
      host.style.padding = '2px';
      ['da', 'en'].forEach((l) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = l.toUpperCase();
        btn.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
        btn.style.cssText = 'border:none; cursor:pointer; font:inherit; font-size:12px; font-weight:600; letter-spacing:0.5px; padding:4px 10px; border-radius:100px; transition:background 0.15s, color 0.15s;'
          + (l === lang
            ? 'background:rgba(255,255,255,0.14); color:#fff;'
            : 'background:transparent; color:rgba(255,255,255,0.45);');
        btn.addEventListener('click', () => set(l));
        host.appendChild(btn);
      });
    });
  }

  window.FI18N = { t, set, apply, onChange, ordinal, get lang() { return lang; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    apply();
  }
})();
