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
/// Le moteur écoute mais l'audio pose problème (micro muet, saturé, bruyant).
pub const WARNING: &str = "dictation:warning";
/// Niveau d'entrée du micro, de `0.000` à `1.000` (5 fois par seconde).
pub const LEVEL: &str = "dictation:level";

/// Ce qui réveille le fil de dictée pendant qu'il attend.
pub enum Signal {
    /// Arrêt demandé depuis l'interface.
    Stop,
    /// Windows a clos la session d'écoute (silence, quota de pause, erreur micro).
    /// `fatal` : inutile de relancer, la cause ne disparaîtra pas toute seule.
    SessionEnded { fatal: bool, message: String },
}

#[derive(Default)]
pub struct DictationService {
    /// Canal de commande du fil de dictée en cours.
    stop: Mutex<Option<Sender<Signal>>>,
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

        let (tx, rx) = mpsc::channel::<Signal>();
        // Le fil de dictée se réveille aussi tout seul : la session Windows lui signale
        // ses fins d'écoute par ce même canal.
        let loopback = tx.clone();
        // Le fil signale ici son démarrage (ou le motif de l'échec, en clair).
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

        // Fil dédié : les objets WinRT y sont créés, utilisés et détruits, sans traverser
        // les frontières de threads de tokio.
        std::thread::spawn(move || {
            let emit_app = app.clone();
            let emit = move |event: &str, text: String| {
                let _ = emit_app.emit(event, text);
            };
            let outcome = platform::run(language.as_deref(), &ready_tx, loopback, rx, emit);
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

    /// Nom du micro d'entrée choisi par Windows, `None` s'il n'y en a aucun.
    /// La dictée écoute ce périphérique-là, pas celui qu'on croit : un casque éteint
    /// ou un micro virtuel (Oculus, Nahimic…) produit un flux muet, donc aucun texte.
    pub fn microphone() -> Option<String> {
        platform::default_microphone()
    }

    pub fn stop(&self) {
        if let Ok(mut guard) = self.stop.lock() {
            if let Some(tx) = guard.take() {
                let _ = tx.send(Signal::Stop);
            }
        }
    }
}

#[cfg(windows)]
pub mod platform {
    use std::sync::mpsc::{Receiver, Sender};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use windows::core::{Ref, Result as WinResult, HSTRING};
    use windows::Foundation::{TimeSpan, TypedEventHandler};
    use windows::Globalization::Language;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{eCapture, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    use windows::Media::SpeechRecognition::{
        SpeechContinuousRecognitionCompletedEventArgs,
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession,
        SpeechRecognitionAudioProblem, SpeechRecognitionHypothesisGeneratedEventArgs,
        SpeechRecognitionQualityDegradingEventArgs,
        SpeechRecognitionResultStatus, SpeechRecognitionScenario, SpeechRecognitionTopicConstraint,
        SpeechRecognizer,
    };

    use super::{Signal, FINAL, LEVEL, PARTIAL, STARTED, WARNING};

    /// Le moteur envoie le texte reconnu par cette closure (l'application le relaie en événement).
    pub type Emit = dyn Fn(&str, String) + Send + Sync + 'static;

    /// Une seconde en unités WinRT (100 ns).
    const SECOND: i64 = 10_000_000;
    /// Au-delà, la session n'arrive manifestement plus à écouter : on rend la main.
    const MAX_RESTARTS: usize = 6;
    /// Fenêtre de comptage des relances : des relances espacées sont normales.
    const RESTART_WINDOW: Duration = Duration::from_secs(10);

    /// WinRT exige un appartement COM initialisé sur le fil qui active les objets. Sans cet
    /// appel, `SpeechRecognizer::new()` échoue (`CO_E_NOTINITIALIZED`) et rien n'était transcrit.
    pub fn init_apartment() {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        // `RPC_E_CHANGED_MODE` : le fil a déjà un appartement, ce qui convient aussi.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    }

    fn failed(error: windows::core::Error) -> String {
        // `0x80070005` : l'accès au micro est refusé à l'application.
        if error.code().0 as u32 == 0x8007_0005 {
            return "Micro refusé à ARCHIMED. Paramètres › Confidentialité et sécurité › Microphone : activez « Accès au micro », puis « Laisser les applications de bureau accéder à votre micro »."
                .to_string();
        }
        format!(
            "Dictée Windows indisponible ({}). Vérifiez le micro, Paramètres › Confidentialité › Reconnaissance vocale, et le module de langue.",
            error.message()
        )
    }

    /// Nom du périphérique d'entrée par défaut de Windows.
    pub fn default_microphone() -> Option<String> {
        use windows::Devices::Enumeration::DeviceInformation;
        use windows::Media::Devices::{AudioDeviceRole, MediaDevice};

        init_apartment();
        let id = MediaDevice::GetDefaultAudioCaptureId(AudioDeviceRole::Default).ok()?;
        if id.is_empty() {
            return None;
        }
        let info = DeviceInformation::CreateFromIdAsync(&id).ok()?.join().ok()?;
        info.Name().ok().map(|name| name.to_string())
    }

    /// Ce que le moteur entend de travers, en clair. `None` = rien à signaler.
    fn audio_problem(problem: SpeechRecognitionAudioProblem) -> Option<String> {
        let microphone = default_microphone().unwrap_or_else(|| "aucun".to_string());
        match problem {
            SpeechRecognitionAudioProblem::NoSignal => Some(format!(
                "Aucun son sur le micro « {microphone} ». Choisissez le bon périphérique d'entrée dans Paramètres › Son."
            )),
            SpeechRecognitionAudioProblem::TooQuiet => Some(format!(
                "Micro « {microphone} » trop faible : montez son volume d'entrée, ou parlez plus près."
            )),
            SpeechRecognitionAudioProblem::TooNoisy => {
                Some("Trop de bruit autour du micro.".to_string())
            }
            SpeechRecognitionAudioProblem::TooLoud => {
                Some("Micro saturé : baissez son volume d'entrée.".to_string())
            }
            _ => None,
        }
    }

    /// Traduit la fin d'une session d'écoute : faut-il relancer, et que dire à l'utilisateur ?
    fn session_end(status: SpeechRecognitionResultStatus) -> Signal {
        let (fatal, message) = match status {
            // Fins normales : silence, limite de pause, arrêt demandé. On relance.
            SpeechRecognitionResultStatus::Success
            | SpeechRecognitionResultStatus::UserCanceled
            | SpeechRecognitionResultStatus::TimeoutExceeded
            | SpeechRecognitionResultStatus::PauseLimitExceeded => (false, String::new()),
            SpeechRecognitionResultStatus::MicrophoneUnavailable => (
                true,
                "Micro indisponible. Vérifiez qu'il est branché, non coupé, et autorisé pour les applications de bureau (Paramètres › Confidentialité › Microphone)."
                    .to_string(),
            ),
            SpeechRecognitionResultStatus::NetworkFailure => (
                true,
                "La reconnaissance vocale de Windows n'a pas pu joindre son service. Activez la reconnaissance vocale en ligne, ou installez le module de langue hors ligne."
                    .to_string(),
            ),
            SpeechRecognitionResultStatus::TopicLanguageNotSupported
            | SpeechRecognitionResultStatus::GrammarLanguageMismatch => (
                true,
                "Langue de dictée non installée. Paramètres › Heure et langue › Langue : ajoutez la « reconnaissance vocale » pour votre langue."
                    .to_string(),
            ),
            SpeechRecognitionResultStatus::AudioQualityFailure => (
                false,
                "Audio inexploitable (micro trop faible ou trop bruyant).".to_string(),
            ),
            other => (false, format!("session close ({other:?})")),
        };
        Signal::SessionEnded { fatal, message }
    }

    /// Crée le moteur, branche les événements, démarre, puis attend l'ordre d'arrêt.
    pub fn run(
        language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        signals: Sender<Signal>,
        inbox: Receiver<Signal>,
        emit: impl Fn(&str, String) + Send + Sync + 'static,
    ) -> Result<(), String> {
        init_apartment();
        let emit: Arc<Emit> = Arc::new(emit);
        // `recognizer` doit rester vivant : c'est lui qui porte les gestionnaires d'événements.
        // Le libérer après `StartAsync` coupait la session en silence (aucun texte reconnu).
        let (recognizer, session) = match setup(language, &emit, signals) {
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

        // Le moteur de Windows écoute le micro *par défaut* du système, sans le dire :
        // un casque éteint ou une entrée muette donnait une dictée vide et silencieuse.
        // Ce fil mesure le niveau réel et prévient.
        let listening = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let watcher = watch_level(listening.clone(), emit.clone());

        // Windows ferme la session à chaque silence un peu long. Sans relance, la dictée
        // restait « en écoute » côté interface sans plus jamais rien transcrire.
        let mut outcome = Ok(());
        let mut restarts = 0usize;
        let mut window = Instant::now();
        loop {
            match inbox.recv() {
                Ok(Signal::Stop) | Err(_) => break,
                Ok(Signal::SessionEnded { fatal, message }) => {
                    if fatal {
                        outcome = Err(message);
                        break;
                    }
                    if window.elapsed() > RESTART_WINDOW {
                        restarts = 0;
                        window = Instant::now();
                    }
                    restarts += 1;
                    if restarts > MAX_RESTARTS {
                        outcome = Err(if message.is_empty() {
                            "Dictée interrompue en boucle par Windows : vérifiez le micro.".to_string()
                        } else {
                            message
                        });
                        break;
                    }
                    if let Err(error) = restart(&session) {
                        outcome = Err(failed(error));
                        break;
                    }
                }
            }
        }

        listening.store(false, std::sync::atomic::Ordering::Relaxed);
        if let Some(watcher) = watcher {
            let _ = watcher.join();
        }
        // `CancelAsync` rend la main tout de suite ; attendre `StopAsync` depuis ce fil bloque
        // quand le moteur est en train de traiter de la parole (vérifié le 2026-09-17).
        let _ = session.CancelAsync();
        drop(recognizer);
        outcome
    }

    /// Relance l'écoute après une fin de session : Windows a besoin d'un instant pour
    /// libérer le micro, la première tentative répond parfois « état invalide ».
    fn restart(session: &SpeechContinuousRecognitionSession) -> WinResult<()> {
        let mut last = None;
        for attempt in 0..5 {
            if attempt > 0 {
                std::thread::sleep(Duration::from_millis(150));
            }
            match session.StartAsync().and_then(|operation| operation.join()) {
                Ok(()) => return Ok(()),
                Err(error) => last = Some(error),
            }
        }
        Err(last.unwrap_or_else(windows::core::Error::empty))
    }

    /// Cadence de mesure du niveau d'entrée.
    const LEVEL_TICK: Duration = Duration::from_millis(200);
    /// Silence complet toléré avant d'avertir que le micro ne capte rien.
    const SILENCE_ALERT: Duration = Duration::from_secs(4);
    /// En dessous, le signal est indiscernable du bruit de fond numérique (mesuré à 0,002
    /// sur une entrée muette ; une voix normale dépasse 0,05).
    const SILENCE_PEAK: f32 = 0.012;

    /// Suit le niveau du micro par défaut : émet `dictation:level` en continu et avertit
    /// une fois si l'entrée reste parfaitement muette.
    fn watch_level(
        listening: Arc<std::sync::atomic::AtomicBool>,
        emit: Arc<Emit>,
    ) -> Option<std::thread::JoinHandle<()>> {
        Some(std::thread::spawn(move || {
            init_apartment();
            let Ok(meter) = InputMeter::open() else {
                return;
            };
            // Le silence se mesure sur la durée écoulée depuis le dernier son : un simple
            // maximum garderait le « clac » du démarrage et masquerait un micro muet.
            let mut last_sound = Instant::now();
            let mut alerted = false;
            while listening.load(std::sync::atomic::Ordering::Relaxed) {
                let peak = meter.peak();
                emit(LEVEL, format!("{peak:.3}"));
                if peak >= SILENCE_PEAK {
                    last_sound = Instant::now();
                    alerted = false;
                }
                if !alerted && last_sound.elapsed() > SILENCE_ALERT {
                    alerted = true;
                    let name = default_microphone().unwrap_or_else(|| "inconnu".to_string());
                    emit(
                        WARNING,
                        format!(
                            "Le micro « {name} » ne capte aucun son. Choisissez le bon périphérique d'entrée dans Paramètres › Son, et vérifiez qu'il n'est pas coupé."
                        ),
                    );
                }
                std::thread::sleep(LEVEL_TICK);
            }
            emit(LEVEL, "0.000".to_string());
        }))
    }

    /// Crête du périphérique de capture par défaut (API Core Audio de Windows).
    struct InputMeter(IAudioMeterInformation);

    impl InputMeter {
        fn open() -> WinResult<Self> {
            unsafe {
                let devices: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = devices.GetDefaultAudioEndpoint(eCapture, eConsole)?;
                let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
                Ok(Self(meter))
            }
        }

        fn peak(&self) -> f32 {
            unsafe { self.0.GetPeakValue().unwrap_or(0.0) }
        }
    }

    pub fn setup(
        language: Option<&str>,
        emit: &Arc<Emit>,
        signals: Sender<Signal>,
    ) -> WinResult<(SpeechRecognizer, SpeechContinuousRecognitionSession)> {
        let recognizer = match language {
            Some(tag) => SpeechRecognizer::Create(&Language::CreateLanguage(&HSTRING::from(tag))?)?,
            None => SpeechRecognizer::new()?,
        };

        // Contrainte de dictée explicite, comme l'exemple officiel de reconnaissance
        // continue : sans elle, la grammaire par défaut ne produit aucune hypothèse
        // sur certaines machines.
        let dictation = SpeechRecognitionTopicConstraint::Create(
            SpeechRecognitionScenario::Dictation,
            &HSTRING::from("dictation"),
        )?;
        recognizer.Constraints()?.Append(&dictation)?;

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

        // Le moteur signale ce qu'il entend mal. « Aucun signal » est le cas le plus
        // fréquent : Windows écoute un micro muet et la dictée reste vide sans rien dire.
        let quality_emit = emit.clone();
        recognizer.RecognitionQualityDegrading(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechRecognitionQualityDegradingEventArgs>| {
                if let Some(args) = args.as_ref() {
                    let problem = args.Problem()?;
                    tracing::debug!("dictée : qualité dégradée ({problem:?})");
                    if let Some(message) = audio_problem(problem) {
                        quality_emit(WARNING, message);
                    }
                }
                Ok(())
            },
        ))?;

        // Durées de silence tolérées. Windows plafonne ces valeurs : au-delà, l'appel échoue
        // et les réglages d'usine restent (l'ancien « 10 minutes » ne s'appliquait jamais).
        if let Ok(timeouts) = recognizer.Timeouts() {
            let _ = timeouts.SetInitialSilenceTimeout(TimeSpan { Duration: 10 * SECOND });
            let _ = timeouts.SetEndSilenceTimeout(TimeSpan { Duration: 2 * SECOND });
            let _ = timeouts.SetBabbleTimeout(TimeSpan { Duration: 0 });
        }

        let session = recognizer.ContinuousRecognitionSession()?;
        // Sans cela, la session s'arrête d'elle-même au premier silence prolongé.
        let _ = session.SetAutoStopSilenceTimeout(TimeSpan { Duration: 300 * SECOND });

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

        // Fin d'écoute : le fil principal décide de relancer, ou d'afficher la cause.
        let completed_signals = signals.clone();
        session.Completed(&TypedEventHandler::new(
            move |_, args: Ref<'_, SpeechContinuousRecognitionCompletedEventArgs>| {
                let status = args
                    .as_ref()
                    .and_then(|args| args.Status().ok())
                    .unwrap_or(SpeechRecognitionResultStatus::Unknown);
                tracing::debug!("dictée : session terminée ({status:?})");
                let _ = completed_signals.send(session_end(status));
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

    pub fn default_microphone() -> Option<String> {
        None
    }

    pub fn run(
        _language: Option<&str>,
        ready: &Sender<Result<(), String>>,
        _signals: Sender<super::Signal>,
        _inbox: Receiver<super::Signal>,
        _emit: impl Fn(&str, String) + Send + Sync + 'static,
    ) -> Result<(), String> {
        let message = "la dictée n'est disponible que sous Windows".to_string();
        let _ = ready.send(Err(message.clone()));
        Err(message)
    }
}

#[cfg(all(test, windows))]
mod tests {
    /// Etat du moteur de dictee de Windows : langues installees, langue systeme, resultat
    /// de la compilation. `cargo test --lib -- --ignored --nocapture dictation_diagnostics`.
    #[test]
    #[ignore]
    fn dictation_diagnostics() {
        use windows::Media::SpeechRecognition::SpeechRecognizer;

        super::platform::init_apartment();

        // Macro locale : le type concret de la collection WinRT n'a pas besoin d'etre nomme.
        macro_rules! show {
            ($label:expr, $call:expr) => {
                match $call {
                    Ok(langs) => {
                        let mut out = Vec::new();
                        for index in 0..langs.Size().unwrap_or(0) {
                            if let Ok(lang) = langs.GetAt(index) {
                                out.push(lang.LanguageTag().map(|t| t.to_string()).unwrap_or_default());
                            }
                        }
                        println!("{} : [{}]", $label, out.join(", "));
                    }
                    Err(e) => println!("{} : ERREUR {:#x} {}", $label, e.code().0, e.message()),
                }
            };
        }
        show!("dictee (topic)", SpeechRecognizer::SupportedTopicLanguages());
        show!("grammaire", SpeechRecognizer::SupportedGrammarLanguages());

        println!("micro par defaut : {:?}", super::platform::default_microphone());

        match SpeechRecognizer::SystemSpeechLanguage() {
            Ok(lang) => println!("langue systeme : {:?}", lang.LanguageTag().map(|t| t.to_string())),
            Err(e) => println!("langue systeme : ERREUR {e:?}"),
        }

        let recognizer = SpeechRecognizer::new();
        println!("creation : {:?}", recognizer.as_ref().map(|_| "ok"));
        if let Ok(recognizer) = recognizer {
            match recognizer.CompileConstraintsAsync().and_then(|op| op.join()) {
                Ok(result) => println!("compilation : {:?}", result.Status()),
                Err(e) => println!("compilation : ERREUR {:#x} {}", e.code().0, e.message()),
            }
        }
    }

    use std::sync::{Arc, Mutex};

    /// Démarre réellement le moteur de dictée de Windows, puis fait parler la synthèse
    /// vocale du système dans les haut-parleurs : si le micro capte la pièce, du texte
    /// doit arriver. Ignoré par défaut (micro requis) :
    /// `cargo test --lib -- --ignored --nocapture dictation_engine_starts`.
    #[test]
    #[ignore]
    fn dictation_engine_starts() {
        let heard: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = heard.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (signal_tx, signal_rx) = std::sync::mpsc::channel();
        let stop_tx = signal_tx.clone();

        let thread = std::thread::spawn(move || {
            super::platform::run(Some("fr-FR"), &ready_tx, signal_tx, signal_rx, move |event, text| {
                println!("<- {event} {text}");
                sink.lock().unwrap().push(format!("{event} {text}"));
            })
        });

        let started = ready_rx.recv().expect("le fil de dictée doit répondre");
        assert!(started.is_ok(), "démarrage impossible : {started:?}");

        // Parole de test dans les haut-parleurs (aucun réseau, voix locale SAPI).
        let _ = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Speech;                  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer;                  $s.Rate = -1; $s.Speak('bonjour ceci est un essai de dictée vocale');                  Start-Sleep -Milliseconds 800;                  $s.Speak('le micro entend bien la voix')",
            ])
            .status();

        std::thread::sleep(std::time::Duration::from_secs(6));
        let _ = stop_tx.send(super::Signal::Stop);
        let outcome = thread.join().unwrap();
        println!("fin : {outcome:?}");
        println!("événements reçus : {:?}", heard.lock().unwrap());
    }
}
