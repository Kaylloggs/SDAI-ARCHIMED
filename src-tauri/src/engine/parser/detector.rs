//! Détecteur de questions sur l'écran rendu d'une CLI (architecture.md §7.4).
//!
//! Ordre : règles TOML (spécifiques puis génériques) → menus TUI → question ouverte.
//! On n'analyse que la fin de l'écran : une question en attente est toujours en bas.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use regex::Regex;
use std::sync::OnceLock;

use crate::engine::event::{OptionVariant, PromptKind};

use super::rules::{Rule, RuleOption};

/// Nombre de lignes non vides examinées en bas de l'écran.
const TAIL: usize = 12;

#[derive(Debug, Clone)]
pub struct DetectedOption {
    pub id: String,
    pub label: String,
    pub keys: Vec<u8>,
    pub variant: OptionVariant,
}

#[derive(Debug, Clone)]
pub struct Detection {
    pub rule_id: String,
    pub kind: PromptKind,
    pub title: String,
    pub options: Vec<DetectedOption>,
    pub default_option: Option<String>,
    pub allow_free_text: bool,
    pub confidence: f32,
    pub excerpt: String,
    /// Empreinte de la zone détectée : une même question n'est signalée qu'une fois.
    pub fingerprint: u64,
}

fn fingerprint(parts: &[&str]) -> u64 {
    let mut hasher = DefaultHasher::new();
    parts.hash(&mut hasher);
    hasher.finish()
}

fn tail(lines: &[String]) -> Vec<&str> {
    let mut out: Vec<&str> = lines
        .iter()
        .map(|line| line.trim_end())
        .filter(|line| !line.trim().is_empty())
        .collect();
    let start = out.len().saturating_sub(TAIL);
    out.drain(..start);
    out
}

fn from_rule(rule: &Rule, line: &str) -> Option<Detection> {
    let captures = rule.pattern.captures(line)?;
    let title = captures
        .name("question")
        .map(|m| m.as_str().trim().trim_end_matches([':', '?']).trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| line.trim().to_string());

    // Option par défaut : lettre en majuscule dans « [Y/n] ».
    let default_option = if rule.default_from_uppercase {
        captures.name("choices").and_then(|choices| {
            let upper = choices.as_str().chars().find(|c| c.is_ascii_uppercase())?;
            rule.options
                .iter()
                .find(|o| o.letter.map(|l| l.eq_ignore_ascii_case(&upper)).unwrap_or(false))
                .map(|o| o.id.clone())
        })
    } else {
        rule.options.first().map(|o| o.id.clone())
    };

    let options = rule
        .options
        .iter()
        .map(|option: &RuleOption| DetectedOption {
            id: option.id.clone(),
            label: option.label.clone(),
            keys: option.keys.clone(),
            variant: if Some(&option.id) == default_option.as_ref() && option.variant == OptionVariant::Default {
                OptionVariant::Primary
            } else if Some(&option.id) != default_option.as_ref() && option.variant == OptionVariant::Primary {
                OptionVariant::Default
            } else {
                option.variant
            },
        })
        .collect();

    Some(Detection {
        rule_id: rule.id.clone(),
        kind: rule.kind,
        title,
        options,
        default_option,
        allow_free_text: false,
        confidence: rule.confidence,
        excerpt: line.trim().to_string(),
        fingerprint: fingerprint(&[&rule.id, line.trim()]),
    })
}

fn menu_item_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^\s*(?P<cursor>[❯›>●▶→*])?\s*(?:(?P<number>\d{1,2})[.)]\s+)?(?P<label>\S.{0,80}?)\s*$").ok()
    })
    .as_ref()
}

/// Menu TUI : lignes consécutives en bas d'écran, numérotées ou avec un curseur de sélection.
fn detect_menu(lines: &[&str]) -> Option<Detection> {
    const MAX_ITEMS: usize = 10;
    let re = menu_item_regex()?;
    let mut items: Vec<(Option<u32>, bool, String)> = Vec::new();
    let mut start = lines.len();

    for index in (0..lines.len()).rev() {
        let line = lines[index].trim();
        // La ligne-question ferme le bloc d'options.
        if !items.is_empty() && (line.ends_with('?') || line.ends_with(':')) {
            break;
        }
        let Some(captures) = re.captures(lines[index]) else {
            break;
        };
        let number = captures.name("number").and_then(|n| n.as_str().parse::<u32>().ok());
        let cursor = captures.name("cursor").is_some();
        // Dans un menu numéroté, une ligne sans numéro ni curseur n'est plus une option.
        if number.is_none() && !cursor && items.iter().any(|(n, _, _)| n.is_some()) {
            break;
        }
        if items.len() == MAX_ITEMS {
            return None;
        }
        let label = captures.name("label")?.as_str().trim().to_string();
        items.push((number, cursor, label));
        start = index;
    }
    items.reverse();

    let numbered = items.iter().filter(|(n, _, _)| n.is_some()).count();
    let cursors = items.iter().filter(|(_, c, _)| *c).count();
    // Un vrai menu : au moins 2 options, et soit numérotées, soit exactement un curseur.
    if items.len() < 2 || (numbered < 2 && cursors != 1) || start == 0 {
        return None;
    }

    let question = lines[start - 1].trim().to_string();
    // Sans numéros, seule une ligne-question explicite distingue un menu d'une sortie ordinaire.
    if numbered < 2 && !(question.ends_with('?') || question.ends_with(':')) {
        return None;
    }
    let selected = items.iter().position(|(_, c, _)| *c).unwrap_or(0);

    let options = items
        .iter()
        .enumerate()
        .map(|(index, (number, _, label))| {
            let keys = match number {
                Some(n) => format!("{n}").into_bytes(),
                None => {
                    // Navigation aux flèches depuis l'option sélectionnée, puis Entrée.
                    let mut keys = Vec::new();
                    let (arrow, steps) = if index >= selected {
                        (b"\x1b[B", index - selected)
                    } else {
                        (b"\x1b[A", selected - index)
                    };
                    for _ in 0..steps {
                        keys.extend_from_slice(arrow);
                    }
                    keys.push(b'\r');
                    keys
                }
            };
            DetectedOption {
                id: format!("option-{}", index + 1),
                label: label.clone(),
                keys,
                variant: if index == selected { OptionVariant::Primary } else { OptionVariant::Default },
            }
        })
        .collect::<Vec<_>>();

    let labels: Vec<&str> = items.iter().map(|(_, _, l)| l.as_str()).collect();
    let mut parts = vec![question.as_str()];
    parts.extend(labels.iter());

    Some(Detection {
        rule_id: "heuristic.menu".to_string(),
        kind: PromptKind::Choice,
        title: question.trim_end_matches(':').to_string(),
        default_option: options.get(selected).map(|o| o.id.clone()),
        options,
        allow_free_text: false,
        confidence: if numbered >= 2 { 0.8 } else { 0.72 },
        excerpt: lines[start - 1..].join("\n"),
        fingerprint: fingerprint(&parts),
    })
}

/// Dernière ligne en forme de question ouverte (« Nom du projet : », « …? »).
fn detect_open_question(lines: &[&str]) -> Option<Detection> {
    let last = lines.last()?.trim();
    if last.len() < 4 || last.len() > 200 {
        return None;
    }
    if !(last.ends_with('?') || last.ends_with(':')) {
        return None;
    }
    Some(Detection {
        rule_id: "heuristic.open_question".to_string(),
        kind: PromptKind::FreeText,
        title: last.trim_end_matches(':').trim().to_string(),
        options: vec![DetectedOption {
            id: "enter".to_string(),
            label: "Valider sans réponse".to_string(),
            keys: b"\r".to_vec(),
            variant: OptionVariant::Default,
        }],
        default_option: None,
        allow_free_text: true,
        confidence: 0.6,
        excerpt: last.to_string(),
        fingerprint: fingerprint(&["open", last]),
    })
}

/// Analyse la fin de l'écran. `min_confidence` filtre les détections trop incertaines.
pub fn detect(screen_lines: &[String], rules: &[Rule], min_confidence: f32) -> Option<Detection> {
    let lines = tail(screen_lines);
    if lines.is_empty() {
        return None;
    }

    // Une question attend en bas : on teste les 3 dernières lignes, de la plus basse à la plus haute.
    for line in lines.iter().rev().take(3) {
        for rule in rules {
            if let Some(found) = from_rule(rule, line) {
                if found.confidence >= min_confidence {
                    return Some(found);
                }
            }
        }
    }

    detect_menu(&lines)
        .or_else(|| detect_open_question(&lines))
        .filter(|found| found.confidence >= min_confidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::parser::rules;

    fn screen(text: &str) -> Vec<String> {
        text.lines().map(str::to_string).collect()
    }

    fn rules() -> Vec<Rule> {
        rules::load(None).unwrap()
    }

    #[test]
    fn fixture_yes_no_with_uppercase_default() {
        let found = detect(&screen("Installation de 3 paquets.\nContinuer ? [Y/n]: "), &rules(), 0.5).unwrap();
        assert_eq!(found.rule_id, "generic.yes_no");
        assert_eq!(found.title, "Continuer");
        assert_eq!(found.default_option.as_deref(), Some("yes"));
        assert_eq!(found.options[0].keys, b"y\r");
    }

    #[test]
    fn fixture_default_no() {
        let found = detect(&screen("Supprimer le dossier build (y/N)"), &rules(), 0.5).unwrap();
        assert_eq!(found.default_option.as_deref(), Some("no"));
        assert_eq!(found.options[1].variant, OptionVariant::Primary);
    }

    #[test]
    fn fixture_french_confirmation() {
        let found = detect(&screen("Écraser le fichier existant ? [o/N]"), &rules(), 0.5).unwrap();
        assert!(found.rule_id == "generic.oui_non" || found.rule_id == "generic.overwrite");
    }

    #[test]
    fn fixture_numbered_menu() {
        let found = detect(
            &screen("Do you want to make this edit to main.rs?\n❯ 1. Yes\n  2. Yes, and don't ask again\n  3. No, and tell Claude what to do"),
            &rules(),
            0.5,
        )
        .unwrap();
        assert_eq!(found.rule_id, "heuristic.menu");
        assert_eq!(found.title, "Do you want to make this edit to main.rs?");
        assert_eq!(found.options.len(), 3);
        assert_eq!(found.options[1].keys, b"2");
        assert_eq!(found.default_option.as_deref(), Some("option-1"));
    }

    #[test]
    fn fixture_arrow_menu() {
        let found = detect(
            &screen("Choisissez un modèle :\n  Rapide\n› Équilibré\n  Puissant"),
            &rules(),
            0.5,
        )
        .unwrap();
        assert_eq!(found.options.len(), 3);
        assert_eq!(found.default_option.as_deref(), Some("option-2"));
        assert_eq!(found.options[2].keys, b"\x1b[B\r");
        assert_eq!(found.options[0].keys, b"\x1b[A\r");
    }

    #[test]
    fn fixture_open_question() {
        let found = detect(&screen("Configuration du projet\nNom du projet :"), &rules(), 0.5).unwrap();
        assert_eq!(found.kind, PromptKind::FreeText);
        assert!(found.allow_free_text);
    }

    #[test]
    fn ignores_plain_output() {
        assert!(detect(&screen("Compilation terminée.\n3 fichiers modifiés."), &rules(), 0.5).is_none());
        assert!(detect(&screen("Nom du projet :"), &rules(), 0.7).is_none());
    }

    #[test]
    fn same_question_same_fingerprint() {
        let a = detect(&screen("x\nContinuer ? [Y/n]"), &rules(), 0.5).unwrap();
        let b = detect(&screen("autre sortie\nContinuer ? [Y/n]"), &rules(), 0.5).unwrap();
        assert_eq!(a.fingerprint, b.fingerprint);
    }
}
