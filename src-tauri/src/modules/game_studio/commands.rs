//! Commandes Tauri : fines, elles délèguent au service (hors du fil asynchrone pour les
//! accès disque et les programmes lancés).

use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::State;

use crate::core::{AppError, AppResult};

use super::engines::GameAction;
use super::mcp_client::{GameMcpHealth, GameMcpOwnServer, GameMcpServer};
use super::runner::{GameJobEvent, GameRunningJob};
use super::scanner::GameProjectMap;
use super::service::GameStudio;
use super::types::*;
use super::vcs::{GameCheckpoint, GameFileChange, GameVcsState};

type Studio<'a> = State<'a, Arc<GameStudio>>;

async fn blocking<T: Send + 'static>(
    studio: &Studio<'_>,
    work: impl FnOnce(&GameStudio) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(&studio))
        .await
        .map_err(|e| AppError::internal(format!("tâche interrompue : {e}")))?
}

// ── Environnement ─────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn game_environment(studio: Studio<'_>, refresh: bool) -> AppResult<GameEnvironment> {
    blocking(&studio, move |s| Ok(s.environment(refresh))).await
}

#[tauri::command]
pub async fn set_tool_path(
    studio: Studio<'_>,
    tool: String,
    path: Option<String>,
) -> AppResult<GameEnvironment> {
    blocking(&studio, move |s| s.set_tool_path(&tool, path.as_deref())).await
}

/// Installe un outil avec winget (geste explicite de la personne).
#[tauri::command]
pub async fn install_tool(studio: Studio<'_>, tool: String) -> AppResult<String> {
    let (package, name) = super::tools::winget_package(&tool).ok_or_else(|| {
        AppError::invalid("Pas d'installation automatique pour cet outil : suivez le guide.")
    })?;
    crate::core::audit::record("game-studio.install", package, "started", "user");
    let result = crate::core::install::winget_install(package, name).await;
    crate::core::audit::record(
        "game-studio.install",
        package,
        if result.is_ok() { "done" } else { "failed" },
        "user",
    );
    let detail = result?;
    let studio = studio.inner().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || studio.environment(true)).await;
    Ok(format!("{name} installé. {detail}"))
}

// ── Analyse et projets ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn analyze_idea(studio: Studio<'_>, idea: String) -> AppResult<GameAnalysis> {
    blocking(&studio, move |s| s.analyze(&idea)).await
}

#[tauri::command]
pub async fn system_catalog(studio: Studio<'_>) -> AppResult<Vec<GameSystem>> {
    blocking(&studio, |s| s.catalog()).await
}

#[tauri::command]
pub async fn game_default_dir(studio: Studio<'_>) -> AppResult<String> {
    Ok(studio.default_parent())
}

#[tauri::command]
pub async fn create_game(
    studio: Studio<'_>,
    request: GameCreateRequest,
) -> AppResult<GameCreateOutcome> {
    blocking(&studio, move |s| s.create(request)).await
}

#[tauri::command]
pub async fn import_game(studio: Studio<'_>, root: String) -> AppResult<GameProject> {
    blocking(&studio, move |s| s.import(&root)).await
}

#[tauri::command]
pub async fn list_games(studio: Studio<'_>) -> AppResult<Vec<GameProjectSummary>> {
    blocking(&studio, |s| Ok(s.list())).await
}

#[tauri::command]
pub async fn game_state(studio: Studio<'_>, id: String) -> AppResult<GameProjectState> {
    blocking(&studio, move |s| s.state(&id)).await
}

#[tauri::command]
pub async fn update_game(
    studio: Studio<'_>,
    id: String,
    patch: GameProjectPatch,
) -> AppResult<GameProject> {
    blocking(&studio, move |s| s.update(&id, patch)).await
}

/// Moteur d'un projet créé sans moteur : écrit ses fichiers et rend les remarques.
#[tauri::command]
pub async fn set_game_engine(
    studio: Studio<'_>,
    id: String,
    engine: GameEngine,
    editor: Option<String>,
    cpp: bool,
) -> AppResult<Vec<String>> {
    blocking(&studio, move |s| {
        s.set_engine(&id, engine, editor.as_deref(), cpp)
            .map(|(_, notes)| notes)
    })
    .await
}

/// Retire le projet de la liste ; ses fichiers ne sont pas touchés.
#[tauri::command]
pub async fn forget_game(studio: Studio<'_>, id: String) -> AppResult<()> {
    blocking(&studio, move |s| s.forget(&id)).await
}

#[tauri::command]
pub async fn graph_op(studio: Studio<'_>, id: String, op: GameGraphOp) -> AppResult<GameGraph> {
    blocking(&studio, move |s| {
        s.graph_op(&id, op, "vous").map(|(_, g)| g)
    })
    .await
}

#[tauri::command]
pub async fn read_journal(
    studio: Studio<'_>,
    id: String,
    category: Option<GameLogCategory>,
    limit: u32,
) -> AppResult<Vec<GameLogEntry>> {
    blocking(&studio, move |s| s.journal(&id, category, limit as usize)).await
}

// ── Historique ────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vcs_state(studio: Studio<'_>, id: String) -> AppResult<GameVcsState> {
    blocking(&studio, move |s| s.vcs_state(&id)).await
}

#[tauri::command]
pub async fn vcs_init(studio: Studio<'_>, id: String) -> AppResult<String> {
    blocking(&studio, move |s| s.vcs_init(&id)).await
}

#[tauri::command]
pub async fn create_checkpoint(
    studio: Studio<'_>,
    id: String,
    label: String,
) -> AppResult<GameCheckpoint> {
    blocking(&studio, move |s| s.checkpoint(&id, &label, "vous")).await
}

#[tauri::command]
pub async fn checkpoint_changes(
    studio: Studio<'_>,
    id: String,
    checkpoint: String,
) -> AppResult<Vec<GameFileChange>> {
    blocking(&studio, move |s| s.checkpoint_changes(&id, &checkpoint)).await
}

#[tauri::command]
pub async fn checkpoint_diff(
    studio: Studio<'_>,
    id: String,
    checkpoint: String,
    path: String,
) -> AppResult<String> {
    blocking(&studio, move |s| s.checkpoint_diff(&id, &checkpoint, &path)).await
}

#[tauri::command]
pub async fn restore_checkpoint(
    studio: Studio<'_>,
    id: String,
    checkpoint: String,
    paths: Option<Vec<String>>,
) -> AppResult<String> {
    blocking(&studio, move |s| s.restore(&id, &checkpoint, paths, "vous")).await
}

// ── Actions moteur ────────────────────────────────────────────────────────────────────

/// Lance une action du moteur et rend la main aussitôt ; la suite arrive par `on_event`.
#[tauri::command]
pub async fn run_game_action(
    studio: Studio<'_>,
    id: String,
    action: GameAction,
    platform: Option<GamePlatform>,
    development: bool,
    on_event: Channel<GameJobEvent>,
) -> AppResult<String> {
    let job = blocking(&studio, move |s| {
        s.prepare_action(&id, action, platform, development)
    })
    .await?;
    let job_id = job.job_id.clone();
    let studio = studio.inner().clone();
    tauri::async_runtime::spawn(async move {
        studio
            .run_prepared(job, move |event| {
                let _ = on_event.send(event);
            })
            .await;
    });
    Ok(job_id)
}

#[tauri::command]
pub async fn cancel_game_action(studio: Studio<'_>, id: String) -> AppResult<()> {
    studio.cancel_action(&id)
}

#[tauri::command]
pub async fn current_game_action(
    studio: Studio<'_>,
    id: String,
) -> AppResult<Option<GameRunningJob>> {
    Ok(studio.current_action(&id))
}

#[tauri::command]
pub async fn open_game_editor(studio: Studio<'_>, id: String) -> AppResult<String> {
    blocking(&studio, move |s| s.open_editor(&id)).await
}

#[tauri::command]
pub async fn list_game_runs(studio: Studio<'_>, id: String) -> AppResult<Vec<GameBuildRecord>> {
    blocking(&studio, move |s| s.runs(&id)).await
}

#[tauri::command]
pub async fn read_game_run_log(studio: Studio<'_>, id: String, run: String) -> AppResult<String> {
    blocking(&studio, move |s| s.run_log(&id, &run)).await
}

// ── Carte du projet ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_game(studio: Studio<'_>, id: String) -> AppResult<GameProjectMap> {
    blocking(&studio, move |s| s.scan(&id)).await
}

#[tauri::command]
pub async fn game_map(studio: Studio<'_>, id: String) -> AppResult<Option<GameProjectMap>> {
    blocking(&studio, move |s| s.map(&id)).await
}

// ── Serveurs MCP ──────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_mcp_servers(
    studio: Studio<'_>,
    project: Option<String>,
) -> AppResult<Vec<GameMcpServer>> {
    blocking(&studio, move |s| Ok(s.mcp_servers(project.as_deref()))).await
}

/// Test réel d'un serveur (geste explicite : il lance le programme configuré).
#[tauri::command]
pub async fn check_mcp_server(
    studio: Studio<'_>,
    key: String,
    project: Option<String>,
) -> AppResult<GameMcpHealth> {
    let studio = studio.inner().clone();
    studio.check_mcp(&key, project.as_deref()).await
}

#[tauri::command]
pub async fn add_mcp_server(
    studio: Studio<'_>,
    server: GameMcpOwnServer,
) -> AppResult<Vec<GameMcpServer>> {
    blocking(&studio, move |s| s.add_mcp(server)).await
}

#[tauri::command]
pub async fn remove_mcp_server(studio: Studio<'_>, name: String) -> AppResult<Vec<GameMcpServer>> {
    blocking(&studio, move |s| s.remove_mcp(&name)).await
}
