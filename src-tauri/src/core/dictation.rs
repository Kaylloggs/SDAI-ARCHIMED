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
/// Le moteur écoute vraiment (micro ouvert).
pub const STARTED: &str = "dictation:started";

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
            let emit_app = app.clone();
            let emit = move |event: &str, text: String| {
                let _ = emit_app.emit(event, text);
            };
            let outcome = platform::run(language.as_deref(), &ready_tx, rx, emit);
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
pub mod platform {
    use std::sync::mpsc::{Receiver, Sender};

    use windows::core::{Ref, Result as WinResult, HSTRING};
    use windows::Foundation::TypedEventHandler;
    use windows::Globalization::Language;
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionSession, SpeechRecognitionHypothesisGeneratedEventArgs,
        SpeechRecognitionQualityDegradingEventArgs, SpeechRecognitionResultStatus,
        SpeechRecognizer, SpeechContinuousRecognitionResultGeneratedEventArgs,
    };

    use super::{FINAL, PARTIAL, STARTED};

    /// Le moteur envoie le texte reconnu par cette closure (l'application le relaie en événement).
    pub type Emit = dyn Fn(&str, String) + Send + Sync + 'static;

    /// WinRT exige un appartement COM initialisé sur le fil qui active les objets. Sans cet
    /// appel, `SpeechRecognizer::new()` échoue (`CO_E_NOTINITIALIZED`) et rien n'était transcrit.
    fn init_apartment() {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        // `RPC_E_CHANGED_MODE` : le fil a déjà un appartement, ce qui convient aussi.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn failed(error: windows::core::Error) -> String {
        format!(
            "dictée Windows indisponible ({}). Vérifiez Paramètres › Confidentialité › Reconnaissance vocale, le micro et le module de langue.",
            error.message()
        )
    }

    /// Crée le moteur, branche les événements, démarre, puis attend l'ordre d'arrêt.
    pub fn run(
        language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        stop: Receiver<()>,
        emit: impl Fn(&str, String) + Send + Sync + 'static,
    ) -> Result<(), String> {
        init_apartment();
        let emit: std::sync::Arc<Emit> = std::sync::Arc::new(emit);
        // `recognizer` doit rester vivant : c'est lui qui porte les gestionnaires d'événements.
        // Le libérer après `StartAsync` coupait la session en silence (aucun texte reconnu).
        let (recognizer, session) = match setup(language, &emit) {
            Ok(engine) => {
                let _ = ready.send(Ok(()));
                engine
            }
            Err(error) => {
                let message = failed(error);
                let _ = ready.send(Err(message.clone()));
                return Err(message);
            }
        };

        // Bloque jusqu'à `stop()` (ou jusqu'à la fermeture de l'application).
        let _ = stop.recv();
        // `CancelAsync` rend la main tout de suite ; attendre `StopAsync` depuis ce fil bloque
        // quand le moteur est en train de traiter de la parole (vérifié le 2026-09-17).
        let _ = session.CancelAsync();
        drop(recognizer);
        Ok(())
    }

    pub fn setup(
        language: Option<&str>,
        emit: &std::sync::Arc<Emit>,
    ) -> WinResult<(SpeechRecognizer, SpeechContinuousRecognitionSession)> {
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
        let partial_emit = emit.clone();
        recognizer.HypothesisGenerated(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechRecognitionHypothesisGeneratedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    partial_emit(PARTIAL, args.Hypothesis()?.Text()?.to_string());
                }
                Ok(())
            },
        ))?;

        // Micro de mauvaise qualité, trop de bruit… : simple information dans les journaux.
        recognizer.RecognitionQualityDegrading(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechRecognitionQualityDegradingEventArgs>| {
                if let Some(args) = args.as_ref() {
                    tracing::debug!("dictée : qualité dégradée ({:?})", args.Problem()?);
                }
                Ok(())
            },
        ))?;

        // Dictée longue : sans cela, Windows arrête la session après quelques secondes de silence.
        let timeouts = recognizer.Timeouts()?;
        let _ = timeouts.SetInitialSilenceTimeout(windows::Foundation::TimeSpan { Duration: 10 * 60 * 10_000_000 });
        let _ = timeouts.SetEndSilenceTimeout(windows::Foundation::TimeSpan { Duration: 20_000_000 });

        let session = recognizer.ContinuousRecognitionSession()?;
        let final_emit = emit.clone();
        session.ResultGenerated(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechContinuousRecognitionResultGeneratedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let text = args.Result()?.Text()?.to_string();
                    if !text.trim().is_empty() {
                        final_emit(FINAL, text);
                    }
                }
                Ok(())
            },
        ))?;

        session.StartAsync()?.join()?;
        emit(STARTED, String::new());
        Ok((recognizer, session))
    }
}

#[cfg(not(windows))]
pub mod platform {
    use std::sync::mpsc::{Receiver, Sender};

    pub fn run(
        _language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        _stop: Receiver<()>,
        _emit: impl Fn(&str, String) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let message = "la dictée n'est disponible que sous Windows".to_string();
        let _ = ready.send(Err(message.clone()));
        Err(message)
    }
}

#[cfg(all(test, windows))]
mod tests {
    use std::sync::{Arc, Mutex};

    /// Démarre réellement le moteur de dictée de Windows (micro requis, langue installée).
    /// Ignoré par défaut : `cargo test -- --ignored dictation_engine_starts`.
    #[test]
    #[ignore]
    fn dictation_engine_starts() {
        let heard: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = heard.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (stop_tx, stop_rx) = std::sync::mpsc::channel();

        let thread = std::thread::spawn(move || {
            super::platform::run(Some("fr-FR"), &ready_tx, stop_rx, move |event, text| {
                sink.lock().unwrap().push(format!("{event} {text}"));
            })
        });

        let started = ready_rx.recv().expect("le fil de dictée doit répondre");
        assert!(started.is_ok(), "démarrage impossible : {started:?}");

        std::thread::sleep(std::time::Duration::from_secs(14));
        let _ = stop_tx.send(());
        thread.join().unwrap().expect("arrêt propre");
        println!("événements reçus : {:?}", heard.lock().unwrap());
    }
}
