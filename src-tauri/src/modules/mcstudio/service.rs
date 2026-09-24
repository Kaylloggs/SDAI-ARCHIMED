//! Façade du module : relie projets, profils, Java, générateurs et compilation.
//! Testable sans Tauri (aucun `AppHandle` ici).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::core::{AppError, AppResult};

use super::content;
use super::gradle::{self, BuildParams, BuildRegistry};
use super::java;
use super::profiles::{self, meta::MetaClient, Profile};
use super::projects::{self, Projects};
use super::types::{
    BlockRequest, BuildEvent, BuildRecord, BuildTask, ContentResult, CreateProjectRequest,
    ItemRequest, JavaInstall, JavaStatus, ProjectMeta, ProjectStats, ProjectSummary, RecipeRequest,
    ResolvedVersions, VersionCatalog,
};

/// Taille maximale d'un journal renvoyé à l'interface (la fin est gardée).
const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;

pub struct McStudio {
    module_dir: PathBuf,
    pub projects: Projects,
    meta: MetaClient,
    builds: Arc<BuildRegistry>,
}

impl McStudio {
    pub fn new(module_dir: PathBuf) -> Self {
        Self {
            projects: Projects::new(&module_dir),
            meta: MetaClient::new(module_dir.join("cache").join("meta")),
            builds: Arc::new(BuildRegistry::default()),
            module_dir,
        }
    }

    pub fn profiles(&self) -> Vec<Profile> {
        profiles::load_all(&self.module_dir.join("profiles"))
    }

    pub async fn catalog(&self) -> VersionCatalog {
        self.meta.catalog(&self.profiles()).await
    }

    pub async fn resolve(&self, profile_id: &str, minecraft: &str) -> AppResult<ResolvedVersions> {
        let profiles = self.profiles();
        let profile = profiles::find(&profiles, profile_id)?;
        self.meta.resolve(profile, minecraft).await
    }

    pub fn create(&self, request: &CreateProjectRequest) -> AppResult<ProjectSummary> {
        self.projects.create(&self.profiles(), request)
    }

    /// Projet, son dossier et son profil.
    pub fn open_context(&self, project_id: &str) -> AppResult<(PathBuf, ProjectMeta, Profile)> {
        let root = self.projects.root(project_id)?;
        let meta = projects::read_meta(&root)?;
        let profiles = self.profiles();
        let profile = profiles::find(&profiles, &meta.versions.profile_id)
            .map_err(|_| {
                AppError::not_found(format!(
                    "Le profil « {} » de ce projet n'existe plus dans cette version d'ARCHIMED.",
                    meta.versions.profile_id
                ))
            })?
            .clone();
        Ok((root, meta, profile))
    }

    pub fn stats(&self, project_id: &str) -> AppResult<ProjectStats> {
        let (root, meta, _) = self.open_context(project_id)?;
        Ok(projects::stats(&root, &meta.mod_id))
    }

    pub fn java_status(&self, project_id: &str) -> AppResult<JavaStatus> {
        let (_, meta, _) = self.open_context(project_id)?;
        Ok(java_status_for(&meta, &java::detect()))
    }

    /// Mémorise le JDK d'un projet (`None` = détection automatique).
    pub fn set_java_home(
        &self,
        project_id: &str,
        java_home: Option<String>,
    ) -> AppResult<JavaStatus> {
        let (root, mut meta, _) = self.open_context(project_id)?;
        if let Some(path) = &java_home {
            let install = java::inspect(Path::new(path)).ok_or_else(|| {
                AppError::invalid(
                    "Ce dossier n'est pas un JDK (bin/javac et fichier release attendus).",
                )
            })?;
            if !java::compatible(&install, meta.versions.java, meta.versions.java_max) {
                return Err(AppError::invalid(format!(
                    "Ce JDK est en Java {} : {}",
                    install.major,
                    java::missing_message(meta.versions.java, meta.versions.java_max)
                )));
            }
            meta.java_home = Some(install.path);
        } else {
            meta.java_home = None;
        }
        let mut body = serde_json::to_string_pretty(&meta)?;
        body.push('\n');
        super::fsutil::write_atomic(&projects::meta_path(&root), body.as_bytes())?;
        Ok(java_status_for(&meta, &java::detect()))
    }

    fn generator(&self, project_id: &str) -> AppResult<content::GenContext> {
        let (root, meta, profile) = self.open_context(project_id)?;
        Ok(projects::gen_context(&profile, &meta, &root))
    }

    pub fn add_item(&self, project_id: &str, request: &ItemRequest) -> AppResult<ContentResult> {
        content::add_item(&self.generator(project_id)?, request)
    }

    pub fn add_block(&self, project_id: &str, request: &BlockRequest) -> AppResult<ContentResult> {
        content::add_block(&self.generator(project_id)?, request)
    }

    pub fn add_recipe(
        &self,
        project_id: &str,
        request: &RecipeRequest,
    ) -> AppResult<ContentResult> {
        content::add_recipe(&self.generator(project_id)?, request)
    }

    /// Vérifie tout ce qui peut l'être avant de lancer Gradle, puis prépare la compilation.
    pub fn prepare_build(
        &self,
        project_id: &str,
        task: BuildTask,
        offline: bool,
    ) -> AppResult<BuildParams> {
        let (root, meta, _) = self.open_context(project_id)?;
        if self.builds.is_running(project_id) {
            return Err(AppError::invalid(
                "Une compilation est déjà en cours pour ce projet.",
            ));
        }
        gradle::check_wrapper(&root)?;
        let status = java_status_for(&meta, &java::detect());
        let java = status
            .install
            .ok_or_else(|| AppError::not_found(status.problem.unwrap_or_default()))?;
        Ok(BuildParams {
            project_id: project_id.to_string(),
            root,
            java,
            task,
            offline,
            mod_id: meta.mod_id,
            mod_version: meta.mod_version,
            loader: meta.versions.loader,
            minecraft: meta.versions.minecraft,
        })
    }

    /// Lance la compilation préparée ; le résultat arrive par `emit`.
    pub async fn build(
        &self,
        params: BuildParams,
        build_id: String,
        emit: impl Fn(BuildEvent) + Send + Sync + 'static,
    ) -> BuildRecord {
        let target = params.root.display().to_string();
        let record = gradle::run(self.builds.clone(), params, build_id, emit).await;
        crate::core::audit::record(
            "mcstudio.gradle",
            &format!("{} ({target})", record.command),
            &format!("{:?}", record.status).to_lowercase(),
            "user",
        );
        record
    }

    pub fn cancel_build(&self, project_id: &str) -> AppResult<()> {
        self.builds.cancel(project_id)
    }

    pub fn builds(&self, project_id: &str) -> AppResult<Vec<BuildRecord>> {
        Ok(gradle::history(&self.projects.root(project_id)?))
    }

    pub fn build_log(&self, project_id: &str, build_id: &str) -> AppResult<String> {
        if !build_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(AppError::invalid("identifiant de build invalide"));
        }
        let path = gradle::log_path(&self.projects.root(project_id)?, build_id);
        let bytes = std::fs::read(&path)
            .map_err(|_| AppError::not_found("Journal de build introuvable."))?;
        let start = bytes.len().saturating_sub(MAX_LOG_BYTES);
        Ok(String::from_utf8_lossy(&bytes[start..]).to_string())
    }
}

/// JDK à utiliser pour ce projet : celui qu'il a mémorisé, sinon le meilleur détecté.
pub fn java_status_for(meta: &ProjectMeta, installs: &[JavaInstall]) -> JavaStatus {
    let (min, max) = (meta.versions.java, meta.versions.java_max);
    let install = java::choose(installs, meta.java_home.as_deref(), min, max);
    JavaStatus {
        problem: install.is_none().then(|| java::missing_message(min, max)),
        install,
        min,
        max,
    }
}

/// Dossier proposé pour les nouveaux projets.
pub fn default_parent_dir() -> String {
    crate::core::paths::dirs_home()
        .map(|home| home.join("ArchimedMods"))
        .unwrap_or_else(|| PathBuf::from("ArchimedMods"))
        .display()
        .to_string()
}
