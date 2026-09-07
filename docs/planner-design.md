# planner.badmintonapp.dk — tidsplanlægger til individuelle turneringer

Status: design 2026-09-07; **alle fire faser bygget 2026-09-07** på branchen `planner-fase1` (`planner/`, se `planner/README.md`).
Afvigelse fra § 7.3 nr. 3: pausen regnes som standard oven i reglementets
minimumstid (ikke et helt slot), fordi Jespers egne planer lægger samme
spillers kampe i naboslots; det kan slås om i opsætningen. Dokumentet er grundlaget
for at bygge; ændringer i design aftales her først.

## 1. Formål

En turneringsleder laver seedning og lodtrækning i Tournament Planner (TP) og
skal derefter sætte tid på typisk 250–350 kampe over to dage, så Badminton
Danmarks turneringsreglement overholdes. Det er i dag håndarbejde i TP's
gitter og svært at overskue.

Planneren skal:

1. åbne en .TP-fil, hvor tilmeldinger, par og lodtrækning er på plads,
2. komme med et forslag til, hvornår hver kamp spilles,
3. vise planen grafisk pr. dag og lade brugeren flytte kampe med træk-og-slip,
4. advare med det samme, når planen bryder reglementet,
5. levere en liste, som kan tastes ind i TP.

**TP er og bliver systemet, der gælder.** Tilmeldinger, X-makkere,
frasortering, seedning og lodtrækning håndteres i TP, før filen gemmes og
åbnes i planneren. Planneren rører ikke ved lodtrækningen; den lægger kun
tider på de kampe, TP har skabt.

## 2. Afgrænsning og principper

- **Separat statisk site** på `planner.badmintonapp.dk`, serveret fra samme
  nginx-container som marketing- og statistik-sitet (`/usr/share/nginx/planner`,
  kode i `planner/`). Ingen backend, ingen database, ingen login.
- **Alt sker i browseren.** TP-filen indeholder e-mails og fødselsdatoer på
  børn. Intet af det må forlade brugerens maskine. Tilstand gemmes i
  `localStorage` og som en projektfil (JSON), man kan hente og åbne igen.
- **Til alle klubber.** Ingen klub-specifik logik; alt konfigureres pr. projekt.
- **Deterministisk planlægger, ikke AI.** Forslaget laves af en algoritme i
  browseren og er altid gyldigt. Samme input giver samme plan.
- **Kun tidsslots, ikke baner.** Under afviklingen tager en kamp den bane, der
  bliver ledig. Planen siger dag og klokkeslæt; kapaciteten pr. slot er antal
  baner.
- Samme designsprog som resten af badmintonapp.dk (temavariabler, ingen
  hårdkodede farver). Målgruppe: pc/laptop med mus.

## 3. Arbejdsgang

```
BadmintonPlayer ─▶ TP: importér tilmeldinger, sæt par, lus ud, lodtrækning ─▶ gem .TP
                                                                                 │
                       ┌─────────────────────── planner ───────────────────┐     │
                       │ åbn .TP ─▶ opsætning (dage, tider, baner, pauser) │◀────┘
                       │        ─▶ "Lav forslag" ─▶ gitter, træk-og-slip   │
                       │        ─▶ advarsler ─▶ liste til indtastning      │
                       └───────────────────────────────────────────────────┘
                                                                                 │
TP: tast tider ind ◀── liste ────────────────────────────────────────────────────┘
```

Passer planen ikke (for mange kampe til banerne), viser planneren præcis hvor
og hvor meget. Brugeren ændrer så turneringsform eller puljestørrelse i TP,
gemmer igen og åbner filen igen; planen bevares for de kampe, der stadig
findes (se `tpRef` i afsnit 6).

**Version 2 (ikke i scope nu):** skrive tiderne tilbage i en ny .TP-fil, så
indtastningen i TP forsvinder. Det kræver et skrivebibliotek til Access-filer,
som ikke findes til browseren, og er ikke undersøgt.

## 4. Inputfilen: `.TP`

En Microsoft Access-database (Jet 4) uden password. **Verificeret 2026-09-07:**
npm-pakken `mdb-reader` (v3) bundlet med esbuild og `esbuild-plugin-polyfill-node`
(Buffer-polyfill) læser Lyngby-filen på 2,8 MB i Chrome på 24 ms. Biblioteket
skal have et `Buffer`, ikke et `Uint8Array`.

Relevante tabeller:

| Tabel | Indhold |
|---|---|
| `Settings` | `Tournament` (navn), `Location`, `director`, `MaxMatchesPerDay` m.fl. |
| `Event` | kategorier: `id, name ("U11 B HS"), gender (1=H, 2=D), eventtype (1=single, 2=double)` |
| `Draw` | lodtrækninger pr. event: `drawtype` 2 = pulje, 1 = cup, 4 = dobbelt pulje (alle møder alle to gange), 17 = Swiss Ladder; `drawsize`; `drawrounds` (Swiss) |
| `Entry` | tilmelding: `event, player1, player2` |
| `Player` | `id, firstname, name, club, gender, dob, memberid` |
| `Club` | `id, name, clubid` (BadmintonPlayer-id) |
| `PlayerlevelEntry`, `RankingEntry` | niveau (1=E … 6=D) og kategoripoint pr. spiller |
| `PlayerMatch` | positioner og kampe, se nedenfor |
| `Link` | kobler cup-pladser til puljeplaceringer: `src_draw, src_pos, name ("Pulje 1 #1")` |
| `TournamentDay`, `TournamentTime`, `Court` | TP's gitter: dage, 30-min slots, baner (fx `01-B … 10-G`, halve baner `01-B½`) |
| `MatchWarning` | TP's egne kollisionsadvarsler |

`PlayerMatch`-strukturen:

- **Pulje** (drawtype 2/4): rækker med `entry` sat og `planning = pos*1000` er
  positionerne. Kampe har `planning = a*1000 + b` og `van1`/`van2` =
  positionerne. Hver kamp findes i to spejlede rækker (2001 og 1002); unik
  kamp = `(draw, min(van1,van2), max(van1,van2))`. `roundnr` er
  puljerunden, `plandate` dato + klokkeslæt, `court`, `duration` (kun efter
  afvikling).
- **Cup** (drawtype 1): noder med `planning = runde*1000 + idx`, `van1`/`van2`
  = børn, `wn` = forælder. Bladnoder har `link` → `Link`-tabellen, så man ved,
  hvilke puljers vindere/toere der mødes, før puljerne er spillet.
- **Swiss Ladder** (drawtype 17): kun runde 1 har parringer; runde 2…n er
  pladsholdere uden spillere. Runder tidssættes samlet (én tid pr. runde).
- **Datoer:** Jet gemmer klokkeslæt uden tidszone; `mdb-reader` leverer dem
  som UTC-`Date` med vægurets tid. Læs altid med `getUTCHours()` osv., aldrig
  lokal tid.

Fund fra to Lyngby-filer (bruges som testdata, se afsnit 10):

| | U13/U15 CD, feb. 2026 | U9/U11 BCD, nov. 2025 |
|---|---|---|
| Kampe | 230 | 263 |
| Baner | 10 | 10 (+5 halve til U9) |
| Slots | 30 min, 09:00–17:30 | 30 min, 09:00–19:00 |
| Baner sat på kampe | ja | nej, kun tider |
| Reel varighed single | gns. 28,5 min, median 27 | – |
| Reel varighed double | gns. 36 min | – |
| Max kampe pr. spiller pr. dag | 9 | – |

Reglementets minimum på 20 min pr. kamp er for optimistisk til U13/U15; 30-min
slots er den reelle praksis.

## 5. Regler planneren håndhæver

Kilde: Reglement for individuelle turneringer (gældende fra 1. juli 2026) med
appendiks 1–3. Hver regel har en alvorlighed: **fejl** (planen er ulovlig)
eller **advarsel** (kræver dispensation eller er en anbefaling). Alle grænser
er parametre med reglementets værdi som standard.

### 5.1 Tid og program (§ 3 stk. 8, § 4 stk. 5 og 5.1)

| Regel | Standard | Type |
|---|---|---|
| Pause mellem en spillers kampe | ABCD 10 min, M 15, E 20; fælles 12 ved MABCD i samme turnering | fejl |
| Tidsvindue i programmet | U9/U11 09:00–19:00, U13/U15 09:00–20:00, U17+ 09:00–21:00; dag før skoledag 2 timer tidligere | fejl |
| Max kampe pr. spiller pr. dag | 10 ved flere dage, 12 ved én dag | fejl |
| B-, C-, D-rækker og U11 A over flere dage | kræver dispensation | advarsel, kan kvitteres "dispensation givet" |
| E-rækker: kun semi og finale sidste dag; finaler 10:00–13:00 | | fejl |
| Senior E/M: max 3 kampe pr. kategori pr. dag; kvart/semi/finale ikke samme dag | | fejl |
| Senior A/B og senior+ E/A: kun kvart/semi/finale på finaledagen | | fejl |
| Klokkeslæt på alle kampe undtagen Swiss Ladder | | fejl |
| Min. tid pr. kamp (ungdom ABCD 20, EM 25, senior ABCD 25, EM 30) | slotlængde ≥ minimum | fejl |

### 5.2 Turneringsform (appendiks 1) — vises, ændres i TP

| Regel | Type |
|---|---|
| Ungdom M/A: min. 2 kampe pr. tilmeldt kategori | advarsel |
| Ungdom B/C/D: min. 3 kampe i single, 2 i double | advarsel |
| U9/U11: min. 4 kampe i single | advarsel |
| Swiss Ladder: min. 4 runder | advarsel |
| Anbefaling: min. 6 kampe ved 3 kategorier | info |

Disse regnes ud fra lodtrækningen i filen og vises på Tjek-siden, men rettes i
TP.

### 5.3 Spillere (§ 3, Ranglistereglement app. A) — kun information

Filen har niveau, point og fødselsdato, så planneren kan liste: niveau højere
end rækken, fødselsår uden for årgangen, spiller i mere end 3 kategorier.
Brugeren har allerede luset ud i TP, så det er et sikkerhedsnet, ikke en
arbejdsgang. Kan udelades i version 1, hvis det ikke er billigt.

## 6. Datamodel (projektfil)

```jsonc
{
  "version": 1,
  "kilde": { "filnavn": "Lyngby U9-U11 2025.TP", "laestUtc": "…" },
  "turnering": { "navn": "Lyngby", "hal": "Engelsborg Hallen", "dage": ["2025-11-22", "2025-11-23"] },
  "opsaetning": {
    "slotMin": 30,                                              // pr. turnering, 5-min trin
    "pauseMin": { "ABCD": 10, "M": 15, "E": 20, "faelles": null }, // se 7.3
    "dage": [ { "dato": "2025-11-22", "start": "09:00", "slut": "19:00",
                "baner": 10,
                "spaerret": [ { "fra": "12:00", "til": "14:00", "baner": 2 } ] } ]
  },
  "raekker":    [ { "id": "U11 B", "aargang": "U11", "raekke": "B", "dage": ["2025-11-23"],
                    "dispensationFlereDage": false, "raekkefoelge": ["MD", "HS", "DS", "HD", "DD"] } ],
  "kategorier": [ { "id": "U11 B HS", "raekke": "U11 B", "kat": "HS", "type": "single",
                    "form": "pulje-cup", "halvBane": false } ],
  "spillere":   { "<memberId>": { "fornavn", "efternavn", "koen", "foedt", "klub", "niveau" } },
  "kampe":      [ { "id": "d49:1000:2000", "kategori": "U11 B HS", "fase": "pulje|cup|swiss",
                    "gruppe": "Pulje 1", "runde": 1, "navn": "Pulje 1 #1 – #2",
                    "spillere": ["…"],            // kendte (pulje) …
                    "muligeSpillere": ["…"],      // … eller mulige (cup: union af kildepuljer)
                    "afhaengerAf": ["d49:…"],     // kampe der skal være spillet først
                    "tpRef": { "draw": 49, "van1": 1000, "van2": 2000 } } ],
  "plan":       { "d49:1000:2000": { "dag": "2025-11-22", "slot": "09:00" } },
  "vinduer":    [ { "kategori": "U09 D HS", "runde": 1, "dag": "…", "fra": "12:00", "til": "13:00", "halveBaner": 6 } ],
  "kvitteret":  [ "U11 C:flere-dage" ]            // advarsler brugeren har accepteret
}
```

`tpRef` gør det muligt at åbne en nyere version af .TP-filen og beholde tider
på de kampe, der stadig findes.

**Valg ved indlæsning.** Når en .TP-fil åbnes, vælger brugeren, om TP's
eksisterende tider (`plandate`) skal med:

- *Tag tidsplanen med* — kampene lægges i gitteret, hvor TP har dem, og
  planneren viser konflikter i den eksisterende plan. Bruges til at rette en
  plan.
- *Kun spillere, rækker og kampe* — gitteret er tomt, uanset hvad filen
  indeholder. Bruges til at starte helt forfra uden at skele til den gamle.

Har filen ingen tider, springes valget over. Ved genindlæsning i et
eksisterende projekt gælder samme valg, blot for projektets egne tider: behold
dem på de kampe, der stadig findes, eller ryd alt.

## 7. Planlægningsmotoren

### 7.1 Gitter og kapacitet

Pr. dag et gitter `slot × kapacitet`. Slotlængde er pr. turnering (standard
30 min, 5-min trin). Kapaciteten er antal hele baner, og kan sænkes i et
tidsrum (spærrede baner).

**Halve baner til U9.** U9-single spilles på halv bane med sænket net,
U9-double på hel bane. En hel bane kan deles i to halve, men en delt bane kan
ikke bruges til andre kampe i samme slot. Kapaciteten pr. slot er derfor
`hele = baner − delte`, `halve = 2 × delte`, hvor planneren vælger `delte` pr.
slot. Én U9-single alene koster en hel bane (den anden halvdel spildes), så
planneren fylder halve baner parvis og samler U9-singler i sammenhængende
slots, så nettene kun skal sænkes og hæves én gang.

### 7.2 Enheder der planlægges

- **Kamp** (1 slot, 1 hel eller ½ bane), med kendte eller mulige spillere.
- **Swiss Ladder-runde**: et vindue, der reserverer kapacitet i *m* slots
  uden klokkeslæt pr. kamp. Ved 19 spillere er en runde 9 kampe; med 6 halve
  baner fylder den 2 slots. Runde *r+1* starter tidligst, når runde *r*'s
  vindue er slut plus pause.

### 7.3 Begrænsninger

Hårde (planen er ugyldig):

1. Antal kampe i et slot ≤ kapaciteten (hele og halve baner).
2. En spiller er højst i én kamp pr. slot. For cupkampe bruges de *mulige*
   spillere, hvilket er konservativt men altid sikkert.
3. Pause: en spillers næste kamp må tidligst starte `slot + pause` efter
   forrige kamps start, hvor kampen regnes til at vare ét slot og pausen er
   rækkens. Rundet op til næste slot betyder det ved 30-min slots mindst 60
   min mellem to kampe. Ved en spiller i to rækker gælder den længste pause.
4. Rækkefølge: puljerunde *r+1* efter runde *r*; cup-runde efter de kampe,
   den bygger på (fra `Link`/`van`).
5. Tidsvindue pr. årgang og pr. dag.
6. Max kampe pr. spiller pr. dag.
7. Rækkens dage (5.1) medmindre dispensation er kvitteret.

Bløde (målfunktion, i prioriteret rækkefølge):

1. Kortest mulig tid i hallen pr. spiller (sidste kamp minus første kamp,
   summeret; U9/U11 vægtes højest).
2. Rækkefølge inden for en række: mix, single, double, medmindre andet giver
   kortere haltid. Kan låses pr. række.
3. Finaler sidst i kategorien og gerne samlet.
4. Fyld banerne fra morgenen; huller sidst på dagen er billigere end huller
   midt på dagen.
5. En puljes runder tæt på hinanden.

### 7.4 Algoritme til forslaget

Grådig listeplanlægning, slot for slot:

1. Byg alle kampe fra filen og afhængighedsgrafen (puljerunder, cup-træ,
   Swiss-runder).
2. Ordn kategorier efter rækkens dage, derefter fase (pulje før cup) og
   rækkefølgen mix → single → double.
3. For hvert slot, så længe der er kapacitet: vælg den kamp med højest
   prioritet, som er *klar* (afhængigheder færdige, alle mulige spillere har
   haft deres pause, tidsvindue og dagsloft overholdt, hel/halv bane passer).
   Prioritet = kategoriens rækkefølge, derefter "spillere der allerede har
   spillet i dag" (så de bliver færdige), derefter puljens fremdrift.
   U9-singler placeres parvis.
4. Lokal forbedring: byt kampe parvis, hvis det sænker målfunktionen uden at
   bryde hårde regler; stop efter et fast antal iterationer eller ca. 2 s.
5. Kampe, der ikke kunne placeres, lægges i en "ikke placeret"-liste med
   årsag, så brugeren ser præcis, hvor kapaciteten mangler.

Brugeren kan låse enkelte kampe eller hele kategorier, så "Lav forslag" kun
flytter resten.

## 8. Brugerflade

Én single-page-app med fire faner:

1. **Fil og opsætning** — åbn .TP (eller projektfil); ved .TP med tider
   vælges "tag tidsplanen med" eller "kun spillere og kampe" (se afsnit 6).
   Se turnering, kategorier, antal kampe pr. kategori og turneringsform. Dage, start/slut,
   slotlængde, baner og spærringer, pauser, dage pr. række og rækkefølge.
   Kapacitetsvisning: bane-slots til rådighed mod kampe pr. dag, med
   udnyttelsesgrad, så man kan se før forslaget, om det kan nås.
2. **Plan** — gitter pr. dag: rækker = slots, kolonner = pladser op til
   kapaciteten (delte baner som to halve pladser). Kampe som farvede kort pr.
   kategori med spillere/klubber ved hover, Swiss Ladder-runder som brede
   blokke. Træk et kort til et andet slot; konflikter vises straks (rød kant,
   forklaring ved hover), overfyldte slots markeres. Knapper: "Lav forslag",
   "Ryd dag", lås. Sidepanel: ikke-placerede kampe, spillervisning ("alle
   kampe for Anton" med haltid), filter pr. kategori.
3. **Tjek** — alle fejl og advarsler fra afsnit 5 som liste; klik hopper til
   kampen i gitteret. Advarsler kan kvitteres.
4. **Liste** — pr. kategori og dag i TP's rækkefølge: "Pulje 1 #1–#2, lørdag
   09:00". Udskrift/PDF og eksport af projektfil.

## 9. Teknik

- Mappe `planner/` i repoet: `index.html`, `planner.css`, `src/` med moduler
  `tp-reader.js` (mdb-reader-wrapper → projektmodel), `rules.js`,
  `scheduler.js`, `store.js`, `ui/*.js`. Vanilla JS som resten af frontend.
- **Build-trin:** `mdb-reader` kræver bundling (esbuild +
  `esbuild-plugin-polyfill-node`). Det færdige `tp-bundle.js` committes, så
  nginx-imaget ikke behøver node; build-scriptet ligger i `planner/build/` og
  køres via Docker (`node:20-alpine`) som de øvrige node-opgaver.
- nginx: ny `server`-blok `planner.badmintonapp.dk` + `planner.localhost`,
  root `/usr/share/nginx/planner`, `COPY planner/` i `Dockerfile.frontend`.
  Test lokalt som statistik-sitet (`Host: planner.localhost`).
- Regler, kampudtræk og planlægger er rene funktioner uden DOM, så de kan
  unit-testes med Node `--test` i `planner/tests/unit/` og køres i CI som de
  øvrige.

## 10. Test

- **Unit-tests** af `tp-reader` (begge Lyngby-filer: pulje, cup, dobbelt
  pulje, Swiss Ladder, halve baner), af hver regel i afsnit 5 og af
  planlæggeren på små syntetiske turneringer.
- **Benchmark:** de to Lyngby-filer indeholder Jespers håndlavede planer.
  Planneren skal (a) indlæse dem og rapportere nul hårde konflikter (evt.
  afvigelser undersøges, TP har selv 14 advarsler i den ene), og (b) lave sit
  eget forslag ud fra samme lodtrækning og sammenlignes på målfunktionen
  (haltid pr. spiller, sluttid pr. dag). Testfilerne lægges **ikke** i repoet
  (persondata); de ligger lokalt og testene springes over, hvis de mangler.

## 11. Faser

1. **Læs og vis:** projektstruktur, build af `tp-bundle.js`, `tp-reader` med
   tests mod begge filer, fane 1 med opsætning og kapacitetsvisning, valget
   mellem at tage eksisterende tider med eller starte med tomt gitter.
2. **Gitter og regler:** fane 2 med gitter og træk-og-slip, `rules.js` med
   live konflikter, fane 3 Tjek.
3. **Forslag:** `scheduler.js`, "Lav forslag", lås, ikke-placerede kampe,
   benchmark mod Lyngby-planerne.
4. **Finpudsning:** Swiss Ladder-vinduer, halve baner, fane 4 liste/udskrift,
   projektfil, nginx og deploy.

Første reelle brug: Lyngby U9/U11 21.–22. november 2026 (tilmeldingsfrist
5. november, program senest 14. november).

## 12. Åbne punkter

- Version 2: skrive tider tilbage i en ny .TP-fil. Kræver et skrivebibliotek
  til Jet-databaser (findes til Java og .NET, ikke browser) og dermed et lokalt
  værktøj eller en server, som så håndterer persondata. Ikke undersøgt.
- Spillertjek (5.3) er et tilvalg; afgøres når fane 1 er bygget.
