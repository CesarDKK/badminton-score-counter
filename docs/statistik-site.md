# statistik.badmintonapp.dk — klubstatistik

Selvstændigt site der viser hvilke spillere der har spillet for hvilke hold i en
klubs holdturneringssæson, og hvor mange kampe det er blevet til. Data kommer fra
badmintonplayer.dk.

## Hvorfor det er et separat site

Indsamlingen af en klubsæson tager minutter og laver flere hundrede kald ud af
huset. Det skal aldrig kunne påvirke pointtællingen, der kører live i en hal.
Derfor har statistikken sin egen container (`stats-backend`), sit eget domæne og
sin egen cache — ingen fælles database, ingen fælles proces.

```
statistik.badmintonapp.dk
   │  nginx (badminton-frontend)          /usr/share/nginx/statistik
   └─ /api/*  →  stats-backend:3002       stats/backend
                     │
                     └─ badmintonplayer.dk (GetLeagueStanding)
```

## Hvordan data hentes

badmintonplayer.dk's holdturneringsside kalder selv et ASMX-endpoint,
`WebService1.asmx/GetLeagueStanding`, hver gang man klikker i menuerne. Vi kalder
præcis samme endpoint med samme parametre. Der er ingen login, ingen token og
ingen captcha på webservicen — bot-beskyttelsen på siden sidder på HTML-skallen,
ikke på API'et.

`subPage` styrer hvad man får:

| subPage | Giver | Kald pr. klub |
|---|---|---|
| 6 | Klubbens rækker i sæsonen | 1 |
| 2 | Puljestilling → holdenes `leagueGroupTeamID` | ~40 |
| 3 | Holdets kampprogram → kampnumre | ~40 |
| 5 | Holdseddel → spillerne, pr. disciplin | ~220 |

For Lyngby 2025/2026 er det ca. 300 kald i alt, ~5 minutter, og det giver 188
spillere fordelt på 37 hold.

## Hensyn til badmintonplayer.dk

* **Ét job ad gangen.** Alle forespørgsler stilles i kø, så der aldrig kører to
  indsamlinger samtidig — uanset hvor mange der bruger siden.
* **700–1100 ms mellem hvert kald** (`BP_MIN_DELAY_MS` / `BP_JITTER_MS`).
* **Døgncache.** Rådata gemmes i volumet `stats_cache`. Er de blevet gamle, vises
  de alligevel med det samme, og en ny indsamling starter i baggrunden.
* **Maks. 5 nye klubber pr. IP i timen** (`START_MAKS`).
* Vi henter ikke holdledernes mail og telefonnummer, selvom de står på
  kampsiderne. De hører ikke til statistikken.

## Klik ned i data

Alt hænger sammen, så man kan følge en tråd hele vejen igennem:

| Klik på | Sker der |
|---|---|
| En søjle i "Flest kampe" | Spilleren åbnes i spillertabellen |
| En årgang i "Kampe pr. årgang" | Begge tabeller filtreres til den årgang |
| En søjle i "Spillere pr. antal hold" | Kun de spillere vises |
| En række i spillertabellen | Fordelingen på hold foldes ud |
| En holdchip under en spiller | Der hoppes til holdet, som foldes ud |
| Et hold i holdtabellen | Spillerne og holdets kampe foldes ud |
| En kamp under et hold | Opstillingen vises, disciplin for disciplin |
| **Et spillernavn — hvor som helst** | Profilen på badmintonplayer.dk åbnes i en ny fane |

Spillernavne er altid links (`.../DBF/Spiller/VisSpiller/#<spiller-id>`), markeret
med en ↗. Det gælder både tabellen, chips under et hold, opstillingen i en kamp
og navnene i topgrafen. Resten af feltet folder ud som før — i topgrafen er
navnet og søjlen adskilt, så navnet fører til profilen og søjlen åbner spilleren
i tabellen.

Filtre sat fra en graf vises i en bjælke øverst og kan ryddes derfra. Klikker man
sig hen til noget der er filtreret væk, rydder filteret sig selv — ellers ville
man klikke i blinde.

Kampene med opstilling ligger på `/api/matches` og hentes først når nogen folder
et hold ud. De fylder 84 KB rå (14 KB gzippet) mod forsidens 35 KB, så de skal
ikke slæbes med fra start. Spillernavne sendes ikke med — klienten har dem
allerede fra `/api/stats` og slår op på spiller-id.

## Tælleregler

**Sejre tælles pr. disciplin**, ikke pr. holdkamp. Vinderen udledes af sætcifrene
på holdsedlen, som altid står set fra hjemmeholdet. Er kolonnen "Vinder W.O."
udfyldt, vejer den tungest — også når der er sætcifre, for en spiller kan nå at
tabe et par sæt og så udgå. Discipliner uden nogen af delene indgår ikke i
sejrsprocenten.

Kontrolleret mod kilden: for 204 af 216 holdkampe rammer vores optælling af
vundne discipliner præcis det officielle holdresultat. De 12 resterende er
egenskaber ved kilden, ikke ved parsningen:

* **8 ungdomskampe** hvor holdkampens samlede pointtal er én højere end antallet
  af discipliner på holdsedlen (fx 6 discipliner, men 4-3). Rækken giver et point
  ud over disciplinerne.
* **4 kampe vundet på walkover i deres helhed** (13-0, 8-0, 8-0, 6-0), hvor ingen
  disciplin har noget resultat. De tæller ikke som sejre for de enkelte spillere —
  der blev ikke spillet.

**Disciplintyper** aflæses af koden efter nummeret: `S`, `HS`, `DS` er single,
`D`, `HD`, `DD` er double, og `MD` er mix. Mix holdes adskilt fra double, fordi
det er to forskellige discipliner. `S` og `D` uden køn bruges i ungdomsrækker.



En **kamp** er en holdkamp. En spiller tælles én gang pr. holdkamp, også hvis
vedkommende spillede både single og double i den — det er sådan man taler om det
i klubben.

Holdnavn alene er tvetydigt: "Lyngby 1" findes både i SEN+40, SEN+50 og SEN+60.
Alt nøgles derfor på **årgang + holdnavn**. Uden det ville de tre smelte sammen
til ét hold med 39 spillere.

Spiller-id fra badmintonplayer bruges som nøgle, ikke navnet — kilden blander
versaler og normal skrivemåde (`JAKOB ZHAO` vs. `Jakob Zhao`), og to spillere kan
hedde det samme.

## Filer

```
stats/backend/badmintonplayer.js   klient mod GetLeagueStanding (throttle + contextkey)
stats/backend/parse.js             HTML → strukturerede data
stats/backend/harvest.js           de fire trin, med fremdriftsrapportering
stats/backend/aggregate.js         rådata → det siden viser
stats/backend/cache.js             diskcache med TTL
stats/backend/server.js            API, jobkø og CSV-eksport
stats/frontend/                    siden (ingen biblioteker — graferne er SVG)
Dockerfile.stats                   backend-image
```

## Drift

```bash
docker compose build stats-backend frontend && docker compose up -d stats-backend frontend
```

Røgtest af parsningen mod den rigtige API (rammer nettet, tager få sekunder):

```bash
docker compose run --rm stats-backend node tests/smoke.js Lyngby 2025
```

Lokalt kan sitet nås på `http://statistik.localhost:8080` — nginx lytter på det
navn ved siden af det rigtige domæne, og Chrome slår alle `*.localhost` op som
127.0.0.1 uden hosts-fil.

### Hvis parsningen holder op med at virke

Markup'en fra badmintonplayer er maskingenereret og ret stabil, men skifter den,
fejler røgtesten med det samme og fortæller hvilket trin der knækkede.
`callbackcontextkey` hentes automatisk igen ved en 500-fejl, så den kræver ikke
indgriben.

## Kendte begrænsninger

* Kampe uden indtastet holdseddel tælles med under "kampe fundet", men bidrager
  ikke med spillere. Forskellen vises på siden.
* Sæsonen 2026/2027 er tom indtil turneringen går i gang; siden vælger derfor den
  foregående sæson som standard.
* Klubber med meget almindelige navne kan give flere træf — brugeren vælger selv.
