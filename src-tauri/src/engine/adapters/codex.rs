//! Adaptateur Codex CLI (OpenAI) — **expérimental, non vérifié sur machine**.
//!
//! Transport : `codex exec --json -` (prompt lu sur stdin, événements JSONL sur stdout).
//! `codex exec` est **one-shot** : le processus se termine après le tour. ARCHIMED
//! relance donc une session à chaque message (pas de continuité de contexte tant que
//! `codex exec resume` n'est pas branché — Phase 2).
//!
//! Le décodeur est volontairement tolérant : tout événement inconnu est ignoré plutôt
//! que de casser la session. À revalider avec `codex exec --help` lors de l'installation.

use std::path::Path;

use serde_json::Value;

use crate::engine::event::{
    EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo, PromptAnswer, TransportKind,
};

use super::{AnswerAction, CliAdapter, DecodeCtx};

#[derive(Default)]
pub struct CodexAdapter;

impl CliAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn name(&self) -> &'static str {
        "Codex"
    }

    fn accent(&self) -> &'static str {
        "neutral"
    }

    fn transport(&self) -> TransportKind {
        TransportKind::Structured
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &["codex"]
    }

    fn closes_stdin_after_message(&self) -> bool {
        true
    }

    fn version(&self, binary: &Path) -> Option<String> {
        let output = crate::core::process::command(binary)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn models(&self, _binary: Option<&Path>) -> Vec<ModelInfo> {
        [
            ("gpt-5.3-codex", "GPT-5.3 Codex"),
            ("gpt-5.3-codex-mini", "GPT-5.3 Codex Mini"),
        ]
        .iter()
        .map(|(id, label)| ModelInfo {
            id: (*id).to_string(),
            label: (*label).to_string(),
        })
        .collect()
    }

    fn default_model(&self) -> Option<String> {
        None
    }

    fn missing_hint(&self) -> &'static str {
        "Codex CLI introuvable. Installez-la, ou indiquez son chemin dans Réglages > Moteur."
    }

    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String> {
        let model = options.model;
        let mut args: Vec<String> = ["exec", "--json", "--skip-git-repo-check"]
            .iter()
            .map(|s| s.to_string())
            .collect();

        if let Some(model) = model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }
        // `-` : lire le prompt sur stdin.
        args.push("-".to_string());
        args
    }

    fn encode_user_message(&self, text: &str) -> String {
        text.to_string()
    }

    fn decode_line(&mut self, line: &str, _ctx: &DecodeCtx) -> Vec<EngineEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        // Deux formes rencontrées : { "msg": { "type": … } } ou { "type": … } à la racine.
        let msg = value.get("msg").unwrap_or(&value);
        let Some(kind) = msg.get("type").and_then(Value::as_str) else {
            return Vec::new();
        };
        let id = value
            .get("id")
            .and_then(|v| v.as_str().map(str::to_string).or_else(|| v.as_u64().map(|n| n.to_string())))
            .unwrap_or_else(|| "codex".to_string());

        match kind {
            "agent_message_delta" => msg
                .get("delta")
                .and_then(Value::as_str)
                .map(|text| {
                    vec![EngineEvent::MessageDelta {
                        message_id: id,
                        text: text.to_string(),
                    }]
                })
                .unwrap_or_default(),

            "agent_message" => msg
                .get("message")
                .or_else(|| msg.get("text"))
                .and_then(Value::as_str)
                .map(|text| {
                    vec![
                        EngineEvent::MessageDelta {
                            message_id: id.clone(),
                            text: text.to_string(),
                        },
                        EngineEvent::MessageCompleted { message_id: id },
                    ]
                })
                .unwrap_or_default(),

            "exec_command_begin" | "patch_apply_begin" => {
                let command = msg
                    .get("command")
                    .map(|value| match value {
                        Value::Array(parts) => parts
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" "),
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();

                vec![EngineEvent::ToolCall {
                    call_id: id,
                    tool: if kind == "exec_command_begin" { "shell" } else { "patch" }.to_string(),
                    input: serde_json::json!({ "command": command }),
                }]
            }

            "exec_command_end" | "patch_apply_end" => vec![EngineEvent::ToolResult {
                call_id: id,
                ok: msg
                    .get("exit_code")
                    .and_then(Value::as_i64)
                    .map(|code| code == 0)
                    .unwrap_or(true),
                output: msg
                    .get("stdout")
                    .or_else(|| msg.get("output"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            }],

            "token_count" => {
                let info = msg.get("info").unwrap_or(msg);
                vec![EngineEvent::Usage {
                    input_tokens: info.get("input_tokens").and_then(Value::as_u64).unwrap_or(0),
                    output_tokens: info.get("output_tokens").and_then(Value::as_u64).unwrap_or(0),
                    cost_usd: None,
                }]
            }

            "error" | "stream_error" => vec![EngineEvent::Error {
                code: "CLI_ERROR".to_string(),
                message: msg
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Erreur Codex")
                    .to_string(),
                recoverable: true,
            }],

            _ => Vec::new(),
        }
    }

    fn encode_answer(
        &mut self,
        _prompt: &InteractivePrompt,
        _answer: &PromptAnswer,
        _allowed: bool,
    ) -> AnswerAction {
        AnswerAction::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::event::AutoMode;

    fn ctx() -> DecodeCtx<'static> {
        DecodeCtx {
            session_id: "s1",
            auto_mode: AutoMode::Off,
        }
    }

    #[test]
    fn decodes_agent_message() {
        let mut adapter = CodexAdapter;
        let line = r#"{"id":"0","msg":{"type":"agent_message","message":"salut"}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(matches!(&events[0], EngineEvent::MessageDelta { text, .. } if text == "salut"));
        assert!(matches!(events[1], EngineEvent::MessageCompleted { .. }));
    }

    #[test]
    fn decodes_command_execution() {
        let mut adapter = CodexAdapter;
        let begin = r#"{"id":"1","msg":{"type":"exec_command_begin","command":["ls","-la"]}}"#;
        let events = adapter.decode_line(begin, &ctx());
        assert!(matches!(&events[0], EngineEvent::ToolCall { tool, .. } if tool == "shell"));
    }

    #[test]
    fn ignores_unknown_events() {
        let mut adapter = CodexAdapter;
        assert!(adapter
            .decode_line(r#"{"msg":{"type":"quelque_chose_de_nouveau"}}"#, &ctx())
            .is_empty());
        assert!(adapter.decode_line("pas du json", &ctx()).is_empty());
    }
}
