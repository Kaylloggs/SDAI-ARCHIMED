use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::core::{AppError, AppResult};

use super::artwork;
use super::java;
use super::service::{self, McStudio};
use super::types::{
    BlockRequest, BuildEvent, BuildRecord, BuildTask, ContentResult, CreateProjectRequest,
    EnvironmentReport, GeminiStatus, ImageModelList, InstallEvent, ItemRequest, JavaInstall,
    JavaStatus, JdkOffer, OpenRouterStatus, PixelOptions, ProjectEntry, ProjectFile, ProjectStats,
    ProjectSummary, RecipeRequest, ResolvedVersions, TextureDraft, TextureInfo, TextureRequest,
    TextureTarget, ValidationReport, VersionCatalog, VersionOptions, VersionSelection,
};

use super::types::{ApplyOutcome, Snapshot, WorkChange, WorkInfo};
use super::types::{BlockLayout, GuiRequest, HiggsfieldCliState, PixelData, PromptSettings};
use crate::core::imaging::ProviderStatus;
use super::types::{
    EntityModel, EntitySaved, ExportOutcome, ImportPreview, ModelFile, ModelInfo, PortOutcome,
    PortPlan,
};

type Studio<'a> = State<'a, Arc<McStudio>>;

/// Exécute un travail disque hors du thread asynchrone (guidelines §10).
async fn blocking<T: Send + 'static>(
    studio: &Arc<McStudio>,
    work: impl FnOnce(&McStudio) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let studio = studio.clone();
    tauri::async_runtime::spawn_blocking(move || work(&studio))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn list_projects(studio: Studio<'_>) -> AppResult<Vec<ProjectSummary>> {
    blocking(&studio, |s| Ok(s.projects.list())).await
}

#[tauri::command]
pub async fn get_project(studio: Studio<'_>, id: String) -> AppResult<ProjectSummary> {
    blocking(&studio, move |s| s.projects.summary(&id)).await
}

#[tauri::command]
pub async fn create_project(
    studio: Studio<'_>,
    request: CreateProjectRequest,
) -> AppResult<ProjectSummary> {
    blocking(&studio, move |s| s.create(&request)).await
}

#[tauri::command]
pub async fn open_project(studio: Studio<'_>, path: String) -> AppResult<ProjectSummary> {
    blocking(&studio, move |s| {
        s.projects.open(std::path::Path::new(&path))
    })
    .await
}

#[tauri::command]
pub async fn duplicate_project(studio: Studio<'_>, id: String) -> AppResult<ProjectSummary> {
    blocking(&studio, move |s| s.projects.duplicate(&id)).await
}

#[tauri::command]
pub async fn remove_project(studio: Studio<'_>, id: String, delete_files: bool) -> AppResult<()> {
    blocking(&studio, move |s| s.projects.remove(&id, delete_files)).await
}

#[tauri::command]
pub async fn version_catalog(studio: Studio<'_>) -> AppResult<VersionCatalog> {
    Ok(studio.catalog().await)
}

/// Versions exactes ; `selection` = choix de la personne (sinon versions recommandées).
#[tauri::command]
pub async fn resolve_versions(
    studio: Studio<'_>,
    profile_id: String,
    minecraft: String,
    selection: Option<VersionSelection>,
) -> AppResult<ResolvedVersions> {
    studio
        .resolve(&profile_id, &minecraft, &selection.unwrap_or_default())
        .await
}

/// Toutes les versions du loader, des mappings et de l'API publiées pour ce Minecraft.
#[tauri::command]
pub async fn version_options(
    studio: Studio<'_>,
    profile_id: String,
    minecraft: String,
) -> AppResult<VersionOptions> {
    studio.version_options(&profile_id, &minecraft).await
}

#[tauri::command]
pub async fn detect_java(studio: Studio<'_>) -> AppResult<Vec<JavaInstall>> {
    blocking(&studio, |s| Ok(s.detect_java())).await
}

/// Java demandé par chaque profil, et ce qui est déjà installé.
#[tauri::command]
pub async fn environment(studio: Studio<'_>) -> AppResult<EnvironmentReport> {
    blocking(&studio, |s| Ok(s.environment())).await
}

/// Ce qui serait téléchargé pour installer Java `major` (rien n'est encore téléchargé).
#[tauri::command]
pub async fn jdk_offer(studio: Studio<'_>, major: u32) -> AppResult<JdkOffer> {
    studio.jdk.offer(major).await
}

/// Télécharge et installe le JDK confirmé par la personne ; l'avancement arrive par `on_event`.
#[tauri::command]
pub async fn install_jdk(
    studio: Studio<'_>,
    offer: JdkOffer,
    on_event: Channel<InstallEvent>,
) -> AppResult<()> {
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn(async move {
        let emit = |event: InstallEvent| {
            let _ = on_event.send(event);
        };
        match studio.jdk.install(&offer, &emit).await {
            Ok(install) => emit(InstallEvent::Done { install }),
            Err(error) => emit(InstallEvent::Failed {
                message: error.message,
            }),
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn cancel_jdk_install(studio: Studio<'_>, major: u32) -> AppResult<()> {
    studio.jdk.cancel(major);
    Ok(())
}

/// Lit un dossier choisi à la main : `None` si ce n'est pas un JDK.
#[tauri::command]
pub async fn inspect_java(path: String) -> AppResult<Option<JavaInstall>> {
    tauri::async_runtime::spawn_blocking(move || java::inspect(std::path::Path::new(&path)))
        .await
        .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn project_java(studio: Studio<'_>, id: String) -> AppResult<JavaStatus> {
    blocking(&studio, move |s| s.java_status(&id)).await
}

#[tauri::command]
pub async fn set_project_java(
    studio: Studio<'_>,
    id: String,
    java_home: Option<String>,
) -> AppResult<JavaStatus> {
    blocking(&studio, move |s| s.set_java_home(&id, java_home)).await
}

/// Change les versions du loader, de Yarn ou de Fabric API d'un projet existant.
#[tauri::command]
pub async fn update_project_versions(
    studio: Studio<'_>,
    id: String,
    selection: VersionSelection,
) -> AppResult<ProjectSummary> {
    studio.update_versions(&id, &selection).await
}

/// Ce que le portage vers une autre version de Minecraft fera.
#[tauri::command]
pub async fn port_plan(studio: Studio<'_>, id: String, minecraft: String) -> AppResult<PortPlan> {
    blocking(&studio, move |s| s.port_plan(&id, &minecraft)).await
}

/// Porte le projet (point de restauration avant) ; renvoie le message pour l'assistant IA.
#[tauri::command]
pub async fn port_project(
    studio: Studio<'_>,
    id: String,
    minecraft: String,
) -> AppResult<PortOutcome> {
    studio.port_project(&id, &minecraft).await
}

#[tauri::command]
pub async fn project_stats(studio: Studio<'_>, id: String) -> AppResult<ProjectStats> {
    blocking(&studio, move |s| s.stats(&id)).await
}

#[tauri::command]
pub async fn default_parent_dir() -> AppResult<String> {
    Ok(service::default_parent_dir())
}

#[tauri::command]
pub async fn add_item(
    studio: Studio<'_>,
    id: String,
    request: ItemRequest,
) -> AppResult<ContentResult> {
    blocking(&studio, move |s| s.add_item(&id, &request)).await
}

#[tauri::command]
pub async fn add_block(
    studio: Studio<'_>,
    id: String,
    request: BlockRequest,
) -> AppResult<ContentResult> {
    blocking(&studio, move |s| s.add_block(&id, &request)).await
}

#[tauri::command]
pub async fn add_recipe(
    studio: Studio<'_>,
    id: String,
    request: RecipeRequest,
) -> AppResult<ContentResult> {
    blocking(&studio, move |s| s.add_recipe(&id, &request)).await
}

/// Lance Gradle et rend la main aussitôt ; la suite arrive par `on_event`.
#[tauri::command]
pub async fn build_project(
    studio: Studio<'_>,
    id: String,
    task: BuildTask,
    offline: bool,
    on_event: Channel<BuildEvent>,
) -> AppResult<String> {
    let params = blocking(&studio, move |s| s.prepare_build(&id, task, offline)).await?;
    let build_id = uuid::Uuid::new_v4().to_string();
    let studio = studio.inner().clone();
    let returned = build_id.clone();
    tauri::async_runtime::spawn(async move {
        studio
            .build(params, build_id, move |event| {
                let _ = on_event.send(event);
            })
            .await;
    });
    Ok(returned)
}

#[tauri::command]
pub async fn cancel_build(studio: Studio<'_>, id: String) -> AppResult<()> {
    studio.cancel_build(&id)
}

/// Arrête le serveur de test : `stop` (monde enregistré), ou tout de suite si `force`.
#[tauri::command]
pub async fn stop_server(studio: Studio<'_>, id: String, force: bool) -> AppResult<()> {
    studio.stop_server(&id, force).await
}

/// Envoie une commande à la console du serveur de test.
#[tauri::command]
pub async fn send_server_command(studio: Studio<'_>, id: String, command: String) -> AppResult<()> {
    studio.send_server_command(&id, &command).await
}

#[tauri::command]
pub async fn list_builds(studio: Studio<'_>, id: String) -> AppResult<Vec<BuildRecord>> {
    blocking(&studio, move |s| s.builds(&id)).await
}

#[tauri::command]
pub async fn read_build_log(studio: Studio<'_>, id: String, build_id: String) -> AppResult<String> {
    blocking(&studio, move |s| s.build_log(&id, &build_id)).await
}

// ── Textures (OpenRouter) ───────────────────────────────────────────────────

/// Clé présente ? Avec `check`, OpenRouter est interrogé (crédit, compte gratuit).
#[tauri::command]
pub async fn openrouter_status(studio: Studio<'_>, check: bool) -> AppResult<OpenRouterStatus> {
    studio.openrouter.status(check).await
}

/// Vérifie la clé auprès d'OpenRouter puis la range dans le Gestionnaire d'identifiants.
#[tauri::command]
pub async fn set_openrouter_key(studio: Studio<'_>, key: String) -> AppResult<OpenRouterStatus> {
    studio.openrouter.set_key(&key).await
}

#[tauri::command]
pub async fn clear_openrouter_key(studio: Studio<'_>) -> AppResult<()> {
    studio.openrouter.clear_key()
}

#[tauri::command]
pub async fn image_models(studio: Studio<'_>) -> AppResult<ImageModelList> {
    studio.openrouter.models().await
}

// ── Textures (Google Gemini) ────────────────────────────────────────────────

/// Clé présente ? Avec `check`, l'API Gemini est interrogée (modèles d'image ouverts).
#[tauri::command]
pub async fn gemini_status(studio: Studio<'_>, check: bool) -> AppResult<GeminiStatus> {
    studio.gemini.status(check).await
}

/// Vérifie la clé Google AI Studio puis la range dans le Gestionnaire d'identifiants.
#[tauri::command]
pub async fn set_gemini_key(studio: Studio<'_>, key: String) -> AppResult<GeminiStatus> {
    studio.gemini.set_key(&key).await
}

#[tauri::command]
pub async fn clear_gemini_key(studio: Studio<'_>) -> AppResult<()> {
    studio.gemini.clear_key()
}

#[tauri::command]
pub async fn gemini_image_models(studio: Studio<'_>) -> AppResult<ImageModelList> {
    studio.gemini.models().await
}

// ── Textures (Higgsfield, couche d'images du core) ──────────────────────────

fn higgsfield(studio: &McStudio, account: bool) -> AppResult<std::sync::Arc<dyn crate::core::imaging::ImageProvider>> {
    studio.imaging.provider(super::higgsfield::provider_id(account))
}

/// État de la clé d'API (`account = false`) ou du compte (`true`). La clé ne revient jamais.
#[tauri::command]
pub async fn higgsfield_status(studio: Studio<'_>, account: bool, check: bool) -> AppResult<ProviderStatus> {
    Ok(higgsfield(&studio, account)?.status(check).await)
}

/// Vérifie la clé auprès de Higgsfield puis la range sous `mcstudio-higgsfield`.
#[tauri::command]
pub async fn set_higgsfield_key(studio: Studio<'_>, key: String) -> AppResult<ProviderStatus> {
    higgsfield(&studio, false)?.set_key(&key).await
}

/// Retire la clé propre à Mod Studio (`account = false`) ou déconnecte le compte (`true`).
#[tauri::command]
pub async fn clear_higgsfield_key(studio: Studio<'_>, account: bool) -> AppResult<ProviderStatus> {
    let provider = higgsfield(&studio, account)?;
    provider.clear_key()?;
    Ok(provider.status(true).await)
}

/// Connexion au compte : la page officielle s'ouvre dans le navigateur (aucun mot de passe ici).
#[tauri::command]
pub async fn higgsfield_login(studio: Studio<'_>) -> AppResult<ProviderStatus> {
    higgsfield(&studio, true)?.login().await
}

#[tauri::command]
pub async fn higgsfield_cli_state() -> AppResult<HiggsfieldCliState> {
    use crate::core::imaging::higgsfield_cli;
    Ok(HiggsfieldCliState {
        installed: higgsfield_cli::find_binary().is_some(),
        npm: higgsfield_cli::npm_available(),
        package: higgsfield_cli::NPM_PACKAGE.into(),
    })
}

/// `npm install -g @higgsfield/cli`, lancé seulement après confirmation dans l'interface.
#[tauri::command]
pub async fn install_higgsfield_tool() -> AppResult<String> {
    let output = crate::core::imaging::higgsfield_cli::install().await?;
    crate::core::audit::record("mcstudio.install_higgsfield_cli", "@higgsfield/cli", "installed", "user");
    Ok(output)
}

#[tauri::command]
pub async fn higgsfield_image_models(studio: Studio<'_>, account: bool) -> AppResult<ImageModelList> {
    super::higgsfield::models(&studio.imaging, account).await
}

/// Texte exact envoyé au modèle, montré (et modifiable) avant l'envoi.
#[tauri::command]
pub async fn texture_prompt(
    target: TextureTarget,
    description: String,
    settings: PromptSettings,
) -> AppResult<String> {
    Ok(artwork::prompt_for(&target, &description, &settings))
}

/// Texture du projet reprise dans un brouillon, pour la retoucher au pixel.
#[tauri::command]
pub async fn edit_texture(
    studio: Studio<'_>,
    id: String,
    target: TextureTarget,
) -> AppResult<TextureDraft> {
    blocking(&studio, move |s| s.edit_texture(&id, target)).await
}

/// Propositions déjà faites pour une texture (ou pour tout le projet).
#[tauri::command]
pub async fn texture_history(
    studio: Studio<'_>,
    id: String,
    target: Option<TextureTarget>,
) -> AppResult<Vec<TextureDraft>> {
    blocking(&studio, move |s| s.texture_history(&id, target.as_ref())).await
}

/// Retire une proposition de l'historique.
#[tauri::command]
pub async fn delete_draft(studio: Studio<'_>, draft_id: String) -> AppResult<()> {
    blocking(&studio, move |s| s.delete_draft(&draft_id)).await
}

#[tauri::command]
pub async fn draft_pixels(studio: Studio<'_>, draft_id: String) -> AppResult<PixelData> {
    blocking(&studio, move |s| s.draft_pixels(&draft_id)).await
}

/// Retouches de l'éditeur (même taille que la texture).
#[tauri::command]
pub async fn save_draft_pixels(
    studio: Studio<'_>,
    draft_id: String,
    data: PixelData,
) -> AppResult<TextureDraft> {
    blocking(&studio, move |s| s.save_draft_pixels(&draft_id, &data)).await
}

/// Répartition des textures d'un bloc sur ses faces (point de restauration avant).
#[tauri::command]
pub async fn set_block_layout(
    studio: Studio<'_>,
    id: String,
    block: String,
    layout: BlockLayout,
    replace_custom: bool,
) -> AppResult<Vec<TextureInfo>> {
    blocking(&studio, move |s| {
        s.set_block_layout(&id, &block, layout, replace_custom)
    })
    .await
}

/// Met des textures du mod à la Corbeille ; renvoie le nombre de fichiers retirés.
#[tauri::command]
pub async fn delete_textures(
    studio: Studio<'_>,
    id: String,
    paths: Vec<String>,
) -> AppResult<usize> {
    blocking(&studio, move |s| s.delete_textures(&id, &paths)).await
}

/// Examine un projet de mod existant (Fabric, Forge, NeoForge) avant de l'importer.
#[tauri::command]
pub async fn inspect_import(studio: Studio<'_>, path: String) -> AppResult<ImportPreview> {
    blocking(&studio, move |s| s.inspect_import(&path)).await
}

/// Importe un projet existant (n'écrit que `.mcstudio/project.json`).
#[tauri::command]
pub async fn import_project(studio: Studio<'_>, path: String) -> AppResult<ProjectSummary> {
    blocking(&studio, move |s| s.import_project(&path)).await
}

/// Exporte les sources du projet en archive ZIP (destination choisie dans le dialogue).
#[tauri::command]
pub async fn export_zip(
    studio: Studio<'_>,
    id: String,
    destination: String,
) -> AppResult<ExportOutcome> {
    blocking(&studio, move |s| s.export_zip(&id, &destination)).await
}

/// Le CLUF de Minecraft est-il accepté pour le serveur de test ?
#[tauri::command]
pub async fn server_eula(studio: Studio<'_>, id: String) -> AppResult<bool> {
    blocking(&studio, move |s| s.server_eula(&id)).await
}

/// Accepte le CLUF de Minecraft pour le serveur de test (geste de la personne).
#[tauri::command]
pub async fn accept_server_eula(studio: Studio<'_>, id: String) -> AppResult<()> {
    blocking(&studio, move |s| s.accept_server_eula(&id)).await
}

#[tauri::command]
pub async fn list_models(studio: Studio<'_>, id: String) -> AppResult<Vec<ModelInfo>> {
    blocking(&studio, move |s| s.list_models(&id)).await
}

#[tauri::command]
pub async fn read_model(studio: Studio<'_>, id: String, reference: String) -> AppResult<ModelFile> {
    blocking(&studio, move |s| s.read_model(&id, &reference)).await
}

#[tauri::command]
pub async fn save_model(
    studio: Studio<'_>,
    id: String,
    reference: String,
    json: String,
    create: bool,
) -> AppResult<String> {
    blocking(&studio, move |s| {
        s.save_model(&id, &reference, &json, create)
    })
    .await
}

#[tauri::command]
pub async fn read_entity_model(
    studio: Studio<'_>,
    id: String,
    name: String,
) -> AppResult<EntityModel> {
    blocking(&studio, move |s| s.read_entity_model(&id, &name)).await
}

#[tauri::command]
pub async fn save_entity_model(
    studio: Studio<'_>,
    id: String,
    model: EntityModel,
) -> AppResult<EntitySaved> {
    blocking(&studio, move |s| s.save_entity_model(&id, &model)).await
}

#[tauri::command]
pub async fn entity_model_code(
    studio: Studio<'_>,
    id: String,
    model: EntityModel,
) -> AppResult<String> {
    blocking(&studio, move |s| s.entity_model_code(&id, &model)).await
}

#[tauri::command]
pub async fn texture_pixels(studio: Studio<'_>, id: String, path: String) -> AppResult<PixelData> {
    blocking(&studio, move |s| s.texture_pixels(&id, &path)).await
}

#[tauri::command]
pub async fn save_texture_pixels(
    studio: Studio<'_>,
    id: String,
    path: String,
    pixels: PixelData,
) -> AppResult<()> {
    blocking(&studio, move |s| s.save_texture_pixels(&id, &path, &pixels)).await
}

#[tauri::command]
pub async fn create_gui_texture(
    studio: Studio<'_>,
    id: String,
    request: GuiRequest,
) -> AppResult<TextureInfo> {
    blocking(&studio, move |s| s.create_gui_texture(&id, &request)).await
}

#[tauri::command]
pub async fn list_textures(studio: Studio<'_>, id: String) -> AppResult<Vec<TextureInfo>> {
    blocking(&studio, move |s| s.textures(&id)).await
}

#[tauri::command]
pub async fn generate_texture(
    studio: Studio<'_>,
    id: String,
    request: TextureRequest,
) -> AppResult<TextureDraft> {
    studio.inner().generate_texture(&id, request).await
}

#[tauri::command]
pub async fn import_texture(
    studio: Studio<'_>,
    id: String,
    target: TextureTarget,
    path: String,
    options: PixelOptions,
) -> AppResult<TextureDraft> {
    blocking(&studio, move |s| {
        s.import_texture(&id, target, std::path::Path::new(&path), options)
    })
    .await
}

#[tauri::command]
pub async fn reprocess_texture(
    studio: Studio<'_>,
    draft_id: String,
    options: PixelOptions,
) -> AppResult<TextureDraft> {
    blocking(&studio, move |s| s.reprocess_texture(&draft_id, options)).await
}

/// Écrit la texture du brouillon dans le projet (l'ancienne est gardée dans l'historique).
#[tauri::command]
pub async fn apply_texture(
    studio: Studio<'_>,
    id: String,
    draft_id: String,
) -> AppResult<TextureInfo> {
    blocking(&studio, move |s| s.apply_texture(&id, &draft_id)).await
}

// ── Fichiers du projet (explorateur, éditeur) ───────────────────────────────

/// Contenu d'un dossier du projet (`dir` relatif, "" pour la racine).
#[tauri::command]
pub async fn list_files(
    studio: Studio<'_>,
    id: String,
    dir: String,
) -> AppResult<Vec<ProjectEntry>> {
    blocking(&studio, move |s| s.list_files(&id, &dir)).await
}

#[tauri::command]
pub async fn read_project_file(
    studio: Studio<'_>,
    id: String,
    path: String,
) -> AppResult<ProjectFile> {
    blocking(&studio, move |s| s.read_file(&id, &path)).await
}

/// `expected_modified` : date lue à l'ouverture ; `None` pour écraser en connaissance de cause.
#[tauri::command]
pub async fn write_project_file(
    studio: Studio<'_>,
    id: String,
    path: String,
    content: String,
    expected_modified: Option<u64>,
) -> AppResult<ProjectFile> {
    blocking(&studio, move |s| {
        s.write_file(&id, &path, &content, expected_modified)
    })
    .await
}

#[tauri::command]
pub async fn create_project_file(
    studio: Studio<'_>,
    id: String,
    path: String,
    directory: bool,
) -> AppResult<ProjectEntry> {
    blocking(&studio, move |s| s.create_file(&id, &path, directory)).await
}

#[tauri::command]
pub async fn rename_project_file(
    studio: Studio<'_>,
    id: String,
    from: String,
    to: String,
) -> AppResult<()> {
    blocking(&studio, move |s| s.rename_file(&id, &from, &to)).await
}

/// Corbeille (récupérable).
#[tauri::command]
pub async fn trash_project_file(studio: Studio<'_>, id: String, path: String) -> AppResult<()> {
    blocking(&studio, move |s| s.trash_file(&id, &path)).await
}

/// Problèmes détectables sans compiler (JSON, références, format de la version).
#[tauri::command]
pub async fn validate_project(studio: Studio<'_>, id: String) -> AppResult<ValidationReport> {
    blocking(&studio, move |s| s.validate(&id)).await
}

// ── Points de restauration ──────────────────────────────────────────────────

#[tauri::command]
pub async fn list_snapshots(studio: Studio<'_>, id: String) -> AppResult<Vec<Snapshot>> {
    blocking(&studio, move |s| s.snapshots(&id)).await
}

#[tauri::command]
pub async fn create_snapshot(studio: Studio<'_>, id: String, label: String) -> AppResult<Snapshot> {
    blocking(&studio, move |s| s.create_snapshot(&id, &label)).await
}

/// Renvoie l'instantané pris juste avant (pour annuler la restauration).
#[tauri::command]
pub async fn restore_snapshot(
    studio: Studio<'_>,
    id: String,
    snapshot_id: String,
) -> AppResult<Snapshot> {
    blocking(&studio, move |s| s.restore_snapshot(&id, &snapshot_id)).await
}

#[tauri::command]
pub async fn delete_snapshot(studio: Studio<'_>, id: String, snapshot_id: String) -> AppResult<()> {
    blocking(&studio, move |s| s.delete_snapshot(&id, &snapshot_id)).await
}

// ── Agent IA (copie de travail) ─────────────────────────────────────────────

/// Crée ou met à jour la copie de travail de l'agent ; son chemin est le `cwd` de la conversation.
#[tauri::command]
pub async fn agent_prepare(studio: Studio<'_>, id: String) -> AppResult<WorkInfo> {
    blocking(&studio, move |s| s.agent_prepare(&id)).await
}

#[tauri::command]
pub async fn agent_instructions(studio: Studio<'_>, id: String) -> AppResult<String> {
    blocking(&studio, move |s| s.agent_instructions(&id)).await
}

#[tauri::command]
pub async fn agent_changes(studio: Studio<'_>, id: String) -> AppResult<Vec<WorkChange>> {
    blocking(&studio, move |s| s.agent_changes(&id)).await
}

/// Applique les fichiers choisis au projet, après un point de restauration.
#[tauri::command]
pub async fn agent_apply(
    studio: Studio<'_>,
    id: String,
    paths: Vec<String>,
) -> AppResult<ApplyOutcome> {
    blocking(&studio, move |s| s.agent_apply(&id, &paths)).await
}

#[tauri::command]
pub async fn agent_discard(studio: Studio<'_>, id: String, paths: Vec<String>) -> AppResult<()> {
    blocking(&studio, move |s| s.agent_discard(&id, &paths)).await
}

#[tauri::command]
pub async fn agent_reset(studio: Studio<'_>, id: String) -> AppResult<WorkInfo> {
    blocking(&studio, move |s| s.agent_reset(&id)).await
}
