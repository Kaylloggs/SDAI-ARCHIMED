//! Voice : couche vocale d'ARCHIMED (voir `src/modules/voice/README.md`, ADR 0016).
//!
//! Côté Rust : matériel, catalogue et téléchargement des modèles locaux, moteurs de
//! reconnaissance et de synthèse (locaux et en ligne), modèle de langage local (Ollama),
//! serveur MCP qui donne aux agents les outils de l'application.

use std::sync::Arc;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Emitter, Manager, RunEvent, Runtime};

mod catalog;
mod cloud;
mod commands;
mod hardware;
mod installer;
mod local;
mod mcp;
mod models;
mod ollama;
mod service;
pub mod types;

pub const ID: &str = "voice";

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new(ID)
        .invoke_handler(tauri::generate_handler![
            commands::voice_hardware_info,
            commands::voice_list_models,
            commands::voice_download_model,
            commands::voice_pause_model,
            commands::voice_delete_model,
            commands::voice_verify_model,
            commands::voice_prepare_stt,
            commands::voice_transcribe,
            commands::voice_synthesize,
            commands::voice_list_voices,
            commands::voice_providers,
            commands::voice_set_provider_key,
            commands::voice_clear_provider_key,
            commands::voice_ollama_status,
            commands::voice_voicebox_status,
            commands::voice_local_chat,
            commands::voice_cancel_local_chat,
            commands::voice_mcp_info,
            commands::voice_mcp_respond,
            commands::voice_bridge_ready,
            commands::voice_stop_engines,
            commands::voice_get_settings,
            commands::voice_save_settings,
            commands::voice_list_sessions,
            commands::voice_get_session,
            commands::voice_save_session,
            commands::voice_delete_session,
            commands::voice_tools,
            commands::voice_install_tool,
            commands::voice_launch_tool,
            commands::voice_agent_terminal,
            commands::voice_open_system_speech,
        ])
        .setup(|app, _api| {
            let paths = crate::core::paths::Paths::resolve(app)?;
            let voice = service::VoiceService::new(&paths.data, paths.module_dir(ID))?;
            // Outils de l'application pour les agents : l'appel est confié à l'interface.
            let handle = app.clone();
            let emit: Arc<dyn Fn(types::McpCall) + Send + Sync> = Arc::new(move |call| {
                let _ = handle.emit(mcp::CALL_EVENT, call);
            });
            let shared = voice.settings()["mcp"]["shareTools"].as_bool().unwrap_or(true);
            match tauri::async_runtime::block_on(mcp::McpServer::start(emit, &paths.mcp(), shared)) {
                Ok(server) => {
                    if let Ok(mut slot) = voice.mcp.lock() {
                        *slot = Some(server);
                    }
                }
                Err(error) => tracing::warn!("serveur MCP d'ARCHIMED indisponible : {}", error.message),
            }
            app.manage(voice);
            Ok(())
        })
        .on_webview_ready(|webview| {
            #[cfg(windows)]
            if webview.label() == "main" {
                microphone::allow(&webview);
            }
            #[cfg(not(windows))]
            let _ = webview;
        })
        .on_event(|app, event| {
            // Les moteurs locaux s'arrêtent avec l'application.
            if let RunEvent::Exit = event {
                if let Some(voice) = app.try_state::<service::VoiceService>() {
                    tauri::async_runtime::block_on(voice.stop_engines());
                }
            }
        })
        .build()
}

/// WebView2 demande l'accord de la personne à chaque accès au micro par la page. L'accès
/// est accordé d'office à l'application elle-même (jamais aux pages web ouvertes ailleurs).
#[cfg(windows)]
mod microphone {
    use tauri::{Runtime, Webview};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};

    /// Origines de l'application (fichiers embarqués, serveur de développement).
    pub fn is_app_origin(uri: &str) -> bool {
        ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "http://localhost:1420"]
            .iter()
            .any(|origin| uri == *origin || uri.starts_with(&format!("{origin}/")))
    }

    pub fn allow<R: Runtime>(webview: &Webview<R>) {
        let result = webview.with_webview(|platform| unsafe {
            if let Ok(core) = platform.controller().CoreWebView2() {
                grant(&core);
            }
        });
        if let Err(error) = result {
            tracing::warn!("vue web indisponible pour le micro : {error}");
        }
    }

    /// Accorde le micro aux pages de l'application, et à elles seules.
    ///
    /// # Safety
    /// Appel COM sur le fil de la vue web (celui de `with_webview`).
    pub unsafe fn grant(core: &ICoreWebView2) {
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                let mut uri = windows_core_webview::PWSTR::null();
                args.Uri(&mut uri)?;
                if is_app_origin(&take_pwstr(uri)) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(error) = core.add_PermissionRequested(&handler, &mut token) {
            tracing::warn!("accès au micro non configuré : {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(windows)]
    fn microphone_is_granted_to_the_app_only() {
        assert!(super::microphone::is_app_origin("http://tauri.localhost/"));
        assert!(!super::microphone::is_app_origin("https://gemini.google.com/"));
        assert!(!super::microphone::is_app_origin("http://tauri.localhost.evil.com/"));
    }
}
