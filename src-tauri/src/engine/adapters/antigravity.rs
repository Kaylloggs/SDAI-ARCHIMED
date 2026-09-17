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
//! Permissions : en headless, `agy` refuse toute action soumise à permission
//! (`permission check failed for command "…"`) sans rien demander. Le refus devient une
//! carte Autoriser/Refuser. Autoriser écrit la règle exacte (`command(…)`, `read_file(…)`)
//! dans `~/.gemini/antigravity-cli/settings.json`, relance `agy --conversation <id>` et
//! demande de reprendre l'action. Vérifié le 2026-09-17 : la règle n'est lue qu'au
//! démarrage du processus (ajout à chaud ignoré), d'où la relance.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

use serde_json::{json, Value};

use crate::core::{AppError, AppResult};
use crate::engine::event::{
    ActivityPhase, AutoMode, EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo,
    OptionVariant, PromptAnswer, PromptDetail, PromptKind, PromptOption, PromptSource,
    RiskLevel, TransportKind,
};
use crate::engine::policy;

use super::{AnswerAction, CliAdapter, DecodeCtx, PermissionGrant};

/// Action refusée par agy, en attente de la décision de l'utilisateur.
#[derive(Debug, Clone)]
struct Denial {
    rule: String,
    target: String,
}

#[derive(Default)]
pub struct AntigravityAdapter {
    /// prompt_id → règle à accorder.
    denials: HashMap<String, Denial>,
}

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

    fn grant_permission(&self, rule: &str) -> AppResult<()> {
        update_settings(|settings| add_rule(settings, rule))
    }

    fn revoke_permission(&self, rule: &str) -> AppResult<()> {
        update_settings(|settings| remove_rule(settings, rule))
    }

    fn decode_line(&mut self, line: &str, ctx: &DecodeCtx) -> Vec<EngineEvent> {
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
            Some("step_update") => decode_step(
                value.get("step_update").unwrap_or(&Value::Null),
                ctx.session_id,
                &mut self.denials,
            ),
            Some("result") => decode_result(value.get("result").unwrap_or(&Value::Null)),
            _ => Vec::new(),
        }
    }

    fn encode_answer(
        &mut self,
        prompt: &InteractivePrompt,
        answer: &PromptAnswer,
        allowed: bool,
    ) -> AnswerAction {
        let Some(denial) = self.denials.remove(&prompt.prompt_id) else {
            return AnswerAction::None;
        };
        if !allowed {
            // agy a déjà appliqué le refus et poursuivi : rien à transmettre.
            return AnswerAction::None;
        }
        AnswerAction::Relaunch {
            grant: PermissionGrant {
                rule: denial.rule,
                persistent: answer.option_id.as_deref() == Some("always"),
            },
            retry: format!(
                "The user has now granted permission for: {}\nRetry the action that was denied and continue the task.",
                denial.target
            ),
        }
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

/// `permission check failed for <kind> "<cible>"` (cible au format Go `%q`).
fn parse_denial(message: &str) -> Option<(String, String)> {
    static PATTERN: OnceLock<Option<Regex>> = OnceLock::new();
    let pattern = PATTERN
        .get_or_init(|| Regex::new(r#"permission check failed for (\w+) ("(?:[^"\\]|\\.)*")"#).ok())
        .as_ref()?;
    let captures = pattern.captures(message)?;
    let kind = captures.get(1)?.as_str().to_string();
    let target = serde_json::from_str::<String>(captures.get(2)?.as_str()).ok()?;
    Some((kind, target))
}

fn denial_prompt(
    session_id: &str,
    tool: &str,
    kind: &str,
    target: &str,
    message: &str,
) -> InteractivePrompt {
    let (risk, _) = policy::classify(tool, target);
    let title = match kind {
        "command" => "Antigravity veut exécuter une commande".to_string(),
        "read_file" => "Antigravity veut lire un fichier".to_string(),
        "write_file" => "Antigravity veut modifier un fichier".to_string(),
        other => format!("Antigravity demande une permission ({other})"),
    };
    let detail = if kind == "command" {
        PromptDetail::Command { line: target.to_string(), cwd: None }
    } else {
        PromptDetail::Text { text: target.to_string() }
    };
    InteractivePrompt {
        prompt_id: uuid::Uuid::new_v4().to_string(),
        session_id: session_id.to_string(),
        kind: PromptKind::Permission,
        tool: Some(tool.to_string()),
        title,
        detail: Some(detail),
        options: vec![
            PromptOption::new("allow", "Autoriser", OptionVariant::Primary),
            PromptOption::new("always", "Toujours autoriser", OptionVariant::Default),
            PromptOption::new("deny", "Refuser", OptionVariant::Danger),
        ],
        default_option: (risk != RiskLevel::Critical).then(|| "allow".to_string()),
        allow_free_text: false,
        risk,
        source: PromptSource::Structured,
        raw_excerpt: Some(message.to_string()),
    }
}

fn decode_step(step: &Value, session_id: &str, denials: &mut HashMap<String, Denial>) -> Vec<EngineEvent> {
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

                    if let Some((kind, target)) = parse_denial(&message) {
                        let prompt = denial_prompt(session_id, &tool, &kind, &target, &message);
                        denials.insert(
                            prompt.prompt_id.clone(),
                            Denial { rule: format!("{kind}({target})"), target },
                        );
                        events.push(EngineEvent::Prompt { prompt });
                    } else if message.contains("permission check failed") {
                        events.push(EngineEvent::Error {
                            code: "PERMISSION_DENIED".to_string(),
                            message: format!(
                                "Antigravity a refusé cette action sans pouvoir demander de permission. \
                                 Autorisez-la dans les réglages d'agy (permissions.allow). ({message})"
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

fn settings_path() -> AppResult<PathBuf> {
    crate::core::paths::dirs_home()
        .map(|home| home.join(".gemini").join("antigravity-cli").join("settings.json"))
        .ok_or_else(|| AppError::internal("dossier utilisateur introuvable"))
}

/// Lit, modifie puis réécrit `settings.json` en conservant les autres réglages.
fn update_settings(change: impl FnOnce(&mut Value) -> bool) -> AppResult<()> {
    let path = settings_path()?;
    let mut settings = match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Value>(&text)
            .map_err(|e| AppError::internal(format!("{} illisible : {e}", path.display())))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => return Err(error.into()),
    };
    if !change(&mut settings) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(&settings)
        .map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::write(&path, text)?;
    Ok(())
}

/// Ajoute la règle à `permissions.allow`. `true` si le document a changé.
fn add_rule(settings: &mut Value, rule: &str) -> bool {
    let Some(root) = settings.as_object_mut() else {
        return false;
    };
    let permissions = root.entry("permissions").or_insert_with(|| json!({}));
    let Some(permissions) = permissions.as_object_mut() else {
        return false;
    };
    let allow = permissions.entry("allow").or_insert_with(|| json!([]));
    let Some(allow) = allow.as_array_mut() else {
        return false;
    };
    if allow.iter().any(|existing| existing.as_str() == Some(rule)) {
        return false;
    }
    allow.push(Value::String(rule.to_string()));
    true
}

fn remove_rule(settings: &mut Value, rule: &str) -> bool {
    let Some(allow) = settings
        .pointer_mut("/permissions/allow")
        .and_then(Value::as_array_mut)
    else {
        return false;
    };
    let before = allow.len();
    allow.retain(|existing| existing.as_str() != Some(rule));
    allow.len() != before
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
        let args = AntigravityAdapter::default().spawn_args(LaunchOptions {
            model: Some("gemini-3.8-flash-low"),
            resume: Some("abc"),
            auto_mode: AutoMode::Smart,
        });
        assert_eq!(args.last().map(String::as_str), Some("-p="));
        assert!(args.windows(2).any(|w| w[0] == "--conversation" && w[1] == "abc"));
        assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "accept-edits"));
        assert!(!AntigravityAdapter::default()
            .spawn_args(LaunchOptions::new(None, None))
            .contains(&"--mode".to_string()));
    }

    #[test]
    fn encodes_the_verified_input_format() {
        let line = AntigravityAdapter::default().encode_user_message("bonjour");
        let value: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(value["event"], "user");
        assert_eq!(value["message"]["content"][0]["text"], "bonjour");
    }

    #[test]
    fn decodes_recorded_session() {
        let mut adapter = AntigravityAdapter::default();
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
        let mut adapter = AntigravityAdapter::default();
        let line = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"stream input message is missing the \"event\" field","duration_seconds":0,"usage":{}}}"#;
        let events = adapter.decode_line(line, &ctx());
        assert!(events.iter().any(|e| matches!(e, EngineEvent::Error { message, .. } if message.contains("missing the"))));
    }

    #[test]
    fn permission_denial_becomes_a_prompt_and_relaunch() {
        let mut adapter = AntigravityAdapter::default();
        // Message réel d'agy 1.2.3 (cible au format Go %q).
        let message = r#"permission check failed for command "Test-Path \"C:\\tmp\"": user denied permission to run command"#;
        let line = json!({
            "event": "step_update",
            "step_update": {
                "step_index": 2, "state": "ERROR", "step_type": "tool", "tool_name": "run_command",
                "tool_info": { "error": { "type": "TOOL_ERROR", "message": message } }
            }
        })
        .to_string();
        let events = adapter.decode_line(&line, &ctx());
        let prompt = events
            .iter()
            .find_map(|e| match e {
                EngineEvent::Prompt { prompt } => Some(prompt.clone()),
                _ => None,
            })
            .expect("carte de permission");
        assert!(matches!(&prompt.detail, Some(PromptDetail::Command { line, .. }) if line == r#"Test-Path "C:\tmp""#));

        let answer = PromptAnswer { option_id: Some("allow".into()), text: None, edited_input: None };
        let AnswerAction::Relaunch { grant, retry } = adapter.encode_answer(&prompt, &answer, true) else {
            panic!("relance attendue");
        };
        assert_eq!(grant.rule, r#"command(Test-Path "C:\tmp")"#);
        assert!(!grant.persistent);
        assert!(retry.contains("Test-Path"));
        // Une réponse ne s'applique qu'une fois.
        assert!(matches!(adapter.encode_answer(&prompt, &answer, true), AnswerAction::None));
    }

    #[test]
    fn edits_allow_rules_without_touching_other_settings() {
        let mut settings = json!({ "model": "x", "permissions": { "allow": ["command(pnpm test)"] } });
        assert!(add_rule(&mut settings, "command(echo hi)"));
        assert!(!add_rule(&mut settings, "command(echo hi)"));
        assert_eq!(settings["permissions"]["allow"].as_array().map(Vec::len), Some(2));
        assert!(remove_rule(&mut settings, "command(echo hi)"));
        assert_eq!(settings, json!({ "model": "x", "permissions": { "allow": ["command(pnpm test)"] } }));

        let mut empty = json!({});
        assert!(add_rule(&mut empty, "read_file(C:/a)"));
        assert_eq!(empty["permissions"]["allow"][0], "read_file(C:/a)");
    }

    #[test]
    fn parses_models_listing() {
        let models = parse_models("Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n");
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gemini-3.8-flash-high");
    }
}
