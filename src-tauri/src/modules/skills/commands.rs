use std::path::PathBuf;

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::core::AppResult;

use super::service::SkillsService;
use super::types::Skill;

#[tauri::command]
pub async fn list(service: State<'_, SkillsService>) -> AppResult<Vec<Skill>> {
    service.list()
}

#[tauri::command]
pub async fn set_enabled(
    service: State<'_, SkillsService>,
    id: String,
    enabled: bool,
) -> AppResult<()> {
    service.set_enabled(&id, enabled)
}

#[tauri::command]
pub async fn import_from_path(service: State<'_, SkillsService>, path: String) -> AppResult<Skill> {
    service.import_from_path(&PathBuf::from(path))
}

#[tauri::command]
pub async fn open_folder<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    service: State<'_, SkillsService>,
) -> AppResult<()> {
    app.opener()
        .open_path(service.library.display().to_string(), None::<&str>)
        .map_err(|e| crate::core::AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn library_path(service: State<'_, SkillsService>) -> AppResult<String> {
    Ok(service.library.display().to_string())
}
