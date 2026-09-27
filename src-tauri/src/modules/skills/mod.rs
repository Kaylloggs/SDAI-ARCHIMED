use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod check;
mod commands;
mod frontmatter;
mod maker;
mod service;
mod types;

pub const ID: &str = "skills";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::list,
            commands::set_enabled,
            commands::import_from_path,
            commands::open_folder,
            commands::library_path,
            commands::draft_create,
            commands::draft_list,
            commands::draft_info,
            commands::draft_delete,
            commands::draft_files,
            commands::draft_read,
            commands::draft_write,
            commands::draft_check,
            commands::draft_changes,
            commands::draft_prepare_run,
            commands::draft_save,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            paths.ensure_all()?;
            app.manage(maker::Maker::new(&paths.module_dir(ID), &paths.skills())?);
            app.manage(service::SkillsService::new(&paths)?);
            Ok(())
        })
        .build()
}
