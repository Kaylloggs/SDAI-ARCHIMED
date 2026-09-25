<#
.SYNOPSIS
  Build complet de SDAI ARCHIMED (.exe portable + installeurs).

.EXAMPLE
  .\build.ps1                    # release, installeur NSIS
  .\build.ps1 -Bundles all       # NSIS + MSI
  .\build.ps1 -Bundles none      # exe seul, plus rapide
  .\build.ps1 -DebugBuild -SkipChecks # build de debug rapide
  .\build.ps1 -Clean             # nettoie avant de compiler
  .\build.ps1 -Bump minor        # 0.2.3 -> 0.3.0 (defaut en release : patch, 0.2.3 -> 0.2.4)
  .\build.ps1 -Bump none         # recompile sans changer de version
  .\build.ps1 -Publish           # + commit, tag vX.Y.Z, push et release GitHub (gh)

  Compatible Windows PowerShell 5.1 et PowerShell 7. Messages en ASCII volontairement.
#>
[CmdletBinding()]
param(
    [switch]$DebugBuild,
    [ValidateSet('nsis', 'msi', 'all', 'none')]
    [string]$Bundles = 'nsis',
    [switch]$SkipInstall,
    [switch]$SkipChecks,
    [switch]$Clean,
    # Increment de version applique avant la compilation (defaut : patch en release, none en debug).
    [ValidateSet('patch', 'minor', 'major', 'none')]
    [string]$Bump,
    [switch]$Publish
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
    # PowerShell 5.1 : sous 'Stop', la moindre ligne ecrite sur stderr par un programme
    # natif (pnpm, git push, gh) devient fatale des que la sortie est redirigee (journal,
    # CI). Seul le code de sortie dit si la commande a echoue.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & $Command } finally { $ErrorActionPreference = $previousPreference }
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

# ---------------------------------------------------------------- 5 bis. Version
$BumpKind = if ($PSBoundParameters.ContainsKey('Bump')) { $Bump } elseif ($DebugBuild) { 'none' } else { 'patch' }
if ($Publish -and $DebugBuild) { Fail '-Publish exige un build release (sans -DebugBuild).' }
if ($BumpKind -ne 'none') {
    Write-Step "Nouvelle version ($BumpKind)"
    $bumpOutput = node (Join-Path $Root 'scripts\bump-version.mjs') $BumpKind
    if ($LASTEXITCODE -ne 0) { Fail 'increment de version' }
    $Version = ($bumpOutput | Select-Object -Last 1).Trim()
    Write-Ok "v$Version (package.json, tauri.conf.json, Cargo.toml, CHANGELOG)"
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
    # Seuls les installeurs de cette version (le dossier bundle garde ceux des builds precedents).
    Get-ChildItem -Path $bundleDir -Recurse -File -Include '*-setup.exe', '*.msi' |
        Where-Object { $_.Name -like "*_$($Version)_*" } | ForEach-Object {
        Copy-Item $_.FullName $outDir -Force
        Write-Ok "$($_.Name) (installeur)"
    }
}

# ---------------------------------------------------------------- 8. Publication GitHub
if ($Publish) {
    Write-Step "Publication de la release v$Version"
    $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
    if (-not $gh -and (Test-Path 'C:\Program Files\GitHub CLI\gh.exe')) { $gh = 'C:\Program Files\GitHub CLI\gh.exe' }
    if (-not $gh) { Fail 'GitHub CLI (gh) introuvable : https://cli.github.com puis gh auth login' }
    if (-not (Test-Command 'git')) { Fail 'git introuvable.' }

    $tag = "v$Version"
    # En CI (GitHub Actions), le tag pousse a declenche le build : rien a committer ni pousser.
    $InCi = $env:GITHUB_ACTIONS -eq 'true'
    if (-not $InCi) {
        Invoke-Native 'git add (version)' { git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock CHANGELOG.md }
        git diff --cached --quiet
        if ($LASTEXITCODE -ne 0) {
            Invoke-Native 'git commit (version)' { git commit -q -m "chore(release): $tag" }
            Write-Ok "commit chore(release): $tag"
        }
        git rev-parse -q --verify "refs/tags/$tag" | Out-Null
        if ($LASTEXITCODE -ne 0) { Invoke-Native 'git tag' { git tag -a $tag -m "SDAI ARCHIMED $tag" } }
        Invoke-Native 'git push' { git push origin HEAD:main }
        Invoke-Native 'git push tag' { git push origin $tag }
        Write-Ok "tag $tag pousse"
    }

    # Notes : section de cette version dans le CHANGELOG.
    $changelog = Get-Content (Join-Path $Root 'CHANGELOG.md') -Raw -Encoding UTF8
    $escaped = [regex]::Escape($Version)
    $match = [regex]::Match($changelog, "(?s)## \[$escaped\][^\n]*\n(.*?)(?=\n## \[|\z)")
    $notes = if ($match.Success) { $match.Groups[1].Value.Trim() } else { "Version $Version" }
    $install = "## Installation`n`n- **Installeur** : SDAI.Archimed_$($Version)_x64-setup.exe`n- **Portable** : SDAI-Archimed.exe (aucune installation)`n`nPrerequis : Windows 10/11 et au moins une CLI d'IA installee et connectee (Claude Code, Antigravity ou Codex). Voir le README."
    $notesFile = Join-Path $outDir 'RELEASE_NOTES.md'
    Set-Content -Path $notesFile -Value "$install`n`n---`n`n$notes" -Encoding utf8

    $assets = Get-ChildItem -Path $outDir -File |
        Where-Object { $_.Name -eq 'SDAI-Archimed.exe' -or $_.Name -like "*_$($Version)_*" } |
        ForEach-Object { $_.FullName }
    # PowerShell 5.1 : une sortie d'erreur native devient fatale sous 'Stop' ; la release absente est un cas normal.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $gh release view $tag 2>&1 | Out-Null
    $releaseExists = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $previousPreference
    if ($releaseExists) {
        Invoke-Native 'gh release upload' { & $gh release upload $tag @assets --clobber }
    } else {
        Invoke-Native 'gh release create' { & $gh release create $tag @assets --title "SDAI ARCHIMED $tag" --notes-file $notesFile }
    }
    Write-Ok "release $tag publiee"
}

$Stopwatch.Stop()
Write-Host "`n[SUCCES] Build termine en $([math]::Round($Stopwatch.Elapsed.TotalMinutes, 1)) min" -ForegroundColor Green
Write-Host "         Artefacts : $outDir`n" -ForegroundColor Green
