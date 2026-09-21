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

## Reserverede baner pr. række (U9-vinduet)

En række kan få `reserveredeBaner` (fane 1, ved siden af tidsrummet). I rækkens
tidsrum bruger den kun de baner, og alle andre rækker deler resten — fx U9 med
5 af 10 baner kl. 12–16:30, delt i 10 halve, mens U11 spiller på de 5 andre.
Standard fra TP-filen: det tidsrum, hvor TP's gitter har flere baner end
normalt, og antallet af ekstra baner (Lyngby 2025: 12:00–17:00, 5 baner).
Kapacitetstjekket, gitterets "brugt/baner" og planlæggeren regner pr. pulje
(reserveret pr. række + fælles). Sådan bliver U9-kampene liggende lige efter
hinanden i deres vindue i stedet for at blive spredt mellem U11-kampene:
målt på Lyngby 2025 falder U9-spillernes største hul fra op til 3½ time til
gennemsnitligt 16 minutter, og Swiss-runderne ligger hver time.

## Alternative forslag

"Alternativer" i Plan-fanen laver op til 8 forslag med forskellige
prioriteringer (`ALTERNATIV_VARIANTER` i `scheduler.js`): kortest haltid,
rækkens rækkefølge, lange kæder først, puljer samlet, og fire varianter med
en fast "tilfældig" nøgle (seed) blandt ligestillede kampe. Dubletter fjernes,
og listen sorteres bedst først (færrest uden plads, kortest haltid, tidligst
slut). Bjælken viser nøgletal pr. forslag; ◀ ▶ skifter planen i gitteret med
det samme, "Brug dette" beholder den, "Fortryd" går tilbage til planen før.
Låste kampe beholdes i alle forslag. Samme input giver samme alternativer.

## Fra Jespers gamle AI-prompt (v22)

Gennemgået 2026-09-08. Tilføjet som valg:

- **Undgå single og double samtidig i samme række** (regel A3: HS/HD, DS/DD,
  MD mod alle; U9's "D" regnes som begge doubler). Til som standard. Tjek giver
  en kvitterbar advarsel pr. række og dag, og forslaget undgår det (koster lidt
  haltid: Lyngby 2025 gik fra 139 til 149 min i gennemsnit).
- **Puljerunder synkront på tværs af puljer** (blødt mål: alle R1 før R2 …).
  Fra som standard; findes også som variant under "Alternativer".
- **Prioritet pr. kategori** (høj/normal/lav) i fane 1: kategorier med høj
  prioritet får plads først i forslaget.
- **Løsningsforslag**: når forslaget efterlader kampe uden plads, viser Plan-
  og Tjek-fanen konkrete forslag pr. årsag (forlæng dagen til kl. X, tilføj N
  baner, udvid rækkens tidsrum til kl. Y, giv flere reserverede baner …).
  Sidste forslags "ikke placeret" gemmes i projektet (`sidsteForslag`).

Bevidst udeladt: A0/A1 (hele eventets puljer/runder som barriere — vi bruger
kampenes faktiske afhængigheder), fail-fast (vi leverer altid en plan), X-makker
og "videre fra pulje" (ligger i TP), Excel-faner.

## Alle kampe placeres altid (fase 2 i planlæggeren)

Jespers krav 2026-09-08: et forslag må aldrig efterlade kampe uden tid. Efter
den grådige placering placeres resten med gradvist lempede regler, mindst
alvorlige først: anti-samtidighed → rækkens eget tidsrum → reserverede baner
→ pause → årgangens tidsvindue → max kampe pr. dag → rækkens dage → kapacitet
→ rækkefølge → dobbeltbooking. Hvert brud registreres (`forslag.brud` med
`brud`, `aarsag` og `detalje`), vises i Plan-fanen, gemmes som
`projekt.sidsteForslag` og giver konkrete løsningsforslag på Plan og Tjek:
"Sæt pausen for A–D til 5 min", "Udvid tidsrummet til 18:00", "Forlæng dagen
til 17:30", "tilføj 1 bane" osv. Tjek viser samtidig bruddene som fejl eller
advarsler efter de almindelige regler. Alternativerne sorteres efter færrest
brud, dernæst haltid.

## Swiss Ladder: runder lige efter hinanden

Pr. Swiss Ladder-kategori (fane 1, flueben "runder lige efter hinanden",
`kategorier[].swissUdenPause`): næste runde må begynde i slottet lige efter
forrige rundes sidste kamp uden pause imellem. Gælder både Tjek
(swiss-runde-reglen) og forslaget. Pausen mod spillernes kampe i andre
kategorier gælder stadig, og alle rundens spillere skal være fri i slottet.

## Turneringsform pr. kategori (form.js)

Ud for hver kategori i fane 1 vælges kilden til turneringsformen: **fra TP**
(filens lodtrækning, standard), **automatisk**, **Swiss Ladder**, **pulje +
cup** eller **pulje**. For alt andet end "fra TP" bygger planneren selv
kampene ud fra kategoriens tilmeldinger i filen (`projekt.tilmeldinger`):
puljer á 3–5 med slangeseedning efter ranglistepoint fra filen
(`RankingEntry`/`RankingCategory`), cup for puljevinderne (eller de to bedste,
valg pr. kategori) med standardseedning og byes, eller Swiss Ladder 4–6 runder
med runde 1 parret efter seedning. "Automatisk" vælger den form, der opfylder
reglementets minimum kampe pr. spiller med færrest bane-slots (eller "flest
kampe" op til 6, valg under "Opskrift til lodtrækningen i TP"); kan intet
opfylde minimum, vælges den form, der giver flest kampe til de færreste, og
det markeres. TP's egne kampe gemmes i `projekt.tpKampe`, så "fra TP" kan
vælges igen. Panelet "Opskrift til lodtrækningen i TP" viser, hvordan
lodtrækningen skal laves. Åbnes en nyere fil, hvor TP nu har en lodtrækning
for kategorien, sættes den automatisk tilbage til "fra TP".

## Ventetid pr. spiller (2026-09-08)

- "Undgå single og double samtidig i samme række" er **fra** som standard.
  Målt på Lyngby 2025 gav den rene double-spillere huller på op til 2½ time,
  fordi doublen ikke måtte spille, mens singlen kørte. Planneren tjekker
  alligevel de faktiske spillersammenfald kamp for kamp.
- **Dobbeltbooking er altid en fejl**, også for mulige spillere i cupkampe:
  samme spiller kan nå finalen i to kategorier, så to cupkampe med fælles
  mulige spillere må ikke ligge i samme slot. Forslaget overholder det altid;
  kun fase 2's allersidste udvej ("dobbeltbooket") kan bryde det, og det
  meldes som regelbrud.
- **Advarsel "lang ventetid"** (kvitterbar), når en spiller venter over
  `opsaetning.maxVentetidMin` (standard 90 min, fane 1) mellem egne kampe.
  Antal spillerdage med sådan et hul står i Plan-fanens statuslinje og i
  alternativ-bjælken (`statistik.langeHuller`).

## Swiss Ladder: antal runder (2026-09-09)

Pr. Swiss-kategori kan antallet af runder vælges (2–8, `kategorier[].swissRunder`),
og så bruges det uanset krav og kapacitet. Med "automatisk" (0) vælges 4–6
runder efter reglementet, men i `genberegnKampe` regnes kategoriens kapacitet
ud (`kapacitetTilKategori`: rækkens reserverede baner i dens tidsrum, ellers de
fælles baner på dens dage, gange fyldningsgrad 0,85) minus de andre kategoriers
bane-slots i samme pulje (`delerKapacitet`). Rækker den ikke, skæres runderne
ned til det største antal, der passer, hvor spillerne stadig når kravet, når
deres kampe i andre kategorier (double, mix) tælles med
(`form.kravInklAndre`); ellers markeres forslaget som nedskåret og under kravet.

## Bløde kriterier med vægte, og hårde rækkeregler som data (2026-09-18)

Efter input fra udvikleren af Badminton Planner: bløde ønsker er små isolerede
kriterier med vægte som data, hårde regler er constraints og aldrig store straffe.

- `src/kriterier.js`: `KRITERIER` (ventetid, lange huller, sen sluttid, tomme
  baner midt på dagen, puljerunder ude af takt, finaler spredt), navngivne
  `VAEGT_SKABELONER` og `scorePlan(projekt)` → vægtet sum, lavere er bedre.
  Vægtene ligger i `opsaetning.vaegte` og rettes i fane 1 ("Bløde ønsker og
  vægte"). Scoren vises i Plan-fanen (hover viser bidragene), rangerer
  alternativerne efter antal regelbrud, og er målet for løseren.
  Et nyt ønske = ét nyt kriterie + en vægt; ingen ændring i planlæggeren.
- Hårde regler pr. række som data: `raekker[].maxHaltidMin` (U9: 240 min fra en
  spillers første til sidste kamp samme dag) og `raekker[].maxDage`
  (reglementets én-dags-rækker: 1). Begge rettes i fane 1, overholdes af
  forslaget, og brud meldes som fejl (`max-haltid`) hhv. advarsel med
  dispensation (`flere-dage`). Kan de ikke overholdes, placeres kampen
  alligevel i fase 2 med regelbruddet `max-haltid`.
- Fund på Lyngby U9/U11 2025: Jespers egen plan scorer 457,6 mod forslagets
  133. Med U9's 240 min er 6 Swiss-runder plus doubler ikke muligt — 8 spillere
  i Jespers plan og 6 i forslaget er over 4 timer; med 360 min går det op.

## Minimum antal kampe tælles samlet i U9 (2026-09-18)

I U9 tæller en spillers single- og double/mix-kampe tilsammen mod minimumskravet.
`raekker[].minKampeSamlet` (standard: til for U09, fra ellers; afkrydsning i fane 1).

- `form.js`: `minKampeSamlet(raekke)`, `sikreKampe(kategori, kampe)` (Swiss = runder,
  ellers kampe med kendte spillere) og `effektivForm(kategori)` (plannerens egen form,
  når kategorien ikke følger TP).
- Tjek (`min-kampe`): i samlede rækker lægges spillerens sikre kampe i andre kategorier
  til, og advarslen nævner kun dem, der stadig er under kravet.
- Valg af form: singlerne må vælge en mindre form, når egne + sikre double/mix-kampe når
  kravet — den spiller, der har færrest andre kampe, bestemmer. Double/mix afgøres først
  og for sig, singlerne bagefter, så de ikke skærer ned på hinanden. Nedskæring af
  Swiss-runder ved for lidt plads tæller kun andre kampe med i samlede rækker.
- Rettet fejl: Tjek brugte TP's form, også når planneren selv havde valgt Swiss Ladder,
  og advarede derfor falsk om "kun sikret 1 kamp".
- Lyngby U9 2025: 22 spillere, 8 spiller både single og double, 14 kun single — for
  dem skal singlerne alene give 4 kampe, så drengesinglen ændres ikke af reglen.

## Løseren: "Optimér" med CP-SAT (2026-09-18)

Den grådige planlægger er hurtig, men lægger én kamp ad gangen og kan ikke
fortryde. "Optimér" i Plan-fanen sender i stedet hele problemet til en løser
(Google OR-Tools CP-SAT), der overholder alle hårde regler og minimerer den
samme score som `scorePlan`.

- `src/solver-klient.js`: `bygProblem(projekt, hintPlan)` oversætter projektet
  til tal: global tid `T = dagIndex * 1440 + minut`, tilladte starttider pr.
  kamp (dage, tidsvindue, rækkens tidsrum; låste kampe har kun deres egen tid),
  kapacitet pr. pulje og slot, `foer` (afhængigheder), `konflikter`
  (fælles mulig spiller → varighed + pause), `haltid`, `maxDage`,
  `maxKampePrDag` og vægtene. **Alt regelkendskab ligger i JS**; løseren kender
  kun tal og par. Der sendes kamp-id'er og spillere som løbenumre — ingen
  navne, klubber, fødselsdatoer eller e-mails (testet).
- `solver/solver.py`: modellen (`AddCumulative` pr. kapacitetspulje, halve
  baner tæller 1 af 2) og en lille HTTP-tjeneste: `GET /health`,
  `POST /solve` → `{ status, tider, sekunder }`. Én løsning ad gangen (429
  ellers), højst 120 s, logger aldrig indhold. `solver/test_solver.py` køres i CI.
- Drift: tjenesten `planner-solver` i `docker-compose.yml` (`Dockerfile.solver`,
  1,5 CPU / 2 GB, ingen porte udadtil). Prod har kun 2 kerner, og Docker afviser
  et `cpus`-loft over værtens antal kerner. Loftet, antal arbejdere og samtidige
  løsninger styres af `PLANNER_SOLVER_CPUS` (1.5), `PLANNER_SOLVER_ARBEJDERE` (2)
  og `PLANNER_SOLVER_SAMTIDIGE` (1) i `.env`; `cpu_shares: 256` lader tælleren
  vinde, når der er kamp om kernerne. Målt: 1,5 kerne med 2 arbejdere er kun
  3–4 % dårligere end 4 kerner med 8 — men 4 arbejdere på 1,5 kerne er 15–30 %
  dårligere, så hold arbejdere ≈ antal kerner. nginx sender
  `planner.badmintonapp.dk/api/solve` videre med rate limit (6/min) og slår
  navnet op ved hvert kald, så siden virker, selv om løseren er nede.
- UI: vælg 10–120 s og tryk "Optimér". Den grådige plan er startløsning (hint).
  Resultatet vises som forslag ved siden af den grådige plan med score, og
  vælges med "Brug dette" / "Fortryd". Beviser løseren, at der ingen lovlig plan
  findes, vises den grådige plan med regelbrud og løsningsforslag. Er løseren
  nede eller optaget, siges det, og resten af siden virker som før.
- Målt (score, standardvægte, alle planer uden fejl i `tjekPlan`):
  U13/U15 2026 — Jesper 220,3 · grådig 144,6 · CP-SAT 10 s 88,4 · 60 s 63,8.
  U9/U11 2025 (U9 senest 18:00, max haltid 360) — Jesper 457,6 · grådig 133 ·
  CP-SAT 10 s 74,1 · 60 s 61,2.
- Lokal test: `docker build -f Dockerfile.solver -t badminton-planner-solver .`,
  kør den på compose-netværket med `--network-alias planner-solver`, og
  `docker cp nginx.conf badminton-frontend:/etc/nginx/conf.d/default.conf` +
  `nginx -s reload`. Python-tests: `python -m unittest test_solver.py` i imaget.

Målt i prod (2 kerner, loft 1,5; U9/U11 2025, alle planer uden fejl): 30 s → score
337, 60 s → 142, 120 s → 126 (lokalt med 4 kerner: 117 på 30 s). Standardtiden i
"Optimér" er derfor 60 s. Et samtidigt kald nr. 2 afvises med "Løseren er optaget".

### Lange kørsler og "Stop og brug det bedste" (2026-09-18)

- Tidsvalg i "Optimér": 10, 30, 60 s (standard), 2, 4 og 6 min. `SOLVER_MAX_SEKUNDER`
  er 360, og nginx venter 420 s på svaret.
- Klienten vælger et tilfældigt job-id (`nytJobId`) og sender det med. Knappen
  "Stop og brug det bedste" kalder `POST /api/solve/stop { job }` (`stopLoeser`);
  løseren afbryder søgningen (`stop_search`) og svarer i det oprindelige kald med den
  bedste plan indtil da (`stoppet: true`) — alle hårde regler er stadig overholdt.
- Lukker brugeren fanen, lukker nginx forbindelsen til løseren, som opdager det inden
  for et halvt sekund og stopper, så den ikke er optaget i flere minutter.
- Et ur i knappen viser, hvor længe løseren har regnet (opdateres uden at tegne gitteret om).

## "Et hav af alarmer": årsager og forslag, der får kabalen til at gå op (2026-09-18)

Jespers forsøg med alle U9/U11-kategorier som Swiss Ladder gav 611 kampe og 301 regelbrud.
Tre årsager, fundet ved måling på Lyngby U9/U11 2025:

1. **Fejl i formvalget:** når pladsen ikke rakte til noget, valgte den automatiske Swiss-logik
   formen med FLEST kampe (8 runder), og det forplantede sig kategori for kategori. Nu vælges
   den mindste form, der opfylder kravet, markeret `passerIkke` ("der er ikke plads nok").
   Planneren går aldrig selv under kravet — det er brugerens valg (se nedenfor). 611 → 377 kampe.
2. **Alle én-dags-rækker endte på første dag:** `maxDage` er en hård regel, og den grådige
   placering bandt rækken til den dag, dens første kamp landede på. `lavForslag` fordeler nu
   rækkerne på dagene FØR placeringen (`raekkeDagValg`): størst først, til den første dag hvor
   rækken kan være under 85 % fyldning (inden for årgangens tidsvindue), ellers dagen med mest
   plads. Låste kampe bestemmer dagen. TP's egen lodtrækning: 87 → 33 regelbrud uden dagvalg,
   og 0 med Jespers dage (U9 + U11 D lørdag, U11 B + C søndag) og U9 max haltid 360.
3. **Reelt for lidt plads:** med alt som Swiss kræver kampene 323 bane-slots på de fælles baner
   mod højst 300 lovlige (ca. 85 % kan bruges).

`src/nedskaering.js` — forslag på oplyst grundlag, afprøvet med den rigtige planlægger:

- `alleNedskaeringer(projekt)` prøver tre strategier: **Jævnt fordelt** (flest runder mister én
  ad gangen), **Skån singlerne** (double/mix først, ned til 2 runder) og **To dage i stedet for
  færre kampe** (dispensation til de ramte rækker; skærer kun, hvis det ikke er nok). Hvert trin
  bygger kampene og kører `lavForslag`; et forslag er først "løst" ved 0 regelbrud. Bagefter
  gives runder tilbage, hvor der alligevel er plads. Ca. 2–3 s for 377 kampe.
- Hvert forslag viser kampe før → efter, regelbrud før → efter, og pr. kategori: runder, kampe,
  sikrede kampe pr. spiller, krav og antal spillere under kravet (`underKrav`, samme tælling
  som Tjek inkl. "min. kampe tælles samlet").
- `kapacitetsRegnskab(projekt)`: behov og lovlig plads i bane-slots på de fælles baner, og pr.
  række med reserverede baner hvor meget der står ubrugt (Lyngby: U9 reserverede 100, brugte 31).
- `anvendNedskaering`: rundetallene sættes som `swissRunder` på kategorierne (synlige og
  rettelige i fane 1), kampene bygges igen, og planen lægges. Spillere under minimum står
  bagefter som advarsler i Tjek, der kan kvitteres.
- UI: knappen "Find forslag, der får kabalen til at gå op" i Plan-fanen, når et forslag har
  regelbrud. Kampe fra TP's lodtrækning kan planneren ikke skære i — det siges tydeligt.
- Med Jespers dage: "Skån singlerne" 377 → 339 kampe (37 spillere under minimum),
  "Jævnt fordelt" 377 → 329 (73 under). Begge 0 regelbrud og 0 fejl i Tjek.

### Asynkrone job: lange kørsler bag Cloudflare (2026-09-18)

Målt i prod: et kald, der varer over ca. 100–125 s, afbrydes af Cloudflare (fejl 524), så de
lange tidsvalg virkede ikke med ét langt kald. Nu:

- `POST /api/solve { problem, sekunder, job, asynkron: true }` svarer straks `202 { status: 'REGNER', job }`.
- `GET /api/solve/status?job=…` hvert 3. sekund: `{ status: 'REGNER', sekunder }`, og til sidst
  det færdige svar (gemmes i 10 min). Egen rate limit-zone (`planner_status`, 60/min).
- `POST /api/solve/stop { job }` som før. Lukkes siden, sender den selv et stop (`sendBeacon`);
  og hører løseren ikke fra klienten i 30 s (`SOLVER_FORLADT_SEKUNDER`), stopper den af sig selv.
- Forbigående fejl i statuskald (502/429, netværk) tåles op til 5 gange i træk. Kender løseren
  ikke jobbet (genstartet), får brugeren en klar besked.
- Det synkrone kald (uden `asynkron`) findes stadig til korte kørsler, tests og ældre klienter.

### Minimum tælles samlet for alle årgange, og "Skær kun i double og mix" (2026-09-18)

Jesper: minimum antal kampe tæller på tværs af single, double og mix uanset årgang, og næsten
alle doublespillere stiller også op i single (Lyngby U9/U11 2025: 85 af 87).

- `minKampeSamlet(raekke)` er nu `true` som standard for alle rækker (før kun U9). Gemte
  projekter opgraderes én gang (`opsaetning.minKampeSamletV2`); derefter er fravalg pr. række
  brugerens eget.
- Ny strategi **Skær kun i double og mix**: singlerne røres ikke, double/mix må ned til 1 runde.
  **Skån singlerne** bruger samme gulv, før den rører singlerne. Ved ulige antal par er gulvet
  2 runder (med 1 runde ville oversidderen få 0 kampe). Swiss Ladder kan nu vælges med 1 runde.
- Tabellen i forslaget viser også kategorier med uændrede runder, når flere af deres spillere
  kommer under minimum, fordi deres kampe i andre kategorier er skåret.
- Målt (Jespers dage, ingen reservation, alt som Swiss; 373 kampe, 32 regelbrud):
  Skån singlerne 373 → 312 kampe, 33 under minimum · Jævnt 373 → 298, 37 under ·
  Kun double/mix 373 → 328, 4 under, men 24 regelbrud tilbage (ikke nok alene her).
  Med samlet tælling faldt "Jævnt" fra 73 til 37 spillere under minimum.

### Diagnose, når løseren melder "ingen lovlig plan" (2026-09-18)

Jesper oplevede, at "Optimér" stoppede efter 3 s. Løseren havde bevist INFEASIBLE (typisk U9's
max haltid eller en række, der ikke kan være på én dag), men sagde ikke hvorfor.

- `solver.py: diagnose(problem)` lemper én hård regel ad gangen (stop ved første løsning, højst
  8 s pr. forsøg, 45 s i alt): max haltid pr. række (prøver +60/+120/+180 min og foreslår den
  mindste, der virker), max dage pr. række, max kampe pr. dag. Hjælper ingen enkelt regel,
  prøves alle på én gang: `flere` (kun i kombination) eller `plads` (for mange kampe til baner
  og tidsvinduer). Resultatet følger med svaret som `diagnose: [...]`; status viser `fase: 'diagnose'`.
- `bygProblem` sender rækkens id med på hver haltid-gruppe, så diagnosen kan pege på rækken.
- `diagnoseTekst()` oversætter til klart sprog og til handlinger. I Plan-fanen vises årsagen,
  og knapper som "Sæt U09 D til max 300 min i hallen, og optimér igen" retter rækken og kører igen.
- Målt på Lyngby U9/U11: filen som den er → "U09 D kan ikke være på én dag" (8 s); Jespers dage
  uden reservation → "max haltid 240: med 300 min findes der en plan" (2 s); alt som Swiss →
  "ikke plads" (5 s), som henviser til nedskæringsforslagene.

### Dobbelt pulje som form (2026-09-18)

`formValg: 'dobbelt-pulje'` — alle møder alle to gange (TP's drawtype 4). `formMuligheder` giver
en dobbelt udgave af hver puljefordeling (dobbelt så mange kampe, minKampe × 2), og `byggKampe`
lægger anden omgang som rundeplanen én gang til efter første omgang (`#b – #a (2. møde)`).
"Automatisk" bruger den kun til små felter (én pulje), hvor intet andet når minimum — fx 3–4
U9-spillere med krav om 4 kampe. Tæller doublerne med (samlet tælling), vælges den billigere
enkelte pulje i stedet. Valgt direkte gælder den for alle feltstørrelser.

## Gennemgang 2026-09-20 og pakke 1

Hele planneren er gennemlæst (regler fire steder, data/formvalg, brugerflade/drift). Listen med
fund og status står i `docs/planner-gennemgang-2026-09.md`. Pakke 1 er rettet: Tjek fanger Swiss-runder
mod spillernes andre kampe; "Optimér" overskriver ikke ændringer lavet imens; genindlæsning beholder
tider og låse på uændrede kampe; stop går ikke tabt; gemmefejl vises, og defekte projektfiler afvises
med typekontrol; max haltid i løserens problem gælder pr. dag som i Tjek (`udloesere`).

## Pakke 2: ét fælles regelmodul (2026-09-20)

`src/regelmodel.js` er nu det ENE sted, reglernes byggesten står. `lavRegelmodel(projekt)` giver bl.a.
`varighedFor`, `pauseFor`, `mellemrum`, `kanDeleSpillere`, `aargangsVindue`/`raekkeVindue`/`iVindue`, `maxDageFor`,
`antiSamtidighed`, `kampForbud` (E-/senior-regler for dag og tid) og `seniorEM`. `rules.js`, `scheduler.js` og
`solver-klient.js` bruger dem alle — tilføj nye regler dér, ikke tre steder. `kapacitet.js: banebrugISlot` er på
samme måde den ene regel for banebrug (inkl. overløb fra reserverede baner).

Kontrakt-testen (`node tests/kontrakt/kontrakt.mjs byg|tjek`, `python solver/kontrakt.py`) kører i CI og kræver, at
løserens planer har 0 fejl i Tjek. Kør den lokalt efter enhver ændring af regler eller problemformat:

    node tests/kontrakt/kontrakt.mjs byg tests/kontrakt/_ud
    (i løser-imaget, fra planner/solver)  python kontrakt.py ../tests/kontrakt/_ud
    node tests/kontrakt/kontrakt.mjs tjek tests/kontrakt/_ud

Status og detaljer: `docs/planner-gennemgang-2026-09.md`.

## Krydstjek mod reglementet (2026-09-20)

Kilder (badminton.dk/individuelle-turneringer): Reglement for Individuelle Turneringer, Appendiks 1 (turneringsformer),
Appendiks 2 (sammenlægning) og "U9-U11 turneringer – Vejledning". Reglementet går forud for tidligere antagelser:

- Minimum antal kampe gælder PR. KATEGORI (ikke samlet for single + double). `minKampeSamlet` er et tilvalg, fra som standard.
- `raekker[].maxHaltidMin` = max varighed for afviklingen af rækkens SINGLEKAMPE pr. dag (U9 240, U11 360); doubler tæller ikke med.
- Rækkefølge: U9/U11 single → double → mix; U13+ mix → double → single.
- E-rækker: ingen kampe før kl. 10 (`regler.eTidligst`), sidste dag kun semi og finale, finaler 10–13.
- Senior E/M: max 3 kampe pr. kategori pr. dag; kvartfinaler ikke samme dag som semi- og finaler. Senior: max 10 kampe pr. dag.
- Senior A/B og Senior+ E/A: kun kvart-, semi- og finaler på finaledagen.
`tests/unit/reglement.test.js` låser standarderne til reglementets tal. Detaljer: `docs/planner-gennemgang-2026-09.md`.

## Pakke 3: én kapacitetsberegning, stabilt formvalg og tider, der følger kampen (2026-09-21)

- **Én kapacitetsberegning** (`src/kapacitet.js`): `pladsPaaDag` tæller de bane-slots, en række må bruge en dag
  (årgangens tidsvindue, rækkens tidsrum, egne eller fælles baner), `fordelRaekkerPaaDage` er planlæggerens
  dagfordeling, og `FYLDNINGSGRAD` (85 %) står ét sted. Det automatiske formvalg (`store.lavKapacitetsmodel`),
  planlæggeren og kapacitetsregnskabet bygger alle på dem — før havde de hver sin beregning.
- **Formvalget afhænger ikke af kategoriernes rækkefølge**: kandidaterne får først en forholdsmæssig andel af
  pladsen, derefter deles det, der er til overs, i lige store bidder. Dagene fordeles efter det, rækkerne mindst
  skal have, så kriteriet "flest kampe" ikke lader en stor række klemme en lille ud.
- **Tider og låse følger kampen** (`store.overfoerPlan`): kamp-id'erne følger positionen i lodtrækningen, så når
  kampene bygges om, føres tiden over efter kampens signatur (kategori, fase, runde, gruppe, spillere).
- **Ændret opsætning bygger kampene på ny**: dage, baner, tidsrum, regler, slotlængde og halv bane. Fane 1 fortæller,
  hvis en automatisk form skiftede.
- **Nedskæring**: "Brug dette" fastholder alle rundetal, som da forslaget blev afprøvet. Ulige Swiss-felter melder
  "op til N spillere" (oversidderne), når kun den ene kamp mangler.
- `src/regler.js`: reglementets tal (pauser, tidsvinduer, grænser) — skilt ud af store.js.
