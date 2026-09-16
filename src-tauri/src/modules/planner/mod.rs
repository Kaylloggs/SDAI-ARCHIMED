use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

mod commands;
mod ics;
mod roadmap;
mod service;

pub const ID: &str = "planner";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::load_boards,
            commands::save_boards,
            commands::read_roadmap,
            commands::set_roadmap_task,
            commands::append_roadmap_tasks,
            commands::find_roadmap,
            commands::watch_roadmap,
            commands::unwatch_roadmap,
            commands::export_ics,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            app.manage(service::PlannerService::new(&paths)?);
            Ok(())
        })
        .build()
}
