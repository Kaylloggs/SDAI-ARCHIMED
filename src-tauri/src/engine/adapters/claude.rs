//! Adaptateur Claude Code CLI.
//! Testé avec claude 2.1.271 (2026-09-16).
//!
//! Transport : `--input-format stream-json --output-format stream-json`.
//! Permissions : `--permission-prompt-tool stdio` → la CLI envoie un
//! `control_request { subtype: "can_use_tool" }` sur stdout et attend un
//! `control_response` sur stdin (protocole vérifié, architecture.md §7.2).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::engine::event::{
    EngineEvent, InteractivePrompt, ModelInfo, OptionVariant, PromptAnswer, PromptDetail,
    PromptKind, PromptOption, PromptSource, TransportKind,
};
use crate::engine::policy;

use super::{payload_of, AnswerAction, CliAdapter, DecodeCtx};

#[derive(Default)]
pub struct ClaudeAdapter {
    /// prompt_id → request_id du control_request en attente.
    pending: HashMap<String, String>,
}

impl CliAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn name(&self) -> &'static str {
        "Claude Code"
    }

    fn accent(&self) -> &'static str {
        "claude"
    }

    fn transport(&self) -> TransportKind {
        TransportKind::Structured
    }

    fn binary_names(&self) -> &'static [&'static str] {
        &["claude"]
    }

    /// Claude Desktop embarque la CLI hors PATH : on prend la version la plus récente.
    fn extra_locations(&self) -> Vec<PathBuf> {
        let Some(appdata) = std::env::var_os("APPDATA").map(PathBuf::from) else {
            return Vec::new();
        };
        let root = appdata.join("Claude").join("claude-code");
        let Ok(entries) = std::fs::read_dir(&root) else {
            return Vec::new();
        };
        let mut versions: Vec<PathBuf> = entries
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.path())
            .filter(|path| path.join("claude.exe").exists())
            .collect();
        versions.sort();
        versions
            .into_iter()
            .rev()
            .map(|path| path.join("claude.exe"))
            .collect()
    }

    fn version(&self, binary: &Path) -> Option<String> {
        let output = std::process::Command::new(binary)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn models(&self, _binary: Option<&Path>) -> Vec<ModelInfo> {
        [
            ("opus", "Opus (le plus capable)"),
            ("sonnet", "Sonnet (équilibré)"),
            ("haiku", "Haiku (rapide)"),
        ]
        .iter()
        .map(|(id, label)| ModelInfo {
            id: (*id).to_string(),
            label: (*label).to_string(),
        })
        .collect()
    }

    fn default_model(&self) -> Option<String> {
        Some("sonnet".to_string())
    }

    fn missing_hint(&self) -> &'static str {
        "Claude Code introuvable. Installez-le puis relancez ARCHIMED."
    }

    fn spawn_args(&self, model: Option<&str>) -> Vec<String> {
        let mut args: Vec<String> = [
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--verbose",
            "--permission-prompt-tool",
            "stdio",
            "--permission-mode",
            "default",
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
        json!({
            "type": "user",
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    fn decode_line(&mut self, line: &str, ctx: &DecodeCtx) -> Vec<EngineEvent> {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };

        match value.get("type").and_then(Value::as_str) {
            Some("assistant") => decode_assistant(&value),
            Some("user") => decode_tool_results(&value),
            Some("control_request") => self.decode_control_request(&value, ctx),
            Some("result") => decode_result(&value),
            _ => Vec::new(),
        }
    }

    fn encode_answer(
        &mut self,
        prompt: &InteractivePrompt,
        answer: &PromptAnswer,
        allowed: bool,
    ) -> AnswerAction {
        let Some(request_id) = self.pending.remove(&prompt.prompt_id) else {
            return AnswerAction::None;
        };

        let response = if allowed {
            let updated_input = answer
                .edited_input
                .clone()
                .or_else(|| match &prompt.detail {
                    Some(PromptDetail::Json { value }) => Some(value.clone()),
                    _ => None,
                })
                .unwrap_or(Value::Null);
            json!({ "behavior": "allow", "updatedInput": updated_input })
        } else {
            json!({
                "behavior": "deny",
                "message": answer.text.clone().unwrap_or_else(|| "Refusé par l'utilisateur".to_string())
            })
        };

        AnswerAction::Stdin(
            json!({
                "type": "control_response",
                "response": { "subtype": "success", "request_id": request_id, "response": response }
            })
            .to_string(),
        )
    }
}

impl ClaudeAdapter {
    fn decode_control_request(&mut self, value: &Value, ctx: &DecodeCtx) -> Vec<EngineEvent> {
        let request = value.get("request");
        let subtype = request
            .and_then(|r| r.get("subtype"))
            .and_then(Value::as_str);
        if subtype != Some("can_use_tool") {
            return Vec::new();
        }

        let Some(request_id) = value.get("request_id").and_then(Value::as_str) else {
            return Vec::new();
        };
        let request = request.unwrap_or(&Value::Null);
        let tool = request
            .get("tool_name")
            .and_then(Value::as_str)
            .unwrap_or("outil")
            .to_string();
        let input = request.get("input").cloned().unwrap_or(Value::Null);
        let description = request
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();

        let payload = payload_of(&input);
        let decision = policy::evaluate(&tool, &payload, ctx.auto_mode);

        let prompt_id = uuid::Uuid::new_v4().to_string();
        self.pending.insert(prompt_id.clone(), request_id.to_string());

        let detail = detail_for(&tool, &input);
        let title = if description.is_empty() {
            format!("{tool} — autoriser ?")
        } else {
            format!("{tool} · {description}")
        };

        let prompt = InteractivePrompt {
            prompt_id,
            session_id: ctx.session_id.to_string(),
            kind: PromptKind::Permission,
            tool: Some(tool),
            title,
            detail: Some(detail),
            options: vec![
                PromptOption::new("deny", "Refuser", OptionVariant::Default),
                PromptOption::new(
                    "allow",
                    "Autoriser",
                    if decision.risk >= crate::engine::event::RiskLevel::High {
                        OptionVariant::Danger
                    } else {
                        OptionVariant::Primary
                    },
                ),
            ],
            default_option: Some("allow".to_string()),
            allow_free_text: false,
            risk: decision.risk,
            source: PromptSource::Protocol,
            raw_excerpt: None,
        };

        vec![EngineEvent::Prompt { prompt }]
    }
}

fn detail_for(tool: &str, input: &Value) -> PromptDetail {
    match tool {
        "Write" | "Edit" | "MultiEdit" => PromptDetail::Diff {
            path: input
                .get("file_path")
                .and_then(Value::as_str)
                .unwrap_or("(fichier)")
                .to_string(),
            before: input
                .get("old_string")
                .and_then(Value::as_str)
                .map(str::to_string),
            after: input
                .get("content")
                .or_else(|| input.get("new_string"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        },
        "Bash" | "PowerShell" => PromptDetail::Command {
            line: input
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            cwd: input
                .get("cwd")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        _ => PromptDetail::Json {
            value: input.clone(),
        },
    }
}

fn decode_assistant(value: &Value) -> Vec<EngineEvent> {
    let message = value.get("message").unwrap_or(&Value::Null);
    let message_id = message
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("msg")
        .to_string();
    let Some(content) = message.get("content").and_then(Value::as_array) else {
        return Vec::new();
    };

    let mut events = Vec::new();
    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        events.push(EngineEvent::MessageDelta {
                            message_id: message_id.clone(),
                            text: text.to_string(),
                        });
                        events.push(EngineEvent::MessageCompleted {
                            message_id: message_id.clone(),
                        });
                    }
                }
            }
            Some("tool_use") => {
                events.push(EngineEvent::ToolCall {
                    call_id: block
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("tool")
                        .to_string(),
                    tool: block
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("outil")
                        .to_string(),
                    input: block.get("input").cloned().unwrap_or(Value::Null),
                });
            }
            _ => {}
        }
    }
    events
}

fn decode_tool_results(value: &Value) -> Vec<EngineEvent> {
    let Some(content) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };

    content
        .iter()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
        .map(|block| EngineEvent::ToolResult {
            call_id: block
                .get("tool_use_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            ok: !block
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            output: match block.get("content") {
                Some(Value::String(text)) => text.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            },
        })
        .collect()
}

fn decode_result(value: &Value) -> Vec<EngineEvent> {
    let usage = value.get("usage");
    let mut events = Vec::new();

    if let Some(usage) = usage {
        events.push(EngineEvent::Usage {
            input_tokens: usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens: usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cost_usd: value.get("total_cost_usd").and_then(Value::as_f64),
        });
    }

    if value.get("is_error").and_then(Value::as_bool) == Some(true) {
        events.push(EngineEvent::Error {
            code: "CLI_ERROR".to_string(),
            message: value
                .get("result")
                .and_then(Value::as_str)
                .unwrap_or("Erreur de la CLI")
                .to_string(),
            recoverable: true,
        });
    }

    events
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
    fn decodes_permission_request_into_prompt() {
        let mut adapter = ClaudeAdapter::default();
        let line = r#"{"type":"control_request","request_id":"req-1","request":{"subtype":"can_use_tool","tool_name":"Write","input":{"file_path":"a.txt","content":"hi"},"description":"a.txt"}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert_eq!(events.len(), 1);
        let EngineEvent::Prompt { prompt } = &events[0] else {
            panic!("prompt attendu");
        };
        assert_eq!(prompt.tool.as_deref(), Some("Write"));
        assert!(matches!(prompt.detail, Some(PromptDetail::Diff { .. })));
        assert!(adapter.pending.contains_key(&prompt.prompt_id));
    }

    #[test]
    fn encodes_allow_control_response() {
        let mut adapter = ClaudeAdapter::default();
        let line = r#"{"type":"control_request","request_id":"req-2","request":{"subtype":"can_use_tool","tool_name":"Read","input":{"file_path":"a.txt"}}}"#;
        let events = adapter.decode_line(line, &ctx());
        let EngineEvent::Prompt { prompt } = &events[0] else {
            panic!("prompt attendu");
        };
        let answer = PromptAnswer {
            option_id: Some("allow".into()),
            text: None,
            edited_input: None,
        };
        let AnswerAction::Stdin(payload) = adapter.encode_answer(prompt, &answer, true) else {
            panic!("stdin attendu");
        };
        assert!(payload.contains("\"request_id\":\"req-2\""));
        assert!(payload.contains("\"behavior\":\"allow\""));
    }

    #[test]
    fn decodes_assistant_text() {
        let mut adapter = ClaudeAdapter::default();
        let line = r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"bonjour"}]}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(matches!(events[0], EngineEvent::MessageDelta { .. }));
        assert!(matches!(events[1], EngineEvent::MessageCompleted { .. }));
    }
}
