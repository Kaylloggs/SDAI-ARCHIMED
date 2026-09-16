//! Transport PTY (ConPTY sous Windows) pour les CLI sans protocole structuré.
//!
//! ```text
//! processus ─► thread lecteur ─► mpsc ─► boucle tokio ─┬─► RawOutput (lots de 16 ms)
//!                                                     └─► écran vt100 ─► (120 ms de calme)
//!                                                           └─► detector ─► Prompt / PromptInvalidated
//! réponse utilisateur ─► touches ─► thread écrivain ─► processus
//! ```
//! Aucune I/O bloquante sur le runtime async : lecture, écriture et attente de fin
//! du processus ont chacune leur thread (guidelines.md §10).

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::sync::mpsc;

use crate::core::{AppError, AppResult};

use super::event::{
    AutoMode, EngineEvent, InteractivePrompt, PromptDetail, PromptOption, PromptSource, ResolvedBy,
    RiskLevel,
};
use super::parser::{detector, rules, screen::Screen};
use super::session::SessionCommand;

/// Silence de sortie avant d'analyser l'écran : une question est affichée, la CLI attend.
const QUIET: Duration = Duration::from_millis(120);
const RAW_BATCH: Duration = Duration::from_millis(16);
const MIN_CONFIDENCE: f32 = 0.55;
const ROWS: u16 = 50;
const COLS: u16 = 200;

/// Destination des événements : le `Channel` Tauri en production, un canal en test.
pub trait EventSink: Send + 'static {
    fn emit(&self, event: EngineEvent);
}

impl EventSink for tauri::ipc::Channel<EngineEvent> {
    fn emit(&self, event: EngineEvent) {
        let _ = self.send(event);
    }
}

impl EventSink for mpsc::UnboundedSender<EngineEvent> {
    fn emit(&self, event: EngineEvent) {
        let _ = self.send(event);
    }
}

pub struct PtySpawn<'a> {
    pub session_id: String,
    pub binary: &'a Path,
    pub args: Vec<String>,
    pub cwd: Option<String>,
    pub auto_mode: AutoMode,
    /// Règles propres à la CLI (TOML), ajoutées avant les règles génériques.
    pub extra_rules: Option<String>,
}

struct PendingPrompt {
    prompt: InteractivePrompt,
    keys: HashMap<String, Vec<u8>>,
}

pub fn spawn<S: EventSink>(
    request: PtySpawn<'_>,
    sink: S,
) -> AppResult<mpsc::UnboundedSender<SessionCommand>> {
    let rule_set = rules::load(request.extra_rules.as_deref())?;

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: ROWS,
            cols: COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| AppError::internal(format!("ouverture du PTY : {e}")))?;

    let mut command = CommandBuilder::new(request.binary);
    command.args(&request.args);
    if let Some(cwd) = &request.cwd {
        command.cwd(cwd);
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| AppError::internal(format!("lancement dans le PTY : {e}")))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| AppError::internal(format!("lecture du PTY : {e}")))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|e| AppError::internal(format!("écriture du PTY : {e}")))?;

    // Lecture bloquante → canal.
    let (bytes_tx, mut bytes_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => {
                    if bytes_tx.send(buffer[..read].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Écriture bloquante ← canal.
    let (keys_tx, keys_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(keys) = keys_rx.recv() {
            if writer.write_all(&keys).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });

    // Fin du processus.
    let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel::<Option<i32>>();
    let (kill_tx, kill_rx) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || loop {
        if kill_rx.try_recv().is_ok() {
            let _ = child.kill();
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = exit_tx.send(i32::try_from(status.exit_code()).ok());
                break;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                let _ = exit_tx.send(None);
                break;
            }
        }
    });

    let (command_tx, mut command_rx) = mpsc::unbounded_channel::<SessionCommand>();
    let session_id = request.session_id;
    let mut auto_mode = request.auto_mode;
    // Le maître du PTY doit vivre aussi longtemps que la session.
    let master = pair.master;

    tokio::spawn(async move {
        let _master = master;
        let mut screen = Screen::new(ROWS, COLS);
        let mut raw = Vec::<u8>::new();
        let mut last_output = Instant::now();
        let mut last_raw_flush = Instant::now();
        let mut dirty = false;
        let mut current: Option<(u64, PendingPrompt)> = None;
        let mut exited: Option<Option<i32>> = None;
        let mut ticker = tokio::time::interval(Duration::from_millis(40));

        loop {
            tokio::select! {
                Some(bytes) = bytes_rx.recv() => {
                    screen.feed(&bytes);
                    // Requête de position du curseur (DSR, `ESC[6n`) : ConPTY l'envoie au
                    // démarrage et bloque tant qu'un terminal n'a pas répondu.
                    for _ in 0..count_dsr(&bytes) {
                        let (row, col) = screen.cursor();
                        let _ = keys_tx.send(format!("[{};{}R", row + 1, col + 1).into_bytes());
                    }
                    raw.extend_from_slice(&bytes);
                    last_output = Instant::now();
                    dirty = true;
                }

                Some(command) = command_rx.recv() => match command {
                    SessionCommand::Send(text) => {
                        let mut keys = text.into_bytes();
                        keys.push(b'\r');
                        let _ = keys_tx.send(keys);
                    }
                    SessionCommand::Answer { prompt_id, answer } => {
                        if let Some((_, pending)) = current.as_ref() {
                            if pending.prompt.prompt_id == prompt_id {
                                let keys = match (&answer.text, &answer.option_id) {
                                    (Some(text), _) => {
                                        let mut keys = text.clone().into_bytes();
                                        keys.push(b'\r');
                                        Some(keys)
                                    }
                                    (None, Some(option)) => pending.keys.get(option).cloned(),
                                    _ => None,
                                };
                                if let Some(keys) = keys {
                                    let _ = keys_tx.send(keys);
                                    sink.emit(EngineEvent::PromptResolved {
                                        prompt_id,
                                        by: ResolvedBy::User,
                                        option_id: answer.option_id,
                                    });
                                    crate::core::audit::record(
                                        "engine.screen_prompt",
                                        &pending.prompt.title,
                                        "answered",
                                        "user",
                                    );
                                }
                            }
                        }
                    }
                    SessionCommand::SetAutoMode(mode) => auto_mode = mode,
                    SessionCommand::Stop => {
                        let _ = kill_tx.send(());
                    }
                },

                code = &mut exit_rx, if exited.is_none() => {
                    exited = Some(code.unwrap_or(None));
                }

                _ = ticker.tick() => {
                    if !raw.is_empty() && last_raw_flush.elapsed() >= RAW_BATCH {
                        sink.emit(EngineEvent::RawOutput {
                            chunk: String::from_utf8_lossy(&raw).into_owned(),
                        });
                        raw.clear();
                        last_raw_flush = Instant::now();
                    }

                    if dirty && last_output.elapsed() >= QUIET {
                        dirty = false;
                        let detection = detector::detect(&screen.lines(), &rule_set, MIN_CONFIDENCE);
                        match detection {
                            Some(found) if current.as_ref().map(|(fp, _)| *fp) != Some(found.fingerprint) => {
                                if let Some((_, previous)) = current.take() {
                                    sink.emit(EngineEvent::PromptInvalidated { prompt_id: previous.prompt.prompt_id });
                                }
                                let pending = to_prompt(&session_id, found.clone());
                                sink.emit(EngineEvent::Prompt { prompt: pending.prompt.clone() });

                                // Mode Auto complet : la réponse par défaut de la CLI est envoyée.
                                // En mode intelligent, une question lue à l'écran reste toujours
                                // soumise à l'utilisateur (son risque ne peut pas être évalué).
                                if auto_mode == AutoMode::Full {
                                    if let Some(default) = &pending.prompt.default_option {
                                        if let Some(keys) = pending.keys.get(default) {
                                            let _ = keys_tx.send(keys.clone());
                                            sink.emit(EngineEvent::PromptResolved {
                                                prompt_id: pending.prompt.prompt_id.clone(),
                                                by: ResolvedBy::Auto,
                                                option_id: Some(default.clone()),
                                            });
                                        }
                                    }
                                }
                                current = Some((found.fingerprint, pending));
                            }
                            Some(_) => {}
                            None => {
                                if let Some((_, previous)) = current.take() {
                                    sink.emit(EngineEvent::PromptInvalidated { prompt_id: previous.prompt.prompt_id });
                                }
                            }
                        }
                    }

                    if let Some(code) = exited {
                        if bytes_rx.is_empty() && !dirty {
                            if !raw.is_empty() {
                                sink.emit(EngineEvent::RawOutput { chunk: String::from_utf8_lossy(&raw).into_owned() });
                            }
                            sink.emit(EngineEvent::SessionEnded { exit_code: code });
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(command_tx)
}

/// Nombre de requêtes « position du curseur » (`ESC [ 6 n`) dans un bloc de sortie.
fn count_dsr(bytes: &[u8]) -> usize {
    bytes.windows(4).filter(|window| window == b"[6n").count()
}

fn to_prompt(session_id: &str, found: detector::Detection) -> PendingPrompt {
    let prompt_id = uuid::Uuid::new_v4().to_string();
    let keys = found
        .options
        .iter()
        .map(|option| (option.id.clone(), option.keys.clone()))
        .collect();
    PendingPrompt {
        keys,
        prompt: InteractivePrompt {
            prompt_id,
            session_id: session_id.to_string(),
            kind: found.kind,
            tool: None,
            title: found.title,
            detail: Some(PromptDetail::Text { text: found.excerpt.clone() }),
            options: found
                .options
                .into_iter()
                .map(|option| PromptOption {
                    id: option.id,
                    label: option.label,
                    variant: option.variant,
                    shortcut: None,
                })
                .collect(),
            default_option: found.default_option,
            allow_free_text: found.allow_free_text,
            risk: RiskLevel::Medium,
            source: PromptSource::Screen {
                rule_id: found.rule_id,
                confidence: found.confidence,
            },
            raw_excerpt: Some(found.excerpt),
        },
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::engine::event::PromptAnswer;

    /// Bout en bout sur un vrai prompt interactif : PowerShell `Read-Host` dans ConPTY.
    #[tokio::test(flavor = "multi_thread")]
    async fn answers_a_real_interactive_prompt() {
        let powershell = which::which("powershell").expect("powershell disponible sous Windows");
        let (sink, mut events) = mpsc::unbounded_channel::<EngineEvent>();

        let commands = spawn(
            PtySpawn {
                session_id: "test".into(),
                binary: &powershell,
                args: vec![
                    "-NoLogo".into(),
                    "-NoProfile".into(),
                    "-Command".into(),
                    "$r = Read-Host 'Continuer ? [Y/n]'; Write-Output ('REPONSE=' + $r)".into(),
                ],
                cwd: None,
                auto_mode: AutoMode::Off,
                extra_rules: None,
            },
            sink,
        )
        .expect("session PTY démarrée");

        let mut transcript = String::new();
        let mut answered = false;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(30);

        loop {
            let event = tokio::time::timeout_at(deadline, events.recv())
                .await
                .expect("la session doit se terminer avant 30 s")
                .expect("canal ouvert");
            match event {
                EngineEvent::Prompt { prompt } if !answered => {
                    assert_eq!(prompt.title, "Continuer");
                    assert_eq!(prompt.default_option.as_deref(), Some("yes"));
                    commands
                        .send(SessionCommand::Answer {
                            prompt_id: prompt.prompt_id,
                            answer: PromptAnswer { option_id: Some("yes".into()), text: None, edited_input: None },
                        })
                        .unwrap();
                    answered = true;
                }
                EngineEvent::RawOutput { chunk } => transcript.push_str(&chunk),
                EngineEvent::SessionEnded { .. } => break,
                _ => {}
            }
        }

        assert!(answered, "la question n'a pas été détectée ; sortie : {transcript}");
        assert!(transcript.contains("REPONSE=y"), "réponse non transmise ; sortie : {transcript}");
    }
}
