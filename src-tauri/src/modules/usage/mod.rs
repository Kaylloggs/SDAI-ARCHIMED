use tauri::plugin::{Builder, TauriPlugin};
use tauri::Runtime;

mod commands;
mod service;

pub const ID: &str = "usage";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::summary,
            commands::claude_account,
            commands::refresh_claude_limits,
        ])
        .build()
}
