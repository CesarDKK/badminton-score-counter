---
name: test-deploy
description: Start en testinstallation af hele BadmintonApp (docker compose) i cloud-sessionen og tjek ændringer visuelt med skærmbilleder, før de deployes i prod på badmintonapp.dk. Brug når brugeren vil se, teste eller tage skærmbilleder af en ændring.
---

# Testinstallation i cloud-sessionen

1. Kør `bash scripts/cloud-test-deploy.sh`. Første gang tager det nogle minutter
   (images bygges). Kør det igen efter kodeændringer — det genbygger kun det ændrede.
2. Appen kører på `http://localhost:8080` (localhost = direkte adgang, ikke en klub).
   Admin-login: `admin123` på `admin.html`.
3. Tag skærmbilleder med Playwright og den forudinstallerede Chromium
   (`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })`; kør ikke
   `playwright install`). Læg dem i scratchpad og send dem til brugeren.
   Opfang også `pageerror` og konsolfejl og nævn dem.
4. Stop og slet testdata med `bash scripts/cloud-test-deploy.sh down`.

Bliver et image sprunget over, står grunden i loggen scriptet nævner. Typisk er det
en adresse, miljøets netværksregler blokerer (fx `codeload.github.com` for
football-backendens landeflag). Fortæl brugeren hvilken adresse, så de kan
tilføje den under miljøets *Network access*.
