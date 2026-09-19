use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use super::error::{AppError, AppResult};

/// Dossiers de données de l'application (voir architecture.md §11).
pub struct Paths {
    pub data: PathBuf,
}

impl Paths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> AppResult<Self> {
        let data = app
            .path()
            .app_data_dir()
            .map_err(|e| AppError::internal(format!("app_data_dir: {e}")))?;
        std::fs::create_dir_all(&data)?;
        Ok(Self { data })
    }

    pub fn skills(&self) -> PathBuf {
        self.data.join("skills")
    }

    pub fn sessions(&self) -> PathBuf {
        self.data.join("sessions")
    }

    pub fn logs(&self) -> PathBuf {
        self.data.join("logs")
    }

    /// Consommation des CLI (registre et limites).
    pub fn usage(&self) -> PathBuf {
        self.data.join("usage")
    }

    /// Adaptateurs de CLI déclarés en TOML par l'utilisateur.
    pub fn adapters(&self) -> PathBuf {
        self.data.join("adapters")
    }

    /// Serveurs MCP déclarés par les modules (voir `core::mcp`).
    pub fn mcp(&self) -> PathBuf {
        self.data.join("mcp")
    }

    pub fn module_dir(&self, module_id: &str) -> PathBuf {
        self.data.join("modules").join(module_id)
    }

    pub fn ensure_all(&self) -> AppResult<()> {
        for dir in [self.skills(), self.sessions(), self.logs()] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }
}

/// Dossier de skills d'une CLI installée (cibles de synchronisation).
pub fn cli_skills_dir(cli: &str) -> Option<PathBuf> {
    let home = dirs_home()?;
    match cli {
        "claude" => Some(home.join(".claude").join("skills")),
        "antigravity" => Some(home.join(".gemini").join("antigravity-cli").join("skills")),
        _ => None,
    }
}

pub fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}
