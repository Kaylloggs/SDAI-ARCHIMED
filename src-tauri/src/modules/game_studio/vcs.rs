//! Points de restauration et historique (§43, §56, §62, §85).
//!
//! Avec Git : un point de restauration est un commit de tout le dossier (fichiers ignorés
//! exclus), écrit avec un index temporaire et rangé sous `refs/gamestudio/checkpoints/<id>`.
//! La branche, l'index et l'historique de la personne ne bougent pas. Restaurer réécrit les
//! fichiers depuis ce commit (toujours avec un index temporaire), met à la Corbeille ceux qui
//! n'existaient pas, et prend d'abord un point de restauration de l'état courant : une
//! restauration s'annule donc elle aussi.
//!
//! Sans Git : Game Studio propose d'initialiser un dépôt (`init`) ; il ne copie pas de gros
//! projets moteur à l'aveugle.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::core::{AppError, AppResult};

use super::store::{state_dir, write_atomic};

/// Identité utilisée seulement si la personne n'a pas configuré Git.
const FALLBACK_NAME: &str = "ARCHIMED Game Studio";
const FALLBACK_EMAIL: &str = "game-studio@archimed.local";
const REF_PREFIX: &str = "refs/gamestudio/checkpoints/";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameCheckpoint {
    pub id: String,
    pub label: String,
    pub commit: String,
    pub at: String,
    /// « vous », « agent:programming », « automatique »…
    pub by: String,
    /// Fichiers différents du point précédent (indicatif).
    pub files: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameFileChangeKind {
    Added,
    Modified,
    Deleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameFileChange {
    pub path: String,
    pub kind: GameFileChangeKind,
}

/// État Git du projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameVcsState {
    pub git_available: bool,
    pub repository: bool,
    pub branch: Option<String>,
    /// Fichiers modifiés depuis le dernier commit de la personne.
    pub dirty: u32,
    pub lfs: bool,
    pub checkpoints: Vec<GameCheckpoint>,
}

pub fn git_binary() -> Option<PathBuf> {
    which::which("git").ok()
}

/// Lance git dans `root` et rend sa sortie ; l'erreur reprend le message de git.
fn git(root: &Path, args: &[&str], index: Option<&Path>) -> AppResult<String> {
    let binary = git_binary().ok_or_else(|| {
        AppError::cli_missing("Git n'est pas installé : installez-le depuis l'onglet Outils.")
    })?;
    let mut command = crate::core::process::command(binary);
    command
        .current_dir(root)
        .args(args)
        .stdin(Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    let output = command
        .output()
        .map_err(|e| AppError::internal(format!("git : {e}")))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        let last = err
            .lines()
            .rev()
            .find(|l| !l.trim().is_empty())
            .unwrap_or("échec");
        Err(AppError::internal(format!(
            "git {} : {}",
            args.first().unwrap_or(&""),
            last.trim()
        )))
    }
}

pub fn is_repository(root: &Path) -> bool {
    git_binary().is_some() && git(root, &["rev-parse", "--show-toplevel"], None).is_ok()
}

fn git_dir(root: &Path) -> AppResult<PathBuf> {
    let out = git(root, &["rev-parse", "--absolute-git-dir"], None)?;
    Ok(PathBuf::from(out.trim()))
}

fn head(root: &Path) -> Option<String> {
    git(root, &["rev-parse", "--verify", "-q", "HEAD"], None)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn identity_args(root: &Path) -> Vec<String> {
    let name = git(root, &["config", "user.name"], None)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let email = git(root, &["config", "user.email"], None)
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let mut args = Vec::new();
    if name.is_empty() {
        args.extend(["-c".to_string(), format!("user.name={FALLBACK_NAME}")]);
    }
    if email.is_empty() {
        args.extend(["-c".to_string(), format!("user.email={FALLBACK_EMAIL}")]);
    }
    args
}

/// Arbre Git de tout le dossier de travail (fichiers ignorés exclus), sans toucher l'index.
/// `.gamestudio/` (graphe, journal, liste des points) n'y entre jamais : revenir en arrière
/// ne doit pas effacer la mémoire du projet ni les points plus récents.
fn snapshot_tree(root: &Path) -> AppResult<String> {
    let index = git_dir(root)?.join("gamestudio-index");
    let _ = std::fs::remove_file(&index);
    if head(root).is_some() {
        git(root, &["read-tree", "HEAD"], Some(&index))?;
        git(
            root,
            &[
                "rm",
                "-r",
                "--cached",
                "-q",
                "--ignore-unmatch",
                "--",
                super::store::DIR,
            ],
            Some(&index),
        )?;
    }
    git(
        root,
        &[
            "add",
            "-A",
            "--",
            ".",
            &format!(":(exclude){}", super::store::DIR),
        ],
        Some(&index),
    )?;
    let tree = git(root, &["write-tree"], Some(&index))?.trim().to_string();
    let _ = std::fs::remove_file(&index);
    Ok(tree)
}

fn checkpoints_file(root: &Path) -> PathBuf {
    state_dir(root).join("checkpoints.json")
}

pub fn checkpoints(root: &Path) -> Vec<GameCheckpoint> {
    std::fs::read_to_string(checkpoints_file(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn save_checkpoints(root: &Path, list: &[GameCheckpoint]) -> AppResult<()> {
    write_atomic(
        &checkpoints_file(root),
        serde_json::to_string_pretty(list)?.as_bytes(),
    )
}

pub fn state(root: &Path) -> GameVcsState {
    let git_available = git_binary().is_some();
    let repository = git_available && is_repository(root);
    let branch = if repository {
        git(root, &["branch", "--show-current"], None)
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    let dirty = if repository {
        git(root, &["status", "--porcelain"], None)
            .map(|s| s.lines().count() as u32)
            .unwrap_or(0)
    } else {
        0
    };
    let lfs = repository
        && git(root, &["lfs", "env"], None).is_ok()
        && root.join(".gitattributes").is_file()
        && std::fs::read_to_string(root.join(".gitattributes"))
            .is_ok_and(|t| t.contains("filter=lfs"));
    GameVcsState {
        git_available,
        repository,
        branch,
        dirty,
        lfs,
        checkpoints: checkpoints(root),
    }
}

/// Initialise un dépôt Git (branche `main`), avec LFS si demandé et disponible, puis un
/// premier commit. Rend une phrase qui dit ce qui a été fait.
pub fn init(root: &Path, lfs_patterns: Option<&str>, message: &str) -> AppResult<String> {
    if is_repository(root) {
        return Ok("Le projet est déjà dans un dépôt Git.".to_string());
    }
    if git(root, &["init", "-b", "main"], None).is_err() {
        git(root, &["init"], None)?;
    }
    let mut notes = vec!["Dépôt Git créé".to_string()];
    if let Some(patterns) = lfs_patterns {
        if git(root, &["lfs", "install", "--local"], None).is_ok() {
            let path = root.join(".gitattributes");
            let mut text = std::fs::read_to_string(&path).unwrap_or_default();
            if !text.contains("filter=lfs") {
                text.push_str("# Gros fichiers binaires du moteur dans Git LFS (Game Studio)\n");
                text.push_str(patterns);
                write_atomic(&path, text.as_bytes())?;
            }
            notes.push("gros fichiers dans Git LFS".to_string());
        } else {
            notes.push("Git LFS absent : les fichiers binaires restent dans Git".to_string());
        }
    }
    let mut args: Vec<String> = identity_args(root);
    git(root, &["add", "-A"], None)?;
    args.extend([
        "commit".to_string(),
        "-q".to_string(),
        "--allow-empty".to_string(),
        "-m".to_string(),
        message.to_string(),
    ]);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git(root, &refs, None)?;
    notes.push("premier commit fait".to_string());
    Ok(format!("{}.", notes.join(", ")))
}

/// Prend un point de restauration de tout le dossier de travail.
pub fn checkpoint(root: &Path, label: &str, by: &str) -> AppResult<GameCheckpoint> {
    if !is_repository(root) {
        return Err(AppError::invalid(
            "Les points de restauration utilisent Git : initialisez le dépôt du projet (onglet Historique) avant.",
        ));
    }
    let tree = snapshot_tree(root)?;
    let parent = head(root);
    let mut args: Vec<String> = identity_args(root);
    args.extend([
        "commit-tree".to_string(),
        tree.clone(),
        "-m".to_string(),
        format!("Game Studio : {label}"),
    ]);
    if let Some(parent) = &parent {
        args.extend(["-p".to_string(), parent.clone()]);
    }
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let commit = git(root, &refs, None)?.trim().to_string();
    let id = super::graph::new_id("cp");
    git(
        root,
        &["update-ref", &format!("{REF_PREFIX}{id}"), &commit],
        None,
    )?;
    let mut list = checkpoints(root);
    let files = list
        .last()
        .and_then(|previous| {
            git(
                root,
                &["diff", "--name-only", &previous.commit, &commit],
                None,
            )
            .ok()
        })
        .map(|out| out.lines().count() as u32)
        .unwrap_or(0);
    let checkpoint = GameCheckpoint {
        id,
        label: label.to_string(),
        commit,
        at: chrono::Utc::now().to_rfc3339(),
        by: by.to_string(),
        files,
    };
    list.push(checkpoint.clone());
    // On garde les 200 derniers ; les plus anciens perdent leur référence.
    if list.len() > 200 {
        let excess = list.len() - 200;
        for old in list.drain(..excess) {
            let _ = git(
                root,
                &["update-ref", "-d", &format!("{REF_PREFIX}{}", old.id)],
                None,
            );
        }
    }
    save_checkpoints(root, &list)?;
    Ok(checkpoint)
}

fn find(root: &Path, id: &str) -> AppResult<GameCheckpoint> {
    checkpoints(root)
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::not_found("Point de restauration introuvable."))
}

fn parse_name_status(out: &str) -> Vec<GameFileChange> {
    out.lines()
        .filter_map(|line| {
            let mut parts = line.split('\t');
            let status = parts.next()?;
            let path = parts.next_back()?.to_string();
            let kind = match status.chars().next()? {
                'A' => GameFileChangeKind::Added,
                'D' => GameFileChangeKind::Deleted,
                _ => GameFileChangeKind::Modified,
            };
            Some(GameFileChange { path, kind })
        })
        .collect()
}

/// Fichiers qui ont changé depuis un point de restauration (du point de vue de l'état actuel).
pub fn changes_since(root: &Path, id: &str) -> AppResult<Vec<GameFileChange>> {
    let checkpoint = find(root, id)?;
    let current = snapshot_tree(root)?;
    let out = git(
        root,
        &[
            "diff",
            "--no-renames",
            "--name-status",
            &checkpoint.commit,
            &current,
        ],
        None,
    )?;
    Ok(parse_name_status(&out))
}

/// Diff unifié d'un fichier entre un point de restauration et maintenant.
pub fn file_diff(root: &Path, id: &str, path: &str) -> AppResult<String> {
    let checkpoint = find(root, id)?;
    let current = snapshot_tree(root)?;
    git(
        root,
        &[
            "diff",
            "--no-renames",
            &checkpoint.commit,
            &current,
            "--",
            path,
        ],
        None,
    )
}

/// Revient à un point de restauration (tout le projet, ou seulement `paths`). Un point de
/// l'état actuel est pris avant : la restauration s'annule avec lui.
pub fn restore(
    root: &Path,
    id: &str,
    paths: Option<&[String]>,
) -> AppResult<(GameCheckpoint, Vec<GameFileChange>)> {
    let target = find(root, id)?;
    let changes = changes_since(root, id)?;
    let selected: Vec<GameFileChange> = match paths {
        Some(paths) => changes
            .into_iter()
            .filter(|c| paths.iter().any(|p| p == &c.path))
            .collect(),
        None => changes,
    };
    let safety = checkpoint(
        root,
        &format!("Avant retour à « {} »", target.label),
        "automatique",
    )?;
    let to_write: Vec<&str> = selected
        .iter()
        .filter(|c| c.kind != GameFileChangeKind::Added)
        .map(|c| c.path.as_str())
        .collect();
    if !to_write.is_empty() {
        let index = git_dir(root)?.join("gamestudio-restore-index");
        let _ = std::fs::remove_file(&index);
        git(root, &["read-tree", &target.commit], Some(&index))?;
        for chunk in to_write.chunks(200) {
            let mut args = vec!["checkout-index", "-f", "--"];
            args.extend(chunk.iter().copied());
            git(root, &args, Some(&index))?;
        }
        let _ = std::fs::remove_file(&index);
    }
    for change in selected
        .iter()
        .filter(|c| c.kind == GameFileChangeKind::Added)
    {
        let file = root.join(&change.path);
        if file.exists() {
            trash::delete(&file)
                .map_err(|e| AppError::internal(format!("Corbeille ({}) : {e}", change.path)))?;
        }
    }
    Ok((safety, selected))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> Option<PathBuf> {
        git_binary()?;
        let dir = std::env::temp_dir().join(format!("gs-vcs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).ok()?;
        Some(dir)
    }

    #[test]
    fn checkpoints_leave_the_users_branch_alone_and_restore() {
        let Some(root) = repo("cp") else { return };
        std::fs::write(root.join(".gitignore"), "build/\n").unwrap();
        std::fs::write(root.join("main.gd"), "version 1\n").unwrap();
        let said = init(&root, None, "Création").unwrap();
        assert!(said.contains("premier commit"));
        let head_before = head(&root).unwrap();

        std::fs::write(root.join("main.gd"), "version 2\n").unwrap();
        let first = checkpoint(&root, "Avant l'inventaire", "vous").unwrap();
        assert_eq!(head(&root).unwrap(), head_before, "la branche ne bouge pas");
        assert!(
            git(&root, &["status", "--porcelain"], None)
                .unwrap()
                .contains("main.gd"),
            "l'index de la personne n'est pas touché"
        );

        std::fs::write(root.join("main.gd"), "version 3\n").unwrap();
        std::fs::write(root.join("inventory.gd"), "nouveau\n").unwrap();
        std::fs::create_dir_all(root.join("build")).unwrap();
        std::fs::write(root.join("build/game.exe"), "binaire").unwrap();
        let changes = changes_since(&root, &first.id).unwrap();
        assert_eq!(changes.len(), 2, "{changes:?}");
        assert!(
            changes.iter().all(|c| !c.path.starts_with(".gamestudio")),
            "la mémoire de Game Studio n'est jamais restaurée"
        );
        assert!(changes
            .iter()
            .any(|c| c.path == "inventory.gd" && c.kind == GameFileChangeKind::Added));
        assert!(file_diff(&root, &first.id, "main.gd")
            .unwrap()
            .contains("+version 3"));

        // Restauration partielle : seulement main.gd.
        let (safety, done) = restore(&root, &first.id, Some(&["main.gd".to_string()])).unwrap();
        assert_eq!(done.len(), 1);
        assert_eq!(
            std::fs::read_to_string(root.join("main.gd")).unwrap(),
            "version 2\n"
        );
        assert!(root.join("inventory.gd").exists());
        assert!(
            root.join("build/game.exe").exists(),
            "les fichiers ignorés ne sont jamais touchés"
        );

        // Et la restauration s'annule avec le point pris juste avant.
        restore(&root, &safety.id, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("main.gd")).unwrap(),
            "version 3\n"
        );
        assert_eq!(state(&root).checkpoints.len(), 3);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn works_before_the_first_commit_and_refuses_without_git() {
        let Some(root) = repo("empty") else { return };
        assert!(
            checkpoint(&root, "x", "vous").is_err(),
            "pas encore de dépôt"
        );
        git(&root, &["init"], None).unwrap();
        std::fs::write(root.join("a.txt"), "a").unwrap();
        let cp = checkpoint(&root, "Premier", "vous").unwrap();
        assert!(!cp.commit.is_empty());
        assert!(
            head(&root).is_none(),
            "aucun commit de la personne n'est créé"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
