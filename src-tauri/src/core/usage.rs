//! Registre de consommation des CLI (module « Crédits ») :
//! - `usage/ledger.jsonl` : une ligne par tour d'agent (tokens, coût, durée) ;
//! - `usage/limits.json`  : dernières fenêtres de limite connues par CLI.
//!
//! Écrit par le moteur, jamais bloquant pour la session (erreurs seulement loggées).

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::engine::event::RateWindow;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TurnRecord {
    /// Secondes Unix.
    pub at: i64,
    pub adapter: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub thinking_tokens: u64,
    pub cache_tokens: u64,
    pub cost_usd: Option<f64>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AdapterLimits {
    pub status: String,
    pub windows: Vec<RateWindow>,
    /// Moment de l'observation (secondes Unix).
    pub observed_at: i64,
}

pub fn init(dir: &Path) {
    let _ = std::fs::create_dir_all(dir);
    let _ = DIR.set(dir.to_path_buf());
}

pub fn dir() -> Option<&'static PathBuf> {
    DIR.get()
}

fn guard() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub fn record_turn(record: &TurnRecord) {
    let Some(dir) = DIR.get() else {
        return;
    };
    if let Err(error) = append_turn(dir, record) {
        tracing::warn!("usage: écriture impossible ({error})");
    }
}

fn append_turn(dir: &Path, record: &TurnRecord) -> std::io::Result<()> {
    let _guard = guard();
    let line = serde_json::to_string(record).map_err(std::io::Error::other)?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("ledger.jsonl"))?;
    writeln!(file, "{line}")
}

pub fn record_limits(adapter: &str, status: &str, windows: &[RateWindow]) {
    let Some(dir) = DIR.get() else {
        return;
    };
    if let Err(error) = write_limits(dir, adapter, status, windows) {
        tracing::warn!("usage: limites non enregistrées ({error})");
    }
}

fn write_limits(dir: &Path, adapter: &str, status: &str, windows: &[RateWindow]) -> std::io::Result<()> {
    let _guard = guard();
    let path = dir.join("limits.json");
    let mut all = read_limits_at(&path);
    all.insert(
        adapter.to_string(),
        AdapterLimits {
            status: status.to_string(),
            windows: windows.to_vec(),
            observed_at: chrono::Utc::now().timestamp(),
        },
    );
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_vec_pretty(&all).map_err(std::io::Error::other)?)?;
    std::fs::rename(temp, path)
}

fn read_limits_at(path: &Path) -> HashMap<String, AdapterLimits> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn read_limits(dir: &Path) -> HashMap<String, AdapterLimits> {
    read_limits_at(&dir.join("limits.json"))
}

/// Tours enregistrés depuis `since` (secondes Unix). Lignes illisibles ignorées.
pub fn read_turns(dir: &Path, since: i64) -> Vec<TurnRecord> {
    let Ok(raw) = std::fs::read_to_string(dir.join("ledger.jsonl")) else {
        return Vec::new();
    };
    raw.lines()
        .filter_map(|line| serde_json::from_str::<TurnRecord>(line).ok())
        .filter(|record| record.at >= since)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_turns_and_latest_limits() {
        let dir = std::env::temp_dir().join("archimed-usage-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let turn = |at: i64| TurnRecord {
            at,
            adapter: "claude".into(),
            model: "haiku".into(),
            input_tokens: 10,
            output_tokens: 5,
            thinking_tokens: 2,
            cache_tokens: 100,
            cost_usd: Some(0.01),
            duration_ms: Some(1200),
        };
        append_turn(&dir, &turn(100)).unwrap();
        append_turn(&dir, &turn(200)).unwrap();
        assert_eq!(read_turns(&dir, 150), vec![turn(200)]);

        let window = |u: f64| RateWindow { id: "five_hour".into(), utilization: u, resets_at: Some(1) };
        write_limits(&dir, "claude", "allowed", &[window(0.2)]).unwrap();
        write_limits(&dir, "claude", "allowed", &[window(0.4)]).unwrap();
        let limits = read_limits(&dir);
        assert_eq!(limits["claude"].windows[0].utilization, 0.4);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
