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

## Pakke 2 — ét fælles regelmodul + kontrakt-test JS ↔ Python

- [ ] 9. Løseren er strengere end Tjek på fire regler (pause for mulige cupspillere, rækkens tidsrum,
      rækkens dage, max dage er advarsler i Tjek men hårde i løseren) → falsk "umuligt", og
      diagnosen siger misvisende "plads".
- [ ] 10. Senior-reglerne (E/M finalerunder, max 3 kampe, finaledag, slot for kort) håndhæves
      hverken af planlægger eller løser.
- [ ] 11. Lempelsen "reserveret" i fase 2 bogfører den lånte bane i rækkens egen pulje → altid kapacitetsfejl.
- [ ] 12. Dagfordelingen: rækker med reserverede baner får altid første dag; reserverede baner
      trækkes fra alle rækkens dage; fordelingen slippes sent i lempelsesrækkefølgen; `dagOrden` bruges ikke.
- [ ] 13. Swiss-runde 2+ tælles ikke sammen med spillerens øvrige kampe i max kampe pr. dag og haltid.
- [ ] 14. Ældre projekter uden `maxDage` / `antiSamtidighed` / `pauseKlasse` tolkes forskelligt i Tjek, planlægger og løser.
- [ ] 21. Ingen test sender et rigtigt `bygProblem()`-problem gennem `loes()`; `nginx -t` køres ikke i CI.
- [ ] 24. Tre kopier af `kanDeleSpillere`/`alleForfaedre`, `varighedFor`, `pauseFor`, tilladt tidsvindue,
      banetælling og haltid-grupper; to af minimumskravet (`minKampeKrav` er kopieret ind i `rules.js`).

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
