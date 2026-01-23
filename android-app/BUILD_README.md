# Android App - Automatisk Build Guide

Dette repository indeholder automatiske build scripts der installerer alle nødvendige dependencies og compiler Android appen.

## 🚀 Hurtig Start

### Windows PowerShell (Anbefalet)

```powershell
cd android-app
.\build-android-auto.ps1
```

### Windows Command Prompt

```cmd
cd android-app
build-android-auto.bat
```

Det er ALT du behøver! Scriptet klarer resten automatisk.

---

## 📋 Hvad Scriptet Gør

Scriptet udfører automatisk følgende trin:

### 1. ✅ Checker Java Installation
- Søger efter Java 17-23 på systemet
- Hvis ikke fundet: **Downloader og installerer Java 17 automatisk**
- Opsætter `JAVA_HOME` og `PATH` korrekt

### 2. ✅ Checker Android SDK
- Søger efter Android SDK på systemet
- Hvis ikke fundet: **Downloader Android Command Line Tools automatisk**
- Opsætter `ANDROID_HOME` og `ANDROID_SDK_ROOT` korrekt

### 3. ✅ Installerer SDK Komponenter
- Accepterer Android SDK licenser automatisk
- Installerer nødvendige packages:
  - `platform-tools`
  - `platforms;android-35`
  - `build-tools;35.0.0`

### 4. ✅ Compiler Appen
- Kører Gradle build
- Genererer APK fil
- Åbner output folder automatisk ved success

---

## 🎯 Build Parametre

### PowerShell Versionen

```powershell
# Standard debug build
.\build-android-auto.ps1

# Clean build (sletter gamle builds først)
.\build-android-auto.ps1 -Clean

# Release build (signeret APK)
.\build-android-auto.ps1 -Release

# Clean release build
.\build-android-auto.ps1 -Clean -Release
```

### Batch Versionen

Batch versionen bygger altid en debug APK. For release builds, brug PowerShell versionen.

---

## 📦 Output

Efter en vellykket build finder du APK'en her:

**Debug APK:**
```
app/build/outputs/apk/debug/app-debug.apk
```

**Release APK:**
```
app/build/outputs/apk/release/app-release.apk
```

---

## 📱 Installation på Android Enhed

### Metode 1: Manuel Transfer
1. Kopier APK filen til din Android enhed
2. Åbn filen på enheden
3. Tillad installation fra ukendte kilder hvis spurgt
4. Klik "Installer"

### Metode 2: Via ADB (USB)
1. Tilslut din Android enhed via USB
2. Aktiver USB debugging i Developer Options
3. Kør kommando:
   ```cmd
   adb install app\build\outputs\apk\debug\app-debug.apk
   ```

---

## 🔧 Krav

### Før du kører scriptet:

- **Windows 10 eller nyere**
- **PowerShell 5.1+** (indbygget i Windows 10+)
- **Internet forbindelse** (til download af dependencies første gang)
- **Ca. 500 MB ledig diskplads** (til Java og Android SDK)

### Scriptet installerer automatisk:

- ✅ Java 17 JDK (hvis ikke installeret)
- ✅ Android Command Line Tools (hvis ikke installeret)
- ✅ Android SDK Components (platform-tools, build-tools, etc.)

**Du behøver IKKE at installere:**
- ❌ Android Studio
- ❌ Java manuelt
- ❌ Gradle (inkluderet i projektet)

---

## 🛠️ Troubleshooting

### Problem: "Execution of scripts is disabled"

**Løsning:**
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Problem: Scriptet finder ikke Java selvom det er installeret

**Løsning:**
Scriptet installerer sin egen Java kopi i `android-app/java-17/`. Dette påvirker ikke dit systems Java installation.

### Problem: Build fejler med "SDK location not found"

**Løsning:**
Scriptet opretter automatisk `android-sdk/` i android-app folderen. Slet denne folder og kør scriptet igen.

### Problem: Gradle sync fejler

**Løsning:**
```powershell
# Slet gradle cache og prøv igen
.\build-android-auto.ps1 -Clean
```

### Problem: "INSTALL_FAILED_UPDATE_INCOMPATIBLE"

**Løsning:**
Afinstaller den eksisterende app først:
```cmd
adb uninstall com.badminton.courtcounter
```

---

## 📁 Lokale Dependencies (Git Ignored)

Scriptet downloader dependencies til følgende lokale foldere (ignoreres af Git):

```
android-app/
├── java-17/              # Java 17 JDK (auto-downloaded)
├── android-sdk/          # Android SDK (auto-downloaded)
├── .gradle/              # Gradle cache
└── app/build/            # Build output
```

Disse foldere er automatisk excluded fra Git via `.gitignore`.

---

## 🔐 Release Builds

For at lave en signeret release build skal du have et keystore.

### Opret Keystore (Kun én gang)

```cmd
keytool -genkey -v -keystore badminton-release.keystore -alias badminton -keyalg RSA -keysize 2048 -validity 10000
```

### Konfigurer Keystore

Opret `android-app/keystore.properties`:

```properties
storePassword=DIT_KEYSTORE_PASSWORD
keyPassword=DIT_KEY_PASSWORD
keyAlias=badminton
storeFile=../badminton-release.keystore
```

**VIGTIGT:** Tilføj til `.gitignore`:
```
keystore.properties
*.keystore
*.jks
```

### Byg Release APK

```powershell
.\build-android-auto.ps1 -Release
```

---

## 🌐 CI/CD Integration

Scriptet kan bruges i GitHub Actions eller andre CI/CD pipelines:

### GitHub Actions Eksempel

```yaml
name: Build Android APK

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: windows-latest

    steps:
    - uses: actions/checkout@v3

    - name: Build APK
      shell: pwsh
      run: |
        cd android-app
        .\build-android-auto.ps1

    - name: Upload APK
      uses: actions/upload-artifact@v3
      with:
        name: app-debug
        path: android-app/app/build/outputs/apk/debug/app-debug.apk
```

---

## 📞 Support

Hvis du oplever problemer:

1. Læs fejlmeddelelsen omhyggeligt
2. Check Troubleshooting sektionen ovenfor
3. Slet `java-17/` og `android-sdk/` folderne og prøv igen
4. Opret et issue på GitHub med:
   - Fejlmeddelelse
   - Windows version
   - PowerShell version (`$PSVersionTable.PSVersion`)

---

## 📄 Licens

Dette build script er en del af Badminton Court Counter projektet.

---

**Sidste opdatering:** Januar 2025
**Script version:** 1.0.0
**Testet på:** Windows 10, Windows 11
