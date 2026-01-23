@echo off
REM Simple build script for Android APK
REM This script automatically downloads Java 17 if needed and builds the app

echo ================================================================
echo    Badminton Court Counter - Android Build Script
echo ================================================================
echo.

REM Check if we have the simple PowerShell script
if exist "%~dp0build-android.ps1" (
    echo Using existing Java setup...
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0build-android.ps1"
    goto :end
)

REM Otherwise try to use build-apk.ps1
if exist "%~dp0build-apk.ps1" (
    echo Checking dependencies...
    powershell.exe -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1"
    goto :end
)

REM Fallback to direct Gradle build
echo No build script found, trying direct Gradle build...
if exist "%~dp0java-17\jdk-17.0.17+10\bin\java.exe" (
    set "JAVA_HOME=%~dp0java-17\jdk-17.0.17+10"
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    echo Using Java from: %JAVA_HOME%
    java -version
    echo.
    gradlew.bat assembleDebug
) else (
    echo ERROR: Java 17 not found!
    echo Please run build-apk.ps1 first to download Java.
    exit /b 1
)

:end
pause
