# WeKeepIt V2 Release & Installer Build Script
# Builds both Portable ZIP and Windows Installer (Setup.exe)
$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Building WeKeepIt v2.0 Release Packages    " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Build .NET Desktop Host
Write-Host "`n[1/5] Compiling .NET Desktop Application..." -ForegroundColor Yellow
dotnet build desktop-app/WeKeepIt.csproj -c Release
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to build desktop-app/WeKeepIt.csproj"
}

# 2. Stage App Files
Write-Host "`n[2/5] Staging Application Files..." -ForegroundColor Yellow
$AppFilesDir = Join-Path $RootDir "package\app-files"
$DistDir = Join-Path $RootDir "dist"

if (Test-Path $AppFilesDir) { Remove-Item $AppFilesDir -Recurse -Force }
New-Item -ItemType Directory -Path $AppFilesDir -Force | Out-Null
if (-not (Test-Path $DistDir)) { New-Item -ItemType Directory -Path $DistDir -Force | Out-Null }

$BinReleaseDir = Join-Path $RootDir "desktop-app\bin\Release\net10.0-windows"

# Copy Desktop Binaries
Copy-Item (Join-Path $BinReleaseDir "*") -Destination $AppFilesDir -Recurse -Force

# Copy Web Assets & Engines
$WebFiles = @(
    "index.html",
    "style.css",
    "app.js",
    "document-engine.js",
    "metadata-engine.js",
    "reminder-service.js",
    "metadata-schema.json",
    "wekeepit-data.sample.json",
    "server.js",
    "package.json"
)

foreach ($f in $WebFiles) {
    Copy-Item (Join-Path $RootDir $f) -Destination (Join-Path $AppFilesDir $f) -Force
}

# Copy Lib, Indexer & Node Modules
Copy-Item (Join-Path $RootDir "lib") -Destination (Join-Path $AppFilesDir "lib") -Recurse -Force
Copy-Item (Join-Path $RootDir "indexer") -Destination (Join-Path $AppFilesDir "indexer") -Recurse -Force
if (Test-Path (Join-Path $RootDir "node_modules")) {
    Copy-Item (Join-Path $RootDir "node_modules") -Destination (Join-Path $AppFilesDir "node_modules") -Recurse -Force
}

# Ensure runtime config exists
$RuntimeConfig = Join-Path $AppFilesDir "WeKeepIt.runtimeconfig.json"
if (-not (Test-Path $RuntimeConfig)) {
    $srcConfig = Join-Path $BinReleaseDir "WeKeepIt.runtimeconfig.json"
    if (Test-Path $srcConfig) {
        Copy-Item $srcConfig $RuntimeConfig -Force
    }
}

# 3. Build Portable Package (with portable.dat)
Write-Host "`n[3/5] Assembling Portable Package..." -ForegroundColor Yellow
$PortableStage = Join-Path $RootDir "package\WeKeepIt-v2.0.0-Portable"
if (Test-Path $PortableStage) { Remove-Item $PortableStage -Recurse -Force }
Copy-Item $AppFilesDir -Destination $PortableStage -Recurse -Force

# Add portable marker and launchers
New-Item -ItemType File -Path (Join-Path $PortableStage "portable.dat") -Force | Out-Null
Copy-Item (Join-Path $RootDir "wekeepit-data.sample.json") (Join-Path $PortableStage "wekeepit-data.json") -Force
Copy-Item (Join-Path $RootDir "launch-desktop.bat") (Join-Path $PortableStage "launch-desktop.bat") -Force
Copy-Item (Join-Path $RootDir "WeKeepIt-Portable.bat") (Join-Path $PortableStage "WeKeepIt-Portable.bat") -Force

$PortableZip = Join-Path $DistDir "WeKeepIt-v2.0.0-Portable.zip"
if (Test-Path $PortableZip) { Remove-Item $PortableZip -Force }
Compress-Archive -Path "$PortableStage\*" -DestinationPath $PortableZip -Force
Write-Host "  -> Portable ZIP created: $PortableZip" -ForegroundColor Green

# 4. Locate Inno Setup Compiler (ISCC)
Write-Host "`n[4/5] Locating Inno Setup Compiler (ISCC)..." -ForegroundColor Yellow
$IsccPath = $null

$CandidatePaths = @(
    "iscc",
    (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
    "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    "C:\Program Files\Inno Setup 6\ISCC.exe"
)

foreach ($c in $CandidatePaths) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        $IsccPath = $c
        break
    }
    if (Test-Path $c) {
        $IsccPath = $c
        break
    }
}

if (-not $IsccPath) {
    Write-Warning "ISCC.exe not found! Please install Inno Setup 6 or run 'winget install JRSoftware.InnoSetup'."
    exit 1
}

Write-Host "  -> Using ISCC: $IsccPath" -ForegroundColor Cyan

# 5. Compile Inno Setup Installer
Write-Host "`n[5/5] Compiling WeKeepIt Installer..." -ForegroundColor Yellow
$IssScript = Join-Path $PSScriptRoot "setup.iss"
& $IsccPath $IssScript
if ($LASTEXITCODE -ne 0) {
    Write-Error "ISCC compilation failed with exit code $LASTEXITCODE"
}

$SetupExe = Join-Path $DistDir "WeKeepIt-v2.0.0-Setup.exe"
if (Test-Path $SetupExe) {
    $size = (Get-Item $SetupExe).Length / 1MB
    Write-Host "`n=============================================" -ForegroundColor Green
    Write-Host " BUILD SUCCESSFUL! " -ForegroundColor Green
    Write-Host " 1. Installer: $SetupExe ($([Math]::Round($size, 2)) MB)" -ForegroundColor Green
    Write-Host " 2. Portable:  $PortableZip" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
} else {
    Write-Error "Expected installer output was not found: $SetupExe"
}
