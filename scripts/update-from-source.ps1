<#
.SYNOPSIS
  Met a jour une version d'ARCHIMED compilee depuis le code source, en gardant VOS modules
  et vos modifications : la version officielle est fusionnee dans votre copie du code, puis
  tout est recompile et installe (ADR 0013).

.DESCRIPTION
  Lance par ARCHIMED (bouton "Mise a jour", version compilee depuis le code source).
  Utilisable a la main depuis la racine du projet :
    .\scripts\update-from-source.ps1 -Tag v0.8.1

  Etapes : depot officiel ajoute si besoin (remote "archimed-officiel") ; modifications non
  enregistrees sauvegardees dans un commit (apres accord) ; fusion de la version ; conflits de
  numeros de version et de fichiers de verrouillage regles automatiquement
  (scripts/merge-conflicts.mjs) ; tout autre conflit annule la fusion sans rien changer ;
  pnpm install ; .\build.ps1 -Bump none ; fermeture d'ARCHIMED ; installation.
  Vos modules vivent dans leurs propres dossiers (src/modules/<id>/) : la version officielle
  ne les touche pas.

  Messages en ASCII volontairement (Windows PowerShell 5.1).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,
    [string]$Upstream = 'https://github.com/Kaylloggs/SDAI-ARCHIMED.git',
    # ARCHIMED en cours, ferme proprement avant l'installation.
    [int]$AppPid = 0,
    # Executable a remplacer (version portable).
    [string]$Target = '',
    [ValidateSet('installer', 'portable', 'none')]
    [string]$Kind = 'none'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
try { $Host.UI.RawUI.WindowTitle = "ARCHIMED - mise a jour vers $Tag" } catch { }

function Write-Step([string]$Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message) { Write-Host "    [ok] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "    [!] $Message" -ForegroundColor Yellow }
function Stop-Update([string]$Message) {
    Write-Host "`n[ECHEC] $Message" -ForegroundColor Red
    Write-Host "ARCHIMED continue de fonctionner avec la version actuelle."
    Read-Host "`nAppuyez sur Entree pour fermer"
    exit 1
}
# Commande native : seul le code de sortie compte (stderr n'est pas une erreur, cf. build.ps1).
function Invoke-Git([string[]]$Arguments) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & git @Script:Identity @Arguments 2>&1 } finally { $ErrorActionPreference = $previous }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Output = ($output | Out-String).Trim() }
}
function Get-NormalizedUrl([string]$Url) {
    return $Url.Trim().ToLowerInvariant().TrimEnd('/') -replace '\.git$', ''
}

# ---------------------------------------------------------------- 1. Verifications
Write-Step "Mise a jour du code source vers $Tag"
if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { Stop-Update "Version inattendue : $Tag" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Update 'git est introuvable : installez Git for Windows (https://git-scm.com).' }
if (-not (Test-Path (Join-Path $Root '.git'))) { Stop-Update "$Root n'est pas une copie git du projet : recuperez le code avec git clone." }
$Script:Identity = @()
$email = (Invoke-Git @('config', 'user.email')).Output
if (-not $email) { $Script:Identity = @('-c', 'user.name=ARCHIMED', '-c', 'user.email=archimed@localhost') }
if ((Invoke-Git @('rev-parse', '-q', '--verify', 'MERGE_HEAD')).Code -eq 0) {
    Stop-Update 'Une fusion git est deja en cours dans ce dossier : terminez-la (git commit) ou annulez-la (git merge --abort).'
}
Write-Ok $Root

# ---------------------------------------------------------------- 2. Depot officiel
$remote = $null
foreach ($name in (& git remote)) {
    $url = (Invoke-Git @('remote', 'get-url', $name)).Output
    if ($url -and (Get-NormalizedUrl $url) -eq (Get-NormalizedUrl $Upstream)) { $remote = $name; break }
}
if (-not $remote) {
    $remote = 'archimed-officiel'
    $added = Invoke-Git @('remote', 'add', $remote, $Upstream)
    if ($added.Code -ne 0) { Stop-Update "Ajout du depot officiel impossible : $($added.Output)" }
    Write-Ok "depot officiel ajoute (remote $remote)"
}
$fetch = Invoke-Git @('fetch', '--no-tags', $remote, "+refs/tags/$($Tag):refs/tags/$($Tag)")
if ($fetch.Code -ne 0) { Stop-Update "Telechargement de $Tag impossible : $($fetch.Output)" }
Write-Ok "$Tag recupere depuis $remote"

# ---------------------------------------------------------------- 3. Vos modifications
$before = (& git rev-parse HEAD).Trim()
$dirty = & git status --porcelain
if ($dirty) {
    Write-Step 'Modifications non enregistrees dans git'
    $dirty | Select-Object -First 25 | ForEach-Object { Write-Host "    $_" }
    $answer = Read-Host "`nLes enregistrer dans un commit avant la mise a jour ? Rien n'est perdu. [O/n]"
    if ($answer -match '^(n|non|no)$') { Stop-Update 'Mise a jour annulee : rien n''a ete modifie.' }
    $staged = Invoke-Git @('add', '-A')
    if ($staged.Code -ne 0) { Stop-Update "git add : $($staged.Output)" }
    $saved = Invoke-Git @('commit', '-q', '-m', "Mes modifications avant la mise a jour vers $Tag")
    if ($saved.Code -ne 0) { Stop-Update "git commit : $($saved.Output)" }
    Write-Ok 'modifications enregistrees (commit)'
}

# ---------------------------------------------------------------- 4. Fusion
Write-Step "Fusion de $Tag dans votre code"
if ((Invoke-Git @('merge-base', '--is-ancestor', $Tag, 'HEAD')).Code -eq 0) {
    Write-Ok "$Tag est deja dans votre code"
} else {
    $merge = Invoke-Git @('merge', '--no-edit', '-m', "Mise a jour vers $Tag (ARCHIMED)", $Tag)
    if ($merge.Code -ne 0) {
        if ((Invoke-Git @('rev-parse', '-q', '--verify', 'MERGE_HEAD')).Code -ne 0) {
            Stop-Update "Fusion impossible : $($merge.Output)"
        }
        Write-Warn 'conflits : reglage des numeros de version et des fichiers de verrouillage'
        & node (Join-Path $Root 'scripts\merge-conflicts.mjs')
        if ($LASTEXITCODE -ne 0) {
            Invoke-Git @('merge', '--abort') | Out-Null
            Stop-Update ("Vos modifications touchent les memes lignes que la nouvelle version (fichiers ci-dessus). " +
                "La fusion a ete annulee : votre code est intact. Pour la faire vous-meme : git merge $Tag " +
                "(ou demandez a l'IA du module Code de fusionner $Tag), puis .\build.ps1 -Bump none.")
        }
        $done = Invoke-Git @('commit', '--no-edit')
        if ($done.Code -ne 0) { Stop-Update "git commit (fusion) : $($done.Output)" }
    }
    Write-Ok "fusion terminee (pour revenir en arriere : git reset --hard $before)"
}

# ---------------------------------------------------------------- 5. Compilation
Write-Step 'Installation des dependances'
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { & pnpm install } finally { $ErrorActionPreference = $previous }
if ($LASTEXITCODE -ne 0) { Stop-Update 'pnpm install a echoue (messages ci-dessus).' }

Write-Step 'Compilation (plusieurs minutes)'
& (Join-Path $Root 'build.ps1') -Bump none -Bundles nsis
if ($LASTEXITCODE -ne 0) {
    Stop-Update ("La compilation a echoue (messages ci-dessus). Le code est fusionne : corrigez puis relancez " +
        ".\build.ps1 -Bump none, ou revenez en arriere avec git reset --hard $before.")
}
$version = (Get-Content (Join-Path $Root 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$outDir = Join-Path $Root "release\$version"
$setup = Get-ChildItem -Path $outDir -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue | Select-Object -First 1
$portable = Join-Path $outDir 'SDAI-Archimed.exe'

# ---------------------------------------------------------------- 6. Installation
if ($AppPid -gt 0) {
    $app = Get-Process -Id $AppPid -ErrorAction SilentlyContinue
    if ($app) {
        Write-Step "Fermeture d'ARCHIMED"
        [void]$app.CloseMainWindow()
        if (-not $app.WaitForExit(30000)) {
            Read-Host "Fermez ARCHIMED, puis appuyez sur Entree"
        }
        Write-Ok 'ARCHIMED ferme'
    }
}

switch ($Kind) {
    'installer' {
        if (-not $setup) { Stop-Update "Installeur introuvable dans $outDir." }
        Write-Step "Installation de la version $version"
        Start-Process -FilePath $setup.FullName -ArgumentList '/P', '/UPDATE', '/R'
        Write-Ok 'installeur lance : ARCHIMED se rouvrira a la fin'
    }
    'portable' {
        if (-not $Target -or -not (Test-Path $portable)) { Stop-Update "Executable introuvable dans $outDir." }
        Write-Step "Remplacement de $Target"
        $old = "$Target.old"
        Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
        Move-Item -LiteralPath $Target -Destination $old -Force
        try {
            Copy-Item -LiteralPath $portable -Destination $Target -Force
        } catch {
            Move-Item -LiteralPath $old -Destination $Target -Force
            Stop-Update "Remplacement impossible : $($_.Exception.Message). La version portable est dans $outDir."
        }
        Start-Process -FilePath $Target
        Write-Ok 'nouvelle version lancee'
    }
    default {
        Write-Ok "nouvelle version : $outDir"
        Invoke-Item $outDir
    }
}

Write-Host "`n[SUCCES] ARCHIMED $version, avec vos modules." -ForegroundColor Green
Start-Sleep -Seconds 6
