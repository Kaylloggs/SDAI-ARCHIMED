use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod commands;
mod service;

pub const ID: &str = "memory";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::list_notes,
            commands::add_note,
            commands::update_note,
            commands::delete_note,
            commands::journal,
            commands::record_turn,
            commands::clear_journal,
            commands::get_settings,
            commands::set_settings,
            commands::build_context,
            commands::preview_context,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(service::MemoryService::new(&paths)?);
            Ok(())
        })
        .build()
}
