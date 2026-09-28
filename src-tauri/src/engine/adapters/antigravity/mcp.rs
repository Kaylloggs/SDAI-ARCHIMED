//! Serveurs MCP des modules pour Antigravity.
//!
//! `agy` n'a pas d'option `--mcp-config` : il ne lit ses serveurs MCP que dans le dossier
//! personnel, `~/.gemini/config/mcp_config.json` (et `~/.gemini/antigravity-cli/mcp_config.json`
//! pour les versions d'avant la migration) ; un fichier de projet est ignoré. Les serveurs
//! d'ARCHIMED y sont donc inscrits avant chaque lancement, au format d'Antigravity
//! (`serverUrl` + `headers` pour un serveur HTTP), sans toucher aux serveurs de la personne ;
//! ceux qu'ARCHIMED n'expose plus sont retirés, et tous le sont à la fermeture (leur jeton
//! n'y vaut plus).
//!
//! En mode headless, agy refuse sans rien demander tout outil MCP non autorisé (« a tool
//! required the "mcp" permission that headless mode cannot prompt for »), et le refus ne nomme
//! pas l'outil : impossible d'en faire une carte Autoriser/Refuser. Chaque serveur inscrit
//! reçoit donc la règle `mcp(<serveur>/*)` (forme `serveur/outil` exigée par agy, joker
//! accepté). Le serveur d'ARCHIMED garde la main : une action destructrice y demande toujours
//! confirmation, selon l'autonomie choisie.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

/// Serveurs qu'ARCHIMED a inscrits chez Antigravity (pour les retirer ensuite).
const MANAGED: &str = "_antigravity.managed.json";

/// Inscrit chez Antigravity les serveurs du fichier fusionné `merged` (aucun : retire les nôtres).
pub fn sync(merged: Option<&str>) {
    let ours: Map<String, Value> = crate::core::mcp::servers_in(merged)
        .iter()
        .map(|(name, config)| (name.clone(), for_antigravity(config)))
        .collect();
    let Some(managed) = crate::core::mcp::dir().map(|dir| dir.join(MANAGED)) else {
        return;
    };
    let previous: Vec<String> = std::fs::read_to_string(&managed)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    if ours.is_empty() && previous.is_empty() {
        return;
    }
    for target in configs() {
        if let Err(error) = write_servers(&target, &ours, &previous) {
            tracing::warn!("configuration MCP d'Antigravity non écrite ({}) : {error}", target.display());
        }
    }
    if let Err(error) = super::update_settings(|settings| allow_servers(settings, &ours, &previous)) {
        tracing::warn!("autorisations MCP d'Antigravity non écrites : {error}");
    }
    let names: Vec<&String> = ours.keys().collect();
    if let Ok(body) = serde_json::to_string(&names) {
        let _ = std::fs::write(&managed, body);
    }
}

/// Retire d'Antigravity les serveurs d'ARCHIMED et leurs autorisations.
pub fn forget() {
    sync(None);
}

fn configs() -> Vec<PathBuf> {
    let Some(home) = crate::core::paths::dirs_home() else {
        return Vec::new();
    };
    let gemini = home.join(".gemini");
    let mut targets = vec![gemini.join("config").join("mcp_config.json")];
    // Ancienne version de la CLI : seulement si elle a déjà son dossier.
    let legacy = gemini.join("antigravity-cli");
    if legacy.is_dir() {
        targets.push(legacy.join("mcp_config.json"));
    }
    targets
}

/// Déclaration au format Antigravity : `serverUrl` au lieu de `url`, pas de `type`.
fn for_antigravity(config: &Value) -> Value {
    let Some(object) = config.as_object() else {
        return config.clone();
    };
    let mut out = Map::new();
    for (key, value) in object {
        match key.as_str() {
            "type" => {}
            "url" => {
                out.insert("serverUrl".to_string(), value.clone());
            }
            _ => {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    Value::Object(out)
}

fn rule(server: &str) -> String {
    format!("mcp({server}/*)")
}

/// Règles `mcp(<serveur>/*)` : ajoutées pour nos serveurs, retirées pour les anciens.
fn allow_servers(settings: &mut Value, ours: &Map<String, Value>, previous: &[String]) -> bool {
    let mut changed = false;
    for name in previous.iter().filter(|name| !ours.contains_key(*name)) {
        changed |= super::remove_rule(settings, &rule(name));
    }
    for name in ours.keys() {
        changed |= super::add_rule(settings, &rule(name));
    }
    changed
}

/// Écrit `ours` dans le fichier `target` : serveurs de la personne gardés, anciens serveurs
/// d'ARCHIMED (`previous`) retirés. Rien n'est réécrit si le contenu ne change pas.
fn write_servers(target: &Path, ours: &Map<String, Value>, previous: &[String]) -> std::io::Result<()> {
    let existing = std::fs::read_to_string(target).ok();
    if existing.is_none() && ours.is_empty() {
        return Ok(());
    }
    let mut root = existing
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}));
    let Some(object) = root.as_object_mut() else {
        return Ok(());
    };
    let servers = object.entry("mcpServers").or_insert_with(|| Value::Object(Map::new()));
    if !servers.is_object() {
        *servers = Value::Object(Map::new());
    }
    if let Some(servers) = servers.as_object_mut() {
        for name in previous {
            if !ours.contains_key(name) {
                servers.remove(name);
            }
        }
        for (name, config) in ours {
            servers.insert(name.clone(), config.clone());
        }
    }
    let body = serde_json::to_string_pretty(&root).map_err(std::io::Error::other)?;
    if existing.as_deref() == Some(body.as_str()) {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(target, body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antigravity_gets_our_servers_and_keeps_its_own() {
        let dir = std::env::temp_dir().join(format!("archimed-agy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let target = dir.join("config").join("mcp_config.json");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(&target, r#"{"mcpServers":{"perso":{"command":"node","args":["s.js"]},"vieux":{"serverUrl":"x"}},"autre":1}"#).unwrap();

        let voice = json!({ "type": "http", "url": "http://127.0.0.1:5000/mcp", "headers": { "Authorization": "Bearer t" } });
        let mut ours = Map::new();
        ours.insert("archimed".to_string(), for_antigravity(&voice));
        write_servers(&target, &ours, &["vieux".to_string()]).unwrap();

        let written: Value = serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert_eq!(written["mcpServers"]["archimed"]["serverUrl"], "http://127.0.0.1:5000/mcp");
        assert_eq!(written["mcpServers"]["archimed"]["headers"]["Authorization"], "Bearer t");
        assert!(written["mcpServers"]["archimed"].get("type").is_none());
        assert_eq!(written["mcpServers"]["perso"]["command"], "node");
        assert!(written["mcpServers"].get("vieux").is_none());
        assert_eq!(written["autre"], 1);

        // Plus rien à exposer : les nôtres partent, ceux de la personne restent.
        write_servers(&target, &Map::new(), &["archimed".to_string()]).unwrap();
        let written: Value = serde_json::from_str(&std::fs::read_to_string(&target).unwrap()).unwrap();
        assert!(written["mcpServers"].get("archimed").is_none());
        assert_eq!(written["mcpServers"]["perso"]["command"], "node");

        // Aucun fichier et rien à écrire : aucun fichier créé.
        let absent = dir.join("absent").join("mcp_config.json");
        write_servers(&absent, &Map::new(), &[]).unwrap();
        assert!(!absent.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn our_servers_are_allowed_and_old_ones_revoked() {
        let mut settings = json!({ "permissions": { "allow": ["command(pnpm test)", "mcp(vieux/*)"] } });
        let mut ours = Map::new();
        ours.insert("archimed".to_string(), json!({}));
        assert!(allow_servers(&mut settings, &ours, &["vieux".to_string()]));
        assert_eq!(settings["permissions"]["allow"], json!(["command(pnpm test)", "mcp(archimed/*)"]));
        // Déjà à jour : rien à réécrire.
        assert!(!allow_servers(&mut settings, &ours, &["archimed".to_string()]));
        // Fermeture : la règle part, celles de la personne restent.
        assert!(allow_servers(&mut settings, &Map::new(), &["archimed".to_string()]));
        assert_eq!(settings["permissions"]["allow"], json!(["command(pnpm test)"]));
    }
}
