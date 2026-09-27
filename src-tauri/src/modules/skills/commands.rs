use std::path::PathBuf;

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::core::AppResult;

use super::maker::Maker;
use super::service::SkillsService;
use super::types::{DraftChange, DraftFile, DraftInfo, DraftReport, Skill};

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

// ── Atelier (Skill Maker) ────────────────────────────────────────────────────

/// Nouveau brouillon ; `source_id` : skill de la bibliothèque (ou externe) à améliorer.
#[tauri::command]
pub async fn draft_create(
    maker: State<'_, Maker>,
    service: State<'_, SkillsService>,
    source_id: Option<String>,
) -> AppResult<DraftInfo> {
    let source = match source_id {
        Some(id) => Some(
            service
                .list()?
                .into_iter()
                .find(|skill| skill.id == id)
                .map(|skill| PathBuf::from(skill.path))
                .ok_or_else(|| crate::core::AppError::not_found(format!("skill {id} introuvable")))?,
        ),
        None => None,
    };
    maker.create(source.as_deref())
}

#[tauri::command]
pub async fn draft_list(maker: State<'_, Maker>) -> AppResult<Vec<DraftInfo>> {
    maker.list()
}

#[tauri::command]
pub async fn draft_info(maker: State<'_, Maker>, id: String) -> AppResult<DraftInfo> {
    maker.info(&id)
}

/// Brouillon à la Corbeille.
#[tauri::command]
pub async fn draft_delete(maker: State<'_, Maker>, id: String) -> AppResult<()> {
    maker.delete(&id)
}

#[tauri::command]
pub async fn draft_files(maker: State<'_, Maker>, id: String) -> AppResult<Vec<DraftFile>> {
    maker.files(&id)
}

#[tauri::command]
pub async fn draft_read(maker: State<'_, Maker>, id: String, path: String) -> AppResult<Option<String>> {
    maker.read(&id, &path)
}

#[tauri::command]
pub async fn draft_write(maker: State<'_, Maker>, id: String, path: String, content: String) -> AppResult<()> {
    maker.write(&id, &path, &content)
}

/// Vérification du skill du brouillon.
#[tauri::command]
pub async fn draft_check(maker: State<'_, Maker>, id: String) -> AppResult<DraftReport> {
    maker.report(&id)
}

/// Différences avec le skill d'origine (brouillon « améliorer »).
#[tauri::command]
pub async fn draft_changes(maker: State<'_, Maker>, id: String) -> AppResult<Vec<DraftChange>> {
    maker.changes(&id)
}

/// Dossier de travail d'un test.
#[tauri::command]
pub async fn draft_prepare_run(maker: State<'_, Maker>, id: String) -> AppResult<String> {
    maker.prepare_run(&id)
}

/// Enregistre le skill dans la bibliothèque, puis l'active pour les CLI demandées.
#[tauri::command]
pub async fn draft_save(
    maker: State<'_, Maker>,
    service: State<'_, SkillsService>,
    id: String,
    replace: bool,
    enable: bool,
) -> AppResult<Skill> {
    let result = maker.save(&id, replace);
    crate::core::audit::record(
        "skills.draft_save",
        result.as_deref().unwrap_or(&id),
        if result.is_ok() { "saved" } else { "error" },
        "user",
    );
    let name = result?;
    if enable {
        service.set_enabled(&name, true)?;
    }
    service
        .list()?
        .into_iter()
        .find(|skill| skill.id == name)
        .ok_or_else(|| crate::core::AppError::internal("skill enregistré introuvable"))
}
