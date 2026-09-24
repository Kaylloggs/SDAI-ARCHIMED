//! Adaptateurs déclarés en TOML : ajouter une CLI sans écrire de Rust (guidelines.md §5).
//!
//! Fichiers lus dans `%APPDATA%\com.sdai.archimed\adapters\*.toml` :
//!
//! ```toml
//! id = "ma-cli"                     # kebab-case, unique
//! name = "Ma CLI"
//! binary = ["ma-cli", "ma-cli.cmd"] # cherchés dans le PATH
//! args = ["--model", "{model}"]     # {model} retiré avec son option s'il n'y a pas de modèle
//! resume_args = ["--resume", "{resume}"]
//! models = [{ id = "rapide", label = "Rapide" }]
//! default_model = "rapide"
//! hint = "Installez ma-cli avec …"
//!
//! [[rule]]                          # règles de questions propres à cette CLI (optionnel)
//! id = "ma-cli.deploy"
//! kind = "confirm"
//! confidence = 0.9
//! pattern = '''^Déployer en production \? \(oui/non\)$'''
//!   [[rule.option]]
//!   id = "yes"
//!   label = "Déployer"
//!   keys = "oui\r"
//!   variant = "danger"
//! ```
//! Transport : toujours PTY (la CLI tourne dans un vrai terminal, ses questions sont lues à l'écran).

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Deserialize;

use crate::engine::event::{EngineEvent, InteractivePrompt, LaunchOptions, ModelInfo, PromptAnswer, TransportKind};

use super::{AnswerAction, CliAdapter, DecodeCtx};

static USER_DIR: OnceLock<PathBuf> = OnceLock::new();

const EXAMPLE: &str = include_str!("../../../resources/adapters/exemple.toml");

#[derive(Debug, Deserialize)]
struct ModelSpec {
    id: String,
    label: String,
}

#[derive(Debug, Deserialize)]
struct Spec {
    id: String,
    name: String,
    binary: Vec<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    resume_args: Vec<String>,
    #[serde(default)]
    models: Vec<ModelSpec>,
    #[serde(default)]
    default_model: Option<String>,
    #[serde(default)]
    hint: Option<String>,
}

pub struct DeclarativeAdapter {
    // Chaînes « 'static » : le trait expose des &'static str. Fuite volontaire et bornée
    // (quelques fichiers chargés au démarrage de chaque sondage).
    id: &'static str,
    name: &'static str,
    binaries: &'static [&'static str],
    args: Vec<String>,
    resume_args: Vec<String>,
    models: Vec<ModelInfo>,
    default_model: Option<String>,
    hint: &'static str,
    rules_source: String,
}

fn leak(value: String) -> &'static str {
    Box::leak(value.into_boxed_str())
}

impl DeclarativeAdapter {
    pub fn parse(source: &str) -> Result<Self, String> {
        let spec: Spec = toml::from_str(source).map_err(|e| e.to_string())?;
        if spec.id.is_empty() || spec.binary.is_empty() {
            return Err("`id` et `binary` sont obligatoires".into());
        }
        // Les règles éventuelles sont validées dès le chargement.
        crate::engine::parser::rules::parse_rules(source).map_err(|e| e.message)?;

        let binaries: Vec<&'static str> = spec.binary.into_iter().map(leak).collect();
        Ok(Self {
            id: leak(spec.id),
            name: leak(spec.name),
            binaries: Box::leak(binaries.into_boxed_slice()),
            args: spec.args,
            resume_args: spec.resume_args,
            models: spec
                .models
                .into_iter()
                .map(|m| ModelInfo::plain(m.id, m.label))
                .collect(),
            default_model: spec.default_model,
            hint: leak(spec.hint.unwrap_or_else(|| "CLI introuvable dans le PATH.".into())),
            rules_source: source.to_string(),
        })
    }
}

/// Remplace `{placeholder}` ; retire le couple « option valeur » si la valeur manque.
fn expand(template: &[String], placeholder: &str, value: Option<&str>) -> Vec<String> {
    let token = format!("{{{placeholder}}}");
    let mut out = Vec::new();
    let mut index = 0;
    while index < template.len() {
        let arg = &template[index];
        if arg.contains(&token) {
            match value {
                Some(value) => out.push(arg.replace(&token, value)),
                None => {
                    // « --model {model} » sans modèle : on retire aussi l'option précédente.
                    if out.last().map(|prev: &String| prev.starts_with('-')).unwrap_or(false) {
                        out.pop();
                    }
                }
            }
        } else {
            out.push(arg.clone());
        }
        index += 1;
    }
    out
}

impl CliAdapter for DeclarativeAdapter {
    fn id(&self) -> &'static str {
        self.id
    }

    fn name(&self) -> &'static str {
        self.name
    }

    fn accent(&self) -> &'static str {
        "neutral"
    }

    fn transport(&self) -> TransportKind {
        TransportKind::Pty
    }

    fn binary_names(&self) -> &'static [&'static str] {
        self.binaries
    }

    fn models(&self, _binary: Option<&Path>) -> Vec<ModelInfo> {
        self.models.clone()
    }

    fn default_model(&self) -> Option<String> {
        self.default_model.clone()
    }

    fn missing_hint(&self) -> &'static str {
        self.hint
    }

    fn prompt_rules(&self) -> Option<String> {
        Some(self.rules_source.clone())
    }

    fn spawn_args(&self, options: LaunchOptions<'_>) -> Vec<String> {
        let LaunchOptions { model, resume, .. } = options;
        let mut args = expand(&self.args, "model", model);
        if resume.is_some() {
            args.extend(expand(&self.resume_args, "resume", resume));
        }
        args
    }

    fn encode_user_message(&self, text: &str) -> String {
        text.to_string()
    }

    fn decode_line(&mut self, _line: &str, _ctx: &DecodeCtx) -> Vec<EngineEvent> {
        Vec::new()
    }

    fn encode_answer(&mut self, _prompt: &InteractivePrompt, _answer: &PromptAnswer, _allowed: bool) -> AnswerAction {
        AnswerAction::None
    }
}

/// Définit le dossier des adaptateurs utilisateur et y dépose un exemple commenté.
pub fn init_user_dir(dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    let example = dir.join("exemple.toml.txt");
    if !example.exists() {
        let _ = std::fs::write(example, EXAMPLE);
    }
    let _ = USER_DIR.set(dir.to_path_buf());
}

pub fn user_dir() -> Option<&'static PathBuf> {
    USER_DIR.get()
}

/// Charge les adaptateurs valides ; un fichier invalide est ignoré et signalé dans les logs.
pub fn load_user_adapters(reserved: &[&str]) -> Vec<DeclarativeAdapter> {
    let Some(dir) = USER_DIR.get() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().map(|ext| ext == "toml").unwrap_or(false))
        .filter_map(|path| {
            let source = std::fs::read_to_string(&path).ok()?;
            match DeclarativeAdapter::parse(&source) {
                Ok(adapter) if !reserved.contains(&adapter.id) => Some(adapter),
                Ok(adapter) => {
                    tracing::warn!("adaptateur {} ignoré : id réservé ({})", path.display(), adapter.id);
                    None
                }
                Err(error) => {
                    tracing::warn!("adaptateur {} invalide : {error}", path.display());
                    None
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_file_is_valid() {
        let adapter = DeclarativeAdapter::parse(EXAMPLE).unwrap();
        assert_eq!(adapter.transport(), TransportKind::Pty);
        assert!(adapter.prompt_rules().is_some());
    }

    #[test]
    fn expands_placeholders_and_drops_missing_options() {
        let source = r#"
id = "demo"
name = "Demo"
binary = ["demo"]
args = ["chat", "--model", "{model}"]
resume_args = ["--resume", "{resume}"]
"#;
        let adapter = DeclarativeAdapter::parse(source).unwrap();
        assert_eq!(adapter.spawn_args(LaunchOptions::new(Some("fast"), None)), vec!["chat", "--model", "fast"]);
        assert_eq!(adapter.spawn_args(LaunchOptions::new(None, None)), vec!["chat"]);
        assert_eq!(adapter.spawn_args(LaunchOptions::new(None, Some("abc"))), vec!["chat", "--resume", "abc"]);
    }

    #[test]
    fn rejects_incomplete_or_invalid_files() {
        assert!(DeclarativeAdapter::parse("name = \"x\"").is_err());
        let bad_rule = "id=\"x\"\nname=\"x\"\nbinary=[\"x\"]\n[[rule]]\nid=\"r\"\nkind=\"confirm\"\nconfidence=0.5\npattern=\"(\"\n";
        assert!(DeclarativeAdapter::parse(bad_rule).is_err());
    }
}
