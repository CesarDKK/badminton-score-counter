# API til badmintonplanner.dk

Dette dokument beskriver, hvordan badmintonplanner.dk sender en træningsaftens
runder til en klubs skærme i badmintonapp.dk. Det er skrevet til udvikleren
hos badmintonplanner.dk.

## Sådan hænger det sammen

- Klubbens admin opretter en **API-nøgle** under fanen *Badmintonplanner* i
  badmintonapp.dk og sætter en **ugeplan** op: hvilke ugedage og tidsrum
  (07.00–23.00, kvarter-trin) badmintonplanner.dk må sende data, og hvilke
  baner der må bruges den dag.
- Admin kopierer adressen og nøglen ind i badmintonplanner.dk. Der udveksles
  aldrig et password.
- Ved hver rundestart sender badmintonplanner.dk **ét kald** med rundens
  kampe. Navnene vises med det samme på oversigten og på TV'et ved den rigtige
  bane. Baner, der er åbnet i ugeplanen, men ikke er med i kaldet, ryddes.
- Uden for tidsrummet svares **403** uanset indhold. Når tidsrummet slutter,
  rydder badmintonapp.dk selv banerne, så klubben er tilbage i normal drift.
- Tæller klubben selv på en bane (tablet/QR), kører tælleren som i dag.

## Adresse og nøgle

```
POST https://<klub>.badmintonapp.dk/api/integrations/planned-round
GET  https://<klub>.badmintonapp.dk/api/integrations/status
Authorization: Bearer <API-nøgle>
Content-Type: application/json
```

Nøglen er 64 hex-tegn og hører til én klub. Den kan tilbagekaldes af klubben
når som helst; derefter svares 401.

## POST /api/integrations/planned-round

Kaldes én gang pr. runde, i det øjeblik runden starter, med det der står i
planen lige nu.

```json
{
  "roundId": "2026-09-07-r2",
  "sequence": 2,
  "label": "Runde 2",
  "nextRoundStartsAt": "19:30",
  "note": "Fælles udstrækning efter sidste runde",
  "forceNewMatch": true,
  "matches": [
    { "courtNumber": 1,
      "side1Player1": "Anders Jensen", "side1Player2": "Bo Nielsen",
      "side2Player1": "Carsten Hansen", "side2Player2": "Dan Petersen",
      "substitutes": ["Erik Larsen"] },
    { "courtNumber": 2,
      "side1Player1": "Finn Madsen", "side1Player2": "Hans Berg",
      "side2Player1": "Gert Olsen",  "side2Player2": "Ib Kruse",
      "note": "Halvbane: Finn–Gert og Hans–Ib" },
    { "courtNumber": 3,
      "side1Player1": "Jens Holm", "side2Player1": "Kim Lund" }
  ]
}
```

| Felt | Krav | Betydning |
|---|---|---|
| `roundId` | valgfri, ≤ 100 tegn | Jeres id for runden. Sendes samme `roundId` igen (genforsøg), svarer vi med det samme resultat som første gang uden at røre banerne. |
| `sequence` | valgfri, heltal ≥ 0 | Løbenummer. Et kald med lavere nummer end den senest modtagne runde afvises med 409, så et forsinket kald fra runde 1 ikke overskriver runde 2. |
| `label` | valgfri, ≤ 100 tegn | Rundens navn. Vises på oversigt og TV (kommer i næste udgave). |
| `nextRoundStartsAt` | valgfri, `tt:mm` dansk tid, tom i sidste runde | Bruges til "Næste runde kl. 19.30" (kommer i næste udgave). |
| `note` | valgfri, ≤ 500 tegn | Fritekst til hele runden. |
| `forceNewMatch` | valgfri, standard `true` | `true`: banen skifter til de nye navne, også hvis der tælles på den. `false`: en bane, hvor der tælles (point er scoret og kampen ikke afsluttet), afvises med `match_in_progress`; prøv igen senere. Navne alene spærrer aldrig. |
| `matches` | påkrævet, ≤ 20 poster | Én post pr. bane i brug. Åbnede baner, som ikke er med, ryddes. |
| `courtNumber` | 1–20, unik i listen | Hallens banenummer, samme som klubbens TV-links. |
| `side1Player1`, `side2Player1` | påkrævet, ≤ 100 tegn | Første spiller på hver side af nettet. |
| `side1Player2`, `side2Player2` | valgfri | Makkere. Er de udfyldt, vises banen som double. |
| `substitutes` | valgfri, ≤ 8 navne | Udskiftere på banen (vises i næste udgave). |
| `note` (på kampen) | valgfri, ≤ 200 tegn | Fritekst til banen, fx halvbane (vises i næste udgave). |

Navne er kun til visning. Styretegn fjernes og gentagne mellemrum
sammenfoldes; for lange værdier klippes.

### Svar (200)

```json
{
  "roundId": "2026-09-07-r2",
  "receivedAt": "2026-09-07T17:00:03.412Z",
  "results": [
    { "courtNumber": 1, "status": "shown",
      "previous": { "side1": "Jens Holm / Bo Nielsen", "side2": "Kim Lund / Dan Petersen",
                    "sets": "2-0", "score": "21-15, 21-18", "completed": true, "counted": true } },
    { "courtNumber": 2, "status": "rejected", "reason": "match_in_progress",
      "previous": { "side1": "...", "side2": "...", "sets": "1-0", "score": "21-15, 7-3", "completed": false, "counted": true } },
    { "courtNumber": 4, "status": "cleared", "previous": null }
  ]
}
```

| Felt | Betydning |
|---|---|
| `status` | `shown` (navne vist), `cleared` (banen ryddet, fordi den ikke var med i listen) eller `rejected`. |
| `reason` | Kun ved `rejected`: `match_in_progress`, `court_not_allowed` (banen er ikke åbnet i klubbens ugeplan i dag) eller `court_not_found` (klubben har ikke så mange baner). |
| `previous` | Det der stod på banen før skiftet, eller `null` hvis banen var tom. `counted` fortæller, om klubben har talt på banen; ellers er `side1`/`side2` bare forrige rundes navne. `score` er de færdige sæt, plus et igangværende sæt hvis kampen ikke er afsluttet. |
| `replayed` | `true` når svaret er en gentagelse af et tidligere kald med samme `roundId`. |

Genforsøg kun baner, der blev afvist, og kun indtil næste runde starter. En
talt kamp med mindst ét færdigt sæt, som overskrives, gemmes i klubbens
kamphistorik, så resultatet ikke går tabt.

### Fejlsvar

| HTTP | `code` | Hvornår |
|---|---|---|
| 401 | `invalid_token` | Nøglen mangler, er ukendt eller tilbagekaldt. |
| 403 | `integration_disabled` | Klubben har slået integrationen fra. |
| 403 | `outside_window` | Uden for klubbens tidsrum. Svaret indeholder `nextWindow` med næste åbne tidsrum. |
| 409 | `round_superseded` | `sequence` er lavere end den senest modtagne runde. |
| 422 | `invalid_payload` | Ugyldig body. `details` er en liste af fejl. |
| 429 | `rate_limited` | For mange kald. Vent det antal sekunder, der står i `Retry-After`. |

Grænser: højst 30 kald pr. minut pr. nøgle og 120 kald pr. 5 minutter pr.
IP-adresse. Body højst 100 KB. Ved 5xx eller netværksfejl: prøv igen med
stigende ventetid (fx 5, 15, 45 sekunder) og samme `roundId`.

## GET /api/integrations/status

Til at tjekke nøglen, når klubben sætter den ind, og til at vise
"forbundet" hos jer.

```json
{
  "integrationEnabled": true,
  "openNow": true,
  "courtsNow": [1, 2, 3, 4],
  "window": { "ugedag": 1, "from": "18:45", "to": "21:30" },
  "nextWindow": { "ugedag": 1, "navn": "mandag", "from": "18:45", "to": "21:30", "courts": [1, 2, 3, 4] },
  "serverTime": "2026-09-07T17:00:03.412Z",
  "tokenName": "Træningsaftener",
  "currentRound": { "roundId": "2026-09-07-r2", "label": "Runde 2", "receivedAt": "2026-09-07T17:00:03.000Z" }
}
```

`ugedag` er 1 = mandag … 7 = søndag. Tider er dansk tid. `openNow` er
`false` uden for tidsrummet, men kaldet svarer stadig 200.

## Anbefalet flow hos badmintonplanner.dk

1. Ved opsætning: kald `status` og vis fejl, hvis 401.
2. Ved hver rundestart: send `planned-round` med `roundId` og `sequence`.
3. Ved `rejected` med `match_in_progress`: prøv den bane igen efter fx 60
   sekunder, indtil næste runde starter.
4. Ved sidste runde: send den med tom `nextRoundStartsAt`. Send gerne et
   ekstra kald med tom `matches`-liste, når aftenen er slut, så banerne
   ryddes med det samme; ellers ryddes de, når tidsrummet slutter.
