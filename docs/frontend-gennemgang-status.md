# Frontend-gennemgang — status og videre arbejde

**Sidst opdateret:** 14. juli 2026
**Grundlag:** Fuld gennemgang af alle frontend-sider (~130 forslag).
**Dagens arbejde er committet på branchen `frontend-gennemgang-fixes`** (commit `481ed73`,
43 filer, +708/−5530). Branchen er IKKE pushet/merget endnu. Backend-ændringer
(`server.js`, `routes/settings.js`, `init.sql`) kræver image-rebuild ved permanent deploy.

---

## 🔁 Selv-review-runde (15. juli 2026) — fejl i selve gennemgangen fundet + rettet

En efterfølgende 8-vinkel code-review af branchen fandt ægte fejl indført af selve
rettelserne. Alle rettet og testet live:
- **Android-appen loadede den slettede court.html** (legacy-tilstand læste fjernet
  courtVersion-felt) → loader nu court-v3.html direkte. **Vigtigst.**
- **theme-loader tjekkede ikke response.ok** → en 500-fejlbody overskrev en gyldig
  tema-cache. Tjekker nu response.ok.
- **pagehide-flushen sendte kun en delmængde** af spiltilstanden (serve-position/sider/
  pause manglede) → udtrukket fælles buildSavePayload(); flushen sender nu alt.
- **Wake Lock blev ikke genanskaffet** når man fortrød det vindende point → gør det nu.
- **Tema-preview satte færre CSS-variabler** end den rigtige applyTheme (--color-*-rgb,
  on-accent) → preview gik gennem theme-loaderens applyTheme; forhåndsvisningen er nu
  farve-korrekt.
- **commitPreview ryddede tilstand før gemning** → fejlet gemning efterlod ugemte farver
  uden bjælke; beholder nu bjælken ved fejl.
- **Hårdkodede badge-farver** (#ffb02e) brød tema-reglen → nyt `--color-warning`-token i
  theme-loader (tilgængeligt på alle sider inkl. TV, som ikke loader styles.css).
- README/docs opdateret (watch.html/court_version udfaset); TV_V3_IMPLEMENTATION_SUMMARY.md
  slettet; super-admins escapeHtml fik nullish-guard.
- **Kendt afvejning (ikke rettet):** POST-retry er fjernet for at undgå dublet-gemte
  kampe, men saveMatchResult har nu intet sikkerhedsnet ved et blip. Idempotens-nøgle/kø
  er den rigtige løsning — udestår som beslutning.

## ✅ Færdigt (committet på branch)

**Fejlrettelser**
- `changeClubAdminPassword`-dublet i api.js (klub-admin kan skifte eget kodeord igen)
- Fortryd i Tælleren: navne i snapshot + aktiv pause annulleres (kunne bytte score/navne)
- Kamphistorik-søgning dækker nu hele historikken (var kun seneste 30)
- Kodeord ensrettet til min. 8 tegn (frontend + backend)

**Sikkerhed**
- escapeHtml hærdet (escaper nu " og ') — lukker attribut-injektion
- Navne/filnavne fjernet fra inline onclick (super-admin, sponsor, player-info, admin)
- XSS i TV'ets "Kamp afgjort"-overlay lukket
- Open redirect i klub-login lukket
- auth-guard tilføjet på settings, sponsor, player-info, theme
- POST/DELETE retries ikke længere (kunne duplikere kampresultater)
- JWT-decode håndterer base64url
- Tema-visning hex-validerer DB-værdier

**UX**
- Tælleren: Screen Wake Lock, offline-indikator, pagehide-flush (fetch keepalive)
- TV: netværksblip skjuler ikke længere scoreboardet (badge + slideshow først efter 4 fejl)
- theme-loader: localStorage-cache + synkron anvendelse → ingen tema-flash (FOUC)
- settings: bekræftelsesfelt til nyt kodeord
- landing: fejl rydder begge sektioner + "Prøv igen"-knap + tom-tilstand
- theme-siden: preset forhåndsviser (Gem/Fortryd-bjælke), login verificeres, fejl vises med retry

**Oprydning**
- v2 udfaset (court.html/tv.html + v2-scripts + tv-styles.css + api-v2.js slettet;
  versionsvælger fjernet fra UI + api + backend + tests + init.sql)
- Døde v1-filer, watch.html og forældet rod-Dockerfile slettet

**Bortfaldet automatisk med v2-oprydningen:** inkonsistent v2/v3-default, v2-TV'ets XSS-hul,
qr-parameter-tab ved versionsskift, v2's clock-skew-timer, "TV på svageste API-klient",
api.js/api-v2-navneforvirring.

---

## ⚠️ Åbne beslutninger (kræver stillingtagen)

1. **Push/merge af `frontend-gennemgang-fixes`** + image-rebuild til permanent drift.
2. **auth-guard på `super-admin` og `oversigt`** — bevidst sprunget over (super-admin er
   andet auth-realm med eget login; oversigt er offentlig storskærm hvor login kan bryde
   ubemandede skærme). Skal de have det alligevel?
3. **Backend-afhængige fund** — SSE-staleness (server-ping + watchdog) og server-side
   skalering af sponsorbilleder kan ikke løses i frontenden alene. Tager vi backend med?
4. **Store refaktoreringer** — `admin-script.js`-split (~3900 linjer) og fælles farve-tokens.
   Værd at gøre, men bevidst valg om hvornår.

---

## ⬜ Udestående arbejde (prioriteret)

### Robusthed ved langtidskørsel (TV/oversigt) — DELVIST FÆRDIG (15. juli 2026)
Løst via **push af hjælpe-data** (SSE-config-events): backend broadcaster nu
`{type:'config', scope}` ved ændring af sponsorer/settings/tema/spiller-logoer
(DRY finish-hooks i sponsors.js/settings.js/playerLogos.js). TV/oversigt lytter,
invaliderer den relevante cache og henter kun da. Config-events passerer bane-
filteret. Et langsomt sikkerhedsnet (5 min) selvheler ved missede events + fanger
super-admins centrale logo-ændringer (som ikke pushes pr. tenant).
- ~~Logo-caches på TV/oversigt opdateres aldrig~~ → invalideres på 'logos'-event + sikkerhedsnet
- ~~Oversigt henter banner-listen hver 2. sekund~~ → cachet, opdateres kun på 'sponsors'-event (0 fetches i 2s-loopet)
- ~~10 s sponsor/idle-timere på TV+oversigt~~ → erstattet af push + 5-min sikkerhedsnet
- **Udestår stadig:**
  - [MELLEM] Idle-QR-koden fornys aldrig — genindlæs periodisk (kan blive død hvis token udløber)
  - [MELLEM] Staleness-detektion i SSE-klienten (`live-updates.js`) — server sender allerede `: ping` hvert 25s;
    mangler en klient-watchdog der genforbinder ved lang stilhed
  - [MELLEM] Super-admins centrale logo-bibliotek pushes ikke pr. tenant (kræver cross-tenant broadcast) — dækkes af 5-min sikkerhedsnettet
  - [LILLE] Ufuldstændig `beforeunload`-oprydning, `courtMatchTimes` mini-leak, pause-nedtælling på vægur, burn-in

### Performance ✅ FÆRDIG (15. juli 2026)
- ~~Tællerens `serverSyncTick` fyrer op til 4 API-kald pr. tick~~ → "grund" trådes gennem sync-kæden;
  almindelige point-events laver nu **1 kald** (kun getGameState), fuld holdkamp/turnerings-detektion
  kun ved sikkerhedspoll + `'assignment'`-events. Verificeret: update=1, poll/assignment=4.
- ~~Admin-baneoversigt N+1~~ → ét `getAllGameStates`-batch i stedet for `getGameState` pr. bane (9→1 kald/tick);
  `courtCount` cachet (nulstilles ved `'settings'`-event); polling springer helt over når sektionen er skjult (0 kald).
- ~~TV: `getTeamMatchByCourt` ved hver poll~~ → holdkamp-bindingen cachet, genhentes kun ved ny kamp,
  `'assignment'`-event og 5-min sikkerhedsnet (verificeret: 1 kald over 5 loads).
- ~~Pausen gemmer hvert sekund~~ → gemmer hvert 10. sekund (TV tæller selv ned; kun drift-korrektion) — 90% færre SSE-events.
- ~~Dobbelt `getSettings()` ved TV-opstart~~ → slået sammen til ét kald.
- **Udestår (LILLE):** slideshow re-renderer img pr. slide; index.html meta-refresh → server-302.

### PWA / service worker / cache ✅ FÆRDIG (15. juli 2026)
- ~~SW-cachen ryddes aldrig~~ → cache versioneret (`badminton-v2`) + `activate` sletter alle ikke-aktuelle caches (bevist end-to-end)
- ~~Offline-fallback kan returnere `undefined`~~ → returnerer nu altid en rigtig `Response` (503/504)
- ~~manifest/SW kun på court-sider~~ → SW-registrering + manifest-link centraliseret i `theme-loader.js` (alle sider)
- ~~manifest mangler 512px + maskable ikon~~ → tilføjet `favicon-maskable.svg` (maskable) + SVG "any" skalerer til 512+
- ~~fonte bør være cache-first~~ → SW er nu cache-first for fonte + billeder, network-first for HTML/CSS/JS
- **Central cache-strategi:** HTML får nu `Cache-Control: no-cache` i nginx (revalidér altid), så nye `?v=`-referencer
  opdages straks. Bemærk: JS var allerede `no-store` i nginx, så JS-`?v=` er reelt kun relevant for SW-cachen.
  Fuld hash-stempling i build udestår stadig som [MELLEM] hvis ønsket, men er nu mindre presserende.

### Kodekvalitet / oprydning
- [STOR] Split `admin-script.js` (~3900 linjer → moduler: oversigt, holdkamp, historik,
  autocomplete, device tokens, bp-import, turnering)
- [MELLEM] Farve-tokens: `--color-danger`, `--color-warning`, `--color-info`, `--color-win-rgb`
  (tre fare-røde, to oranger, inkonsistent vinder-grøn, hardkodede statusfarver i JS)
- [MELLEM] Fire `showMessage`-implementationer → én fælles i utils.js; utils.js på alle sider (kun 2 af ~12 nu)
- [MELLEM] Native `alert()`/`confirm()` i super-admin (16+ steder) og admin-turnering → temastylede modaler
- [MELLEM] `checkGameWin()` duplikeret ×2 (tælleren); TV'ets swap-logik ×3, set-bokse ×3
- [LILLE] Død kode: marquee-rester i tv-v3, `loadCourtData()`/`noMatchesMessage` i oversigt,
  dummy `switchSidesBtn`, `TV_V3_IMPLEMENTATION_SUMMARY.md` i roden
- [LILLE] `?dt=`-håndtering duplikeret (api.js + auth-guard); default-temafarver uenige 3-4 steder;
  theme-script.js vs theme-loader.js navneforvirring

### Tilgængelighed (tværgående)
- [MELLEM] Synligt tastaturfokus (`:focus-visible`) app-bredt; modaler som rigtige dialoger
  (`role="dialog"`, Escape, fokusfælde); labels bundet med `for=`; touch-mål under 44 px i Tælleren;
  contenteditable navnefelter usynlige for tastatur/skærmlæser
- [LILLE] `user-scalable=no` (behold evt. kun på tælleren); `prefers-reduced-motion` på landing/login;
  lav kontrast på hint-tekster (#666/#777) og `.set-label`

### Småting (hale)
- Landing: `rel="noopener"` på TV-knapper, stagger-animation stopper ved knap 12/8, emoji-TV-ikon,
  "Display"/"Admin Panel" på engelsk
- Klub-login: intet `<form>`-element (password managers), labels uden `for=`, rå serverfejl vises
- Tema-siden: preset-farver duplikeret i HTML+JS, hardkodet "Version 2.0" i footer, `pattern`-attributter uden virkning
- Settings: NaN-tjek på baneantal, inkonsistent gem-model (toggles vs Gem-knapper)
- Sponsor: "Slet alle" sletter serielt og ignorerer fejl, checkbox-selektor rammer labels, upload uden fremskridt
- Player-info: ingen søgning i spillerlisten, debug-console.log efterladt, logo-override følger ikke med ved navneændring
- Super-admin: succes-feedback ved "Skift kode", subdomain-validering client-side, Enter-submit på opret-felter
- Tælleren: dobbelttryk-værn på +1, `touch-action: manipulation` på alle knapper, timer-interval stoppes ikke ved kampslut,
  `alert()` i initializeApp, sidetitlen "(Ny Version)"
- TV: cached score 0 vises som "-", timer skriver DOM hver 500 ms, console-spam hver 2. sek.
- Fælles: fonts.css vægt 500/600 peger på samme fil, `beforeunload` dræber bfcache (→ `pagehide`),
  fjerbold-SVG duplikeret inline, `@keyframes fadeUp` defineret 4 gange

---

## Anbefalet næste skridt

1. Push/merge branchen (efter din gennemgang) + image-rebuild.
2. Tag **PWA/SW + cache-strategien** som næste blok — afgrænset, fjerner en reel driftsirritation.
3. Gem de store refaktoreringer (admin-script.js, farve-tokens) til der ikke er lavthængende frugt tilbage.
