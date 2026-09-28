//! Installation en un clic des CLI d'IA que le moteur pilote (Réglages › Assistants IA).
//!
//! - Claude Code : script officiel d'Anthropic (`claude.ai/install.ps1` ou `install.sh`) ;
//! - Codex : `npm install -g @openai/codex`, Node.js installé d'abord par `winget` s'il manque ;
//! - Antigravity : pas d'installation scriptable connue, la page officielle est proposée.
//!
//! Rien ne démarre sans un clic. La connexion à un compte se fait dans un terminal ouvert sur la
//! CLI (`core::install::open_terminal`) : ARCHIMED ne voit ni ne stocke d'identifiants.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::core::install::{npm, run, winget_install};
use crate::core::process::async_command;
use crate::core::{AppError, AppResult};

/// Avancement d'une installation : `{ adapter, step }`.
pub const EVENT: &str = "engine:install";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InstallStep<'a> {
    adapter: &'a str,
    step: &'a str,
}

fn publish<R: Runtime>(app: &AppHandle<R>, adapter: &str, step: &str) {
    let _ = app.emit(EVENT, InstallStep { adapter, step });
}

/// CLI installables d'un clic sur cette plate-forme.
pub fn installable(adapter: &str) -> bool {
    matches!(adapter, "claude" | "codex")
}

/// Installe la CLI d'un agent ; renvoie une phrase lisible sur le résultat.
pub async fn install_cli<R: Runtime>(app: &AppHandle<R>, adapter: &str) -> AppResult<String> {
    match adapter {
        "claude" => {
            publish(app, adapter, "Installation de Claude Code (script officiel d'Anthropic)");
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
            Ok("Claude Code est installé. Connectez-vous une fois avec « Se connecter ».".into())
        }
        "codex" => {
            let npm = match npm() {
                Some(npm) => npm,
                None if cfg!(windows) => {
                    publish(app, adapter, "Installation de Node.js avec winget");
                    winget_install("OpenJS.NodeJS.LTS", "Node.js").await?;
                    npm().ok_or_else(|| AppError::invalid("Node.js est installé : redémarrez ARCHIMED puis relancez l'installation de Codex."))?
                }
                None => return Err(AppError::invalid("npm est introuvable : installez Node.js (nodejs.org), puis réessayez.")),
            };
            publish(app, adapter, "Installation de Codex (npm)");
            let mut command = async_command(npm);
            command.args(["install", "-g", "@openai/codex"]);
            run(command, "Codex").await?;
            Ok("Codex est installé. Connectez-vous une fois avec « Se connecter ».".into())
        }
        other => Err(AppError::invalid(format!(
            "Installation automatique indisponible pour « {other} » : utilisez sa page officielle."
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_scriptable_clis_are_installable() {
        assert!(installable("claude"));
        assert!(installable("codex"));
        assert!(!installable("antigravity"));
        assert!(!installable("../../bin/sh"));
    }
}
