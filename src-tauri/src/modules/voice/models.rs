//! Gestionnaire des modèles locaux : téléchargement (reprise après pause ou coupure),
//! vérification d'empreinte, décompression, suppression et mise à jour.
//!
//! Dossier central partagé par tous les modules : `<données>/models/{stt,tts,llm,voice,runtime}/<id>/`.
//! Un modèle n'est téléchargé qu'une fois ; son manifeste `.installed.json` note la version et
//! l'empreinte de chaque fichier (vérifiables à tout moment).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::catalog::{self, Archive, CatalogItem, Source};
use super::ollama;
use super::types::{HardwareInfo, ModelEntry, ModelKind, ModelProgress, ModelStatus};

pub const EVENT: &str = "voice:model";
const MANIFEST: &str = ".installed.json";
/// Taille maximale acceptée pour un fichier (garde-fou contre une réponse aberrante).
const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    id: String,
    version: String,
    files: Vec<ManifestFile>,
    installed_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct ManifestFile {
    name: String,
    sha256: String,
}

/// Fichier à télécharger, adresse et empreinte connues.
struct Resolved {
    url: String,
    name: String,
    sha256: Option<String>,
    size: u64,
    archive: Option<Archive>,
}

enum Stop {
    Paused,
    Failed(AppError),
}

impl From<AppError> for Stop {
    fn from(error: AppError) -> Self {
        Stop::Failed(error)
    }
}

pub struct ModelManager {
    root: PathBuf,
    http: reqwest::Client,
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
    progress: Mutex<HashMap<String, ModelProgress>>,
}

pub fn kind_dir(kind: ModelKind) -> &'static str {
    match kind {
        ModelKind::Stt => "stt",
        ModelKind::Tts => "tts",
        ModelKind::Llm => "llm",
        ModelKind::Runtime => "runtime",
    }
}

impl ModelManager {
    pub fn new(root: PathBuf, http: reqwest::Client) -> Self {
        for dir in ["stt", "tts", "llm", "voice", "runtime", "tmp"] {
            let _ = std::fs::create_dir_all(root.join(dir));
        }
        Self { root, http, running: Mutex::new(HashMap::new()), progress: Mutex::new(HashMap::new()) }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn install_dir(&self, item: &CatalogItem) -> PathBuf {
        self.root.join(kind_dir(item.kind)).join(item.id)
    }

    fn manifest(&self, item: &CatalogItem) -> Option<Manifest> {
        let raw = std::fs::read_to_string(self.install_dir(item).join(MANIFEST)).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn is_installed(&self, id: &str) -> bool {
        catalog::find(id).is_some_and(|item| self.manifest(item).is_some())
    }

    /// Fichier principal d'un modèle installé (exécutable d'un outil, poids d'un modèle).
    pub fn entry_path(&self, id: &str) -> Option<PathBuf> {
        let item = catalog::find(id)?;
        self.manifest(item)?;
        let files = catalog::files_for(item, std::env::consts::OS, std::env::consts::ARCH)?;
        let path = self.install_dir(item).join(files.entry);
        path.exists().then_some(path)
    }

    /// Catalogue et état sur cette machine.
    pub async fn entries(&self, hw: &HardwareInfo) -> Vec<ModelEntry> {
        let ollama_models = ollama::status(&self.http).await.models;
        let progress = self.progress.lock().map(|p| p.clone()).unwrap_or_default();
        catalog::CATALOG
            .iter()
            .map(|item| {
                let live = progress.get(item.id).filter(|p| {
                    matches!(
                        p.status,
                        ModelStatus::Downloading | ModelStatus::Paused | ModelStatus::Verifying | ModelStatus::Installing | ModelStatus::Failed
                    )
                });
                let (status, installed) = if item.kind == ModelKind::Llm {
                    let tag = item.version;
                    let installed = ollama::has_model(&ollama_models, tag);
                    (if installed { ModelStatus::Installed } else { ModelStatus::NotInstalled }, installed)
                } else {
                    match self.manifest(item) {
                        Some(m) if m.version == item.version => (ModelStatus::Installed, true),
                        Some(_) => (ModelStatus::UpdateAvailable, true),
                        None => (ModelStatus::NotInstalled, false),
                    }
                };
                let status = live.map(|p| p.status).unwrap_or(status);
                ModelEntry {
                    id: item.id.to_string(),
                    kind: item.kind,
                    name: item.name.to_string(),
                    description: item.description.to_string(),
                    engine: item.engine.to_string(),
                    version: item.version.to_string(),
                    size_mb: item.size_mb,
                    ram_mb: item.ram_mb,
                    vram_mb: item.vram_mb,
                    speed: item.speed,
                    quality: item.quality,
                    languages: item.languages.iter().map(|s| s.to_string()).collect(),
                    capabilities: item.capabilities.iter().map(|s| s.to_string()).collect(),
                    license: item.license.to_string(),
                    fit: catalog::fit(item, hw),
                    status,
                    requires: item.requires.map(str::to_string),
                    received: live.map(|p| p.received).unwrap_or(0),
                    total: live.map(|p| p.total).unwrap_or(0),
                    error: live.and_then(|p| p.error.clone()),
                    path: (installed && item.kind != ModelKind::Llm).then(|| self.install_dir(item).display().to_string()),
                }
            })
            .collect()
    }

    fn publish<R: Runtime>(&self, app: &AppHandle<R>, progress: ModelProgress) {
        if let Ok(mut map) = self.progress.lock() {
            map.insert(progress.id.clone(), progress.clone());
        }
        let _ = app.emit(EVENT, progress);
    }

    /// Lance (ou reprend) un téléchargement en tâche de fond ; l'avancement arrive par `voice:model`.
    pub fn start<R: Runtime>(self: &Arc<Self>, app: AppHandle<R>, id: String) -> AppResult<()> {
        let item = catalog::find(&id).ok_or_else(|| AppError::not_found(format!("Modèle inconnu : {id}")))?;
        let flag = {
            let mut running = self.running.lock().map_err(|_| AppError::internal("verrou des téléchargements"))?;
            if running.contains_key(&id) {
                return Ok(());
            }
            let flag = Arc::new(AtomicBool::new(false));
            running.insert(id.clone(), flag.clone());
            flag
        };
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let outcome = me.install(&app, item, &flag).await;
            if let Ok(mut running) = me.running.lock() {
                running.remove(&id);
            }
            let (status, error) = match outcome {
                Ok(()) => (ModelStatus::Installed, None),
                Err(Stop::Paused) => (ModelStatus::Paused, None),
                Err(Stop::Failed(e)) => {
                    tracing::warn!(model = %id, "téléchargement échoué : {}", e.message);
                    (ModelStatus::Failed, Some(e.message))
                }
            };
            let last = me.progress.lock().ok().and_then(|p| p.get(&id).cloned());
            me.publish(
                &app,
                ModelProgress {
                    id: id.clone(),
                    status,
                    received: last.as_ref().map(|p| p.received).unwrap_or(0),
                    total: last.as_ref().map(|p| p.total).unwrap_or(0),
                    step: None,
                    error,
                },
            );
            if status == ModelStatus::Installed {
                if let Ok(mut map) = me.progress.lock() {
                    map.remove(&id);
                }
            }
        });
        Ok(())
    }

    /// Met en pause : les fichiers partiels restent, le prochain téléchargement reprend là.
    pub fn pause(&self, id: &str) {
        if let Ok(running) = self.running.lock() {
            if let Some(flag) = running.get(id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    pub async fn delete(&self, id: &str) -> AppResult<()> {
        self.pause(id);
        let item = catalog::find(id).ok_or_else(|| AppError::not_found(format!("Modèle inconnu : {id}")))?;
        if item.kind == ModelKind::Llm {
            ollama::delete(&self.http, item.version).await?;
        } else {
            let dir = self.install_dir(item);
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| AppError::new(AppErrorCode::Io, format!("Suppression impossible : {e}")))?;
            }
        }
        if let Ok(mut map) = self.progress.lock() {
            map.remove(id);
        }
        Ok(())
    }

    /// Recalcule l'empreinte de chaque fichier installé et la compare au manifeste.
    pub fn verify(&self, id: &str) -> AppResult<()> {
        let item = catalog::find(id).ok_or_else(|| AppError::not_found(format!("Modèle inconnu : {id}")))?;
        if item.kind == ModelKind::Llm {
            return Ok(());
        }
        let manifest = self.manifest(item).ok_or_else(|| AppError::not_found("Modèle non installé."))?;
        let dir = self.install_dir(item);
        for file in &manifest.files {
            let path = dir.join(&file.name);
            // Les archives sont décompressées puis supprimées : seul le contenu reste.
            if !path.exists() {
                continue;
            }
            if sha256_file(&path)? != file.sha256 {
                return Err(AppError::invalid(format!(
                    "{} a été modifié depuis son installation : supprimez-le puis téléchargez-le de nouveau.",
                    file.name
                )));
            }
        }
        if let Some(files) = catalog::files_for(item, std::env::consts::OS, std::env::consts::ARCH) {
            if !files.entry.is_empty() && !dir.join(files.entry).exists() {
                return Err(AppError::invalid(format!("Fichier principal absent : {}.", files.entry)));
            }
        }
        Ok(())
    }

    async fn install<R: Runtime>(&self, app: &AppHandle<R>, item: &'static CatalogItem, stop: &AtomicBool) -> Result<(), Stop> {
        // L'outil nécessaire (whisper.cpp, Piper) passe d'abord.
        if let Some(required) = item.requires.filter(|r| *r != "ollama") {
            if !self.is_installed(required) {
                let runtime = catalog::find(required).ok_or_else(|| AppError::internal("outil introuvable"))?;
                self.install_one(app, runtime, item.id, stop).await?;
            }
        }
        self.install_one(app, item, item.id, stop).await
    }

    async fn install_one<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        item: &'static CatalogItem,
        progress_id: &str,
        stop: &AtomicBool,
    ) -> Result<(), Stop> {
        let step = Some(format!("{} : téléchargement", item.name));
        let files = catalog::files_for(item, std::env::consts::OS, std::env::consts::ARCH).ok_or_else(|| {
            AppError::invalid(format!("{} n'est pas disponible pour ce système.", item.name))
        })?;

        if let [Source::Ollama { tag }] = files.sources {
            let mut last = Instant::now() - Duration::from_secs(1);
            let outcome = ollama::pull(&self.http, tag, stop, |received, total, status| {
                if last.elapsed() >= Duration::from_millis(200) {
                    last = Instant::now();
                    self.publish(
                        app,
                        ModelProgress {
                            id: progress_id.to_string(),
                            status: ModelStatus::Downloading,
                            received,
                            total,
                            step: Some(format!("Ollama : {status}")),
                            error: None,
                        },
                    );
                }
            })
            .await?;
            return match outcome {
                ollama::PullOutcome::Done => Ok(()),
                ollama::PullOutcome::Cancelled => Err(Stop::Paused),
            };
        }

        let dir = self.install_dir(item);
        std::fs::create_dir_all(&dir).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        let mut resolved = Vec::new();
        for source in files.sources {
            resolved.push(self.resolve(source).await?);
        }
        let total: u64 = resolved.iter().map(|r| r.size).sum();
        let mut done = 0u64;
        let mut manifest_files = Vec::new();

        for file in &resolved {
            let target = dir.join(&file.name);
            let part = dir.join(format!("{}.part", file.name));
            self.fetch(app, progress_id, file, &part, done, total, step.clone(), stop).await?;
            self.publish(
                app,
                ModelProgress {
                    id: progress_id.to_string(),
                    status: ModelStatus::Verifying,
                    received: done + file.size,
                    total,
                    step: Some(format!("{} : vérification", item.name)),
                    error: None,
                },
            );
            let digest = sha256_file(&part)?;
            match &file.sha256 {
                Some(expected) if !expected.eq_ignore_ascii_case(&digest) => {
                    let _ = std::fs::remove_file(&part);
                    return Err(Stop::Failed(AppError::invalid(format!(
                        "{} : empreinte différente de celle publiée, fichier supprimé. Réessayez plus tard.",
                        file.name
                    ))));
                }
                Some(_) => {}
                // Petit fichier sans empreinte publiée (configuration JSON) : sa forme est vérifiée.
                None => {
                    let text = std::fs::read_to_string(&part).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
                    if file.name.ends_with(".json") && serde_json::from_str::<serde_json::Value>(&text).is_err() {
                        let _ = std::fs::remove_file(&part);
                        return Err(Stop::Failed(AppError::invalid(format!("{} est illisible.", file.name))));
                    }
                }
            }
            std::fs::rename(&part, &target).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
            if let Some(archive) = file.archive {
                self.publish(
                    app,
                    ModelProgress {
                        id: progress_id.to_string(),
                        status: ModelStatus::Installing,
                        received: done + file.size,
                        total,
                        step: Some(format!("{} : installation", item.name)),
                        error: None,
                    },
                );
                let (from, to) = (target.clone(), dir.clone());
                tauri::async_runtime::spawn_blocking(move || extract(&from, archive, &to))
                    .await
                    .map_err(|e| AppError::internal(e.to_string()))??;
                let _ = std::fs::remove_file(&target);
            }
            manifest_files.push(ManifestFile { name: file.name.clone(), sha256: digest });
            done += file.size;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let entry = dir.join(files.entry);
            if item.kind == ModelKind::Runtime && entry.exists() {
                let _ = std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o755));
            }
        }
        let manifest = Manifest {
            id: item.id.to_string(),
            version: item.version.to_string(),
            files: manifest_files,
            installed_at: chrono::Utc::now().timestamp_millis(),
        };
        let body = serde_json::to_string_pretty(&manifest).map_err(|e| AppError::internal(e.to_string()))?;
        std::fs::write(dir.join(MANIFEST), body).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        Ok(())
    }

    /// Adresse, taille et empreinte attendue d'un fichier du catalogue.
    async fn resolve(&self, source: &Source) -> AppResult<Resolved> {
        match *source {
            Source::Github { url, sha256, size, archive } => Ok(Resolved {
                url: url.to_string(),
                name: catalog::file_name(source).to_string(),
                sha256: Some(sha256.to_string()),
                size,
                archive,
            }),
            Source::HuggingFace { repo, revision, path } => {
                let tree = self
                    .http
                    .get(catalog::hf_tree_url(repo, revision, path))
                    .timeout(Duration::from_secs(30))
                    .send()
                    .await
                    .map_err(|e| AppError::new(AppErrorCode::Network, format!("Hugging Face injoignable ({e}).")))?;
                let tree = super::cloud::read_json(tree)
                    .await
                    .map_err(|e| AppError::new(AppErrorCode::Network, format!("Réponse de Hugging Face illisible ({e}).")))?;
                let (size, sha256) = hf_file_info(&tree, path)
                    .ok_or_else(|| AppError::not_found(format!("{path} introuvable sur Hugging Face.")))?;
                Ok(Resolved {
                    url: catalog::hf_url(repo, revision, path),
                    name: catalog::file_name(source).to_string(),
                    sha256,
                    size,
                    archive: None,
                })
            }
            Source::Ollama { .. } => Err(AppError::internal("source Ollama inattendue")),
        }
    }

    /// Téléchargement vers `part`, en reprenant là où il s'était arrêté (en-tête `Range`).
    #[allow(clippy::too_many_arguments)]
    async fn fetch<R: Runtime>(
        &self,
        app: &AppHandle<R>,
        id: &str,
        file: &Resolved,
        part: &Path,
        before: u64,
        total: u64,
        step: Option<String>,
        stop: &AtomicBool,
    ) -> Result<(), Stop> {
        let mut have = std::fs::metadata(part).map(|m| m.len()).unwrap_or(0);
        if file.size > 0 && have == file.size {
            return Ok(());
        }
        if file.size > 0 && have > file.size {
            let _ = std::fs::remove_file(part);
            have = 0;
        }
        let mut request = self.http.get(&file.url);
        if have > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut response = request
            .send()
            .await
            .map_err(|e| AppError::new(AppErrorCode::Network, format!("Téléchargement impossible ({e}) : vérifiez la connexion.")))?;
        let status = response.status();
        let append = status == reqwest::StatusCode::PARTIAL_CONTENT;
        if !status.is_success() {
            return Err(Stop::Failed(AppError::new(AppErrorCode::Network, format!("{} : le serveur répond {status}.", file.name))));
        }
        if !append {
            have = 0;
        }
        if response.content_length().is_some_and(|len| len + have > MAX_FILE_BYTES) {
            return Err(Stop::Failed(AppError::invalid("Fichier anormalement lourd : téléchargement refusé.")));
        }
        let mut out = std::fs::OpenOptions::new()
            .create(true)
            .append(append)
            .write(true)
            .truncate(!append)
            .open(part)
            .map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        let mut last = Instant::now() - Duration::from_secs(1);
        loop {
            if stop.load(Ordering::Relaxed) {
                return Err(Stop::Paused);
            }
            let chunk = response
                .chunk()
                .await
                .map_err(|e| AppError::new(AppErrorCode::Network, format!("Connexion coupée ({e}) : reprenez le téléchargement.")))?;
            let Some(chunk) = chunk else { break };
            out.write_all(&chunk).map_err(|e| AppError::new(AppErrorCode::Io, format!("Écriture impossible : {e}")))?;
            have += chunk.len() as u64;
            if have > MAX_FILE_BYTES {
                return Err(Stop::Failed(AppError::invalid("Fichier anormalement lourd : téléchargement arrêté.")));
            }
            if last.elapsed() >= Duration::from_millis(200) {
                last = Instant::now();
                self.publish(
                    app,
                    ModelProgress {
                        id: id.to_string(),
                        status: ModelStatus::Downloading,
                        received: before + have,
                        total,
                        step: step.clone(),
                        error: None,
                    },
                );
            }
        }
        out.flush().map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        if file.size > 0 && have != file.size {
            return Err(Stop::Failed(AppError::new(
                AppErrorCode::Network,
                format!("{} incomplet ({have} octets sur {}) : reprenez le téléchargement.", file.name, file.size),
            )));
        }
        Ok(())
    }
}

/// Taille et empreinte SHA-256 (objet LFS) d'un fichier dans la réponse `api/models/…/tree`.
/// Un petit fichier hors LFS n'a pas d'empreinte SHA-256 publiée : `None`.
pub fn hf_file_info(tree: &serde_json::Value, path: &str) -> Option<(u64, Option<String>)> {
    let entry = tree.as_array()?.iter().find(|e| e["path"].as_str() == Some(path))?;
    let lfs = &entry["lfs"];
    let sha = lfs["oid"]
        .as_str()
        .or_else(|| lfs["sha256"].as_str())
        .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .map(str::to_lowercase);
    let size = lfs["size"].as_u64().or_else(|| entry["size"].as_u64()).unwrap_or(0);
    Some((size, sha))
}

pub fn sha256_file(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Décompresse une archive dans `dir` (chemins hors du dossier refusés par les bibliothèques).
fn extract(archive: &Path, kind: Archive, dir: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive).map_err(|e| AppError::new(AppErrorCode::Io, e.to_string()))?;
    match kind {
        Archive::Zip => {
            let mut zip = zip::ZipArchive::new(file).map_err(|e| AppError::invalid(format!("Archive illisible : {e}")))?;
            zip.extract(dir).map_err(|e| AppError::new(AppErrorCode::Io, format!("Décompression impossible : {e}")))
        }
        Archive::TarGz => tar::Archive::new(flate2::read::GzDecoder::new(file))
            .unpack(dir)
            .map_err(|e| AppError::new(AppErrorCode::Io, format!("Décompression impossible : {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hugging_face_metadata_gives_size_and_lfs_sha() {
        let tree = json!([
            { "type": "file", "path": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json", "size": 4886, "oid": "abc" },
            { "type": "file", "path": "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx", "size": 63201294,
              "lfs": { "oid": "A1B2C3D4E5F60718293A4B5C6D7E8F90A1B2C3D4E5F60718293A4B5C6D7E8F90", "size": 63201294, "pointerSize": 135 } }
        ]);
        let (size, sha) = hf_file_info(&tree, "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx").unwrap();
        assert_eq!(size, 63_201_294);
        assert_eq!(sha.as_deref(), Some("a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90"));
        let (size, sha) = hf_file_info(&tree, "fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json").unwrap();
        assert_eq!((size, sha), (4886, None));
        assert!(hf_file_info(&tree, "absent.onnx").is_none());
    }

    #[test]
    fn sha256_of_a_file() {
        let path = std::env::temp_dir().join(format!("archimed-voice-sha-{}", std::process::id()));
        std::fs::write(&path, b"abc").unwrap();
        assert_eq!(sha256_file(&path).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn tar_gz_archives_are_extracted() {
        let root = std::env::temp_dir().join(format!("archimed-voice-tar-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let archive = root.join("tool.tar.gz");
        {
            let file = std::fs::File::create(&archive).unwrap();
            let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::fast()));
            let data = b"#!/bin/sh\necho ok\n";
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder.append_data(&mut header, "piper/piper", &data[..]).unwrap();
            builder.into_inner().unwrap().finish().unwrap();
        }
        extract(&archive, Archive::TarGz, &root).unwrap();
        assert!(root.join("piper/piper").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
