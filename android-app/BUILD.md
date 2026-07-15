# Android App - Build Guide

Sådan compiler du Android appen - helt automatisk!

## 🚀 Hurtig Start (Anbefalet)

### Windows - Simpel Metode

Dobbeltklik på:
```
build-apk.bat
```

ELLER åbn PowerShell og kør:
```powershell
.\build-apk.ps1
```

**Det er det!** Scriptet gør resten:
- ✅ Checker om Java 17 er installeret
- ✅ Downloader Java 17 hvis nødvendigt (ca. 200 MB)
- ✅ Compiler Android APK'en
- ✅ Åbner output folderen når den er færdig

---

## 📦 Output

Din færdige APK finder du her:
```
app/build/outputs/apk/debug/BadmintonApp.apk
```

---

## 📱 Installer på Android

### Metode 1: Manuel installation
1. Kopier `app-debug.apk` til din Android enhed
2. Åbn filen på enheden
3. Tryk "Installer"

### Metode 2: Via USB (ADB)
```cmd
adb install app\build\outputs\apk\debug\BadmintonApp.apk
```

---

## 🔧 Build Parametre

### PowerShell version

```powershell
# Normal debug build
.\build-apk.ps1

# Clean build (sletter gamle filer først)
.\build-apk.ps1 -Clean

# Release build
.\build-apk.ps1 -Release
```

---

## 🛠️ Hvad Installeres?

Første gang scriptet køres downloader det:

- **Java 17 JDK** (~200 MB) - Installeres lokalt i `java-17/` mappen
  - Påvirker IKKE dit systems Java installation
  - Bruges kun til dette projekt

Alt gemmes lokalt i `android-app/` folderen og deles ikke via Git.

---

## 📋 Krav

- **Windows 10 eller nyere**
- **Internet forbindelse** (første gang, til download af Java)
- **Ca. 300 MB ledig plads**

Du behøver IKKE:
- ❌ Android Studio
- ❌ At installere Java manuelt
- ❌ At konfigurere noget

---

## 🔍 Troubleshooting

### "Execution of scripts is disabled"

Kør i PowerShell som Administrator:
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### Build fejler med "Unsupported class file major version 69"

Dit system bruger Java 25 hvilket er for nyt. Scriptet downloader automatisk Java 17.

Hvis problemet fortsætter:
```powershell
# Slet lokal Java og prøv igen
Remove-Item -Recurse -Force java-17
.\build-apk.ps1
```

### "Gradle sync fejler"

Clean build:
```powershell
.\build-apk.ps1 -Clean
```

---

## 📁 Projekt Struktur

```
android-app/
├── build-apk.ps1         ← BRUG DETTE SCRIPT (PowerShell)
├── build-apk.bat         ← ELLER DETTE (Batch)
├── app/
│   └── build/outputs/apk/
│       └── debug/
│           └── BadmintonApp.apk  ← DIN FÆRDIGE APK
├── java-17/              ← Auto-downloaded Java (git ignored)
└── .gradle/              ← Build cache (git ignored)
```

---

## 🎯 For Udviklere

### Hvis du allerede har Java 17-21 installeret

Scriptet finder automatisk dit system Java og bruger det.

### Hvis du vil bruge Android Studio

1. Åbn `android-app/` folderen i Android Studio
2. Klik "Build > Build Bundle(s) / APK(s) > Build APK(s)"

### Manuel Gradle build

```cmd
# Sæt JAVA_HOME til Java 17
set JAVA_HOME=C:\Users\jespe\.local\bin\badminton-app\android-app\java-17\jdk-17.0.17+10
gradlew.bat assembleDebug
```

---

## 📖 Yderligere Dokumentation

- [../ANDROID_BUILD_GUIDE.md](../ANDROID_BUILD_GUIDE.md) - Detaljeret build guide (inkl. CLI/Android Studio)
- [ICON_NOTE.md](ICON_NOTE.md) - Sådan skiftes app-ikonet

---

**Senest opdateret:** Juli 2026
**App Version:** 1.7.2 (versionCode 10)
**Min Android Version:** 7.0 (API 24)
**Target Android Version:** 15 (API 35)
