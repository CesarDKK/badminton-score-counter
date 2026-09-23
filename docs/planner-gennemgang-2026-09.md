# Planner — gennemgang 2026-09-20

Samlet gennemlæsning af `planner/` efter mange løbende tilpasninger. Fund er grupperet efter
konsekvens og fordelt på fire pakker. Kryds af, efterhånden som de rettes.

## Pakke 1 — beskyt brugerens arbejde, og gør Tjek troværdig (rettet 2026-09-20)

- [x] **1. Tjek overså dobbeltbooking mellem Swiss-runde 2+ og spillernes kampe i andre kategorier.**
      Bekræftet på Lyngby U9/U11. Nu én melding pr. runde-slot og anden kamp: samme slot = fejl,
      for tæt på = advarsel (parringen kendes ikke endnu). `rules.js`.
- [x] **2. Resultatet fra "Optimér" overskrev ændringer lavet, mens løseren regnede** (op til 6 min),
      og kunne lægge en anden turnerings tider ind. Nu: `aendretUnderOptimering` afgør uændret /
      ændret / andet projekt / lukket; ved ændringer spørges der ("Vis løserens plan alligevel" /
      "Kassér"), låste kampe beholder deres tid (`flettetPlan`), og "Fortryd" går tilbage til
      planen lige før. `app.js`, `solver-klient.js`.
- [x] **3. Genindlæsning af TP-filen smed tider og låse på kampe, planneren selv havde bygget.**
      Nu beholdes de — men kun når kampen stadig er den samme (kategori, fase, runde, spillere),
      så en tid ikke lander på en anden kamp efter ny lodtrækning. `store.js: genindlaes`.
- [x] **4. Et stop i de første sekunder gik tabt** (stop_search virker kun, mens Solve kører), så
      løseren regnede hele tiden ud. Nu gentages stoppet, til søgningen er slut. `solver.py`.
- [x] **5. "Gemt i browseren" blev vist, også når gemningen fejlede, og en defekt projektfil kunne
      låse siden.** Nu: tegn først, gem bagefter (et projekt, der ikke kan vises, gemmes aldrig);
      statuslinjen siger "IKKE gemt"; opstart med et ulæseligt projekt giver en besked i stedet for
      en tom side; `validerProjekt` tjekker typer, datoer, klokkeslæt og tal (lukker også for HTML
      i felter, der vises uden escaping).
- [x] **8. Max haltid blev taget på tværs af dage i løserens problem** (U9 lørdag begrænsede søndag).
      Nu som i Tjek: grænsen gælder de dage, hvor spilleren har en kamp i rækken med grænsen
      (`haltid[].udloesere`). `solver-klient.js`, `solver.py`.
- [x] Teksten "Alle hårde regler er overholdt" er blødt op (løseren kender ikke senior-reglerne, se 10).

## Pakke 2 — ét fælles regelmodul + kontrakt-test JS ↔ Python (rettet 2026-09-20)

- [x] **24. Ét regelmodul.** `src/regelmodel.js` (`lavRegelmodel`) har byggestenene: kampvarighed, pause, hvem der
      kan dele spillere, tidsvinduer, banetælling, max dage, anti-samtidighed og E-/senior-reglerne. Tjek,
      planlægger og løser-oversættelse bruger dem alle; `minKampeKrav` står kun i `form.js`. Omlægningen blev
      bevist neutral (identisk plan, regelbrud, Tjek og løser-problem for 10 varianter af de to rigtige filer),
      før adfærden blev ændret.
- [x] **21. Kontrakt-test i CI.** `tests/kontrakt/kontrakt.mjs` + `solver/kontrakt.py`: 7 syntetiske projekter bygges
      med `bygProblem()`, løses af CP-SAT, og svaret skal give 0 fejl i `tjekPlan()`. (`nginx -t` i CI er ikke lavet.)
- [x] **13. Tid i hallen tæller Swiss-runderne med** — i Tjek, planlægger og løser (double kl. 9 + Swiss 12–16 = 7 timer).
      Max kampe pr. dag tæller stadig kun kendte kampe (grænsen på 10 er sjældent bindende).
- [x] **11. Reserverede baner: overløb.** `kapacitet.js: banebrugISlot` — en række bruger sine reserverede baner først og
      løber over på en FRI fælles bane; kun når de fælles også er fulde, er det en fejl. Tjek og planlægger deler
      reglen, og lånet er ikke længere et regelbrud. (Løseren er strengere: kun egne baner i tidsrummet.)
- [x] **12. Dagfordeling.** Rækker med reserverede baner vurderes mod egne baner; giver skønnet regelbrud, prøves de
      ramte rækker på deres anden dag (`dagTvang`, højst 6 forsøg); forslaget oplyser `dagValg`. Fase 2 bryder ÉN
      regel ad gangen og først det, Tjek kun regner for advarsler. Lyngby U9/U11 som filen er: 30 → 0 fejl.
      (Reserverede baner trækkes stadig fra alle rækkens dage — sæt rækkens dage i fane 1.)
- [x] **9. Diagnosen** kan nu også pege på rækkens tidsrum og rækkens dage (`problem.alternativer`), så den ikke
      misvisende siger "ikke plads". Pause for mulige cupspillere er stadig hård i begge planlæggere.
- [x] **10. E- og senior-reglerne** håndhæves af planlægger og løser: E-række sidste dag kun semi/finale (ved flere
      dage), E-finaler i finalevinduet, senior A/B kun finalerunder på finaledagen, senior E/M max 3 kampe pr.
      kategori pr. dag (`maxPrGruppe`) og kvartfinale ikke samme dag som semifinale/finale (`ikkeSammeDag`).
      **Bekræftet af Jesper 2026-09-20:** semifinale og finale må spilles samme dag, men kvartfinalen skal ligge
      en tidligere dag — Tjek melder fejl, hvis en kvartfinale deler dag med kategoriens semifinale eller finale,
      og planlægger og løser overholder det (`ikkeSammeDag`: hver kvartfinale mod hver semifinale og finalen).
- [x] **14. Ældre projekter** uden `maxDage` / `antiSamtidighed` / `pauseKlasse` tolkes ens alle steder (regelmodellen).
- [x] Løserens problem: en låst kamp uden for rækkens tidsrum ligger på de fælles baner (gav før falsk "umuligt").

### Krydstjek mod reglementet (2026-09-20)

Kilder: Reglement for Individuelle Turneringer § 3 stk. 8 og § 4 stk. 5–5.2, Appendiks 1 (turneringsformer),
Appendiks 2 (sammenlægning) og "U9-U11 turneringer 2026-2027 Vejledning" — alle fra badminton.dk/individuelle-turneringer.

- [x] Stemmer: min. tid pr. kamp (20/25/25/30), pauser (E 20, M 15, ABCD 10, fælles 12), tidsvinduer (U9/U11 til 19,
      U13/U15 til 20, U17+ til 21; 2 timer tidligere før skoledag), max 12/10 kampe pr. dag for ungdom, B/C/D og
      U11 A på én dag uden dispensation, E-række kun semi og finale sidste dag, E-finaler 10–13, senior E/M max 3
      kampe pr. kategori pr. dag, minimumskravene (M/A 2 pr. kategori; B/C/D 3 i single og 2 i double; U9/U11 4 i single).
- [x] Rettet: "Kvartfinaler må ikke afvikles samme dag som semi- og finaler" (Appendiks 1) — se punkt 10.
- [x] Rettet: E-rækker må tidligst programsættes fra kl. 10 — også indledende kampe, kvart- og semifinaler
      (`regler.eTidligst`, ny fejl `e-tidligst`; planlægger og løser overholder den).
- [x] Rettet: senior må højst spille 10 kampe pr. dag, også når turneringen er på én dag (ungdom: 12).
- [x] Rettet: finaledags-reglen gælder også Senior+ E- og A-rækker, ikke kun Senior A og B.
- [x] **Minimum antal kampe tælles pr. kategori** (Appendiks 1: "minimum 2 kampe i hver tilmeldt kategori", "minimum 3
      kampe i single og minimum 2 kampe i double", U9/U11 "minimum 4 kampe i single"; vejledningen: "4–6 singlekampe og
      2–5 doublekampe"). `minKampeSamlet` er nu FRA som standard i alle rækker og mærket "afviger fra reglementet";
      gemte projekter sættes én gang tilbage (`minKampeSamletV3`). Jesper 2026-09-20: reglementet gælder.
- [x] **"Max 4 timer" (U9) og "max 6 timer" (U11) gælder afviklingen af rækkens SINGLEKAMPE** (vejledningen), ikke
      spillerens samlede tid i hallen. `raekker[].maxHaltidMin` måles nu pr. række og dag fra første til sidste
      singlekamp (`regelmodel.singleVarighedGraense`); doublerne tæller ikke med. Standard U9 240, U11 360.
      Planlæggeren giver rækker med en grænse en frist fra morgenstunden, så singlerne lægges samlet.
      Lyngby U9/U11: U9's singler afvikles på 180 min, og forslaget har 0 fejl i alle tre opsætninger.
      (Afløser punkt 13's spiller-baserede haltid; spillerens ventetid er fortsat et blødt kriterie.)
- [x] **Rækkefølge efter vejledningen:** U9/U11 single → double → mix; U13 og op mix → double → single
      (`standardRaekkefoelge`); gemte projekter får den én gang (`raekkefoelgeV2`).
- [x] ~~Idé (Appendiks 2): vis en oplysning ved kategorier med under 4 tilmeldte om, hvilke rækker de må sammenlægges
      med. Sammenlægningen sker fortsat i TP.~~ Fravalgt af Jesper 2026-09-23: sammenlægning afgøres i TP, og reglerne i Appendiks 2 kræver skøn (nybegyndere, pointniveau, accept), som planneren ikke kan træffe.

## Pakke 3 — én kapacitetsberegning, stabilt formvalg og stabile kamp-id'er (lavet 2026-09-21)

- [x] 6. Tider og låse følger KAMPEN, ikke id'et (`store.overfoerPlan`, `kampSignatur`): samme kamp under nyt id
      beholder tiden; et gammelt id, der nu dækker en anden kamp (ændret `cupTop`, afbud, ny puljeinddeling),
      mister den. Genindlæsning og `genberegnKampe` bruger samme funktion.
- [x] 7. Ændringer af dage, baner, tidsrum, rækkens dage, regler, slotlængde og halv bane genberegner kampene
      (`genberegnEfterOpsaetning`), og fane 1 fortæller, hvis en automatisk form skiftede (og hvor mange tider der faldt bort).
- [x] 15. Én kapacitetsberegning: `kapacitet.pladsPaaDag` (årgangens tidsvindue, rækkens tidsrum, egne/fælles baner),
      `kapacitet.fordelRaekkerPaaDage` (planlæggerens dagfordeling, nu delt) og `FYLDNINGSGRAD` ét sted.
      Formvalget (`store.lavKapacitetsmodel`) regner dag for dag: en række med max 1 dag får én dags plads, og andre
      rækker belaster kun de dage og det tidsrum, de deler. Kapacitetsregnskabet bruger samme byggesten.
      Dagene fordeles efter det, rækkerne MINDST skal have, så "flest kampe" ikke lader en stor række klemme en lille ud.
      `regler.js` er skilt ud af store.js, så store kan bruge regelmodellen uden cirkulær import.
- [x] 16. Andet pas afhænger ikke af kategoriernes rækkefølge: forholdsmæssig andel → resten i lige store bidder →
      resten i fast orden → én afsluttende vurdering af alle (fjerner forældet "der er ikke plads" på doublerne).
- [x] 17. "Brug dette" fastholder ALLE Swiss-kategoriers rundetal (`forslag.alleRunder`) — præcis som afprøvet.
- [x] 18. Ulige Swiss-felter: højst én deltager pr. runde får en kamp færre (`form.swissOversiddere`). Mangler kun den
      ene kamp, melder Tjek og nedskæringsforslagene "op til N spillere" i stedet for hele feltet. TP's egen Swiss
      Ladder tælles nu på samme måde (ulige antal = én sikker kamp færre).

Målt på begge Lyngby-filer i 10 opsætninger: samme antal kampe og regelbrud som før, bortset fra at "alt som Swiss
med Jespers dage" nu skærer to små doubler fra 4 til 3 runder (stadig over kravet), fordi lørdagen er knap. Søndagens
rækker (U11 B + C) markeres nu korrekt med "der er ikke plads" — før blev begge dages plads lagt sammen.

## Pakke 4 — drift (lavet 2026-09-21)

- [x] 19. Rate-grænserne nøgler på `CF-Connecting-IP` (`map $http_cf_connecting_ip $planner_klient`) med et højt loft
      pr. forbindelses-adresse; grænsen svarer 429 med JSON og `Retry-After`. Klienten sætter tempoet ned ved 429 på
      statuskald og tåler forbigående fejl i 25 s i stedet for "5 i træk".
- [x] 20. Løser-pladsen: Origin-tjek i nginx, kvote på regnetid pr. klient (40 min/time), og løseren fortæller, hvornår
      den er ledig. Klienten venter selv i kø og starter af sig selv; "Stop" opgiver ventetiden.
      (Bevidst IKKE lavet: login. Planneren er åben for alle klubber; kvoten og den lave CPU-prioritet er værnet.)
- [x] 22. CSP-header for planneren (`nginx-planner-csp.conf`), afprøvet i browseren uden overtrædelser.
- [x] 25. Gemte projekter opgraderes i nummererede trin (`store.OPGRADERINGER`, `PROJEKT_VERSION` 2); de løse flag er
      væk. Et projekt fra en NYERE udgave afvises med en klar besked og bliver liggende (beskeden ved start kom i pakke 1).
- [x] 26. Død kode fjernet (`antalKampe`, `cupRunder`, formens `ledigeBaneSlots`-felt; `dagOrden` var allerede væk),
      "kun U9"-kommentarer rettet, README skåret til en vejledning — historikken ligger i `docs/planner-aendringslog.md`.
- [x] `nginx -t` i CI (upstream-navnene peges på localhost under testen).

Ikke et problem: JS-filerne sendes med `no-store` (målt i prod), så forældede moduler efter deploy kan ikke ske.
