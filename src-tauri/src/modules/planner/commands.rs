use std::path::PathBuf;

use tauri::{AppHandle, Runtime, State};

use crate::core::{AppError, AppResult};

use super::ics::{self, CalendarEvent};
use super::roadmap::RoadmapDoc;
use super::service::PlannerService;

/// Exécute une opération disque hors du thread async.
async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    tokio::task::spawn_blocking(task)
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn load_boards(service: State<'_, PlannerService>) -> AppResult<serde_json::Value> {
    service.load_boards()
}

#[tauri::command]
pub async fn save_boards(
    service: State<'_, PlannerService>,
    boards: serde_json::Value,
) -> AppResult<()> {
    service.save_boards(&boards)
}

#[tauri::command]
pub async fn read_roadmap(path: String) -> AppResult<RoadmapDoc> {
    blocking(move || PlannerService::read_roadmap(&PathBuf::from(path))).await
}

#[tauri::command]
pub async fn set_roadmap_task(path: String, title: String, done: bool) -> AppResult<RoadmapDoc> {
    blocking(move || PlannerService::set_task_done(&PathBuf::from(path), &title, done)).await
}

#[tauri::command]
pub async fn append_roadmap_tasks(
    path: String,
    section: String,
    tasks: Vec<String>,
) -> AppResult<RoadmapDoc> {
    if tasks.is_empty() {
        return Err(AppError::invalid("aucune tâche à ajouter"));
    }
    blocking(move || PlannerService::append_tasks(&PathBuf::from(path), &section, &tasks)).await
}

#[tauri::command]
pub async fn find_roadmap(root: String) -> AppResult<Option<String>> {
    Ok(PlannerService::find_roadmap(&PathBuf::from(root)).map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn watch_roadmap<R: Runtime>(
    app: AppHandle<R>,
    service: State<'_, PlannerService>,
    path: String,
) -> AppResult<()> {
    service.watch(app, &PathBuf::from(path))
}

#[tauri::command]
pub async fn unwatch_roadmap(service: State<'_, PlannerService>, path: String) -> AppResult<()> {
    service.unwatch(&PathBuf::from(path));
    Ok(())
}

/// Écrit un fichier .ics à l'emplacement choisi par l'utilisateur (dialogue d'enregistrement).
#[tauri::command]
pub async fn export_ics(
    path: String,
    calendar_name: String,
    events: Vec<CalendarEvent>,
) -> AppResult<usize> {
    blocking(move || {
        let content = ics::build(&calendar_name, &events);
        std::fs::write(&path, content)?;
        crate::core::audit::record("planner.export_ics", &path, "ok", "user");
        Ok(events.len())
    })
    .await
}
