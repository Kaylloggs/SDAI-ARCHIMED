//! Commandes exposées au frontend du module JobAgent.

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::core::AppResult;

use super::engine::{EngineStatus, SEARCH_PROGRESS};
use super::letters::{self, LetterRequest, LetterResult};
use super::service::JobAgentService;

#[tauri::command]
pub async fn status(service: State<'_, JobAgentService>) -> AppResult<EngineStatus> {
    Ok(service.status().await)
}

/// Installe l'environnement Python du moteur. Les lignes de sortie arrivent au fur et à
/// mesure par l'événement `jobagent:install`.
#[tauri::command]
pub async fn install_engine<R: Runtime>(
    app: AppHandle<R>,
    service: State<'_, JobAgentService>,
) -> AppResult<EngineStatus> {
    service.install(app).await
}

/// Lance une recherche. L'avancement part en `jobagent:progress`.
#[tauri::command]
pub async fn search<R: Runtime>(
    app: AppHandle<R>,
    service: State<'_, JobAgentService>,
    request: Value,
) -> AppResult<Value> {
    service
        .search(request, move |progress| {
            let _ = app.emit(SEARCH_PROGRESS, progress);
        })
        .await
}

#[tauri::command]
pub async fn cancel_search(service: State<'_, JobAgentService>) -> AppResult<()> {
    service.engine().cancel();
    Ok(())
}

#[tauri::command]
pub async fn offer_detail(service: State<'_, JobAgentService>, url: String) -> AppResult<Value> {
    service.detail(&url).await
}

#[tauri::command]
pub async fn sources(service: State<'_, JobAgentService>) -> AppResult<Value> {
    service.sources().await
}

#[tauri::command]
pub async fn load_state(service: State<'_, JobAgentService>) -> AppResult<Value> {
    service.load_state()
}

#[tauri::command]
pub async fn save_state(service: State<'_, JobAgentService>, state: Value) -> AppResult<()> {
    service.save_state(state)
}

#[tauri::command]
pub async fn load_profile(service: State<'_, JobAgentService>) -> AppResult<Value> {
    service.load_profile()
}

#[tauri::command]
pub async fn save_profile(service: State<'_, JobAgentService>, profile: Value) -> AppResult<()> {
    service.save_profile(profile)
}

/// Importe un CV pour une langue donnée (`fr` ou `en`).
#[tauri::command]
pub async fn import_cv(
    service: State<'_, JobAgentService>,
    path: String,
    language: String,
) -> AppResult<Value> {
    service.import_cv(&path, &language).await
}

#[tauri::command]
pub async fn clear_cv(service: State<'_, JobAgentService>, language: String) -> AppResult<Value> {
    service.clear_cv(&language)
}

/// Rédige une lettre, un e-mail ou une réponse de formulaire avec Antigravity.
#[tauri::command]
pub async fn write_letter(request: LetterRequest) -> AppResult<LetterResult> {
    letters::write(request).await
}

/// Enregistre une lettre ou un e-mail dans le fichier choisi par la personne.
#[tauri::command]
pub async fn save_text(path: String, text: String) -> AppResult<()> {
    std::fs::write(path, text)?;
    Ok(())
}

/// Réglages du compte d'envoi, sans le mot de passe.
#[tauri::command]
pub async fn mail_settings(service: State<'_, JobAgentService>) -> AppResult<Value> {
    service.mail_settings()
}

#[tauri::command]
pub async fn save_mail_settings(
    service: State<'_, JobAgentService>,
    settings: Value,
) -> AppResult<Value> {
    service.save_mail_settings(settings)
}

/// Réglages connus pour une adresse (serveur, port, chiffrement).
#[tauri::command]
pub async fn smtp_hint(service: State<'_, JobAgentService>, address: String) -> AppResult<Value> {
    service.smtp_hint(&address).await
}

/// Envoie une candidature préparée. L'interface a montré la liste et obtenu l'accord
/// de la personne avant d'appeler cette commande.
#[tauri::command]
pub async fn send_application(
    service: State<'_, JobAgentService>,
    message: Value,
) -> AppResult<Value> {
    service.send_application(message).await
}

/// Branche ou débranche les outils de recherche sur les agents d'ARCHIMED.
#[tauri::command]
pub async fn set_mcp(service: State<'_, JobAgentService>, enabled: bool) -> AppResult<Value> {
    service.set_mcp(enabled)
}
