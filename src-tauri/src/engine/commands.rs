use tauri::ipc::Channel;
use tauri::State;

use crate::core::config::ConfigStore;
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
pub async fn engine_list_adapters(config: State<'_, ConfigStore>) -> AppResult<Vec<AdapterInfo>> {
    let overrides = config.snapshot().await.binary_overrides;
    // Sondage du système (which, --version, models) : hors du thread async.
    tokio::task::spawn_blocking(move || {
        adapters::build_all()
            .iter()
            .map(|adapter| adapters::describe(adapter.as_ref(), &overrides))
            .collect()
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))
}

/// Force le chemin d'une CLI installée hors PATH (`null` efface le réglage).
#[tauri::command]
pub async fn engine_set_binary_override(
    config: State<'_, ConfigStore>,
    adapter: String,
    path: Option<String>,
) -> AppResult<()> {
    find_adapter(&adapter)?;
    config.set_binary_override(&adapter, path).await
}

// Paramètres plats : c'est le contrat IPC lu par le frontend (`engine.api.ts`).
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn engine_start_session(
    manager: State<'_, SessionManager>,
    config: State<'_, ConfigStore>,
    adapter: String,
    model: Option<String>,
    cwd: Option<String>,
    auto_mode: AutoMode,
    resume: Option<String>,
    on_event: Channel<EngineEvent>,
) -> AppResult<SessionId> {
    let adapter = find_adapter(&adapter)?;
    let overrides = config.snapshot().await.binary_overrides;
    let id = uuid::Uuid::new_v4().to_string();
    let handle = session::spawn(
        session::SpawnRequest {
            id: id.clone(),
            adapter,
            model,
            cwd,
            auto_mode,
            resume,
        },
        on_event,
        &overrides,
    )?;
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
    manager.send(&session_id, SessionCommand::Send(text)).await
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

fn conversations_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<std::path::PathBuf> {
    let paths = crate::core::paths::Paths::resolve(app)?;
    std::fs::create_dir_all(paths.sessions())?;
    Ok(paths.sessions().join("conversations.json"))
}

/// Conversations persistées (état zustand sérialisé, opaque pour le backend).
/// `None` si rien n'a encore été enregistré sur disque.
#[tauri::command]
pub async fn engine_load_conversations<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> AppResult<Option<String>> {
    let file = conversations_file(&app)?;
    tokio::task::spawn_blocking(move || match std::fs::read_to_string(&file) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Écriture atomique (fichier temporaire puis renommage) : un arrêt brutal
/// ne corrompt jamais l'historique.
#[tauri::command]
pub async fn engine_save_conversations<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: String,
) -> AppResult<()> {
    serde_json::from_str::<serde_json::Value>(&state)
        .map_err(|e| AppError::invalid(format!("état de conversations invalide : {e}")))?;
    let file = conversations_file(&app)?;
    tokio::task::spawn_blocking(move || {
        let temp = file.with_extension("json.tmp");
        std::fs::write(&temp, state)?;
        std::fs::rename(&temp, &file)?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

/// Ouvre le dossier des adaptateurs TOML (ajout d'une CLI sans code).
#[tauri::command]
pub async fn engine_open_adapters_dir<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let dir = super::adapters::declarative::user_dir()
        .ok_or_else(|| AppError::internal("dossier des adaptateurs non initialisé"))?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn engine_default_cwd() -> AppResult<String> {
    let dir = crate::core::paths::dirs_home()
        .ok_or_else(|| AppError::internal("dossier utilisateur introuvable"))?;
    Ok(dir.display().to_string())
}
