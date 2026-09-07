# planner.badmintonapp.dk

Tidsplanlægger til individuelle badmintonturneringer. Designet står i
[docs/planner-design.md](../docs/planner-design.md); dette er den praktiske
vejledning til koden.

Alt sker i browseren: `.TP`-filen (Tournament Planner, en Access-database)
læses med `mdb-reader`, og projektet gemmes i `localStorage` og som JSON-fil.
Der er ingen backend, og persondata forlader aldrig brugerens maskine.

## Mapper

| Sti | Indhold |
|---|---|
| `index.html`, `planner.css` | Siden med de fire faner |
| `src/app.js` | Indgang: tilstand, faner, filåbning, import-valg |
| `src/tp-reader.js` | `.TP`-tabeller → projektmodel (rene funktioner) |
| `src/store.js` | Projektfil: nyt projekt, genindlæsning, ændringer, persistens |
| `src/kapacitet.js` | Slots og bane-slots pr. dag mod kampe |
| `src/rules.js` | Reglerne (design § 5): `tjekPlan(projekt)` → fejl/advarsler pr. kamp og slot |
| `src/scheduler.js` | Planlæggeren (design § 7.4): `lavForslag(projekt)` → plan, ikke placerede med årsag, statistik; `bedoemPlan` |
| `src/ui/opsaetning.js` | Fane 1: fil og opsætning |
| `src/ui/plan.js` | Fane 2: gitter pr. dag, træk-og-slip, ikke placerede kampe, spillervisning |
| `src/ui/tjek.js` | Fane 3: fejl og advarsler med "Vis" og "Kvittér" |
| `src/ui/liste.js` | Fane 4: listen til indtastning i TP (`byggListe` er ren), kopiér som tekst, udskrift |
| `tp-bundle.js` | Bygget bundle af `mdb-reader` + Buffer-polyfill (**committes**) |
| `build/` | esbuild-script til `tp-bundle.js` |
| `tests/unit/` | Node `--test`-tests |
| `testdata/` | Lokale `.TP`-testfiler — gitignored, aldrig i repoet |

## Kommandoer

Node findes ikke på udviklings-pc'en; alt kører via Docker fra mappen `planner/`:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:20-alpine sh -c "npm install --no-audit --no-fund && npm run test:unit"
```

Byg `tp-bundle.js` igen, når `mdb-reader` opdateres (bundlet committes):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:20-alpine sh -c "npm install --no-audit --no-fund && npm run build"
```

Tests mod de rigtige Lyngby-filer kører kun, hvis filerne ligger i
`planner/testdata/` (eller mappen i `PLANNER_TESTDATA`); ellers springes de
over. CI kører de syntetiske tests ved hvert push.

## Lokal test i browseren

Sitet serveres af `badminton-frontend` (nginx) med `server_name planner.localhost`.
Hurtig test uden rebuild:

```bash
docker cp planner/index.html badminton-frontend:/usr/share/nginx/planner/ && docker cp planner/planner.css badminton-frontend:/usr/share/nginx/planner/ && docker cp planner/tp-bundle.js badminton-frontend:/usr/share/nginx/planner/ && docker cp planner/src badminton-frontend:/usr/share/nginx/planner/ && docker cp nginx.conf badminton-frontend:/etc/nginx/conf.d/default.conf && docker exec badminton-frontend nginx -s reload
```

Åbn derefter <http://planner.localhost:8080/>. Første gang skal fonts kopieres
ind i containeren (`Dockerfile.frontend` gør det ved build):

```bash
docker exec badminton-frontend sh -c "cp -r /usr/share/nginx/html/fonts /usr/share/nginx/planner/fonts && cp /usr/share/nginx/marketing/fonts.css /usr/share/nginx/planner/fonts.css"
```

Permanent deploy: `docker compose build frontend` som for de øvrige sites.

## Modellen i korte træk

- Kamp-id er `d<draw>:<planning>` (TP's egne nøgler), Swiss-pladsholdere
  `d<draw>:r<runde>:<nr>`. `tpRef` gør det muligt at genindlæse en nyere fil
  og beholde tider på de kampe, der stadig findes.
- Puljekampe har `spillere` (kendte); cupkampe har `muligeSpillere` (alle fra
  de puljer, `Link`-tabellen peger på) og `afhaengerAf` (kampene der skal være
  spillet først). Bye-kampe i cupper udelades.
- Datoer fra `mdb-reader` er UTC-`Date` med vægurets tid; læs altid med
  `getUTC*`.

## Regler og pause-fortolkning

`rules.js` skelner mellem kendte spillere (puljekampe: fejl) og mulige spillere
(cupkampe: advarsel), og springer par af kampe i samme lodtrækning over, hvor
den ene ikke bygger på den anden (to semifinaler kan ikke dele spillere).

Opsætningen "En kamp regnes til" styrer pausetjekket:

- **reglementets minimumstid (som TP)** — standard. Ungdom A–D: 20 min +
  10 min pause = 30, så samme spiller må stå i naboslots ved 30-min slots.
  Jespers egne planer fra 2025/2026 følger denne praksis.
- **et helt slot (streng)** — slot + pause mellem starttiderne, dvs. mindst
  60 min ved 30-min slots.

Swiss Ladder-runder 2+ er pladsholdere uden spillere; de tjekkes samlet pr.
runde (runde r+1 tidligst når runde r er slut plus pause).

## Planlæggeren ("Lav forslag")

`scheduler.js` placerer kampene grådigt slot for slot og håndhæver de samme
hårde regler som `rules.js` (kapacitet med halve baner, spiller i ét slot,
pause med samme fortolkning, afhængigheder, tidsvindue, max kampe pr. dag,
rækkens dage). Låste kampe (dobbeltklik på et kort, eller "Lås <kategori>")
beholder deres tid; "Forslag for dagen" planlægger kun den valgte dag om.

Prioriteten blandt kampe, der kan spilles i et slot, er i rækkefølge: spillere
der allerede har spillet i dag (kortest haltid), længden af kæden af kampe der
bygger på kampen (så sidste kategori ikke løber tør for dag), rækkens
rækkefølge (mix → single → double), runde. Målt 2026-09-07 mod Jespers egne
planer med samme lodtrækning:

| | Jesper haltid/vent | Forslag haltid/vent | Slut pr. dag |
|---|---|---|---|
| U13/U15 CD 2026 | 206 / 82 min | 162 / 39 min | 16:30, 15:30 (Jesper 18:00, 16:30) |
| U9/U11 BCD 2025 | 255 / 135 min | 138 / 18 min | 17:30, 17:00 (Jesper 19:30, 17:30) |

Haltid = sidste kamp minus første kamp pr. spiller pr. dag; vent = haltid minus
egne kampe. Forslaget tager ca. 25 ms for 300 kampe.

## Fase 4: Swiss-blokke, liste og tidsrum pr. række

- **Swiss Ladder-runder** vises i gitteret som én blok pr. runde pr. slot
  ("Runde 3 · 9 kampe · halve baner"). Blokken trækkes, låses og fjernes samlet.
  Runde 1 har kendte parringer (hover). TP har én tid pr. runde, så listen
  giver rundens første slot og bemærker, hvis runden fylder flere slots.
- **Fane 4 Liste**: pr. kategori i TP's rækkefølge (puljer, derefter
  cup-runder) med TP's kampnummer, dag og klokkeslæt; klik på en linje hopper
  til kampen i gitteret. "Kopiér som tekst" og "Udskriv" (print-stylesheet).
- **Tidsrum pr. række** (valgfrit, fane 1): fx U9 kun 12:00–17:00. Forslaget
  holder sig inden for det, og Tjek advarer (kvitterbart), hvis kampe ligger
  udenfor. Planlæggeren prioriterer rækker med den tidligste frist først
  (eget tidsrum eller årgangens tidsvindue), så et U9-vindue fyldes med U9.
- En Swiss-runde, der er i gang (forrige runde ligger samme dag), får samme
  prioritet som spillere, der allerede har spillet, så runderne følger tæt.
  Alle 19 spillere skal være fri i rundens slot (TP sætter én tid), så U9-
  drengenes doubler lægges mellem runderne; 6 runder + doubler kræver mere
  end 10 slots — planneren melder de overskydende som "ikke placeret".
