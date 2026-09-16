mod core;
mod engine;
mod modules;

use engine::commands as engine_commands;
use engine::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,archimed_lib=debug".into()),
        )
        .init();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(SessionManager::default());

    builder = modules::register_all(builder);

    builder
        .invoke_handler(tauri::generate_handler![
            engine_commands::engine_list_adapters,
            engine_commands::engine_start_session,
            engine_commands::engine_send_message,
            engine_commands::engine_answer_prompt,
            engine_commands::engine_set_auto_mode,
            engine_commands::engine_stop_session,
            engine_commands::engine_default_cwd,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SDAI ARCHIMED");
}
