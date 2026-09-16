use tauri::State;

use crate::core::config::ConfigStore;
use crate::core::usage::AdapterLimits;
use crate::core::{AppError, AppResult};
use crate::engine::adapters::{self, claude::ClaudeAdapter};

use super::service::{self, UsageSummary};

fn usage_dir() -> AppResult<&'static std::path::PathBuf> {
    crate::core::usage::dir().ok_or_else(|| AppError::internal("registre de consommation non initialisé"))
}

async fn claude_binary(config: &ConfigStore) -> AppResult<std::path::PathBuf> {
    let overrides = config.snapshot().await.binary_overrides;
    adapters::resolve_binary(&ClaudeAdapter::default(), &overrides)
        .ok_or_else(|| AppError::cli_missing("Claude Code introuvable"))
}

#[tauri::command]
pub async fn summary(days: Option<u32>) -> AppResult<UsageSummary> {
    let dir = usage_dir()?;
    let days = days.unwrap_or(7);
    tokio::task::spawn_blocking(move || service::summarize(dir, days, chrono::Utc::now().timestamp()))
        .await
        .map_err(|e| AppError::internal(e.to_string()))
}

#[tauri::command]
pub async fn claude_account(config: State<'_, ConfigStore>) -> AppResult<serde_json::Value> {
    let binary = claude_binary(&config).await?;
    service::claude_account(&binary).await
}

#[tauri::command]
pub async fn refresh_claude_limits(config: State<'_, ConfigStore>) -> AppResult<AdapterLimits> {
    let binary = claude_binary(&config).await?;
    service::refresh_claude_limits(&binary).await
}
