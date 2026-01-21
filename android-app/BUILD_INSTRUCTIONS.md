# Hurtig Bygge Guide

## Forudsætninger

1. **Installer Android Studio**
   - Download fra: https://developer.android.com/studio
   - Installer med standard indstillinger

2. **Installer Java JDK 17 eller nyere (PÅKRÆVET)**
   - Download fra: https://adoptium.net/
   - Eller brug den JDK der følger med Android Studio
   - **Vigtigt**: Denne app kræver Java 17+ pga. Gradle 10 og Android Gradle Plugin 8.7+

## Version Information

- **Gradle**: 10.0
- **Android Gradle Plugin**: 8.7.3
- **Kotlin**: 2.0.21
- **Minimum SDK**: 24 (Android 7.0)
- **Target SDK**: 35 (Android 15)
- **Java**: 17 (påkrævet)

## Første Gang Opsætning (Hvis gradlew ikke virker)

Hvis du får en fejl om manglende `gradle-wrapper.jar`, skal du først initialisere Gradle wrapper:

### Windows
```cmd
cd android-app
gradle wrapper --gradle-version 10.0
```

### Linux/Mac
```bash
cd android-app
gradle wrapper --gradle-version 10.0
```

Dette downloader Gradle 10.0 og opretter de nødvendige wrapper filer.

**Alternativ**: Download `gradle-wrapper.jar` manuelt fra:
https://raw.githubusercontent.com/gradle/gradle/v10.0.0/gradle/wrapper/gradle-wrapper.jar

Placer den i: `android-app/gradle/wrapper/gradle-wrapper.jar`

## Byg APK uden Android Studio (Command Line)

### Windows

```cmd
cd android-app
gradlew.bat assembleDebug
```

APK findes i: `app\build\outputs\apk\debug\app-debug.apk`

### Linux/Mac

```bash
cd android-app
./gradlew assembleDebug
```

APK findes i: `app/build/outputs/apk/debug/app-debug.apk`

## Installer APK på Android Enhed

### Metode 1: Via USB

1. Aktiver "Developer Options" og "USB Debugging" på din Android enhed
2. Tilslut enheden til computeren via USB
3. Kør kommando:

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

### Metode 2: Via fil overførsel

1. Kopier `app-debug.apk` til din Android enhed
2. Åbn filen på enheden
3. Tillad installation fra ukendte kilder hvis nødvendigt
4. Klik "Installer"

## Byg Release APK (Signed)

### 1. Opret Keystore

```bash
keytool -genkey -v -keystore badminton-release.keystore -alias badminton -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Opret `keystore.properties` fil i android-app mappen

```properties
storePassword=DIN_KEYSTORE_PASSWORD
keyPassword=DIN_KEY_PASSWORD
keyAlias=badminton
storeFile=badminton-release.keystore
```

### 3. Opdater `app/build.gradle`

Tilføj før `android` blokken:

```gradle
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ... existing config ...

    signingConfigs {
        release {
            if (keystorePropertiesFile.exists()) {
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
            }
        }
    }

    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

### 4. Byg Release APK

```bash
./gradlew assembleRelease
```

APK findes i: `app/build/outputs/apk/release/app-release.apk`

## Almindelige Problemer

### Gradle sync fejl

```bash
./gradlew --stop
./gradlew clean
./gradlew build
```

### ADB ikke fundet

Tilføj Android SDK platform-tools til din PATH:
- Windows: `C:\Users\[USERNAME]\AppData\Local\Android\Sdk\platform-tools`
- Mac/Linux: `~/Library/Android/sdk/platform-tools`

### "Installation blocked" fejl

1. Gå til Indstillinger på Android enheden
2. Søg efter "Installer ukendte apps" eller "Unknown sources"
3. Tillad installation fra den kilde du bruger (f.eks. Filer app)

## Test Appen

1. Åbn appen på Android enheden
2. Tryk på menu (3 prikker) > Indstillinger
3. Indtast server URL (f.eks. `http://192.168.1.100` eller `http://badmintonapp.local`)
4. Indtast bane nummer (f.eks. `1`)
5. Gem og genstart appen

Appen skulle nu vise tæller-siden i fuld skærm.
