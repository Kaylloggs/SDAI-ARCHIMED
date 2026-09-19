//! Serveurs MCP fournis par les modules.
//!
//! Un module qui expose des outils à une CLI dépose sa déclaration dans
//! `<données>/mcp/<module>.json`, au format attendu par les CLI :
//!
//! ```json
//! { "mcpServers": { "archimed-jobagent": { "command": "…", "args": ["…"] } } }
//! ```
//!
//! Au lancement d'une session, le moteur fusionne ces fichiers en un seul et le passe à la
//! CLI. Personne n'a de commande à taper : brancher un module suffit à donner ses outils
//! à l'agent. Retirer le fichier les retire.

use std::path::PathBuf;
use std::sync::OnceLock;

use serde_json::{Map, Value};

use crate::core::paths::Paths;

/// Dossier des déclarations, connu dès le démarrage.
static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Nom du fichier fusionné, écrit par nos soins (les modules n'y touchent pas).
const MERGED: &str = "_merged.generated.json";

pub fn init(paths: &Paths) {
    let _ = ROOT.set(paths.mcp());
}

pub fn dir() -> Option<PathBuf> {
    ROOT.get().cloned()
}

/// Fusionne les déclarations des modules et renvoie le chemin du fichier à passer à la CLI.
/// `None` quand aucun module n'expose de serveur : la CLI démarre alors sans option.
pub fn merged() -> Option<String> {
    let dir = dir()?;
    let mut servers = Map::new();
    for file in declarations(&dir) {
        let Ok(raw) = std::fs::read_to_string(&file) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            tracing::warn!("déclaration MCP illisible : {}", file.display());
            continue;
        };
        if let Some(found) = value.get("mcpServers").and_then(Value::as_object) {
            for (name, config) in found {
                servers.insert(name.clone(), config.clone());
            }
        }
    }
    if servers.is_empty() {
        return None;
    }

    let target = dir.join(MERGED);
    let body = serde_json::to_string_pretty(&serde_json::json!({ "mcpServers": servers })).ok()?;
    // Réécrire à l'identique ferait recompiler la configuration de la CLI pour rien.
    if std::fs::read_to_string(&target).ok().as_deref() != Some(body.as_str()) {
        std::fs::create_dir_all(&dir).ok()?;
        std::fs::write(&target, &body).ok()?;
    }
    Some(target.display().to_string())
}

/// Fichiers de déclaration présents, dans un ordre stable.
fn declarations(dir: &std::path::Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension().is_some_and(|ext| ext == "json")
                && path.file_name().is_some_and(|name| name != MERGED)
        })
        .collect();
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_every_module_declaration() {
        let dir = std::env::temp_dir().join(format!("archimed-mcp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("jobagent.json"),
            r#"{"mcpServers":{"jobs":{"command":"python"}}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("notes.json"),
            r#"{"mcpServers":{"notes":{"command":"node"}}}"#,
        )
        .unwrap();
        // Fichier hors sujet : ignoré sans casser la fusion.
        std::fs::write(dir.join("readme.txt"), "rien").unwrap();

        let files = declarations(&dir);
        assert_eq!(files.len(), 2);

        let mut servers = Map::new();
        for file in files {
            let value: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
            for (name, config) in value["mcpServers"].as_object().unwrap() {
                servers.insert(name.clone(), config.clone());
            }
        }
        assert_eq!(servers.len(), 2);
        assert!(servers.contains_key("jobs") && servers.contains_key("notes"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn no_declaration_means_no_option() {
        let dir = std::env::temp_dir().join("archimed-mcp-vide");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(declarations(&dir).is_empty());
    }
}
