//! Surveillance du projet ouvert dans le module Code : l'arborescence et les onglets se mettent
//! à jour quand une IA (ou un autre programme) crée, modifie ou supprime des fichiers.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

use crate::core::{AppError, AppResult};

/// Événement émis vers le frontend, regroupé sur 250 ms.
pub const FS_CHANGED: &str = "code:fs-changed";

const DEBOUNCE: Duration = Duration::from_millis(250);

/// Dossiers dont les changements ne concernent pas l'utilisateur (dépendances, builds, VCS).
const NOISY_DIRS: &[&str] = &[
    "node_modules", "target", ".git", ".next", ".turbo", ".venv", "__pycache__", ".cache", "dist", "build",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    pub root: String,
    /// Dossiers dont le contenu a changé (à relister).
    pub dirs: Vec<String>,
    /// Fichiers créés ou modifiés (onglets à relire).
    pub files: Vec<String>,
}

#[derive(Default)]
pub struct ProjectWatcher {
    current: Mutex<Option<(PathBuf, RecommendedWatcher)>>,
}

/// `true` si le chemin traverse un dossier bruyant sous la racine.
fn is_noisy(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).ok().is_some_and(|relative| {
        relative.components().any(|component| match component {
            Component::Normal(name) => NOISY_DIRS.iter().any(|noisy| name == *noisy),
            _ => false,
        })
    })
}

/// Regroupe des chemins touchés en dossiers à relister et fichiers à relire.
fn summarize(root: &Path, paths: impl IntoIterator<Item = PathBuf>) -> Option<FsChange> {
    let mut dirs = BTreeSet::new();
    let mut files = BTreeSet::new();
    for path in paths {
        if !path.starts_with(root) || is_noisy(root, &path) {
            continue;
        }
        if let Some(parent) = path.parent() {
            dirs.insert(parent.display().to_string());
        }
        if path.is_dir() {
            dirs.insert(path.display().to_string());
        } else if path.is_file() {
            files.insert(path.display().to_string());
        }
    }
    if dirs.is_empty() && files.is_empty() {
        return None;
    }
    Some(FsChange {
        root: root.display().to_string(),
        dirs: dirs.into_iter().collect(),
        files: files.into_iter().collect(),
    })
}

impl ProjectWatcher {
    /// Surveille `root` (récursivement) ; remplace la surveillance précédente.
    pub fn watch<R: Runtime>(&self, app: AppHandle<R>, root: PathBuf) -> AppResult<()> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| AppError::internal("verrou de surveillance corrompu"))?;
        if current.as_ref().is_some_and(|(watched, _)| watched == &root) {
            return Ok(());
        }
        *current = None; // arrête l'ancienne surveillance

        let (tx, rx) = mpsc::channel::<PathBuf>();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                if event.kind.is_access() {
                    return;
                }
                for path in event.paths {
                    let _ = tx.send(path);
                }
            }
        })
        .map_err(|e| AppError::internal(format!("surveillance impossible : {e}")))?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|e| AppError::internal(format!("surveillance impossible : {e}")))?;

        // Fil de regroupement : se termine quand le watcher (et donc l'émetteur) est détruit.
        let watched = root.clone();
        std::thread::spawn(move || {
            while let Ok(first) = rx.recv() {
                let mut batch = vec![first];
                while let Ok(next) = rx.recv_timeout(DEBOUNCE) {
                    batch.push(next);
                }
                if let Some(change) = summarize(&watched, batch) {
                    let _ = app.emit(FS_CHANGED, change);
                }
            }
        });

        *current = Some((root, watcher));
        Ok(())
    }

    pub fn unwatch(&self) {
        if let Ok(mut current) = self.current.lock() {
            *current = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_changes_and_skips_noisy_folders() {
        let root = std::env::temp_dir().join(format!("archimed-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/index.html"), "<h1>hi</h1>").unwrap();

        let change = summarize(
            &root,
            vec![
                root.join("src/index.html"),
                root.join("node_modules/pkg/a.js"),
                root.join("src/deleted.css"),
                PathBuf::from("C:/ailleurs/x.txt"),
            ],
        )
        .unwrap();
        assert_eq!(change.files, vec![root.join("src/index.html").display().to_string()]);
        assert_eq!(change.dirs, vec![root.join("src").display().to_string()]);
        assert!(summarize(&root, vec![root.join("node_modules/pkg/b.js")]).is_none());

        std::fs::remove_dir_all(&root).unwrap();
    }
}
