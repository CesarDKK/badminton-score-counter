# Planner — ændringslog og baggrund

Hvordan plannerens funktioner er blevet til, i den rækkefølge de kom — med begrundelserne. Den praktiske
vejledning til koden står i [planner/README.md](../planner/README.md). Flyttet hertil fra README 2026-09-21.

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

## Pakke 4: drift (2026-09-21)

- **Rate-grænser bag Cloudflare:** nginx nøglede på forbindelsens adresse, som bag Cloudflare er Cloudflares egen —
  alle brugere delte altså samme grænse. Nu nøgles der på `CF-Connecting-IP` (som backendens rateLimiter), med et
  højt loft pr. forbindelses-adresse oveni, fordi headeren kan forfalskes af den, der går uden om Cloudflare.
  Grænsen svarer 429 med JSON (`graense`) og `Retry-After` i stedet for 503 med en HTML-side.
- **Klienten** skelner de tre slags 429: løseren er optaget (venter selv i kø og starter, når den bliver fri; "Stop"
  opgiver ventetiden), kvoten er brugt (besked med, hvornår der er plads igen), og rate-grænsen (venter og prøver
  igen). Statuskald, der rammer rate-grænsen, sætter tempoet ned; forbigående fejl tåles i 25 s (før: 5 i træk).
- **Løseren** fører regnskab med forbrugt regnetid pr. klient (40 min pr. time, `SOLVER_KVOTE_SEKUNDER`) og
  fortæller i sit 429-svar, hvor længe det igangværende job højst regner endnu. nginx afviser kald med fremmed Origin.
- **CSP** for planneren (`nginx-planner-csp.conf`): alt fra samme origin, ingen inline-scripts, ingen `eval`.
- **Gemte projekter** opgraderes i nummererede trin (`OPGRADERINGER`, version 2) i stedet for løse flag i opsætningen.
  Et projekt fra en nyere udgave afvises med en klar besked og bliver liggende.
- **CI** kører `nginx -t`. Død kode fjernet (`antalKampe`, `cupRunder`, formens `ledigeBaneSlots`-felt), forældede
  "kun U9"-kommentarer rettet, og README er igen en vejledning — historikken ligger i denne fil.

## OR-Tools 9.11 → 9.15 og esbuild 0.28 (2026-09-23)

Målt på Lyngby-filerne med samme problem og tidsgrænse mod begge løsere (1,5 CPU, 2 tråde; lavere score er bedre):

| Fil | 60 s, 1. kørsel | 60 s, 2. kørsel | 120 s |
|---|---|---|---|
| U13/U15 (TP's lodtrækning) | 102,8 → 98,1 | 102,8 → 77,1 | 96,3 → 81,2 |
| U9/U11 (Jespers dage) | 93,1 → 98,8 | 93,1 → 78,7 | 76,8 → 74,4 |

9.15 vinder i 5 af 6 kørsler, og beviser "ingen lovlig plan" hurtigere (18 s mod 42 s). 9.11 gav samme svar i alle
kørsler; 9.15 varierer fra kørsel til kørsel, så to kørsler kan give forskellige planer. Kontrakt-testen og de 29
Python-tests består. esbuild 0.24 → 0.28 lukker det sidste audit-fund; `tp-bundle.js` er bygget igen og afprøvet i browseren.

## U9/U11: varighed for doublerne og hele rækken, og tid i hallen med Swiss (2026-10-12)

Jesper testede et program, hvor U9-spillere mødte kl. 9 og gik hjem efter en double kl. 15. Årsagen: alle U9-kategorier
spilles som Swiss, og fra runde 2 kendes spillerne først efter lodtrækningen. Ventetiden tæller kun kendte spillere, så
U9-spillernes tid i hallen var næsten usynlig for planlægger og løser, og doublerne blev spredt over eftermiddagen.

U9-U11-vejledningen (28-07-2026, gode råd): "max. 4 timer i single i U9 – og gerne lidt kortere tid i double … I U11
max. 6 timer i single og det halve i double". Jesper besluttede:

- **Doublerne**, hårdt: U9 240 min, U11 180 min (`maxDoubleMin`), målt som singlerne fra dagens første til sidste double.
- **Hele rækken**, hårdt: U9 300 min (`maxRaekkeMin`), single og double samlet. Det er Jespers eget valg; vejledningen
  har intet samlet tal.
- **Blødt kriterie `halTid`** ("Tid i hallen, U9/U11", vægt 0,5): spillertimer fra første til sidste kamp. I Swiss
  tæller alle i lodtrækningen med i hver runde, fordi de alle spiller hver runde.

Grænserne står ét sted (`VARIGHEDER` i `regelmodel.js`) og gælder i Tjek, planlæggeren, løseren (`haltid`-grupper med
`art`), diagnosen og beslutningskortene. Gemte projekter får standardværdierne i opgradering 2 → 3.

Doublegrænsen giver ikke forrang i planlæggeren, kun et tjek. Med forrang røg U11 C's doubler ud over tidsvinduet.

Målt på Lyngby U9/U11 med U9 uden TP's 12–17-vindue, Swiss med 4 runder i alle U9-kategorier og 20 min slots:

| | Før: planlægger / løser | Efter: planlægger / løser |
|---|---|---|
| U9: længste tid i hallen | 4,7 / 4,3 t | 3,7 / 5,0 t (grænsen) |
| U11 D: spillere over 5 t | 25 / 13 | 17 / 12 |

Løseren minimerer summen af tid i hallen. Derfor kan nogle få (her pigerne i DS og double) ramme grænsen på 5 timer,
mens drengene får kortere dage.

I Lyngby-filens egen lodtrækning har U9 D 12 kampe på en dag (6 Swiss-runder og 6 doubler). Det kan heller ikke være
inden for 5 timer, og benchmark-testen regner det som en fejl i lodtrækningen ligesom max kampe.

## Løseren: uafgjort giver planen med færrest brud (2026-10-12)

I Jespers prod-test (Lyngby U9/U11, alle kategorier som Swiss, U9 D og U11 D lørdag) nåede løseren hverken en lovlig
plan eller et bevis for, at der ingen findes, på 60 s (`UNKNOWN`). Den gav så intet: hverken plan eller planen med
færrest brud. Beskeden forsvandt også bag kampprogrammets kort.

Nu laver løseren planen med færrest regelbrud, også når svaret er uafgjort. Diagnosen springes over, fordi den kræver et
bevis. En dag, der er uafgjort, løses ikke igen som ét samlet problem på resten af tiden (det nåede heller ikke noget);
tiden går til planen med færrest brud. Panelet skriver, at løseren ikke nåede at afgøre det, og viser planen med færrest
brud, hvis den ikke er dårligere end programmet. En uafgjort kørsel uden plan står nu i panelet.

## Swiss Ladder i grupper (2026-10-12)

Jespers idé: en stor Swiss Ladder deles i grupper, der hver er sin egen lodtrækning. En spiller får stadig én kamp pr.
runde, så antallet af kampe er det samme. Men en gruppes næste runde kan lodtrækkes, så snart gruppens egne kampe er
færdige. Grupperne kan altså spilles hver for sig, og den enkelte spiller er kortere tid i hallen.

- **Opsætning:** "Swiss Ladder i grupper" vælges pr. kategori ved siden af antallet af runder (`swissGrupper`). Grupperne
  er blokke i seedningen, så gruppe A er de bedste. De er så lige store som muligt, og højst én gruppe har et ulige antal,
  fordi hver ulige gruppe giver en oversidder pr. runde. Hver gruppe skal kunne spille alle runderne mod nye modstandere.
- **TP:** Lodtrækningen laves som én Swiss Ladder pr. gruppe. Når filen kommer tilbage, læses hver lodtrækning som sin
  egen Swiss (det gjorde TP-læseren i forvejen). "Til TP" viser gruppernes runder hver for sig.
- **Kortene:** Når programmet ikke går op, foreslås en opdeling (prisen "grupper", før "færre runder"). Det gælder både
  for en stor Swiss fra TP-filen (så skal lodtrækningen laves om i TP) og for plannerens egen. Trinene prøves i rækkefølge:
  1. Rækkens egne Swiss med mindst 10 deltagere.
  2. Dertil dagens store Swiss med mindst 16.
  3. Samme kategorier med ca. 10 i hver gruppe.

  Afprøvningen tager andre kamplængder med, og når forslaget vælges, vælges kamplængden igen.

Målt på Lyngby U9/U11 med alle kategorier som Swiss, U9 D og U11 D lørdag og U11 B og C søndag (planlægger / løser 60 s):

| | Én stor Swiss | U09 D HS, U11 B HS og U11 D HS i 2 grupper |
|---|---|---|
| Fejl i Tjek | 16 / 13 (løseren nåede ikke en lovlig plan) | 0 / 0 |
| Dagene slutter | 18:35 og 19:00 | 15:40 og 15:20 (løseren 16:00) |
| U11 D: længst i hallen | 9,2 / 7,5 t | 6,7 / 6,3 t |
| U11 B: over 5 t i hallen | 18 / 35 spillere | 4 / 0 spillere |

## U9/U11: en middelvej i det anbefalede antal kampe — kun ved god plads (2026-10-12)

Jesper: målet er ikke flest mulige kampe, men en middelvej i U9-U11-vejledningens anbefaling "4 – 6 singlekampe og 2 – 5
doublekampe", og kun når der er god plads på dagen. Reglementet gælder, også for U11 (§ 4 stk. 5.1): max 12 kampe, når
hele turneringen afvikles på én dag, og 10 pr. dag over flere dage. Vejledningens "max 12 for U11" er den samme regel for
én-dags-turneringer, som U11 normalt spilles som. En første udgave gav U11 12 kampe også over flere dage; den blev rettet
før merge.

- **Til minimum først:** Kampene bygges til minimum som før, og "Lav kampprogram" vælger kamplængde ud fra det.
- **Derefter middelvejen:** Går programmet op med 0 brud, prøver planneren midten for de U9/U11-kategorier, hvor den selv
  vælger antallet (`maalKampeU9U11`: 5 single, 3 double). Den tager formen tættest på målet og aldrig over anbefalingen.
  Først prøves alle kategorier, derefter kun singlerne. Løftet beholdes kun, hvis programmet stadig går op med 0 brud.
- **Valget huskes:** Det gemmes på kategorien (`middelvej`), så en senere genberegning beholder det, så længe rækkens dage
  højst er fyldt 70 % (`GOD_PLADS`).
- **Undtagelser:** "Planlæg kun kampe uden tid", låste kampe og et valgt antal runder røres ikke.
- **Panelet** skriver, hvilke kategorier der fik flere kampe.
- **Løseren:** Spillere med en anden grænse end dagens fælles hedder nu `regel: "maxKampe"` (før "senior"), og diagnosen
  lemper dem sammen med max kampe pr. dag.
- **Planlæggeren** giver nu spillere, der kun spiller Swiss, deres egen rækkes grænse.

Målt på Lyngby med alt som Swiss: dagene er fyldte, så der kommer ingen middelvej (377 kampe, som før). Med store Swiss i
2 grupper går programmet op, og der kommer 6 kampe ekstra (383).

## Lang ventetid tæller Swiss-runderne med (2026-10-17)

Jesper fandt advarsler som "venter 260 min" for U11 D-spillere, der spillede Swiss-runde 1 kl. 9, runde 2–5 i løbet af
formiddagen og en double kl. 13:40. Swiss-runder efter runde 1 har ingen kendte spillere. Tjek så derfor kun runde 1 og
doublen, og meldte en ventetid, spilleren ikke havde.

- **Fælles funktion:** `spillerOphold` (regelmodel.js) giver hver spillers ophold pr. dag. Det er de kendte kampe plus
  hver Swiss-runde, spilleren er i lodtrækningen til, fra rundens første til dens sidste starttid.
- **Mest gunstige tilfælde:** Man ved ikke, hvornår i runden spilleren spiller. Ventetiden regnes derfor som næste
  opholds start minus forriges slut, så der kun advares om sikre ventetider.
- **Tjek og "Lange huller":** Tjek's "lang ventetid" og kriteriet "Lange huller" bruger den. Teksten nævner runden,
  fx "U11 D HS runde 4".
- **Løseren:** Den får "lange huller" (`huller`) kun for spillere uden ukendte Swiss-runder. Deres tid i hallen dækkes af
  ventetid- og halTid-grupperne, der tæller runderne med. Ældre klienter sender kun `traek`, som stadig virker.
- **Målt på Lyngby med alt som Swiss:** 73 advarsler om lang ventetid blev til 16, og scoren faldt fra 794,2 til 680,2,
  fordi falske huller ikke længere straffes.

Prod-testen samme dag viste, at Program-fanens statusfelter ("venter over 90 min", "tid i hallen, gns.") og planens
ventetid stadig talte uden Swiss-runderne. De kommer fra planlæggerens `bedoemPlan`, som nu bruger `spillerOphold`.
I Lyngby-scenariet faldt "venter over 90 min" fra 73 til 16, og "tid i hallen, gns." steg fra 146 til 291 min.

## Kompromiser undervejs kan trækkes tilbage (2026-10-17)

Jesper: det, der gives efter undervejs for at få programmet til at gå op, skal kunne trækkes tilbage, så løseren kan
prøve igen. Det gælder fx kortere kampe og pausen givet på dagen.

- **Hvordan kompromiserne findes:** `kompromis.js` sammenligner opsætningen fra før "Lav kampprogram" (`kp.foer`) med
  den nuværende. Dermed er kamplængden, pausen og alle valg på kortene med, uden at hvert valg skal huske sig selv:
  dagens tider og baner, rækkens tidsrum, reserverede baner, dage, dispensation, varighedsgrænser, tidsvindue, Swiss i
  grupper, færre runder og form.
- **Ikke med:** beregnede felter (formForslag, middelvejen) og et fastlåst antal runder, der er det samme, som planneren
  valgte automatisk.
- **I panelet:** "Kompromiser undervejs" viser dem med afkrydsning og knappen "Prøv uden de valgte — løseren regner".
- **Prøven:** De valgte sættes tilbage på en kopi (`udenKompromiser`), kampene bygges igen, og løseren regner på kopien.
  Programmet røres ikke.
- **Resultatet:** Finder løseren et program, der ikke har flere fejl i Tjek end det nuværende, bliver det et tilbud
  ("Brug programmet uden kompromiset", med Fortryd). Ellers står det i panelet, at løseren ikke kunne, og at programmet
  ikke er ændret.

Afprøvet lokalt på Lyngby med alt som Swiss og kortenes gruppeforslag, så programmet går op med 20 min og pausen på
dagen. Hverken pausen eller grupperne kunne undværes på 60 s, og programmet blev stående. Tilbudsvejen blev afprøvet med
et kunstigt løsersvar.

Formuleringen blev rettet samme dag. Jesper fandt det "svært at gennemskue, hvad det betyder, når jeg sætter eller fjerner
et flueben":

- Hver linje siger nu, hvad der sker, hvis man sætter flueben, fx "Tilbage til 30 min kampe (nu 20 min)" og "Pausen
  tilbage i planen (nu gives den på dagen)".
- Ingen flueben er sat fra start.
- Overskriften er "Kan løseren klare sig uden kompromiserne?", og knappen hedder "Lad løseren prøve med de valgte
  ændringer".
- Svaret gentager, hvad der blev prøvet: "Løseren prøvede: Pausen tilbage i planen. Det gik ikke — …".

Jesper spurgte: "Hvorfor er der kun mulighed for 20 og 30 minutter, hvorfor ikke 25?". Kamplængden kunne kun gå helt
tilbage til længden fra før. Nu er linjen et valg: "Kampe på [25 min / 30 min (som før)] igen (nu 20 min)". Valget har
alle trin på 5 min fra den nuværende længde hen mod den fra før, og standard er længden fra før.

## Løseren: en uafgjort dag får resten af tiden (2026-10-17)

Jesper satte løseren til 4 minutter for at se, om 25 min kunne gå op. Den gav op efter 126 s. Dagene løses hver for sig,
og tiden fordeles efter antal kampe. En dag, der ikke blev afgjort på sin andel, stoppede hele søgningen (rettelsen fra
2026-10-12). Nu gemmes en uafgjort dag til sidst og får al den tid, der er tilbage, når de andre dage er løst. Først hvis
den heller ikke bliver afgjort da, er svaret uafgjort, og tiden går til planen med færrest brud. Det samlede problem
løses stadig ikke samlet bagefter.

## Gennemgang af hele løseren (2026-10-17)

Der var lavet mange ændringer i løseren på kort tid, så Jesper bad om en gennemgang af hele løsningen. Den fandt 22
punkter, delt i tre pakker.

**Pakke 1 — fejl, der gav et forkert resultat eller skjulte svaret:**

- Løserens beskeder (ændret imens, netværksfejl, kø) vises i kampprogrammets panel. Før forsvandt de bag panelet.
- Diagnoseknapperne udfører den handling, de viser.
- Kamplængden kan kun sættes tilbage til længder, hvor de låste kampe passer i gitteret.
- Et tilbud fra løseren afvises, hvis programmet er ændret siden.
- En bevist umulig dag er beviset for hele problemet.
- Diagnosens "flere ting på én gang" bruger forsøget med alle lempelser.
- Stabil omplanlægning regnes fra kampens tidligere tid.

**Pakke 2 — løserens tid, diagnosen og ventetiden:**

- Dagene får hver en andel af den tid, der er tilbage, ikke af den samlede. Tiden til at bygge modellen trækkes fra.
  Planen med færrest brud får mindst resten af den valgte tid.
- Diagnosen kan nu også pege på pausen, single og double samtidig, seniorreglerne og årgangens tidsvindue. Før blev de
  alle til "ikke plads nok". Pausen og single/double har en knap, der retter opsætningen og optimerer igen. Diagnosen
  prøver de regler, planen med færrest brud bryder. Varigheden prøves ikke række for række, når den heller ikke hjælper
  helt uden.
- Løserens mål for ventetid regner nu på samme måde som programmets score og Tjek: Swiss-runderne tæller for alle i
  lodtrækningen. Før talte løseren hver Swiss-lodtrækning som én gruppe, mens scoren kun så kendte kampe. Derfor kunne
  en "forbedret" plan få en dårligere score. Af en Swiss-lodtrækning tager løseren kun første og sidste runde med, for
  de midterste ændrer ikke, hvornår spilleren kommer og går. Det gør modellen mindre.
- Panelets knapper kan ikke bruges, mens løseren eller planlæggeren regner, fordi resultatet ville bygge på det gamle.
  "Lav kampprogram" imens siger til i stedet for at blive overskrevet bagefter.
- "Lad løseren prøve med de valgte ændringer" har sin egen tidsvælger. Det er den samme tid som ved "Forbedr med
  løseren".

**Pakke 3 — en mindre model, oprydning og tests:**

- Swiss-runder uden kendte spillere ligger i rækkefølge, fordi hver runde afhænger af hele runden før. Derfor sendes
  konflikter mellem runde r og r+2 ikke med, for de følger af runden imellem. Ligger runderne på én dag, sendes de
  midterste heller ikke med i varigheden, ventetiden og tiden i hallen. Første ukendte runde er med, for en
  oversidder i runde 1 kommer først der. På Lyngby U9/U11 med alt som Swiss faldt konfliktparrene fra 11.174 til
  7.155, og tid i hallen fra 6.671 til 3.978 kampe i grupperne.
- I løseren regnes hver kamps dage én gang. "Kampen ligger på dag d" er én variabel, som alle reglerne deler. Før
  lavede spændet, max dage, max kampe og sluttiden hver deres.
- Spillernes løbenumre sendes ikke længere til løseren, for den brugte dem ikke. Det samme gælder dagenes start og
  slut. Den døde "udløsere" i varigheden er fjernet.
- Valideringen tjekker også kapaciteten og tiderne til planen med færrest brud og diagnosen. Den køres én gang.
- Beslutningen om løserens svar ligger nu i `loeser-svar.js` med egne tests: læg ind, tilbud eller behold, planen
  med færrest brud og prøven. Planen med færrest brud sammenlignes nu på fejl i Tjek. Før blev antal brudte regler
  sammenlignet med antal fejl.
- Nye løsertests:
  - delt pr. dag og samlet giver samme mål med alle bløde mål;
  - en uafgjort dag, der bevises umulig i anden runde;
  - stop i anden runde giver startplanen;
  - tiden klemmes til max;
  - løsningen i bidder regner flytningen fra den tidligere tid.

## Programmer uden kompromiserne, og et mere overskueligt panel (2026-10-17)

Jesper ville gerne kunne se de planer, der ikke går op, men som er tæt på, og kunne vælge dem. Han syntes også, at
panelet efter "Lav kampprogram" var blevet rodet og svært at overskue.

**Programmer uden kompromiserne.** Felterne med flueben er erstattet af én række pr. kompromis:

- Hvert trin for kamplængden har sin egen række, fx "Kampe på 25 min" og "Kampe på 30 min som før".
- Der er rækker for pausen i planen og for en Swiss Ladder som én igen.
- "Alt som før" har sin egen række. Går flere kompromiser op hver for sig, prøves de også sammen.

For hver række laver planlæggeren et rigtigt program i en baggrundstråd. Det tager ca. et sekund pr. række på Lyngby.
Rækken viser:

- om programmet går op, eller hvor mange fejl i Tjek det har, og hvilke;
- sluttid pr. dag og tid i hallen i gennemsnit, sammenlignet med programmet nu.

"Brug dette program" lægger programmet ind, også med regelbrud. "Fortryd" bringer det nuværende tilbage. "Lad løseren
prøve" er den samme prøve som før, og svaret står i rækken.

På Lyngby U9/U11 med alt som Swiss og gruppekortene taget viste rækkerne, at programmet også gik op med pausen
tilbage i planen, men så sluttede dagene 17:40 og 16:40 i stedet for 16:20 og 15:40. Det gik også op med U11 C HS som
én Swiss igen. 25 min gav 1 fejl. Knappen "Brug … som før" er erstattet af rækkerne.

**Panelet:**

- Kortene står først, og kun ét ad gangen ("1 af 2"). De næste står som en linje, fordi programmet laves om efter
  hvert valg.
- Hvert valg viser sin virkning som et mærke: "går op", "løser dette · 27 regelbrud andre steder" eller "3 regelbrud
  tilbage". Detaljerne står dæmpet under.
- Programmerne uden kompromiserne vises, når kortene er afgjort.
- "Videre til Til TP" står i toppen.
- Prognose, "gjort undervejs" og låste kampe står samlet nederst.

## Løserens ur tæller ned (2026-10-18)

Jesper: brugeren ved ikke nødvendigvis, hvor lang tid der er sat af til løseren. Før talte uret op. Nu tæller det ned
til løserens frist, fx "højst 21 s tilbage".

- Uret starter med den valgte tid. Derefter følger det den tid, løseren selv melder (`restSekunder`), også når den går
  videre til planen med færrest brud eller diagnosen.
- Der står "højst", fordi løseren ofte stopper før, når den ikke finder bedre planer.
- Står løseren i kø, står uret stille.

## Løseren på én dag (2026-10-18)

Jesper: lørdagens program er blevet rigtig godt, og han har selv rykket lidt rundt. Søndagen kan han ikke selv få god,
så han vil kunne sætte løseren i gang med kun søndag.

Knappen "Forbedr kun søn. 23/11 med løseren" står ved "Forbedr med løseren" og følger den valgte dagfane. Den vises
kun, når turneringen har flere dage.

- Kampene på de andre dage holdes på deres tid, som var de låst.
- Løseren kender dem stadig, så spillere, der spiller begge dage, pausen og varighederne regnes rigtigt.
- Kampe uden tid lægges på dagen, hvis rækken spiller den.

Afprøvet lokalt på Lyngby U9/U11 med alt som Swiss: lørdagens 197 kampe stod præcis, hvor de stod, og 134 af
søndagens 180 kampe blev flyttet.
