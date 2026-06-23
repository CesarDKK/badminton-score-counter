# Design: Klub-logoer — Del C (visning af holdkamp-team-logoer)

**Dato:** 2026-06-23
**Status:** Godkendt design — afventer implementeringsplan

## 1. Formål

Vis klub-logoer ved kampene, bygget oven på del A (centralt bibliotek) og del B
(matching + overrides). **Del C afgrænses til holdkamp-team-logoer** vist
fremtrædende på **Oversigt** og **TV**. Individuelle/turnerings-spiller-logoer er
et senere trin (C2).

## 2. Beslutninger (truffet under brainstorm)

1. **Kun holdkamp-team-logoer** i del C (ikke individuelle/turnerings-spillere).
2. **Flader:** Oversigt + TV. **Ingen logoer på Court v3.**
3. **Fremtrædende** placering ved hver sides hold (synligt på afstand/storskærm).
4. **Verificering:** manuel (browser). Ingen ny test-infra.

## 3. Resolution-model (fra del B)

Pr. hold `n` (1/2) i en holdkamp (`team_matches`):
- `teamN_logo_id === 0` → **intet logo** (vis ikke).
- `teamN_logo_id > 0` → **bestemt logo** (slå op i biblioteket på id).
- `teamN_logo_id` null/undefined → **auto**: `matchLogo(teamN_name, logos)`.

Hjælpere findes: `window.LogoMatch.matchLogo(name, logos)`, `api.getPublicLogos()`
(returnerer `[{ id, club_name, aliases, url, width, height }]`).

## 4. Delt resolver

Udvid `frontend/js/logo-match.js` med:

```
LogoMatch.resolveTeamLogo(teamMatch, n, logos) -> logo | null
  v = teamMatch['team' + n + '_logo_id']
  hvis v === 0            -> null            (intet logo)
  hvis v er et tal > 0    -> logos.find(id === v) || null
  ellers (null/undefined) -> matchLogo(teamMatch['team' + n + '_name'], logos)
```

Returnerer et logo-objekt (`{ id, club_name, url, ... }`) eller `null`. Genbruges
af både Oversigt og TV.

## 5. Backend

`GET /api/team-matches/by-court/:courtId` udvides så teamMatch-SELECT også
returnerer `team1_logo_id` og `team2_logo_id` (TV bruger det). `/active` og
`/active-all` returnerer dem allerede (del B).

## 6. Oversigt — holdkamp-kort

I `oversigt-script.js`:
- Hent logo-listen én gang (`api.getPublicLogos()`) ved init og cache den
  (`_overviewLogos`).
- I `renderHoldkampCards` kort-header: indsæt `team1`-logoet til venstre for
  team1-navnet og `team2`-logoet til højre for team2-navnet, via
  `LogoMatch.resolveTeamLogo(tm, 1, _overviewLogos)` / `(tm, 2, ...)`.
- Fremtrædende størrelse (fx `min(8vh, 5vw)`), `object-fit:contain`. `null` →
  intet `<img>` (header falder pænt sammen).
- Logoerne sættes i den fulde struktur-render; den live patch-opdatering
  (`patchHoldkampCards`) rører dem ikke (logo skifter kun ved struktur-render).
- `<img onerror>` skjuler billedet hvis filen ikke kan hentes.

## 7. TV (`tv-script-v3.js` / `tv-v3.html`)

TV kender i dag kun banens game state. Tilføj:
- Cache logo-listen (`api.getPublicLogos()`) én gang.
- I poll-loopet: `api.getTeamMatchByCourt(courtId)`. Hvis banen er en aktiv
  holdkamp-delkamp (`byCourt && byCourt.game`):
  - Map TV'ets venstre/højre (player1/player2) til team1/team2 ved at matche
    `gameState.player1.name` mod delkampens `team1_player1/2` vs
    `team2_player1/2` (håndterer side-skift — samme princip som
    `holdkampCourtSides` i oversigt).
  - `leftLogo = resolveTeamLogo(byCourt, <team på venstre>, logos)`,
    `rightLogo = resolveTeamLogo(byCourt, <team på højre>, logos)`.
  - Vis logoet fremtrædende pr. `team-row` (venstre ved `#team1Row`, højre ved
    `#team2Row`) — fx via et `<img class="tv-team-logo">` i `.team-names` eller
    som flankerende element i rækken.
- Er banen ikke en holdkamp → skjul logoerne (turnering/individuel = C2).
- TV opdaterer hvert poll-interval; logo-elementerne opdateres/sættes idempotent
  (skift kun `src`/visning når værdien ændrer sig for at undgå flicker).

## 8. Court v3

Ingen ændringer — der vises bevidst ikke logoer på scoringsskærmen.

## 9. Fejl / edge-cases

- **Ukendt/slettet logo-id:** `logos.find` giver `undefined` → behandl som intet
  logo (vis ikke). Ingen fejl.
- **Billede kan ikke hentes:** `<img onerror>` skjuler elementet.
- **Side-skift på TV/bane:** mapping sker pr. poll ud fra aktuelle spillernavne,
  så logoet følger det rigtige hold uanset side.
- **Intet match (auto, men intet logo i biblioteket):** intet logo vises (ingen
  fejl) — admin kan tilføje logo eller sætte override (del A/B).

## 10. Manuel verificering (acceptkriterier)

- Med en holdkamp hvor begge klubber har logo i biblioteket:
  - **Oversigt:** holdkamp-kortets header viser begge hold-logoer fremtrædende
    (venstre/højre), live-score uændret.
  - **TV:** når en delkamp spilles på en bane, viser TV de to hold-logoer ved
    hver team-row; korrekt side selv efter side-skift.
- Et hold sat til **"intet logo"** (override 0) viser intet logo, selv hvis
  navnet ville auto-matche.
- Et hold med **bestemt logo** viser det valgte; et hold uden override viser
  auto-match på holdnavnet.
- En **turnering/individuel** kamp viser ingen logoer (forventet i del C).
- Court v3 viser ingen logoer.

## 11. Risici / opmærksomhedspunkter

- **TV ekstra kald:** `getTeamMatchByCourt` pr. poll (typisk hvert par sek.) —
  let payload, acceptabelt. Logo-listen caches for at undgå gentagne kald.
- **Flicker:** sæt kun `<img src>`/visning når den ændrer sig.
- **Produktion (Pi):** backend (by-court) + frontend ændres →
  `docker-compose build backend frontend && docker-compose up -d backend frontend`.
- **C2 (senere):** individuelle/turnerings-spiller-logoer (per-bane-grid +
  court/TV) via `player_logos` + `player_info`-klub + matcher.
