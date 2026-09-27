//! Installation en un clic de ce que la voix propose : Ollama, Voicebox, Claude Code, Codex.
//!
//! Chaque installation passe par la voie officielle et vérifiable :
//! - `winget` (Windows) : paquets du dépôt Microsoft, empreinte vérifiée par winget ;
//! - releases GitHub : l'installeur n'est lancé que si son empreinte SHA-256 correspond à celle
//!   publiée par GitHub ;
//! - scripts officiels de l'éditeur (Claude Code) ou `npm` (Codex).
//!
//! Rien n'est installé sans un clic de la personne. La connexion aux agents se fait dans une
//! fenêtre de terminal ouverte pour elle : ARCHIMED ne touche jamais aux identifiants.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::core::error::AppErrorCode;
use crate::core::process::async_command;
use crate::core::{AppError, AppResult};

use super::types::{InstallProgress, VoiceToolStatus};

pub const EVENT: &str = "voice:install";
const INSTALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Plafond d'un installeur téléchargé (Voicebox embarque ses modèles de base).
const MAX_INSTALLER_BYTES: u64 = 4 * 1024 * 1024 * 1024;

pub const OLLAMA_PAGE: &str = "https://ollama.com/download";
pub const VOICEBOX_REPO: &str = "jamiepine/voicebox";
pub const VOICEBOX_PAGE: &str = "https://github.com/jamiepine/voicebox/releases/latest";

fn io(error: std::io::Error) -> AppError {
    AppError::new(AppErrorCode::Io, error.to_string())
}

fn publish<R: Runtime>(app: &AppHandle<R>, id: &str, step: &str, received: u64, total: u64) {
    let _ = app.emit(EVENT, InstallProgress { id: id.to_string(), step: step.to_string(), received, total });
}

fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" · ")
}

/// Lance une commande, attend sa fin, renvoie les dernières lignes (ou l'erreur en clair).
async fn run(mut command: tokio::process::Command, what: &str) -> AppResult<String> {
    command.kill_on_drop(true).stdin(std::process::Stdio::null());
    let output = tokio::time::timeout(INSTALL_TIMEOUT, command.output())
        .await
        .map_err(|_| AppError::new(AppErrorCode::Network, format!("{what} : installation trop longue, arrêtée.")))?
        .map_err(|e| AppError::internal(format!("{what} : {e}")))?;
    let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(AppError::new(AppErrorCode::Network, format!("{what} : échec. {}", last_lines(&text, 3))));
    }
    Ok(last_lines(&text, 2))
}

// ── Détection ──────────────────────────────────────────────────────────────────────

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Exécutable d'Ollama (PATH, puis dossier d'installation par défaut sous Windows).
pub fn ollama_binary() -> Option<PathBuf> {
    which::which("ollama").ok().or_else(|| {
        env_dir("LOCALAPPDATA")
            .map(|d| d.join("Programs").join("Ollama").join("ollama.exe"))
            .filter(|p| p.is_file())
    })
}

/// Application Voicebox installée : dossiers d'installation courants, sans parcourir le disque.
pub fn voicebox_binary() -> Option<PathBuf> {
    if let Ok(path) = which::which("voicebox") {
        return Some(path);
    }
    let roots: Vec<PathBuf> = [
        env_dir("LOCALAPPDATA"),
        env_dir("LOCALAPPDATA").map(|d| d.join("Programs")),
        env_dir("ProgramFiles"),
    ]
    .into_iter()
    .flatten()
    .collect();
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for entry in entries.flatten() {
            if !entry.file_name().to_string_lossy().to_lowercase().contains("voicebox") {
                continue;
            }
            let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
            let found = files.flatten().map(|f| f.path()).find(|p| {
                let name = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                name.ends_with(".exe") && name.contains("voicebox") && !name.contains("uninstall")
            });
            if found.is_some() {
                return found;
            }
        }
    }
    if cfg!(target_os = "macos") {
        let app = PathBuf::from("/Applications/Voicebox.app");
        if app.exists() {
            return Some(app);
        }
    }
    None
}

pub fn winget() -> Option<PathBuf> {
    if !cfg!(windows) {
        return None;
    }
    which::which("winget").ok().or_else(|| {
        env_dir("LOCALAPPDATA")
            .map(|d| d.join("Microsoft").join("WindowsApps").join("winget.exe"))
            .filter(|p| p.exists())
    })
}

fn npm() -> Option<PathBuf> {
    which::which("npm").ok().or_else(|| {
        env_dir("ProgramFiles")
            .map(|d| d.join("nodejs").join("npm.cmd"))
            .filter(|p| p.is_file())
    })
}

/// État des outils locaux (les agents sont détectés par le moteur, `engine_list_adapters`).
pub fn tools(ollama_running: bool, voicebox_running: bool) -> Vec<VoiceToolStatus> {
    let has_winget = winget().is_some();
    vec![
        VoiceToolStatus {
            id: "ollama".into(),
            name: "Ollama".into(),
            installed: ollama_running || ollama_binary().is_some(),
            running: ollama_running,
            can_install: has_winget,
            can_launch: ollama_binary().is_some(),
            page: OLLAMA_PAGE.into(),
        },
        VoiceToolStatus {
            id: "voicebox".into(),
            name: "Voicebox".into(),
            installed: voicebox_running || voicebox_binary().is_some(),
            running: voicebox_running,
            can_install: cfg!(windows),
            can_launch: voicebox_binary().is_some(),
            page: VOICEBOX_PAGE.into(),
        },
    ]
}

// ── Installation ───────────────────────────────────────────────────────────────────

async fn winget_install<R: Runtime>(app: &AppHandle<R>, id: &str, package: &str, name: &str) -> AppResult<String> {
    let winget = winget().ok_or_else(|| {
        AppError::invalid("winget est absent : installez « Programme d'installation d'application » depuis le Microsoft Store, ou utilisez la page de téléchargement.")
    })?;
    publish(app, id, &format!("Installation de {name} avec winget"), 0, 0);
    let mut command = async_command(winget);
    command.args([
        "install",
        "--exact",
        "--id",
        package,
        "--silent",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
    ]);
    run(command, name).await
}

/// Installe un outil proposé par la voix ; renvoie une phrase lisible sur le résultat.
pub async fn install<R: Runtime>(app: &AppHandle<R>, http: &reqwest::Client, tmp: &Path, id: &str) -> AppResult<String> {
    match id {
        "ollama" => {
            winget_install(app, id, "Ollama.Ollama", "Ollama").await?;
            Ok("Ollama est installé. Il démarre avec Windows ; choisissez maintenant un modèle.".into())
        }
        "voicebox" => install_voicebox(app, http, tmp).await,
        "claude" => {
            publish(app, id, "Installation de Claude Code (script officiel d'Anthropic)", 0, 0);
            let command = if cfg!(windows) {
                let mut c = async_command("powershell");
                c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]);
                c
            } else {
                let mut c = async_command("bash");
                c.args(["-c", "curl -fsSL https://claude.ai/install.sh | bash"]);
                c
            };
            run(command, "Claude Code").await?;
            Ok("Claude Code est installé. Connectez-vous une fois (bouton « Se connecter »).".into())
        }
        "codex" => {
            let npm = match npm() {
                Some(npm) => npm,
                None if cfg!(windows) => {
                    winget_install(app, id, "OpenJS.NodeJS.LTS", "Node.js").await?;
                    npm().ok_or_else(|| AppError::invalid("Node.js est installé : redémarrez ARCHIMED puis relancez l'installation de Codex."))?
                }
                None => return Err(AppError::invalid("npm est introuvable : installez Node.js (nodejs.org), puis réessayez.")),
            };
            publish(app, id, "Installation de Codex (npm)", 0, 0);
            let mut command = async_command(npm);
            command.args(["install", "-g", "@openai/codex"]);
            run(command, "Codex").await?;
            Ok("Codex est installé. Connectez-vous une fois (bouton « Se connecter »).".into())
        }
        other => Err(AppError::invalid(format!("Installation automatique indisponible pour « {other} » : utilisez sa page officielle."))),
    }
}

/// Installeur Windows de la dernière version publiée, avec son empreinte SHA-256.
pub fn pick_asset(release: &Value) -> Option<(String, String, String, u64)> {
    let assets = release["assets"].as_array()?;
    let candidates = assets.iter().filter_map(|a| {
        let name = a["name"].as_str()?.to_string();
        let lower = name.to_lowercase();
        let rank = if lower.ends_with("-setup.exe") || lower.ends_with("_setup.exe") {
            0
        } else if lower.ends_with(".msi") {
            1
        } else {
            return None;
        };
        if lower.contains("arm64") || lower.contains("aarch64") {
            return None;
        }
        let url = a["browser_download_url"].as_str()?.to_string();
        let digest = a["digest"].as_str().and_then(|d| d.strip_prefix("sha256:")).map(str::to_lowercase)?;
        let size = a["size"].as_u64().unwrap_or(0);
        Some((rank, name, url, digest, size))
    });
    candidates.min_by_key(|c| c.0).map(|(_, name, url, digest, size)| (name, url, digest, size))
}

async fn install_voicebox<R: Runtime>(app: &AppHandle<R>, http: &reqwest::Client, tmp: &Path) -> AppResult<String> {
    if !cfg!(windows) {
        return Err(AppError::invalid("Installation automatique de Voicebox disponible sous Windows : utilisez sa page de téléchargement."));
    }
    publish(app, "voicebox", "Recherche de la dernière version de Voicebox", 0, 0);
    let response = http
        .get(format!("https://api.github.com/repos/{VOICEBOX_REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "SDAI-ARCHIMED")
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| AppError::new(AppErrorCode::Network, format!("GitHub injoignable : {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(AppErrorCode::Network, format!("GitHub répond {} : réessayez plus tard.", response.status())));
    }
    let release: Value = super::cloud::read_json(response)
        .await
        .map_err(|e| AppError::new(AppErrorCode::Network, format!("Réponse de GitHub illisible : {e}")))?;
    let (name, url, digest, size) = pick_asset(&release).ok_or_else(|| {
        AppError::invalid("Aucun installeur Windows vérifiable dans la dernière version de Voicebox : utilisez sa page de téléchargement.")
    })?;
    if size > MAX_INSTALLER_BYTES {
        return Err(AppError::invalid("Installeur anormalement lourd : installation refusée."));
    }
    std::fs::create_dir_all(tmp).map_err(io)?;
    let path = tmp.join(&name);
    download(app, http, &url, &path, &digest, size, "voicebox", "Téléchargement de Voicebox").await?;
    publish(app, "voicebox", "Installation de Voicebox (suivez l'installeur)", size, size);
    // Start-Process passe par le shell de Windows : l'installeur peut demander l'élévation
    // (fenêtre UAC) et reste visible ; son code de sortie est rendu tel quel.
    let quoted = path.display().to_string().replace('\'', "''");
    let script = if name.to_lowercase().ends_with(".msi") {
        format!("$p = Start-Process -FilePath msiexec -ArgumentList '/i \"{quoted}\"' -Wait -PassThru; exit $p.ExitCode")
    } else {
        format!("$p = Start-Process -FilePath '{quoted}' -Wait -PassThru; exit $p.ExitCode")
    };
    let mut command = async_command("powershell");
    command.args(["-NoProfile", "-Command", &script]);
    let status = tokio::time::timeout(INSTALL_TIMEOUT, command.status())
        .await
        .map_err(|_| AppError::new(AppErrorCode::Network, "Installation de Voicebox trop longue, arrêtée."))?
        .map_err(|e| AppError::internal(format!("Voicebox : {e}")))?;
    let _ = std::fs::remove_file(&path);
    if !status.success() {
        return Err(AppError::invalid("Installation de Voicebox annulée ou échouée."));
    }
    Ok("Voicebox est installé. Lancez-le pour que la voix puisse l'utiliser.".into())
}

/// Téléchargement d'un installeur, refusé si l'empreinte ne correspond pas.
#[allow(clippy::too_many_arguments)]
async fn download<R: Runtime>(
    app: &AppHandle<R>,
    http: &reqwest::Client,
    url: &str,
    path: &Path,
    sha256: &str,
    total: u64,
    id: &str,
    step: &str,
) -> AppResult<()> {
    let mut response = http
        .get(url)
        .header("User-Agent", "SDAI-ARCHIMED")
        .send()
        .await
        .map_err(|e| AppError::new(AppErrorCode::Network, format!("Téléchargement impossible : {e}")))?;
    if !response.status().is_success() {
        return Err(AppError::new(AppErrorCode::Network, format!("Téléchargement : le serveur répond {}.", response.status())));
    }
    let mut out = std::fs::File::create(path).map_err(io)?;
    let mut hasher = Sha256::new();
    let mut received = 0u64;
    let mut last = Instant::now() - Duration::from_secs(1);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| AppError::new(AppErrorCode::Network, format!("Connexion coupée : {e}")))?
    {
        received += chunk.len() as u64;
        if received > MAX_INSTALLER_BYTES {
            let _ = std::fs::remove_file(path);
            return Err(AppError::invalid("Installeur anormalement lourd : téléchargement arrêté."));
        }
        hasher.update(&chunk);
        out.write_all(&chunk).map_err(io)?;
        if last.elapsed() >= Duration::from_millis(250) {
            last = Instant::now();
            publish(app, id, step, received, total);
        }
    }
    out.flush().map_err(io)?;
    drop(out);
    let digest = format!("{:x}", hasher.finalize());
    if digest != sha256 {
        let _ = std::fs::remove_file(path);
        return Err(AppError::invalid("Empreinte SHA-256 différente de celle publiée : fichier supprimé, rien n'a été installé."));
    }
    Ok(())
}

// ── Lancement et connexion ─────────────────────────────────────────────────────────

/// Démarre Ollama ou Voicebox installés (détachés : ils continuent sans ARCHIMED).
pub fn launch(id: &str) -> AppResult<()> {
    match id {
        "ollama" => {
            let binary = ollama_binary().ok_or_else(|| AppError::not_found("Ollama n'est pas installé."))?;
            // L'application (icône de la barre des tâches) démarre aussi le serveur.
            let app = binary.with_file_name("ollama app.exe");
            let mut command = if app.is_file() {
                crate::core::process::command(app)
            } else {
                let mut c = crate::core::process::command(binary);
                c.arg("serve");
                c
            };
            command.spawn().map(|_| ()).map_err(io)
        }
        "voicebox" => {
            let binary = voicebox_binary().ok_or_else(|| AppError::not_found("Voicebox n'est pas installé."))?;
            let mut command = if cfg!(target_os = "macos") {
                let mut c = std::process::Command::new("open");
                c.arg(binary);
                c
            } else {
                std::process::Command::new(binary)
            };
            command.spawn().map(|_| ()).map_err(io)
        }
        other => Err(AppError::invalid(format!("Lancement impossible : {other}."))),
    }
}

/// Ouvre un terminal visible sur la CLI : la personne s'y connecte elle-même.
pub fn open_terminal(binary: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
        std::process::Command::new("cmd")
            .arg("/k")
            .arg(binary)
            .creation_flags(CREATE_NEW_CONSOLE)
            .spawn()
            .map(|_| ())
            .map_err(io)
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-a", "Terminal"])
            .arg(binary)
            .spawn()
            .map(|_| ())
            .map_err(io)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::process::Command::new("x-terminal-emulator")
            .arg("-e")
            .arg(binary)
            .spawn()
            .map(|_| ())
            .map_err(|_| AppError::invalid(format!("Ouvrez un terminal et tapez : {}", binary.display())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn picks_the_verified_windows_installer() {
        let release = json!({ "assets": [
            { "name": "Voicebox_0.3.0_aarch64-setup.exe", "browser_download_url": "https://x/arm", "digest": "sha256:aa", "size": 1 },
            { "name": "Voicebox_0.3.0_x64_en-US.msi", "browser_download_url": "https://x/msi", "digest": "sha256:BB", "size": 2 },
            { "name": "Voicebox_0.3.0_x64-setup.exe", "browser_download_url": "https://x/exe", "digest": "sha256:cc", "size": 3 },
            { "name": "Voicebox_0.3.0_amd64.AppImage", "browser_download_url": "https://x/appimage", "digest": "sha256:dd", "size": 4 },
        ] });
        assert_eq!(pick_asset(&release), Some(("Voicebox_0.3.0_x64-setup.exe".into(), "https://x/exe".into(), "cc".into(), 3)));
    }

    #[test]
    fn refuses_installers_without_published_digest() {
        let release = json!({ "assets": [
            { "name": "Voicebox_x64-setup.exe", "browser_download_url": "https://x/exe", "size": 3 },
            { "name": "Voicebox_x64_en-US.msi", "browser_download_url": "https://x/msi", "digest": "sha256:ee", "size": 2 },
        ] });
        assert_eq!(pick_asset(&release).map(|a| a.0), Some("Voicebox_x64_en-US.msi".to_string()));
        assert_eq!(pick_asset(&json!({ "assets": [{ "name": "a-setup.exe", "browser_download_url": "u", "size": 1 }] })), None);
    }

    #[test]
    fn unknown_tools_are_not_installed() {
        let tools = tools(false, false);
        assert_eq!(tools.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), ["ollama", "voicebox"]);
    }
}
