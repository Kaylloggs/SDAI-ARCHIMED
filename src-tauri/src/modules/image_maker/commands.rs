use std::sync::Arc;

use serde_json::Value;
use tauri::{Runtime, State};

use crate::core::imaging::{ModelList, PriceLine, PromptSuggestion, ProviderId, ProviderStatus};
use crate::core::{AppError, AppResult};

use super::browser::{self, AccountSite, BrowserAction, BrowserBounds};
use super::service::ImageMaker;
use super::types::{
    AiOperation, AiSettings, BatchOutcome, CliInfo, DownloadedImage, ExportRequest, ExportResult, ImageMakerSettings, Job,
    LocalOperation, Project, ProjectSummary,
};

type Maker<'a> = State<'a, Arc<ImageMaker>>;

// ── Connexions ──────────────────────────────────────────────────────────────────────────

/// État de chaque fournisseur ; `check` interroge les fournisseurs (clé valide, crédit).
#[tauri::command]
pub async fn provider_statuses(maker: Maker<'_>, check: bool) -> AppResult<Vec<ProviderStatus>> {
    Ok(maker.statuses(check).await)
}

/// Vérifie la clé auprès du fournisseur, puis la range dans le Gestionnaire d'identifiants.
#[tauri::command]
pub async fn set_provider_key(maker: Maker<'_>, provider: ProviderId, key: String) -> AppResult<ProviderStatus> {
    maker.set_key(provider, &key).await
}

/// Oublie la clé propre au module (une clé relue chez un autre module n'est pas touchée).
#[tauri::command]
pub async fn clear_provider_key(maker: Maker<'_>, provider: ProviderId) -> AppResult<ProviderStatus> {
    maker.clear_key(provider).await
}

/// Connexion au compte (Higgsfield par sa CLI officielle) : la page de connexion s'ouvre dans
/// le navigateur de la personne.
#[tauri::command]
pub async fn provider_login(maker: Maker<'_>, provider: ProviderId) -> AppResult<ProviderStatus> {
    maker.login(provider).await
}

#[tauri::command]
pub async fn higgsfield_cli_info(maker: Maker<'_>) -> AppResult<CliInfo> {
    Ok(maker.cli_info())
}

/// `npm install -g @higgsfield/cli`, après confirmation explicite dans l'interface.
#[tauri::command]
pub async fn install_higgsfield_cli(maker: Maker<'_>) -> AppResult<String> {
    maker.install_cli().await
}

#[tauri::command]
pub async fn provider_models(maker: Maker<'_>, provider: ProviderId, refresh: bool) -> AppResult<ModelList> {
    maker.models(provider, refresh).await
}

#[tauri::command]
pub async fn model_pricing(maker: Maker<'_>, provider: ProviderId, model: String) -> AppResult<Vec<PriceLine>> {
    maker.pricing(provider, &model).await
}

#[tauri::command]
pub async fn improve_prompt(
    maker: Maker<'_>,
    provider: ProviderId,
    prompt: String,
    structured: bool,
) -> AppResult<PromptSuggestion> {
    maker.improve_prompt(provider, &prompt, structured).await
}

// ── Réglages ────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_maker_settings(maker: Maker<'_>) -> AppResult<ImageMakerSettings> {
    Ok(maker.settings())
}

#[tauri::command]
pub async fn save_maker_settings(maker: Maker<'_>, settings: ImageMakerSettings) -> AppResult<ImageMakerSettings> {
    maker.save_settings(settings).await
}

// ── Projets ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_image_projects(maker: Maker<'_>) -> AppResult<Vec<ProjectSummary>> {
    maker.list_projects().await
}

#[tauri::command]
pub async fn create_image_project(maker: Maker<'_>, name: String) -> AppResult<Project> {
    maker.create_project(name).await
}

#[tauri::command]
pub async fn get_image_project(maker: Maker<'_>, id: String) -> AppResult<Project> {
    maker.project(id).await
}

/// Met le projet à la Corbeille.
#[tauri::command]
pub async fn delete_image_project(maker: Maker<'_>, id: String) -> AppResult<()> {
    maker.delete_project(id).await
}

#[tauri::command]
pub async fn rename_image_project(maker: Maker<'_>, id: String, name: String) -> AppResult<Project> {
    let name = name.trim().chars().take(80).collect::<String>();
    if name.is_empty() {
        return Err(AppError::invalid("Donnez un nom au projet."));
    }
    maker
        .change_project(id, move |project| {
            project.name = name;
            Ok(())
        })
        .await
}

fn has_node(project: &Project, node: &str) -> AppResult<()> {
    if project.nodes.iter().any(|n| n.id == node) {
        Ok(())
    } else {
        Err(AppError::not_found("Version introuvable."))
    }
}

/// Version affichée dans le canevas.
#[tauri::command]
pub async fn set_current_node(maker: Maker<'_>, project_id: String, node_id: String) -> AppResult<Project> {
    maker
        .change_project(project_id, move |project| {
            has_node(project, &node_id)?;
            project.current = Some(node_id);
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn set_favorite(maker: Maker<'_>, project_id: String, node_id: String, favorite: bool) -> AppResult<Project> {
    maker
        .change_project(project_id, move |project| {
            let node = project
                .nodes
                .iter_mut()
                .find(|n| n.id == node_id)
                .ok_or_else(|| AppError::not_found("Version introuvable."))?;
            node.favorite = favorite;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn rename_node(maker: Maker<'_>, project_id: String, node_id: String, label: String) -> AppResult<Project> {
    let label = label.trim().chars().take(80).collect::<String>();
    if label.is_empty() {
        return Err(AppError::invalid("Donnez un nom à la version."));
    }
    maker
        .change_project(project_id, move |project| {
            let node = project
                .nodes
                .iter_mut()
                .find(|n| n.id == node_id)
                .ok_or_else(|| AppError::not_found("Version introuvable."))?;
            node.label = label;
            Ok(())
        })
        .await
}

/// Versions épinglées comme références du panneau IA.
#[tauri::command]
pub async fn set_references(maker: Maker<'_>, project_id: String, nodes: Vec<String>) -> AppResult<Project> {
    maker
        .change_project(project_id, move |project| {
            for node in &nodes {
                has_node(project, node)?;
            }
            project.references = nodes;
            Ok(())
        })
        .await
}

/// Derniers réglages du panneau IA, rendus tels quels à la réouverture.
#[tauri::command]
pub async fn save_ai_settings(maker: Maker<'_>, project_id: String, settings: Value) -> AppResult<Project> {
    if !settings.is_object() {
        return Err(AppError::invalid("Réglages invalides."));
    }
    maker
        .change_project(project_id, move |project| {
            project.ai_settings = settings;
            Ok(())
        })
        .await
}

/// Met une version à la Corbeille ; ses descendantes se rattachent à son parent.
#[tauri::command]
pub async fn delete_node(maker: Maker<'_>, project_id: String, node_id: String) -> AppResult<Project> {
    maker.delete_node(project_id, node_id).await
}

#[tauri::command]
pub async fn integration_project(maker: Maker<'_>) -> AppResult<Project> {
    maker.integration_project().await
}

// ── Import et opérations locales ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn import_files(
    maker: Maker<'_>,
    project_id: String,
    paths: Vec<String>,
    parent: Option<String>,
    source: Option<String>,
) -> AppResult<BatchOutcome> {
    maker.import_files(project_id, paths, parent, source).await
}

/// Image du presse-papiers (base64 ou adresse `data:`).
#[tauri::command]
pub async fn import_data(maker: Maker<'_>, project_id: String, data: String, name: String) -> AppResult<Project> {
    maker.import_data(project_id, data, name).await
}

#[tauri::command]
pub async fn apply_local(
    maker: Maker<'_>,
    project_id: String,
    node_id: String,
    operation: LocalOperation,
) -> AppResult<Project> {
    maker.apply_local(project_id, node_id, operation).await
}

#[tauri::command]
pub async fn apply_local_batch(
    maker: Maker<'_>,
    project_id: String,
    nodes: Vec<String>,
    operation: LocalOperation,
) -> AppResult<BatchOutcome> {
    maker.apply_local_batch(project_id, nodes, operation).await
}

#[tauri::command]
pub async fn save_paint(maker: Maker<'_>, project_id: String, parent: String, data: String) -> AppResult<Project> {
    maker.save_paint(project_id, parent, data).await
}

// ── File IA ─────────────────────────────────────────────────────────────────────────────

/// Envoie l'opération au fournisseur choisi ; une tâche par demande, suivies par
/// l'événement `image-maker:job`.
#[tauri::command]
pub async fn submit_operation(
    maker: Maker<'_>,
    project_id: String,
    operation: AiOperation,
    settings: AiSettings,
) -> AppResult<Vec<Job>> {
    maker.inner().submit(project_id, operation, settings).await
}

#[tauri::command]
pub async fn list_jobs(maker: Maker<'_>, project_id: Option<String>) -> AppResult<Vec<Job>> {
    Ok(maker.jobs(project_id.as_deref()))
}

#[tauri::command]
pub async fn cancel_job(maker: Maker<'_>, id: String) -> AppResult<()> {
    maker.cancel_job(&id)
}

#[tauri::command]
pub async fn retry_job(maker: Maker<'_>, id: String) -> AppResult<Vec<Job>> {
    maker.inner().retry_job(&id).await
}

#[tauri::command]
pub async fn clear_jobs(maker: Maker<'_>, project_id: String) -> AppResult<()> {
    maker.clear_jobs(&project_id);
    Ok(())
}

/// Attend la fin des tâches (services proposés aux autres modules).
#[tauri::command]
pub async fn wait_jobs(maker: Maker<'_>, ids: Vec<String>) -> AppResult<Vec<Job>> {
    maker.wait_jobs(&ids).await
}

// ── Export et mode compte ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn export_images(maker: Maker<'_>, request: ExportRequest) -> AppResult<ExportResult> {
    maker.export(request).await
}

/// Images arrivées dans Téléchargements depuis `since` (ms) : résultats d'un site officiel.
#[tauri::command]
pub async fn recent_downloads(maker: Maker<'_>, since: i64) -> AppResult<Vec<DownloadedImage>> {
    maker.recent_downloads(since).await
}

// ── Vue navigateur (mode compte) ────────────────────────────────────────────────────────

/// Affiche le site officiel dans la zone réservée par le studio (vue web à part, sans accès
/// à l'application).
#[tauri::command]
pub async fn browser_open<R: Runtime>(window: tauri::Window<R>, site: AccountSite, bounds: BrowserBounds) -> AppResult<()> {
    browser::open(&window, site, bounds)
}

#[tauri::command]
pub async fn browser_bounds<R: Runtime>(app: tauri::AppHandle<R>, bounds: BrowserBounds) -> AppResult<()> {
    browser::set_bounds(&app, bounds)
}

#[tauri::command]
pub async fn browser_hide<R: Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    browser::hide(&app)
}

#[tauri::command]
pub async fn browser_close<R: Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    browser::close(&app)
}

#[tauri::command]
pub async fn browser_action<R: Runtime>(app: tauri::AppHandle<R>, action: BrowserAction) -> AppResult<()> {
    browser::act(&app, action)
}
