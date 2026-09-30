//! Journal structuré d'un projet (§78) : `<projet>/.gamestudio/logs/journal.jsonl`, une ligne
//! JSON par événement, catégorisée. Les secrets (clés d'API, jetons) sont masqués avant
//! l'écriture (§114) ; le fichier tourne à 5 Mo.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;

use super::types::{GameLogCategory, GameLogEntry, GameLogLevel};

const MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn path(root: &Path) -> PathBuf {
    root.join(".gamestudio").join("logs").join("journal.jsonl")
}

/// Secrets remplacés en entier.
fn full_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)\bsk-or-v1-[a-f0-9]{16,}",
            r"(?i)\b(?:sk|pk|rk)-[a-z0-9_\-]{16,}",
            r"\bAIza[0-9A-Za-z_\-]{20,}",
            r"\bgh[pousr]_[A-Za-z0-9]{20,}",
        ]
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect()
    })
}

/// Secrets précédés d'un libellé gardé (« Bearer », « api_key= »).
fn prefixed_patterns() -> &'static [Regex] {
    static PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            r"(?i)(bearer\s+)[A-Za-z0-9._\-]{16,}",
            r#"(?i)((?:api[_-]?key|token|secret|password|mot de passe)\s*[:=]\s*)["']?[^\s"',]{6,}"#,
        ]
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect()
    })
}

/// Masque ce qui ressemble à un secret.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for re in full_patterns() {
        out = re.replace_all(&out, "•••").to_string();
    }
    for re in prefixed_patterns() {
        out = re.replace_all(&out, "${1}•••").to_string();
    }
    out
}

/// Ajoute une entrée (erreurs d'écriture ignorées : le journal ne bloque jamais le travail).
pub fn log(
    root: &Path,
    category: GameLogCategory,
    level: GameLogLevel,
    message: &str,
    detail: Option<&str>,
) {
    let file = path(root);
    if let Some(parent) = file.parent() {
        if std::fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if file
        .metadata()
        .map(|m| m.len() > MAX_BYTES)
        .unwrap_or(false)
    {
        let _ = std::fs::rename(&file, file.with_extension("jsonl.1"));
    }
    let entry = GameLogEntry {
        at: chrono::Utc::now().to_rfc3339(),
        category,
        level,
        message: redact(message),
        detail: detail.map(|d| redact(&d.chars().take(8_000).collect::<String>())),
    };
    if let Ok(line) = serde_json::to_string(&entry) {
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file)
        {
            let _ = writeln!(f, "{line}");
        }
    }
}

pub fn info(root: &Path, category: GameLogCategory, message: &str) {
    log(root, category, GameLogLevel::Info, message, None);
}

/// Dernières entrées (les plus récentes d'abord), filtrées par catégorie.
pub fn read(root: &Path, category: Option<GameLogCategory>, limit: usize) -> Vec<GameLogEntry> {
    let Ok(raw) = std::fs::read_to_string(path(root)) else {
        return Vec::new();
    };
    raw.lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<GameLogEntry>(l).ok())
        .filter(|e| {
            category.is_none_or(|c| {
                c == e.category || (c == GameLogCategory::Error && e.level == GameLogLevel::Error)
            })
        })
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secrets_never_reach_the_file() {
        assert_eq!(redact("clé sk-or-v1-0123456789abcdef0123"), "clé •••");
        assert_eq!(
            redact("Authorization: Bearer abcdefghijklmnopqrstuvwxyz"),
            "Authorization: Bearer •••"
        );
        assert_eq!(redact("api_key=\"AZERTYUIOP123\""), "api_key=•••\"");
        assert_eq!(redact("rien de secret ici"), "rien de secret ici");
    }

    #[test]
    fn writes_and_reads_back_entries() {
        let root = std::env::temp_dir().join(format!("gs-journal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        info(&root, GameLogCategory::Build, "Build lancé");
        log(
            &root,
            GameLogCategory::Engine,
            GameLogLevel::Error,
            "Godot a échoué",
            Some("token=secretvalue123"),
        );
        let all = read(&root, None, 10);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].message, "Godot a échoué");
        assert!(!all[0]
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("secretvalue"));
        assert_eq!(read(&root, Some(GameLogCategory::Build), 10).len(), 1);
        assert_eq!(read(&root, Some(GameLogCategory::Error), 10).len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
