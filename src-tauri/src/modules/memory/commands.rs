use tauri::State;

use crate::core::AppResult;

use super::service::{JournalEntry, MemoryService, MemorySettings, Note};

#[tauri::command]
pub async fn list_notes(memory: State<'_, MemoryService>) -> AppResult<Vec<Note>> {
    Ok(memory.notes())
}

#[tauri::command]
pub async fn add_note(
    memory: State<'_, MemoryService>,
    text: String,
    project: Option<String>,
    source: Option<String>,
) -> AppResult<Note> {
    memory.add_note(&text, project, source.as_deref().unwrap_or("user"))
}

#[tauri::command]
pub async fn update_note(memory: State<'_, MemoryService>, id: String, text: String) -> AppResult<()> {
    memory.update_note(&id, &text)
}

#[tauri::command]
pub async fn delete_note(memory: State<'_, MemoryService>, id: String) -> AppResult<()> {
    memory.delete_note(&id)
}

#[tauri::command]
pub async fn journal(
    memory: State<'_, MemoryService>,
    project: Option<String>,
    limit: Option<usize>,
) -> AppResult<Vec<JournalEntry>> {
    Ok(memory.journal(project.as_deref(), limit.unwrap_or(100)))
}

#[tauri::command]
pub async fn record_turn(memory: State<'_, MemoryService>, entry: JournalEntry) -> AppResult<()> {
    if !memory.settings().capture {
        return Ok(());
    }
    memory.record(entry)
}

#[tauri::command]
pub async fn clear_journal(memory: State<'_, MemoryService>) -> AppResult<()> {
    memory.clear_journal()
}

#[tauri::command]
pub async fn get_settings(memory: State<'_, MemoryService>) -> AppResult<MemorySettings> {
    Ok(memory.settings())
}

#[tauri::command]
pub async fn set_settings(memory: State<'_, MemoryService>, settings: MemorySettings) -> AppResult<()> {
    memory.save_settings(&settings)
}

/// Bloc de contexte à ajouter au premier message d'une conversation (`None` si désactivé ou vide).
#[tauri::command]
pub async fn build_context(memory: State<'_, MemoryService>, cwd: Option<String>) -> AppResult<Option<String>> {
    if !memory.settings().inject {
        return Ok(None);
    }
    Ok(memory.build_context(cwd.as_deref()))
}

/// Aperçu du bloc, même si l'injection est désactivée.
#[tauri::command]
pub async fn preview_context(memory: State<'_, MemoryService>, cwd: Option<String>) -> AppResult<Option<String>> {
    Ok(memory.build_context(cwd.as_deref()))
}
