use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod commands;
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
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            paths.ensure_all()?;
            app.manage(service::SkillsService::new(&paths)?);
            Ok(())
        })
        .build()
}
