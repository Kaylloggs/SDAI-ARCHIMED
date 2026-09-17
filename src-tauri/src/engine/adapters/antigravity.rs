//! Adaptateur Antigravity CLI (`agy`).
//! Testé avec agy 1.2.3 (2026-09-16) — flux enregistrés dans les tests ci-dessous.
//!
//! Lancement : `agy [--model M] [--conversation ID] [--mode accept-edits] \
//!   --input-format stream-json --output-format stream-json -p=`
//! - `-p` **attend une valeur** : sans `=`, il avale l'option suivante comme prompt.
//!   `-p=` (vide, en dernier) active le mode impression ; les messages arrivent sur stdin.
//! - Un processus traite un tour par message NDJSON et reste ouvert (multi-tours vérifié).
//!
//! Entrée (vérifiée) : `{"event":"user","message":{"role":"user","content":[{"type":"text","text":"…"}]}}`
//! Sortie : `{"event":"init"|"step_update"|"result", …}`.
//!
//! Limite connue : en headless, `agy` refuse toute action soumise à permission
//! (`permission check failed`). Mode Auto intelligent/complet → `--mode accept-edits`
//! autorise les modifications de fichiers ; les commandes restent refusées et le refus
//! est expliqué dans une carte.

use std::path::Path;

use serde_json::{json, Value};

use crate::engine::event::{
    ActivityPhase, AutoMode, EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo,
    PromptAnswer, TransportKind,
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
        let output = crate::core::process::command(binary)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn models(&self, binary: Option<&Path>) -> Vec<ModelInfo> {
        let Some(binary) = binary else {
            return Vec::new();
        };
        let Ok(output) = crate::core::process::command(binary).arg("models").output() else {
            return Vec::new();
        };
        parse_models(&String::from_utf8_lossy(&output.stdout))
    }

    fn default_model(&self) -> Option<String> {
        None
    }

    fn missing_hint(&self) -> &'static str {
        "Antigravity CLI (agy) introuvable dans le PATH."
    }

    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(model) = options.model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }
        if let Some(resume) = options.resume {
            args.push("--conversation".to_string());
            args.push(resume.to_string());
        }
        if options.auto_mode != AutoMode::Off {
            args.push("--mode".to_string());
            args.push("accept-edits".to_string());
        }
        args.extend(
            ["--input-format", "stream-json", "--output-format", "stream-json", "-p="]
                .iter()
                .map(|s| s.to_string()),
        );
        args
    }

    fn encode_user_message(&self, text: &str) -> String {
        json!({
            "event": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    fn decode_line(&mut self, line: &str, _ctx: &DecodeCtx) -> Vec<EngineEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };

        match value.get("event").and_then(Value::as_str) {
            Some("init") => value
                .get("conversation_id")
                .and_then(Value::as_str)
                .map(|id| {
                    vec![EngineEvent::CliSession {
                        cli_session_id: id.to_string(),
                    }]
                })
                .unwrap_or_default(),
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

/// `agy models` : une ligne « id<TAB>libellé » par modèle, précédée d'un message d'attente.
fn parse_models(output: &str) -> Vec<ModelInfo> {
    output
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

fn tool_label(tool: &str, info: &Value) -> String {
    let parameters = info.get("parameters").unwrap_or(&Value::Null);
    for key in ["CommandLine", "TargetFile", "AbsolutePath", "SearchPath", "Url", "Query"] {
        if let Some(value) = parameters.get(key).and_then(Value::as_str) {
            return format!("{tool} · {value}");
        }
    }
    tool.to_string()
}

fn decode_step(step: &Value) -> Vec<EngineEvent> {
    let state = step.get("state").and_then(Value::as_str).unwrap_or("");
    let step_type = step.get("step_type").and_then(Value::as_str).unwrap_or("");
    let index = step.get("step_index").and_then(Value::as_u64).unwrap_or(0);
    let message_id = format!("step-{index}");
    let mut events = Vec::new();

    match step_type {
        "user_input" if state == "DONE" => events.push(EngineEvent::Activity {
            phase: ActivityPhase::Thinking,
            label: None,
        }),
        "agent_response" => {
            let delta = step.get("text_delta").and_then(Value::as_str).unwrap_or("");
            if !delta.is_empty() {
                events.push(EngineEvent::Activity {
                    phase: ActivityPhase::Responding,
                    label: None,
                });
                events.push(EngineEvent::MessageDelta {
                    message_id: message_id.clone(),
                    text: delta.to_string(),
                });
            } else if state == "ACTIVE" {
                events.push(EngineEvent::Activity {
                    phase: ActivityPhase::Thinking,
                    label: None,
                });
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
                "ACTIVE" => {
                    events.push(EngineEvent::Activity {
                        phase: ActivityPhase::Tool,
                        label: Some(tool_label(&tool, info)),
                    });
                    events.push(EngineEvent::ToolCall {
                        call_id,
                        tool,
                        input: info.get("parameters").cloned().unwrap_or(Value::Null),
                    });
                }
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
                                "Antigravity a refusé cette action : en arrière-plan il ne peut pas demander de permission. \
                                 Les modifications de fichiers sont autorisées en Mode Auto ; pour les commandes, \
                                 utilisez Claude ou autorisez-les dans les réglages d'agy (permissions.allow). ({message})"
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

    events
}

fn decode_result(result: &Value) -> Vec<EngineEvent> {
    let usage = result.get("usage").unwrap_or(&Value::Null);
    let count = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    let ok = result.get("status").and_then(Value::as_str) == Some("SUCCESS");

    let mut events = vec![EngineEvent::TurnCompleted {
        duration_ms: result
            .get("duration_seconds")
            .and_then(Value::as_f64)
            .map(|seconds| (seconds * 1000.0).round() as u64),
        input_tokens: count("input_tokens"),
        output_tokens: count("output_tokens"),
        thinking_tokens: count("thinking_tokens"),
        cache_tokens: count("cache_read_tokens"),
        cost_usd: None,
        ok,
    }];

    if !ok {
        let message = result
            .get("error")
            .or_else(|| result.get("response"))
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .unwrap_or("La CLI a terminé en erreur");
        events.push(EngineEvent::Error {
            code: "CLI_ERROR".to_string(),
            message: message.to_string(),
            recoverable: true,
        });
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> DecodeCtx<'static> {
        DecodeCtx {
            session_id: "s1",
            auto_mode: AutoMode::Off,
        }
    }

    /// Flux réel d'agy 1.2.3 (« Reply with exactly: pong »), abrégé.
    const RECORDED: &str = r#"{"event":"init","conversation_id":"8fb6af42-0b95-4422-b19e-ed2f8954ad0d","init":{"cwd":"C:\\tmp"}}
{"event":"step_update","step_update":{"conversation_id":"8fb6af42","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"8fb6af42","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"pong"}}
{"event":"step_update","step_update":{"conversation_id":"8fb6af42","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":13.97,"usage":{"input_tokens":13055,"output_tokens":59,"thinking_tokens":58,"cache_read_tokens":0,"total_tokens":13114}}}
{"event":"result","result":{"conversation_id":"8fb6af42","status":"SUCCESS","response":"pong\n","duration_seconds":14.0799,"num_turns":1,"usage":{"input_tokens":13055,"output_tokens":59,"thinking_tokens":58,"cache_read_tokens":0,"total_tokens":13114}}}"#;

    #[test]
    fn prompt_flag_takes_empty_value_after_other_options() {
        let args = AntigravityAdapter.spawn_args(LaunchOptions {
            model: Some("gemini-3.8-flash-low"),
            resume: Some("abc"),
            auto_mode: AutoMode::Smart,
        });
        assert_eq!(args.last().map(String::as_str), Some("-p="));
        assert!(args.windows(2).any(|w| w[0] == "--conversation" && w[1] == "abc"));
        assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "accept-edits"));
        assert!(!AntigravityAdapter
            .spawn_args(LaunchOptions::new(None, None))
            .contains(&"--mode".to_string()));
    }

    #[test]
    fn encodes_the_verified_input_format() {
        let line = AntigravityAdapter.encode_user_message("bonjour");
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["event"], "user");
        assert_eq!(value["message"]["content"][0]["text"], "bonjour");
    }

    #[test]
    fn decodes_recorded_session() {
        let mut adapter = AntigravityAdapter;
        let events: Vec<EngineEvent> = RECORDED
            .lines()
            .flat_map(|line| adapter.decode_line(line, &ctx()))
            .collect();

        assert!(matches!(&events[0], EngineEvent::CliSession { cli_session_id } if cli_session_id.starts_with("8fb6af42")));
        let text: String = events
            .iter()
            .filter_map(|e| match e {
                EngineEvent::MessageDelta { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect();
        assert_eq!(text, "pong\n");
        assert!(events.iter().any(|e| matches!(e, EngineEvent::MessageCompleted { .. })));
        let turn = events
            .iter()
            .find_map(|e| match e {
                EngineEvent::TurnCompleted { duration_ms, input_tokens, output_tokens, thinking_tokens, ok, .. } => {
                    Some((*duration_ms, *input_tokens, *output_tokens, *thinking_tokens, *ok))
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(turn, (Some(14080), 13055, 59, 58, true));
        // Une seule fin de tour : pas de double comptage de l'usage des étapes.
        assert_eq!(events.iter().filter(|e| matches!(e, EngineEvent::TurnCompleted { .. })).count(), 1);
    }

    #[test]
    fn reports_stream_errors() {
        let mut adapter = AntigravityAdapter;
        let line = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"stream input message is missing the \"event\" field","duration_seconds":0,"usage":{}}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(events.iter().any(|e| matches!(e, EngineEvent::Error { message, .. } if message.contains("missing the"))));
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

    #[test]
    fn parses_models_listing() {
        let models = parse_models("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gemini-3.8-flash-high");
    }
}
