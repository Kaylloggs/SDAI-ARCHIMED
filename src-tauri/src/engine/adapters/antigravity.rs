//! Adaptateur Antigravity CLI (`agy`).
//! Testé avec agy 1.2.3 (2026-09-16).
//!
//! Transport : `-p --input-format stream-json --output-format stream-json`.
//! Format observé : une ligne = `{"event":"init"|"step_update"|"result", ...}`.
//!
//! Limite connue (Phase 1) : en mode headless, `agy` refuse automatiquement toute
//! action nécessitant une permission et le signale dans l'erreur de l'étape
//! (`permission check failed …`). ARCHIMED transforme ce refus en carte
//! explicative. La validation interactive passera par le transport PTY (Phase 2).

use std::path::Path;

use serde_json::{json, Value};

use crate::engine::event::{
    EngineEvent, InteractivePrompt, ModelInfo, PromptAnswer, TransportKind,
};

use super::{AnswerAction, CliAdapter, DecodeCtx};

#[derive(Default)]
pub struct AntigravityAdapter;

impl CliAdapter for AntigravityAdapter {
    fn id(&self) -> &'static str {
        "antigravity"
    }

    fn name(&self) -> &'static str {
        "Antigravity"
    }

    fn accent(&self) -> &'static str {
        "antigravity"
    }

    fn transport(&self) -> TransportKind {
        TransportKind::Structured
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &["agy"]
    }

    fn version(&self, binary: &Path) -> Option<String> {
        let output = std::process::Command::new(binary)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn models(&self, binary: Option<&Path>) -> Vec<ModelInfo> {
        let Some(binary) = binary else {
            return Vec::new();
        };
        let Ok(output) = std::process::Command::new(binary).arg("models").output() else {
            return Vec::new();
        };
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (id, label) = line.split_once('\t')?;
                let id = id.trim();
                if id.is_empty() || id.contains(' ') {
                    return None;
                }
                Some(ModelInfo {
                    id: id.to_string(),
                    label: label.trim().to_string(),
                })
            })
            .collect()
    }

    fn default_model(&self) -> Option<String> {
        None
    }

    fn missing_hint(&self) -> &'static str {
        "Antigravity CLI (agy) introuvable dans le PATH."
    }

    fn spawn_args(&self, model: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();

        if let Some(model) = model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }
        args
    }

    fn encode_user_message(&self, text: &str) -> String {
        json!({ "type": "user", "message": { "role": "user", "content": text } }).to_string()
    }

    fn decode_line(&mut self, line: &str, _ctx: &DecodeCtx) -> Vec<EngineEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };

        match value.get("event").and_then(Value::as_str) {
            Some("step_update") => decode_step(value.get("step_update").unwrap_or(&Value::Null)),
            Some("result") => decode_result(value.get("result").unwrap_or(&Value::Null)),
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

fn decode_step(step: &Value) -> Vec<EngineEvent> {
    let state = step.get("state").and_then(Value::as_str).unwrap_or("");
    let step_type = step.get("step_type").and_then(Value::as_str).unwrap_or("");
    let index = step.get("step_index").and_then(Value::as_u64).unwrap_or(0);
    let message_id = format!("step-{index}");
    let mut events = Vec::new();

    match step_type {
        "agent_response" => {
            if let Some(delta) = step.get("text_delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    events.push(EngineEvent::MessageDelta {
                        message_id: message_id.clone(),
                        text: delta.to_string(),
                    });
                }
            }
            if state == "DONE" {
                events.push(EngineEvent::MessageCompleted { message_id });
            }
        }
        "tool" => {
            let info = step.get("tool_info").unwrap_or(&Value::Null);
            let tool = step
                .get("tool_name")
                .and_then(Value::as_str)
                .unwrap_or("outil")
                .to_string();
            let call_id = format!("tool-{index}");

            match state {
                "ACTIVE" => events.push(EngineEvent::ToolCall {
                    call_id,
                    tool,
                    input: info.get("parameters").cloned().unwrap_or(Value::Null),
                }),
                "DONE" => events.push(EngineEvent::ToolResult {
                    call_id,
                    ok: true,
                    output: info
                        .get("result")
                        .map(|v| match v {
                            Value::String(text) => text.clone(),
                            other => other.to_string(),
                        })
                        .unwrap_or_default(),
                }),
                "ERROR" => {
                    let message = info
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Échec de l'outil")
                        .to_string();

                    events.push(EngineEvent::ToolResult {
                        call_id,
                        ok: false,
                        output: message.clone(),
                    });

                    if message.contains("permission check failed") {
                        events.push(EngineEvent::Error {
                            code: "PERMISSION_DENIED".to_string(),
                            message: format!(
                                "Antigravity a refusé une action faute de validation possible en mode headless. \
                                 Autorisez-la dans les réglages d'agy, ou utilisez Claude pour cette tâche. ({message})"
                            ),
                            recoverable: true,
                        });
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }

    if let Some(usage) = step.get("usage") {
        events.push(EngineEvent::Usage {
            input_tokens: usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens: usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cost_usd: None,
        });
    }

    events
}

fn decode_result(result: &Value) -> Vec<EngineEvent> {
    if result.get("status").and_then(Value::as_str) == Some("SUCCESS") {
        return Vec::new();
    }
    vec![EngineEvent::Error {
        code: "CLI_ERROR".to_string(),
        message: result
            .get("response")
            .and_then(Value::as_str)
            .unwrap_or("La CLI a terminé en erreur")
            .to_string(),
        recoverable: true,
    }]
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
    fn decodes_text_delta() {
        let mut adapter = AntigravityAdapter;
        let line = r#"{"event":"step_update","step_update":{"step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"pong"}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(matches!(&events[0], EngineEvent::MessageDelta { text, .. } if text == "pong"));
    }

    #[test]
    fn surfaces_permission_denial() {
        let mut adapter = AntigravityAdapter;
        let line = r#"{"event":"step_update","step_update":{"step_index":2,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"error":{"message":"permission check failed for command \"echo hi\""}}}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(events
            .iter()
            .any(|e| matches!(e, EngineEvent::Error { code, .. } if code == "PERMISSION_DENIED")));
    }
}
