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
    ActivityPhase, EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo, OptionVariant,
    PromptAnswer, PromptDetail, PromptKind, PromptOption, PromptSource, RateWindow, TransportKind,
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
        let output = crate::core::process::command(binary)
            .arg("--version")
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Un modèle par niveau d'effort (`--effort`) : plus l'effort est bas, moins la réflexion
    /// consomme de tokens.
    fn models(&self, _binary: Option<&Path>) -> Vec<ModelInfo> {
        const MODELS: &[(&str, &str)] = &[
            ("opus", "Opus (le plus capable)"),
            ("sonnet", "Sonnet (équilibré)"),
            ("haiku", "Haiku (rapide)"),
        ];
        const EFFORTS: &[(&str, &str)] = &[
            ("high", "effort élevé"),
            ("medium", "effort moyen"),
            ("low", "effort faible"),
        ];
        MODELS
            .iter()
            .flat_map(|(id, label)| {
                EFFORTS.iter().map(move |(effort, suffix)| ModelInfo {
                    id: format!("{id}:{effort}"),
                    label: format!("{} · {suffix}", label.split(" (").next().unwrap_or(label)),
                })
            })
            .collect()
    }

    fn default_model(&self) -> Option<String> {
        Some("sonnet:medium".to_string())
    }

    fn missing_hint(&self) -> &'static str {
        "Claude Code introuvable. Installez-le puis relancez ARCHIMED."
    }

    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String> {
        let LaunchOptions { model, resume, tuning, .. } = options;
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

        let (model, model_effort) = match model {
            Some(model) => {
                let (id, effort) = crate::engine::event::split_model(model);
                (Some(id), effort)
            }
            None => (None, None),
        };
        if let Some(model) = model {
            args.push("--model".to_string());
            args.push(model.to_string());
        }
        // Effort du modèle choisi, sinon celui des réglages d'économie de tokens.
        if let Some(effort) = model_effort.or(tuning.effort.as_deref()) {
            args.push("--effort".to_string());
            args.push(effort.to_string());
        }
        if tuning.disable_skills {
            args.push("--disable-slash-commands".to_string());
        }
        if tuning.cache_friendly {
            args.push("--exclude-dynamic-system-prompt-sections".to_string());
        }
        if let Some(window) = tuning.compact_at.as_deref() {
            args.push("--autocompact".to_string());
            args.push(window.to_string());
        }
        if let Some(resume) = resume {
            args.push("--resume".to_string());
            args.push(resume.to_string());
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
            Some("system") => decode_system(&value),
            Some("assistant") => decode_assistant(&value),
            Some("user") => decode_tool_results(&value),
            Some("control_request") => self.decode_control_request(&value, ctx),
            Some("result") => decode_result(&value),
            Some("rate_limit_event") => decode_rate_limit(&value),
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

/// `system/init` porte le `session_id` réutilisable avec `--resume`.
fn decode_system(value: &Value) -> Vec<EngineEvent> {
    match value.get("subtype").and_then(Value::as_str) {
        // `init` porte le `session_id` réutilisable avec `--resume`.
        Some("init") => value
            .get("session_id")
            .and_then(Value::as_str)
            .map(|id| {
                vec![EngineEvent::CliSession {
                    cli_session_id: id.to_string(),
                }]
            })
            .unwrap_or_default(),
        // Émis pendant la réflexion du modèle (contenu non exposé).
        Some("thinking_tokens") => vec![EngineEvent::Activity {
            phase: ActivityPhase::Thinking,
            label: None,
        }],
        _ => Vec::new(),
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
            Some("thinking") | Some("redacted_thinking") => events.push(EngineEvent::Activity {
                phase: ActivityPhase::Thinking,
                label: None,
            }),
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        events.push(EngineEvent::Activity {
                            phase: ActivityPhase::Responding,
                            label: None,
                        });
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
                let name = block.get("name").and_then(Value::as_str).unwrap_or("outil");
                let summary = payload_of(block.get("input").unwrap_or(&Value::Null));
                events.push(EngineEvent::Activity {
                    phase: ActivityPhase::Tool,
                    label: Some(if summary.is_empty() || summary == "null" {
                        name.to_string()
                    } else {
                        format!("{name} · {}", summary.chars().take(120).collect::<String>())
                    }),
                });
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
    let usage = value.get("usage").unwrap_or(&Value::Null);
    let count = |key: &str| usage.get(key).and_then(Value::as_u64).unwrap_or(0);
    let is_error = value.get("is_error").and_then(Value::as_bool) == Some(true);

    let mut events = vec![EngineEvent::TurnCompleted {
        duration_ms: value.get("duration_ms").and_then(Value::as_u64),
        input_tokens: count("input_tokens"),
        output_tokens: count("output_tokens"),
        thinking_tokens: usage
            .get("output_tokens_details")
            .and_then(|details| details.get("thinking_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cache_tokens: count("cache_creation_input_tokens") + count("cache_read_input_tokens"),
        cost_usd: value.get("total_cost_usd").and_then(Value::as_f64),
        ok: !is_error,
    }];

    if is_error {
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

/// `rate_limit_event` : utilisation des fenêtres d'abonnement (Claude Pro/Max).
fn decode_rate_limit(value: &Value) -> Vec<EngineEvent> {
    let info = value.get("rate_limit_info").unwrap_or(&Value::Null);
    let Some(windows) = info.get("unifiedWindows").and_then(Value::as_object) else {
        return Vec::new();
    };
    let windows = windows
        .iter()
        .filter_map(|(id, window)| {
            Some(RateWindow {
                id: id.clone(),
                utilization: window.get("utilization").and_then(Value::as_f64)?,
                resets_at: window.get("resetsAt").and_then(Value::as_i64),
            })
        })
        .collect::<Vec<_>>();
    if windows.is_empty() {
        return Vec::new();
    }
    vec![EngineEvent::RateLimit {
        status: info
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        windows,
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
    fn model_list_exposes_each_effort_level() {
        let models = ClaudeAdapter::default().models(None);
        let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
        // Uniquement les variantes par effort : pas d'entrée « modèle seul ».
        assert!(ids.contains(&"sonnet:high") && ids.contains(&"sonnet:medium") && ids.contains(&"sonnet:low"));
        assert!(!ids.contains(&"sonnet"));
        assert_eq!(models.iter().filter(|m| m.id.starts_with("opus")).count(), 3);
        assert_eq!(ClaudeAdapter::default().default_model().as_deref(), Some("sonnet:medium"));
    }

    #[test]
    fn effort_and_token_saving_flags_reach_the_cli() {
        let tuning = crate::engine::event::EngineTuning {
            effort: Some("low".into()),
            disable_skills: true,
            cache_friendly: true,
            compact_at: Some("100k".into()),
        };
        let args = ClaudeAdapter::default().spawn_args(LaunchOptions {
            model: Some("opus:high"),
            resume: None,
            auto_mode: AutoMode::Off,
            cwd: None,
            tuning: &tuning,
        });
        // Le niveau choisi dans la liste des modèles prime sur le réglage global.
        assert!(args.windows(2).any(|w| w[0] == "--model" && w[1] == "opus"));
        assert!(args.windows(2).any(|w| w[0] == "--effort" && w[1] == "high"));
        assert!(args.contains(&"--disable-slash-commands".to_string()));
        assert!(args.contains(&"--exclude-dynamic-system-prompt-sections".to_string()));
        assert!(args.windows(2).any(|w| w[0] == "--autocompact" && w[1] == "100k"));

        let global = ClaudeAdapter::default().spawn_args(LaunchOptions {
            model: Some("sonnet"),
            resume: None,
            auto_mode: AutoMode::Off,
            cwd: None,
            tuning: &tuning,
        });
        assert!(global.windows(2).any(|w| w[0] == "--effort" && w[1] == "low"));
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
    fn exposes_cli_session_id_and_resumes() {
        let mut adapter = ClaudeAdapter::default();
        let events = adapter.decode_line(
            r#"{"type":"system","subtype":"init","session_id":"52dd-abc"}"#,
            &ctx(),
        );
        assert!(matches!(&events[0], EngineEvent::CliSession { cli_session_id } if cli_session_id == "52dd-abc"));

        let args = adapter.spawn_args(LaunchOptions::new(Some("haiku"), Some("52dd-abc")));
        let resume = args.iter().position(|a| a == "--resume").unwrap();
        assert_eq!(args[resume + 1], "52dd-abc");
        assert!(!adapter
            .spawn_args(LaunchOptions::new(None, None))
            .contains(&"--resume".to_string()));
    }

    #[test]
    fn decodes_recorded_turn_and_rate_limits() {
        // Extraits réels (claude 2.1.271, 2026-09-16).
        let mut adapter = ClaudeAdapter::default();
        let lines = [
            r#"{"type":"system","subtype":"thinking_tokens","estimated_tokens":50,"estimated_tokens_delta":50}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"tool_use","id":"t1","name":"Write","input":{"file_path":"C:/spike/hello.txt","content":"hi."}}]}}"#,
            r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":1789579800,"unifiedWindows":{"five_hour":{"utilization":0.31,"resetsAt":1789579800},"seven_day":{"utilization":0.16,"resetsAt":1790139600}}}}"#,
            r#"{"type":"result","duration_ms":5367,"is_error":false,"total_cost_usd":0.0749616,"usage":{"input_tokens":18,"cache_creation_input_tokens":34745,"cache_read_input_tokens":34236,"output_tokens":406,"output_tokens_details":{"thinking_tokens":258}}}"#,
        ];
        let events: Vec<EngineEvent> = lines.iter().flat_map(|l| adapter.decode_line(l, &ctx())).collect();

        assert!(matches!(&events[0], EngineEvent::Activity { phase: ActivityPhase::Thinking, .. }));
        assert!(events.iter().any(|e| matches!(e, EngineEvent::Activity { phase: ActivityPhase::Tool, label: Some(l) } if l.starts_with("Write · "))));
        let windows = events.iter().find_map(|e| match e {
            EngineEvent::RateLimit { windows, .. } => Some(windows.clone()),
            _ => None,
        }).unwrap();
        assert_eq!(windows.len(), 2);
        assert!(windows.iter().any(|w| w.id == "five_hour" && (w.utilization - 0.31).abs() < 1e-9));
        let turn = events.iter().find_map(|e| match e {
            EngineEvent::TurnCompleted { duration_ms, input_tokens, output_tokens, thinking_tokens, cache_tokens, cost_usd, ok } => {
                Some((*duration_ms, *input_tokens, *output_tokens, *thinking_tokens, *cache_tokens, *cost_usd, *ok))
            }
            _ => None,
        }).unwrap();
        assert_eq!(turn, (Some(5367), 18, 406, 258, 68981, Some(0.0749616), true));
    }

    #[test]
    fn decodes_assistant_text() {
        let mut adapter = ClaudeAdapter::default();
        let line = r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"bonjour"}]}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(matches!(events[0], EngineEvent::Activity { phase: ActivityPhase::Responding, .. }));
        assert!(matches!(events[1], EngineEvent::MessageDelta { .. }));
        assert!(matches!(events[2], EngineEvent::MessageCompleted { .. }));
    }
}
