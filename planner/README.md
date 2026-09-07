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
| `src/ui/opsaetning.js` | Fane 1: fil og opsætning |
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
