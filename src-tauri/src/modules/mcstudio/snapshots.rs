//! Points de restauration d'un projet : les fichiers concernés sont copiés avant une
//! modification importante (changements d'une IA, restauration), pour pouvoir revenir en
//! arrière. Stockés dans `<projet>/.mcstudio/snapshots/<id>/` (manifeste + copies).

use std::path::{Path, PathBuf};

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::files;
use super::fsutil::{self, walk_files};
use super::types::{Snapshot, SnapshotFile, SnapshotKind};

const DIR: &str = ".mcstudio/snapshots";

fn dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

fn valid_id(id: &str) -> AppResult<()> {
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(())
    } else {
        Err(AppError::invalid("Point de restauration inconnu."))
    }
}

fn folder(root: &Path, id: &str) -> AppResult<PathBuf> {
    valid_id(id)?;
    Ok(dir(root).join(id))
}

/// Copie l'état actuel de `paths` (relatifs au projet) avant de les modifier.
pub fn create(
    root: &Path,
    label: &str,
    kind: SnapshotKind,
    paths: &[String],
) -> AppResult<Snapshot> {
    let id = format!(
        "{}-{}",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    );
    let base = folder(root, &id)?;
    let mut entries = Vec::new();
    let mut size = 0;
    let mut seen = std::collections::BTreeSet::new();
    for path in paths {
        let source = files::resolve(root, path)?;
        let relative = path.trim_matches('/').replace('\\', "/");
        if !seen.insert(relative.clone()) || source.is_dir() {
            continue;
        }
        let existed = source.is_file();
        if existed {
            let copy = base.join("files").join(&relative);
            if let Some(parent) = copy.parent() {
                std::fs::create_dir_all(parent)?;
            }
            size += std::fs::copy(&source, &copy)?;
        }
        entries.push(SnapshotFile {
            path: relative,
            existed,
        });
    }
    let snapshot = Snapshot {
        id,
        label: label.trim().chars().take(120).collect(),
        kind,
        created_at: chrono::Utc::now().to_rfc3339(),
        files: entries,
        size,
    };
    std::fs::create_dir_all(&base)?;
    fsutil::write_atomic(
        &base.join("manifest.json"),
        &serde_json::to_vec_pretty(&snapshot)?,
    )?;
    Ok(snapshot)
}

/// Tous les fichiers du projet (hors builds, caches, `.git`, `.mcstudio`).
pub fn create_full(root: &Path, label: &str) -> AppResult<Snapshot> {
    let mut paths = Vec::new();
    walk_files(root, &mut |file| {
        if let Ok(relative) = file.strip_prefix(root) {
            paths.push(relative.to_string_lossy().replace('\\', "/"));
        }
    });
    paths.sort();
    create(root, label, SnapshotKind::Manual, &paths)
}

fn load(root: &Path, id: &str) -> AppResult<Snapshot> {
    let raw = std::fs::read(folder(root, id)?.join("manifest.json"))
        .map_err(|_| AppError::not_found("Ce point de restauration n'existe plus."))?;
    Ok(serde_json::from_slice(&raw)?)
}

/// Du plus récent au plus ancien.
pub fn list(root: &Path) -> Vec<Snapshot> {
    let Ok(entries) = std::fs::read_dir(dir(root)) else {
        return Vec::new();
    };
    let mut snapshots: Vec<Snapshot> = entries
        .flatten()
        .filter_map(|entry| {
            let raw = std::fs::read(entry.path().join("manifest.json")).ok()?;
            serde_json::from_slice(&raw).ok()
        })
        .collect();
    snapshots.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(b.id.cmp(&a.id)));
    snapshots
}

/// Remet les fichiers dans l'état de l'instantané. L'état actuel est d'abord sauvegardé
/// (instantané « Restore ») : une restauration s'annule comme le reste. Les fichiers qui
/// n'existaient pas partent à la Corbeille.
pub fn restore(root: &Path, id: &str) -> AppResult<Snapshot> {
    let snapshot = load(root, id)?;
    let paths: Vec<String> = snapshot.files.iter().map(|f| f.path.clone()).collect();
    let before = create(
        root,
        &format!("Avant restauration de « {} »", snapshot.label),
        SnapshotKind::Restore,
        &paths,
    )?;
    let base = folder(root, id)?.join("files");
    for file in &snapshot.files {
        let target = files::resolve(root, &file.path)?;
        if file.existed {
            let bytes = std::fs::read(base.join(&file.path))?;
            fsutil::write_atomic(&target, &bytes)?;
        } else if target.is_file() {
            trash::delete(&target).map_err(|e| {
                AppError::new(
                    AppErrorCode::Io,
                    format!("{} n'a pas pu être mis à la Corbeille : {e}", file.path),
                )
            })?;
        }
    }
    crate::core::audit::record(
        "mcstudio.snapshot_restore",
        &format!("{} ({id})", root.display()),
        "restored",
        "user",
    );
    Ok(before)
}

/// Point de restauration à la Corbeille (récupérable).
pub fn delete(root: &Path, id: &str) -> AppResult<()> {
    let path = folder(root, id)?;
    if !path.is_dir() {
        return Err(AppError::not_found(
            "Ce point de restauration n'existe plus.",
        ));
    }
    trash::delete(&path).map_err(|e| {
        AppError::new(
            AppErrorCode::Io,
            format!("Mise à la Corbeille impossible : {e}"),
        )
    })?;
    crate::core::audit::record(
        "mcstudio.snapshot_delete",
        &path.display().to_string(),
        "trashed",
        "user",
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("mcstudio-snap-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src/main/java")).unwrap();
        std::fs::create_dir_all(root.join("build/libs")).unwrap();
        std::fs::write(root.join("build.gradle"), "v1").unwrap();
        std::fs::write(root.join("src/main/java/A.java"), "class A {}").unwrap();
        std::fs::write(root.join("build/libs/x.jar"), "jar").unwrap();
        root
    }

    #[test]
    fn a_snapshot_brings_files_back_and_can_itself_be_undone() {
        let root = project("restore");
        let snapshot = create(
            &root,
            "Avant IA",
            SnapshotKind::Ai,
            &["build.gradle".into(), "src/main/java/New.java".into()],
        )
        .unwrap();
        assert_eq!(snapshot.files.len(), 2);
        assert!(snapshot
            .files
            .iter()
            .any(|f| f.path == "src/main/java/New.java" && !f.existed));

        // L'IA modifie un fichier et en crée un autre.
        std::fs::write(root.join("build.gradle"), "v2").unwrap();
        std::fs::write(root.join("src/main/java/New.java"), "class New {}").unwrap();

        let undo = restore(&root, &snapshot.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("build.gradle")).unwrap(),
            "v1"
        );
        assert!(!root.join("src/main/java/New.java").exists());
        assert_eq!(undo.kind, SnapshotKind::Restore);

        // La restauration s'annule.
        restore(&root, &undo.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("build.gradle")).unwrap(),
            "v2"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("src/main/java/New.java")).unwrap(),
            "class New {}"
        );

        let listed = list(&root);
        assert!(listed.len() >= 3);
        assert!(listed
            .windows(2)
            .all(|w| w[0].created_at >= w[1].created_at));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn full_snapshots_skip_build_outputs_and_ids_are_checked() {
        let root = project("full");
        let snapshot = create_full(&root, "Version stable").unwrap();
        let paths: Vec<&str> = snapshot.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["build.gradle", "src/main/java/A.java"]);
        assert!(snapshot.size > 0);
        assert!(restore(&root, "../../x").is_err());
        assert!(create(&root, "x", SnapshotKind::Manual, &["../outside".into()]).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
