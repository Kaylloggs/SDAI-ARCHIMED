use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;
use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, Runtime, State};

use crate::core::{AppError, AppResult};

use super::cloud;
use super::installer;
use super::local::Priority;
use super::mcp::McpReply;
use super::ollama;
use super::service::{SpeakRequest, TranscribeRequest, VoiceService};
use super::types::{
    HardwareInfo, LocalChatEvent, LocalServerStatus, McpInfo, ModelEntry, VoiceOption, VoiceProviderStatus, VoiceSessionSummary,
    VoiceToolStatus,
};

#[tauri::command]
pub async fn voice_hardware_info(voice: State<'_, VoiceService>) -> AppResult<HardwareInfo> {
    Ok(voice.hardware())
}

#[tauri::command]
pub async fn voice_list_models(voice: State<'_, VoiceService>) -> AppResult<Vec<ModelEntry>> {
    let hardware = voice.hardware();
    Ok(voice.models.entries(&hardware).await)
}

#[tauri::command]
pub async fn voice_download_model<R: Runtime>(app: AppHandle<R>, voice: State<'_, VoiceService>, id: String) -> AppResult<()> {
    voice.models.start(app, id)
}

#[tauri::command]
pub async fn voice_pause_model(voice: State<'_, VoiceService>, id: String) -> AppResult<()> {
    voice.models.pause(&id);
    Ok(())
}

#[tauri::command]
pub async fn voice_delete_model(voice: State<'_, VoiceService>, id: String) -> AppResult<()> {
    // Un moteur qui tourne garde ses fichiers ouverts (Windows refuse de les supprimer).
    voice.stop_engines().await;
    voice.models.delete(&id).await
}

#[tauri::command]
pub async fn voice_verify_model(voice: State<'_, VoiceService>, id: String) -> AppResult<()> {
    let models = voice.models.clone();
    tauri::async_runtime::spawn_blocking(move || models.verify(&id))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

/// Charge d'avance la reconnaissance locale (le premier mot est reconnu plus vite).
#[tauri::command]
pub async fn voice_prepare_stt(voice: State<'_, VoiceService>, model: String, language: String, priority: Option<Priority>) -> AppResult<()> {
    voice.prepare_whisper(&model, &language, priority.unwrap_or_default()).await.map(|_| ())
}

#[tauri::command]
pub async fn voice_transcribe(voice: State<'_, VoiceService>, request: TranscribeRequest) -> AppResult<String> {
    voice.transcribe(request).await
}

/// Son de la phrase (WAV ou MP3), renvoyé tel quel (ArrayBuffer côté interface).
#[tauri::command]
pub async fn voice_synthesize(voice: State<'_, VoiceService>, request: SpeakRequest) -> AppResult<Response> {
    Ok(Response::new(voice.synthesize(request).await?))
}

#[tauri::command]
pub async fn voice_list_voices(voice: State<'_, VoiceService>, engine: String, base_url: Option<String>) -> AppResult<Vec<VoiceOption>> {
    voice.voices(&engine, base_url.as_deref()).await
}

#[tauri::command]
pub async fn voice_providers(voice: State<'_, VoiceService>) -> AppResult<Vec<VoiceProviderStatus>> {
    Ok(voice.providers())
}

#[tauri::command]
pub async fn voice_set_provider_key(voice: State<'_, VoiceService>, provider: String, key: String) -> AppResult<()> {
    voice.set_key(&provider, &key).await
}

#[tauri::command]
pub async fn voice_clear_provider_key(voice: State<'_, VoiceService>, provider: String) -> AppResult<()> {
    voice.clear_key(&provider)
}

#[tauri::command]
pub async fn voice_ollama_status(voice: State<'_, VoiceService>) -> AppResult<LocalServerStatus> {
    Ok(ollama::status(&voice.http).await)
}

#[tauri::command]
pub async fn voice_voicebox_status(voice: State<'_, VoiceService>, base_url: Option<String>) -> AppResult<LocalServerStatus> {
    let base = cloud::check_base(base_url.as_deref().unwrap_or(cloud::VOICEBOX_URL))?;
    Ok(cloud::voicebox_status(&voice.http, &base).await)
}

/// Réponse du modèle local (Ollama), morceau par morceau.
#[tauri::command]
pub async fn voice_local_chat(
    voice: State<'_, VoiceService>,
    chat_id: String,
    model: String,
    messages: Vec<Value>,
    on_event: Channel<LocalChatEvent>,
) -> AppResult<()> {
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut chats) = voice.chats.lock() {
        chats.insert(chat_id.clone(), cancel.clone());
    }
    let result = ollama::chat(&voice.http, &model, &messages, &cancel, |text| {
        let _ = on_event.send(LocalChatEvent::Delta { text: text.to_string() });
    })
    .await;
    if let Ok(mut chats) = voice.chats.lock() {
        chats.remove(&chat_id);
    }
    match result {
        Ok(()) => {
            let _ = on_event.send(LocalChatEvent::Done);
            Ok(())
        }
        Err(error) => {
            let _ = on_event.send(LocalChatEvent::Error { message: error.message.clone() });
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn voice_cancel_local_chat(voice: State<'_, VoiceService>, chat_id: String) -> AppResult<()> {
    if let Some(flag) = voice.chats.lock().ok().and_then(|c| c.get(&chat_id).cloned()) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_mcp_info(voice: State<'_, VoiceService>) -> AppResult<McpInfo> {
    let server = voice.mcp.lock().ok().and_then(|s| s.clone());
    Ok(server.map(|s| s.info()).unwrap_or(McpInfo { running: false, url: None, config: None, tools: Vec::new(), calls: 0 }))
}

#[tauri::command]
pub async fn voice_mcp_respond(voice: State<'_, VoiceService>, call_id: String, reply: McpReply) -> AppResult<()> {
    if let Some(server) = voice.mcp.lock().ok().and_then(|s| s.clone()) {
        server.respond(&call_id, reply);
    }
    Ok(())
}

/// L'interface est prête (ou non) à exécuter les outils demandés par les agents.
#[tauri::command]
pub async fn voice_bridge_ready(voice: State<'_, VoiceService>, ready: bool) -> AppResult<()> {
    if let Some(server) = voice.mcp.lock().ok().and_then(|s| s.clone()) {
        server.set_ready(ready);
    }
    Ok(())
}

#[tauri::command]
pub async fn voice_stop_engines(voice: State<'_, VoiceService>) -> AppResult<()> {
    voice.stop_engines().await;
    Ok(())
}

#[tauri::command]
pub async fn voice_get_settings(voice: State<'_, VoiceService>) -> AppResult<Value> {
    Ok(voice.settings())
}

#[tauri::command]
pub async fn voice_save_settings(voice: State<'_, VoiceService>, settings: Value) -> AppResult<()> {
    voice.save_settings(&settings)?;
    // Outils MCP donnés (ou non) aux agents lancés par ARCHIMED.
    let shared = settings["mcp"]["shareTools"].as_bool().unwrap_or(true);
    let server = voice.mcp.lock().ok().and_then(|slot| slot.clone());
    match server {
        Some(server) => server.set_shared(shared),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn voice_list_sessions(voice: State<'_, VoiceService>) -> AppResult<Vec<VoiceSessionSummary>> {
    Ok(voice.sessions())
}

#[tauri::command]
pub async fn voice_get_session(voice: State<'_, VoiceService>, id: String) -> AppResult<Value> {
    voice.session(&id)
}

#[tauri::command]
pub async fn voice_save_session(voice: State<'_, VoiceService>, session: Value) -> AppResult<()> {
    voice.save_session(&session)
}

#[tauri::command]
pub async fn voice_delete_session(voice: State<'_, VoiceService>, id: String) -> AppResult<()> {
    voice.delete_session(&id)
}

/// Ollama et Voicebox : installés, lancés, installables d'un clic.
#[tauri::command]
pub async fn voice_tools(voice: State<'_, VoiceService>) -> AppResult<Vec<VoiceToolStatus>> {
    let (ollama, voicebox) = tokio::join!(ollama::status(&voice.http), cloud::voicebox_status(&voice.http, cloud::VOICEBOX_URL));
    let (ollama, voicebox) = (ollama.running, voicebox.running);
    tokio::task::spawn_blocking(move || installer::tools(ollama, voicebox))
        .await
        .map_err(|e| AppError::internal(e.to_string()))
}

/// Installe un outil proposé (`ollama`, `voicebox`, `claude`, `codex`) après le clic de la personne.
#[tauri::command]
pub async fn voice_install_tool<R: Runtime>(app: AppHandle<R>, voice: State<'_, VoiceService>, id: String) -> AppResult<String> {
    let tmp = voice.models.root().join("tmp");
    installer::install(&app, &voice.http, &tmp, &id).await
}

#[tauri::command]
pub async fn voice_launch_tool(id: String) -> AppResult<()> {
    installer::launch(&id)
}

/// Ouvre un terminal sur la CLI d'un agent pour que la personne s'y connecte elle-même.
#[tauri::command]
pub async fn voice_agent_terminal(config: State<'_, crate::core::config::ConfigStore>, adapter: String) -> AppResult<()> {
    let overrides = config.snapshot().await.binary_overrides;
    let binary = tokio::task::spawn_blocking(move || {
        crate::engine::adapters::build_all()
            .into_iter()
            .find(|a| a.id() == adapter)
            .and_then(|a| crate::engine::adapters::resolve_binary(a.as_ref(), &overrides))
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
    .ok_or_else(|| AppError::not_found("CLI introuvable : installez-la, ou redémarrez ARCHIMED si vous venez de l'installer."))?;
    installer::open_terminal(&binary)
}

/// Réglages de voix du système : langues de reconnaissance et voix de synthèse.
#[tauri::command]
pub async fn voice_open_system_speech<R: Runtime>(app: AppHandle<R>) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let target = if cfg!(windows) {
        "ms-settings:speech"
    } else if cfg!(target_os = "macos") {
        "x-apple.systempreferences:com.apple.preference.universalaccess?SpokenContent"
    } else {
        return Err(AppError::invalid("Réglez les voix dans les paramètres d'accessibilité de votre système."));
    };
    app.opener()
        .open_url(target, None::<&str>)
        .map_err(|e| AppError::internal(format!("Réglages du système inaccessibles : {e}")))
}
