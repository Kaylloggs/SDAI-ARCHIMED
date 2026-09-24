use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;

use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::mpsc;

use crate::core::{AppError, AppResult};

use super::adapters::{self, AnswerAction, CliAdapter, DecodeCtx, PermissionGrant};
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


/// Paramètres de démarrage d'une session.
pub struct SpawnRequest {
    pub id: SessionId,
    pub adapter: Box<dyn CliAdapter>,
    pub model: Option<String>,
    pub cwd: Option<String>,
    pub auto_mode: AutoMode,
    /// Identifiant de conversation de la CLI à reprendre.
    pub resume: Option<String>,
    /// Réglages d'économie de tokens (Réglages).
    pub tuning: super::event::EngineTuning,
    /// Consignes du module qui ouvre la session.
    pub options: super::event::SessionOptions,
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
        tuning,
        options,
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
                args: adapter.spawn_args(super::event::LaunchOptions { model: model.as_deref(), resume: resume.as_deref(), auto_mode, cwd: cwd.as_deref(), tuning: &tuning, mcp_config: crate::core::mcp::merged().as_deref(), session: &options }),
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

    // Consignes en tête du message, pour les CLI sans option de prompt système : au premier
    // message d'une nouvelle conversation, ou à chaque message pour une CLI sans mémoire.
    let mut preface = options
        .append_system_prompt
        .clone()
        .filter(|text| !text.trim().is_empty() && !adapter.supports_system_prompt())
        .filter(|_| resume.is_none() || adapter.closes_stdin_after_message());
    let launch = Launch {
        session_id: id.clone(),
        binary,
        model: model.clone(),
        cwd,
        tuning,
        options,
        channel: channel.clone(),
    };
    let process = launch.start(adapter.as_ref(), resume.as_deref(), auto_mode)?;

    let (tx, mut rx) = mpsc::unbounded_channel::<SessionCommand>();

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
        let mut process = process;
        let mut auto_mode = auto_mode;
        let mut prompts: HashMap<String, InteractivePrompt> = HashMap::new();
        let mut cli_session = resume;
        // Règles accordées pour un seul tour : retirées à la fin du tour de relance.
        let mut temporary_rules: Vec<String> = Vec::new();

        let _ = channel.send(EngineEvent::SessionStarted {
            session_id: session_id.clone(),
            adapter: adapter_id.clone(),
            model: model_label.clone(),
            transport,
        });

        loop {
            let mut relaunch: Option<(PermissionGrant, String)> = None;

            tokio::select! {
                Some(line) = process.lines.recv() => {
                    // Console brute : le flux tel que la CLI l'émet (une ligne JSON par événement).
                    let _ = channel.send(EngineEvent::RawOutput { chunk: format!("{line}\n") });
                    let ctx = DecodeCtx { session_id: &session_id, auto_mode, cwd: launch.cwd.as_deref() };
                    for event in adapter.decode_line(&line, &ctx) {
                        record_usage(&adapter_id, &model_label, &event);
                        match &event {
                            EngineEvent::CliSession { cli_session_id } => {
                                cli_session = Some(cli_session_id.clone());
                            }
                            EngineEvent::TurnCompleted { .. } => {
                                revoke_rules(adapter.as_ref(), &mut temporary_rules);
                            }
                            _ => {}
                        }
                        if let EngineEvent::Prompt { prompt } = &event {
                            let auto = try_auto_resolve(prompt, auto_mode, launch.cwd.as_deref());
                            prompts.insert(prompt.prompt_id.clone(), prompt.clone());
                            let _ = channel.send(event.clone());

                            if let Some(allowed) = auto {
                                let action = resolve(
                                    &mut adapter,
                                    &mut process.stdin,
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
                                if relaunch.is_none() {
                                    relaunch = action;
                                }
                            }
                            continue;
                        }
                        let _ = channel.send(event);
                    }
                }

                Some(command) = rx.recv() => {
                    match command {
                        SessionCommand::Send(text) => {
                            let text = match &preface {
                                Some(instructions) => {
                                    let framed = format!("[Consignes]\n{instructions}\n\n[Demande]\n{text}");
                                    if !adapter.closes_stdin_after_message() {
                                        preface = None;
                                    }
                                    framed
                                }
                                None => text,
                            };
                            let payload = adapter.encode_user_message(&text);
                            if let Err(error) = write_line(&mut process.stdin, &payload).await {
                                let _ = channel.send(EngineEvent::Error {
                                    code: "IO".into(),
                                    message: error.message,
                                    recoverable: false,
                                });
                            } else if adapter.closes_stdin_after_message() {
                                // CLI one-shot (codex exec) : elle ne traite le prompt qu'à EOF.
                                let _ = process.stdin.shutdown().await;
                            }
                        }
                        SessionCommand::Answer { prompt_id, answer } => {
                            relaunch = resolve(
                                &mut adapter,
                                &mut process.stdin,
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

            let Some((grant, retry)) = relaunch else {
                continue;
            };
            if let Err(error) = adapter.grant_permission(&grant.rule) {
                let _ = channel.send(EngineEvent::Error {
                    code: "PERMISSION_DENIED".into(),
                    message: error.message,
                    recoverable: true,
                });
                continue;
            }
            crate::core::audit::record(
                "engine.permission.rule",
                &grant.rule,
                if grant.persistent { "granted" } else { "granted-once" },
                &adapter_id,
            );
            if !grant.persistent {
                temporary_rules.push(grant.rule.clone());
            }

            // La CLI ne relit ses règles qu'au démarrage : relance sur la même conversation.
            // Les autres refus en attente seront redemandés par la nouvelle tentative.
            for prompt_id in prompts.keys() {
                let _ = channel.send(EngineEvent::PromptInvalidated { prompt_id: prompt_id.clone() });
            }
            prompts.clear();
            let _ = process.child.kill().await;
            match launch.start(adapter.as_ref(), cli_session.as_deref(), auto_mode) {
                Ok(next) => {
                    process = next;
                    let payload = adapter.encode_user_message(&retry);
                    if let Err(error) = write_line(&mut process.stdin, &payload).await {
                        let _ = channel.send(EngineEvent::Error {
                            code: "IO".into(),
                            message: error.message,
                            recoverable: false,
                        });
                    }
                }
                Err(error) => {
                    let _ = channel.send(EngineEvent::Error {
                        code: "PROCESS_CRASHED".into(),
                        message: error.message,
                        recoverable: false,
                    });
                    break;
                }
            }
        }

        revoke_rules(adapter.as_ref(), &mut temporary_rules);
        let _ = process.child.kill().await;
        let exit_code = process.child.wait().await.ok().and_then(|status| status.code());
        let _ = channel.send(EngineEvent::SessionEnded { exit_code });
    });

    Ok(handle)
}

/// Processus CLI en cours et son flux de lignes.
struct Process {
    child: Child,
    stdin: ChildStdin,
    lines: mpsc::UnboundedReceiver<String>,
}

/// Tout ce qu'il faut pour (re)lancer la CLI d'une session.
struct Launch {
    session_id: SessionId,
    binary: PathBuf,
    model: Option<String>,
    cwd: Option<String>,
    tuning: super::event::EngineTuning,
    options: super::event::SessionOptions,
    channel: Channel<EngineEvent>,
}

impl Launch {
    fn start(
        &self,
        adapter: &dyn CliAdapter,
        resume: Option<&str>,
        auto_mode: AutoMode,
    ) -> AppResult<Process> {
        let mut command = crate::core::process::async_command(&self.binary);
        command
            .args(adapter.spawn_args(super::event::LaunchOptions {
                model: self.model.as_deref(),
                resume,
                auto_mode,
                cwd: self.cwd.as_deref(),
                tuning: &self.tuning,
                // Outils fournis par les modules : ils suivent chaque relance de la CLI.
                mcp_config: crate::core::mcp::merged().as_deref(),
                session: &self.options,
            }))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(cwd) = self.cwd.as_ref() {
            command.current_dir(cwd);
        }

        let mut child: Child = command.spawn().map_err(|e| {
            AppError::internal(format!("lancement de {}: {e}", self.binary.display()))
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("stdin indisponible"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("stdout indisponible"))?;

        // Lecture stdout → canal interne.
        let (line_tx, lines) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if line_tx.send(line).is_err() {
                    break;
                }
            }
        });

        // stderr : journalisé et visible dans la console brute (erreurs de la CLI).
        if let Some(stderr) = child.stderr.take() {
            let session_id = self.session_id.clone();
            let raw_channel = self.channel.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    tracing::debug!(session_id = %session_id, "stderr: {line}");
                    let _ = raw_channel.send(EngineEvent::RawOutput {
                        chunk: format!("[stderr] {line}\n"),
                    });
                }
            });
        }

        Ok(Process { child, stdin, lines })
    }
}

fn revoke_rules(adapter: &dyn CliAdapter, rules: &mut Vec<String>) {
    for rule in rules.drain(..) {
        match adapter.revoke_permission(&rule) {
            Ok(()) => crate::core::audit::record("engine.permission.rule", &rule, "revoked", adapter.id()),
            Err(error) => tracing::warn!("règle {rule} non retirée : {}", error.message),
        }
    }
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
fn try_auto_resolve(prompt: &InteractivePrompt, mode: AutoMode, cwd: Option<&str>) -> Option<bool> {
    let target = match &prompt.detail {
        Some(super::event::PromptDetail::Diff { path, .. }) => Some(path.as_str()),
        _ => None,
    };
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

    let decision = policy::evaluate_in(
        prompt.tool.as_deref().unwrap_or(""),
        &payload,
        target,
        cwd,
        mode,
    );
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
) -> Option<(PermissionGrant, String)> {
    let prompt = prompts.remove(prompt_id)?;
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

    let mut relaunch = None;
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
        AnswerAction::Relaunch { grant, retry } => relaunch = Some((grant, retry)),
    }

    let _ = channel.send(EngineEvent::PromptResolved {
        prompt_id: prompt_id.to_string(),
        by,
        option_id: answer.option_id,
    });
    relaunch
}

async fn write_line(stdin: &mut ChildStdin, payload: &str) -> AppResult<()> {
    stdin.write_all(payload.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}
