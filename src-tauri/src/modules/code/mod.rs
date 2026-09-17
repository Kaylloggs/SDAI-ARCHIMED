use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod commands;
mod service;
mod types;
mod watcher;

pub const ID: &str = "code";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::project_info,
            commands::search_files,
            commands::watch_root,
            commands::unwatch_root,
        ])
        .setup(|app, _api| {
            app.manage(watcher::ProjectWatcher::default());
            Ok(())
        })
        .build()
}
