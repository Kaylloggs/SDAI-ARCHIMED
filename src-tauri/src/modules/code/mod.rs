use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

mod commands;
mod service;
mod types;

pub const ID: &str = "code";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::project_info,
            commands::search_files,
        ])
        .build()
}
