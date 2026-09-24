//! Installation d'un JDK à la demande (Eclipse Temurin, via l'API d'Adoptium).
//!
//! Rien n'est installé en silence : l'interface montre d'abord l'offre (source, fichier,
//! taille, dossier), la personne confirme, puis le JDK est téléchargé, vérifié (SHA-256
//! publié par Adoptium) et décompressé dans les données d'ARCHIMED. Aucun droit
//! administrateur, aucune variable d'environnement modifiée, rien dans le système.

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::java;
use super::types::{InstallEvent, JavaInstall, JdkOffer};

/// Source par défaut ; remplaçable dans `<données>/modules/mcstudio/env.json`.
const DEFAULT_API: &str = "https://api.adoptium.net";
/// Versions proposées : celles que demandent les profils de Minecraft.
pub const OFFERED_MAJORS: &[u32] = &[8, 11, 16, 17, 21, 25];

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvSettings {
    adoptium_api: Option<String>,
}

pub struct JdkInstaller {
    dir: PathBuf,
    api: String,
    http: Option<reqwest::Client>,
    /// Versions en cours d'installation (une à la fois par version).
    running: Mutex<HashSet<u32>>,
    cancelled: Mutex<HashSet<u32>>,
}

impl JdkInstaller {
    pub fn new(module_dir: &Path) -> Self {
        let settings: EnvSettings = std::fs::read_to_string(module_dir.join("env.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        let api = settings
            .adoptium_api
            .filter(|url| url.starts_with("https://"))
            .unwrap_or_else(|| DEFAULT_API.to_string());
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .user_agent(concat!(
                "SDAI-ARCHIMED-ModStudio/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .ok();
        Self {
            dir: module_dir.join("jdks"),
            api: api.trim_end_matches('/').to_string(),
            http,
            running: Mutex::new(HashSet::new()),
            cancelled: Mutex::new(HashSet::new()),
        }
    }

    /// Dossier des JDK installés par Mod Studio (inclus dans la détection).
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn http(&self) -> AppResult<&reqwest::Client> {
        self.http
            .as_ref()
            .ok_or_else(|| AppError::internal("client HTTP indisponible"))
    }

    /// Ce qui serait installé, tel qu'Adoptium le décrit.
    pub async fn offer(&self, major: u32) -> AppResult<JdkOffer> {
        if !OFFERED_MAJORS.contains(&major) {
            return Err(AppError::invalid(format!(
                "Java {major} n'est pas proposé à l'installation."
            )));
        }
        let (os, arch) = platform()?;
        let url = format!(
            "{}/v3/assets/latest/{major}/hotspot?architecture={arch}&image_type=jdk&os={os}&vendor=eclipse",
            self.api
        );
        let response = self.http()?.get(&url).send().await.map_err(network)?;
        if !response.status().is_success() {
            return Err(AppError::new(
                AppErrorCode::Network,
                format!(
                    "Adoptium a répondu {} : réessayez plus tard.",
                    response.status()
                ),
            ));
        }
        let body = response.text().await.map_err(network)?;
        parse_offer(&body, major, &self.dir)
    }

    /// Télécharge, vérifie et décompresse le JDK ; `emit` suit l'avancement.
    pub async fn install(
        &self,
        offer: &JdkOffer,
        emit: &(impl Fn(InstallEvent) + Sync),
    ) -> AppResult<JavaInstall> {
        {
            let mut running = self
                .running
                .lock()
                .map_err(|_| AppError::internal("installation verrouillée"))?;
            if !running.insert(offer.major) {
                return Err(AppError::invalid(format!(
                    "Java {} est déjà en cours d'installation.",
                    offer.major
                )));
            }
        }
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.remove(&offer.major);
        }
        let result = self.install_inner(offer, emit).await;
        if let Ok(mut running) = self.running.lock() {
            running.remove(&offer.major);
        }
        crate::core::audit::record(
            "mcstudio.jdk_install",
            &format!("{} ({})", offer.url, offer.sha256),
            if result.is_ok() {
                "installed"
            } else {
                "failed"
            },
            "user",
        );
        result
    }

    pub fn cancel(&self, major: u32) {
        if let Ok(mut cancelled) = self.cancelled.lock() {
            cancelled.insert(major);
        }
    }

    fn is_cancelled(&self, major: u32) -> bool {
        self.cancelled
            .lock()
            .map(|c| c.contains(&major))
            .unwrap_or(false)
    }

    async fn install_inner(
        &self,
        offer: &JdkOffer,
        emit: &(impl Fn(InstallEvent) + Sync),
    ) -> AppResult<JavaInstall> {
        // L'offre confirmée arrive par IPC : on la recompare à ce que publie la
        // source configurée, pour ne jamais télécharger une adresse reçue telle quelle.
        let published = self.offer(offer.major).await?;
        if published.url != offer.url || published.sha256 != offer.sha256 {
            return Err(AppError::invalid(
                "Adoptium publie une autre version depuis votre confirmation : relancez l'installation pour la voir.",
            ));
        }
        let offer = &published;
        if !offer.url.starts_with("https://") {
            return Err(AppError::invalid(
                "Adresse de téléchargement refusée : HTTPS obligatoire.",
            ));
        }
        let target = PathBuf::from(&offer.target_dir);
        if target.parent() != Some(self.dir.as_path()) {
            return Err(AppError::invalid("Dossier d'installation inattendu."));
        }
        if let Some(install) = java::inspect(&target) {
            return Ok(install);
        }
        std::fs::create_dir_all(&self.dir)?;
        let archive = self
            .dir
            .join(format!(".{}.part", folder_name(&offer.file_name)));

        // 1. Téléchargement, empreinte calculée au fil de l'eau.
        let mut response = self.http()?.get(&offer.url).send().await.map_err(network)?;
        if !response.status().is_success() {
            return Err(AppError::new(
                AppErrorCode::Network,
                format!("Téléchargement refusé : {}", response.status()),
            ));
        }
        let total = response.content_length().unwrap_or(offer.size);
        let mut file = std::fs::File::create(&archive)?;
        let mut hasher = Sha256::new();
        let (mut received, mut last) = (0u64, Instant::now());
        emit(InstallEvent::Downloading { received: 0, total });
        loop {
            if self.is_cancelled(offer.major) {
                drop(file);
                let _ = std::fs::remove_file(&archive);
                return Err(AppError::invalid("Installation annulée."));
            }
            let chunk = match response.chunk().await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => break,
                Err(error) => {
                    drop(file);
                    let _ = std::fs::remove_file(&archive);
                    return Err(AppError::new(
                        AppErrorCode::Network,
                        format!("Téléchargement interrompu ({error}) : relancez l'installation."),
                    ));
                }
            };
            hasher.update(&chunk);
            file.write_all(&chunk)?;
            received += chunk.len() as u64;
            if last.elapsed() >= Duration::from_millis(200) {
                emit(InstallEvent::Downloading { received, total });
                last = Instant::now();
            }
        }
        file.flush()?;
        drop(file);
        emit(InstallEvent::Downloading { received, total });

        // 2. Vérification de l'empreinte publiée par Adoptium.
        emit(InstallEvent::Verifying);
        let digest = hex(&hasher.finalize());
        if !digest.eq_ignore_ascii_case(&offer.sha256) {
            let _ = std::fs::remove_file(&archive);
            return Err(AppError::new(
                AppErrorCode::Network,
                "Le fichier téléchargé ne correspond pas à l'empreinte publiée : il a été supprimé. Relancez l'installation.",
            ));
        }

        // 3. Décompression dans un dossier temporaire, puis renommage.
        emit(InstallEvent::Extracting);
        let staging = self.dir.join(format!(".staging-{}", offer.major));
        let _ = std::fs::remove_dir_all(&staging);
        let archive_path = archive.clone();
        let staging_path = staging.clone();
        let file_name = offer.file_name.clone();
        let extracted = tauri::async_runtime::spawn_blocking(move || {
            extract(&archive_path, &file_name, &staging_path)
        })
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
        let _ = std::fs::remove_file(&archive);
        if let Err(error) = extracted {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
        let root = single_root(&staging)?;
        if target.exists() {
            std::fs::remove_dir_all(&target)?;
        }
        std::fs::rename(&root, &target)?;
        let _ = std::fs::remove_dir_all(&staging);

        java::inspect(&target).ok_or_else(|| {
            AppError::internal(
                "Le JDK installé est incomplet (bin/javac ou fichier release absent).",
            )
        })
    }
}

fn network(error: reqwest::Error) -> AppError {
    AppError::new(
        AppErrorCode::Network,
        format!("Adoptium injoignable ({error}) : une connexion est nécessaire."),
    )
}

fn platform() -> AppResult<(&'static str, &'static str)> {
    let os = match std::env::consts::OS {
        "windows" => "windows",
        "linux" => "linux",
        "macos" => "mac",
        other => {
            return Err(AppError::invalid(format!(
                "Système {other} non pris en charge."
            )))
        }
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        "x86" => "x32",
        other => {
            return Err(AppError::invalid(format!(
                "Architecture {other} non prise en charge."
            )))
        }
    };
    Ok((os, arch))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Nom de dossier sûr tiré du nom de version (`jdk-21.0.4+7`) : jamais `..`,
/// jamais caché, jamais de séparateur.
fn folder_name(release: &str) -> String {
    let name: String = release
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '+' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    match name.trim_start_matches('.') {
        "" => "jdk".to_string(),
        rest => rest.to_string(),
    }
}

/// Réponse de `/v3/assets/latest/<major>/hotspot` → offre (première archive JDK).
fn parse_offer(body: &str, major: u32, dir: &Path) -> AppResult<JdkOffer> {
    let entries: Vec<Value> = serde_json::from_str(body)
        .map_err(|e| AppError::internal(format!("réponse Adoptium illisible : {e}")))?;
    let entry = entries
        .iter()
        .find(|e| {
            e["binary"]["image_type"].as_str() == Some("jdk")
                && e["binary"]["package"]["link"].is_string()
        })
        .ok_or_else(|| AppError::not_found(format!("Aucun JDK {major} publié pour ce système.")))?;
    let package = &entry["binary"]["package"];
    let field = |value: &Value, name: &str| {
        value[name]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::internal(format!("réponse Adoptium incomplète ({name})")))
    };
    let release_name = field(entry, "release_name")?;
    let sha256 = field(package, "checksum")?;
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::internal(
            "empreinte SHA-256 absente de la réponse Adoptium",
        ));
    }
    Ok(JdkOffer {
        major,
        target_dir: dir.join(folder_name(&release_name)).display().to_string(),
        release_name,
        vendor: "Eclipse Temurin (Adoptium)".to_string(),
        url: field(package, "link")?,
        file_name: field(package, "name")?,
        size: package["size"].as_u64().unwrap_or(0),
        sha256: sha256.to_ascii_lowercase(),
    })
}

/// Décompresse une archive `.zip` ou `.tar.gz` sans jamais écrire hors de `into`.
fn extract(archive: &Path, name: &str, into: &Path) -> AppResult<()> {
    std::fs::create_dir_all(into)?;
    let file = std::fs::File::open(archive)?;
    if name.ends_with(".zip") {
        let mut zip = zip::ZipArchive::new(file)
            .map_err(|e| AppError::internal(format!("archive zip illisible : {e}")))?;
        for index in 0..zip.len() {
            let mut entry = zip
                .by_index(index)
                .map_err(|e| AppError::internal(e.to_string()))?;
            // `enclosed_name` refuse les chemins absolus et les `..`.
            let Some(relative) = entry.enclosed_name() else {
                return Err(AppError::invalid(
                    "Archive refusée : chemin hors du dossier d'installation.",
                ));
            };
            let path = into.join(relative);
            if entry.is_dir() {
                std::fs::create_dir_all(&path)?;
                continue;
            }
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out = std::fs::File::create(&path)?;
            std::io::copy(&mut entry, &mut out)?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode));
            }
        }
        Ok(())
    } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
        for entry in tar.entries()? {
            // `unpack_in` refuse lui aussi les chemins qui sortent du dossier.
            if !entry?.unpack_in(into)? {
                return Err(AppError::invalid(
                    "Archive refusée : chemin hors du dossier d'installation.",
                ));
            }
        }
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "Format d'archive inconnu : {name}"
        )))
    }
}

/// Les archives Temurin contiennent un seul dossier racine (`jdk-21.0.4+7/`).
fn single_root(staging: &Path) -> AppResult<PathBuf> {
    let dirs: Vec<PathBuf> = std::fs::read_dir(staging)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    match dirs.as_slice() {
        [only] => Ok(only.clone()),
        _ => Ok(staging.to_path_buf()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESPONSE: &str = r#"[{
        "binary": {
            "architecture": "x64", "image_type": "jdk", "os": "windows",
            "package": {
                "checksum": "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
                "link": "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.4%2B7/OpenJDK21U-jdk_x64_windows_hotspot_21.0.4_7.zip",
                "name": "OpenJDK21U-jdk_x64_windows_hotspot_21.0.4_7.zip",
                "size": 191000000
            }
        },
        "release_name": "jdk-21.0.4+7",
        "vendor": "eclipse"
    }]"#;

    #[test]
    fn adoptium_answer_becomes_an_offer() {
        let dir = Path::new("/data/jdks");
        let offer = parse_offer(RESPONSE, 21, dir).unwrap();
        assert_eq!(offer.release_name, "jdk-21.0.4+7");
        assert_eq!(offer.sha256.len(), 64);
        assert!(offer.sha256.chars().all(|c| !c.is_ascii_uppercase()));
        assert_eq!(PathBuf::from(&offer.target_dir), dir.join("jdk-21.0.4+7"));
        assert_eq!(offer.size, 191_000_000);
        assert!(parse_offer("[]", 21, dir).is_err());
        let no_sum = RESPONSE.replace(
            "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
            "",
        );
        assert!(parse_offer(&no_sum, 21, dir).is_err());
    }

    #[test]
    fn zip_is_extracted_inside_and_hashes_match() {
        let base = std::env::temp_dir().join(format!("mcstudio-jdk-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let archive = base.join("jdk.zip");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
            let options = zip::write::SimpleFileOptions::default();
            zip.add_directory("jdk-21.0.4+7/bin/", options).unwrap();
            zip.start_file("jdk-21.0.4+7/bin/javac.exe", options)
                .unwrap();
            zip.write_all(b"").unwrap();
            zip.start_file("jdk-21.0.4+7/bin/javac", options).unwrap();
            zip.write_all(b"").unwrap();
            zip.start_file("jdk-21.0.4+7/release", options).unwrap();
            zip.write_all(b"JAVA_VERSION=\"21.0.4\"\nIMPLEMENTOR=\"Eclipse Adoptium\"\n")
                .unwrap();
            zip.finish().unwrap();
        }
        let staging = base.join("staging");
        extract(&archive, "jdk.zip", &staging).unwrap();
        let root = single_root(&staging).unwrap();
        assert!(root.ends_with("jdk-21.0.4+7"));
        assert_eq!(java::inspect(&root).unwrap().major, 21);
        assert_eq!(
            hex(&Sha256::digest(b"abc")),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn zip_slip_is_refused() {
        let base = std::env::temp_dir().join(format!("mcstudio-jdk-slip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let archive = base.join("evil.zip");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
            zip.start_file("../../evil.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"x").unwrap();
            zip.finish().unwrap();
        }
        assert!(extract(&archive, "evil.zip", &base.join("staging")).is_err());
        assert!(!base.parent().unwrap().join("evil.txt").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn folder_names_are_safe() {
        assert_eq!(folder_name("jdk-21.0.4+7"), "jdk-21.0.4+7");
        assert_eq!(folder_name("../x y"), "_x_y");
        assert_eq!(folder_name(".."), "jdk");
        assert_eq!(folder_name(".hidden"), "hidden");
        assert!(!OFFERED_MAJORS.contains(&9));
    }
}
