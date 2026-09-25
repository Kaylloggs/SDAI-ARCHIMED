//! Façade du module : relie projets, profils, Java, générateurs et compilation.
//! Testable sans Tauri (aucun `AppHandle` ici).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::core::{AppError, AppResult};

use super::agent::{self, Workspaces};
use super::artwork::{self, Drafts};
use super::content;
use super::export;
use super::files;
use super::gemini::Gemini;
use super::gradle::{self, BuildParams, BuildRegistry, Slot};
use super::importer;
use super::java;
use super::jdk::JdkInstaller;
use super::models;
use super::openrouter::OpenRouter;
use super::pixelart;
use super::porting;
use super::profiles::{self, meta::MetaClient, Profile};
use super::projects::{self, Projects};
use super::snapshots;
use super::types::{ApplyOutcome, Snapshot, WorkChange, WorkInfo};
use super::types::{
    BlockLayout, BlockRequest, BuildEvent, BuildRecord, BuildTask, ContentResult,
    CreateProjectRequest, DraftSource, EntityModel, EntitySaved, EnvironmentReport, ExportOutcome,
    GuiRequest, ImageModel, ImageProvider, ImportPreview, ItemRequest, JavaInstall, JavaStatus,
    JdkNeed, ModelFile, ModelInfo, PixelData, PixelOptions, PortOutcome, PortPlan, ProjectEntry,
    ProjectFile, ProjectMeta, ProjectStats, ProjectSummary, RecipeRequest, ResolvedVersions,
    TextureDraft, TextureInfo, TextureRequest, TextureTarget, ValidationReport, VersionCatalog,
    VersionOptions, VersionSelection,
};
use super::validator;

/// Taille maximale d'un journal renvoyé à l'interface (la fin est gardée).
const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;

pub struct McStudio {
    module_dir: PathBuf,
    pub projects: Projects,
    meta: MetaClient,
    builds: Arc<BuildRegistry>,
    pub jdk: JdkInstaller,
    pub openrouter: OpenRouter,
    pub gemini: Gemini,
    /// Fournisseurs d'images du core (Higgsfield : clé d'API ou compte).
    pub imaging: crate::core::imaging::Imaging,
    drafts: Drafts,
    workspaces: Workspaces,
}

impl McStudio {
    pub fn new(module_dir: PathBuf) -> Self {
        Self {
            projects: Projects::new(&module_dir),
            meta: MetaClient::new(module_dir.join("cache").join("meta")),
            builds: Arc::new(BuildRegistry::default()),
            jdk: JdkInstaller::new(&module_dir),
            openrouter: OpenRouter::new(&module_dir),
            gemini: Gemini::new(&module_dir),
            imaging: crate::core::imaging::Imaging::new(super::ID, &module_dir),
            drafts: Drafts::new(&module_dir),
            workspaces: Workspaces::new(&module_dir),
            module_dir,
        }
    }

    /// JDK de la machine, ceux installés par Mod Studio compris.
    pub fn detect_java(&self) -> Vec<JavaInstall> {
        java::detect(&[self.jdk.dir()])
    }

    /// Versions de Java dont les profils ont besoin, et celles déjà présentes. Une ligne
    /// par version majeure : un seul JDK 17 couvre « 17 ou plus » comme « 17 exactement ».
    pub fn environment(&self) -> EnvironmentReport {
        let installs = self.detect_java();
        let mut needs: BTreeMap<u32, (bool, Vec<String>)> = BTreeMap::new();
        for profile in self.profiles() {
            let entry = needs.entry(profile.java).or_default();
            entry.0 |= profile.java_max == Some(profile.java);
            entry.1.push(profile.label.clone());
        }
        EnvironmentReport {
            needs: needs
                .into_iter()
                .map(|(major, (exact, used_by))| JdkNeed {
                    major,
                    exact,
                    installed: java::choose(&installs, None, major, exact.then_some(major)),
                    used_by,
                })
                .collect(),
            jdks: installs,
            managed_dir: self.jdk.dir().display().to_string(),
        }
    }

    pub fn profiles(&self) -> Vec<Profile> {
        profiles::load_all(&self.module_dir.join("profiles"))
    }

    pub async fn catalog(&self) -> VersionCatalog {
        self.meta.catalog(&self.profiles()).await
    }

    pub async fn resolve(
        &self,
        profile_id: &str,
        minecraft: &str,
        selection: &VersionSelection,
    ) -> AppResult<ResolvedVersions> {
        let profiles = self.profiles();
        let profile = profiles::find(&profiles, profile_id)?;
        self.meta.resolve(profile, minecraft, selection).await
    }

    pub async fn version_options(
        &self,
        profile_id: &str,
        minecraft: &str,
    ) -> AppResult<VersionOptions> {
        let profiles = self.profiles();
        let profile = profiles::find(&profiles, profile_id)?;
        self.meta.options(profile, minecraft).await
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

    /// Examine un projet de mod existant, sans rien écrire.
    pub fn inspect_import(&self, path: &str) -> AppResult<ImportPreview> {
        let root = PathBuf::from(path);
        if !root.is_dir() {
            return Err(AppError::not_found(format!("Dossier introuvable : {path}")));
        }
        Ok(importer::inspect(&root, &self.profiles()))
    }

    /// Importe un projet existant : `.mcstudio/project.json` est écrit, rien d'autre.
    pub fn import_project(&self, path: &str) -> AppResult<ProjectSummary> {
        let root = PathBuf::from(path);
        let all = self.profiles();
        let preview = importer::inspect(&root, &all);
        if let Some(problem) = preview.problem {
            return Err(AppError::invalid(problem));
        }
        let profile = profiles::find(&all, preview.profile_id.as_deref().unwrap_or_default())?;
        let meta = importer::meta_from(&preview, profile, importer::license_of(&root))?;
        self.projects.adopt(&root, &meta)
    }

    /// Exporte les sources du projet dans l'archive `destination` (choisie par la personne).
    pub fn export_zip(&self, project_id: &str, destination: &str) -> AppResult<ExportOutcome> {
        let root = self.projects.root(project_id)?;
        let meta = projects::read_meta(&root)?;
        export::export(&root, &meta, Path::new(destination))
    }

    /// Ce que le portage vers `minecraft` fera (même loader), sans rien écrire.
    pub fn port_plan(&self, project_id: &str, minecraft: &str) -> AppResult<PortPlan> {
        let (_, meta, from) = self.open_context(project_id)?;
        let all = self.profiles();
        let to = porting::target_profile(&all, &meta, minecraft)?;
        Ok(porting::plan(&meta, &from, to, minecraft))
    }

    /// Porte le projet vers `minecraft` : versions résolues (loader, mappings, API), fichiers
    /// de build et de données migrés après un point de restauration ; le code est laissé à
    /// l'assistant IA avec un message prêt.
    pub async fn port_project(&self, project_id: &str, minecraft: &str) -> AppResult<PortOutcome> {
        self.quiet(project_id)?;
        let (root, old, from) = self.open_context(project_id)?;
        let all = self.profiles();
        let to = porting::target_profile(&all, &old, minecraft)?.clone();
        let versions = self
            .meta
            .resolve(&to, minecraft, &VersionSelection::default())
            .await?;
        let mut new = old.clone();
        new.versions = versions;
        let plan = porting::plan(&old, &from, &to, minecraft);
        let changes = porting::changes(&root, &old, &from, &new, &to)?;
        let prompt = porting::assistant_prompt(&old, &new, &to, &plan, &changes)?;
        let snapshot = porting::apply(
            &root,
            &new,
            &changes,
            &format!(
                "Avant le portage de {} vers {minecraft}",
                old.versions.minecraft
            ),
        )?;
        Ok(PortOutcome {
            summary: self.projects.summary(project_id)?,
            snapshot,
            done: changes.done,
            warnings: changes.warnings,
            prompt,
        })
    }

    /// Change les versions du loader (même Minecraft) d'un projet existant.
    pub async fn update_versions(
        &self,
        project_id: &str,
        selection: &VersionSelection,
    ) -> AppResult<ProjectSummary> {
        self.quiet(project_id)?;
        let (root, mut meta, profile) = self.open_context(project_id)?;
        let versions = self
            .meta
            .resolve(&profile, &meta.versions.minecraft, selection)
            .await?;
        projects::apply_versions(&root, &mut meta, versions)?;
        self.projects.summary(project_id)
    }

    pub fn stats(&self, project_id: &str) -> AppResult<ProjectStats> {
        let (root, meta, _) = self.open_context(project_id)?;
        Ok(projects::stats(&root, &meta.mod_id))
    }

    pub fn java_status(&self, project_id: &str) -> AppResult<JavaStatus> {
        let (_, meta, _) = self.open_context(project_id)?;
        Ok(java_status_for(&meta, &self.detect_java()))
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
        Ok(java_status_for(&meta, &self.detect_java()))
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
        let slot = Slot::of(task);
        if self.builds.is_running(project_id, slot) {
            return Err(AppError::invalid(match slot {
                Slot::Main => "Une compilation ou une partie est déjà en cours pour ce projet.",
                Slot::Server => "Le serveur de test de ce projet tourne déjà.",
            }));
        }
        if task == BuildTask::Clean && self.builds.is_running(project_id, Slot::Server) {
            return Err(AppError::invalid(
                "Arrêtez d'abord le serveur de test : il utilise les fichiers compilés.",
            ));
        }
        if task == BuildTask::RunServer && !gradle::eula_accepted(&root) {
            return Err(AppError::invalid(
                "Le serveur de Minecraft demande d'accepter son CLUF : faites-le depuis « Serveur de test ».",
            ));
        }
        gradle::check_wrapper(&root)?;
        let status = java_status_for(&meta, &self.detect_java());
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

    pub fn server_eula(&self, project_id: &str) -> AppResult<bool> {
        Ok(gradle::eula_accepted(&self.projects.root(project_id)?))
    }

    pub fn accept_server_eula(&self, project_id: &str) -> AppResult<()> {
        gradle::accept_eula(&self.projects.root(project_id)?)
    }

    pub fn cancel_build(&self, project_id: &str) -> AppResult<()> {
        self.builds.cancel(project_id)
    }

    /// Arrête le serveur de test (`stop`, puis arrêt forcé s'il le faut).
    pub async fn stop_server(&self, project_id: &str, force: bool) -> AppResult<()> {
        self.builds.stop_server(project_id, force).await
    }

    /// Commande tapée par la personne dans la console du serveur de test.
    pub async fn send_server_command(&self, project_id: &str, command: &str) -> AppResult<()> {
        self.builds.send_server_command(project_id, command).await
    }

    /// Rien ne tourne (compilation, partie, serveur) : les versions ou tous les fichiers
    /// peuvent changer.
    fn quiet(&self, project_id: &str) -> AppResult<()> {
        if self.builds.is_running(project_id, Slot::Server) {
            return Err(AppError::invalid("Arrêtez d'abord le serveur de test."));
        }
        if self.builds.is_running(project_id, Slot::Main) {
            return Err(AppError::invalid(
                "Attendez la fin de la compilation ou de la partie en cours.",
            ));
        }
        Ok(())
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

impl McStudio {
    /// Textures du projet (icône, objets, blocs), présentes ou attendues.
    pub fn textures(&self, project_id: &str) -> AppResult<Vec<TextureInfo>> {
        let (root, meta, _) = self.open_context(project_id)?;
        Ok(artwork::list(&root, &meta.mod_id))
    }

    /// Demande une image au modèle choisi, puis la garde en brouillon converti.
    pub async fn generate_texture(
        self: &Arc<Self>,
        project_id: &str,
        request: TextureRequest,
    ) -> AppResult<TextureDraft> {
        let (root, _, _) = self.open_context(project_id)?;
        let custom = request.custom_prompt.as_deref().map(str::trim);
        if custom.is_none() {
            artwork::validate_description(&request.description)?;
        }
        artwork::validate_prompt(&request.prompt, custom)?;
        artwork::relative_path("mod", &request.target)?;
        pixelart::validate(&request.options)?;
        let reference = match request.reference.clone() {
            Some(relative) => Some(
                tauri::async_runtime::spawn_blocking(move || {
                    artwork::reference_image(&root, &relative)
                })
                .await
                .map_err(|e| AppError::internal(e.to_string()))??,
            ),
            None => None,
        };
        let (models, service) = match request.provider {
            ImageProvider::OpenRouter => (self.openrouter.models().await?.models, "OpenRouter"),
            ImageProvider::Gemini => (self.gemini.models().await?.models, "Google Gemini"),
            ImageProvider::Higgsfield | ImageProvider::HiggsfieldAccount => (
                super::higgsfield::models(&self.imaging, request.provider == ImageProvider::HiggsfieldAccount)
                    .await?
                    .models,
                "Higgsfield",
            ),
        };
        let model = pick_image_model(models, &request, service)?;
        if reference.is_some() && !model.image_input {
            return Err(AppError::invalid(format!(
                "{} ne lit pas d'image en entrée : retirez la référence ou choisissez un autre modèle.",
                model.name
            )));
        }
        let (width, height) = pixelart::output_size(&request.options);
        let prompt = match custom {
            Some(text) => text.to_string(),
            None => {
                let mut settings = request.prompt.clone();
                settings.with_reference = reference.is_some();
                settings.transparent = request.options.transparent;
                if matches!(
                    request.target,
                    TextureTarget::Gui { .. } | TextureTarget::Asset { .. }
                ) {
                    settings.width = Some(width);
                    settings.height = Some(height);
                }
                artwork::prompt_for(&request.target, &request.description, &settings)
            }
        };
        let aspect = pixelart::aspect_ratio(width, height);
        let (result, origin) = match request.provider {
            ImageProvider::OpenRouter => (
                self.openrouter
                    .generate(&model, &prompt, reference.as_deref(), aspect)
                    .await,
                "openrouter",
            ),
            ImageProvider::Gemini => (
                self.gemini
                    .generate(&model, &prompt, reference.as_deref(), aspect)
                    .await,
                "gemini",
            ),
            ImageProvider::Higgsfield | ImageProvider::HiggsfieldAccount => {
                let account = request.provider == ImageProvider::HiggsfieldAccount;
                (
                    super::higgsfield::generate(&self.imaging, account, &model, &prompt, reference.as_deref(), aspect)
                        .await,
                    if account { "higgsfield-account" } else { "higgsfield" },
                )
            }
        };
        crate::core::audit::record(
            "mcstudio.texture_generate",
            &format!(
                "{origin}:{}{}",
                model.id,
                if reference.is_some() {
                    " (avec référence)"
                } else {
                    ""
                }
            ),
            if result.is_ok() { "received" } else { "failed" },
            "user",
        );
        let bytes = result?;
        let source = match request.provider {
            ImageProvider::OpenRouter => DraftSource::OpenRouter {
                model: model.id,
                prompt,
            },
            ImageProvider::Gemini => DraftSource::Gemini {
                model: model.id,
                prompt,
            },
            ImageProvider::Higgsfield | ImageProvider::HiggsfieldAccount => DraftSource::Higgsfield {
                model: model.id,
                prompt,
            },
        };
        let studio = self.clone();
        let project_id = project_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            studio
                .drafts
                .create(&project_id, request.target, source, &bytes, request.options)
        })
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
    }

    /// Image choisie sur le disque → brouillon converti.
    pub fn import_texture(
        &self,
        project_id: &str,
        target: TextureTarget,
        path: &Path,
        options: PixelOptions,
    ) -> AppResult<TextureDraft> {
        self.open_context(project_id)?;
        let size = std::fs::metadata(path)
            .map_err(|_| AppError::not_found(format!("{} est introuvable.", path.display())))?
            .len();
        if size > pixelart::MAX_BYTES as u64 {
            return Err(AppError::invalid("Image trop lourde (32 Mo au plus)."));
        }
        let bytes = std::fs::read(path)?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        self.drafts.create(
            project_id,
            target,
            DraftSource::File { name },
            &bytes,
            options,
        )
    }

    pub fn reprocess_texture(
        &self,
        draft_id: &str,
        options: PixelOptions,
    ) -> AppResult<TextureDraft> {
        self.drafts.reprocess(draft_id, options)
    }

    pub fn apply_texture(&self, project_id: &str, draft_id: &str) -> AppResult<TextureInfo> {
        self.idle(project_id)?;
        let (root, meta, _) = self.open_context(project_id)?;
        self.drafts.apply(draft_id, project_id, &root, &meta.mod_id)
    }

    fn idle(&self, project_id: &str) -> AppResult<()> {
        if self.builds.is_running(project_id, Slot::Main) {
            return Err(AppError::invalid(
                "Attendez la fin de la compilation en cours.",
            ));
        }
        Ok(())
    }

    /// Texture du projet reprise telle quelle dans un brouillon, pour la retoucher.
    pub fn edit_texture(&self, project_id: &str, target: TextureTarget) -> AppResult<TextureDraft> {
        let (root, meta, _) = self.open_context(project_id)?;
        self.drafts
            .open_project_texture(project_id, &root, &meta.mod_id, target)
    }

    /// Propositions déjà faites pour une texture (historique de l'atelier).
    pub fn texture_history(
        &self,
        project_id: &str,
        target: Option<&TextureTarget>,
    ) -> AppResult<Vec<TextureDraft>> {
        self.open_context(project_id)?;
        Ok(self.drafts.history(project_id, target))
    }

    pub fn delete_draft(&self, draft_id: &str) -> AppResult<()> {
        self.drafts.delete(draft_id)
    }

    pub fn draft_pixels(&self, draft_id: &str) -> AppResult<PixelData> {
        self.drafts.pixels(draft_id)
    }

    pub fn save_draft_pixels(&self, draft_id: &str, data: &PixelData) -> AppResult<TextureDraft> {
        self.drafts.save_pixels(draft_id, data)
    }

    /// Répartit les textures d'un bloc sur ses faces (réécrit son modèle).
    pub fn set_block_layout(
        &self,
        project_id: &str,
        block: &str,
        layout: BlockLayout,
        replace_custom: bool,
    ) -> AppResult<Vec<TextureInfo>> {
        self.idle(project_id)?;
        let (root, meta, _) = self.open_context(project_id)?;
        artwork::set_block_layout(&root, &meta.mod_id, block, layout, replace_custom)
    }

    /// Met des textures du mod à la Corbeille (textures en trop, faces inutilisées…).
    pub fn delete_textures(&self, project_id: &str, relatives: &[String]) -> AppResult<usize> {
        self.idle(project_id)?;
        let (root, meta, _) = self.open_context(project_id)?;
        artwork::delete_textures(&root, &meta.mod_id, relatives)
    }

    // ── Modèles 3D ──────────────────────────────────────────────────────────

    pub fn list_models(&self, project_id: &str) -> AppResult<Vec<ModelInfo>> {
        let (root, meta, _) = self.open_context(project_id)?;
        let names = artwork::lang_names(&root, &meta.mod_id);
        Ok(models::list(&root, &meta.mod_id, &names))
    }

    pub fn read_model(&self, project_id: &str, reference: &str) -> AppResult<ModelFile> {
        let (root, meta, _) = self.open_context(project_id)?;
        models::read_model(&root, &meta.mod_id, reference)
    }

    pub fn save_model(
        &self,
        project_id: &str,
        reference: &str,
        json: &str,
        create: bool,
    ) -> AppResult<String> {
        self.idle(project_id)?;
        let (root, meta, _) = self.open_context(project_id)?;
        models::save_model(&root, &meta.mod_id, reference, json, create)
    }

    pub fn read_entity_model(&self, project_id: &str, name: &str) -> AppResult<EntityModel> {
        let (root, _, _) = self.open_context(project_id)?;
        models::read_entity(&root, name)
    }

    pub fn save_entity_model(
        &self,
        project_id: &str,
        model: &EntityModel,
    ) -> AppResult<EntitySaved> {
        self.idle(project_id)?;
        let (root, meta, profile) = self.open_context(project_id)?;
        models::save_entity(&root, &meta, &profile, model)
    }

    /// Code Java du modèle d'entité, sans rien écrire (aperçu).
    pub fn entity_model_code(&self, project_id: &str, model: &EntityModel) -> AppResult<String> {
        let (_, meta, profile) = self.open_context(project_id)?;
        models::validate_entity(model)?;
        models::entity_java(model, &meta, &profile)
    }

    pub fn texture_pixels(&self, project_id: &str, relative: &str) -> AppResult<PixelData> {
        let (root, meta, _) = self.open_context(project_id)?;
        models::texture_pixels(&root, &meta.mod_id, relative)
    }

    pub fn save_texture_pixels(
        &self,
        project_id: &str,
        relative: &str,
        data: &PixelData,
    ) -> AppResult<()> {
        self.idle(project_id)?;
        let (root, meta, _) = self.open_context(project_id)?;
        models::save_texture_pixels(&root, &meta.mod_id, relative, data)
    }

    /// Nouvel élément d'interface (`textures/gui/`), dessiné aux couleurs du jeu.
    pub fn create_gui_texture(
        &self,
        project_id: &str,
        request: &GuiRequest,
    ) -> AppResult<TextureInfo> {
        let (root, meta, _) = self.open_context(project_id)?;
        artwork::create_gui(&root, &meta.mod_id, request)
    }
}

impl McStudio {
    pub fn list_files(&self, project_id: &str, dir: &str) -> AppResult<Vec<ProjectEntry>> {
        files::list(&self.projects.root(project_id)?, dir)
    }

    pub fn read_file(&self, project_id: &str, path: &str) -> AppResult<ProjectFile> {
        files::read(&self.projects.root(project_id)?, path)
    }

    pub fn write_file(
        &self,
        project_id: &str,
        path: &str,
        content: &str,
        expected_modified: Option<u64>,
    ) -> AppResult<ProjectFile> {
        files::write(
            &self.projects.root(project_id)?,
            path,
            content,
            expected_modified,
        )
    }

    pub fn create_file(
        &self,
        project_id: &str,
        path: &str,
        directory: bool,
    ) -> AppResult<ProjectEntry> {
        files::create(&self.projects.root(project_id)?, path, directory)
    }

    pub fn rename_file(&self, project_id: &str, from: &str, to: &str) -> AppResult<()> {
        files::rename(&self.projects.root(project_id)?, from, to)
    }

    pub fn trash_file(&self, project_id: &str, path: &str) -> AppResult<()> {
        files::trash(&self.projects.root(project_id)?, path)
    }

    /// Copie de travail de l'agent, à jour des fichiers qu'il n'a pas touchés.
    pub fn agent_prepare(&self, project_id: &str) -> AppResult<WorkInfo> {
        self.workspaces
            .prepare(&self.projects.root(project_id)?, project_id)
    }

    /// Consignes de l'agent pour ce projet (version, loader, règles d'API et de données).
    pub fn agent_instructions(&self, project_id: &str) -> AppResult<String> {
        let (root, meta, profile) = self.open_context(project_id)?;
        Ok(agent::instructions(&profile, &meta, &root))
    }

    pub fn agent_changes(&self, project_id: &str) -> AppResult<Vec<WorkChange>> {
        self.workspaces
            .changes(&self.projects.root(project_id)?, project_id)
    }

    pub fn agent_apply(&self, project_id: &str, paths: &[String]) -> AppResult<ApplyOutcome> {
        if self.builds.is_running(project_id, Slot::Main) {
            return Err(AppError::invalid(
                "Attendez la fin de la compilation en cours.",
            ));
        }
        self.workspaces
            .apply(&self.projects.root(project_id)?, project_id, paths)
    }

    pub fn agent_discard(&self, project_id: &str, paths: &[String]) -> AppResult<()> {
        self.workspaces
            .discard(&self.projects.root(project_id)?, project_id, paths)
    }

    pub fn agent_reset(&self, project_id: &str) -> AppResult<WorkInfo> {
        self.workspaces
            .reset(&self.projects.root(project_id)?, project_id)
    }

    pub fn snapshots(&self, project_id: &str) -> AppResult<Vec<Snapshot>> {
        Ok(snapshots::list(&self.projects.root(project_id)?))
    }

    /// Point de restauration manuel : tous les fichiers du projet.
    pub fn create_snapshot(&self, project_id: &str, label: &str) -> AppResult<Snapshot> {
        let label = if label.trim().is_empty() {
            "Point de restauration"
        } else {
            label
        };
        snapshots::create_full(&self.projects.root(project_id)?, label)
    }

    pub fn restore_snapshot(&self, project_id: &str, snapshot_id: &str) -> AppResult<Snapshot> {
        self.quiet(project_id)?;
        snapshots::restore(&self.projects.root(project_id)?, snapshot_id)
    }

    pub fn delete_snapshot(&self, project_id: &str, snapshot_id: &str) -> AppResult<()> {
        snapshots::delete(&self.projects.root(project_id)?, snapshot_id)
    }

    /// Vérifie le projet sans compiler (formats de la version, références, syntaxe).
    pub fn validate(&self, project_id: &str) -> AppResult<ValidationReport> {
        let context = self.generator(project_id)?;
        Ok(validator::validate(
            &context.root,
            &context.mod_id,
            context.data_format,
        ))
    }
}

/// Modèle demandé, s'il est encore proposé par le service ; un modèle payant exige l'accord
/// explicite de la personne (tous ceux de Google Gemini le sont).
fn pick_image_model(
    models: Vec<ImageModel>,
    request: &TextureRequest,
    service: &str,
) -> AppResult<ImageModel> {
    let model = models
        .into_iter()
        .find(|m| m.id == request.model)
        .ok_or_else(|| {
            AppError::not_found(format!(
                "« {} » ne produit pas d'images sur {service} : rechargez la liste des modèles.",
                request.model
            ))
        })?;
    if !model.free && !request.allow_paid {
        let rule = match request.provider {
            ImageProvider::OpenRouter => "autorisez les modèles payants pour l'utiliser",
            ImageProvider::Gemini => "acceptez la facturation Google pour l'utiliser",
            ImageProvider::Higgsfield | ImageProvider::HiggsfieldAccount => {
                "acceptez que Higgsfield débite vos crédits pour l'utiliser"
            }
        };
        return Err(AppError::invalid(format!(
            "{} est payant : {rule}.",
            model.name
        )));
    }
    Ok(model)
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
