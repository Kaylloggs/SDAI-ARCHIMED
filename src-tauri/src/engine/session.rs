use std::collections::HashMap;
use std::process::Stdio;

use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc;

use crate::core::{AppError, AppResult};

use super::adapters::{self, AnswerAction, CliAdapter, DecodeCtx};
use super::event::{
    AutoMode, EngineEvent, InteractivePrompt, PromptAnswer, ResolvedBy, SessionId,
};
use super::policy::{self, Verdict};

pub enum SessionCommand {
    Send(String),
    Answer {
        prompt_id: String,
        answer: PromptAnswer,
    },
    SetAutoMode(AutoMode),
    Stop,
}

#[allow(dead_code)] // adapter_id: changement de modèle à chaud (Phase 2)
pub struct SessionHandle {
    pub id: SessionId,
    pub adapter_id: String,
    pub tx: mpsc::UnboundedSender<SessionCommand>,
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Paramètres de démarrage d'une session.
pub struct SpawnRequest {
    pub id: SessionId,
    pub adapter: Box<dyn CliAdapter>,
    pub model: Option<String>,
    pub cwd: Option<String>,
    pub auto_mode: AutoMode,
    /// Identifiant de conversation de la CLI à reprendre.
    pub resume: Option<String>,
}

/// Démarre le processus CLI et la boucle de session.
pub fn spawn(
    request: SpawnRequest,
    channel: Channel<EngineEvent>,
    binary_overrides: &HashMap<String, String>,
) -> AppResult<SessionHandle> {
    let SpawnRequest {
        id,
        mut adapter,
        model,
        cwd,
        auto_mode,
        resume,
    } = request;
    let binary = adapters::resolve_binary(adapter.as_ref(), binary_overrides)
        .ok_or_else(|| AppError::cli_missing(adapter.missing_hint()))?;

    if adapter.transport() == super::event::TransportKind::Pty {
        let _ = channel.send(EngineEvent::SessionStarted {
            session_id: id.clone(),
            adapter: adapter.id().to_string(),
            model: model.clone().unwrap_or_default(),
            transport: adapter.transport(),
        });
        let tx = super::pty_session::spawn(
            super::pty_session::PtySpawn {
                session_id: id.clone(),
                binary: &binary,
                args: adapter.spawn_args(super::event::LaunchOptions { model: model.as_deref(), resume: resume.as_deref(), auto_mode }),
                cwd,
                auto_mode,
                extra_rules: adapter.prompt_rules(),
            },
            channel,
        )?;
        return Ok(SessionHandle {
            id,
            adapter_id: adapter.id().to_string(),
            tx,
        });
    }

    let mut command = Command::new(&binary);
    command
        .args(adapter.spawn_args(super::event::LaunchOptions { model: model.as_deref(), resume: resume.as_deref(), auto_mode }))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    if let Some(cwd) = cwd.as_ref() {
        command.current_dir(cwd);
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child: Child = command
        .spawn()
        .map_err(|e| AppError::internal(format!("lancement de {}: {e}", binary.display())))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::internal("stdin indisponible"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::internal("stdout indisponible"))?;
    let stderr = child.stderr.take();

    let (tx, mut rx) = mpsc::unbounded_channel::<SessionCommand>();
    let (line_tx, mut line_rx) = mpsc::unbounded_channel::<String>();

    // Lecture stdout → canal interne.
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line_tx.send(line).is_err() {
                break;
            }
        }
    });

    // stderr : journalisé seulement.
    if let Some(stderr) = stderr {
        let session_id = id.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                tracing::debug!(session_id = %session_id, "stderr: {line}");
            }
        });
    }

    let handle = SessionHandle {
        id: id.clone(),
        adapter_id: adapter.id().to_string(),
        tx: tx.clone(),
    };

    let session_id = id.clone();
    let adapter_id = adapter.id().to_string();
    let model_label = model.clone().unwrap_or_default();
    let transport = adapter.transport();

    tokio::spawn(async move {
        let mut stdin = stdin;
        let mut auto_mode = auto_mode;
        let mut prompts: HashMap<String, InteractivePrompt> = HashMap::new();

        let _ = channel.send(EngineEvent::SessionStarted {
            session_id: session_id.clone(),
            adapter: adapter_id.clone(),
            model: model_label.clone(),
            transport,
        });

        loop {
            tokio::select! {
                Some(line) = line_rx.recv() => {
                    let ctx = DecodeCtx { session_id: &session_id, auto_mode };
                    for event in adapter.decode_line(&line, &ctx) {
                        record_usage(&adapter_id, &model_label, &event);
                        if let EngineEvent::Prompt { prompt } = &event {
                            let auto = try_auto_resolve(prompt, auto_mode);
                            prompts.insert(prompt.prompt_id.clone(), prompt.clone());
                            let _ = channel.send(event.clone());

                            if let Some(allowed) = auto {
                                resolve(
                                    &mut adapter,
                                    &mut stdin,
                                    &channel,
                                    &mut prompts,
                                    &prompt.prompt_id,
                                    PromptAnswer {
                                        option_id: Some(if allowed { "allow".into() } else { "deny".into() }),
                                        text: None,
                                        edited_input: None,
                                    },
                                    if allowed { ResolvedBy::Auto } else { ResolvedBy::Policy },
                                )
                                .await;
                            }
                            continue;
                        }
                        let _ = channel.send(event);
                    }
                }

                Some(command) = rx.recv() => {
                    match command {
                        SessionCommand::Send(text) => {
                            let payload = adapter.encode_user_message(&text);
                            if let Err(error) = write_line(&mut stdin, &payload).await {
                                let _ = channel.send(EngineEvent::Error {
                                    code: "IO".into(),
                                    message: error.message,
                                    recoverable: false,
                                });
                            } else if adapter.closes_stdin_after_message() {
                                // CLI one-shot (codex exec) : elle ne traite le prompt qu'à EOF.
                                let _ = stdin.shutdown().await;
                            }
                        }
                        SessionCommand::Answer { prompt_id, answer } => {
                            resolve(
                                &mut adapter,
                                &mut stdin,
                                &channel,
                                &mut prompts,
                                &prompt_id,
                                answer,
                                ResolvedBy::User,
                            )
                            .await;
                        }
                        SessionCommand::SetAutoMode(mode) => auto_mode = mode,
                        SessionCommand::Stop => break,
                    }
                }

                else => break,
            }
        }

        let _ = child.kill().await;
        let exit_code = child.wait().await.ok().and_then(|status| status.code());
        let _ = channel.send(EngineEvent::SessionEnded { exit_code });
    });

    Ok(handle)
}

/// Alimente le registre de consommation (module Crédits) sans bloquer la session.
fn record_usage(adapter: &str, model: &str, event: &EngineEvent) {
    match event {
        EngineEvent::TurnCompleted {
            duration_ms,
            input_tokens,
            output_tokens,
            thinking_tokens,
            cache_tokens,
            cost_usd,
            ..
        } => crate::core::usage::record_turn(&crate::core::usage::TurnRecord {
            at: chrono::Utc::now().timestamp(),
            adapter: adapter.to_string(),
            model: model.to_string(),
            input_tokens: *input_tokens,
            output_tokens: *output_tokens,
            thinking_tokens: *thinking_tokens,
            cache_tokens: *cache_tokens,
            cost_usd: *cost_usd,
            duration_ms: *duration_ms,
        }),
        EngineEvent::RateLimit { status, windows } => {
            crate::core::usage::record_limits(adapter, status, windows)
        }
        _ => {}
    }
}

/// Décide si le Mode Auto peut répondre seul. `None` = demander à l'utilisateur.
fn try_auto_resolve(prompt: &InteractivePrompt, mode: AutoMode) -> Option<bool> {
    let payload = prompt
        .detail
        .as_ref()
        .map(|detail| match detail {
            super::event::PromptDetail::Command { line, .. } => line.clone(),
            super::event::PromptDetail::Diff { path, .. } => path.clone(),
            super::event::PromptDetail::Text { text } => text.clone(),
            super::event::PromptDetail::Json { value } => value.to_string(),
        })
        .unwrap_or_default();

    let decision = policy::evaluate(prompt.tool.as_deref().unwrap_or(""), &payload, mode);
    match decision.verdict {
        Verdict::Allow => Some(true),
        Verdict::Deny => Some(false),
        Verdict::Ask => None,
    }
}

async fn resolve(
    adapter: &mut Box<dyn CliAdapter>,
    stdin: &mut ChildStdin,
    channel: &Channel<EngineEvent>,
    prompts: &mut HashMap<String, InteractivePrompt>,
    prompt_id: &str,
    answer: PromptAnswer,
    by: ResolvedBy,
) {
    let Some(prompt) = prompts.remove(prompt_id) else {
        return;
    };
    let allowed = answer.option_id.as_deref() != Some("deny");

    crate::core::audit::record(
        "engine.permission",
        &format!("{} {}", prompt.tool.as_deref().unwrap_or("?"), prompt.title),
        if allowed { "allow" } else { "deny" },
        match by {
            ResolvedBy::User => "user",
            ResolvedBy::Auto => "auto",
            ResolvedBy::Policy => "policy",
        },
    );

    match adapter.encode_answer(&prompt, &answer, allowed) {
        AnswerAction::Stdin(payload) => {
            if let Err(error) = write_line(stdin, &payload).await {
                let _ = channel.send(EngineEvent::Error {
                    code: "IO".into(),
                    message: error.message,
                    recoverable: false,
                });
            }
        }
        AnswerAction::Keys(bytes) => {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.flush().await;
        }
        AnswerAction::None => {}
    }

    let _ = channel.send(EngineEvent::PromptResolved {
        prompt_id: prompt_id.to_string(),
        by,
        option_id: answer.option_id,
    });
}

async fn write_line(stdin: &mut ChildStdin, payload: &str) -> AppResult<()> {
    stdin.write_all(payload.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}
