use tauri::State;

use crate::core::AppResult;

use super::service::{MemoryService, MemorySettings, Note, NotePatch};

#[tauri::command]
pub async fn list_notes(memory: State<'_, MemoryService>) -> AppResult<Vec<Note>> {
    Ok(memory.notes())
}

#[tauri::command]
pub async fn add_note(memory: State<'_, MemoryService>, text: String, project: Option<String>) -> AppResult<Note> {
    memory.add_note(&text, project)
}

/// Lit un fichier (.txt, .md, .json) et renvoie les informations trouvées, sans rien enregistrer.
#[tauri::command]
pub async fn read_import(path: String) -> AppResult<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || super::service::read_import_file(std::path::Path::new(&path)))
        .await
        .map_err(|e| crate::core::AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn add_notes(memory: State<'_, MemoryService>, texts: Vec<String>, project: Option<String>) -> AppResult<usize> {
    memory.add_notes(&texts, project)
}

#[tauri::command]
pub async fn update_note(memory: State<'_, MemoryService>, id: String, patch: NotePatch) -> AppResult<Note> {
    memory.update_note(&id, patch)
}

#[tauri::command]
pub async fn delete_note(memory: State<'_, MemoryService>, id: String) -> AppResult<()> {
    memory.delete_note(&id)
}

#[tauri::command]
pub async fn get_settings(memory: State<'_, MemoryService>) -> AppResult<MemorySettings> {
    Ok(memory.settings())
}

#[tauri::command]
pub async fn set_settings(memory: State<'_, MemoryService>, settings: MemorySettings) -> AppResult<()> {
    memory.save_settings(&settings)
}

/// Bloc ajouté au premier message d'une conversation (`None` si désactivé ou vide).
#[tauri::command]
pub async fn build_context(memory: State<'_, MemoryService>, cwd: Option<String>) -> AppResult<Option<String>> {
    if !memory.settings().inject {
        return Ok(None);
    }
    Ok(memory.build_context(cwd.as_deref()))
}

/// Aperçu du bloc, même si la transmission est désactivée.
#[tauri::command]
pub async fn preview_context(memory: State<'_, MemoryService>, cwd: Option<String>) -> AppResult<Option<String>> {
    Ok(memory.build_context(cwd.as_deref()))
}
