# How to Build the Android App

This guide will walk you through building the Badminton Score Counter Android app from source.

## Prerequisites

Before you begin, make sure you have the following installed:

### Required Software

1. **Java Development Kit (JDK) 17 or higher**
   - Download from: https://adoptium.net/
   - Verify installation: `java -version`
   - Should show version 17 or higher

2. **Android Studio** (Recommended) OR **Android SDK Command Line Tools**
   - **Option A: Android Studio** (Easiest for beginners)
     - Download from: https://developer.android.com/studio
     - Includes Android SDK, Build Tools, and emulator
   - **Option B: Command Line Tools Only**
     - Download from: https://developer.android.com/studio#command-tools
     - For advanced users who prefer command line

3. **Git** (to clone the repository)
   - Download from: https://git-scm.com/
   - Verify installation: `git --version`

## Method 1: Build with Android Studio (Recommended)

This is the easiest method for most users.

### Step 1: Clone the Repository

Open a terminal and run:

```bash
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter/android-app
```

### Step 2: Open Project in Android Studio

1. Open Android Studio
2. Click **"Open"** (or File → Open)
3. Navigate to the `android-app` folder inside the cloned repository
4. Click **"OK"**
5. Wait for Gradle sync to complete (this may take a few minutes on first run)

### Step 3: Configure Backend URL (Optional)

If you want to connect to a specific backend server:

1. Open `android-app/app/src/main/res/values/strings.xml`
2. Find the line with `backend_url`
3. Change to your backend URL:
   ```xml
   <string name="backend_url">http://your-server-ip:8080</string>
   ```

### Step 4: Build the APK

**Option A: Debug APK (for testing)**

1. In Android Studio, click **Build → Build Bundle(s) / APK(s) → Build APK(s)**
2. Wait for the build to complete
3. Click **"locate"** in the notification that appears
4. The APK will be at: `android-app/app/build/outputs/apk/debug/app-debug.apk`

**Option B: Release APK (for distribution)**

1. Click **Build → Generate Signed Bundle / APK**
2. Select **APK** and click **Next**
3. You'll need a keystore (see "Creating a Keystore" section below)
4. Enter keystore details and click **Next**
5. Select **release** build variant
6. Click **Finish**
7. The APK will be at: `android-app/app/build/outputs/apk/release/app-release.apk`

### Step 5: Install on Device

**Via Android Studio:**
1. Connect your Android device via USB (enable USB debugging in Developer Options)
2. Click the **Run** button (green play icon) in Android Studio
3. Select your device from the list
4. The app will install and launch automatically

**Via ADB (manual installation):**
```bash
adb install android-app/app/build/outputs/apk/debug/app-debug.apk
```

**Via File Transfer:**
1. Copy the APK file to your device
2. Open the APK file on your device
3. Allow installation from unknown sources if prompted
4. Tap **Install**

---

## Method 2: Build via Command Line

This method doesn't require Android Studio.

### Step 1: Install Android SDK Command Line Tools

1. Download from: https://developer.android.com/studio#command-tools
2. Extract to a folder (e.g., `C:\Android\cmdline-tools` on Windows or `~/Android/cmdline-tools` on Mac/Linux)
3. Set up environment variables:

**Windows (PowerShell):**
```powershell
$env:ANDROID_HOME = "C:\Android"
$env:PATH += ";$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools"
```

**Mac/Linux (Bash):**
```bash
export ANDROID_HOME=~/Android
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
```

### Step 2: Install Required SDK Components

```bash
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

Accept the license agreements when prompted.

### Step 3: Clone and Navigate to Project

```bash
git clone https://github.com/CesarDKK/badminton-score-counter.git
cd badminton-score-counter/android-app
```

### Step 4: Build the APK

**Debug APK:**
```bash
# Windows
gradlew.bat assembleDebug

# Mac/Linux
./gradlew assembleDebug
```

**Release APK (requires keystore):**
```bash
# Windows
gradlew.bat assembleRelease

# Mac/Linux
./gradlew assembleRelease
```

Output location:
- Debug: `app/build/outputs/apk/debug/app-debug.apk`
- Release: `app/build/outputs/apk/release/app-release.apk`

### Step 5: Install on Device

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Creating a Keystore (For Release Builds)

A keystore is required to sign release APKs. Create one using:

```bash
keytool -genkey -v -keystore badminton-release.keystore -alias badminton -keyalg RSA -keysize 2048 -validity 10000
```

You'll be prompted to enter:
- Keystore password (remember this!)
- Key password (can be same as keystore password)
- Your name, organization, etc.

**Important:** Keep your keystore file and passwords safe! You'll need them to update the app in the future.

### Configure Gradle for Signing

Create a file `android-app/keystore.properties`:

```properties
storePassword=YOUR_KEYSTORE_PASSWORD
keyPassword=YOUR_KEY_PASSWORD
keyAlias=badminton
storeFile=../badminton-release.keystore
```

**Note:** Never commit `keystore.properties` or your keystore file to git!

---

## Troubleshooting

### "SDK location not found"

Create `android-app/local.properties` with:

```properties
sdk.dir=C:\\Android\\sdk
```

(Replace with your actual Android SDK location)

### "Gradle sync failed"

1. Make sure you have JDK 17 or higher installed
2. Check internet connection (Gradle needs to download dependencies)
3. Try: File → Invalidate Caches → Invalidate and Restart

### "INSTALL_FAILED_UPDATE_INCOMPATIBLE"

Uninstall the existing app first:
```bash
adb uninstall com.badminton.courtcounter
```

Then install again.

### Build fails with "Could not determine java version"

Make sure JDK 17+ is installed and JAVA_HOME is set correctly:

```bash
# Check Java version
java -version

# Set JAVA_HOME (Windows)
set JAVA_HOME=C:\Program Files\Java\jdk-17

# Set JAVA_HOME (Mac/Linux)
export JAVA_HOME=/Library/Java/JavaVirtualMachines/jdk-17.jdk/Contents/Home
```

---

## Build Configuration

The app is currently configured as follows:

- **Package name:** `com.badminton.courtcounter`
- **Min SDK:** 24 (Android 7.0)
- **Target SDK:** 35 (Android 15)
- **Version:** 1.6.2 (versionCode 7)
- **Gradle Plugin:** 9.0.0
- **Kotlin:** 2.0.21

---

## Next Steps

After building the APK:

1. **Install on device** and test
2. **Configure backend URL** in app settings if needed
3. **Report any issues** on GitHub

---

## Additional Resources

- **Android Developer Guide:** https://developer.android.com/guide
- **Gradle Documentation:** https://gradle.org/guides/
- **Project Repository:** https://github.com/CesarDKK/badminton-score-counter

---

## Need Help?

If you encounter issues:

1. Check the troubleshooting section above
2. Open an issue on GitHub: https://github.com/CesarDKK/badminton-score-counter/issues
3. Make sure you're using the latest version of the code

---

**Last Updated:** January 2026
**App Version:** 1.6.2
