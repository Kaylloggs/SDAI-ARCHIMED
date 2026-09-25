//! Image Maker : studio de création et d'édition d'images assisté par IA (plusieurs
//! fournisseurs, historique non destructif, retouches locales). Voir
//! `src/modules/image-maker/README.md`.

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, Runtime};

mod browser;
mod commands;
mod jobs;
mod local;
mod pipeline;
mod service;
mod store;
pub mod types;

pub const ID: &str = "image-maker";

/// Événements : une tâche change d'état, un projet reçoit une version.
pub const JOB_EVENT: &str = "image-maker:job";
pub const PROJECT_EVENT: &str = "image-maker:project";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::provider_statuses,
            commands::set_provider_key,
            commands::clear_provider_key,
            commands::provider_login,
            commands::higgsfield_cli_info,
            commands::install_higgsfield_cli,
            commands::provider_models,
            commands::model_pricing,
            commands::improve_prompt,
            commands::get_maker_settings,
            commands::save_maker_settings,
            commands::list_image_projects,
            commands::create_image_project,
            commands::get_image_project,
            commands::delete_image_project,
            commands::rename_image_project,
            commands::set_current_node,
            commands::set_favorite,
            commands::rename_node,
            commands::set_references,
            commands::save_ai_settings,
            commands::delete_node,
            commands::integration_project,
            commands::import_files,
            commands::import_data,
            commands::apply_local,
            commands::apply_local_batch,
            commands::save_paint,
            commands::submit_operation,
            commands::list_jobs,
            commands::cancel_job,
            commands::retry_job,
            commands::clear_jobs,
            commands::wait_jobs,
            commands::export_images,
            commands::recent_downloads,
            commands::browser_open,
            commands::browser_bounds,
            commands::browser_hide,
            commands::browser_close,
            commands::browser_action,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            let handle = app.clone();
            let notify: service::Notify = Arc::new(move |event| match event {
                service::Event::Job(job) => {
                    let _ = handle.emit(JOB_EVENT, *job);
                }
                service::Event::Project(project) => {
                    let _ = handle.emit(PROJECT_EVENT, *project);
                }
            });
            app.manage(Arc::new(service::ImageMaker::new(&paths.module_dir(ID), notify)));
            Ok(())
        })
        .build()
}
