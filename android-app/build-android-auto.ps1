# Automatic Android Build Script
# This script checks for all required dependencies and installs them if missing
# Then compiles the Android APK

param(
    [switch]$Clean = $false,
    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'

# Color functions
function Write-Success { param($msg) Write-Host $msg -ForegroundColor Green }
function Write-Info { param($msg) Write-Host $msg -ForegroundColor Cyan }
function Write-Warning { param($msg) Write-Host $msg -ForegroundColor Yellow }
function Write-Error { param($msg) Write-Host $msg -ForegroundColor Red }
function Write-Step { param($msg) Write-Host "`n===> $msg" -ForegroundColor Magenta }

# Banner
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "     Badminton Court Counter - Android Build Script            " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Info "Build Type: $(if ($Release) { 'RELEASE' } else { 'DEBUG' })"
Write-Info "Clean Build: $(if ($Clean) { 'YES' } else { 'NO' })"
Write-Host ""

# ============================================================
# Step 1: Check Java
# ============================================================
Write-Step "Checking Java installation..."

$REQUIRED_JAVA_VERSION = 17
$MAX_JAVA_VERSION = 23
$javaHome = $null
$javaFound = $false

# Function to check Java version
function Get-JavaVersion {
    param($javaPath)
    try {
        $versionOutput = & "$javaPath" -version 2>&1 | Select-Object -First 1
        if ($versionOutput -match 'version "(\d+)\.') {
            return [int]$matches[1]
        } elseif ($versionOutput -match 'version "1\.(\d+)') {
            return [int]$matches[1]
        }
    } catch {
        return $null
    }
    return $null
}

# Check common Java locations
$javaLocations = @(
    "$env:JAVA_HOME\bin\java.exe",
    "C:\Program Files\Eclipse Adoptium\jdk-17*\bin\java.exe",
    "C:\Program Files\Eclipse Adoptium\jdk-21*\bin\java.exe",
    "C:\Program Files\Java\jdk-17*\bin\java.exe",
    "C:\Program Files\Java\jdk-21*\bin\java.exe",
    "C:\Program Files\Microsoft\jdk-17*\bin\java.exe",
    "C:\Program Files\Microsoft\jdk-21*\bin\java.exe"
)

foreach ($location in $javaLocations) {
    $paths = Get-ChildItem -Path $location -ErrorAction SilentlyContinue | Sort-Object -Descending
    foreach ($path in $paths) {
        $version = Get-JavaVersion $path.FullName
        if ($version -ge $REQUIRED_JAVA_VERSION -and $version -le $MAX_JAVA_VERSION) {
            $javaHome = Split-Path (Split-Path $path.FullName -Parent) -Parent
            $javaFound = $true
            Write-Success "[OK] Found compatible Java $version at: $javaHome"
            break
        }
    }
    if ($javaFound) { break }
}

# Install Java 17 if not found
if (-not $javaFound) {
    Write-Warning "Java $REQUIRED_JAVA_VERSION-$MAX_JAVA_VERSION not found!"
    Write-Step "Downloading and installing Java 17..."

    $javaInstallDir = "$PSScriptRoot\java-17"
    $javaZipPath = "$PSScriptRoot\java-17.zip"

    if (Test-Path $javaInstallDir) {
        Write-Info "Using existing Java installation at: $javaInstallDir"
        $jdkDir = Get-ChildItem -Path $javaInstallDir -Directory | Select-Object -First 1
        if ($jdkDir) {
            $javaHome = $jdkDir.FullName
        } else {
            $javaHome = $javaInstallDir
        }
    } else {
        $javaDownloadUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
        Write-Info "Downloading Java 17 JDK from Adoptium..."
        Write-Info "This may take a few minutes..."

        try {
            Invoke-WebRequest -Uri $javaDownloadUrl -OutFile $javaZipPath -UseBasicParsing
            Write-Success "[OK] Java 17 downloaded"

            Write-Info "Extracting Java 17..."
            Expand-Archive -Path $javaZipPath -DestinationPath $javaInstallDir -Force

            $jdkDir = Get-ChildItem -Path $javaInstallDir -Directory | Select-Object -First 1
            if ($jdkDir) {
                $javaHome = $jdkDir.FullName
            } else {
                $javaHome = $javaInstallDir
            }

            Remove-Item $javaZipPath -Force -ErrorAction SilentlyContinue
            Write-Success "[OK] Java 17 installed to: $javaHome"
        } catch {
            Write-Error "Failed to download/install Java: $_"
            Write-Info "Please download Java 17 manually from: https://adoptium.net/"
            exit 1
        }
    }
}

# Set JAVA_HOME
$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;$env:PATH"

Write-Info "Java Configuration:"
& java.exe -version
Write-Host ""

# ============================================================
# Step 2: Check Android SDK
# ============================================================
Write-Step "Checking Android SDK..."

$androidHome = $null
$androidSdkLocations = @(
    $env:ANDROID_HOME,
    $env:ANDROID_SDK_ROOT,
    "$env:LOCALAPPDATA\Android\Sdk",
    "$env:USERPROFILE\AppData\Local\Android\Sdk",
    "C:\Android\sdk"
)

foreach ($location in $androidSdkLocations) {
    if ($location -and (Test-Path "$location\platform-tools")) {
        $androidHome = $location
        Write-Success "[OK] Found Android SDK at: $androidHome"
        break
    }
}

# Install Android SDK if not found
if (-not $androidHome) {
    Write-Warning "Android SDK not found!"
    Write-Step "Setting up Android Command Line Tools..."

    $androidHome = "$PSScriptRoot\android-sdk"
    $cmdlineToolsZip = "$PSScriptRoot\cmdline-tools.zip"
    $cmdlineToolsUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"

    if (Test-Path $androidHome) {
        Write-Info "Using existing Android SDK at: $androidHome"
    } else {
        Write-Info "Downloading Android Command Line Tools..."
        Write-Info "This may take a few minutes..."

        try {
            Invoke-WebRequest -Uri $cmdlineToolsUrl -OutFile $cmdlineToolsZip -UseBasicParsing
            Write-Success "[OK] Command line tools downloaded"

            Write-Info "Extracting Android tools..."
            New-Item -Path "$androidHome\cmdline-tools" -ItemType Directory -Force | Out-Null
            Expand-Archive -Path $cmdlineToolsZip -DestinationPath "$androidHome\cmdline-tools" -Force

            $extractedDir = Get-ChildItem -Path "$androidHome\cmdline-tools" -Directory | Where-Object { $_.Name -eq "cmdline-tools" }
            if ($extractedDir) {
                Move-Item -Path $extractedDir.FullName -Destination "$androidHome\cmdline-tools\latest" -Force
            } else {
                if (-not (Test-Path "$androidHome\cmdline-tools\latest")) {
                    New-Item -Path "$androidHome\cmdline-tools\latest" -ItemType Directory -Force | Out-Null
                    Get-ChildItem -Path "$androidHome\cmdline-tools" -File | Move-Item -Destination "$androidHome\cmdline-tools\latest"
                }
            }

            Remove-Item $cmdlineToolsZip -Force -ErrorAction SilentlyContinue
            Write-Success "[OK] Android SDK tools installed"
        } catch {
            Write-Error "Failed to download/install Android SDK: $_"
            Write-Info "Please install Android Studio or SDK manually from: https://developer.android.com/studio"
            exit 1
        }
    }
}

# Set Android environment variables
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
$env:PATH = "$androidHome\cmdline-tools\latest\bin;$androidHome\platform-tools;$androidHome\emulator;$env:PATH"

# ============================================================
# Step 3: Install required SDK components
# ============================================================
Write-Step "Checking Android SDK components..."

$sdkmanager = "$androidHome\cmdline-tools\latest\bin\sdkmanager.bat"

if (Test-Path $sdkmanager) {
    Write-Info "Installing required SDK packages..."

    Write-Info "Accepting Android SDK licenses..."
    "y" | & $sdkmanager --licenses 2>&1 | Out-Null

    $packages = @(
        "platform-tools",
        "platforms;android-35",
        "build-tools;35.0.0",
        "platforms;android-34"
    )

    foreach ($package in $packages) {
        Write-Info "  - Installing $package..."
        & $sdkmanager $package 2>&1 | Out-Null
    }

    Write-Success "[OK] SDK components installed"
} else {
    Write-Warning "sdkmanager not found, skipping SDK component installation"
}

# ============================================================
# Step 4: Clean build if requested
# ============================================================
if ($Clean) {
    Write-Step "Cleaning previous build..."
    if (Test-Path "app\build") {
        Remove-Item -Path "app\build" -Recurse -Force
        Write-Success "[OK] Build directory cleaned"
    }
    if (Test-Path ".gradle") {
        Remove-Item -Path ".gradle" -Recurse -Force
        Write-Success "[OK] Gradle cache cleaned"
    }
}

# ============================================================
# Step 5: Build the APK
# ============================================================
Write-Step "Building Android APK..."

$buildTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
$buildType = if ($Release) { "release" } else { "debug" }

Write-Info "Running: gradlew.bat $buildTask"
Write-Host ""

try {
    & .\gradlew.bat $buildTask
    $buildSuccess = $LASTEXITCODE -eq 0
} catch {
    $buildSuccess = $false
    Write-Error "Build failed with error: $_"
}

# ============================================================
# Step 6: Show results
# ============================================================
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan

if ($buildSuccess) {
    Write-Host "                  BUILD SUCCESSFUL!                           " -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""

    $apkPath = "app\build\outputs\apk\$buildType\app-$buildType.apk"

    if (Test-Path $apkPath) {
        $apkInfo = Get-Item $apkPath
        $apkSizeMB = [math]::Round($apkInfo.Length / 1MB, 2)

        Write-Info "APK Details:"
        Write-Host "  Location: " -NoNewline; Write-Success $apkInfo.FullName
        Write-Host "  Size: " -NoNewline; Write-Success "$apkSizeMB MB"
        Write-Host "  Modified: " -NoNewline; Write-Success $apkInfo.LastWriteTime
        Write-Host ""

        Write-Info "Installation Instructions:"
        Write-Host "  1. Transfer the APK to your Android device"
        Write-Host "  2. Open the APK file on your device to install"
        Write-Host "  OR"
        Write-Host "  Connect your device via USB and run:"
        Write-Success "    adb install `"$($apkInfo.FullName)`""
        Write-Host ""

        Write-Info "Opening output folder..."
        Start-Process explorer.exe -ArgumentList "/select,`"$($apkInfo.FullName)`""
    }
} else {
    Write-Host "                     BUILD FAILED                             " -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Error "Build failed. Check the error messages above."
    exit 1
}
