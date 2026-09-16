use crate::core::AppResult;

use super::service::{to_path, CodeService};
use super::types::{FileContent, FileEntry, ProjectInfo};

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
