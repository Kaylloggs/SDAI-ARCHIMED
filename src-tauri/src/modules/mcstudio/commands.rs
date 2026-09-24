use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::core::{AppError, AppResult};

use super::java;
use super::service::{self, McStudio};
use super::types::{
    BlockRequest, BuildEvent, BuildRecord, BuildTask, ContentResult, CreateProjectRequest,
    ItemRequest, JavaInstall, JavaStatus, ProjectStats, ProjectSummary, RecipeRequest,
    ResolvedVersions, VersionCatalog,
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

#[tauri::command]
pub async fn resolve_versions(
    studio: Studio<'_>,
    profile_id: String,
    minecraft: String,
) -> AppResult<ResolvedVersions> {
    studio.resolve(&profile_id, &minecraft).await
}

#[tauri::command]
pub async fn detect_java() -> AppResult<Vec<JavaInstall>> {
    tauri::async_runtime::spawn_blocking(java::detect)
        .await
        .map_err(|e| AppError::internal(e.to_string()))
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

#[tauri::command]
pub async fn list_builds(studio: Studio<'_>, id: String) -> AppResult<Vec<BuildRecord>> {
    blocking(&studio, move |s| s.builds(&id)).await
}

#[tauri::command]
pub async fn read_build_log(studio: Studio<'_>, id: String, build_id: String) -> AppResult<String> {
    blocking(&studio, move |s| s.build_log(&id, &build_id)).await
}
