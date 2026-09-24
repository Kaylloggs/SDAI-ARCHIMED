//! Suppression d'un module par la personne (Réglages → Modules → Supprimer).
//!
//! Le code d'un module fait partie de l'exécutable : le supprimer le retire de l'interface
//! (frontend, `modules.store`) et efface ici ce qu'il a laissé sur la machine :
//! - son dossier de données `<données>/modules/<id>/`, mis à la Corbeille (restaurable) ;
//! - sa déclaration d'outils `<données>/mcp/<id>.json` : les agents ne les reçoivent plus ;
//! - les clés déclarées dans son `module.toml` (`credentials`), retirées du Gestionnaire
//!   d'identifiants.
//!
//! Les fichiers que la personne a créés ailleurs (projets de mods, exports) ne sont jamais
//! touchés. Le core ne connaît aucun module par son nom : tout vient de l'identifiant.

use std::io;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use ts_rs::TS;

use super::paths::Paths;
use super::{AppError, AppResult};

/// Ce qu'un module occupe sur la machine.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct ModuleFootprint {
    /// Taille de son dossier de données, en octets.
    #[ts(type = "number")]
    pub bytes: u64,
    #[ts(type = "number")]
    pub files: u64,
    /// Il donne des outils aux agents (déclaration MCP).
    pub tools: bool,
    /// Nombre de clés qu'il peut ranger dans le Gestionnaire d'identifiants.
    pub credentials: u32,
}

/// Résultat d'une suppression.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct ModuleRemoval {
    /// Octets partis à la Corbeille.
    #[ts(type = "number")]
    pub freed: u64,
    /// Clés qui n'ont pas pu être effacées (le reste est fait).
    pub credentials_left: Vec<String>,
}

/// Identifiant de module : minuscules, chiffres et tirets (jamais un chemin).
fn check_id(id: &str) -> AppResult<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    if valid {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "identifiant de module invalide : {id}"
        )))
    }
}

/// Taille et nombre de fichiers d'un dossier, sans suivre les liens (ni les jonctions).
fn measure(path: &Path) -> (u64, u64) {
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if meta.file_type().is_symlink() {
        return (0, 0);
    }
    if meta.is_file() {
        return (meta.len(), 1);
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return (0, 0);
    };
    entries.flatten().fold((0, 0), |(bytes, files), entry| {
        let (b, f) = measure(&entry.path());
        (bytes + b, files + f)
    })
}

fn mcp_file(data: &Path, id: &str) -> std::path::PathBuf {
    data.join("mcp").join(format!("{id}.json"))
}

pub fn footprint(data: &Path, id: &str, credentials: &[&str]) -> AppResult<ModuleFootprint> {
    check_id(id)?;
    let (bytes, files) = measure(&data.join("modules").join(id));
    Ok(ModuleFootprint {
        bytes,
        files,
        tools: mcp_file(data, id).exists(),
        credentials: credentials.len() as u32,
    })
}

/// Efface les traces d'un module. Le dossier de données part en premier : s'il est encore
/// utilisé (conversation, compilation ou recherche en cours), rien d'autre n'est touché.
pub fn remove(
    data: &Path,
    id: &str,
    credentials: &[&str],
    discard: impl Fn(&Path) -> io::Result<()>,
    forget: impl Fn(&str) -> AppResult<()>,
) -> AppResult<ModuleRemoval> {
    check_id(id)?;
    let dir = data.join("modules").join(id);
    let (freed, _) = measure(&dir);
    if dir.exists() {
        discard(&dir).map_err(|error| {
            AppError::new(
                super::error::AppErrorCode::Io,
                format!(
                "Des fichiers du module sont encore utilisés ({error}). Fermez les conversations, \
                 compilations ou recherches en cours, puis réessayez."
            ),
            )
        })?;
    }

    let tools = mcp_file(data, id);
    if tools.exists() {
        std::fs::remove_file(&tools)?;
    }

    let credentials_left = credentials
        .iter()
        .filter(|account| {
            forget(account)
                .inspect_err(|error| {
                    tracing::warn!("clé {account} non effacée : {}", error.message)
                })
                .is_err()
        })
        .map(|account| account.to_string())
        .collect();
    Ok(ModuleRemoval {
        freed,
        credentials_left,
    })
}

/// Retire une clé du Gestionnaire d'identifiants (absente : rien à faire).
fn forget_credential(account: &str) -> AppResult<()> {
    let entry = keyring::Entry::new("com.sdai.archimed", account).map_err(|e| {
        AppError::internal(format!("Gestionnaire d'identifiants inaccessible ({e})."))
    })?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::internal(format!(
            "Gestionnaire d'identifiants inaccessible ({e})."
        ))),
    }
}

#[tauri::command]
pub async fn modules_footprint<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> AppResult<ModuleFootprint> {
    let data = Paths::resolve(&app)?.data;
    tauri::async_runtime::spawn_blocking(move || {
        footprint(&data, &id, crate::modules::credentials(&id))
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[tauri::command]
pub async fn modules_remove<R: Runtime>(app: AppHandle<R>, id: String) -> AppResult<ModuleRemoval> {
    let data = Paths::resolve(&app)?.data;
    tauri::async_runtime::spawn_blocking(move || {
        let result = remove(
            &data,
            &id,
            crate::modules::credentials(&id),
            |dir| trash::delete(dir).map_err(io::Error::other),
            forget_credential,
        );
        let outcome = match &result {
            Ok(removal) if removal.credentials_left.is_empty() => "ok",
            Ok(_) => "partial",
            Err(_) => "error",
        };
        super::audit::record("modules.remove", &id, outcome, "user");
        result
    })
    .await
    .map_err(|e| AppError::internal(e.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    fn sandbox(name: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("archimed-modules-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("modules/studio/cache")).unwrap();
        std::fs::create_dir_all(dir.join("modules/other")).unwrap();
        std::fs::create_dir_all(dir.join("mcp")).unwrap();
        std::fs::write(dir.join("modules/studio/state.json"), "{}").unwrap();
        std::fs::write(dir.join("modules/studio/cache/big.bin"), vec![0u8; 1000]).unwrap();
        std::fs::write(dir.join("modules/other/keep.json"), "{}").unwrap();
        std::fs::write(dir.join("mcp/studio.json"), "{}").unwrap();
        std::fs::write(dir.join("mcp/other.json"), "{}").unwrap();
        dir
    }

    #[test]
    fn footprint_counts_the_module_folder_and_its_tools() {
        let data = sandbox("footprint");
        let found = footprint(&data, "studio", &["studio-key"]).unwrap();
        assert_eq!(
            found,
            ModuleFootprint {
                bytes: 1002,
                files: 2,
                tools: true,
                credentials: 1
            }
        );
        assert_eq!(
            footprint(&data, "absent", &[]).unwrap(),
            ModuleFootprint::default()
        );
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn removal_clears_data_tools_and_keys_of_that_module_only() {
        let data = sandbox("remove");
        let forgotten = RefCell::new(Vec::new());
        let removal = remove(
            &data,
            "studio",
            &["studio-a", "studio-b"],
            |dir| std::fs::remove_dir_all(dir),
            |account| {
                forgotten.borrow_mut().push(account.to_string());
                if account == "studio-b" {
                    Err(AppError::internal("verrouillé"))
                } else {
                    Ok(())
                }
            },
        )
        .unwrap();
        assert_eq!(removal.freed, 1002);
        assert_eq!(removal.credentials_left, vec!["studio-b".to_string()]);
        assert_eq!(*forgotten.borrow(), vec!["studio-a", "studio-b"]);
        assert!(!data.join("modules/studio").exists());
        assert!(!data.join("mcp/studio.json").exists());
        assert!(data.join("modules/other/keep.json").exists());
        assert!(data.join("mcp/other.json").exists());
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn a_folder_in_use_stops_the_removal_before_anything_else() {
        let data = sandbox("locked");
        let error = remove(
            &data,
            "studio",
            &["studio-a"],
            |_| Err(io::Error::other("fichier ouvert")),
            |_| panic!("les clés ne doivent pas partir"),
        )
        .unwrap_err();
        assert!(error.message.contains("encore utilisés"));
        assert!(data.join("mcp/studio.json").exists());
        std::fs::remove_dir_all(&data).unwrap();
    }

    #[test]
    fn ids_never_become_paths() {
        let data = sandbox("ids");
        for id in ["", "..", "../modules", "a/b", "A", "-x", "a\\b"] {
            assert!(footprint(&data, id, &[]).is_err(), "{id}");
            assert!(
                remove(&data, id, &[], |_| Ok(()), |_| Ok(())).is_err(),
                "{id}"
            );
        }
        assert!(data.join("modules/studio").exists());
        std::fs::remove_dir_all(&data).unwrap();
    }
}
