# planner.badmintonapp.dk

Tidsplanlægger til individuelle badmintonturneringer. Designet står i
[docs/planner-design.md](../docs/planner-design.md); dette er den praktiske
vejledning til koden. Hvordan de enkelte funktioner er blevet til — og hvorfor — står i
[docs/planner-aendringslog.md](../docs/planner-aendringslog.md), og den seneste gennemgang af hele
løsningen i [docs/planner-gennemgang-2026-09.md](../docs/planner-gennemgang-2026-09.md).

`.TP`-filen (Tournament Planner, en Access-database) læses i browseren med `mdb-reader`, og projektet
gemmes i `localStorage` og som JSON-fil. Persondata forlader aldrig brugerens maskine. Den eneste
server er løseren bag "Optimér" (`solver/`, CP-SAT): den får et anonymiseret regnestykke — kamp-id'er,
løbenumre for spillere og tider — og intet andet.

## Mapper

| Sti | Indhold |
|---|---|
| `index.html`, `planner.css` | Siden med de fire faner (`?v=N` hæves ved hver udgivelse) |
| `src/app.js` | Indgang: tilstand, faner, filåbning, import-valg, handlinger. Eneste fil med DOM-tilstand |
| `src/tp-reader.js` | `.TP`-tabeller → projektmodel |
| `src/regler.js` | Reglementets tal som data: pauser, tidsvinduer, grænser — og projektets egne ændringer ovenpå |
| `src/regelmodel.js` | DE fælles byggesten for reglerne (`lavRegelmodel`): varighed, pause, vinduer, max dage, E-/senior-regler. Bruges af Tjek, planlægger og løser, så de tre altid er enige |
| `src/store.js` | Projektfilen: nyt projekt, genindlæsning, ændringer, opgradering af gemte projekter (`OPGRADERINGER`), validering, persistens, `genberegnKampe` og kapacitet til formvalget |
| `src/form.js` | Turneringsform pr. kategori: pulje, pulje + cup, dobbelt pulje, Swiss Ladder; minimumskrav (`minKampeKrav`), sikre kampe |
| `src/kapacitet.js` | DEN ene kapacitetsberegning: `pladsPaaDag`, `fordelRaekkerPaaDage`, `banebrugISlot` (reserverede baner med overløb), `FYLDNINGSGRAD` |
| `src/rules.js` | `tjekPlan(projekt)` → fejl og advarsler pr. kamp og slot |
| `src/scheduler.js` | Den grådige planlægger: `lavForslag`, alternativer, `bedoemPlan` |
| `src/kriterier.js` | De bløde kriterier med vægte og `scorePlan` |
| `src/nedskaering.js` | Forslag, der får kabalen til at gå op (færre runder, to dage), og kapacitetsregnskabet |
| `src/solver-klient.js` | `bygProblem` (projekt → anonymiseret regnestykke), `optimer` (start, kø, status, stop), `diagnoseTekst` |
| `src/ui/` | De fire faner: `opsaetning.js`, `plan.js`, `tjek.js`, `liste.js` — rene tegnefunktioner, ingen tilstand |
| `solver/` | CP-SAT-tjenesten (`solver.py`), dens tests og kontrakt-testens Python-del |
| `tp-bundle.js` | Bygget bundle af `mdb-reader` + Buffer-polyfill (**committes**) |
| `build/` | esbuild-script til `tp-bundle.js` |
| `tests/unit/` | Node `--test`-tests · `tests/hjaelp/model.js` er den syntetiske TP-model · `tests/kontrakt/` er kontrakt-testen JS ↔ Python |
| `testdata/` | Lokale `.TP`-testfiler — gitignored, aldrig i repoet (de indeholder persondata) |

## Kommandoer

Node findes ikke på udviklings-pc'en; alt kører via Docker fra mappen `planner/`. **CI kører Node 18**, så
test på den (og gerne også Node 20):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:18-alpine sh -c "npm install --no-audit --no-fund && npm run test:unit"
```

Løserens tests (kræver et image med OR-Tools: `docker build -f ../Dockerfile.solver -t planner-solver-test ..`):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app/solver --entrypoint python planner-solver-test -m unittest test_solver
```

Kontrakt-testen — JS bygger syv syntetiske problemer, Python løser dem, og JS kræver 0 fejl i Tjek:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:18-alpine node tests/kontrakt/kontrakt.mjs byg tests/kontrakt/_ud
MSYS_NO_PATHCONV=1 docker run --rm --user 0 -v "$PWD:/app" -w /app/solver --entrypoint python planner-solver-test kontrakt.py ../tests/kontrakt/_ud
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:18-alpine node tests/kontrakt/kontrakt.mjs tjek tests/kontrakt/_ud
```

Byg `tp-bundle.js` igen, når `mdb-reader` opdateres (bundlet committes):

```bash
MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD:/app" -w /app node:20-alpine sh -c "npm install --no-audit --no-fund && npm run build"
```

Tests mod de rigtige Lyngby-filer kører kun, hvis filerne ligger i `planner/testdata/` (eller mappen i
`PLANNER_TESTDATA`); ellers springes de over. CI (`.github/workflows/tests.yml`) kører de syntetiske tests,
løserens tests, kontrakt-testen og `nginx -t` ved hvert push.

## Lokal test i browseren

Sitet serveres af `badminton-frontend` (nginx) med `server_name planner.localhost`. Hurtig test uden rebuild —
tag en kopi først, så containeren kan bringes tilbage:

```bash
docker exec badminton-frontend sh -c "cp -r /usr/share/nginx/planner /tmp/planner-bak && cp /etc/nginx/conf.d/default.conf /tmp/default.conf.bak"
docker cp planner/src/. badminton-frontend:/usr/share/nginx/planner/src/
docker cp planner/index.html badminton-frontend:/usr/share/nginx/planner/index.html
```

Åbn derefter <http://planner.localhost/>. Skal "Optimér" med, startes løseren på samme netværk med aliaset
`planner-solver`, og `nginx.conf` samt `nginx-planner-csp.conf` (→ `/etc/nginx/snippets/planner-csp.conf`)
kopieres ind, efterfulgt af `nginx -s reload`. Permanent deploy: `docker compose build frontend planner-solver`.

## Drift: løseren og nginx

- **Én løser-plads** (`SOLVER_SAMTIDIGE`), højst 360 s pr. kørsel, 1,5 CPU med lav prioritet, så tælleren aldrig sultes.
  Er løseren optaget, svarer den 429 med `optaget` og `ledigOmSekunder`, og klienten venter selv i kø.
- **Kvote:** 40 minutters regnetid pr. klient pr. time (`PLANNER_SOLVER_KVOTE_SEKUNDER`, 0 = ingen). Svar: 429 med `kvote`.
- **Rate-grænser i nginx** nøgler på `CF-Connecting-IP` (bag Cloudflare er forbindelsens adresse Cloudflares), med et
  højt loft pr. forbindelses-adresse oveni. Grænsen svarer 429 med `{"graense": true}` og `Retry-After`.
- **Origin-tjek:** `/api/solve` og `/api/solve/stop` afviser kald fra andre websteder (403).
- **Lange kørsler** går som job: start (202) → status hvert 3. sekund → svar. Cloudflare afbryder kald over ca. 100 s.
  Et job, der ikke er spurgt til i 30 s, stoppes (fanen er lukket).
- **CSP** (`nginx-planner-csp.conf`): alt hentes fra samme origin; ingen inline-scripts og ingen `eval`.
- **Gemte projekter** opgraderes i nummererede trin (`store.js: OPGRADERINGER`, `PROJEKT_VERSION`). Et projekt fra en
  nyere udgave afvises med en besked og bliver liggende i browseren.

## Modellen i korte træk

- Kamp-id er `d<draw>:<planning>` (TP's egne nøgler), Swiss-pladsholdere `d<draw>:r<runde>:<nr>`; kampe, planneren
  selv bygger, hedder `g:<kategori>:…`. Id'erne følger POSITIONEN i lodtrækningen — tider og låse følger derfor
  kampens signatur (`store.kampSignatur`, `overfoerPlan`), ikke id'et.
- Puljekampe har `spillere` (kendte); cupkampe har `muligeSpillere` (alle fra de puljer, `Link`-tabellen peger på)
  og `afhaengerAf` (kampene der skal være spillet først). Bye-kampe i cupper udelades.
- Datoer fra `mdb-reader` er UTC-`Date` med vægurets tid; læs altid med `getUTC*`.
- Reglementet går forud for antagelser: slå reglen op (badminton.dk/individuelle-turneringer) før den kodes, og lad
  den stå ét sted (`regler.js` for tal, `regelmodel.js` for logik).
