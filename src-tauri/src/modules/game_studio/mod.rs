//! Game Studio : atelier de développement de jeux vidéo piloté par IA (Godot, Unity,
//! Unreal). Voir `src/modules/game-studio/README.md` et `docs/adr/0018-game-studio.md`.

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod analysis;
mod builds;
mod catalog;
mod commands;
pub mod engines;
mod graph;
mod journal;
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
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(Arc::new(service::GameStudio::new(paths.module_dir(ID))));
            Ok(())
        })
        .build()
}
