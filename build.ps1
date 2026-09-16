<#
.SYNOPSIS
  Build complet de SDAI ARCHIMED (.exe portable + installeurs).

.EXAMPLE
  .\build.ps1                    # release, installeur NSIS
  .\build.ps1 -Bundles all       # NSIS + MSI
  .\build.ps1 -Bundles none      # exe seul, plus rapide
  .\build.ps1 -DebugBuild -SkipChecks # build de debug rapide
  .\build.ps1 -Clean             # nettoie avant de compiler

  Compatible Windows PowerShell 5.1 et PowerShell 7. Messages en ASCII volontairement.
#>
[CmdletBinding()]
param(
    [switch]$DebugBuild,
    [ValidateSet('nsis', 'msi', 'all', 'none')]
    [string]$Bundles = 'nsis',
    [switch]$SkipInstall,
    [switch]$SkipChecks,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$TauriDir = Join-Path $Root 'src-tauri'
$BridgeDir = Join-Path $TauriDir 'crates\archimed-bridge'
$Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    [ok] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "    [!] $Message" -ForegroundColor Yellow }
function Fail([string]$Message) {
    Write-Host "`n[ECHEC] $Message" -ForegroundColor Red
    exit 1
}
function Invoke-Native([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { Fail "$What (code $LASTEXITCODE)" }
}
function Test-Command([string]$Name) { return [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

Set-Location $Root

# ---------------------------------------------------------------- 1. Prerequis
Write-Step 'Verification des prerequis'

if (-not (Test-Path (Join-Path $Root 'package.json'))) { Fail 'package.json introuvable : le projet n''est pas encore initialise.' }
if (-not (Test-Path (Join-Path $TauriDir 'tauri.conf.json'))) { Fail 'src-tauri/tauri.conf.json introuvable.' }

foreach ($tool in 'node', 'pnpm', 'cargo', 'rustc') {
    if (-not (Test-Command $tool)) { Fail "'$tool' n'est pas installe ou pas dans le PATH (voir README.md)." }
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node.js >= 20 requis (actuel : $(node -v))." }
Write-Ok "Node $(node -v) / pnpm $(pnpm -v)"

$rustInfo = rustc -vV
$hostLine = $rustInfo | Where-Object { $_ -like 'host:*' }
if (-not $hostLine) { Fail 'Impossible de determiner la cible Rust (rustc -vV).' }
$TargetTriple = $hostLine.Split(':')[1].Trim()
if ($TargetTriple -notlike '*-pc-windows-msvc') { Fail "Toolchain MSVC requise (actuelle : $TargetTriple). Lancez : rustup default stable-msvc" }
Write-Ok "$(($rustInfo | Select-Object -First 1)) [$TargetTriple]"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswhere) {
    $vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vc) { Write-Ok 'MSVC Build Tools detectes' } else { Write-Warn "MSVC Build Tools non detectes (composant C++ requis)." }
} else {
    Write-Warn 'vswhere introuvable : impossible de verifier les MSVC Build Tools.'
}

$tauriConf = Get-Content (Join-Path $TauriDir 'tauri.conf.json') -Raw | ConvertFrom-Json
$Version = $tauriConf.version
if (-not $Version) { $Version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version }
$ProductName = $tauriConf.productName
Write-Ok "$ProductName v$Version"

# ---------------------------------------------------------------- 2. Nettoyage
if ($Clean) {
    Write-Step 'Nettoyage'
    foreach ($dir in 'dist', 'release', 'src-tauri\binaries') {
        $path = Join-Path $Root $dir
        if (Test-Path $path) { Remove-Item $path -Recurse -Force; Write-Ok "supprime : $dir" }
    }
    Invoke-Native 'cargo clean' { cargo clean --manifest-path (Join-Path $TauriDir 'Cargo.toml') }
    Write-Ok 'cargo clean'
}

# ---------------------------------------------------------------- 3. Dependances
if (-not $SkipInstall) {
    Write-Step 'Installation des dependances (pnpm)'
    if (Test-Path (Join-Path $Root 'pnpm-lock.yaml')) {
        Invoke-Native 'pnpm install' { pnpm install --frozen-lockfile }
    } else {
        Write-Warn 'pnpm-lock.yaml absent : installation sans lockfile.'
        Invoke-Native 'pnpm install' { pnpm install }
    }
    Write-Ok 'dependances installees'
}

# ---------------------------------------------------------------- 4. Verifications
if (-not $SkipChecks) {
    Write-Step 'Verifications qualite'
    $scripts = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).scripts
    if ($scripts.PSObject.Properties.Name -contains 'check') {
        Invoke-Native 'pnpm check' { pnpm check }
        Write-Ok 'pnpm check'
    } else {
        Write-Warn 'script "check" absent de package.json : ignore.'
    }
    if ($scripts.PSObject.Properties.Name -contains 'test') {
        $env:CI = 'true'; Invoke-Native 'pnpm test' { pnpm test }
        Write-Ok 'pnpm test'
    }
    Invoke-Native 'cargo clippy' { cargo clippy --manifest-path (Join-Path $TauriDir 'Cargo.toml') --workspace -- -D warnings }
    Write-Ok 'cargo clippy'
}

# ---------------------------------------------------------------- 5. Sidecar MCP
$BuildProfile = if ($DebugBuild) { 'debug' } else { 'release' }
if (Test-Path (Join-Path $BridgeDir 'Cargo.toml')) {
    Write-Step "Compilation du sidecar archimed-bridge ($BuildProfile)"
    $cargoArgs = @('build', '--manifest-path', (Join-Path $BridgeDir 'Cargo.toml'))
    if (-not $DebugBuild) { $cargoArgs += '--release' }
    Invoke-Native 'build archimed-bridge' { cargo @cargoArgs }

    $bridgeExe = Get-ChildItem -Path (Join-Path $TauriDir "target\$BuildProfile") -Filter 'archimed-bridge.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $bridgeExe) { Fail "archimed-bridge.exe introuvable dans src-tauri\target\$BuildProfile" }
    $binDir = Join-Path $TauriDir 'binaries'
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    Copy-Item $bridgeExe.FullName (Join-Path $binDir "archimed-bridge-$TargetTriple.exe") -Force
    Write-Ok "binaries\archimed-bridge-$TargetTriple.exe"
} else {
    Write-Warn 'crate archimed-bridge absente : sidecar ignore.'
}

# ---------------------------------------------------------------- 6. Build Tauri
Write-Step "Build Tauri ($BuildProfile, bundles: $Bundles)"
$tauriArgs = @('tauri', 'build')
if ($DebugBuild) { $tauriArgs += '--debug' }
switch ($Bundles) {
    'none' { $tauriArgs += '--no-bundle' }
    'all' { $tauriArgs += @('--bundles', 'nsis,msi') }
    default { $tauriArgs += @('--bundles', $Bundles) }
}
Invoke-Native 'pnpm tauri build' { pnpm @tauriArgs }

# ---------------------------------------------------------------- 7. Collecte
Write-Step 'Collecte des artefacts'
$targetDir = Join-Path $TauriDir "target\$BuildProfile"
$outDir = Join-Path $Root "release\$Version"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$appExe = Get-ChildItem -Path $targetDir -Filter '*.exe' -File |
    Where-Object { $_.Name -notlike 'archimed-bridge*' -and $_.Name -notlike 'build-script*' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $appExe) { Fail "Executable introuvable dans $targetDir" }
$portableName = 'SDAI-Archimed.exe'
Copy-Item $appExe.FullName (Join-Path $outDir $portableName) -Force
Write-Ok "$portableName (portable, $([math]::Round($appExe.Length / 1MB, 1)) Mo)"

$bridgeBin = Join-Path $TauriDir "binaries\archimed-bridge-$TargetTriple.exe"
if (Test-Path $bridgeBin) {
    Copy-Item $bridgeBin (Join-Path $outDir 'archimed-bridge.exe') -Force
    Write-Ok 'archimed-bridge.exe (a garder a cote de l''exe portable)'
}

$bundleDir = Join-Path $targetDir 'bundle'
if (Test-Path $bundleDir) {
    Get-ChildItem -Path $bundleDir -Recurse -File -Include '*-setup.exe', '*.msi' | ForEach-Object {
        Copy-Item $_.FullName $outDir -Force
        Write-Ok "$($_.Name) (installeur)"
    }
}

$Stopwatch.Stop()
Write-Host "`n[SUCCES] Build termine en $([math]::Round($Stopwatch.Elapsed.TotalMinutes, 1)) min" -ForegroundColor Green
Write-Host "         Artefacts : $outDir`n" -ForegroundColor Green
