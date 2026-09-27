//! Dossier de travail d'une conversation : état git (branche, fichiers modifiés), diff d'un
//! fichier et liste des fichiers du projet (mentions `@` du Chat). Lecture seule : rien n'est
//! jamais écrit ni exécuté d'autre que `git` en lecture.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;
use ts_rs::TS;

use super::{AppError, AppResult};

/// Fichiers listés au plus pour les mentions.
const MAX_FILES: usize = 20_000;
/// Au-delà, le contenu d'un fichier n'est pas comparé.
const MAX_DIFF_BYTES: u64 = 1024 * 1024;
const SKIPPED: &[&str] = &[
    "node_modules", "target", "dist", "build", ".git", ".next", ".nuxt", ".svelte-kit", "__pycache__",
    ".venv", "venv", ".gradle", ".idea", ".vs", "out", "coverage", ".turbo", ".cache",
];
/// Liste des fichiers gardée quelques secondes : chaque frappe après `@` la réutilise.
const CACHE_FOR: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct GitFile {
    /// Chemin relatif au dépôt, avec `/`.
    pub path: String,
    /// `modified`, `added`, `deleted`, `renamed`, `untracked`, `conflicted`.
    pub status: String,
    #[ts(type = "number")]
    pub added: u64,
    #[ts(type = "number")]
    pub removed: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct GitStatus {
    /// Racine du dépôt.
    pub root: String,
    pub branch: Option<String>,
    #[ts(type = "number")]
    pub ahead: u64,
    #[ts(type = "number")]
    pub behind: u64,
    pub files: Vec<GitFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct FileDiff {
    /// Version enregistrée (`HEAD`) ; `None` : fichier nouveau.
    pub before: Option<String>,
    /// Version sur le disque ; `None` : fichier supprimé.
    pub after: Option<String>,
    /// Fichier binaire ou trop gros : pas de comparaison ligne à ligne.
    pub binary: bool,
}

#[derive(Default)]
pub struct FileIndex {
    cache: Mutex<HashMap<String, (Instant, Vec<String>)>>,
}

fn git(cwd: &Path, args: &[&str]) -> Option<String> {
    let output = super::process::command("git").arg("-C").arg(cwd).args(args).output().ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// État git du dossier ; `None` s'il n'est pas dans un dépôt (ou si git manque).
#[tauri::command]
pub async fn workspace_git_status(cwd: String) -> AppResult<Option<GitStatus>> {
    tauri::async_runtime::spawn_blocking(move || git_status(Path::new(&cwd)))
        .await
        .map_err(|e| AppError::internal(e.to_string()))
}

fn git_status(cwd: &Path) -> Option<GitStatus> {
    let root = git(cwd, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    let porcelain = git(cwd, &["status", "--porcelain=v1", "--branch", "-z", "--untracked-files=all"])?;
    let numstat = git(cwd, &["diff", "HEAD", "--numstat", "-z"]).unwrap_or_default();
    let (branch, ahead, behind, mut files) = parse_status(&porcelain);
    let counts = parse_numstat(&numstat);
    for file in &mut files {
        if let Some((added, removed)) = counts.get(&file.path) {
            file.added = *added;
            file.removed = *removed;
        } else if file.status == "untracked" {
            // Nouveau fichier jamais ajouté : toutes ses lignes comptent.
            file.added = std::fs::read_to_string(Path::new(&root).join(&file.path)).map(|t| t.lines().count() as u64).unwrap_or(0);
        }
    }
    Some(GitStatus { root, branch, ahead, behind, files })
}

/// `git status --porcelain=v1 --branch -z` → branche, avance, retard, fichiers.
fn parse_status(raw: &str) -> (Option<String>, u64, u64, Vec<GitFile>) {
    let mut branch = None;
    let (mut ahead, mut behind) = (0, 0);
    let mut files = Vec::new();
    let mut entries = raw.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        if let Some(head) = entry.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head).trim();
            branch = (!name.starts_with("HEAD (no branch)")).then(|| name.trim_start_matches("No commits yet on ").to_string());
            if let Some(tracking) = head.split_once('[').map(|(_, rest)| rest.trim_end_matches(']')) {
                for part in tracking.split(", ") {
                    if let Some(n) = part.strip_prefix("ahead ") {
                        ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix("behind ") {
                        behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        if entry.len() < 4 {
            continue;
        }
        let code = &entry[..2];
        let path = entry[3..].to_string();
        let status = match code {
            "??" => "untracked",
            c if c.contains('U') || c == "AA" || c == "DD" => "conflicted",
            c if c.contains('R') => "renamed",
            c if c.contains('A') => "added",
            c if c.contains('D') => "deleted",
            _ => "modified",
        };
        // Renommage : l'ancien chemin suit dans l'entrée suivante.
        if code.contains('R') || code.contains('C') {
            entries.next();
        }
        files.push(GitFile { path, status: status.to_string(), added: 0, removed: 0 });
    }
    (branch, ahead, behind, files)
}

/// `git diff --numstat -z` → chemin → (ajoutées, retirées). Binaire : `-` → 0.
fn parse_numstat(raw: &str) -> HashMap<String, (u64, u64)> {
    let mut counts = HashMap::new();
    let mut entries = raw.split('\0');
    while let Some(entry) = entries.next() {
        let mut parts = entry.splitn(3, '\t');
        let (Some(added), Some(removed), Some(path)) = (parts.next(), parts.next(), parts.next()) else { continue };
        let added = added.trim_start_matches('\n').parse().unwrap_or(0);
        let removed = removed.parse().unwrap_or(0);
        // Renommage : chemin vide, puis ancien et nouveau chemins.
        let path = if path.is_empty() {
            entries.next();
            entries.next().unwrap_or_default().to_string()
        } else {
            path.to_string()
        };
        counts.insert(path, (added, removed));
    }
    counts
}

/// Version enregistrée et version sur le disque d'un fichier du dépôt.
#[tauri::command]
pub async fn workspace_file_diff(root: String, path: String) -> AppResult<FileDiff> {
    tauri::async_runtime::spawn_blocking(move || file_diff(Path::new(&root), &path))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?
}

fn file_diff(root: &Path, relative: &str) -> AppResult<FileDiff> {
    let clean = safe_relative(relative).ok_or_else(|| AppError::invalid("Chemin refusé."))?;
    let full = root.join(&clean);
    let spec = format!("HEAD:{}", clean.to_string_lossy().replace('\\', "/"));
    let before = git(root, &["show", &spec]);
    let too_big = full.metadata().map(|m| m.len() > MAX_DIFF_BYTES).unwrap_or(false);
    let after = if full.is_file() && !too_big { std::fs::read(&full).ok() } else { None };
    let binary = too_big
        || after.as_ref().is_some_and(|bytes| bytes.iter().take(8000).any(|b| *b == 0))
        || before.as_ref().is_some_and(|text| text.contains('\0'));
    if binary {
        return Ok(FileDiff { before: None, after: None, binary: true });
    }
    Ok(FileDiff { before, after: after.map(|bytes| String::from_utf8_lossy(&bytes).into_owned()), binary: false })
}

/// Chemin relatif sans `..` ni racine.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let mut clean = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => clean.push(part),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!clean.as_os_str().is_empty()).then_some(clean)
}

/// Fichiers du dossier (chemins relatifs, `/`), dépendances et builds exclus.
#[tauri::command]
pub async fn workspace_files(index: State<'_, FileIndex>, cwd: String) -> AppResult<Vec<String>> {
    if let Ok(cache) = index.cache.lock() {
        if let Some((at, files)) = cache.get(&cwd) {
            if at.elapsed() < CACHE_FOR {
                return Ok(files.clone());
            }
        }
    }
    let root = PathBuf::from(&cwd);
    let files = tauri::async_runtime::spawn_blocking(move || list_files(&root))
        .await
        .map_err(|e| AppError::internal(e.to_string()))?;
    if let Ok(mut cache) = index.cache.lock() {
        cache.insert(cwd, (Instant::now(), files.clone()));
    }
    Ok(files)
}

fn list_files(root: &Path) -> Vec<String> {
    let mut files = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if path.is_dir() {
                if !SKIPPED.contains(&name.as_str()) && !name.starts_with('.') {
                    stack.push(path);
                }
                continue;
            }
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_string_lossy().replace('\\', "/"));
                if files.len() >= MAX_FILES {
                    return files;
                }
            }
        }
    }
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_branch_tracking_and_files() {
        let raw = "## main...origin/main [ahead 2, behind 1]\0 M src/app.ts\0?? notes.md\0A  src/new.ts\0R  src/b.ts\0src/a.ts\0UU conflit.txt\0";
        let (branch, ahead, behind, files) = parse_status(raw);
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!((ahead, behind), (2, 1));
        let statuses: Vec<(&str, &str)> = files.iter().map(|f| (f.path.as_str(), f.status.as_str())).collect();
        assert_eq!(
            statuses,
            [("src/app.ts", "modified"), ("notes.md", "untracked"), ("src/new.ts", "added"), ("src/b.ts", "renamed"), ("conflit.txt", "conflicted")]
        );
        assert_eq!(parse_status("## No commits yet on main\0").0.as_deref(), Some("main"));
    }

    #[test]
    fn reads_line_counts() {
        let counts = parse_numstat("3\t1\tsrc/app.ts\0-\t-\timage.png\0");
        assert_eq!(counts.get("src/app.ts"), Some(&(3, 1)));
        assert_eq!(counts.get("image.png"), Some(&(0, 0)));
    }

    #[test]
    fn lists_project_files_without_dependencies() {
        let root = std::env::temp_dir().join(format!("archimed-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for file in ["src/app.ts", "src/lib/util.ts", "node_modules/x/index.js", ".git/config", "README.md"] {
            let path = root.join(file);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, "x").unwrap();
        }
        assert_eq!(list_files(&root), ["README.md", "src/app.ts", "src/lib/util.ts"]);
        assert!(safe_relative("../secret").is_none());
        assert!(safe_relative("C:/Windows").is_none() || cfg!(not(windows)));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn diffs_a_file_against_head() {
        let root = std::env::temp_dir().join(format!("archimed-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let run = |args: &[&str]| {
            super::super::process::command("git").arg("-C").arg(&root).args(args).output().unwrap();
        };
        run(&["init", "-q"]);
        std::fs::write(root.join("a.txt"), "un\n").unwrap();
        run(&["add", "."]);
        run(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"]);
        std::fs::write(root.join("a.txt"), "un\ndeux\n").unwrap();
        std::fs::write(root.join("b.txt"), "neuf\n").unwrap();
        let status = git_status(&root).expect("dépôt");
        let a = status.files.iter().find(|f| f.path == "a.txt").unwrap();
        assert_eq!((a.status.as_str(), a.added, a.removed), ("modified", 1, 0));
        let b = status.files.iter().find(|f| f.path == "b.txt").unwrap();
        assert_eq!((b.status.as_str(), b.added), ("untracked", 1));
        let diff = file_diff(&root, "a.txt").unwrap();
        assert_eq!(diff.before.as_deref(), Some("un\n"));
        assert_eq!(diff.after.as_deref(), Some("un\ndeux\n"));
        assert!(file_diff(&root, "b.txt").unwrap().before.is_none());
        assert!(git_status(&std::env::temp_dir().join("archimed-pas-un-depot-xyz")).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }
}
