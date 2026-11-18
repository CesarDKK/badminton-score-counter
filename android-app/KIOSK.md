# Kiosktilstand på tabletten

Kiosktilstand låser tabletten til tælleren. Den er et tilvalg: uden opsætningen
herunder opfører appen sig præcis som før.

Når kiosken er slået til:

- er tælleren tablettens startskærm, så den starter, hver gang tabletten tændes
  (og kommer selv igen, hvis Android lukker den, fx når WebView opdateres)
- er hjem-knap, oversigt over åbne apps, statuslinje og notifikationer spærret
- virker tænd/sluk-menuen stadig (genstart/sluk)
- er der ingen låseskærm (hvis tabletten ikke har pinkode eller mønster)
- kommer man kun ud med **tilbage-knappen → koden**

Ingen MDM, intet abonnement: appen bliver selv tablettens "ejer" (Androids
*device owner*) med én kommando fra en PC. Det er Androids egen kiosk-funktion
(*lock task*).

## Engangsopsætning pr. tablet

Du skal bruge en PC med `adb` (Android SDK Platform-Tools, gratis fra Google)
og et USB-kabel.

1. **Nulstil tabletten** til fabriksindstillinger
   (Indstillinger → System → Nulstil → Slet alle data).
2. Gå opsætningen igennem, men **spring Google-kontoen over** (og Lenovo-ID).
   Android tillader kun ejer-rollen på en tablet uden konti.
   Tilslut WiFi undervejs.
3. Installer tælleren (hent `BadmintonApp.apk` fra badmintonapp.dk) og indtast
   banens adgangslink som normalt.
4. Slå **USB-fejlfinding** til: Indstillinger → Om tabletten → tryk 7 gange på
   *Build-nummer* → tilbage → System → Indstillinger for udviklere →
   USB-fejlfinding.
5. Sæt tabletten til PC'en, godkend PC'en på tabletten, og kør:

   ```
   adb shell dpm set-device-owner com.badminton.courtcounter/com.badminton.courtcounter.KioskAdminReceiver
   ```

   Svaret skal starte med `Success: Device owner set`.
   Kommandoen står også i appen: tilbage-knappen → *Kiosktilstand…*.
6. I appen: tilbage-knappen → **Kiosktilstand…** → vælg en kode (4–8 cifre)
   to gange → **Slå til**.
7. USB-fejlfinding kan slås fra igen bagefter.

### Hvis kommandoen fejler

| Fejl | Løsning |
|---|---|
| `there are already some accounts on the device` | Der er en konto på tabletten (Google, Lenovo, …). Fjern den under Indstillinger → Konti, eller nulstil igen og spring kontoen over. |
| `there are already several users on the device` | Slet ekstra brugere/gæst under Indstillinger → System → Flere brugere. |
| `device owner is already set` | Tabletten har allerede en ejer. Nulstil den. |
| `unauthorized` | Godkend PC'en i dialogen på tabletten. |

## I brug

- **Ud af kiosken / skift link:** tilbage-knappen → tast koden → menu:
  - *Skift link / bane* — rediger adgangslinket (i kiosken kan app-data ikke
    slettes for at indtaste et nyt link)
  - *Slå kiosktilstand fra* — tabletten bliver normal igen, tælleren kører videre
    som almindelig app
- 5 forkerte koder i træk spærrer kodefeltet i 1 minut.
- **Ny version af appen:** slå kiosken fra, installer den nye APK som før, åbn
  appen, og slå kiosken til igen (tilbage → *Kiosktilstand…*). Indstillingerne
  bevares.
- **Giv tabletten helt fri:** slå kiosken fra → tilbage → *Kiosktilstand…* →
  *Giv tabletten fri…*. Så er appen ikke længere ejer, og kiosken kræver
  adb-kommandoen igen.
- **Glemt koden:** nulstil tabletten via knapperne (sluk den, og hold typisk tænd + lydstyrke op
  på Lenovo Tab) og lav opsætningen igen.

Koden gemmes kun på tabletten (saltet SHA-256), ikke på serveren.
