//! Journal d'audit (guidelines.md §11.3) : une ligne JSON par action à effet de bord,
//! dans `%APPDATA%\com.sdai.archimed\logs\audit.jsonl`.
//! L'écriture ne doit jamais faire échouer l'action auditée : erreurs ignorées (loggées).

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

static AUDIT_FILE: OnceLock<PathBuf> = OnceLock::new();
static WRITE_LOCK: Mutex<()> = Mutex::new(());

/// Taille au-delà de laquelle le journal est archivé (`audit.1.jsonl`).
const MAX_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize)]
struct Entry<'a> {
    at: String,
    action: &'a str,
    target: &'a str,
    outcome: &'a str,
    by: &'a str,
}

pub fn init(logs_dir: &Path) {
    let _ = AUDIT_FILE.set(logs_dir.join("audit.jsonl"));
}

/// `by` : "user" | "auto" | "policy".
pub fn record(action: &str, target: &str, outcome: &str, by: &str) {
    let Some(path) = AUDIT_FILE.get() else {
        return;
    };
    if let Err(error) = append(path, action, target, outcome, by) {
        tracing::warn!("audit: écriture impossible ({error})");
    }
}

fn append(path: &Path, action: &str, target: &str, outcome: &str, by: &str) -> std::io::Result<()> {
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    if let Ok(metadata) = std::fs::metadata(path) {
        if metadata.len() > MAX_BYTES {
            let _ = std::fs::rename(path, path.with_file_name("audit.1.jsonl"));
        }
    }

    // Tronque les cibles très longues (commandes, contenus) pour garder un journal lisible.
    let target: String = target.chars().take(500).collect();
    let entry = Entry {
        at: chrono::Utc::now().to_rfc3339(),
        action,
        target: &target,
        outcome,
        by,
    };
    let line = serde_json::to_string(&entry).map_err(std::io::Error::other)?;

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_json_lines() {
        let dir = std::env::temp_dir().join("archimed-audit-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("audit.jsonl");

        append(&path, "code.write_file", "C:/a.txt", "ok", "user").unwrap();
        append(&path, "engine.permission", "Bash rm -rf", "deny", "policy").unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["action"], "code.write_file");
        assert_eq!(first["by"], "user");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
