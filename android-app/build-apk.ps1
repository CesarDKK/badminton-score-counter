# Simple Automatic Android Build Script
# Checks for dependencies and builds the APK

param(
    [switch]$Clean = $false,
    [switch]$Release = $false
)

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "   Badminton Court Counter - Android Build Script              " -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Build Type: $(if ($Release) { 'RELEASE' } else { 'DEBUG' })" -ForegroundColor Yellow
Write-Host ""

# Step 1: Find or download Java 17
Write-Host "[1/4] Checking Java installation..." -ForegroundColor Magenta

$javaHome = $null
$javaPaths = @(
    "$PSScriptRoot\java-17\jdk-*",
    "C:\Program Files\Eclipse Adoptium\jdk-17*",
    "C:\Program Files\Java\jdk-17*"
)

foreach ($path in $javaPaths) {
    $found = Get-ChildItem -Path $path -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) {
        $javaHome = $found.FullName
        Write-Host "  [OK] Found Java at: $javaHome" -ForegroundColor Green
        break
    }
}

if (-not $javaHome) {
    Write-Host "  [INFO] Java 17 not found. Downloading..." -ForegroundColor Yellow

    $javaZip = "$PSScriptRoot\java17.zip"
    $javaDir = "$PSScriptRoot\java-17"

    if (-not (Test-Path $javaDir)) {
        Write-Host "  Downloading Java 17 JDK (this may take a few minutes)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk" `
            -OutFile $javaZip -UseBasicParsing -TimeoutSec 300

        Write-Host "  Extracting..." -ForegroundColor Cyan
        Expand-Archive -Path $javaZip -DestinationPath $javaDir -Force
        Remove-Item $javaZip -Force

        $javaHome = (Get-ChildItem -Path "$javaDir\jdk-*" -Directory | Select-Object -First 1).FullName
        Write-Host "  [OK] Java 17 installed to: $javaHome" -ForegroundColor Green
    } else {
        $javaHome = (Get-ChildItem -Path "$javaDir\jdk-*" -Directory | Select-Object -First 1).FullName
        Write-Host "  [OK] Using existing Java: $javaHome" -ForegroundColor Green
    }
}

$env:JAVA_HOME = $javaHome
$env:PATH = "$javaHome\bin;$env:PATH"

Write-Host ""
java -version
Write-Host ""

# Step 2: Clean if requested
if ($Clean) {
    Write-Host "[2/4] Cleaning build directories..." -ForegroundColor Magenta
    if (Test-Path "app\build") { Remove-Item -Path "app\build" -Recurse -Force }
    if (Test-Path ".gradle") { Remove-Item -Path ".gradle" -Recurse -Force }
    Write-Host "  [OK] Cleaned" -ForegroundColor Green
} else {
    Write-Host "[2/4] Skipping clean (use -Clean to clean build)" -ForegroundColor Magenta
}

# Step 3: Build
Write-Host ""
Write-Host "[3/4] Building Android APK..." -ForegroundColor Magenta
Write-Host ""

$buildTask = if ($Release) { "assembleRelease" } else { "assembleDebug" }
$buildType = if ($Release) { "release" } else { "debug" }

& .\gradlew.bat $buildTask

$buildSuccess = $LASTEXITCODE -eq 0

# Step 4: Show result
Write-Host ""
Write-Host "[4/4] Build Result" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Cyan

if ($buildSuccess) {
    Write-Host "                   BUILD SUCCESSFUL!                          " -ForegroundColor Green
    Write-Host "================================================================" -ForegroundColor Cyan

    $apkPath = "app\build\outputs\apk\$buildType\app-$buildType.apk"
    if (Test-Path $apkPath) {
        $apk = Get-Item $apkPath
        $sizeMB = [math]::Round($apk.Length / 1MB, 2)

        Write-Host ""
        Write-Host "APK File: $($apk.FullName)" -ForegroundColor White
        Write-Host "Size: $sizeMB MB" -ForegroundColor White
        Write-Host ""
        Write-Host "To install on device:" -ForegroundColor Yellow
        Write-Host "  adb install `"$($apk.FullName)`"" -ForegroundColor Cyan
        Write-Host ""

        # Open folder
        Start-Process explorer.exe -ArgumentList "/select,`"$($apk.FullName)`""
    }
} else {
    Write-Host "                      BUILD FAILED                            " -ForegroundColor Red
    Write-Host "================================================================" -ForegroundColor Cyan
    exit 1
}
