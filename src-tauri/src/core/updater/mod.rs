//! Mises à jour d'ARCHIMED depuis les releases GitHub du dépôt (ADR 0013).
//!
//! - **Vérifier** : dernière release publiée (ni brouillon ni préversion) du dépôt déclaré dans
//!   `Cargo.toml` (`repository`), comparée à la version de l'exécutable.
//! - **Installer**, seulement quand la personne le demande : la release est relue ici (aucune
//!   adresse n'arrive de l'interface), le fichier qui correspond à l'installation (installeur NSIS
//!   ou exécutable portable) est téléchargé, puis comparé à l'empreinte SHA-256 que GitHub publie
//!   pour lui. Installeur : lancé en mode passif (`/P /UPDATE /R`), il remplace l'application et la
//!   rouvre. Portable : l'exécutable en cours est renommé en `.old` (Windows le permet), le nouveau
//!   prend sa place et est lancé. Dans les deux cas l'application se ferme ensuite.
//! - **Version compilée depuis le code source** (`ARCHIMED_BUILD=source`, peut contenir les
//!   modules de la personne) : le fichier officiel les ferait disparaître. La mise à jour
//!   fusionne alors la version officielle dans le code de la personne et recompile
//!   (`scripts/update-from-source.ps1`, dans une fenêtre PowerShell visible). Installer le
//!   fichier officiel reste possible, sur confirmation explicite seulement.
//! - Build de développement (`pnpm tauri dev`) : rien n'est vérifié ni installé.

mod local;

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use ts_rs::TS;

use super::error::AppErrorCode;
use super::paths::Paths;
use super::{AppError, AppResult};

const REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");
/// `official` (release publiée) ou `source` (compilée par la personne) : build.rs.
const BUILD: &str = env!("ARCHIMED_BUILD");
const SOURCE_DIR: &str = env!("ARCHIMED_SOURCE_DIR");
/// Modules compilés dans cet exécutable (`src/modules/<id>/`).
const MODULES: &str = env!("ARCHIMED_MODULES");
/// Script de mise à jour d'une version compilée depuis le code source.
const SOURCE_SCRIPT: &str = "scripts/update-from-source.ps1";
const CURRENT: &str = env!("CARGO_PKG_VERSION");
/// Nom de l'exécutable portable publié dans chaque release (build.ps1).
const PORTABLE_ASSET: &str = "SDAI-Archimed.exe";
/// Au-delà, le fichier est refusé : ARCHIMED pèse quelques dizaines de Mo.
const MAX_ASSET_BYTES: u64 = 400 * 1024 * 1024;

/// Comment cette copie d'ARCHIMED a été installée : décide du fichier à télécharger.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub enum InstallKind {
    /// Installeur NSIS (un `uninstall.exe` accompagne l'exécutable).
    Installer,
    /// Exécutable seul, lancé d'où il a été copié.
    Portable,
    /// Build de développement : pas de mise à jour.
    Dev,
}

/// Version plus récente que celle en cours.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct AvailableUpdate {
    pub version: String,
    pub title: String,
    /// Notes de la release (Markdown).
    pub notes: String,
    /// Page de la release sur GitHub.
    pub url: String,
    pub published_at: Option<String>,
    /// Fichier qui sera téléchargé pour cette installation.
    pub asset: String,
    #[ts(type = "number")]
    pub size: u64,
}

/// Version compilée depuis le code source : de quoi la mettre à jour sans perdre ses modules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct SourceBuild {
    /// Dossier du code compilé.
    pub dir: String,
    /// Le dossier et son script de mise à jour existent toujours.
    pub ready: bool,
    /// Modules de cette version absents de la version officielle proposée (`None` : inconnu).
    pub custom_modules: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct UpdateStatus {
    pub current: String,
    pub kind: InstallKind,
    /// Compilée depuis le code source (et non publiée) : mise à jour par recompilation.
    pub source: Option<SourceBuild>,
    /// `None` : ARCHIMED est à jour (ou build de développement).
    pub available: Option<AvailableUpdate>,
    /// Page des releases, pour télécharger à la main.
    pub releases_url: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub enum UpdateEvent {
    Downloading {
        #[ts(type = "number")]
        received: u64,
        #[ts(type = "number")]
        total: u64,
    },
    Verifying,
    /// Fichier vérifié : l'installation démarre et ARCHIMED va se fermer.
    Installing,
}

#[derive(Debug, Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhEntry {
    name: String,
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Debug, Clone, Deserialize)]
struct GhAsset {
    name: String,
    size: u64,
    browser_download_url: String,
    /// `sha256:<hex>`, calculé par GitHub à la publication.
    #[serde(default)]
    digest: Option<String>,
}

pub struct Updater {
    http: Option<reqwest::Client>,
    /// Installeurs téléchargés (`<données>/updates/`).
    dir: PathBuf,
    /// `<données>/updater.json` : code source suivi (mise à jour locale).
    config: PathBuf,
    /// Dernière version publiée connue (tag), pour ne jamais recompiler plus ancien.
    latest_tag: Mutex<Option<String>>,
    busy: AtomicBool,
    cancelled: AtomicBool,
}

pub use local::LocalStatus;

impl Updater {
    pub fn new(paths: &Paths) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .read_timeout(Duration::from_secs(60))
            .user_agent(concat!("SDAI-ARCHIMED/", env!("CARGO_PKG_VERSION")))
            .build()
            .ok();
        Self {
            http,
            dir: paths.data.join("updates"),
            config: paths.data.join("updater.json"),
            latest_tag: Mutex::new(None),
            busy: AtomicBool::new(false),
            cancelled: AtomicBool::new(false),
        }
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http.as_ref().ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    async fn latest(&self) -> AppResult<GhRelease> {
        let (owner, repo) = repository()?;
        let body = self.api(&format!("https://api.github.com/repos/{owner}/{repo}/releases/latest")).await?;
        Ok(serde_json::from_str(&body)?)
    }

    /// Modules de la version officielle `tag` (dossiers de `src/modules/`).
    async fn official_modules(&self, tag: &str) -> AppResult<Vec<String>> {
        let (owner, repo) = repository()?;
        let body = self
            .api(&format!("https://api.github.com/repos/{owner}/{repo}/contents/src/modules?ref={tag}"))
            .await?;
        let entries: Vec<GhEntry> = serde_json::from_str(&body)?;
        Ok(entries.into_iter().filter(|e| e.kind == "dir").map(|e| e.name).collect())
    }

    async fn api(&self, url: &str) -> AppResult<String> {
        let response = self
            .http()?
            .get(url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(network)?;
        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(AppError::not_found("Aucune version publiée sur GitHub pour l'instant."));
        }
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::new(
                AppErrorCode::Network,
                "GitHub limite le nombre de vérifications : réessayez dans une heure.",
            ));
        }
        if !status.is_success() {
            return Err(AppError::new(AppErrorCode::Network, format!("GitHub a répondu {status} : réessayez plus tard.")));
        }
        response.text().await.map_err(network)
    }

    pub async fn check(&self) -> AppResult<UpdateStatus> {
        let kind = install_kind();
        let mut status = UpdateStatus {
            current: CURRENT.to_string(),
            kind,
            source: source_build(),
            available: None,
            releases_url: releases_url(),
        };
        if kind == InstallKind::Dev {
            return Ok(status);
        }
        let release = self.latest().await?;
        if let Ok(mut latest) = self.latest_tag.lock() {
            *latest = Some(release.tag_name.clone());
        }
        status.available = evaluate(&release, CURRENT, kind, arch())?.map(|(update, _)| update);
        if let Some(source) = status.source.as_mut() {
            // Code suivi choisi ailleurs (Réglages, `pnpm new:module`) : c'est lui qui sera fusionné.
            if let Some((dir, true)) = self.source_dir() {
                source.dir = dir.display().to_string();
                source.ready = source_ready(&dir);
            }
        }
        if let (Some(source), Some(_)) = (status.source.as_mut(), status.available.as_ref()) {
            // Sans réponse de GitHub, on ne prétend pas savoir : `None`.
            source.custom_modules = self
                .official_modules(&release.tag_name)
                .await
                .ok()
                .map(|official| custom_modules(&compiled_modules(), &official));
        }
        Ok(status)
    }

    /// Télécharge, vérifie et lance la version `version` (celle que la personne a confirmée).
    pub async fn install<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        version: &str,
        replace_source: bool,
        emit: &(impl Fn(UpdateEvent) + Sync),
    ) -> AppResult<()> {
        // Le fichier officiel ne contient pas les modules d'une version compilée par la
        // personne : jamais sans son accord explicite.
        if is_source_build() && !replace_source {
            return Err(AppError::invalid(
                "Cette version a été compilée depuis votre code source : la version officielle retirerait vos modules. Utilisez « Fusionner et recompiler ».",
            ));
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            return Err(AppError::invalid("Une mise à jour est déjà en cours."));
        }
        self.cancelled.store(false, Ordering::SeqCst);
        let result = self.install_inner(app, version, emit).await;
        self.busy.store(false, Ordering::SeqCst);
        let outcome = match &result {
            Ok(()) => "started".to_string(),
            Err(error) => format!("failed: {}", error.message),
        };
        super::audit::record("app.update", &format!("{CURRENT} -> {version}"), &outcome, "user");
        result
    }

    async fn install_inner<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        version: &str,
        emit: &(impl Fn(UpdateEvent) + Sync),
    ) -> AppResult<()> {
        let kind = install_kind();
        if kind == InstallKind::Dev {
            return Err(AppError::invalid(
                "Build de développement : mettez à jour le code (git pull), pas l'application.",
            ));
        }
        // La release est relue ici : on n'installe que ce que GitHub publie maintenant.
        let release = self.latest().await?;
        let Some((update, asset)) = evaluate(&release, CURRENT, kind, arch())? else {
            return Err(AppError::invalid("ARCHIMED est déjà à jour."));
        };
        if update.version != version {
            return Err(AppError::invalid(format!(
                "GitHub publie maintenant la version {} : relancez la mise à jour pour la voir.",
                update.version
            )));
        }
        let expected = asset
            .digest
            .as_deref()
            .and_then(sha256_of)
            .ok_or_else(|| AppError::invalid("Cette release ne publie pas d'empreinte SHA-256 : téléchargez-la depuis GitHub."))?;

        match kind {
            InstallKind::Installer => {
                std::fs::create_dir_all(&self.dir)?;
                let setup = self.dir.join(safe_file_name(&asset.name));
                self.download(&asset, &expected, &setup, emit).await?;
                emit(UpdateEvent::Installing);
                launch_installer(&setup)?;
            }
            InstallKind::Portable => {
                let exe = std::env::current_exe()?;
                let folder = exe.parent().ok_or_else(|| AppError::internal("dossier de l'exécutable introuvable"))?;
                // Même dossier que l'exécutable : l'échange final n'est qu'un renommage.
                let incoming = folder.join(format!(".{}.update", file_name(&exe)));
                std::fs::File::create(&incoming).map_err(|_| {
                    AppError::new(
                        AppErrorCode::PermissionDenied,
                        format!(
                            "Impossible d'écrire dans {} : téléchargez la nouvelle version depuis GitHub, ou déplacez ARCHIMED dans un dossier à vous.",
                            folder.display()
                        ),
                    )
                })?;
                self.download(&asset, &expected, &incoming, emit).await?;
                emit(UpdateEvent::Installing);
                swap_portable(&exe, &incoming)?;
                std::process::Command::new(&exe)
                    .current_dir(folder)
                    .spawn()
                    .map_err(|e| AppError::internal(format!("nouvelle version installée mais pas relancée ({e}) : rouvrez ARCHIMED")))?;
            }
            InstallKind::Dev => unreachable!(),
        }

        // L'installeur (ou la nouvelle version) a pris le relais : on ferme proprement.
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(600)).await;
            handle.exit(0);
        });
        Ok(())
    }

    async fn download(
        &self,
        asset: &GhAsset,
        expected: &str,
        target: &Path,
        emit: &(impl Fn(UpdateEvent) + Sync),
    ) -> AppResult<()> {
        let (owner, repo) = repository()?;
        if !allowed_download(&asset.browser_download_url, &owner, &repo) {
            return Err(AppError::invalid("Adresse de téléchargement inattendue : mise à jour refusée."));
        }
        if asset.size == 0 || asset.size > MAX_ASSET_BYTES {
            return Err(AppError::invalid("Taille du fichier publiée inattendue : mise à jour refusée."));
        }
        let partial = target.with_extension("part");
        let fail = |error: AppError| {
            let _ = std::fs::remove_file(&partial);
            let _ = std::fs::remove_file(target);
            error
        };

        let mut response = self.http()?.get(&asset.browser_download_url).send().await.map_err(network)?;
        if !response.status().is_success() {
            return Err(fail(AppError::new(
                AppErrorCode::Network,
                format!("Téléchargement refusé par GitHub ({}).", response.status()),
            )));
        }
        let total = asset.size;
        let mut file = std::fs::File::create(&partial).map_err(|e| fail(e.into()))?;
        let mut hasher = Sha256::new();
        let (mut received, mut last) = (0u64, Instant::now());
        emit(UpdateEvent::Downloading { received: 0, total });
        loop {
            if self.cancelled.load(Ordering::SeqCst) {
                drop(file);
                return Err(fail(AppError::invalid("Mise à jour annulée.")));
            }
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    drop(file);
                    return Err(fail(AppError::new(
                        AppErrorCode::Network,
                        format!("Téléchargement interrompu ({error}) : réessayez."),
                    )));
                }
            };
            received += chunk.len() as u64;
            if received > total {
                drop(file);
                return Err(fail(AppError::invalid("Le fichier reçu dépasse la taille publiée : mise à jour refusée.")));
            }
            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|e| fail(e.into()))?;
            if last.elapsed() >= Duration::from_millis(150) {
                emit(UpdateEvent::Downloading { received, total });
                last = Instant::now();
            }
        }
        file.flush().map_err(|e| fail(e.into()))?;
        drop(file);
        emit(UpdateEvent::Downloading { received, total });

        emit(UpdateEvent::Verifying);
        let digest = hex(&hasher.finalize());
        if received != total || !digest.eq_ignore_ascii_case(expected) {
            return Err(fail(AppError::new(
                AppErrorCode::Network,
                "Le fichier téléchargé ne correspond pas à l'empreinte publiée par GitHub : il a été supprimé. Réessayez.",
            )));
        }
        std::fs::rename(&partial, target).map_err(|e| fail(e.into()))?;
        Ok(())
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    /// Version compilée depuis le code source : fusion de la version officielle dans ce code,
    /// recompilation et installation, dans une fenêtre PowerShell (ARCHIMED reste ouvert
    /// jusqu'à la fin, puis le script le ferme).
    pub async fn rebuild(&self, version: &str) -> AppResult<()> {
        if !is_source_build() {
            return Err(AppError::invalid("Cette version n'a pas été compilée depuis le code source."));
        }
        let dir = self.source_dir().map(|(dir, _)| dir).unwrap_or_else(|| PathBuf::from(SOURCE_DIR));
        if !source_ready(&dir) {
            return Err(AppError::not_found(format!(
                "Code source introuvable ({}) : mettez à jour votre copie du code (git pull), puis recompilez.",
                dir.display()
            )));
        }
        let release = self.latest().await?;
        let Some((update, _)) = evaluate(&release, CURRENT, install_kind(), arch())? else {
            return Err(AppError::invalid("ARCHIMED est déjà à jour."));
        };
        if update.version != version {
            return Err(AppError::invalid(format!(
                "GitHub publie maintenant la version {} : relancez la mise à jour pour la voir.",
                update.version
            )));
        }
        let outcome = launch_source_update(&dir, &release.tag_name, false);
        super::audit::record(
            "app.update.source",
            &format!("{CURRENT} -> {version}"),
            if outcome.is_ok() { "started" } else { "failed" },
            "user",
        );
        outcome
    }

    /// Code source suivi : celui choisi par la personne (ou `pnpm new:module`), sinon celui de
    /// la compilation pour une version compilée depuis le code. `bool` : choisi.
    fn source_dir(&self) -> Option<(PathBuf, bool)> {
        let config = local::read_config(&self.config);
        if let Some(dir) = config.source_dir.map(PathBuf::from).filter(|dir| local::is_archimed_source(dir)) {
            return Some((dir, true));
        }
        let embedded = PathBuf::from(SOURCE_DIR);
        (is_source_build() && local::is_archimed_source(&embedded)).then_some((embedded, false))
    }

    /// Modules nouveaux ou modifiés dans le code source, pas encore dans cet exécutable.
    pub fn local_status(&self) -> LocalStatus {
        let quiet_ms = u64::try_from(local::QUIET.as_millis()).unwrap_or(30_000);
        let mut config = local::read_config(&self.config);
        let chosen = config.source_dir.clone();
        let empty = |valid: bool| LocalStatus {
            source_dir: chosen.clone(),
            configured: chosen.is_some(),
            valid,
            modules: Vec::new(),
            quiet_ms,
        };
        // En développement, Vite et `cargo` prennent déjà les modules en compte.
        if install_kind() == InstallKind::Dev {
            return empty(chosen.is_some());
        }
        let Some((dir, configured)) = self.source_dir() else {
            return empty(false);
        };
        let scanned = local::scan(&dir);
        let stamp = local::exe_stamp();
        let key = dir.display().to_string();
        let baseline = match config.baseline.as_ref() {
            Some(baseline) if baseline.stamp == stamp && baseline.dir == key => baseline.modules.clone(),
            _ => {
                // Nouvel exécutable ou nouveau dossier : point de départ des « modifiés ».
                let built_here = is_source_build() && same_dir(&dir, Path::new(SOURCE_DIR));
                let modules = local::baseline_for(&scanned, stamp, built_here);
                config.baseline = Some(local::Baseline { stamp, dir: key.clone(), modules: modules.clone() });
                local::write_config(&self.config, &config);
                modules
            }
        };
        LocalStatus {
            source_dir: Some(key),
            configured,
            valid: true,
            modules: local::classify(&scanned, &compiled_modules(), &baseline, stamp, local::now_ms()),
            quiet_ms,
        }
    }

    /// Choisit (ou oublie, `None`) le dossier du code source suivi.
    pub fn set_source_dir(&self, dir: Option<String>) -> AppResult<LocalStatus> {
        if let Some(dir) = dir.as_deref() {
            if !local::is_archimed_source(Path::new(dir)) {
                return Err(AppError::invalid(
                    "Ce dossier ne contient pas le code d'ARCHIMED (src/modules et src-tauri/tauri.conf.json).",
                ));
            }
        }
        let mut config = local::read_config(&self.config);
        config.source_dir = dir;
        config.baseline = None;
        local::write_config(&self.config, &config);
        Ok(self.local_status())
    }

    /// Recompile ARCHIMED avec les modules du code source, puis l'installe (fenêtre PowerShell).
    /// Le code est d'abord mis au niveau de la version installée ou publiée la plus récente :
    /// on ne recompile jamais une version plus ancienne.
    pub fn local_rebuild(&self) -> AppResult<()> {
        let status = self.local_status();
        let Some((dir, _)) = self.source_dir() else {
            return Err(AppError::not_found("Code source d'ARCHIMED introuvable : choisissez son dossier dans Réglages › Mises à jour."));
        };
        if !status.modules.iter().any(|m| m.ready) {
            return Err(AppError::invalid("Aucun module prêt à intégrer."));
        }
        if !source_ready(&dir) {
            return Err(AppError::not_found(format!(
                "{} n'est pas une copie git complète du projet (dossier .git ou script de mise à jour absent).",
                dir.display()
            )));
        }
        let latest = self.latest_tag.lock().ok().and_then(|tag| tag.clone());
        let tag = match latest {
            Some(tag) if is_newer(CURRENT, &tag) => tag,
            _ => format!("v{CURRENT}"),
        };
        let names = status.modules.iter().filter(|m| m.ready).map(|m| m.id.as_str()).collect::<Vec<_>>().join(", ");
        let outcome = launch_source_update(&dir, &tag, true);
        super::audit::record("app.update.local", &names, if outcome.is_ok() { "started" } else { "failed" }, "user");
        outcome
    }

    /// Au démarrage : installeurs déjà utilisés et ancien exécutable portable retirés.
    pub fn cleanup(&self) {
        if let Ok(entries) = std::fs::read_dir(&self.dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        if install_kind() != InstallKind::Portable {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        // Téléchargement interrompu (fermeture, coupure) : fichiers temporaires retirés.
        if let Some(folder) = exe.parent() {
            let incoming = folder.join(format!(".{}.update", file_name(&exe)));
            let _ = std::fs::remove_file(incoming.with_extension("part"));
            let _ = std::fs::remove_file(&incoming);
        }
        let old = old_path(&exe);
        if !old.exists() {
            return;
        }
        // L'ancienne version peut mettre un instant à se fermer.
        std::thread::spawn(move || {
            for _ in 0..10 {
                if std::fs::remove_file(&old).is_ok() || !old.exists() {
                    return;
                }
                std::thread::sleep(Duration::from_secs(2));
            }
        });
    }
}

#[tauri::command]
pub async fn updater_check(updater: State<'_, Updater>) -> AppResult<UpdateStatus> {
    updater.check().await
}

#[tauri::command]
pub async fn updater_install<R: Runtime>(
    app: AppHandle<R>,
    updater: State<'_, Updater>,
    version: String,
    replace_source: bool,
    on_event: Channel<UpdateEvent>,
) -> AppResult<()> {
    let emit = |event: UpdateEvent| {
        let _ = on_event.send(event);
    };
    updater.install(&app, &version, replace_source, &emit).await
}

#[tauri::command]
pub async fn updater_rebuild(updater: State<'_, Updater>, version: String) -> AppResult<()> {
    updater.rebuild(&version).await
}

#[tauri::command]
pub fn updater_cancel(updater: State<'_, Updater>) {
    updater.cancel();
}

#[tauri::command]
pub async fn updater_local_status(updater: State<'_, Updater>) -> AppResult<LocalStatus> {
    Ok(updater.local_status())
}

#[tauri::command]
pub async fn updater_set_source_dir(updater: State<'_, Updater>, dir: Option<String>) -> AppResult<LocalStatus> {
    updater.set_source_dir(dir)
}

#[tauri::command]
pub async fn updater_local_rebuild(updater: State<'_, Updater>) -> AppResult<()> {
    updater.local_rebuild()
}

// ── Règles pures (testées) ───────────────────────────────────────────────────

/// `0.8.0` ou `v0.8.0` → (0, 8, 0). Une préversion (`0.8.0-beta.1`) n'est pas proposée.
fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let text = text.trim().trim_start_matches(['v', 'V']);
    let mut parts = text.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn is_newer(current: &str, candidate: &str) -> bool {
    match (parse_version(current), parse_version(candidate)) {
        (Some(current), Some(candidate)) => candidate > current,
        _ => false,
    }
}

/// `https://github.com/<owner>/<repo>` → (owner, repo).
fn slug(repository: &str) -> Option<(String, String)> {
    let rest = repository.trim().trim_end_matches('/').trim_end_matches(".git").strip_prefix("https://github.com/")?;
    let (owner, repo) = rest.split_once('/')?;
    let valid = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    (valid(owner) && valid(repo) && !repo.contains('/')).then(|| (owner.to_string(), repo.to_string()))
}

fn repository() -> AppResult<(String, String)> {
    slug(REPOSITORY).ok_or_else(|| AppError::internal("dépôt GitHub inconnu (Cargo.toml, champ repository)"))
}

fn releases_url() -> String {
    format!("{}/releases", REPOSITORY.trim_end_matches('/'))
}

fn arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86" => "x86",
        _ => "x64",
    }
}

fn pick_asset<'a>(assets: &'a [GhAsset], kind: InstallKind, arch: &str) -> Option<&'a GhAsset> {
    match kind {
        InstallKind::Installer => {
            let suffix = format!("_{arch}-setup.exe").to_lowercase();
            assets.iter().find(|a| a.name.to_lowercase().ends_with(&suffix))
        }
        InstallKind::Portable => assets.iter().find(|a| a.name.eq_ignore_ascii_case(PORTABLE_ASSET)),
        InstallKind::Dev => None,
    }
}

/// Mise à jour proposée pour cette installation, avec le fichier à télécharger.
fn evaluate(release: &GhRelease, current: &str, kind: InstallKind, arch: &str) -> AppResult<Option<(AvailableUpdate, GhAsset)>> {
    if release.draft || release.prerelease || !is_newer(current, &release.tag_name) {
        return Ok(None);
    }
    let Some(asset) = pick_asset(&release.assets, kind, arch) else {
        return Err(AppError::not_found(format!(
            "La version {} n'a pas de fichier pour cette installation : téléchargez-la depuis GitHub.",
            release.tag_name.trim_start_matches(['v', 'V'])
        )));
    };
    let version = release.tag_name.trim().trim_start_matches(['v', 'V']).to_string();
    let url = if release.html_url.starts_with("https://github.com/") { release.html_url.clone() } else { releases_url() };
    Ok(Some((
        AvailableUpdate {
            title: release.name.clone().filter(|n| !n.trim().is_empty()).unwrap_or_else(|| format!("ARCHIMED {version}")),
            version,
            notes: release.body.clone().unwrap_or_default(),
            url,
            published_at: release.published_at.clone(),
            asset: asset.name.clone(),
            size: asset.size,
        },
        asset.clone(),
    )))
}

/// `sha256:<64 hex>` → hex en minuscules.
fn sha256_of(digest: &str) -> Option<String> {
    let hex = digest.trim().strip_prefix("sha256:")?;
    (hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())).then(|| hex.to_lowercase())
}

/// Seuls les fichiers des releases du dépôt (GitHub redirige ensuite vers son stockage).
fn allowed_download(url: &str, owner: &str, repo: &str) -> bool {
    let prefix = format!("https://github.com/{owner}/{repo}/releases/download/").to_lowercase();
    let lower = url.to_lowercase();
    lower.starts_with(&prefix) && !url[prefix.len()..].contains("..")
}

fn is_source_build() -> bool {
    BUILD != "official" && !cfg!(debug_assertions)
}

fn compiled_modules() -> Vec<String> {
    MODULES.split(',').filter(|m| !m.is_empty()).map(str::to_string).collect()
}

/// Modules de cette version qui ne sont pas dans la version officielle.
fn custom_modules(compiled: &[String], official: &[String]) -> Vec<String> {
    compiled.iter().filter(|m| !official.contains(m)).cloned().collect()
}

fn source_build() -> Option<SourceBuild> {
    if !is_source_build() {
        return None;
    }
    Some(SourceBuild {
        dir: SOURCE_DIR.to_string(),
        ready: source_ready(Path::new(SOURCE_DIR)),
        custom_modules: None,
    })
}

/// Copie git du projet avec son script de mise à jour.
fn source_ready(dir: &Path) -> bool {
    dir.join(".git").exists() && dir.join(SOURCE_SCRIPT).is_file()
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.display().to_string().replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

/// Fenêtre PowerShell visible : la personne suit la fusion et la compilation, et répond si
/// le script lui demande d'enregistrer ses modifications.
#[cfg(windows)]
fn launch_source_update(dir: &Path, tag: &str, local: bool) -> AppResult<()> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    let exe = std::env::current_exe()?;
    let kind = match install_kind() {
        InstallKind::Installer => "installer",
        InstallKind::Portable => "portable",
        InstallKind::Dev => "none",
    };
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(dir.join(SOURCE_SCRIPT))
        .args(["-Tag", tag, "-Upstream"])
        .arg(format!("{}.git", REPOSITORY.trim_end_matches('/')))
        .arg("-AppPid")
        .arg(std::process::id().to_string())
        .arg("-Target")
        .arg(&exe)
        .args(["-Kind", kind])
        .args(if local { &["-Local"][..] } else { &[][..] })
        .current_dir(dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::internal(format!("PowerShell non lancé ({e})")))
}

#[cfg(not(windows))]
fn launch_source_update(_dir: &Path, _tag: &str, _local: bool) -> AppResult<()> {
    Err(AppError::invalid("La recompilation automatique n'existe que sous Windows."))
}

fn install_kind() -> InstallKind {
    if cfg!(debug_assertions) {
        return InstallKind::Dev;
    }
    let installed = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.join("uninstall.exe").is_file()))
        .unwrap_or(false);
    if installed {
        InstallKind::Installer
    } else {
        InstallKind::Portable
    }
}

fn file_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| PORTABLE_ASSET.to_string())
}

fn safe_file_name(name: &str) -> String {
    let clean: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')).collect();
    if clean.is_empty() || clean.starts_with('.') {
        "archimed-setup.exe".to_string()
    } else {
        clean
    }
}

fn old_path(exe: &Path) -> PathBuf {
    let mut name = exe.as_os_str().to_owned();
    name.push(".old");
    PathBuf::from(name)
}

/// Échange des exécutables : l'ancien devient `.old` (supprimé au prochain lancement).
fn swap_portable(exe: &Path, incoming: &Path) -> AppResult<()> {
    let old = old_path(exe);
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| AppError::new(AppErrorCode::PermissionDenied, format!("remplacement impossible ({e})")))?;
    if let Err(error) = std::fs::rename(incoming, exe) {
        // On remet l'ancienne version en place : ARCHIMED doit rester lançable.
        let _ = std::fs::rename(&old, exe);
        let _ = std::fs::remove_file(incoming);
        return Err(AppError::new(AppErrorCode::PermissionDenied, format!("remplacement impossible ({error})")));
    }
    Ok(())
}

fn launch_installer(setup: &Path) -> AppResult<()> {
    // Passif : barre de progression seule, sans questions ; /UPDATE garde les données ;
    // /R rouvre ARCHIMED à la fin.
    const ARGS: [&str; 3] = ["/P", "/UPDATE", "/R"];
    match std::process::Command::new(setup).args(ARGS).spawn() {
        Ok(_) => Ok(()),
        // Installation pour tous les utilisateurs : Windows demande l'autorisation (UAC).
        Err(error) if error.raw_os_error() == Some(740) => super::process::command("cmd")
            .args(["/C", "start", ""])
            .arg(setup)
            .args(ARGS)
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::internal(format!("installeur non lancé ({e})"))),
        Err(error) => Err(AppError::internal(format!("installeur non lancé ({error})"))),
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn network(error: reqwest::Error) -> AppError {
    AppError::new(
        AppErrorCode::Network,
        format!("GitHub injoignable ({error}) : vérifiez la connexion."),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> GhAsset {
        GhAsset {
            name: name.into(),
            size: 10,
            browser_download_url: format!("https://github.com/Kaylloggs/SDAI-ARCHIMED/releases/download/v0.8.0/{name}"),
            digest: Some(format!("sha256:{}", "a".repeat(64))),
        }
    }

    fn release(tag: &str) -> GhRelease {
        GhRelease {
            tag_name: tag.into(),
            name: Some(format!("SDAI ARCHIMED {tag}")),
            body: Some("## Notes".into()),
            html_url: format!("https://github.com/Kaylloggs/SDAI-ARCHIMED/releases/tag/{tag}"),
            draft: false,
            prerelease: false,
            published_at: None,
            assets: vec![asset("SDAI-Archimed.exe"), asset("SDAI.Archimed_0.8.0_x64-setup.exe"), asset("SDAI.Archimed_0.8.0_x64_fr-FR.msi")],
        }
    }

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.7.0", "v0.8.0"));
        assert!(is_newer("0.7.9", "0.7.10"));
        assert!(is_newer("0.9.0", "v1.0.0"));
        assert!(!is_newer("0.8.0", "v0.8.0"));
        assert!(!is_newer("0.8.1", "v0.8.0"));
        assert!(!is_newer("0.7.0", "v0.8.0-beta.1"));
        assert!(!is_newer("0.7.0", "nightly"));
    }

    #[test]
    fn picks_the_file_of_this_installation() {
        let r = release("v0.8.0");
        let (update, file) = evaluate(&r, "0.7.0", InstallKind::Installer, "x64").unwrap().unwrap();
        assert_eq!(update.version, "0.8.0");
        assert_eq!(file.name, "SDAI.Archimed_0.8.0_x64-setup.exe");
        let (_, file) = evaluate(&r, "0.7.0", InstallKind::Portable, "x64").unwrap().unwrap();
        assert_eq!(file.name, "SDAI-Archimed.exe");
        assert!(evaluate(&r, "0.8.0", InstallKind::Installer, "x64").unwrap().is_none());
        assert!(evaluate(&r, "0.7.0", InstallKind::Installer, "arm64").is_err());
        let mut pre = release("v0.9.0");
        pre.prerelease = true;
        assert!(evaluate(&pre, "0.7.0", InstallKind::Installer, "x64").unwrap().is_none());
    }

    #[test]
    fn only_trusts_the_repository_and_its_digest() {
        assert_eq!(slug("https://github.com/Kaylloggs/SDAI-ARCHIMED"), Some(("Kaylloggs".into(), "SDAI-ARCHIMED".into())));
        assert_eq!(slug("https://github.com/a/b.git/"), Some(("a".into(), "b".into())));
        assert_eq!(slug("https://gitlab.com/a/b"), None);
        assert!(allowed_download(
            "https://github.com/Kaylloggs/SDAI-ARCHIMED/releases/download/v0.8.0/SDAI-Archimed.exe",
            "Kaylloggs",
            "SDAI-ARCHIMED"
        ));
        assert!(!allowed_download("https://github.com/other/SDAI-ARCHIMED/releases/download/v1/x.exe", "Kaylloggs", "SDAI-ARCHIMED"));
        assert!(!allowed_download("https://evil.example/Kaylloggs/SDAI-ARCHIMED/releases/download/x.exe", "Kaylloggs", "SDAI-ARCHIMED"));
        assert!(!allowed_download("http://github.com/Kaylloggs/SDAI-ARCHIMED/releases/download/v1/x.exe", "Kaylloggs", "SDAI-ARCHIMED"));
        assert_eq!(sha256_of(&format!("sha256:{}", "AB".repeat(32))), Some("ab".repeat(32)));
        assert_eq!(sha256_of("sha1:abc"), None);
        assert_eq!(sha256_of("sha256:xyz"), None);
        assert_eq!(safe_file_name("SDAI.Archimed_0.8.0_x64-setup.exe"), "SDAI.Archimed_0.8.0_x64-setup.exe");
        assert_eq!(safe_file_name("../../evil.exe"), "archimed-setup.exe");
    }

    #[test]
    fn lists_the_modules_the_official_version_does_not_have() {
        let compiled = vec!["chat".to_string(), "meteo".to_string(), "skills".to_string()];
        let official = vec!["chat".to_string(), "skills".to_string(), "planner".to_string()];
        assert_eq!(custom_modules(&compiled, &official), vec!["meteo".to_string()]);
        assert!(custom_modules(&official, &official).is_empty());
        let listing: Vec<GhEntry> = serde_json::from_str(r#"[{"name":"chat","type":"dir"},{"name":"README.md","type":"file"}]"#).unwrap();
        assert_eq!(listing.len(), 2);
        assert_eq!(listing[1].kind, "file");
    }

    #[test]
    fn swaps_the_portable_executable_and_keeps_the_old_one() {
        let dir = std::env::temp_dir().join(format!("archimed-updater-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("SDAI-Archimed.exe");
        let incoming = dir.join(".SDAI-Archimed.exe.update");
        std::fs::write(&exe, "old").unwrap();
        std::fs::write(&incoming, "new").unwrap();
        swap_portable(&exe, &incoming).unwrap();
        assert_eq!(std::fs::read_to_string(&exe).unwrap(), "new");
        assert_eq!(std::fs::read_to_string(old_path(&exe)).unwrap(), "old");
        assert!(!incoming.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
