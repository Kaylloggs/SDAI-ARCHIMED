//! Historique des actions moteur d'un projet (`<projet>/.gamestudio/builds/`) : une entrée
//! par vérification, test ou build, et son journal complet (`<id>.log`).

use std::path::{Path, PathBuf};

use super::store::{state_dir, write_atomic};
use super::types::{GameBuildRecord, GameBuildStatus};

/// Exécutions gardées dans l'historique.
pub const MAX_RECORDS: usize = 40;

pub fn dir(root: &Path) -> PathBuf {
    state_dir(root).join("builds")
}

pub fn history(root: &Path) -> Vec<GameBuildRecord> {
    std::fs::read_to_string(dir(root).join("history.json"))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn log_path(root: &Path, id: &str) -> PathBuf {
    dir(root).join(format!("{id}.log"))
}

/// Enregistre une exécution et son journal ; les plus anciennes sont retirées.
pub fn save(root: &Path, record: &GameBuildRecord, log: &[String]) {
    let mut records = history(root);
    records.retain(|r| r.id != record.id);
    records.push(record.clone());
    if records.len() > MAX_RECORDS {
        let excess = records.len() - MAX_RECORDS;
        for old in records.drain(..excess) {
            let _ = std::fs::remove_file(log_path(root, &old.id));
        }
    }
    if let Ok(body) = serde_json::to_string_pretty(&records) {
        if let Err(e) = write_atomic(&dir(root).join("history.json"), body.as_bytes()) {
            tracing::warn!("historique des builds non enregistré : {}", e.message);
        }
    }
    let mut text = log.join("\n");
    text.push('\n');
    let _ = write_atomic(&log_path(root, &record.id), text.as_bytes());
}

/// État de la dernière exécution terminée.
pub fn last_status(root: &Path) -> Option<GameBuildStatus> {
    history(root).last().map(|r| r.status)
}
