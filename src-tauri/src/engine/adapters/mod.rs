pub mod antigravity;
pub mod claude;
pub mod codex;
pub mod declarative;

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

use super::event::{
    AdapterInfo, AutoMode, EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo, PromptAnswer,
    TransportKind,
};

/// Ce que l'adaptateur veut envoyer à la CLI après une réponse utilisateur.
#[derive(Debug, Clone)]
pub enum AnswerAction {
    /// Ligne NDJSON à écrire sur stdin.
    Stdin(String),
    /// Séquence de touches (transport PTY — Phase 2).
    #[allow(dead_code)]
    Keys(Vec<u8>),
    /// Rien à envoyer (réponse purement locale).
    None,
    /// La CLI ne peut pas recevoir la réponse (refus déjà appliqué, ex. agy headless) :
    /// accorder la règle, relancer le processus sur la même conversation puis envoyer `retry`.
    Relaunch {
        grant: PermissionGrant,
        retry: String,
    },
}

/// Règle d'autorisation à écrire dans la configuration de la CLI.
#[derive(Debug, Clone)]
pub struct PermissionGrant {
    pub rule: String,
    /// `false` : retirée à la fin du tour de relance (autorisation ponctuelle).
    pub persistent: bool,
}

/// Contexte donné au décodeur pour les décisions locales (policy, ids).
pub struct DecodeCtx<'a> {
    pub session_id: &'a str,
    pub auto_mode: AutoMode,
}

/// Contrat d'une CLI encapsulée (guidelines.md §5).
pub trait CliAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn name(&self) -> &'static str;
    fn accent(&self) -> &'static str;
    fn transport(&self) -> TransportKind;

    /// Noms d'exécutables à chercher dans le PATH.
    fn binary_names(&self) -> &'static [&'static str];

    /// Emplacements supplémentaires (installations hors PATH).
    fn extra_locations(&self) -> Vec<PathBuf> {
        Vec::new()
    }

    fn version(&self, _binary: &std::path::Path) -> Option<String> {
        None
    }

    /// Règles de questions propres à la CLI (TOML), pour le transport PTY.
    fn prompt_rules(&self) -> Option<String> {
        None
    }

    /// `true` si la CLI attend la fermeture de stdin pour traiter le message
    /// (CLI « one-shot » comme `codex exec`).
    fn closes_stdin_after_message(&self) -> bool {
        false
    }

    /// Écrit une règle d'autorisation dans la configuration de la CLI.
    fn grant_permission(&self, rule: &str) -> crate::core::AppResult<()> {
        Err(crate::core::AppError::invalid(format!(
            "{} ne gère pas les règles d'autorisation ({rule})",
            self.name()
        )))
    }

    /// Retire une règle écrite par `grant_permission`.
    fn revoke_permission(&self, _rule: &str) -> crate::core::AppResult<()> {
        Ok(())
    }

    fn models(&self, binary: Option<&std::path::Path>) -> Vec<ModelInfo>;
    fn default_model(&self) -> Option<String>;
    fn missing_hint(&self) -> &'static str;

    /// Arguments de lancement d'une session (modèle, conversation à reprendre émise
    /// précédemment via `EngineEvent::CliSession`, Mode Auto).
    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String>;

    /// Encode un message utilisateur (NDJSON pour les transports structurés).
    fn encode_user_message(&self, text: &str) -> String;

    /// Traduit une ligne de sortie en événements pour le frontend.
    fn decode_line(&mut self, line: &str, ctx: &DecodeCtx) -> Vec<EngineEvent>;

    /// Traduit une réponse utilisateur en action vers la CLI.
    fn encode_answer(
        &mut self,
        prompt: &InteractivePrompt,
        answer: &PromptAnswer,
        allowed: bool,
    ) -> AnswerAction;
}

/// Résout un binaire : chemin forcé par l'utilisateur, puis PATH, puis emplacements connus.
pub fn resolve_binary(adapter: &dyn CliAdapter, overrides: &HashMap<String, String>) -> Option<PathBuf> {
    if let Some(path) = overrides.get(adapter.id()).map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    for name in adapter.binary_names() {
        if let Ok(path) = which::which(name) {
            return Some(path);
        }
    }
    adapter.extra_locations().into_iter().find(|p| p.exists())
}

pub fn describe(adapter: &dyn CliAdapter, overrides: &HashMap<String, String>) -> AdapterInfo {
    let binary = resolve_binary(adapter, overrides);
    let models = adapter.models(binary.as_deref());
    AdapterInfo {
        id: adapter.id().to_string(),
        name: adapter.name().to_string(),
        installed: binary.is_some(),
        version: binary.as_deref().and_then(|b| adapter.version(b)),
        binary_path: binary.as_ref().map(|p| p.display().to_string()),
        transport: adapter.transport(),
        default_model: adapter
            .default_model()
            .or_else(|| models.first().map(|m| m.id.clone())),
        models,
        accent: adapter.accent().to_string(),
        hint: if binary.is_none() {
            Some(adapter.missing_hint().to_string())
        } else {
            None
        },
    }
}

pub fn build_all() -> Vec<Box<dyn CliAdapter>> {
    let mut adapters: Vec<Box<dyn CliAdapter>> = vec![
        Box::new(claude::ClaudeAdapter::default()),
        Box::new(antigravity::AntigravityAdapter::default()),
        Box::new(codex::CodexAdapter),
    ];
    let reserved: Vec<&str> = adapters.iter().map(|a| a.id()).collect();
    for adapter in declarative::load_user_adapters(&reserved) {
        adapters.push(Box::new(adapter));
    }
    adapters
}

/// Extrait un texte représentatif d'une entrée d'outil pour la classification de risque.
pub fn payload_of(input: &Value) -> String {
    const KEYS: &[&str] = &[
        "command",
        "CommandLine",
        "file_path",
        "path",
        "url",
        "pattern",
        "query",
        "content",
    ];
    if let Some(object) = input.as_object() {
        let mut parts = Vec::new();
        for key in KEYS {
            if let Some(Value::String(value)) = object.get(*key) {
                parts.push(value.clone());
            }
        }
        if !parts.is_empty() {
            return parts.join(" ");
        }
    }
    input.to_string()
}
