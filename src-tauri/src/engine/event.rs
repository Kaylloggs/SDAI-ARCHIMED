use serde::{Deserialize, Serialize};

pub type SessionId = String;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TransportKind {
    Structured,
    Pty,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AutoMode {
    Off,
    Smart,
    Full,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PromptKind {
    Confirm,
    Choice,
    Permission,
    FreeText,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OptionVariant {
    Primary,
    Default,
    Danger,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptOption {
    pub id: String,
    pub label: String,
    pub variant: OptionVariant,
    pub shortcut: Option<String>,
}

impl PromptOption {
    pub fn new(id: &str, label: &str, variant: OptionVariant) -> Self {
        Self {
            id: id.to_string(),
            label: label.to_string(),
            variant,
            shortcut: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PromptDetail {
    Diff {
        path: String,
        before: Option<String>,
        after: String,
    },
    Command {
        line: String,
        cwd: Option<String>,
    },
    Text {
        text: String,
    },
    Json {
        value: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PromptSource {
    /// Demande reçue via le protocole de la CLI (fiabilité maximale).
    Protocol,
    /// Déduite du flux structuré (ex: refus a posteriori).
    Structured,
    /// Détectée sur l'écran d'un PTY.
    Screen { rule_id: String, confidence: f32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractivePrompt {
    pub prompt_id: String,
    pub session_id: SessionId,
    pub kind: PromptKind,
    pub tool: Option<String>,
    pub title: String,
    pub detail: Option<PromptDetail>,
    pub options: Vec<PromptOption>,
    pub default_option: Option<String>,
    pub allow_free_text: bool,
    pub risk: RiskLevel,
    pub source: PromptSource,
    pub raw_excerpt: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ResolvedBy {
    User,
    Auto,
    Policy,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    #[serde(rename_all = "camelCase")]
    SessionStarted {
        session_id: SessionId,
        adapter: String,
        model: String,
        transport: TransportKind,
    },
    #[serde(rename_all = "camelCase")]
    MessageDelta { message_id: String, text: String },
    #[serde(rename_all = "camelCase")]
    MessageCompleted { message_id: String },
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    Thinking { text: String },
    #[serde(rename_all = "camelCase")]
    ToolCall {
        call_id: String,
        tool: String,
        input: serde_json::Value,
    },
    #[serde(rename_all = "camelCase")]
    ToolResult {
        call_id: String,
        ok: bool,
        output: String,
    },
    #[serde(rename_all = "camelCase")]
    Prompt { prompt: InteractivePrompt },
    #[serde(rename_all = "camelCase")]
    PromptResolved {
        prompt_id: String,
        by: ResolvedBy,
        option_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)] // émis par le détecteur PTY (Phase 2)
    PromptInvalidated { prompt_id: String },
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)] // alimenté par le transport PTY (Phase 2)
    RawOutput { chunk: String },
    #[serde(rename_all = "camelCase")]
    Usage {
        input_tokens: u64,
        output_tokens: u64,
        cost_usd: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        code: String,
        message: String,
        recoverable: bool,
    },
    #[serde(rename_all = "camelCase")]
    SessionEnded { exit_code: Option<i32> },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAnswer {
    pub option_id: Option<String>,
    pub text: Option<String>,
    pub edited_input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterInfo {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub version: Option<String>,
    pub binary_path: Option<String>,
    pub transport: TransportKind,
    pub models: Vec<ModelInfo>,
    pub default_model: Option<String>,
    pub accent: String,
    pub hint: Option<String>,
}
