use std::collections::BTreeMap;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::core::usage::{self, AdapterLimits, TurnRecord};
use crate::core::{AppError, AppResult};
use crate::engine::adapters::{claude::ClaudeAdapter, CliAdapter, DecodeCtx};
use crate::engine::event::{AutoMode, EngineEvent, LaunchOptions};

#[derive(Debug, Default, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub turns: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub thinking_tokens: u64,
    pub cache_tokens: u64,
    pub cost_usd: f64,
    pub duration_ms: u64,
}

impl Totals {
    fn add(&mut self, turn: &TurnRecord) {
        self.turns += 1;
        self.input_tokens += turn.input_tokens;
        self.output_tokens += turn.output_tokens;
        self.thinking_tokens += turn.thinking_tokens;
        self.cache_tokens += turn.cache_tokens;
        self.cost_usd += turn.cost_usd.unwrap_or(0.0);
        self.duration_ms += turn.duration_ms.unwrap_or(0);
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTotals {
    /// `AAAA-MM-JJ` (heure locale).
    pub day: String,
    pub totals: Totals,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub since: i64,
    pub by_adapter: BTreeMap<String, Totals>,
    pub by_day: Vec<DayTotals>,
    pub recent: Vec<TurnRecord>,
    pub limits: std::collections::HashMap<String, AdapterLimits>,
}

pub fn summarize(dir: &Path, days: u32, now: i64) -> UsageSummary {
    let since = now - i64::from(days.max(1)) * 86_400;
    let turns = usage::read_turns(dir, since);

    let mut by_adapter: BTreeMap<String, Totals> = BTreeMap::new();
    let mut by_day: BTreeMap<String, Totals> = BTreeMap::new();
    for turn in &turns {
        by_adapter.entry(turn.adapter.clone()).or_default().add(turn);
        let day = chrono::DateTime::from_timestamp(turn.at, 0)
            .map(|utc| utc.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        by_day.entry(day).or_default().add(turn);
    }

    let mut recent = turns;
    recent.sort_by_key(|turn| std::cmp::Reverse(turn.at));
    recent.truncate(30);

    UsageSummary {
        since,
        by_adapter,
        by_day: by_day
            .into_iter()
            .rev()
            .map(|(day, totals)| DayTotals { day, totals })
            .collect(),
        recent,
        limits: usage::read_limits(dir),
    }
}

/// `claude auth status --json` : abonnement et compte (sans jeton).
pub async fn claude_account(binary: &Path) -> AppResult<serde_json::Value> {
    let output = crate::core::process::async_command(binary)
        .args(["auth", "status", "--json"])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|e| AppError::internal(format!("claude auth status : {e}")))?;
    serde_json::from_slice(&output.stdout)
        .map_err(|e| AppError::internal(format!("réponse de claude auth status illisible : {e}")))
}

/// Envoie un message minimal (modèle le plus léger) pour obtenir les fenêtres de limite
/// à jour : Claude ne les communique qu'au fil d'une requête. Consomme quelques tokens.
pub async fn refresh_claude_limits(binary: &Path) -> AppResult<AdapterLimits> {
    let mut adapter = ClaudeAdapter::default();
    let args = adapter.spawn_args(LaunchOptions {
        model: Some("haiku"),
        resume: None,
        auto_mode: AutoMode::Off,
    });

    let mut child = crate::core::process::async_command(binary)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| AppError::internal(format!("lancement de claude : {e}")))?;

    let mut stdin = child.stdin.take().ok_or_else(|| AppError::internal("stdin indisponible"))?;
    let stdout = child.stdout.take().ok_or_else(|| AppError::internal("stdout indisponible"))?;
    let message = adapter.encode_user_message("Réponds uniquement : ok");
    stdin.write_all(format!("{message}\n").as_bytes()).await?;
    stdin.flush().await?;

    let ctx = DecodeCtx {
        session_id: "usage-probe",
        auto_mode: AutoMode::Off,
    };
    let read = async {
        let mut lines = BufReader::new(stdout).lines();
        let mut limits = None;
        while let Ok(Some(line)) = lines.next_line().await {
            for event in adapter.decode_line(&line, &ctx) {
                match event {
                    EngineEvent::RateLimit { status, windows } => {
                        usage::record_limits("claude", &status, &windows);
                        limits = Some(AdapterLimits {
                            status,
                            windows,
                            observed_at: chrono::Utc::now().timestamp(),
                        });
                    }
                    EngineEvent::TurnCompleted { .. } => return limits,
                    _ => {}
                }
            }
        }
        limits
    };

    let result = tokio::time::timeout(Duration::from_secs(90), read).await;
    drop(stdin);
    let _ = child.kill().await;

    match result {
        Ok(Some(limits)) => Ok(limits),
        Ok(None) => Err(AppError::internal(
            "Claude n'a pas communiqué de limites (compte API sans abonnement ?)",
        )),
        Err(_) => Err(AppError::internal("délai dépassé en interrogeant Claude")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Appel réel à Claude (consomme quelques tokens) : `cargo test probe_real_claude -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn probe_real_claude() {
        let binary = crate::engine::adapters::resolve_binary(&ClaudeAdapter::default(), &Default::default())
            .expect("Claude Code installé");
        let limits = refresh_claude_limits(&binary).await.expect("limites reçues");
        eprintln!("LIMITES {limits:?}");
        assert!(!limits.windows.is_empty());
        let account = claude_account(&binary).await.expect("compte lisible");
        eprintln!("ABONNEMENT {}", account["subscriptionType"]);
    }

    #[test]
    fn summarizes_by_adapter_and_day() {
        let dir = std::env::temp_dir().join("archimed-usage-summary-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let now = 1_789_600_000;
        let ledger = [
            (now - 100, "claude", 10, 0.02),
            (now - 200, "antigravity", 30, 0.0),
            (now - 3 * 86_400, "claude", 99, 1.0), // hors fenêtre d'un jour
        ]
        .iter()
        .map(|(at, adapter, output, cost)| {
            serde_json::to_string(&TurnRecord {
                at: *at,
                adapter: (*adapter).into(),
                model: "m".into(),
                input_tokens: 1,
                output_tokens: *output,
                thinking_tokens: 0,
                cache_tokens: 0,
                cost_usd: Some(*cost),
                duration_ms: Some(1000),
            })
            .unwrap()
        })
        .collect::<Vec<_>>()
        .join("\n");
        std::fs::write(dir.join("ledger.jsonl"), ledger).unwrap();

        let summary = summarize(&dir, 1, now);
        assert_eq!(summary.by_adapter["claude"].output_tokens, 10);
        assert_eq!(summary.by_adapter["antigravity"].turns, 1);
        assert_eq!(summary.recent.len(), 2);
        assert_eq!(summary.recent[0].adapter, "claude");

        let week = summarize(&dir, 7, now);
        assert_eq!(week.by_adapter["claude"].turns, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
