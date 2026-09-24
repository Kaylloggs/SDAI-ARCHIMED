//! JobAgent — recherche d'offres d'emploi multi-plateformes et préparation des
//! candidatures. Module personnel : il n'est pas publié avec le dépôt.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod assets;
mod commands;
mod engine;
mod letters;
mod secrets;
mod service;

pub const ID: &str = "jobagent";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::status,
            commands::install_engine,
            commands::search,
            commands::cancel_search,
            commands::offer_detail,
            commands::sources,
            commands::load_state,
            commands::save_state,
            commands::load_profile,
            commands::save_profile,
            commands::import_cv,
            commands::clear_cv,
            commands::write_letter,
            commands::save_text,
            commands::set_mcp,
            commands::mail_settings,
            commands::save_mail_settings,
            commands::smtp_hint,
            commands::send_application,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(service::JobAgentService::new(&paths)?);
            Ok(())
        })
        .build()
}
