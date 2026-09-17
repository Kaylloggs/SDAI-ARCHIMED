//! Dictée vocale **locale** : reconnaissance vocale de Windows (`Windows.Media.SpeechRecognition`).
//!
//! Aucun appel réseau vers une IA, donc **aucun token consommé** : c'est le moteur de dictée
//! du système qui transcrit, hors ligne une fois le module de langue installé.
//! Le texte partiel est émis pendant que l'utilisateur parle (`dictation:partial`), le texte
//! confirmé à chaque fin de phrase (`dictation:final`).

use std::sync::mpsc::{self, Sender};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Runtime};

use crate::core::{AppError, AppResult};

/// Texte en cours de reconnaissance (change tant que la personne parle).
pub const PARTIAL: &str = "dictation:partial";
/// Phrase reconnue, stable.
pub const FINAL: &str = "dictation:final";
/// Dictée arrêtée (fin normale ou erreur du moteur).
pub const ENDED: &str = "dictation:ended";

#[derive(Default)]
pub struct DictationService {
    /// Canal d'arrêt du fil de dictée en cours.
    stop: Mutex<Option<Sender<()>>>,
}

impl DictationService {
    /// Démarre la dictée. `language` : étiquette BCP-47 (`fr-FR`, `en-US`…), sinon la langue
    /// de reconnaissance par défaut de Windows.
    pub fn start<R: Runtime>(&self, app: AppHandle<R>, language: Option<String>) -> AppResult<()> {
        let mut guard = self
            .stop
            .lock()
            .map_err(|_| AppError::internal("verrou de dictée corrompu"))?;
        if guard.is_some() {
            return Ok(());
        }

        let (tx, rx) = mpsc::channel::<()>();
        // Le fil signale ici son démarrage (ou le motif de l'échec, en clair).
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        // Fil dédié : les objets WinRT y sont créés, utilisés et détruits, sans traverser
        // les frontières de threads de tokio.
        std::thread::spawn(move || {
            let outcome = platform::run(&app, language.as_deref(), &ready_tx, rx);
            let _ = app.emit(ENDED, outcome.err().unwrap_or_default());
        });

        match ready_rx.recv() {
            Ok(Ok(())) => {
                *guard = Some(tx);
                Ok(())
            }
            Ok(Err(message)) => Err(AppError::invalid(message)),
            Err(_) => Err(AppError::internal("dictée : le moteur ne répond pas")),
        }
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.stop.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(());
            }
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::sync::mpsc::{Receiver, Sender};

    use tauri::{AppHandle, Emitter, Runtime};
    use windows::core::{Ref, Result as WinResult, HSTRING};
    use windows::Foundation::TypedEventHandler;
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionSession, SpeechRecognitionHypothesisGeneratedEventArgs,
        SpeechRecognitionQualityDegradingEventArgs, SpeechRecognitionResultStatus,
        SpeechRecognizer, SpeechContinuousRecognitionResultGeneratedEventArgs,
    };

    use super::{FINAL, PARTIAL};

    fn failed(error: windows::core::Error) -> String {
        format!(
            "dictée Windows indisponible ({}). Vérifiez Paramètres › Confidentialité › Reconnaissance vocale, le micro et le module de langue.",
            error.message()
        )
    }

    /// Crée le moteur, branche les événements, démarre, puis attend l'ordre d'arrêt.
    pub fn run<R: Runtime>(
        app: &AppHandle<R>,
        language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        stop: Receiver<()>,
    ) -> Result<(), String> {
        let session = match setup(app, language) {
            Ok(session) => {
                let _ = ready.send(Ok(()));
                session
            }
            Err(error) => {
                let message = failed(error);
                let _ = ready.send(Err(message.clone()));
                return Err(message);
            }
        };

        // Bloque jusqu'à `stop()` (ou jusqu'à la fermeture de l'application).
        let _ = stop.recv();
        let _ = session.StopAsync().map(|op| op.join());
        Ok(())
    }

    fn setup<R: Runtime>(
        app: &AppHandle<R>,
        language: Option<&str>,
    ) -> WinResult<SpeechContinuousRecognitionSession> {
        let recognizer = match language {
            Some(tag) => SpeechRecognizer::Create(&Language::CreateLanguage(&HSTRING::from(tag))?)?,
            None => SpeechRecognizer::new()?,
        };

        let compilation = recognizer.CompileConstraintsAsync()?.join()?;
        if compilation.Status()? != SpeechRecognitionResultStatus::Success {
            return Err(windows::core::Error::new(
                windows::core::HRESULT(-1),
                format!("compilation {:?}", compilation.Status()?),
            ));
        }

        // Texte provisoire, pendant que la personne parle.
        let partial_app = app.clone();
        recognizer.HypothesisGenerated(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let text = args.Hypothesis()?.Text()?.to_string();
                    let _ = partial_app.emit(PARTIAL, text);
                }
                Ok(())
            },
        ))?;

        // Micro de mauvaise qualité, trop de bruit… : simple information.
        let quality_app = app.clone();
        recognizer.RecognitionQualityDegrading(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechRecognitionQualityDegradingEventArgs>| {
                if let Some(args) = args.as_ref() {
                    tracing::debug!("dictée : qualité dégradée ({:?})", args.Problem()?);
                    let _ = &quality_app;
                }
                Ok(())
            },
        ))?;

        let session = recognizer.ContinuousRecognitionSession()?;
        let final_app = app.clone();
        session.ResultGenerated(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechContinuousRecognitionResultGeneratedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let result = args.Result()?;
                    let text = result.Text()?.to_string();
                    if !text.trim().is_empty() {
                        let _ = final_app.emit(FINAL, text);
                    }
                }
                Ok(())
            },
        ))?;

        session.StartAsync()?.join()?;
        Ok(session)
    }
}

#[cfg(not(windows))]
mod platform {
    use std::sync::mpsc::{Receiver, Sender};

    use tauri::{AppHandle, Runtime};

    pub fn run<R: Runtime>(
        _app: &AppHandle<R>,
        _language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        _stop: Receiver<()>,
    ) -> Result<(), String> {
        let message = "la dictée n'est disponible que sous Windows".to_string();
        let _ = ready.send(Err(message.clone()));
        Err(message)
    }
}
