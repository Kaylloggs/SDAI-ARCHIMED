//! Game Studio : atelier de développement de jeux vidéo piloté par IA (Godot, Unity,
//! Unreal). Voir `src/modules/game-studio/README.md` et `docs/adr/0018-game-studio.md`.

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod agents;
mod analysis;
mod assets;
mod builds;
mod catalog;
mod commands;
mod diagnostics;
mod docs;
pub mod engines;
mod graph;
mod journal;
mod mcp_client;
mod runner;
mod scanner;
mod service;
mod store;
mod tools;
pub mod types;
mod vcs;

pub const ID: &str = "game-studio";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::game_environment,
            commands::set_tool_path,
            commands::install_tool,
            commands::analyze_idea,
            commands::system_catalog,
            commands::game_default_dir,
            commands::create_game,
            commands::import_game,
            commands::list_games,
            commands::game_state,
            commands::update_game,
            commands::forget_game,
            commands::set_game_engine,
            commands::graph_op,
            commands::read_journal,
            commands::vcs_state,
            commands::vcs_init,
            commands::create_checkpoint,
            commands::checkpoint_changes,
            commands::checkpoint_diff,
            commands::restore_checkpoint,
            commands::run_game_action,
            commands::cancel_game_action,
            commands::current_game_action,
            commands::open_game_editor,
            commands::list_game_runs,
            commands::read_game_run_log,
            commands::scan_game,
            commands::game_map,
            commands::list_mcp_servers,
            commands::check_mcp_server,
            commands::add_mcp_server,
            commands::remove_mcp_server,
            commands::game_agent_instructions,
            commands::game_task_request,
            commands::game_documents,
            commands::write_game_documents,
            commands::game_assets,
            commands::import_game_assets,
            commands::register_game_asset,
            commands::game_blend_info,
            commands::run_asset_job,
            commands::game_image_providers,
            commands::set_game_image_key,
            commands::clear_game_image_key,
            commands::game_image_login,
            commands::game_image_models,
            commands::game_image_prompt,
            commands::generate_game_image,
            commands::cancel_game_image,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(Arc::new(service::GameStudio::new(paths.module_dir(ID))));
            Ok(())
        })
        .build()
}
