//! Fichiers d'un projet pour l'explorateur et l'éditeur : lister, lire, écrire, créer,
//! renommer, mettre à la Corbeille.
//!
//! Tous les chemins sont relatifs à la racine du projet et ne peuvent pas en sortir (ni
//! `..`, ni chemin absolu, ni lien symbolique qui pointerait ailleurs). L'état interne
//! (`.mcstudio/`, `.git/`) se lit mais ne s'écrit pas d'ici.

use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::fsutil::{self, HEAVY_DIRS};
use super::types::{ProjectEntry, ProjectFile};

/// Au-delà, le fichier s'ouvre tronqué et en lecture seule.
const MAX_TEXT: u64 = 2 * 1024 * 1024;
/// Dossiers protégés : état de Mod Studio, dépôt Git.
const PROTECTED: &[&str] = &[".mcstudio", ".git"];
const IMAGES: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Chemin relatif → chemin absolu dans le projet, refusé s'il en sort.
pub fn resolve(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = relative.replace('\\', "/");
    // `C:` (lecteur) ou `fichier:flux` (flux NTFS) : jamais un chemin de projet.
    if relative.contains(':') {
        return Err(AppError::invalid(format!(
            "« {relative} » sort du projet : chemin refusé."
        )));
    }
    let mut clean = PathBuf::new();
    for component in Path::new(relative.trim_end_matches('/')).components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => {
                return Err(AppError::invalid(format!(
                    "« {relative} » sort du projet : chemin refusé."
                )))
            }
        }
    }
    let path = root.join(&clean);
    // Un lien symbolique pourrait mener ailleurs : on vérifie le chemin réel.
    let real_root = root.canonicalize()?;
    let existing = path
        .ancestors()
        .find(|p| p.exists())
        .unwrap_or(root)
        .canonicalize()?;
    if !existing.starts_with(&real_root) {
        return Err(AppError::invalid(format!(
            "« {relative} » sort du projet : chemin refusé."
        )));
    }
    Ok(path)
}

fn relative_of(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn first_segment(relative: &str) -> &str {
    relative
        .trim_matches('/')
        .split('/')
        .next()
        .unwrap_or_default()
}

/// Écriture interdite dans l'état interne et à la racine même du projet.
fn writable(relative: &str) -> AppResult<()> {
    let first = first_segment(relative);
    if first.is_empty() {
        return Err(AppError::invalid("Chemin vide."));
    }
    if PROTECTED.contains(&first) {
        return Err(AppError::invalid(format!(
            "{first}/ est géré par Mod Studio ou Git : modification refusée ici."
        )));
    }
    Ok(())
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn io_error(action: &str, relative: &str, error: std::io::Error) -> AppError {
    AppError::new(
        AppErrorCode::Io,
        format!("{action} « {relative} » impossible : {error}"),
    )
}

/// Contenu d'un dossier : dossiers d'abord, puis fichiers, par nom.
pub fn list(root: &Path, relative: &str) -> AppResult<Vec<ProjectEntry>> {
    let dir = resolve(root, relative)?;
    let at_root = dir == root;
    let mut entries: Vec<ProjectEntry> = std::fs::read_dir(&dir)
        .map_err(|e| io_error("Lecture du dossier", relative, e))?
        .flatten()
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if file_type.is_symlink() {
                return None;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            let ignored = PROTECTED.contains(&name.as_str())
                || (at_root && HEAVY_DIRS.contains(&name.as_str()));
            Some(ProjectEntry {
                path: relative_of(root, &path),
                is_dir: file_type.is_dir(),
                size: if file_type.is_dir() {
                    0
                } else {
                    entry.metadata().map(|m| m.len()).unwrap_or(0)
                },
                ignored,
                name,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn read(root: &Path, relative: &str) -> AppResult<ProjectFile> {
    let path = resolve(root, relative)?;
    if !path.is_file() {
        return Err(AppError::not_found(format!(
            "« {relative} » est introuvable."
        )));
    }
    let size = std::fs::metadata(&path)?.len();
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let image = IMAGES.contains(&extension.as_str());
    let mut bytes = Vec::new();
    std::fs::File::open(&path)?
        .take(MAX_TEXT)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("Lecture de", relative, e))?;
    let truncated = size > MAX_TEXT;
    let sample = &bytes[..bytes.len().min(8192)];
    let text = if image || sample.contains(&0) {
        None
    } else {
        match String::from_utf8(bytes) {
            Ok(text) => Some(text),
            // Coupé au milieu d'un caractère : on garde la partie valide.
            Err(error) if truncated => {
                let valid = error.utf8_error().valid_up_to();
                let mut bytes = error.into_bytes();
                bytes.truncate(valid);
                String::from_utf8(bytes).ok()
            }
            Err(_) => None,
        }
    };
    Ok(ProjectFile {
        path: relative_of(root, &path),
        binary: text.is_none(),
        content: text.unwrap_or_default(),
        image,
        truncated,
        size,
        modified: modified_ms(&path),
    })
}

/// Enregistre un fichier texte. `expected_modified` : date lue à l'ouverture ; si le
/// fichier a changé depuis (autre programme, IA, Gradle), l'écriture est refusée.
pub fn write(
    root: &Path,
    relative: &str,
    content: &str,
    expected_modified: Option<u64>,
) -> AppResult<ProjectFile> {
    writable(relative)?;
    let path = resolve(root, relative)?;
    if path.is_dir() {
        return Err(AppError::invalid(format!("« {relative} » est un dossier.")));
    }
    if let Some(expected) = expected_modified {
        if path.is_file() && modified_ms(&path) != expected {
            return Err(AppError::invalid(format!(
                "« {relative} » a été modifié en dehors de l'éditeur depuis son ouverture. Rechargez-le, ou écrasez-le."
            )));
        }
    }
    fsutil::write_atomic(&path, content.as_bytes())?;
    crate::core::audit::record(
        "mcstudio.file_write",
        &path.display().to_string(),
        "written",
        "user",
    );
    read(root, relative)
}

/// Nouveau fichier vide ou nouveau dossier (dossiers parents compris).
pub fn create(root: &Path, relative: &str, directory: bool) -> AppResult<ProjectEntry> {
    writable(relative)?;
    let path = resolve(root, relative)?;
    if path.exists() {
        return Err(AppError::invalid(format!("« {relative} » existe déjà.")));
    }
    if directory {
        std::fs::create_dir_all(&path).map_err(|e| io_error("Création de", relative, e))?;
    } else {
        fsutil::write_atomic(&path, b"")?;
    }
    crate::core::audit::record(
        "mcstudio.file_create",
        &path.display().to_string(),
        "created",
        "user",
    );
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Ok(ProjectEntry {
        path: relative_of(root, &path),
        name,
        is_dir: directory,
        size: 0,
        ignored: false,
    })
}

pub fn rename(root: &Path, from: &str, to: &str) -> AppResult<()> {
    writable(from)?;
    writable(to)?;
    let source = resolve(root, from)?;
    let target = resolve(root, to)?;
    if !source.exists() {
        return Err(AppError::not_found(format!("« {from} » est introuvable.")));
    }
    // Sous Windows, changer la casse seule est un renommage légitime.
    let same_file =
        source.to_string_lossy().to_lowercase() == target.to_string_lossy().to_lowercase();
    if target.exists() && !same_file {
        return Err(AppError::invalid(format!("« {to} » existe déjà.")));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&source, &target).map_err(|e| io_error("Renommage de", from, e))?;
    crate::core::audit::record(
        "mcstudio.file_rename",
        &format!("{} -> {}", source.display(), target.display()),
        "renamed",
        "user",
    );
    Ok(())
}

/// Corbeille (récupérable), jamais de suppression définitive.
pub fn trash(root: &Path, relative: &str) -> AppResult<()> {
    writable(relative)?;
    let path = resolve(root, relative)?;
    if !path.exists() {
        return Err(AppError::not_found(format!(
            "« {relative} » est introuvable."
        )));
    }
    trash::delete(&path).map_err(|e| {
        AppError::new(
            AppErrorCode::Io,
            format!("Mise à la Corbeille impossible (fichier ouvert ailleurs ?) : {e}"),
        )
    })?;
    crate::core::audit::record(
        "mcstudio.file_trash",
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
            std::env::temp_dir().join(format!("mcstudio-files-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in ["src/main/java", "build/libs", ".mcstudio"] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        std::fs::write(root.join("build.gradle"), "plugins {}\n").unwrap();
        std::fs::write(root.join("src/main/java/Main.java"), "class Main {}\n").unwrap();
        std::fs::write(root.join(".mcstudio/project.json"), "{}").unwrap();
        std::fs::write(root.join("icon.png"), b"\x89PNG\r\n\x1a\n\0\0").unwrap();
        root
    }

    #[test]
    fn paths_cannot_leave_the_project() {
        let root = project("escape");
        for bad in [
            "../x",
            "src/../../x",
            "/etc/passwd",
            "C:\\Windows",
            "..\\..\\x",
        ] {
            assert!(resolve(&root, bad).is_err(), "{bad}");
        }
        assert_eq!(resolve(&root, "src/main").unwrap(), root.join("src/main"));
        assert_eq!(resolve(&root, "").unwrap(), root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_lead_outside() {
        let root = project("link");
        let outside = std::env::temp_dir().join(format!("mcstudio-outside-{}", std::process::id()));
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("src/escape")).unwrap();
        assert!(resolve(&root, "src/escape/secret.txt").is_err());
        assert!(write(&root, "src/escape/x.txt", "x", None).is_err());
        assert!(!outside.join("x.txt").exists());
        // Et l'explorateur ne montre pas le lien.
        assert!(list(&root, "src")
            .unwrap()
            .iter()
            .all(|e| e.name != "escape"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn listing_puts_folders_first_and_dims_build_outputs() {
        let root = project("list");
        let entries = list(&root, "").unwrap();
        let names: Vec<(&str, bool)> = entries
            .iter()
            .map(|e| (e.name.as_str(), e.ignored))
            .collect();
        assert_eq!(
            names,
            [
                (".mcstudio", true),
                ("build", true),
                ("src", false),
                ("build.gradle", false),
                ("icon.png", false)
            ]
        );
        assert_eq!(list(&root, "src/main").unwrap()[0].path, "src/main/java");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn text_binary_and_image_files_are_told_apart() {
        let root = project("read");
        let java = read(&root, "src/main/java/Main.java").unwrap();
        assert_eq!(java.content, "class Main {}\n");
        assert!(!java.binary && !java.image && java.modified > 0);
        let icon = read(&root, "icon.png").unwrap();
        assert!(icon.binary && icon.image && icon.content.is_empty());
        assert!(read(&root, "absent.txt").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn writes_refuse_conflicts_and_internal_state() {
        let root = project("write");
        let opened = read(&root, "build.gradle").unwrap();
        let saved = write(
            &root,
            "build.gradle",
            "plugins { id 'java' }\n",
            Some(opened.modified),
        )
        .unwrap();
        assert_eq!(saved.content, "plugins { id 'java' }\n");
        // Modifié ailleurs entre-temps : refusé, rien n'est écrasé.
        let stale = saved.modified.saturating_sub(5_000);
        assert!(write(&root, "build.gradle", "x", Some(stale)).is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("build.gradle")).unwrap(),
            "plugins { id 'java' }\n"
        );
        // Sans date attendue (écraser), l'écriture passe.
        write(&root, "build.gradle", "y", None).unwrap();

        assert!(write(&root, ".mcstudio/project.json", "{}", None).is_err());
        assert!(create(&root, ".git/config", false).is_err());
        assert!(trash(&root, ".mcstudio").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn create_and_rename() {
        let root = project("create");
        let created = create(&root, "src/main/resources/data/x.json", false).unwrap();
        assert_eq!(created.path, "src/main/resources/data/x.json");
        assert!(create(&root, "src/main/resources/data/x.json", false).is_err());
        create(&root, "src/main/kotlin", true).unwrap();
        rename(
            &root,
            "src/main/resources/data/x.json",
            "src/main/resources/data/y.json",
        )
        .unwrap();
        assert!(root.join("src/main/resources/data/y.json").is_file());
        assert!(rename(&root, "src/main/resources/data/y.json", "build.gradle").is_err());
        assert!(rename(&root, "build.gradle", "../outside.gradle").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
