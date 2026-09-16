use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use super::error::{AppError, AppResult};

/// Réglages backend persistés dans `%APPDATA%\com.sdai.archimed\engine.json`.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EngineConfig {
    /// adaptateur → chemin d'un exécutable hors PATH (ex: Claude embarqué par Desktop).
    pub binary_overrides: HashMap<String, String>,
}

#[derive(Clone)]
pub struct ConfigStore {
    path: PathBuf,
    config: Arc<RwLock<EngineConfig>>,
}

impl ConfigStore {
    pub fn load(data_dir: &std::path::Path) -> Self {
        let path = data_dir.join("engine.json");
        let config = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<EngineConfig>(&raw).ok())
            .unwrap_or_default();

        Self {
            path,
            config: Arc::new(RwLock::new(config)),
        }
    }

    pub async fn snapshot(&self) -> EngineConfig {
        self.config.read().await.clone()
    }

    /// Définit (ou efface, avec `None`) le chemin d'un binaire pour un adaptateur.
    pub async fn set_binary_override(&self, adapter: &str, path: Option<String>) -> AppResult<()> {
        {
            let mut config = self.config.write().await;
            match path {
                Some(value) => {
                    let candidate = PathBuf::from(&value);
                    if !candidate.is_file() {
                        return Err(AppError::invalid(format!("fichier introuvable : {value}")));
                    }
                    config.binary_overrides.insert(adapter.to_string(), value);
                }
                None => {
                    config.binary_overrides.remove(adapter);
                }
            }
        }
        self.persist().await
    }

    async fn persist(&self) -> AppResult<()> {
        let config = self.config.read().await.clone();
        let raw = serde_json::to_string_pretty(&config)?;
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.path, raw)?;
        Ok(())
    }
}
