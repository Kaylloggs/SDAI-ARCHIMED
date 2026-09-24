//! Moteur de recherche : un environnement Python isolé, déposé et entretenu par ARCHIMED.
//!
//! Les fichiers du moteur voyagent dans l'exécutable (`assets.rs`). Au premier usage, ils
//! sont écrits dans le dossier de données du module, puis un environnement virtuel y est
//! créé avec ses dépendances. Rien n'est installé dans le Python du système.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::core::{AppError, AppResult};

use super::assets;

/// Lignes de l'installation (sortie de `pip`), pour l'afficher en direct.
pub const INSTALL_LOG: &str = "jobagent:install";
/// Avancement d'une recherche.
pub const SEARCH_PROGRESS: &str = "jobagent:progress";

/// Noms sous lesquels Python peut se présenter sur la machine.
const PYTHON_NAMES: &[&str] = &["python", "python3", "py"];

#[derive(Debug, Serialize, Deserialize)]
pub struct EngineStatus {
    /// Le moteur est déposé et son environnement est prêt.
    pub ready: bool,
    /// Python du système, `None` s'il n'est pas installé.
    pub python: Option<String>,
    pub python_version: Option<String>,
    /// Dépendances manquantes (l'installation n'a pas été faite ou a échoué).
    pub missing: Vec<String>,
    /// La bibliothèque du serveur MCP est installée.
    pub mcp: bool,
    /// Les outils de recherche sont branchés sur les agents d'ARCHIMED.
    pub mcp_enabled: bool,
    pub home: String,
}

pub struct Engine {
    /// Dossier de données du module (`…/modules/jobagent`).
    home: PathBuf,
    /// Recherche en cours, pour pouvoir l'interrompre.
    running: Mutex<Option<u32>>,
}

impl Engine {
    pub fn new(home: PathBuf) -> AppResult<Self> {
        std::fs::create_dir_all(&home)?;
        Ok(Self {
            home,
            running: Mutex::new(None),
        })
    }

    fn engine_dir(&self) -> PathBuf {
        self.home.join("engine")
    }

    fn venv_python(&self) -> PathBuf {
        let venv = self.engine_dir().join(".venv");
        if cfg!(windows) {
            venv.join("Scripts").join("python.exe")
        } else {
            venv.join("bin").join("python")
        }
    }

    /// Écrit les fichiers du moteur si leur version a changé depuis le dernier dépôt.
    pub fn deploy(&self) -> AppResult<()> {
        let dir = self.engine_dir();
        let stamp = dir.join(".version");
        let current = assets::fingerprint().to_string();
        if std::fs::read_to_string(&stamp).ok().as_deref() == Some(current.as_str()) {
            return Ok(());
        }
        for (relative, body) in assets::FILES {
            let target = dir.join(relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::write(target, body)?;
        }
        std::fs::write(stamp, current)?;
        Ok(())
    }

    /// Python du système : celui qui servira à créer l'environnement virtuel.
    pub fn system_python(&self) -> Option<PathBuf> {
        PYTHON_NAMES
            .iter()
            .filter_map(|name| which::which(name).ok())
            // `py` sans argument lance le lanceur Windows : accepté, il sait créer un venv.
            .find(|path| path.exists())
    }

    pub async fn status(&self) -> EngineStatus {
        // Une mise à jour d'ARCHIMED apporte un moteur plus récent : il se dépose tout seul,
        // sans repasser par le bouton d'installation.
        if let Err(error) = self.deploy() {
            tracing::warn!("dépôt du moteur JobAgent impossible : {error}");
        }
        let python = self.system_python();
        let venv = self.venv_python();
        let mut status = EngineStatus {
            ready: false,
            python: python.as_ref().map(|p| p.display().to_string()),
            python_version: None,
            missing: Vec::new(),
            mcp: false,
            mcp_enabled: false,
            home: self.home.display().to_string(),
        };
        if !venv.exists() {
            status.missing.push("environnement Python".to_string());
            return status;
        }
        // `doctor` répond en une ligne JSON : version, dépendances manquantes, MCP.
        match self.cli(&["doctor"], None, |_| {}).await {
            Ok(value) => {
                status.python_version = value
                    .get("python")
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                status.missing = value
                    .get("missing")
                    .and_then(|v| v.as_array())
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| item.as_str().map(str::to_string))
                            .collect()
                    })
                    .unwrap_or_default();
                status.mcp = value.get("mcp").and_then(|v| v.as_bool()).unwrap_or(false);
                status.ready = status.missing.is_empty();
            }
            Err(error) => status.missing.push(error.to_string()),
        }
        status
    }

    /// Dépose le moteur, crée l'environnement virtuel et installe les dépendances.
    /// Chaque ligne de sortie part vers l'interface : l'installation dure une minute ou deux.
    pub async fn install<R: Runtime>(&self, app: AppHandle<R>) -> AppResult<EngineStatus> {
        self.deploy()?;
        let python = self
            .system_python()
            .ok_or_else(|| AppError::invalid(
                "Python 3.10 ou plus récent est nécessaire. Installez-le depuis python.org, puis relancez l'installation.",
            ))?;

        let log = |line: String| {
            let _ = app.emit(INSTALL_LOG, line);
        };
        log("Préparation de l'environnement Python…".to_string());

        let venv = self.engine_dir().join(".venv");
        if !self.venv_python().exists() {
            self.spawn(&python, &["-m", "venv", &venv.display().to_string()], &log)
                .await?;
        }

        let requirements = self.engine_dir().join("requirements.txt");
        log("Installation des dépendances (une à deux minutes)…".to_string());
        self.spawn(
            &self.venv_python(),
            &["-m", "pip", "install", "--disable-pip-version-check", "-r", &requirements.display().to_string()],
            &log,
        )
        .await?;

        log("Vérification…".to_string());
        let status = self.status().await;
        log(if status.ready {
            "Moteur prêt.".to_string()
        } else {
            format!("Installation incomplète : {}", status.missing.join(", "))
        });
        Ok(status)
    }

    /// Lance le moteur et renvoie sa dernière ligne (`{"event":"done", …}`).
    /// `on_progress` reçoit les lignes intermédiaires.
    pub async fn cli(
        &self,
        args: &[&str],
        stdin_payload: Option<String>,
        on_progress: impl Fn(serde_json::Value),
    ) -> AppResult<serde_json::Value> {
        let python = self.venv_python();
        if !python.exists() {
            return Err(AppError::invalid(
                "Moteur de recherche non installé : ouvrez le module JobAgent et lancez l'installation.",
            ));
        }
        let mut command = crate::core::process::async_command(&python);
        command
            .current_dir(self.engine_dir())
            .arg("-m")
            .arg("archimed_jobagent.cli")
            .args(args)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1")
            .env("ARCHIMED_JOBAGENT_HOME", &self.home)
            .stdin(if stdin_payload.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = command.spawn()?;
        if let Some(id) = child.id() {
            if let Ok(mut running) = self.running.lock() {
                *running = Some(id);
            }
        }
        if let (Some(payload), Some(mut stdin)) = (stdin_payload, child.stdin.take()) {
            stdin.write_all(payload.as_bytes()).await?;
            stdin.shutdown().await?;
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("sortie du moteur illisible"))?;
        let mut lines = BufReader::new(stdout).lines();
        let mut last = None;
        let mut failure = None;
        while let Some(line) = lines.next_line().await? {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue; // journaux des scrapers : ils ne sont pas en JSON
            };
            match value.get("event").and_then(|v| v.as_str()) {
                Some("done") => last = Some(value),
                Some("error") => {
                    failure = value
                        .get("message")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                }
                _ => on_progress(value),
            }
        }
        let _ = child.wait().await;
        if let Ok(mut running) = self.running.lock() {
            *running = None;
        }

        if let Some(message) = failure {
            return Err(AppError::internal(message));
        }
        last.ok_or_else(|| AppError::internal("le moteur n'a rien renvoyé"))
    }

    /// Interrompt la recherche en cours.
    pub fn cancel(&self) {
        let pid = self.running.lock().ok().and_then(|mut slot| slot.take());
        let Some(pid) = pid else { return };
        #[cfg(windows)]
        {
            let _ = crate::core::process::command("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .output();
        }
        #[cfg(not(windows))]
        {
            let _ = crate::core::process::command("kill")
                .arg(pid.to_string())
                .output();
        }
    }

    /// Exécute une commande en renvoyant chaque ligne à l'interface.
    async fn spawn(
        &self,
        program: &Path,
        args: &[&str],
        log: &impl Fn(String),
    ) -> AppResult<()> {
        let mut child = crate::core::process::async_command(program)
            .args(args)
            .current_dir(self.engine_dir())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        if let Some(stdout) = child.stdout.take() {
            let mut lines = BufReader::new(stdout).lines();
            while let Some(line) = lines.next_line().await? {
                log(line);
            }
        }
        let mut errors = String::new();
        if let Some(stderr) = child.stderr.take() {
            let mut lines = BufReader::new(stderr).lines();
            while let Some(line) = lines.next_line().await? {
                errors.push_str(&line);
                errors.push('\n');
                log(line);
            }
        }
        let status = child.wait().await?;
        if !status.success() {
            return Err(AppError::internal(format!(
                "échec de {} : {}",
                program.display(),
                errors.lines().last().unwrap_or("voir le journal")
            )));
        }
        Ok(())
    }

    /// Fichier de configuration MCP à donner au CLI Claude (`claude --mcp-config …`).
    pub fn mcp_config(&self) -> serde_json::Value {
        serde_json::json!({
            "mcpServers": {
                "archimed-jobagent": {
                    "command": self.venv_python().display().to_string(),
                    "args": ["-m", "archimed_jobagent.server"],
                    "cwd": self.engine_dir().display().to_string(),
                    "env": {
                        "ARCHIMED_JOBAGENT_HOME": self.home.display().to_string(),
                        "PYTHONUTF8": "1"
                    }
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_files_travel_with_the_binary() {
        let names: Vec<&str> = assets::FILES.iter().map(|(path, _)| *path).collect();
        for expected in [
            "requirements.txt",
            "archimed_jobagent/search.py",
            "archimed_jobagent/server.py",
            "jobspy/hellowork/__init__.py",
            "jobspy/wttj/__init__.py",
            "LICENSE.jobspy",
        ] {
            assert!(names.contains(&expected), "fichier absent du moteur : {expected}");
        }
        assert!(assets::FILES.iter().all(|(_, body)| !body.is_empty()));
    }

    #[test]
    fn deploy_writes_the_engine_once() {
        let home = std::env::temp_dir().join(format!("archimed-jobagent-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        let engine = Engine::new(home.clone()).expect("moteur");

        engine.deploy().expect("dépôt");
        let search = home.join("engine/archimed_jobagent/search.py");
        assert!(search.exists());

        // Deuxième dépôt : l'empreinte est la même, le fichier n'est pas réécrit.
        let stamp = std::fs::metadata(home.join("engine/.version")).unwrap();
        engine.deploy().expect("second dépôt");
        let again = std::fs::metadata(home.join("engine/.version")).unwrap();
        assert_eq!(stamp.modified().ok(), again.modified().ok());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn mcp_config_points_at_the_local_server() {
        let home = std::env::temp_dir().join("archimed-jobagent-mcp");
        let engine = Engine::new(home).expect("moteur");
        let config = engine.mcp_config();
        let server = &config["mcpServers"]["archimed-jobagent"];
        assert_eq!(server["args"][1], "archimed_jobagent.server");
        assert!(server["command"].as_str().unwrap().ends_with("python.exe")
            || server["command"].as_str().unwrap().ends_with("python"));
        assert!(server["env"]["ARCHIMED_JOBAGENT_HOME"].is_string());
    }
}
