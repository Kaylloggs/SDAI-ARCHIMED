//! Outils partagés des installations en un clic (CLI d'IA, outils des modules).
//!
//! Chaque installation passe par une voie officielle et vérifiable (`winget`, script de
//! l'éditeur, `npm`) et ne démarre qu'après un clic de la personne. La connexion à un compte se
//! fait dans un terminal visible ouvert pour elle : ARCHIMED ne touche jamais aux identifiants.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::error::AppErrorCode;
use crate::core::process::async_command;
use crate::core::{AppError, AppResult};

pub const INSTALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name).map(PathBuf::from)
}

/// Gestionnaire de paquets de Windows (absent ailleurs).
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

/// `npm` de Node.js (PATH, puis dossier d'installation par défaut sous Windows).
pub fn npm() -> Option<PathBuf> {
    which::which("npm").ok().or_else(|| {
        env_dir("ProgramFiles")
            .map(|d| d.join("nodejs").join("npm.cmd"))
            .filter(|p| p.is_file())
    })
}

/// Dernières lignes non vides d'une sortie, jointes : assez pour comprendre un échec.
pub fn last_lines(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(n)..].join(" · ")
}

/// Lance une commande d'installation, attend sa fin, renvoie les dernières lignes (ou l'erreur
/// en clair).
pub async fn run(mut command: tokio::process::Command, what: &str) -> AppResult<String> {
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

/// Installe un paquet du dépôt `winget` de Microsoft (empreinte vérifiée par winget).
pub async fn winget_install(package: &str, name: &str) -> AppResult<String> {
    let winget = winget().ok_or_else(|| {
        AppError::invalid("winget est absent : installez « Programme d'installation d'application » depuis le Microsoft Store, ou utilisez la page de téléchargement.")
    })?;
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

#[cfg(any(windows, target_os = "macos"))]
fn io(error: std::io::Error) -> AppError {
    AppError::new(AppErrorCode::Io, error.to_string())
}

/// Ouvre un terminal visible sur une CLI : la personne s'y connecte elle-même.
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

    #[test]
    fn keeps_the_last_meaningful_lines() {
        assert_eq!(last_lines("a\n\n  b  \nc\n", 2), "b · c");
        assert_eq!(last_lines("", 3), "");
    }
}
