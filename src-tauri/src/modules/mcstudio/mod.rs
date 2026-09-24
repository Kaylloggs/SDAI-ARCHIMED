//! Minecraft Mod Studio : création, compilation et export de mods Minecraft réels.
//! Voir `src/modules/mcstudio/README.md`.

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod artwork;
mod commands;
mod content;
mod diagnostics;
mod files;
mod fsutil;
mod gradle;
mod java;
mod jdk;
mod openrouter;
mod pixelart;
mod profiles;
mod projects;
mod service;
mod templates;
mod textures;
pub mod types;

#[cfg(test)]
mod e2e;

pub const ID: &str = "mcstudio";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::get_project,
            commands::create_project,
            commands::open_project,
            commands::duplicate_project,
            commands::remove_project,
            commands::version_catalog,
            commands::resolve_versions,
            commands::detect_java,
            commands::inspect_java,
            commands::environment,
            commands::jdk_offer,
            commands::install_jdk,
            commands::cancel_jdk_install,
            commands::version_options,
            commands::update_project_versions,
            commands::project_java,
            commands::set_project_java,
            commands::project_stats,
            commands::default_parent_dir,
            commands::add_item,
            commands::add_block,
            commands::add_recipe,
            commands::build_project,
            commands::cancel_build,
            commands::list_builds,
            commands::read_build_log,
            commands::openrouter_status,
            commands::set_openrouter_key,
            commands::clear_openrouter_key,
            commands::image_models,
            commands::texture_prompt,
            commands::list_textures,
            commands::generate_texture,
            commands::import_texture,
            commands::reprocess_texture,
            commands::apply_texture,
            commands::list_files,
            commands::read_project_file,
            commands::write_project_file,
            commands::create_project_file,
            commands::rename_project_file,
            commands::trash_project_file,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(Arc::new(service::McStudio::new(paths.module_dir(ID))));
            Ok(())
        })
        .build()
}
