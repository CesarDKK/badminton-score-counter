# Badminton Tæller - Android App

En dedikeret Android app der viser badminton tæller-siden i fuld skærm uden mulighed for browser navigation.

## Features

- ✅ Fuld skærm visning af tæller-siden
- ✅ Blokerer navigation til andre sider (landing, admin, osv.)
- ✅ Tilpasselig server URL og bane nummer
- ✅ Ingen browser kontroller (tilbage-knap, adresselinje, osv.)
- ✅ Optimeret til tablets i landscape mode

## Krav

- Android Studio Ladybug (2024.2.1) eller nyere
- Java JDK 17 eller nyere (påkrævet for Gradle 10)
- Gradle 10.0
- Android Gradle Plugin 8.7.3
- Kotlin 2.0.21
- Android SDK 24 (Android 7.0) minimum
- Android SDK 35 (Android 15) target

## Bygning af App

### 1. Åbn projektet i Android Studio

```bash
cd android-app
```

Åbn mappen i Android Studio via `File > Open`

### 2. Sync Gradle

Når projektet åbnes, klik på "Sync Now" i toppen af skærmen for at downloade alle dependencies.

### 3. Byg APK

Vælg en af følgende metoder:

#### Debug APK (til test)
```
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

APK findes i: `app/build/outputs/apk/debug/app-debug.apk`

#### Release APK (til produktion)
```
Build > Generate Signed Bundle / APK > APK
```

Følg vejledningen for at oprette en keystore og signere APK'en.

### 4. Installer på enhed

#### Via USB
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

#### Via Android Studio
- Tilslut din Android enhed eller start en emulator
- Klik på "Run" knappen (grøn play-knap)

## Konfiguration

### Første gang appen startes

1. Tryk på de 3 prikker i øverste højre hjørne
2. Vælg "Indstillinger"
3. Indtast:
   - **Server URL**: `http://badmintonapp.local` (eller din servers IP adresse)
   - **Bane Nummer**: `1` (eller det bane nummer du vil bruge)
4. Tryk "Gem Indstillinger"
5. Genstart appen

### Standard indstillinger

- Server URL: `http://badmintonapp.local`
- Bane Nummer: `1`

## Brug af Appen

### Normal brug
- Appen viser tæller-siden i fuld skærm
- Alle tæller-funktioner virker normalt (point, timer, navne, osv.)
- Navigation til andre sider er blokeret

### Vise menu
- Tryk på "Tilbage" knappen på enheden
- Menuen vises øverst med mulighed for:
  - **Genindlæs**: Opdater siden
  - **Indstillinger**: Skift server URL eller bane nummer

### Skjule menu igen
- Tryk på skærmen eller vent nogle sekunder

## App Sikkerhed

Appen blokerer navigation til:
- Landing page (`landing.html`)
- Admin panel (`admin.html`)
- Player info (`player-info.html`)
- Settings (`settings.html`)

Kun tæller-siden og relaterede ressourcer (CSS, JavaScript, API) er tilladt.

## Fejlfinding

### Appen kan ikke forbinde til serveren

1. Tjek at server URL er korrekt i indstillinger
2. Tjek at enheden er på samme netværk som serveren
3. Prøv at bruge serverens IP adresse i stedet for `badmintonapp.local`

### Siden vises ikke korrekt

1. Tryk på "Genindlæs" i menuen
2. Tjek internet forbindelse
3. Tjek at badminton serveren kører

### WebView viser blank side

1. Gå til indstillinger og verificer server URL
2. Åbn server URL'en i en browser på samme enhed for at teste forbindelse
3. Tjek Android logs: `adb logcat | grep BadmintonCourtCounter`

## Udvikling

### Struktur

```
android-app/
├── app/
│   ├── src/
│   │   └── main/
│   │       ├── java/com/badminton/courtcounter/
│   │       │   ├── MainActivity.kt        # Hoved activity med WebView
│   │       │   └── SettingsActivity.kt    # Indstillinger activity
│   │       ├── res/
│   │       │   ├── layout/               # UI layouts
│   │       │   ├── values/               # Strings, colors, styles
│   │       │   ├── drawable/             # Knap og input baggrunde
│   │       │   └── menu/                 # App menu
│   │       └── AndroidManifest.xml       # App konfiguration
│   ├── build.gradle                      # App dependencies
│   └── proguard-rules.pro               # ProGuard regler
├── build.gradle                          # Project konfiguration
├── settings.gradle                       # Module konfiguration
└── README.md                            # Denne fil
```

### Tilpas App

#### Skift app navn
Rediger `app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">Dit App Navn</string>
```

#### Skift farver
Rediger `app/src/main/res/values/colors.xml`

#### Skift standard server URL
Rediger `MainActivity.kt`:
```kotlin
private const val DEFAULT_SERVER_URL = "http://din-server-url"
```

#### Tilføj app ikon
Erstat ikonerne i `app/src/main/res/mipmap-*dpi/` mapperne

## License

Dette projekt er en del af Badminton Score Counter systemet.

## Support

For problemer eller spørgsmål, kontakt udvikleren eller opret et issue på GitHub.
