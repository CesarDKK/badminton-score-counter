# Salgssidens skærmbilleder

Billederne på badmintonapp.dk (`marketing/*-skifer.jpg`) er taget af den rigtige app med
eksempeldata i det nye Standard-tema (skifer). Kampene spilles til 15.

## Sådan tages de igen

1. Kopiér den kode, der skal fotograferes, ind i den lokale frontend-container under `/_wt/`
   (så billederne viser branchens kode, ikke containerens):

   ```bash
   tar --exclude=downloads --exclude=uploads -cf - frontend design/fundament.css | MSYS_NO_PATHCONV=1 docker exec -i badminton-frontend sh -c 'rm -rf /tmp/w && mkdir /tmp/w && tar -xf - -C /tmp/w && rm -rf /usr/share/nginx/html/_wt && mv /tmp/w/frontend /usr/share/nginx/html/_wt && cp /tmp/w/design/fundament.css /usr/share/nginx/html/_wt/ && rm -rf /tmp/w'
   ```

2. Lav en QR-kode som backendens (hvid på gennemsigtig) til `qr.b64` i denne mappe:

   ```bash
   MSYS_NO_PATHCONV=1 docker exec badminton-backend node -e "require('qrcode').toBuffer('https://badmintonapp.dk',{width:220,margin:2,color:{dark:'#ffffff',light:'#00000000'}}).then(b=>process.stdout.write(b.toString('base64')))" > tools/salgsbilleder/qr.b64
   ```

3. Tag billederne (PNG lander i denne mappe):

   ```bash
   bash tools/salgsbilleder/kor.sh tv-kamp tv-afgjort tv-pausen tv-ledig taeller oversigt-baner oversigt-holdkamp
   ```

4. Lav JPG med **nye filnavne** (nginx cacher salgssidens billeder i et år) og ret `marketing/index.html`:

   ```bash
   MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/tools/salgsbilleder:/s" -v "$PWD/marketing:/m" alpine:3.20 sh -c "apk add -q imagemagick imagemagick-jpeg && magick /s/tv-kamp.png -strip -quality 85 -sampling-factor 4:2:0 /m/tv-kamp-NYT.jpg"
   ```

5. Ryd op: `docker exec badminton-frontend rm -rf /usr/share/nginx/html/_wt` og slet PNG/qr.b64 her.

## Hvordan det virker

- `driver.mjs` styrer Chromium over DevTools. Før sidens egne scripts erstattes `fetch`, så
  API-kaldene (`/game-states/…`, `/team-matches/active-all`, QR-koden, temaet) får eksempeldataene
  fra `shots.mjs`. Intet skrives til den lokale database.
- Alle timere og animationer fryses lige før billedet, så nedtællinger står stille.
- `shots.mjs` beskriver hvert billede: side, størrelse, data og evt. et `efter`-trin
  (fx centrering af ledig-kortet, som ellers glider rundt).
- `marketing` / `marketing-mobil` tager hele salgssiden som ét langt billede til gennemsyn
  (kopiér `marketing/` til `/_wt/mk/` først).
