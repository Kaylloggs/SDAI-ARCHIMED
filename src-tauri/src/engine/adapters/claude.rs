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
    effort_label, ActivityPhase, EffortOption, EngineEvent, InteractivePrompt, LaunchOptions,
    ModelInfo, OptionVariant, PromptAnswer, PromptDetail, PromptKind, PromptOption, PromptSource,
    RateWindow, TransportKind,
};
use crate::engine::policy;

use super::{payload_of, AnswerAction, CliAdapter, DecodeCtx};

/// Modèles proposés, sous leur nom réel : (identifiant `--model`, nom, effort réglable).
/// Haiku 4.5 n'accepte pas l'option d'effort.
const MODELS: &[(&str, &str, bool)] = &[
    ("claude-fable-5-1", "Fable 5.1", true),
    ("claude-opus-5-5", "Opus 5.5", true),
    ("claude-opus-5", "Opus 5", true),
    ("claude-sonnet-5", "Sonnet 5", true),
    ("claude-haiku-4-5", "Haiku 4.5", false),
];
/// Niveaux d'effort de Claude Code (`--effort`), du plus faible au plus fort.
const EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// Demande de permission en attente : on garde l'entrée de l'outil, que Claude attend en
/// retour (`updatedInput`) quand on autorise.
struct Pending {
    request_id: String,
    input: Value,
}

#[derive(Default)]
pub struct ClaudeAdapter {
    /// prompt_id → control_request en attente.
    pending: HashMap<String, Pending>,
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

    /// Un modèle par nom réel, avec son échelle d'effort (`--effort`) : plus l'effort est bas,
    /// moins la réflexion consomme de tokens. « Auto » laisse le réglage d'économie de tokens.
    fn models(&self, _binary: Option<&Path>) -> Vec<ModelInfo> {
        MODELS
            .iter()
            .map(|(id, label, with_effort)| ModelInfo {
                id: (*id).to_string(),
                label: (*label).to_string(),
                efforts: if *with_effort {
                    std::iter::once("auto")
                        .chain(EFFORTS.iter().copied())
                        .map(|level| EffortOption {
                            id: if level == "auto" {
                                (*id).to_string()
                            } else {
                                format!("{id}:{level}")
                            },
                            level: level.to_string(),
                            label: effort_label(level),
                        })
                        .collect()
                } else {
                    Vec::new()
                },
            })
            .collect()
    }

    fn default_model(&self) -> Option<String> {
        Some("claude-sonnet-5".to_string())
    }

    fn missing_hint(&self) -> &'static str {
        "Claude Code introuvable. Installez-le puis relancez ARCHIMED."
    }

    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String> {
        let LaunchOptions { model, resume, tuning, mcp_config, session, .. } = options;
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
        // Effort du modèle choisi, sinon celui des réglages d'économie de tokens ; jamais pour
        // Haiku, qui refuse l'option.
        let haiku = model.is_some_and(|m| m.contains("haiku"));
        if let Some(effort) = model_effort.or(tuning.effort.as_deref()).filter(|_| !haiku) {
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
        // Outils exposés par les modules d'ARCHIMED (recherche d'offres, etc.).
        if let Some(config) = mcp_config {
            args.push("--mcp-config".to_string());
            args.push(config.to_string());
        }
        // Consignes du module qui a ouvert la session (Mod Studio…).
        if let Some(prompt) = session
            .append_system_prompt
            .as_deref()
            .filter(|p| !p.trim().is_empty())
        {
            args.push("--append-system-prompt".to_string());
            args.push(prompt.to_string());
        }
        if !session.disallowed_tools.is_empty() {
            args.push("--disallowedTools".to_string());
            args.push(session.disallowed_tools.join(","));
        }
        args
    }

    fn supports_system_prompt(&self) -> bool {
        true
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
        let Some(Pending { request_id, input }) = self.pending.remove(&prompt.prompt_id) else {
            return AnswerAction::None;
        };

        let response = if allowed {
            // Claude refuse `updatedInput: null` (« invalid permission result ») : on renvoie
            // l'entrée modifiée dans la carte s'il y en a une, sinon l'entrée d'origine. Le
            // champ est omis seulement si aucune des deux n'est un objet.
            let updated_input = answer
                .edited_input
                .clone()
                .filter(Value::is_object)
                .or_else(|| Some(input).filter(Value::is_object));
            match updated_input {
                Some(updated) => json!({ "behavior": "allow", "updatedInput": updated }),
                None => json!({ "behavior": "allow" }),
            }
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
        let target = input
            .get("file_path")
            .or_else(|| input.get("path"))
            .or_else(|| input.get("notebook_path"))
            .and_then(Value::as_str);
        let decision = policy::evaluate_in(&tool, &payload, target, ctx.cwd, ctx.auto_mode);

        let prompt_id = uuid::Uuid::new_v4().to_string();
        self.pending.insert(
            prompt_id.clone(),
            Pending { request_id: request_id.to_string(), input: input.clone() },
        );

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
            cwd: None,
        }
    }

    #[test]
    fn models_have_real_names_and_an_effort_scale() {
        let models = ClaudeAdapter::default().models(None);
        let labels: Vec<&str> = models.iter().map(|m| m.label.as_str()).collect();
        assert_eq!(labels, ["Fable 5.1", "Opus 5.5", "Opus 5", "Sonnet 5", "Haiku 4.5"]);
        let opus = &models[1];
        assert_eq!(opus.id, "claude-opus-5-5");
        let levels: Vec<&str> = opus.efforts.iter().map(|e| e.level.as_str()).collect();
        assert_eq!(levels, ["auto", "low", "medium", "high", "xhigh", "max"]);
        assert_eq!(opus.efforts[0].id, "claude-opus-5-5");
        assert_eq!(opus.efforts[3].id, "claude-opus-5-5:high");
        assert!(models[4].efforts.is_empty(), "Haiku : pas d'effort");
        assert_eq!(ClaudeAdapter::default().default_model().as_deref(), Some("claude-sonnet-5"));

        // Le niveau choisi part en `--effort`, jamais pour Haiku.
        let args = ClaudeAdapter::default().spawn_args(LaunchOptions::new(Some("claude-opus-5-5:xhigh"), None));
        assert!(args.windows(2).any(|w| w[0] == "--model" && w[1] == "claude-opus-5-5"));
        assert!(args.windows(2).any(|w| w[0] == "--effort" && w[1] == "xhigh"));
        let tuning = crate::engine::event::EngineTuning { effort: Some("high".into()), ..Default::default() };
        let haiku = ClaudeAdapter::default().spawn_args(LaunchOptions {
            tuning: &tuning,
            ..LaunchOptions::new(Some("claude-haiku-4-5"), None)
        });
        assert!(!haiku.contains(&"--effort".to_string()));
    }

    #[test]
    fn mcp_servers_of_modules_are_passed_to_the_cli() {
        let args = ClaudeAdapter::default().spawn_args(LaunchOptions {
            model: None,
            resume: None,
            auto_mode: AutoMode::Off,
            cwd: None,
            tuning: &crate::engine::event::DEFAULT_TUNING,
            mcp_config: Some("C:/donnees/mcp/_merged.generated.json"),
            session: &crate::engine::event::DEFAULT_SESSION_OPTIONS,
        });
        let position = args.iter().position(|arg| arg == "--mcp-config").expect("option absente");
        assert_eq!(args[position + 1], "C:/donnees/mcp/_merged.generated.json");
    }

    #[test]
    fn module_instructions_reach_the_cli() {
        let session = crate::engine::event::SessionOptions {
            append_system_prompt: Some("Projet Fabric 1.21.1".into()),
            disallowed_tools: vec!["WebFetch".into(), "WebSearch".into()],
        };
        let args = ClaudeAdapter::default().spawn_args(LaunchOptions {
            session: &session,
            ..LaunchOptions::new(None, None)
        });
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--append-system-prompt" && w[1] == "Projet Fabric 1.21.1"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--disallowedTools" && w[1] == "WebFetch,WebSearch"));
        let plain = ClaudeAdapter::default().spawn_args(LaunchOptions::new(None, None));
        assert!(!plain.iter().any(|a| a == "--append-system-prompt" || a == "--disallowedTools"));
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
            mcp_config: None,
            session: &crate::engine::event::DEFAULT_SESSION_OPTIONS,
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
            mcp_config: None,
            session: &crate::engine::event::DEFAULT_SESSION_OPTIONS,
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

    /// Réponse réelle attendue par Claude Code : `updatedInput` est un objet, jamais `null`,
    /// pour tous les outils (écriture, modification, commande…).
    #[test]
    fn allowing_any_tool_sends_back_its_input() {
        for (tool, input) in [
            ("Write", json!({"file_path": "a.txt", "content": "hi"})),
            (
                "Edit",
                json!({"file_path": "a.txt", "old_string": "a", "new_string": "b"}),
            ),
            ("Bash", json!({"command": "gradlew build"})),
            ("Read", json!({"file_path": "a.txt"})),
        ] {
            let mut adapter = ClaudeAdapter::default();
            let line = json!({
                "type": "control_request",
                "request_id": "req-9",
                "request": { "subtype": "can_use_tool", "tool_name": tool, "input": input }
            })
            .to_string();
            let events = adapter.decode_line(&line, &ctx());
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
            let sent: Value = serde_json::from_str(&payload).unwrap();
            let response = &sent["response"]["response"];
            assert_eq!(response["behavior"], "allow", "{tool}");
            assert_eq!(response["updatedInput"], input, "{tool}");
        }
    }

    #[test]
    fn an_edited_input_replaces_the_original() {
        let mut adapter = ClaudeAdapter::default();
        let line = r#"{"type":"control_request","request_id":"r","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"rm -rf build"}}}"#;
        let events = adapter.decode_line(line, &ctx());
        let EngineEvent::Prompt { prompt } = &events[0] else {
            panic!("prompt attendu");
        };
        let answer = PromptAnswer {
            option_id: Some("allow".into()),
            text: None,
            edited_input: Some(json!({"command": "gradlew clean"})),
        };
        let AnswerAction::Stdin(payload) = adapter.encode_answer(prompt, &answer, true) else {
            panic!("stdin attendu");
        };
        assert!(payload.contains("gradlew clean"));
        assert!(!payload.contains("rm -rf"));
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
