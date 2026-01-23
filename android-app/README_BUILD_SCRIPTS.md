# Build Scripts Oversigt

Dette dokument forklarer de forskellige build scripts i projektet.

## ✅ Anbefalede Scripts (Til Git)

Disse filer skal committes til Git:

### 1. `build-apk.ps1` ⭐ **ANBEFALET**
**PowerShell script til automatisk build**

```powershell
.\build-apk.ps1           # Debug build
.\build-apk.ps1 -Clean    # Clean debug build
.\build-apk.ps1 -Release  # Release build
```

**Features:**
- ✅ Finder eller downloader Java 17 automatisk
- ✅ Simpel og hurtig
- ✅ Åbner output folder når færdig
- ✅ Kun ~100 linjer kode

### 2. `build-apk.bat` ⭐ **ANBEFALET**
**Windows Batch wrapper**

Dobbeltklik på filen eller kør:
```cmd
build-apk.bat
```

Kalder automatisk `build-apk.ps1` hvis den findes.

### 3. `BUILD.md` ⭐ **ANBEFALET**
**Brugervenlig build guide**

Enkel guide til brugere der skal clone projektet og bygge appen.

---

## 📝 Andre Scripts (Valgfrie)

### `build-android.ps1`
Simple script der bruger eksisterende Java 17 installation.
Ingen auto-download. Bruges internt af de andre scripts.

### `build-android-auto.ps1`
Avanceret script med fuld auto-installation af:
- Java 17
- Android SDK
- SDK Components

⚠️ **Advarsel:** Kompleks og kan tage lang tid første gang.

### `build-android-auto.bat`
Batch version af ovenstående.

---

## 📁 Filer der skal i Git

```
android-app/
├── build-apk.ps1              ← JA - Primær build script
├── build-apk.bat              ← JA - Batch wrapper
├── BUILD.md                   ← JA - Bruger guide
├── BUILD_INSTRUCTIONS.md      ← JA - Detaljeret guide
├── README.md                  ← JA - App dokumentation
├── .gitignore                 ← JA - Opdateret til at ignorere downloads
├── gradlew.bat                ← JA - Gradle wrapper (allerede i Git)
├── gradle/                    ← JA - Gradle wrapper files
├── app/                       ← JA - App source kode
└── build.gradle               ← JA - Build konfiguration
```

## 🚫 Filer der IKKE skal i Git

Disse filer/foldere ignoreres automatisk via `.gitignore`:

```
android-app/
├── java-17/                   ← NEJ - Auto-downloaded Java
├── android-sdk/               ← NEJ - Auto-downloaded SDK
├── .gradle/                   ← NEJ - Build cache
├── app/build/                 ← NEJ - Compiled output
├── *.apk                      ← NEJ - Compiled APK files
├── *.zip                      ← NEJ - Downloaded archives
├── local.properties           ← NEJ - Lokal konfiguration
└── keystore.properties        ← NEJ - Signing credentials
```

---

## 🎯 Anbefalet Workflow

### For Første Build:

1. Clone repository
2. Åbn terminal i `android-app/` folderen
3. Kør: `.\build-apk.ps1`
4. Vent mens Java downloades og appen bygges
5. APK'en åbnes automatisk i Windows Explorer

### For Efterfølgende Builds:

```powershell
.\build-apk.ps1        # Hurtig rebuild
```

Ingen downloads nødvendige - bruger cached Java.

---

## 📦 Til Distribution

Hvis du vil dele projektet med andre:

1. Commit kun de anbefalede filer
2. Lad være med at committe `java-17/` eller `android-sdk/`
3. Andre brugere kører bare `build-apk.ps1` - det downloader automatisk

---

## 🔄 Migration Guide

Hvis du har de gamle komplekse scripts:

### Før (komplekst):
```powershell
.\build-android-auto.ps1  # Langsomt, komplekst
```

### Efter (simpelt):
```powershell
.\build-apk.ps1           # Hurtigt, simpelt
```

Begge virker, men `build-apk.ps1` er hurtigere og mere pålideligt.

---

## 🆘 Support

Hvis build scriptet fejler:

1. Læs fejlmeddelelsen
2. Check [BUILD.md](BUILD.md) Troubleshooting sektion
3. Prøv clean build: `.\build-apk.ps1 -Clean`
4. Slet `java-17/` og prøv igen

---

**Opdateret:** Januar 2025
**Anbefalet Script:** `build-apk.ps1`
