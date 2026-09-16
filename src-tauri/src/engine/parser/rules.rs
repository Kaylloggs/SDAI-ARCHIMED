//! Règles TOML de détection de questions (architecture.md §7.5).

use regex::Regex;
use serde::Deserialize;

use crate::core::{AppError, AppResult};
use crate::engine::event::{OptionVariant, PromptKind};

/// Règles génériques embarquées dans l'exécutable.
const GENERIC: &str = include_str!("../../../resources/prompt-rules/generic.toml");

#[derive(Debug, Deserialize)]
struct RuleFile {
    #[serde(default)]
    rule: Vec<RawRule>,
}

#[derive(Debug, Deserialize)]
struct RawRule {
    id: String,
    kind: String,
    confidence: f32,
    pattern: String,
    #[serde(default)]
    default_from: Option<String>,
    #[serde(default)]
    option: Vec<RawOption>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RawOption {
    pub id: String,
    pub label: String,
    pub keys: String,
    #[serde(default)]
    pub variant: Option<String>,
    /// Lettre associée (pour `default_from = "uppercase"`).
    #[serde(default)]
    pub letter: Option<String>,
}

#[derive(Debug)]
pub struct Rule {
    pub id: String,
    pub kind: PromptKind,
    pub confidence: f32,
    pub pattern: Regex,
    pub default_from_uppercase: bool,
    pub options: Vec<RuleOption>,
}

#[derive(Debug, Clone)]
pub struct RuleOption {
    pub id: String,
    pub label: String,
    pub keys: Vec<u8>,
    pub variant: OptionVariant,
    pub letter: Option<char>,
}

fn kind_of(raw: &str) -> PromptKind {
    match raw {
        "choice" => PromptKind::Choice,
        "permission" => PromptKind::Permission,
        "freeText" | "free_text" => PromptKind::FreeText,
        _ => PromptKind::Confirm,
    }
}

fn variant_of(raw: Option<&str>) -> OptionVariant {
    match raw {
        Some("primary") => OptionVariant::Primary,
        Some("danger") => OptionVariant::Danger,
        _ => OptionVariant::Default,
    }
}

pub fn parse_rules(source: &str) -> AppResult<Vec<Rule>> {
    let file: RuleFile =
        toml::from_str(source).map_err(|e| AppError::invalid(format!("règles TOML invalides : {e}")))?;

    file.rule
        .into_iter()
        .map(|raw| {
            let pattern = Regex::new(&raw.pattern)
                .map_err(|e| AppError::invalid(format!("règle {} : regex invalide ({e})", raw.id)))?;
            Ok(Rule {
                kind: kind_of(&raw.kind),
                confidence: raw.confidence.clamp(0.0, 1.0),
                default_from_uppercase: raw.default_from.as_deref() == Some("uppercase"),
                options: raw
                    .option
                    .into_iter()
                    .map(|option| RuleOption {
                        variant: variant_of(option.variant.as_deref()),
                        letter: option.letter.as_deref().and_then(|l| l.chars().next()),
                        keys: option.keys.into_bytes(),
                        id: option.id,
                        label: option.label,
                    })
                    .collect(),
                id: raw.id,
                pattern,
            })
        })
        .collect()
}

/// Règles génériques + règles propres à une CLI (déclarées dans son adaptateur TOML).
pub fn load(extra: Option<&str>) -> AppResult<Vec<Rule>> {
    let mut rules = match extra {
        Some(source) => parse_rules(source)?,
        None => Vec::new(),
    };
    // Les règles spécifiques passent avant les génériques.
    rules.extend(parse_rules(GENERIC)?);
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generic_rules_compile() {
        let rules = load(None).unwrap();
        assert!(rules.iter().any(|r| r.id == "generic.yes_no"));
        let yes = &rules.iter().find(|r| r.id == "generic.yes_no").unwrap().options[0];
        assert_eq!(yes.keys, b"y\r");
    }

    #[test]
    fn rejects_invalid_regex() {
        let source = "[[rule]]\nid = \"x\"\nkind = \"confirm\"\nconfidence = 0.5\npattern = \"(\"\n";
        assert!(parse_rules(source).is_err());
    }
}
