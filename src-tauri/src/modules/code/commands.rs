use crate::core::AppResult;

use std::sync::Arc;

use tauri::Manager;

use super::search::{self, PathFilter, SearchState};
use super::service::{to_path, CodeService};
use super::terminal::{TerminalEvent, TerminalInfo, Terminals};
use super::types::{FileContent, FileEntry, ProjectInfo, SearchOptions, SearchOutcome};

#[tauri::command]
pub async fn list_dir(path: String) -> AppResult<Vec<FileEntry>> {
    tokio::task::spawn_blocking(move || CodeService::list_dir(&to_path(&path)))
        .await
        .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn read_file(path: String) -> AppResult<FileContent> {
    tokio::task::spawn_blocking(move || CodeService::read_file(&to_path(&path)))
        .await
        .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn write_file(path: String, content: String) -> AppResult<FileContent> {
    tokio::task::spawn_blocking(move || {
        let result = CodeService::write_file(&to_path(&path), &content);
        crate::core::audit::record(
            "code.write_file",
            &path,
            if result.is_ok() { "ok" } else { "error" },
            "user",
        );
        result
    })
    .await
    .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn project_info(path: String) -> AppResult<ProjectInfo> {
    tokio::task::spawn_blocking(move || CodeService::project_info(&to_path(&path)))
        .await
        .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn search_files(root: String, query: String, limit: Option<usize>) -> AppResult<Vec<FileEntry>> {
    tokio::task::spawn_blocking(move || {
        CodeService::search_files(&to_path(&root), &query, limit.unwrap_or(50))
    })
    .await
    .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

/// Surveille le projet ouvert : émet `code:fs-changed` quand des fichiers changent.
#[tauri::command]
pub async fn watch_root<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    watcher: tauri::State<'_, super::watcher::ProjectWatcher>,
    root: String,
) -> AppResult<()> {
    watcher.watch(app, to_path(&root))
}

#[tauri::command]
pub async fn unwatch_root(watcher: tauri::State<'_, super::watcher::ProjectWatcher>) -> AppResult<()> {
    watcher.unwatch();
    Ok(())
}

/// Cherche un texte dans les fichiers du projet. Une nouvelle recherche interrompt la
/// précédente (renvoyée avec `cancelled`).
#[tauri::command]
pub async fn search_text<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: String,
    query: String,
    options: SearchOptions,
    include: Option<String>,
    exclude: Option<String>,
) -> AppResult<SearchOutcome> {
    let state = Arc::clone(app.state::<Arc<SearchState>>().inner());
    let generation = state.begin();
    if query.is_empty() {
        return Ok(SearchOutcome::default());
    }
    let matcher = search::build_matcher(&query, &options)?;
    let include = PathFilter::parse(include.as_deref().unwrap_or_default());
    let exclude = PathFilter::parse(exclude.as_deref().unwrap_or_default());
    tokio::task::spawn_blocking(move || search::search(&state, generation, &to_path(&root), &matcher, &include, &exclude))
        .await
        .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

/// Ouvre un terminal (PowerShell) dans `cwd` ; sa sortie arrive sur `on_event`.
#[tauri::command]
pub async fn terminal_open(
    terminals: tauri::State<'_, Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_event: tauri::ipc::Channel<TerminalEvent>,
) -> AppResult<TerminalInfo> {
    let result = terminals.open(&to_path(&cwd), cols, rows, on_event);
    crate::core::audit::record(
        "code.terminal_open",
        &cwd,
        if result.is_ok() { "ok" } else { "error" },
        "user",
    );
    result
}

/// Frappe de la personne vers le shell.
#[tauri::command]
pub async fn terminal_write(terminals: tauri::State<'_, Terminals>, id: String, data: String) -> AppResult<()> {
    terminals.write(&id, &data)
}

#[tauri::command]
pub async fn terminal_resize(
    terminals: tauri::State<'_, Terminals>,
    id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    terminals.resize(&id, cols, rows)
}

/// Ferme le terminal et arrête ce qui y tourne encore.
#[tauri::command]
pub async fn terminal_close(terminals: tauri::State<'_, Terminals>, id: String) -> AppResult<()> {
    terminals.close(&id)
}
