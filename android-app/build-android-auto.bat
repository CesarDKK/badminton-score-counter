@echo off
REM Automatic Android Build Script (Batch Version)
REM This script checks for all required dependencies and installs them if missing
REM Then compiles the Android APK

setlocal enabledelayedexpansion

REM Colors (using ANSI escape codes on Windows 10+)
set "GREEN=[92m"
set "YELLOW=[93m"
set "CYAN=[96m"
set "RED=[91m"
set "NC=[0m"

echo.
echo ================================================================
echo      Badminton Court Counter - Android Build Script
echo ================================================================
echo.

REM ============================================================
REM Step 1: Check Java
REM ============================================================
echo [STEP 1] Checking Java installation...

set "JAVA_FOUND=0"
set "REQUIRED_JAVA_VERSION=17"

REM Check if JAVA_HOME is set and valid
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" (
        "%JAVA_HOME%\bin\java.exe" -version 2>&1 | findstr /C:"version" >nul
        if !errorlevel! equ 0 (
            echo %GREEN%[OK]%NC% Found Java at: %JAVA_HOME%
            set "JAVA_FOUND=1"
        )
    )
)

REM Check common Java installation paths
if !JAVA_FOUND! equ 0 (
    for %%J in (
        "C:\Program Files\Eclipse Adoptium\jdk-17*"
        "C:\Program Files\Eclipse Adoptium\jdk-21*"
        "C:\Program Files\Java\jdk-17*"
        "C:\Program Files\Java\jdk-21*"
        "C:\Program Files\Microsoft\jdk-17*"
    ) do (
        if exist "%%~J\bin\java.exe" (
            set "JAVA_HOME=%%~J"
            echo %GREEN%[OK]%NC% Found Java at: !JAVA_HOME!
            set "JAVA_FOUND=1"
            goto :java_found
        )
    )
)

REM Check local Java directory
if !JAVA_FOUND! equ 0 (
    if exist "%~dp0java-17" (
        set "JAVA_HOME=%~dp0java-17"
        for /d %%D in ("!JAVA_HOME!\jdk-*") do (
            set "JAVA_HOME=%%D"
        )
        echo %GREEN%[OK]%NC% Using local Java at: !JAVA_HOME!
        set "JAVA_FOUND=1"
    )
)

:java_found
if !JAVA_FOUND! equ 0 (
    echo %YELLOW%[WARNING]%NC% Java 17-21 not found!
    echo %CYAN%[INFO]%NC% Downloading Java 17...

    REM Download using PowerShell
    powershell -Command "& {Invoke-WebRequest -Uri 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk' -OutFile '%~dp0java-17.zip' -UseBasicParsing}"

    if exist "%~dp0java-17.zip" (
        echo %CYAN%[INFO]%NC% Extracting Java 17...
        powershell -Command "& {Expand-Archive -Path '%~dp0java-17.zip' -DestinationPath '%~dp0java-17' -Force}"

        REM Find JDK directory
        for /d %%D in ("%~dp0java-17\jdk-*") do (
            set "JAVA_HOME=%%D"
        )

        del "%~dp0java-17.zip"
        echo %GREEN%[OK]%NC% Java 17 installed to: !JAVA_HOME!
    ) else (
        echo %RED%[ERROR]%NC% Failed to download Java!
        echo Please download Java 17 manually from: https://adoptium.net/
        exit /b 1
    )
)

REM Set Java in PATH
set "PATH=%JAVA_HOME%\bin;%PATH%"

echo.
echo Java Configuration:
java -version
echo.

REM ============================================================
REM Step 2: Check Android SDK
REM ============================================================
echo [STEP 2] Checking Android SDK...

set "ANDROID_FOUND=0"

REM Check if ANDROID_HOME is set
if defined ANDROID_HOME (
    if exist "%ANDROID_HOME%\platform-tools" (
        echo %GREEN%[OK]%NC% Found Android SDK at: %ANDROID_HOME%
        set "ANDROID_FOUND=1"
    )
)

REM Check common Android SDK locations
if !ANDROID_FOUND! equ 0 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
        echo %GREEN%[OK]%NC% Found Android SDK at: !ANDROID_HOME!
        set "ANDROID_FOUND=1"
    )
)

REM Check local Android SDK
if !ANDROID_FOUND! equ 0 (
    if exist "%~dp0android-sdk\platform-tools" (
        set "ANDROID_HOME=%~dp0android-sdk"
        echo %GREEN%[OK]%NC% Using local Android SDK at: !ANDROID_HOME!
        set "ANDROID_FOUND=1"
    )
)

if !ANDROID_FOUND! equ 0 (
    echo %YELLOW%[WARNING]%NC% Android SDK not found!
    echo %CYAN%[INFO]%NC% Downloading Android Command Line Tools...

    set "ANDROID_HOME=%~dp0android-sdk"

    REM Download using PowerShell
    powershell -Command "& {Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip' -OutFile '%~dp0cmdline-tools.zip' -UseBasicParsing}"

    if exist "%~dp0cmdline-tools.zip" (
        echo %CYAN%[INFO]%NC% Extracting Android tools...
        mkdir "!ANDROID_HOME!\cmdline-tools" 2>nul
        powershell -Command "& {Expand-Archive -Path '%~dp0cmdline-tools.zip' -DestinationPath '!ANDROID_HOME!\cmdline-tools' -Force}"

        REM Rename to latest
        if exist "!ANDROID_HOME!\cmdline-tools\cmdline-tools" (
            move "!ANDROID_HOME!\cmdline-tools\cmdline-tools" "!ANDROID_HOME!\cmdline-tools\latest" >nul
        )

        del "%~dp0cmdline-tools.zip"
        echo %GREEN%[OK]%NC% Android SDK tools installed
    ) else (
        echo %RED%[ERROR]%NC% Failed to download Android SDK!
        echo Please install Android Studio manually from: https://developer.android.com/studio
        exit /b 1
    )
)

REM Set Android environment variables
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%PATH%"

REM ============================================================
REM Step 3: Install SDK components
REM ============================================================
echo [STEP 3] Installing Android SDK components...

if exist "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" (
    echo %CYAN%[INFO]%NC% Accepting licenses...
    echo y | "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" --licenses >nul 2>&1

    echo %CYAN%[INFO]%NC% Installing SDK packages...
    call "%ANDROID_HOME%\cmdline-tools\latest\bin\sdkmanager.bat" "platform-tools" "platforms;android-35" "build-tools;35.0.0" >nul 2>&1

    echo %GREEN%[OK]%NC% SDK components installed
)

REM ============================================================
REM Step 4: Build the APK
REM ============================================================
echo.
echo [STEP 4] Building Android APK...
echo.

call gradlew.bat assembleDebug

if !errorlevel! equ 0 (
    echo.
    echo ================================================================
    echo                   BUILD SUCCESSFUL!
    echo ================================================================
    echo.
    echo APK Location: app\build\outputs\apk\debug\app-debug.apk
    echo.
    echo Installation Instructions:
    echo   1. Transfer the APK to your Android device
    echo   2. Open the APK file on your device to install
    echo   OR
    echo   Connect your device via USB and run:
    echo     adb install app\build\outputs\apk\debug\app-debug.apk
    echo.

    REM Open folder
    explorer /select,"%~dp0app\build\outputs\apk\debug\app-debug.apk"
) else (
    echo.
    echo ================================================================
    echo                      BUILD FAILED!
    echo ================================================================
    echo.
    echo Check the error messages above for details.
    exit /b 1
)

endlocal
