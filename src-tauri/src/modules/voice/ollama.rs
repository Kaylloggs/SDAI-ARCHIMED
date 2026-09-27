//! Modèle de langage local via Ollama (`http://127.0.0.1:11434`) : état, téléchargement de
//! modèles (Ollama vérifie lui-même l'empreinte de chaque couche) et réponses en direct.
//! Rien n'est installé par ARCHIMED : Ollama s'installe à part (ollama.com).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::cloud::{read_json, with_json};
use super::types::LocalServerStatus;

pub const DEFAULT_URL: &str = "http://127.0.0.1:11434";

fn unreachable() -> AppError {
    AppError::new(
        AppErrorCode::Network,
        "Ollama ne répond pas : installez-le (ollama.com) puis lancez-le, ou choisissez un autre modèle.",
    )
}

pub async fn status(http: &reqwest::Client) -> LocalServerStatus {
    let version = http
        .get(format!("{DEFAULT_URL}/api/version"))
        .timeout(Duration::from_secs(2))
        .send()
        .await
        .ok()
        .filter(|r| r.status().is_success());
    let Some(version) = version else {
        return LocalServerStatus { running: false, url: DEFAULT_URL.to_string(), version: None, models: Vec::new() };
    };
    let version = read_json(version).await.ok().and_then(|v| v["version"].as_str().map(str::to_string));
    let models = match http.get(format!("{DEFAULT_URL}/api/tags")).timeout(Duration::from_secs(3)).send().await {
        Ok(response) => read_json(response)
            .await
            .ok()
            .and_then(|v| v["models"].as_array().cloned())
            .unwrap_or_default()
            .iter()
            .filter_map(|m| m["name"].as_str().map(str::to_string))
            .collect(),
        Err(_) => Vec::new(),
    };
    LocalServerStatus { running: true, url: DEFAULT_URL.to_string(), version, models }
}

/// Un modèle installé porte le nom exact (`qwen2.5:3b`) ou son alias `:latest`.
pub fn has_model(models: &[String], tag: &str) -> bool {
    models.iter().any(|m| m == tag || (!tag.contains(':') && m == &format!("{tag}:latest")))
}

/// Lignes JSON complètes d'un flux (`\n` final exclu), le reste gardé pour la suite.
pub fn take_lines(buffer: &mut Vec<u8>) -> Vec<Value> {
    let mut lines = Vec::new();
    while let Some(pos) = buffer.iter().position(|b| *b == b'\n') {
        let line: Vec<u8> = buffer.drain(..=pos).collect();
        if let Ok(value) = serde_json::from_slice::<Value>(&line[..line.len() - 1]) {
            lines.push(value);
        }
    }
    lines
}

pub enum PullOutcome {
    Done,
    Cancelled,
}

/// Télécharge un modèle (`ollama pull`), avancement en octets.
pub async fn pull(
    http: &reqwest::Client,
    tag: &str,
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64, u64, &str),
) -> AppResult<PullOutcome> {
    let mut response = with_json(http.post(format!("{DEFAULT_URL}/api/pull")), &json!({ "model": tag, "stream": true }))
        .send()
        .await
        .map_err(|_| unreachable())?;
    if !response.status().is_success() {
        return Err(AppError::new(AppErrorCode::Network, format!("Ollama refuse le téléchargement ({}).", response.status())));
    }
    let mut buffer = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unreachable())? {
        if cancel.load(Ordering::Relaxed) {
            return Ok(PullOutcome::Cancelled);
        }
        buffer.extend_from_slice(&chunk);
        for line in take_lines(&mut buffer) {
            if let Some(error) = line["error"].as_str() {
                return Err(AppError::new(AppErrorCode::Network, format!("Ollama : {error}")));
            }
            let status = line["status"].as_str().unwrap_or("");
            progress(line["completed"].as_u64().unwrap_or(0), line["total"].as_u64().unwrap_or(0), status);
            if status == "success" {
                return Ok(PullOutcome::Done);
            }
        }
    }
    Ok(PullOutcome::Done)
}

pub async fn delete(http: &reqwest::Client, tag: &str) -> AppResult<()> {
    let response = with_json(http.delete(format!("{DEFAULT_URL}/api/delete")), &json!({ "model": tag }))
        .send()
        .await
        .map_err(|_| unreachable())?;
    if response.status().is_success() || response.status() == reqwest::StatusCode::NOT_FOUND {
        Ok(())
    } else {
        Err(AppError::new(AppErrorCode::Network, format!("Ollama n'a pas supprimé le modèle ({}).", response.status())))
    }
}

/// Réponse en direct : `on_delta` reçoit chaque morceau de texte.
pub async fn chat(
    http: &reqwest::Client,
    model: &str,
    messages: &[Value],
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str),
) -> AppResult<()> {
    let body = json!({ "model": model, "messages": messages, "stream": true, "keep_alive": "10m" });
    let mut response = with_json(http.post(format!("{DEFAULT_URL}/api/chat")), &body)
        .send()
        .await
        .map_err(|_| unreachable())?;
    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(AppError::new(AppErrorCode::Network, format!("Ollama : {}", detail.trim())));
    }
    let mut buffer = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| unreachable())? {
        if cancel.load(Ordering::Relaxed) {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk);
        for line in take_lines(&mut buffer) {
            if let Some(error) = line["error"].as_str() {
                return Err(AppError::new(AppErrorCode::Network, format!("Ollama : {error}")));
            }
            if let Some(text) = line["message"]["content"].as_str() {
                if !text.is_empty() {
                    on_delta(text);
                }
            }
            if line["done"].as_bool() == Some(true) {
                return Ok(());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_lines_are_split_across_chunks() {
        let mut buffer = b"{\"status\":\"pulling\",\"completed\":5,\"total\":10}\n{\"sta".to_vec();
        let lines = take_lines(&mut buffer);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["completed"], 5);
        buffer.extend_from_slice(b"tus\":\"success\"}\n");
        let lines = take_lines(&mut buffer);
        assert_eq!(lines[0]["status"], "success");
        assert!(buffer.is_empty());
    }

    #[test]
    fn installed_models_match_tags_and_latest() {
        let models = vec!["qwen2.5:3b".to_string(), "llama3.2:latest".to_string()];
        assert!(has_model(&models, "qwen2.5:3b"));
        assert!(has_model(&models, "llama3.2"));
        assert!(!has_model(&models, "qwen2.5:7b"));
    }
}
