//! Types échangés avec l'interface (exportés en TypeScript par ts-rs).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Gamme de la machine, pour proposer des modèles locaux raisonnables.
#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub enum HardwareTier {
    Low,
    Mid,
    High,
}

#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct GpuInfo {
    pub name: String,
    /// `nvidia`, `amd`, `intel`, `apple`, `other`.
    pub vendor: String,
    /// Mémoire vidéo dédiée (Mo) ; `None` si inconnue.
    #[ts(type = "number | null")]
    pub vram_mb: Option<u64>,
    /// Carte séparée (mémoire propre) plutôt que puce intégrée.
    pub dedicated: bool,
}

#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct HardwareInfo {
    /// `windows`, `macos`, `linux`.
    pub os: String,
    /// `x86_64`, `aarch64`…
    pub arch: String,
    pub cpu: String,
    pub cores: u32,
    #[ts(type = "number")]
    pub ram_mb: u64,
    pub gpus: Vec<GpuInfo>,
    pub tier: HardwareTier,
    /// Pourquoi cette gamme (phrases courtes, affichées telles quelles).
    pub reasons: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/", rename = "VoiceModelKind")]
pub enum ModelKind {
    Stt,
    Tts,
    Llm,
    Runtime,
}

/// Convenance d'un modèle pour la machine.
#[derive(Serialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/", rename = "VoiceModelFit")]
pub enum ModelFit {
    Recommended,
    Optional,
    NotRecommended,
    /// Pas de version pour ce système (ex. binaire absent sur macOS).
    Unsupported,
}

#[derive(Serialize, Deserialize, TS, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/", rename = "VoiceModelStatus")]
pub enum ModelStatus {
    NotInstalled,
    Downloading,
    Paused,
    Verifying,
    Installing,
    Installed,
    UpdateAvailable,
    Failed,
}

/// Un modèle du catalogue, avec son état sur cette machine.
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/", rename = "VoiceModelEntry")]
pub struct ModelEntry {
    pub id: String,
    pub kind: ModelKind,
    pub name: String,
    pub description: String,
    /// Moteur qui l'utilise : `whisper.cpp`, `piper`, `ollama`.
    pub engine: String,
    pub version: String,
    #[ts(type = "number")]
    pub size_mb: u64,
    #[ts(type = "number")]
    pub ram_mb: u64,
    #[ts(type = "number | null")]
    pub vram_mb: Option<u64>,
    /// 1 (lent) à 5 (instantané).
    pub speed: u8,
    /// 1 (basique) à 5 (excellente).
    pub quality: u8,
    pub languages: Vec<String>,
    pub capabilities: Vec<String>,
    pub license: String,
    pub fit: ModelFit,
    pub status: ModelStatus,
    /// Outil local nécessaire (`runtime-whisper`, `runtime-piper`) ou `ollama`.
    pub requires: Option<String>,
    #[ts(type = "number")]
    pub received: u64,
    #[ts(type = "number")]
    pub total: u64,
    pub error: Option<String>,
    /// Dossier d'installation, quand le modèle est installé.
    pub path: Option<String>,
}

/// Avancement d'un téléchargement (événement `voice:model`).
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/", rename = "VoiceModelProgress")]
pub struct ModelProgress {
    pub id: String,
    pub status: ModelStatus,
    #[ts(type = "number")]
    pub received: u64,
    #[ts(type = "number")]
    pub total: u64,
    /// Étape en cours (« Téléchargement de l'outil whisper.cpp »…).
    pub step: Option<String>,
    pub error: Option<String>,
}

/// Fournisseur en ligne (ou serveur local compatible) et état de sa clé.
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct VoiceProviderStatus {
    pub id: String,
    pub name: String,
    pub has_key: bool,
    /// Début et fin de la clé, jamais la clé entière.
    pub masked: Option<String>,
    pub needs_key: bool,
}

/// Une voix proposée par un moteur.
#[derive(Serialize, TS, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct VoiceOption {
    pub id: String,
    pub name: String,
    pub language: Option<String>,
    /// Profil personnalisé (voix clonée avec consentement, gérée par le moteur).
    pub custom: bool,
}

/// État d'un serveur local d'IA (Ollama) ou de voix (Voicebox).
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct LocalServerStatus {
    pub running: bool,
    pub url: String,
    pub version: Option<String>,
    pub models: Vec<String>,
}

/// Serveur MCP d'ARCHIMED : adresse et configuration à coller dans un agent externe.
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct McpInfo {
    pub running: bool,
    pub url: Option<String>,
    /// Bloc `mcpServers` complet (jeton compris) pour Claude Code, Cursor…
    pub config: Option<String>,
    pub tools: Vec<String>,
    /// Appels reçus depuis le démarrage.
    #[ts(type = "number")]
    pub calls: u64,
}

/// Demande d'un agent (outil MCP) transmise à l'interface (événement `voice:mcp-call`).
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct McpCall {
    pub call_id: String,
    pub tool: String,
    #[ts(type = "Record<string, unknown>")]
    pub arguments: serde_json::Value,
}

/// Événement du modèle local (Ollama) pendant une réponse.
#[derive(Serialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub enum LocalChatEvent {
    Delta { text: String },
    Done,
    Error { message: String },
}

/// Résumé d'une session vocale enregistrée.
#[derive(Serialize, Deserialize, TS, Clone, Debug)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct VoiceSessionSummary {
    pub id: String,
    pub title: String,
    #[ts(type = "number")]
    pub started_at: i64,
    #[ts(type = "number")]
    pub updated_at: i64,
    pub turns: u32,
}
