//! Base de commandes des modules, copiée sur le disque : `<données>/commands/<module>.json`.
//!
//! L'interface la construit à partir du code des modules actifs (`src/core/modules/commands.ts`)
//! et l'envoie ici à chaque changement : un fichier par module actif, et les fichiers des
//! modules désactivés ou supprimés sont retirés. Les agents qui lisent le disque y trouvent
//! donc exactement ce que le serveur MCP d'ARCHIMED leur propose.

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Runtime};

use super::paths::Paths;
use super::{AppError, AppResult};

/// Identifiant de module utilisable comme nom de fichier (kebab-case, comme les dossiers).
fn valid_id(id: &str) -> bool {
    let mut chars = id.chars();
    chars.next().is_some_and(|c| c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && id.len() <= 64
}

/// Écrit une base par module (réécrite seulement si elle change) et retire les autres.
/// Renvoie le nombre de modules écrits.
pub fn sync(dir: &Path, catalogs: &[Value]) -> AppResult<usize> {
    std::fs::create_dir_all(dir)?;
    let mut kept = Vec::new();
    for catalog in catalogs {
        let Some(id) = catalog.pointer("/module/id").and_then(Value::as_str).filter(|id| valid_id(id)) else {
            continue;
        };
        let body = serde_json::to_string_pretty(catalog).map_err(|e| AppError::internal(e.to_string()))?;
        let file = dir.join(format!("{id}.json"));
        if std::fs::read_to_string(&file).ok().as_deref() != Some(body.as_str()) {
            std::fs::write(&file, body)?;
        }
        kept.push(format!("{id}.json"));
    }
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") && !kept.contains(&name) {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(kept.len())
}

#[tauri::command]
pub async fn commands_sync<R: Runtime>(app: AppHandle<R>, catalogs: Vec<Value>) -> AppResult<usize> {
    let dir = Paths::resolve(&app)?.commands();
    tauri::async_runtime::spawn_blocking(move || sync(&dir, &catalogs))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn one_file_per_active_module_and_none_for_the_others() {
        let dir = std::env::temp_dir().join(format!("archimed-commands-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let planner = json!({ "module": { "id": "planner" }, "commands": [{ "name": "add_card" }] });
        let memory = json!({ "module": { "id": "memory" }, "commands": [] });
        assert_eq!(sync(&dir, &[planner.clone(), memory]).unwrap(), 2);
        assert!(dir.join("planner.json").exists() && dir.join("memory.json").exists());

        // Module désactivé : sa base disparaît. Identifiant douteux : ignoré.
        let odd = json!({ "module": { "id": "../evil" }, "commands": [] });
        assert_eq!(sync(&dir, &[planner, odd]).unwrap(), 1);
        assert!(!dir.join("memory.json").exists());
        let written: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("planner.json")).unwrap()).unwrap();
        assert_eq!(written["commands"][0]["name"], "add_card");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
