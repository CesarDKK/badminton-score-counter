# Gennemgang af hele stakken — september 2026

**Dato:** 23. september 2026
**Omfang:** badmintonapp.dk (tæller, TV, oversigt, admin, super-admin, backend), statistik, planner (brugerværdi),
footballapp.dk, provebillede.dk, salgssider og drift. Seks gennemgange, en pr. område, kun læsning.
Kodehenvisninger er fra `main` @ `9ee905d`. De alvorligste sikkerhedsfund er efterprøvet i koden en ekstra gang.

**Tilføjet 14. oktober 2026:** Pakke E (design og UX) efter en gennemgang af alle skærme i football, badminton og
provebillede, tegnet op på et fælles design-lærred.

Tidligere gennemgange, som ikke gentages her: `frontend-gennemgang-status.md` (juli) og `planner-gennemgang-2026-09.md`.

Status: ☐ = åben · ☑ = lavet · ✗ = fravalgt

---

## Kort fortalt

1. **Der er sikkerhedshuller, der bør lukkes før alt andet.** Det værste: alle på internettet kan få 12 timers
   skriveadgang til en klubs baner, turneringer og holdkampe ved at hente `/api/qr-code/1`. Der kræves ingen login.
2. **Tælleren kan give et forkert resultat i tre situationer,** som sagtens sker i en hal: genindlæsning i
   sætpausen, fortryd efter matchbold og nulstilling fra admin midt i en kamp.
3. **Backuppen giver falsk tryghed.** Den kan melde succes på en tom dump. Den ligger på samme disk. Sponsorbilleder
   og turneringstabeller kommer ikke med i klubbernes egne backups. Ingen får besked, hvis noget er nede.
4. **Football har en fejl, der kan stoppe et stævne:** cup med fx 6 hold (walkover) kan ikke spilles færdig.
5. **Mest brugerværdi for pengene:** eksport og print (holdkamp, turnering, planner-program), kontrol af
   TP-indtastning i planneren, "ret resultat" og opgivet/W.O. på tælleren, QR-plakat og TV-visning på football,
   prisside og referencer på badmintonapp.dk.

---

## Pakke A — sikkerhed (bør laves nu)

| # | Fund | Hvor | Status |
|---|---|---|---|
| A1 | **QR-endpointet er offentligt og udsteder skriveadgang.** `GET /api/qr-code/:bane` kræver intet login og opretter et match-session-token. `/t/<token>` giver en device-JWT i 12 timer, og `requireWriteAuthInClubMode` tjekker kun klub, ikke bane eller tokentype. Man kan omdøbe spillere, sætte vindere og flytte kampe i alle turneringer og holdkampe. | `routes/matchSessionTokens.js:56`, `server.js:63-95`, `middleware/auth.js:82-113`, `tournaments.js:585`, `teamMatches.js:206` | ☑ branch `sikkerhed-qr-session` (79fd49a) |
| A2 | **Device-tokens kan ikke trækkes tilbage.** Deaktivering i admin slår først igennem, når JWT'en udløber (14 dage for faste links). `is_active` tjekkes kun ved `/t/`. | `server.js:87`, `auth.js:95` | ☑ branch `sikkerhed-tilbagekald` |
| A3 | **Klub-admin fra klub A kan styre klub B's adgangslinks.** `clubAdminAuth` tjekker ikke `clubSubdomain`. | `middleware/clubAdminAuth.js:13`, `routes/deviceTokens.js` | ☑ branch `sikkerhed-klub-admin` |
| A4 | **Login-grænsen kan omgås.** `trust proxy: true` sammen med nginx' `$proxy_add_x_forwarded_for` betyder, at klienten selv styrer `req.ip`. `X-Forwarded-For: 10.0.0.1` rammer `skipPrivateNetwork`. Super-admin-login og football-login har slet ingen grænse. Samme `trust proxy` gør, at `X-Forwarded-Host` fra klienten styrer `req.hostname` og dermed klubben (tokens er stadig klub-bundne, så lav risiko, men bør låses til `Host`). | `server.js:14`, `rateLimiter.js:4-23`, `nginx.conf:107` | ☑ branch `sikkerhed-login-graense` |
| A5 | **Backup-gendannelse kan slette vilkårlige filer.** `file_path` fra backup-JSON indsættes råt, og `DELETE /api/sponsors/:id` unlinker stien. Containeren kører som root. | `routes/backup.js:142-157`, `sponsors.js:343-356` | ☑ branch `sikkerhed-backup-sti` |
| A6 | **`POST /api/match-history` er uden login,** også i klub-mode. Hvem som helst kan skrive falske resultater. | `routes/matchHistory.js:226` | ☑ branch `sikkerhed-kamphistorik` |
| A7 | **Side-rettigheder håndhæves kun i UI'et.** `requirePage` bruges kun i planner-fanen. `backup` er ikke en side-nøgle, så alle admins kan gendanne og overskrive klubben. | `middleware/pagePermission.js`, `superAdmin.js:14` | ☑ branch `sikkerhed-side-rettigheder` |
| A8 | **Slettede admins og nyt kodeord slår først igennem efter 24 timer** (badminton) og 7 dage (football). Løsning: token-version pr. bruger. | `auth.js:29`, `football-app/backend/middleware/auth.js:25` | ☑ branch `sikkerhed-admin-sessioner` |
| A9 | **Football-upload åbner for XSS på tværs af klubber.** Endelse og MIME-type kommer fra klienten, SVG er tilladt, og `/api/uploads` serveres på alle subdomæner. Tokenet ligger i localStorage. | `football-app/backend/routes/tournaments.js:29-35`, `teams.js:23-33`, `logos.js:44,58` | ☑ branch `sikkerhed-football-upload` |
| A10 | **Hosts uden for klub-subdomæner (`app.`, `admin.`, IP) kører i åben direct-mode** mod `badminton_counter`. Tjek i prod, om `admin123` fra `init.sql` er skiftet på demoen. | `middleware/tenant.js`, `init.sql:23` | ✗ bevidst: app.badmintonapp.dk er en åben demo, som alle må lege med (Jesper, 23/9) |
| A11 | **Port 80 og 8080 er bundet til 0.0.0.0,** og Docker går uden om ufw. Kan serveren nås uden om Cloudflare, kan `CF-Connecting-IP` forfalskes (statistik, planner). Tjek firewall/tunnel hos udbyderen, og fjern 8080 i prod. | `docker-compose.yml:92-93` | ☑ tjekket: port 80/8080 kan ikke nås uden om Cloudflare (Jesper, 23/9) |
| A12 | **Kun planneren har CSP.** App, admin, statistik, football og marketing har ingen. Football har heller ingen sikkerhedsheadere. | `nginx-security-headers.conf` | ☐ |
| A13 | **Containere kører som root, og backenden har MySQL-root-kodeordet.** | `Dockerfile.backend`, `docker-compose.yml:57` | ☐ |
| A14 | `GET /api/player-info` er offentlig og viser navn, klub, køn og årgang på alle spillere, også U9–U19. Det er et GDPR-spørgsmål. | `routes/playerInfo.js:31` | ☐ |

**Forslag:** A1–A7 i én branch, med tests af cross-club og tokentype. De ville have fanget A1 og A3. Derefter A8–A9.

---

## Pakke B — forkerte resultater og datatab

### Tælleren
| # | Fund | Hvor | Status |
|---|---|---|---|
| B1 | **Genindlæsning i sætpausen.** Scoren nulstilles først, når pausens callback kører. Efter en genindlæsning genoptages pausen ikke, og scoren står på 21-15. Næste tryk giver et nyt "vundet sæt", og kampen ender 2-0. Løsning: nulstil straks ved sætsejr, og gem pausens sluttid som data. | `court-script-v3.js:644-650, 960-974` | ☐ |
| B2 | **Fortryd efter matchbold.** Ved holdkamp/turnering meldes resultatet straks, og vinduet kan kun "Ryd banen". Ved almindelige kampe kan Fortryd gemme kampen to gange i historikken. | `court-script-v3.js:1410-1417, 2159, 2236` | ☐ |
| B3 | **Nulstilling fra admin rydder tabletten halvt.** Server, positioner, sæt-historik og Fortryd bliver liggende. Sker det i en pause, genskabes en "zombie-kamp". | `court-script-v3.js:1703-1747`, `gameStates.js:356-368` | ☐ |
| B4 | **To enheder på samme bane: sidste gemning vinder stille.** Ved 409 overtages kun versionen, ikke scoren. | `court-script-v3.js:1665-1699, 2380-2406` | ☐ |
| B5 | **Fejl ved indrapportering til holdkamp/turnering logges kun i konsollen.** "Ryd bane" sætter derefter kampen tilbage til pending, og resultatet er væk. | `court-script-v3.js:2884, 2923`, `gameStates.js:678-693` | ☐ |
| B6 | **TV'et kan vise sætscorer ud for den forkerte spiller** og vinderholdet findes ved tekstsøgning i navne. Løsning: gem sidebytte som et felt. | `tv-script-v3.js:359-397, 911-924`, `court-script-v3.js:2248` | ☐ |
| B7 | **Sideskift ved 11 i 3. sæt i double** spejler også det modtagende pars positioner. Slå op i reglementet, før det rettes. | `court-script-v3.js:665-680, 766-771` | ☐ tjek regel |
| B8 | Ingen idempotens-nøgle/kø på `saveMatchResult` (kendt afvejning fra juli, stadig åben). | | ☐ |

### Admin og backup
| # | Fund | Hvor | Status |
|---|---|---|---|
| B9 | **Backup-loopet kan melde succes på en tom dump.** Mangler `pipefail`, sletter gamle filer uanset udfald, ligger på samme disk, og restore er aldrig testet. | `scripts/backup-loop.sh:40-64` | ☐ |
| B10 | **Klubbernes egen backup mangler sponsorbilleder** (stien bygges forkert) og tabellerne `tournaments*`, `player_logos`, `holdkamp_watchers`, `planner_*` og `club_admins`. Restore tjekker ikke, at backuppen er fra samme klub. | `routes/backup.js:66-68`, `superAdmin.js:413` | ☐ |
| B11 | **Holdkamp kan oprettes to gange,** hvis linket indsættes igen, mens overvågningen venter. | `importHoldkamp.js:321, 451` | ☐ |
| B12 | **"Slet al holdkamphistorik" sletter også igangværende holdkampe** (turneringer bevarer de aktive). | `teamMatches.js:381-388` | ☐ |
| B13 | Sletning af en klub er en øjeblikkelig `DROP DATABASE`, og backuppen er én samlet dump. Forslag: blød sletning i 30 dage og en dump pr. database. | `superAdmin.js:168` | ☐ |
| B14 | Hvis databasen ikke er klar ved opstart, starter cron-jobs aldrig, men `/health` bliver grøn. Fejlede migrationer stopper ikke opstarten. | `server.js:168-187`, `migrationRunner.js:139-176` | ☐ |
| B15 | MySQL kan løbe tør for forbindelser: 15 pr. klub mod standarden 151. Ca. 9 travle klubber giver fejl for alle. | `tenantPools.js:53` | ☐ |

### Football
| # | Fund | Hvor | Status |
|---|---|---|---|
| B16 | **Hold med walkover sidder fast, og cuppen kan ikke gøres færdig,** når antal hold ikke er 2/4/8/16 (fx 3 puljer × top 2). | `football-app/backend/utils/bracket.js:21`, `frontend/admin.js:568` | ☐ |
| B17 | To hold fra samme pulje kan mødes i første cup-runde. Guiden kan gemme placeringer, der ikke findes. | `bracket.js:50`, `admin.js:227` | ☐ |
| B18 | **At rette eller rydde en kamp efter videre-avancement giver forkerte brackets** uden advarsel. | `routes/matches.js:92-98`, `utils/advancement.js:52-101` | ☐ |
| B19 | Tiebreak svarer ikke til forsidens løfte, og den sidste tiebreak er alfabetisk uden besked. | `utils/standings.js:64-71`, `marketing/index.html:938` | ☐ |
| B20 | Turneringer uden cup ender aldrig. To samtidige sidste puljekampe starter ikke cuppen. | `advancement.js:59-64, 109`, `matches.js:64` | ☐ |

### Planner og statistik
| # | Fund | Hvor | Status |
|---|---|---|---|
| B21 | Planner: en TP-fil uden dage i planlægningsgitteret får Plan-fanen til at gå ned. | `planner/src/ui/plan.js:72,152`, `tp-reader.js:490` | ☐ |
| B22 | Planner: "Fortryd" på alternativer virker ikke efter genindlæsning, fordi planen allerede er gemt. | `planner/src/app.js:441-449` | ☐ |
| B23 | Statistik: ændrer badmintonplayer formatet, kan gode data blive overskrevet af tomme ("37 hold, 0 kampe"). | `stats/backend/cache.js:300-302`, `harvest.js:235-258` | ☐ |
| B24 | Statistik: et forkert klubnavn låser klubben fast i tomme data og koster ca. 40 kald i timen. | `stats/backend/server.js:206`, `cache.js:341` | ☐ |
| B25 | Statistik: standardsæsonen er forkert fra oktober til juni (`seasons[1]`). | `stats/frontend/app.js:77` | ☐ |
| B26 | Statistik: interne klubkampe mangler, når man folder et hold ud. | `harvest.js:239`, `server.js:269` | ☐ |

---

## Pakke C — drift (én person, fem sites)

| # | Forslag | Værdi | Indsats | Status |
|---|---|---|---|---|
| C1 | Oppetidsovervågning uden for serveren på alle fem sites og `/health`, med sms/mail og evt. statusside. | Høj | S | ☐ |
| C2 | Heartbeat fra backuppen (fx healthchecks.io efter en gyldig dump) plus `pipefail` og `gzip -t`. | Høj | S | ☐ |
| C3 | Krypteret backup uden for serveren (restic/rclone til Storage Box eller B2). | Høj | S–M | ☐ |
| C4 | Ugentlig automatisk restore-test i en midlertidig `mysql:8.4`. | Høj | M | ☐ |
| C5 | Integrationstestene (30 stk.) i CI med en `mysql:8.4`-service; `docker compose build` og `nginx -t` på football-nginx i CI. | Middel | S–M | ☐ |
| C6 | Tests af `tenant.js` og auth-middleware (tokentype × klub × host) og af football-standings/bracket. | Høj | S | ☐ |
| C7 | Deploy-scriptet: dump før deploy, advarsel hvis kampe er i gang, `/health` bagefter, `docker image prune -f`. | Middel | S | ☐ |
| C8 | Tjek binlog-størrelsen (MySQL 8.4 gemmer 30 dage som standard, og tælleren skriver ved hvert point). | Middel | S | ☐ tjek i prod |
| C9 | `set_real_ip_from` (Cloudflares net) og `real_ip_header CF-Connecting-IP` i nginx, så logs viser rigtige IP'er. | Middel | S | ☐ |
| C10 | Football-build henter flag fra GitHub `main` ved hvert build; lås dem til en commit, eller læg dem i repoet. | Middel | S | ☐ |
| C11 | Oprydning: `script.js` i roden (ubrugt, indeholder `admin123`), `import-data`-script uden fil, ubrugte limiters, `express.static('../frontend')`. | Lav | S | ☐ |
| C12 | Forældet dokumentation: backup-afsnit i README, `docker-compose` v1 og ufw i INSTALL, "Node 18" i planner-README. Driftsvejledning til prod mangler. | Middel | S | ☐ |
| C13 | Fejlbeskeder lækker `err.message` (SQL) i `errorHandler.js` og `/health`. | Lav | S | ☐ |

---

## Pakke D — nye funktioner med brugerværdi

Sorteret efter værdi i forhold til indsats. **Fed** = anbefalet først.

### badmintonapp.dk — tæller, TV og oversigt
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **Ret et resultat efter kampslut** (Fortryd i 30 s, også på rapporterede kampe, og admin-redigering) | Høj | S–M | Frivillige, turneringsleder |
| **Opgivet/skade og W.O. direkte fra tælleren** ("21-15 5-2 opg.") | Høj | S | Turneringer |
| **Robust lagring:** localStorage-spejl, offline-kø, idempotent resultat-id (løser også B1, B8) | Høj | M | Alle |
| "Næste kamp" på TV og tablet ved kampslut ("mød op på bane 3") | Høj | M | Turneringsleder, spillere |
| Mobil live-side for tilskuere/forældre med "følg spiller" | Høj | M | Forældre |
| Lyd/markering i admin, når en bane bliver ledig | Middel | S | Turneringsleder |
| Dommerhjælp: vis kaldet ("11-9, pause") og hvem der server/modtager med navn | Middel | S | Uerfarne frivillige |
| Bane-kø til træningsaftener | Middel–høj | M–L | Klubber |
| Flere kampformater (ét sæt, tidsbegrænset, ungdom) | Middel | S–M | Træning |
| Point-for-point-log og momentum-graf | Middel | M | Spillere |

### badmintonapp.dk — admin og klubber
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **Resultat-eksport** af holdkamp og turnering (CSV/PDF, plus resultatseddel i badmintonplayer.dk's rækkefølge) | Høj | S–M | Holdledere, turneringsledere |
| **Klub-admins opretter selv brugere og roller** (fx "dommerbord") | Høj | M | Klubber, færre henvendelser til Jesper |
| **Onboarding af nye klubber:** tjekliste og printbart ark med QR-koder til alle tablets og TV'er | Høj | M | Nye klubber |
| Import af hele sæsonens holdkampe fra holdets side, med automatisk overvågning | Høj | M | Klubber med mange hold |
| Papirkurv: blød sletning af turneringer, holdkampe og historik i 30 dage | Høj | M | Alle admins |
| Status på enheder: hvilke TV'er og tablets er online nu (`last_used_at` findes) | Middel | S–M | Turneringsleder |
| Offentligt link til live-stilling for en holdkamp eller turnering | Middel | S | Medlemmer, forældre |
| Audit-log over sletning, gendannelse og rettigheder | Middel | S–M | Klubber med flere admins |
| Nulstilling af kodeord via mail (`email`-feltet findes) | Middel | M | Klub-admins |
| Super-admin: overblik pr. klub (aktivitet, migrationsstatus) og "åbn som klub-admin" | Middel | M | Jesper |

### Planner (før Lyngby 21.–22. november: program senest 14. november)
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **Kontrol af TP-indtastning:** genindlæs TP og få en liste over kampe, hvor TP's tid ≠ planens (`tpTid` findes allerede) | Høj | S | Turneringsleder |
| **Fortryd (Ctrl+Z)** på træk, forslag, nedskæring og formskift | Høj | S | Turneringsleder |
| **Advarsel på Liste-fanen** om kategorier, hvor TP's lodtrækning ikke er lavet om, og besked om tabte tider ved genindlæsning | Høj | S | Turneringsleder |
| **Tidsprogram pr. dag til udskrift** (slot → kampe med navne) til opslag og dommerbord | Høj | S | Dommerbord, spillere |
| Tjek mod TP's gitter (tider, slotlængde, baner) | Middel | S | Turneringsleder |
| Flyt kamp direkte til en anden dag, og spillersøgning der finder mulige cupkampe | Middel | S | Turneringsleder |
| Tiderne skrevet direkte ind i .TP (lokalt script på en kopi, efterprøvet ved genindlæsning) | Høj | M–L | Alle, fordi deling går via TP |
| Program pr. klub og pr. spiller (PDF/CSV) | Middel | S–M | Klubber, forældre |
| Omlægning på dagen: "forskyd efter kl. X" og "læg resten om fra nu" | Middel | M | Turneringsleder |
| Kort vejledning og "Prøv med eksempelfil" | Middel | S | Nye brugere |

### footballapp.dk
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **QR-kode og printbar plakat** til den offentlige side | Høj | S | Tilskuere |
| **Dommerindtastning fra mobil** via link med begrænset rettighed pr. bane (som badmintons device-tokens) | Høj | M | Arrangør |
| Kampprogram med tid og bane, flettet så intet hold spiller to i træk | Høj | L | Alle |
| TV/storskærm i klubhuset med rotation, "næste kampe" og "seneste resultater" | Høj | M | Tilskuere |
| "Mit hold": følg et hold med næste kamp og resultater | Høj | M | Forældre |
| Omdøb hold og rediger turnering efter oprettelse; puljer med forskelligt antal hold | Høj | S | Arrangør |
| Direkte links (turnering og faneblad i URL'en) | Middel | S | Tilskuere |
| Bronzekamp og placeringskampe; lodtrækning ved helt lige stilling | Middel | S–M | Arrangør |
| Kladde/offentliggjort og arkivering | Middel | S | Arrangør |
| Live-opdatering med ETag eller SSE i stedet for 3 kald hvert 5. sekund | Middel | S–M | Drift |

### Statistik
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **Afsluttede sæsoner caches længe** (i dag hentes de igen hver dag, op til ca. 300 kald) | Høj (høflighed) | S | badmintonplayer.dk, alle |
| Regeltjek ud fra DH-reglementet: tæller til slutspil (§32), frist 20. oktober, papirhold (§38 stk. 7), reservekarantæne (§44). **Slå reglerne op igen, før de kodes.** Kredsens regler om fastlåsning er ikke gennemgået. | Høj for holdledere | M | Holdledere |
| Spillerprofil på tværs af sæsoner (data ligger i cachen) | Høj | M | Trænere, spillere |
| Sammenligning af sæsoner for klubben | Middel | M | Bestyrelse |
| Excel/PDF-eksport til generalforsamlingen | Middel | S | Bestyrelse |
| Genopfriskning om natten for de mest sete klubber | Middel | S | Alle |

### Salgssider og provebillede.dk
| Funktion | Værdi | Indsats | Hvem |
|---|---|---|---|
| **Prisafsnit** (meta siger "gratis", og teksten siger noget andet) | Høj | S | Klubbestyrelser |
| **Referencer:** Lyngby som case, antal kampe og baner | Høj | S | Nye klubber |
| **Krydshenvisninger** mellem badmintonapp.dk, statistik, planner og footballapp.dk | Middel | S | Alle |
| Kom-i-gang-guide med hardware-tjekliste og FAQ | Høj | M | Frivillige |
| Privatlivspolitik og databehandleraftale-skabelon (ingen findes i dag) | Høj | S–M | Klubber (GDPR) |
| Rigtige `robots.txt` og `sitemap.xml` og 404 i stedet for forsiden (i dag "soft 404") | Middel | S | SEO |
| Provebillede: billedet forsvinder på telefon på langs; korn ligger over PLUGE/døde-pixel-mønstre; pixel-vækkeren blinker 10 Hz | Middel | S | Brugere |
| Provebillede: test af lyd/billede-sync og skarphed (1-px skakbræt), og en PWA der virker offline | Middel | S | AV-folk |

---

## Pakke E — design og UX (tilføjet 14. oktober 2026)

Målet er, at et redesign af produkterne kan laves ét sted. E1–E4 er fundamentet, og resten bliver lettere bagefter.
Kontrasttallene er skønnet ud fra farveværdierne i koden, ikke målt i en browser.

### Fælles fundament
| # | Forslag | Værdi | Indsats | Status |
|---|---|---|---|---|
| E1 | **Fælles designværdier med et tema pr. produkt.** Football og badminton deler allerede Bebas Neue, mørk baggrund, 56 px gitter, radial glød og pilleknapper. Afstande, hjørner, skrifttyper og komponenter kan ligge ét sted, så hvert produkt kun overskriver sine farver. | Høj | M | ☑ design/fundament.css: skrift, afstande (--sp-*), hjørner (--r-*), skygger, gitter, betydningsfarver, tekstniveauer og knapper (aliaser .btn-primary/.btn/.knap). Hentes af badminton, football, statistik og planner; hvert produkt sætter kun sine farver og knapstørrelser. Football bygges nu fra repoets rod |
| E2 | **Én farve pr. betydning.** Der er tre røde (`#e94560`, `#d92c3f`, `#e74c3c`), to grønne (`#45d17e`, `#4CAF50`) og tre gule (`#ffb02e`, `#f0a500`, `#f1c40f`). De hårdkodede følger ikke klubtemaet. Hænger sammen med de ca. 190 hårdkodede farver i `admin-script.js` (Mindre ting). | Høj | M | ☑ tokens i theme-loader (win, danger + danger-text, warning, info + info-text, tekstniveauer); alle hårdkodede røde/grønne/gule i badminton-frontend erstattet; tabte sæt i oversigten neutrale. Football/statistik/planner følger med E1 |
| E3 | **Badminton har to paletter, der næsten er ens:** appen bruger navy `#1a1a2e` med blå `#0f3460` til felter, websiderne `#0d0d1a` med lilla kort. Den blå passer dårligt til den lilla. Saml til én. | Middel | S–M | ☑ Ny standard-feltfarve #252347 (lilla-navy) i stedet for #0f3460; migration 032 flytter klubber, der stadig har den gamle standard. Websidernes baggrund er uændret. |
| E4 | **Én brødtekst-skrift.** Football-appen bruger Outfit, football-siden og hele badminton bruger DM Sans. | Lav | S | ☑ |

### Læsbarhed og kontrast
| # | Forslag | Værdi | Indsats | Status |
|---|---|---|---|---|
| E5 | **For svag tekst.** Etiketter i hvid 30–45 % ("Bane" på banefliserne, "Store skærme til tilskuere", "LIVE" på TV, "Tilbage"-links) ligger omkring 2,5–3:1; kravet er 4,5:1. Admin-sidefoden (`#555` på navy) ca. 2,3:1. Football `--text-dim #5f6a7d` ca. 3,5:1. | Høj | S | ☑ --text-muted (62 % hvid, min. 4,5:1 også på Monokrom-kort) erstatter tekst under 62 % og #555–#aaa; admin-sidefod, banefliser, "Tilbage"-links; football --text-dim #8a95a8. Kun pynt/deaktiveret er svagere |
| E6 | **TV: rød betyder både "tabt sæt" og "serverer",** og vundet/tabt skelnes kun på grøn mod rød, som farveblinde har svært ved. Giv tabt sæt en neutral, mørk tone, og behold rød til serv og aktivitet. | Høj | S | ☑ løst af TV-layout A: tabte sæt neutrale, rød kun til serv |
| E7 | **Oversigt:** inaktive baner står med 40 % gennemsigtighed og er næsten ulæselige på afstand. Brug en tydelig "Ledig"-markering i stedet. | Middel | S | ☑ Den nedtonede "inaktiv"-stil var død CSS (oversigten viser kun aktive baner). Lavet i stedet: aktive baner uden startet kamp viser "Venter på kamp" i stedet for 00:00 og 0–0. |

### Ensartede komponenter i badminton
| # | Forslag | Værdi | Indsats | Status |
|---|---|---|---|---|
| E8 | **Fem knapstilarter → tre** (primær, sekundær, fare). I dag: rød pille (tæller, markedsføring), lilla 8 px (admin), Bebas-gradient (login, super-admin), rød 12 px (statistik, planner), gennemsigtig rød (fare). | Middel | S–M | ☑ styles.css: primær = accent-pille, sekundær = pille med kant, fare = rødtonet pille, + .btn-sm/.btn-lg/.btn-block; sidernes egne knapstile og inline-knapper i admin fjernet. Statistik og planner følger med E1 |
| E9 | **Én login-skabelon** i stedet for tre forskellige (admin, klub-login, super-admin). | Middel | S | ☑ styles.css: .login-wrap/.login-card med ikon, titel, undertitel, .login-felt, pilleknap og .login-tilbage på alle syv login-sider (admin, indstillinger, sponsorer, spillere, tema, klub-login, super-admin); gamle .login-box og club-login-styles.css fjernet |
| E10 | **Ikoner:** admin bruger emoji (⏱️ 📅 👤 🗑 ⚙️), tælleren og football stregikoner. Emoji ser forskellige ud på Windows, Android og TV-boksene og kan ikke farves med temaet. Designsystemet beskriver emoji som et bevidst valg, så det er en beslutning. Forslag: ét sæt stregikoner overalt. | Lav | M | ☑ Stregikoner i tællerens stil (js/ikoner.js) erstatter alle emoji i admin, super-admin, sponsorer, spillere og banevalg. |
| E11 | **Holdkamp-formularerne** er skrevet med indlejret CSS (5 px hjørner, anden feltbaggrund) og ligner ikke resten af admin. | Lav | S | ☑ |

### UX produkt for produkt
| # | Forslag | Værdi | Indsats | Status |
|---|---|---|---|---|
| E12 | **Admin-menuen:** 9 knapper på række, og Indstillinger/Sponsorer viser andre menupunkter end hovedsiden. Del i to grupper med samme menu på alle sider: *Kampe* (Holdkamp, Turnering, Kamphistorik) og *Klub* (Spillere, Sponsorer, Adgangslinks, Planner, Indstillinger). | Middel | S–M | ☑ |
| E13 | **"Ryd Alle Banedata"** står som stor rød boks under baneoversigten, den mest brugte side. Flyt til Indstillinger. | Middel | S | ☑ |
| E14 | **Dansk tekst:** stort begyndelsesbogstav i hvert ord ("Log Ind", "Gem Ændringer", "Ryd Alle Banedata", "Spiller 1 Navn:") føles oversat; brug almindelig dansk skrivemåde. "Turnerings tilstand" skrives i ét ord. | Lav | S | ☑ |
| E15 | **Tælleren:** "Ryd Banen" står blandt de almindelige punkter i indstillingsmenuen. Flyt den nederst med luft over. | Middel | S | ☑ |
| E16 | **Tælleren, første kamp:** før serv er valgt, er +1 grå og der står kun en lille hjælpetekst. Fremhæv "Start serv"-knapperne tydeligere. | Middel | S | ☑ |
| E17 | **TV:** QR-boksen sidder fast nederst til højre og kan dække sidste sætboks ved 3 sæt og lange navne. Giv den fast plads i sidefoden. | Middel | S | ☑ |
| E18 | **Football:** kornfilteret ligger over hele siden og koster ydelse på svage TV-maskiner og projektor-PC'er. Brug det kun på markedsføringssiden. Football har ellers den mest konsekvente komponentbase og er en god model for badminton. | Lav | S | ☑ |
| E19 | **Provebillede:** Barlow Condensed indlæses, men bruges ikke. På mobil forsvinder menuen helt, så der ikke er vej til Anatomi og Historien. (Billedet på telefon på langs står allerede under Salgssider i Pakke D.) | Lav | S | ☑ Menuen står nu på egen linje på mobil. Barlow Condensed bliver: cogj bruger den via provebillede's fonts.css, og en ubrugt skrift hentes ikke af browseren. |

---

## Mindre ting (samlet)

- Admin: `admin-script.js` er vokset til 4.639 linjer med ca. 190 hårdkodede farver. Delingen fra juli er stadig åben.
- Admin: bekræftelsen "Slet turneringen ''" mangler navnet (`admin-script.js:3748,3758`). `court-count` accepterer "abc" via API'et (`settings.js:86`). `DELETE /api/sponsors/all` kan aldrig nås (`sponsors.js:337` før 369).
- Admin: sletning af turnering eller holdkamp giver ikke besked til skærmene. Import er ikke atomar.
- Tælleren: dobbelt genforsøgs-timer i `performSave` (`court-script-v3.js:1630-1641`). Hårdkodede farver i pause, resultattabel og QR-overlay.
- Oversigten poller hvert 2. sekund, også når SSE virker (`oversigt-script.js:9, 1146`).
- `batch/all` har et ubeskyttet `JSON.parse`, så én ødelagt række giver 500 på alle skærme (`gameStates.js:125-129`).
- `match_end_time` rykker sig ved hver PUT efter kampslut (`gameStates.js:450, 500`).
- Adgangstokens i sessionStorage, og PWA'ens `start_url` er landing: en genstartet tablet ender på login.
- Android-appen: blokerende fejldialog ved ethvert ressource-blip (`MainActivity.kt:109`), skærmen slukker efter 10 min. **Forslag:** udfas appen, og brug bogmærke og skærmfastgørelse i Chrome.
- Statistik: `/api/clubs` har ingen grænse, og `throttle()` er ikke en kø. Ingen afbrydelse efter gentagne 500-fejl. CSV-filnavn mister æøå.
- Football: live-siden tegnes forfra hvert 5. sekund (bracket-scroll nulstilles), og en baggrundsopdatering kan overskrive et indtastet, ikke gemt resultat.
- Marketing: billeder caches `immutable` i et år uden versionsnavn. Landingssiden låser zoom. Planneren har `noindex` og intet link fra de andre sites.

---

## Forslag til rækkefølge

1. **Pakke A1–A7** (sikkerhed), med tests. Tjek A10, A11 og C8 på serveren.
2. **C1–C3** (overvågning og backup uden for serveren): lille indsats, stor tryghed.
3. **B1–B5** (tællerens forkerte resultater) og **B9–B12** (backup og holdkamp).
4. **Planner-småting før 14. november:** TP-kontrol, Fortryd, Liste-advarsel, dagsprogram til print, B21.
5. **B16–B20** (football-bracket) før næste stævne.
6. Derefter Pakke D efter hvad klubberne efterspørger. Resultat-eksport, "ret resultat", opgivet/W.O. og
   onboarding-arket giver mest for mindst.
7. **Design (Pakke E):** E1–E2 (fælles designværdier, én farve pr. betydning) før et redesign, derefter E5–E6
   (kontrast og TV-farver), så E8–E9 (knapper og login). Resten tages, når siderne alligevel røres.
