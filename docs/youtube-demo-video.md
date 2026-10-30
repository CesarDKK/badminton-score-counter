# Demo-video til Googles godkendelse

Google vil se en video af, hvordan BadmintonApp.dk bruger adgangen
`https://www.googleapis.com/auth/youtube`, før appen kan godkendes. Videoen
indsættes som YouTube-link under **Google Auth Platform → Data Access →
Demo video** (sammen med teksten under "How will the scopes be used?").

Varighed: 2–4 minutter. Ingen lyd er nødvendig, men korte engelske tekster
eller engelsk speak gør det lettere for Google at følge med.

## Det, Google kigger efter

Afvisninger skyldes næsten altid et af de her punkter. Videoen skal vise:

1. **Adresselinjen med `client_id=…`** på Googles login- og samtykkeside, så
   Google kan se, at det er projektets OAuth-klient. Hold den synlig et par
   sekunder, eller zoom ind på den.
2. **Samtykkesiden med appens navn** ("BadmintonApp.dk") og adgangen
   ("Manage your YouTube account"), på engelsk.
3. **Hvad appen gør med adgangen**: kanalen forbindes, en udsendelse oprettes
   og går live, og den afsluttes igen.
4. **At adgangen kan fjernes** igen.

Projektet har kun én OAuth-klient ("Badmintonapp server"), så det er den
eneste, der skal med.

## Forberedelse

- **Google-kontoen**, der optages med, skal eje en YouTube-kanal med
  livestreaming slået til (YouTube Studio → Gå live; første gang tager det op
  til 24 timer). Det kan være kanalen, du allerede har testet med.
- **Engelsk hos Google**: sæt kontoens sprog til English på
  myaccount.google.com → Personal info → General preferences for the web →
  Language. Så er login- og samtykkesiderne på engelsk. Sæt det tilbage
  bagefter.
- **Kanalen skal være koblet fra**, så hele forbindelsen kan optages: Admin →
  Livestream → **Fjern forbindelsen**. (Samtykkesiden vises altid igen, så
  det er nok.)
- **En bane, der kan sende**: TV-PC'en tændt med kamera valgt til banen i
  admin, og ingen igangværende udsendelse.
- **Browseren**: et rent vindue i fuld skærm (F11 er fint), zoom 100–125 %,
  bogmærkelinjen skjult, ingen private faner. Log ind i klubbens admin på
  forhånd, og hav **YouTube Studio → Indhold → Live** åben i en anden fane.
- **Optageren**: Windows' **Klippeværktøj** → Optag (Win+Shift+R) → vælg hele
  skærmen. Slå notifikationer fra (Fokus) under optagelsen.

## Manuskript

Teksterne i kursiv er forslag til engelske undertekster eller speak.

1. **Forsiden** (10 s). Åbn `https://badmintonapp.dk`, rul ned til
   *Livestream på YouTube*, og vis linket til privatlivspolitikken nederst.
   *"BadmintonApp.dk is a scoreboard and livestream service for badminton
   clubs. Clubs can stream their courts live to their own YouTube channel."*

2. **Klubbens admin** (10 s). Vis admin → **Livestream** med banerne og
   knappen **Forbind YouTube-kanal**.
   *"A club admin connects the club's own YouTube channel once."*

3. **Forbind kanalen** (30–40 s). Tryk **Forbind YouTube-kanal**.
   - Vælg Google-kontoen. **Stop op og vis adresselinjen** med
     `accounts.google.com/…client_id=…apps.googleusercontent.com…`.
   - Har kontoen flere kanaler, vælg kanalen.
   - Vis samtykkesiden: appens navn og "Manage your YouTube account". Tryk
     **Continue / Allow**.
   *"The app requests the YouTube scope to create live streams and
   broadcasts on the club's channel."*

4. **Forbundet** (10 s). Tilbage i admin: vis, at kanalens navn står som
   forbundet.
   *"The channel name and id are read so the admin can see which channel is
   connected."*

5. **Gå live** (40–60 s). Tryk **Send hele dagen** på banen. Vent, til banen
   viser, at den sender. Skift til YouTube Studio, genindlæs, og vis den nye
   udsendelse (banen og datoen står i titlen) — og at den går live.
   *"When a court starts streaming, the app creates a broadcast, binds it to
   the court's stream and starts it. Holdkamp (team match) broadcasts start
   automatically."*

6. **Stop** (20 s). Tilbage i admin: tryk **Stop** på banen. Vis i YouTube
   Studio, at udsendelsen er afsluttet.
   *"When the court stops, the app ends the broadcast."*

7. **Fjern adgangen** (15 s). Admin → Livestream → **Fjern forbindelsen** →
   bekræft. Vis, at admin igen viser **Forbind YouTube-kanal**.
   *"The club can disconnect at any time. The token is revoked at Google and
   deleted."*

8. **Afslut** (5 s). Vis evt. myaccount.google.com/permissions, hvor
   BadmintonApp.dk ikke længere står.
   *"The app never reads or changes other videos, comments, playlists or
   subscriptions."*

Udsendelsen fra trin 5 bliver liggende på kanalen; slet den bagefter i
YouTube Studio, hvis den ikke skal være der.

## Undertekster

Det letteste er at lægge teksterne ind som undertekster på YouTube efter
upload (YouTube Studio → videoen → Undertekster → Tilføj → Skriv manuelt) i
stedet for at redigere videoen. Klipp eventuelle ventetider ud med
Clipchamp (følger med Windows), hvis videoen bliver for lang.

## Upload og indsendelse

1. Upload videoen til YouTube som **Ikke offentlig** (Unlisted) — ikke
   Privat, for så kan Google ikke se den.
2. Se den igennem: kan `client_id` i adresselinjen læses i 1080p?
3. Indsæt linket under **Data Access → Demo video**, gem, og send
   godkendelsen fra **Verification Center**.
4. Svaret kommer til udviklerkontakten (info@badmintonapp.dk). Google
   stiller ofte et opfølgende spørgsmål; svar på mailen i samme tråd.

Se også [youtube-api-opsaetning.md](youtube-api-opsaetning.md).
