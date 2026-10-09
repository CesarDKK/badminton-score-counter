# Planner: designkritik og nyt flow (2026-10-09)

**Hvad:** planner.badmintonapp.dk, hele flowet fra .TP-fil til liste til TP.
**Hvem:** turneringsledere i klubberne. De bruger planneren få gange om året, på PC, og kender TP og reglementet, men ikke plannerens begreber.
**Stadie:** i drift. Motoren er moden; brugerfladen er vokset én funktion ad gangen.
**Grundlag:** gennemspillet i browser med Lyngby U9/U11 2025 (U9 + U11 D lørdag, U11 B + C søndag) og Lyngby U13/U15 2026, plus kildekoden (`src/ui/*`, `src/app.js`).
**Rammeværk:** Anthropics design-critique-skill (førstehåndsindtryk, brugervenlighed, visuelt hierarki, konsistens, tilgængelighed).

## Samlet indtryk

Motoren er stærk: et forslag til 306 kampe tager 22 ms, og der er en CP-SAT-løser, nedskæringsforslag, sammenligning af kamplængder og et grundigt Tjek. Men brugerfladen viser **motorens værktøjer** i stedet for **brugerens opgave**. Brugeren skal selv kende rækkefølgen: indstil alt → "Lav forslag" → læs Tjek → vælg den rigtige af fem måder at lave en plan på → find feltet i fane 1 → forfra. Den største gevinst er én handling, **"Lav kampprogram"**, der kører hele kæden selv og kun **spørger, når planen ikke går op** — med valg, der allerede er afprøvet.

## Sådan gik gennemspilningen

| Trin | Hvad skete | Problem |
|---|---|---|
| 1. Åbn fil | Dialog: "Tag tidsplanen med / Kun spillere, rækker og kampe". | Fin. |
| 2. Fil og opsætning | 7 afsnit, ca. 40 felter. Kamplængden står på TP's 30 min, mens anbefalingen er 25 (og sammenligningen siger "25 min uden pause" er bedst). | Intet fortæller, hvad der *skal* røres, og hvad der kan blive stående. Anbefalingen bruges ikke, før man selv trykker. |
| 3. Plan, tom | 7 knapper; **to røde primærknapper** ("Lav forslag" og "Optimér") og en tidsvælger. | Hvilken skal man trykke på? |
| 4. Lav forslag | "Alle 306 kampe har tid, men 4 kunne kun placeres ved at bryde en regel". Løsningen står som **tekst**: "Udvid tidsrummet til 18:00, eller giv rækken flere reserverede baner." | Ingen knap. Brugeren skal finde U09 D's tidsrum i fane 1 og lave forslaget igen. |
| 5. "Find forslag, der får kabalen til at gå op" (stor rød knap) | Ét forslag: "Skær kun i double og mix — **Ingen runder skæres**, regelbrud 4 → 4", med "Brug dette". | Et forslag, der intet ændrer og ikke løser noget. Den rigtige løsning (tidsrum til 18:00) tilbydes ikke her. |
| 6. Tjek | "Tjek (0/56)": 7 advarsler om turneringsformen (TP's lodtrækning giver for få kampe), 48 om ventetid, 1 om tidsrum. Kvitteres én ad gangen. | Tre slags ting blandet sammen. De 7 om lodtrækningen fandtes, *før* planen blev lagt, og kan ikke rettes i planneren. 56 advarsler giver alarmtræthed. |
| 7. Liste | Pr. kategori i TP's rækkefølge, kopiér/udskriv. | Fin — gør præcis det, den skal. |

## Brugervenlighed

| Fund | Alvor | Anbefaling |
|---|---|---|
| Ingen samlet "lav programmet"-handling. Fem veje til en plan: Lav forslag, Forslag for dagen, Alternativer, Optimér, Find forslag der får kabalen til at gå op (+ "Brug" i kamplængde-sammenligningen). | 🔴 Kritisk | Én primær handling "Lav kampprogram", der kører hele kæden (se nyt flow). De andre bliver til "Mere"-valg. |
| Når planen ikke går op, får brugeren **tekst** i stedet for **valg**. Kun løserens diagnose (efter "Optimér") har knapper. | 🔴 Kritisk | Beslutningskort: hvert problem bliver et spørgsmål med afprøvede løsninger og deres pris; ét klik retter og laver planen igen. |
| Opsætningen viser alt på én gang. Det, der kun betyder noget, når planen ikke går op (dispensation, max varighed, max dage, Swiss-runder, min. kampe samlet, reglementets grænser), står side om side med det, alle skal tage stilling til (rækkernes dage). | 🔴 Kritisk | Kun det, maskinen ikke kan vide, spørges om før planlægning. Resten forudfyldes, gemmes væk eller spørges først ved konflikt (se tabellen nedenfor). |
| Kamplængde og pause vælges ikke automatisk, selv om sammenligningen ved bedre. | 🟡 Moderat | Autopiloten vælger "bedst samlet" og viser valget i resultatet med "Skift". |
| Nedskæringspanelet kan vise forslag uden effekt ("Ingen runder skæres", 4 → 4). | 🟡 Moderat | Vis kun forslag, der forbedrer noget. Står der intet, så sig hvorfor. |
| Tjek blander fejl i planen, forhold ved TP-lodtrækningen og kvalitet (ventetid). 56 advarsler. | 🟡 Moderat | Tre niveauer: **Skal rettes** / **Bør ses** / **Til orientering**. Lodtrækningen tjekkes *før* planlægning. Kvittér pr. gruppe. |
| "Score 361,1" og vægte siger ikke brugeren noget. | 🟡 Moderat | Vis menneskelige nøgletal: går op ja/nej, slut pr. dag, tid i hallen, antal der venter længe. Scoren flyttes til detaljer. |
| Bekræftelser via browserens `window.confirm` ("Planlæg alle kampe forfra?") ved hvert forslag. | 🟡 Moderat | Fortryd i stedet for at spørge: lav planen, vis "Fortryd". |
| "Tjek (0/56)" er uforklaret (fejl/advarsler). | 🟢 Mindre | "Tjek · 56 advarsler", eller et prik-mærke. |
| Fanelinjen har en lodret rullebjælke (den hvide boks til højre for fanerne): `.faner { overflow-x: auto }` + `.fane { margin-bottom: -1px }` giver 1 px lodret overløb (målt: 47 px indhold i 46 px). | 🟢 Mindre | `overflow-y: hidden` på `.faner`. |
| "Åbn projektfil" står ikke på linje med "Åbn .TP-fil" (mindre skrift i sekundær-knappen). | 🟢 Mindre | Samme højde på knapper i samme række. |
| Træk-og-slip virker kun med mus (HTML5 drag & drop) — ikke tastatur eller touch. | 🟢 Mindre | Klik kort → klik slot som alternativ. Lav prioritet: bruges på PC. |

## Visuelt hierarki

- **Det, øjet ser først (Plan):** tre røde knapper — "Lav forslag", "Optimér" og "Find forslag, der får kabalen til at gå op". De konkurrerer, og den sidste er den mindst vigtige.
- **Læserækkefølge:** dagfaner → værktøjslinje → lang grå statussætning → lilla forslagstekst → gul punktliste → gitter. Det vigtigste ("går programmet op?", "hvornår slutter dagen?") er begravet midt i statussætningen.
- **Vægt:** én primærknap pr. skærm. Status som et resultatkort med 3–4 store tal frem for en sætning.

## Konsistens

| Element | Problem | Anbefaling |
|---|---|---|
| Ord | "forslag", "alternativ", "løser", "optimér", "kabalen", "nedskæring", "Tjek", "kvittér" — samme opgave, mange navne. | Fast ordforråd: *kampprogram*, *lav*, *forbedr*, *problem*, *beslutning*. |
| Status | Tre former: mærker, grå sætning, lilla forslagstekst — og "0 fejl, 56 advarsler" i toppen. | Ét statuskort pr. skærm. |
| Knapper | `knap`, `knap--sekundaer`, `knap--lille` blandes uden fast regel; flere røde på samme skærm. | Rød = én primær handling pr. skærm. |
| Hjælpetekst | Lange afsnit med reglement-henvisninger øverst i hvert panel. | Én linje + "Hvorfor?" til at folde ud. |

## Tilgængelighed

- **Kontrast:** dæmpet tekst `#9494a6` på `#0d0d1a` ≈ 6,5:1 — bestået. **Hvid tekst på den røde knap `#e94560` ≈ 3,8:1 — dumper AA** for normal tekst (kræver 4,5:1; knapteksten er 16 px fed, ikke "stor tekst"). Mørkere rød (fx `#d02c4a`, ca. 5:1) eller større skrift.
- **Klikflader:** `knap--lille` er ca. 28 px høj (anbefalet min. 32–44 px). Kort på halv bane har 11 px tekst.
- **Farve alene:** fejl/advarsel på kort vises kun som rød/gul ring, og kategorifarverne kan selv være røde/gule. Tilføj ikon (✖/▲) på kortet.
- **Tastatur:** gitteret kan ikke betjenes uden mus.

## Det, der virker

- Liste-fanen: præcis det, der skal tastes i TP, i TP's rækkefølge.
- Filen bliver i browseren; kun anonymiserede tal til løseren.
- Gitteret med kategorifarver, fyldning pr. slot og "klik viser spillerens andre kampe".
- Tjek's "Vis" hopper direkte til kampene.
- Motoren: hurtig, deterministisk, og den kan allerede *afprøve* ændringer (nedskæring, kamplængde) — det er fundamentet for beslutningskortene.

---

# Nyt flow

**Princip:** planneren laver programmet; brugeren tager kun stilling til det, maskinen ikke kan vide — og til valg, når reglerne ikke kan overholdes.

```
1 Åbn fil ─► 2 Turneringen ─► [Lav kampprogram] ─► 3a Går op ──────────────► 4 Til TP
              (få spørgsmål)          │                (resultatkort)
                                      └──────────► 3b Går ikke op
                                                     beslutningskort ─► (lav igen) ─► 3a
                                     Finpuds (valgfrit): gitteret som i dag
```

**Trin 1 — Åbn fil.** Som i dag.

**Trin 2 — Turneringen (det skal du tage stilling til).** Én skærm:
- Dage: start, slut og baner (forudfyldt fra TP). "Spær baner …" som link.
- Hvilke dage hver række spiller (forudfyldt; U9/U11 én dag efter reglementet).
- **Forhåndstjek af lodtrækningen:** "U11 D HS: 39 spillere er kun sikret 2 kampe (krav 4)" med valget *Behold TP's lodtrækning* / *Lad planneren foreslå Swiss Ladder*. I dag dukker det først op som advarsel i Tjek efter planlægningen.
- Én knap: **Lav kampprogram**.

**Autopiloten** (ingen spørgsmål undervejs, viser fremdrift):
1. Kamplængde og pause: `sammenlignKamplaengder` → "bedst samlet".
2. Formvalg for kategorier sat til automatisk (`genberegnKampe`).
3. `lavAlternativer` → det bedste forslag.
4. Valgfrit: løseren forbedrer i baggrunden (30–60 s, kan stoppes) — afhænger af Jespers svar nedenfor.

**Trin 3a — Går op.** Resultatkort:
> ✓ Programmet går op · lørdag 09:00–18:10 · søndag 09:00–14:50 · 0 regelbrud
> Tid i hallen gns. 197 min · 12 spillere venter over 90 min (vis)
> Valgt for dig: kamplængde 25 min, pausen gives på dagen [Skift]
> **[Se planen]** [Liste til TP]

**Trin 3b — Går ikke op.** Ét beslutningskort pr. problem, med løsninger, der *allerede er afprøvet*:
> **U9 har ikke plads til 4 doublekampe mellem 12:00 og 17:00**
> ◉ Forlæng U9 til 18:00 — *går op · U9 slutter 17:45* (anbefalet)
> ○ Giv U9 6 baner i stedet for 5 — *går op · U11 D slutter 20 min senere*
> ○ Skær U9-double til 2 runder — *går op · 4 spillere under minimum*
> ○ Behold, og lad 4 kampe bryde tidsrummet
> **[Brug og lav programmet igen]**

**Finpuds (valgfri).** Gitteret som i dag, men værktøjslinjen bliver: **[Lav programmet igen]** · [Forbedr med løseren] · *Mere ▾* (forslag for dagen, ryd dag, andre forslag, lås kategori). Tjek bliver et panel her med de tre niveauer.

**Trin 4 — Til TP.** Listen som i dag + gem projektfil.

Fanerne bliver til trin: **1 Fil · 2 Turneringen · 3 Program · 4 Til TP**.

## Hvor skal indstillingerne bo?

| Indstilling | I dag | Fremover |
|---|---|---|
| Dagens start/slut og baner | Dage og baner | **Trin 2**, forudfyldt fra TP |
| Rækkens dage | Rækker | **Trin 2**, forudfyldt |
| Spærrede baner | Dage og baner | Trin 2, foldet ("Spær baner …") |
| Før skoledag | Dage og baner | Automatisk (udledes af ugedagen); vises, kan slås fra |
| Turneringsform pr. kategori | Rækker | **Forhåndstjek i trin 2** — kun kategorier, der ikke når kravet |
| Kamplængde og pause i planen | Kamplængde og pauser | **Automatisk**; vises i resultatet med "Skift" |
| Rækkens tidsrum, reserverede baner | Rækker | Forudfyldt fra TP; foldet under rækken; **spørges ved konflikt** |
| Swiss-runder, cup for vinderne/to bedste | Rækker | Automatisk; **spørges ved konflikt** |
| Dispensation til flere dage | Rækker | **Spørges kun**, når programmet ikke går op på én dag |
| Max varighed singler, max dage | Rækker | Reglementets værdi; skjult; **spørges ved konflikt** |
| Min. kampe tælles samlet | Rækker | **Spørges ved nedskæring** |
| Halv bane (U9) | Rækker | Automatisk; skjult |
| Prioritet pr. kategori, automatisk form vælger | Rækker | Avanceret |
| "En kamp regnes til" (minimum/slot) | Kamplængde og pauser | Avanceret |
| Anti-samtidighed, puljerunder synkront, ventetidsgrænse | Avanceret | Avanceret |
| Reglementets grænser | Avanceret | Avanceret; **spørges ved konflikt** (dispensation) |
| Vægte og score | Avanceret / Plan | Avanceret; scoren skjules |
| Tid til løseren | Plan | Automatisk (fx 60 s) med "Stop" |

## Motoren: hvad findes, hvad mangler

**Findes:** `lavForslag`, `lavAlternativer`, `optimer` (CP-SAT) med diagnose, `alleNedskaeringer`, `sammenlignKamplaengder`, `fordelRaekkerPaaDage`, `genberegnKampe` (automatisk form), `tjekPlan`, `loesningsforslag`.

**Mangler:**
1. **Autopilot:** én funktion, der kører kæden og returnerer plan + de valg, den traf (kamplængde, pause, form). Kan bygges af eksisterende dele.
2. **Beslutningsgenerator:** i dag er `loesningsforslag` kun tekst. Den skal give strukturerede kandidat-ændringer (`{ raekke, aendring }` / `{ dag, aendring }` / `{ kategori, swissRunder }`), og hver kandidat afprøves med `lavForslag`. Kun kandidater, der forbedrer, vises — rangeret efter pris. Løserens diagnose-knapper og nedskæringen bliver kilder til samme generator.
3. **Forhåndstjek af lodtrækningen** før planlægning (reglerne findes i Tjek i dag).
4. **Tjek i tre niveauer** og kvittering pr. gruppe.

## Rækkefølge for at bygge (forslag)

- **Fase A — rettelser (lille):** fanelinjens rullebjælke, knapkontrast, én rød knap på Plan, statuskort i stedet for statussætning og score, nedskæring uden tomme forslag, en "Ret og lav igen"-knap ved de løsningsforslag, der i dag kun er tekst.
- **Fase B — automatik:** beslutningsgenerator + "Lav kampprogram" + resultatkort og beslutningskort. De nuværende faner bevares imens.
- **Fase C — nyt flow:** trin i stedet for faner, opsætningen skåret ned til trin 2 + avanceret, Tjek ind i Program.

## Spørgsmål til Jesper

1. **Kamplængde:** må autopiloten vælge kamplængde og "pause på dagen" selv (og vise valget), eller skal det altid være et spørgsmål? Kamplængden skal jo også sættes i TP.
2. **Løseren:** skal den køre automatisk efter hvert "Lav kampprogram" (bruger serveren 30–60 s), eller kun på knap?
3. **Pris:** hvilken rækkefølge, når noget skal gives? Fx *længere dag* før *flere baner til en række* før *bryde rækkens tidsrum* før *færre kampe* før *dispensation*?
4. **Hvem:** skal flowet tilpasses dig (kender alt) eller den klub, der bruger planneren første gang? Forslaget her er bygget til den sidste — med alt muligt for dig under "Avanceret".
