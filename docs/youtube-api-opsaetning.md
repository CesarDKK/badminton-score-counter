# YouTube API — opsætning hos Google

Mål: når en bane begynder at sende, opretter serveren selv en ny udsendelse på
klubbens YouTube-kanal. Ingen skal ind i YouTube Studio før hver kamp.

Det kræver, at Badmintonapp har sit eget "Google Cloud-projekt" med en
login-klient (OAuth), som klubberne giver adgang til deres kanal gennem. Det
sættes op én gang for hele Badmintonapp — ikke pr. klub.

Trin 1–7 kan gøres med det samme. Trin 8–10 (Googles godkendelse) tager typisk
et par uger og er det, der gør løsningen autonom: indtil appen er i produktion,
udløber klubbens adgang efter 7 dage.

---

## 0. Hvilken Google-konto?

Brug en Google-konto, der tilhører Badmintonapp (fx en konto på
jesper@provebillede.dk eller en ny badmintonapp-konto) — ikke en klubs konto.
Projektet og login-klienten ejes af den konto. Tilføj gerne en ekstra ejer
under *IAM & Admin → IAM*, så projektet ikke hænger på én person.

## 1. Opret projektet

1. Gå til <https://console.cloud.google.com/>.
2. Projektvælgeren øverst → **New project**.
3. Navn: `Badmintonapp`. Organisation: ingen. → **Create**.

## 2. Slå YouTube-API'et til

1. Menu → **APIs & Services → Library**.
2. Søg efter **YouTube Data API v3** → **Enable**.

Kvoten er 10.000 enheder om dagen. At oprette og koble en udsendelse koster
1 enhed pr. kald, så det rækker langt — også med mange klubber.

## 3. Login-skærmen (Google Auth Platform)

Menu → **Google Auth Platform** (hed før "OAuth consent screen") → **Get started**:

| Felt | Værdi |
|---|---|
| App name | `Badmintonapp` |
| User support email | din e-mail |
| Audience | **External** |
| Contact information | din e-mail |

## 4. Branding

Under **Branding**:

| Felt | Værdi |
|---|---|
| Application home page | `https://badmintonapp.dk` |
| Application privacy policy link | `https://badmintonapp.dk/privatliv.html` *(siden laver jeg, når funktionen bygges — se trin 8)* |
| Authorized domains | `badmintonapp.dk` |
| App logo | spring over indtil videre (et logo kræver også Googles godkendelse) |

## 5. Adgangen (Data access)

Under **Data access → Add or remove scopes** tilføjes:

```
https://www.googleapis.com/auth/youtube
```

("Manage your YouTube account".) Den skal til for at oprette udsendelser og
stream-nøgler. Det er et *følsomt* scope — derfor Googles godkendelse i trin 9.

## 6. Login-klienten (Clients)

Under **Clients → Create client**:

| Felt | Værdi |
|---|---|
| Application type | **Web application** |
| Name | `Badmintonapp server` |
| Authorized redirect URIs | `https://badmintonapp.dk/youtube/callback` |

Én fælles adresse for alle klubber (Google tillader ikke `*.badmintonapp.dk`).
Serveren sender klubbens admin tilbage til klubbens eget subdomæne bagefter.

Efter **Create** vises **Client ID** og **Client secret**. De skal i prod-`.env`:

```
YOUTUBE_CLIENT_ID=...
YOUTUBE_CLIENT_SECRET=...
```

Secret'en må **ikke** sendes i chatten eller lægges i repoet — kun i prod-`.env`
(som de andre secrets).

## 7. Test-brugere (Audience)

Under **Audience** står appen som **Testing**. Tilføj under **Test users** den
Google-konto, der ejer klubbens YouTube-kanal (fx Lyngbys). Så kan vi prøve det
af, før Google har godkendt appen.

Bemærk: i test-tilstand udløber adgangen **7 dage** efter, at klubben har trykket
"Forbind YouTube-kanal". Det er fint til at prøve det af, men ikke til drift.

---

## 8. Domænet og privatlivspolitikken

Googles godkendelse kræver:

- **Domænet bekræftet** i Google Search Console: <https://search.google.com/search-console>
  → *Add property* → *Domain* → `badmintonapp.dk` → Google giver en TXT-post,
  der lægges i DNS hos Cloudflare. (Er det allerede gjort for sitemap'en, er
  det klaret — det skal være samme Google-konto som projektets ejer, eller
  ejeren skal tilføjes i Search Console.)
- **En privatlivspolitik** på `https://badmintonapp.dk/privatliv.html`, der siger,
  hvad vi gør med YouTube-adgangen: opretter udsendelser og stream-nøgler på
  klubbens kanal, gemmer adgangen krypteret, læser ikke andet, og at klubben
  kan fjerne adgangen i admin og på <https://myaccount.google.com/permissions>.
  Udkastet skriver jeg sammen med funktionen.

## 9. Sæt appen i produktion og send den til godkendelse

1. **Audience → Publish app** (status: *In production*). Fra nu af udløber
   adgangen ikke efter 7 dage. Indtil Google har godkendt appen, ser klubben en
   advarsel ("Google hasn't verified this app") ved login, og der er højst 100
   brugere i alt — rigeligt til at starte.
2. **Verification Center → Submit for verification**. Google beder om:
   - **Begrundelse for scopet** — forslag:
     > Badmintonapp is a scoreboard system for badminton clubs. A camera at
     > each court streams matches to the club's own YouTube channel. The app
     > uses the youtube scope to create a live broadcast and stream key on the
     > club's channel when a match starts, so the club does not have to prepare
     > each broadcast manually in YouTube Studio. It does not read or change
     > any other data on the channel.
   - **En demo-video** (kan ligge som "ikke opført" på YouTube), der viser
     login-flowet med Googles skærm på engelsk og en udsendelse, der oprettes.
     Den optager vi, når funktionen er bygget.
3. Google svarer typisk inden for et par uger og stiller tit opfølgende
   spørgsmål pr. e-mail.

## 10. Hvis udsendelserne bliver tvunget til "Privat"

Google tvinger videoer, der *uploades* fra et ikke-revideret API-projekt, til
"Privat", indtil projektet har bestået YouTubes compliance-audit. Det er ikke
dokumenteret, om det også gælder live-udsendelser. Viser det sig ved første
test, søges auditten her:
<https://support.google.com/youtube/contact/yt_api_form> (*YouTube API Services
— Audit and Quota Extension Form*).

---

## Det, jeg bygger bagefter (besluttet 2026-10-29)

- **Admin → Livestream → "Forbind YouTube-kanal"** (én kanal pr. klub). Adgangen
  gemmes krypteret pr. klub og kan fjernes igen.
- **Stream-nøglerne oprettes automatisk** pr. bane, når kanalen er forbundet. En
  indsat nøgle (som i dag) bruges stadig som reserve, hvis kanalen ikke er forbundet.
- **En ny udsendelse oprettes**, når banen skal sende — én pr. holdkamp, pr.
  "Send hele dagen" og pr. kamp startet på tabletten. Titel fx
  "Bane 3: Lyngby 2 – Gentofte 2". Den går live af sig selv, når billedet kommer,
  og afsluttes af sig selv, når PC'en stopper.
- **Standarder:** offentlig, **lavet til børn** (chat og kommentarer fra). Begge
  kan ændres pr. klub i admin.
- Kun serveren ændres — TV-PC'erne sender som i dag, så der kræves ingen ny
  TV-USB-release.
