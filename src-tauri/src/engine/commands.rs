use tauri::ipc::Channel;
use tauri::State;

use crate::core::{AppError, AppResult};

use super::adapters::{self, CliAdapter};
use super::event::{AdapterInfo, AutoMode, EngineEvent, PromptAnswer, SessionId};
use super::manager::SessionManager;
use super::session::{self, SessionCommand};

fn find_adapter(id: &str) -> AppResult<Box<dyn CliAdapter>> {
    adapters::build_all()
        .into_iter()
        .find(|adapter| adapter.id() == id)
        .ok_or_else(|| AppError::not_found(format!("adaptateur {id} inconnu")))
}

#[tauri::command]
pub async fn engine_list_adapters() -> AppResult<Vec<AdapterInfo>> {
    // Sondage du système (which, --version, models) : hors du thread async.
    tokio::task::spawn_blocking(|| {
        adapters::build_all()
            .iter()
            .map(|adapter| adapters::describe(adapter.as_ref()))
            .collect()
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn engine_start_session(
    manager: State<'_, SessionManager>,
    adapter: String,
    model: Option<String>,
    cwd: Option<String>,
    auto_mode: AutoMode,
    on_event: Channel<EngineEvent>,
) -> AppResult<SessionId> {
    let adapter = find_adapter(&adapter)?;
    let id = uuid::Uuid::new_v4().to_string();
    let handle = session::spawn(id.clone(), adapter, model, cwd, auto_mode, on_event)?;
    manager.insert(handle).await;
    Ok(id)
}

#[tauri::command]
pub async fn engine_send_message(
    manager: State<'_, SessionManager>,
    session_id: String,
    text: String,
) -> AppResult<()> {
    if text.trim().is_empty() {
        return Err(AppError::invalid("message vide"));
    }
    manager
        .send(&session_id, SessionCommand::Send(text))
        .await
}

#[tauri::command]
pub async fn engine_answer_prompt(
    manager: State<'_, SessionManager>,
    session_id: String,
    prompt_id: String,
    answer: PromptAnswer,
) -> AppResult<()> {
    manager
        .send(&session_id, SessionCommand::Answer { prompt_id, answer })
        .await
}

#[tauri::command]
pub async fn engine_set_auto_mode(
    manager: State<'_, SessionManager>,
    session_id: String,
    mode: AutoMode,
) -> AppResult<()> {
    manager
        .send(&session_id, SessionCommand::SetAutoMode(mode))
        .await
}

#[tauri::command]
pub async fn engine_stop_session(
    manager: State<'_, SessionManager>,
    session_id: String,
) -> AppResult<()> {
    let result = manager.send(&session_id, SessionCommand::Stop).await;
    manager.remove(&session_id).await;
    result
}

#[tauri::command]
pub async fn engine_default_cwd() -> AppResult<String> {
    let dir = crate::core::paths::dirs_home()
        .ok_or_else(|| AppError::internal("dossier utilisateur introuvable"))?;
    Ok(dir.display().to_string())
}
