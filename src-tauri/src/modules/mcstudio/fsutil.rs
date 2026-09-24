//! Petits outils de fichiers partagés par les services du module.

use std::path::Path;

use crate::core::{AppError, AppResult};

/// Dossiers jamais copiés ni parcourus : sorties de build, caches, lancements du jeu.
pub const HEAVY_DIRS: &[&str] = &[
    ".gradle", "build", "out", "run", "run-data", "runs", "dist", ".idea", "bin", "classes",
];

/// Sous-dossiers de `.mcstudio` propres à une machine (pas copiés avec le projet).
pub const LOCAL_STATE: &[&str] = &["builds", "work", "cache"];

/// Écrit via un fichier temporaire puis un renommage : jamais de fichier à moitié écrit.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| {
        AppError::invalid(format!("chemin sans dossier parent : {}", path.display()))
    })?;
    std::fs::create_dir_all(parent)?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = parent.join(format!(".{name}.mcstudio-tmp"));
    std::fs::write(&temp, bytes)?;
    if let Err(error) = std::fs::rename(&temp, path) {
        let _ = std::fs::remove_file(&temp);
        return Err(AppError::new(
            crate::core::error::AppErrorCode::Io,
            format!(
                "{} n'a pas pu être écrit (fichier verrouillé ?) : {error}",
                path.display()
            ),
        ));
    }
    Ok(())
}

/// Copie un projet sans ses dossiers lourds ni son état local.
pub fn copy_project(from: &Path, to: &Path) -> AppResult<()> {
    copy_filtered(from, to, from)
}

fn copy_filtered(from: &Path, to: &Path, root: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        let source = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            let at_root = from == root;
            let in_state =
                from.file_name().is_some_and(|n| n == ".mcstudio") && from.parent() == Some(root);
            if (at_root && HEAVY_DIRS.contains(&name.as_str()))
                || (in_state && LOCAL_STATE.contains(&name.as_str()))
            {
                continue;
            }
            copy_filtered(&source, &to.join(&name), root)?;
        } else {
            std::fs::copy(&source, to.join(&name))?;
        }
    }
    Ok(())
}

/// Parcourt les fichiers d'un dossier (hors dossiers lourds) et appelle `visit`.
pub fn walk_files(root: &Path, visit: &mut dyn FnMut(&Path)) {
    fn inner(dir: &Path, root: &Path, visit: &mut dyn FnMut(&Path), depth: usize) {
        if depth > 32 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if (dir == root && HEAVY_DIRS.contains(&name.as_ref()))
                    || name == ".git"
                    || name == ".mcstudio"
                {
                    continue;
                }
                inner(&path, root, visit, depth + 1);
            } else {
                visit(&path);
            }
        }
    }
    inner(root, root, visit, 0);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_skips_build_outputs_and_local_state() {
        let base = std::env::temp_dir().join(format!("mcstudio-copy-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let from = base.join("a");
        for dir in [
            "src/main",
            "build/libs",
            ".gradle",
            ".mcstudio/builds",
            ".mcstudio/snapshots",
        ] {
            std::fs::create_dir_all(from.join(dir)).unwrap();
        }
        std::fs::write(from.join("src/main/A.java"), "x").unwrap();
        std::fs::write(from.join("build/libs/a.jar"), "x").unwrap();
        std::fs::write(from.join(".mcstudio/project.json"), "{}").unwrap();

        copy_project(&from, &base.join("b")).unwrap();
        let to = base.join("b");
        assert!(to.join("src/main/A.java").exists());
        assert!(to.join(".mcstudio/project.json").exists());
        assert!(to.join(".mcstudio/snapshots").exists());
        assert!(!to.join("build").exists());
        assert!(!to.join(".gradle").exists());
        assert!(!to.join(".mcstudio/builds").exists());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn atomic_write_creates_parents() {
        let path = std::env::temp_dir().join(format!("mcstudio-w-{}/x/y.txt", std::process::id()));
        write_atomic(&path, b"ok").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"ok");
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }
}
