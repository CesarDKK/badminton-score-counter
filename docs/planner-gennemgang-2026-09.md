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
- [ ] Idé (Appendiks 2): vis en oplysning ved kategorier med under 4 tilmeldte om, hvilke rækker de må sammenlægges
      med. Sammenlægningen sker fortsat i TP.

## Pakke 3 — én kapacitetsberegning, stabilt formvalg og stabile kamp-id'er

- [ ] 6. Kamp-id'er følger positionen: efter ny puljeinddeling eller ændret `cupTop` kan en gammel tid
      eller lås lande på en anden kamp (genindlæsning er dækket af punkt 3; `genberegnKampe` er ikke).
- [ ] 7. Ændringer af dage, tidsrum, regler, slotlængde og halv bane genberegner ikke kampene.
- [ ] 15. `kapacitetTilKategori` tæller alle rækkens dage (også ved max 1 dag), ignorerer årgangens
      tidsvindue og trækker andre rækker fuldt fra; tre forskellige kapacitetsberegninger.
- [ ] 16. Andet pas i `genberegnKampe` afhænger af kategoriernes rækkefølge.
- [ ] 17. Nedskæringsforslag afprøves med alle runder fastlåst, men "Brug dette" låser kun de ændrede.
- [ ] 18. Ulige Swiss-felter: alle tælles som r−1 (overdriver "under minimum"); TP's Swiss tæller r for alle.

## Pakke 4 — drift

- [ ] 19. Rate limit i nginx nøgler på Cloudflares IP (ingen `real_ip_header CF-Connecting-IP`);
      grænsen giver 503 med uklar besked, og statuskald opgiver efter 5 i træk.
- [ ] 20. Én løser-plads uden adgangskontrol; en klient kan holde den i 6 min ad gangen.
- [ ] 22. Ingen CSP-header (valideringen i punkt 5 lukker de kendte huller).
- [ ] 25. Opgradering af gemte projekter sker med løse flag; versionsforskel → tom start uden besked.
- [ ] 26. Død kode (`antalKampe`, `cupRunder`, `ledigeBaneSlots`, `dagOrden`), forældede kommentarer
      ("kun U9"), README er blevet en ændringslog.

Ikke et problem: JS-filerne sendes med `no-store` (målt i prod), så forældede moduler efter deploy kan ikke ske.
