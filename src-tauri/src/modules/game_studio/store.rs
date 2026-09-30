//! Rangement des projets.
//!
//! - Liste des projets connus : `<données>/modules/game-studio/projects.json` (chemins).
//! - Tout le reste vit dans le projet, qui reste autonome et versionnable :
//!   `<projet>/.gamestudio/project.json` (identité, réglages), `graph.json` (graphe de
//!   connaissance), `docs/` (documents générés), et, ignorés par Git : `logs/`, `builds/`, `cache/`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::{AppError, AppResult};

use super::types::{GameGraph, GameProject, GameProjectSummary, GameTaskStatus};

pub const DIR: &str = ".gamestudio";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub id: String,
    pub root: String,
    pub name: String,
    pub added_at: String,
    #[serde(default)]
    pub last_opened: Option<String>,
}

pub fn state_dir(root: &Path) -> PathBuf {
    root.join(DIR)
}

/// Écrit un fichier d'un coup (fichier temporaire puis renommage).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::from(e)
    })
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    write_atomic(path, serde_json::to_string_pretty(value)?.as_bytes())
}

pub struct Store {
    index_file: PathBuf,
}

impl Store {
    pub fn new(module_dir: &Path) -> Self {
        Self {
            index_file: module_dir.join("projects.json"),
        }
    }

    pub fn index(&self) -> Vec<IndexEntry> {
        std::fs::read_to_string(&self.index_file)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn save_index(&self, entries: &[IndexEntry]) -> AppResult<()> {
        write_json(&self.index_file, &entries)
    }

    pub fn register(&self, project: &GameProject) -> AppResult<()> {
        let mut entries = self.index();
        entries.retain(|e| e.id != project.id && !same_path(&e.root, &project.root));
        entries.insert(
            0,
            IndexEntry {
                id: project.id.clone(),
                root: project.root.clone(),
                name: project.name.clone(),
                added_at: chrono::Utc::now().to_rfc3339(),
                last_opened: Some(chrono::Utc::now().to_rfc3339()),
            },
        );
        self.save_index(&entries)
    }

    pub fn forget(&self, id: &str) -> AppResult<()> {
        let mut entries = self.index();
        let before = entries.len();
        entries.retain(|e| e.id != id);
        if entries.len() == before {
            return Err(AppError::not_found("Projet inconnu."));
        }
        self.save_index(&entries)
    }

    pub fn touch(&self, id: &str) {
        let mut entries = self.index();
        if let Some(entry) = entries.iter_mut().find(|e| e.id == id) {
            entry.last_opened = Some(chrono::Utc::now().to_rfc3339());
            let _ = self.save_index(&entries);
        }
    }

    /// Dossier d'un projet connu (par identifiant, nom exact ou chemin).
    pub fn root_of(&self, reference: &str) -> AppResult<PathBuf> {
        let entries = self.index();
        let found = entries
            .iter()
            .find(|e| e.id == reference)
            .or_else(|| entries.iter().find(|e| same_path(&e.root, reference)))
            .or_else(|| {
                let matches: Vec<&IndexEntry> = entries
                    .iter()
                    .filter(|e| e.name.eq_ignore_ascii_case(reference.trim()))
                    .collect();
                (matches.len() == 1).then(|| matches[0])
            })
            .ok_or_else(|| AppError::not_found(format!("Projet inconnu : {reference}.")))?;
        Ok(PathBuf::from(&found.root))
    }

    pub fn summaries(&self) -> Vec<GameProjectSummary> {
        self.index()
            .into_iter()
            .map(|entry| {
                let root = PathBuf::from(&entry.root);
                let project = load_project(&root).ok();
                let graph = load_graph(&root);
                let last_build = super::builds::last_status(&root);
                GameProjectSummary {
                    id: entry.id.clone(),
                    name: project
                        .as_ref()
                        .map(|p| p.name.clone())
                        .unwrap_or(entry.name.clone()),
                    root: entry.root.clone(),
                    engine: project.as_ref().and_then(|p| p.engine),
                    engine_version: project.as_ref().and_then(|p| p.engine_version.clone()),
                    mode: project.as_ref().map(|p| p.mode),
                    dimension: project.as_ref().map(|p| p.dimension),
                    available: project.is_some(),
                    systems: graph.systems.len() as u32,
                    open_tasks: graph
                        .tasks
                        .iter()
                        .filter(|t| {
                            !matches!(t.status, GameTaskStatus::Done | GameTaskStatus::Cancelled)
                        })
                        .count() as u32,
                    last_build,
                    updated_at: project.as_ref().map(|p| p.updated_at.clone()),
                    last_opened: entry.last_opened.clone(),
                }
            })
            .collect()
    }
}

/// Comparaison de chemins insensible à la casse et aux séparateurs (Windows).
pub fn same_path(a: &str, b: &str) -> bool {
    let norm = |p: &str| {
        p.trim()
            .trim_end_matches(['/', '\\'])
            .replace('\\', "/")
            .to_lowercase()
    };
    norm(a) == norm(b)
}

pub fn load_project(root: &Path) -> AppResult<GameProject> {
    let raw = std::fs::read_to_string(state_dir(root).join("project.json")).map_err(|_| {
        AppError::not_found(format!(
            "Aucun projet Game Studio dans {}.",
            super::engines::display(root)
        ))
    })?;
    let mut project: GameProject = serde_json::from_str(&raw)
        .map_err(|e| AppError::invalid(format!("project.json illisible : {e}")))?;
    // Le dossier a pu être déplacé : le chemin réel fait foi.
    project.root = super::engines::display(root);
    Ok(project)
}

pub fn save_project(project: &GameProject) -> AppResult<()> {
    let root = PathBuf::from(&project.root);
    write_json(&state_dir(&root).join("project.json"), project)?;
    ensure_state_gitignore(&root)
}

/// Graphe du projet (vide s'il manque ou s'il est illisible, avec une copie de sauvegarde).
pub fn load_graph(root: &Path) -> GameGraph {
    let path = state_dir(root).join("graph.json");
    match std::fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(graph) => graph,
            Err(error) => {
                tracing::warn!("graph.json illisible ({error}) : copie en graph.json.broken");
                let _ = std::fs::copy(&path, path.with_extension("json.broken"));
                GameGraph::default()
            }
        },
        Err(_) => GameGraph::default(),
    }
}

pub fn save_graph(root: &Path, graph: &GameGraph) -> AppResult<()> {
    write_json(&state_dir(root).join("graph.json"), graph)
}

/// `.gamestudio/.gitignore` : journaux, builds et caches restent locaux.
fn ensure_state_gitignore(root: &Path) -> AppResult<()> {
    let path = state_dir(root).join(".gitignore");
    if !path.exists() {
        write_atomic(
            &path,
            b"# Fichiers locaux de Game Studio\nlogs/\nbuilds/\ncache/\n*.tmp-*\n",
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::types::{GameAutonomy, GameDimension, GameMode};

    fn project(root: &Path) -> GameProject {
        GameProject {
            id: "p-1".into(),
            name: "Essai".into(),
            root: root.display().to_string(),
            engine: None,
            engine_version: None,
            mode: GameMode::Prototype,
            autonomy: GameAutonomy::Assisted,
            idea: "idée".into(),
            genres: vec![],
            dimension: GameDimension::TwoD,
            targets: vec![],
            budget: Default::default(),
            style: Default::default(),
            version: "0.1".into(),
            created_at: "x".into(),
            updated_at: "x".into(),
        }
    }

    #[test]
    fn projects_are_indexed_and_found() {
        let base = std::env::temp_dir().join(format!("gs-store-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("jeu");
        std::fs::create_dir_all(&root).unwrap();
        let store = Store::new(&base.join("module"));
        let p = project(&root);
        save_project(&p).unwrap();
        store.register(&p).unwrap();
        assert!(state_dir(&root).join(".gitignore").is_file());
        assert_eq!(store.root_of("p-1").unwrap(), root);
        assert_eq!(store.root_of("essai").unwrap(), root);
        assert_eq!(store.root_of(&root.display().to_string()).unwrap(), root);
        let summaries = store.summaries();
        assert_eq!(summaries.len(), 1);
        assert!(summaries[0].available);
        // Réinscrire le même dossier ne crée pas de doublon.
        store.register(&p).unwrap();
        assert_eq!(store.index().len(), 1);
        store.forget("p-1").unwrap();
        assert!(store.index().is_empty());
        assert!(
            root.join(".gamestudio/project.json").is_file(),
            "oublier ne supprime rien"
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn broken_graphs_are_kept_aside() {
        let root = std::env::temp_dir().join(format!("gs-graph-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(state_dir(&root)).unwrap();
        std::fs::write(state_dir(&root).join("graph.json"), "{ pas du json").unwrap();
        assert!(load_graph(&root).systems.is_empty());
        assert!(state_dir(&root).join("graph.json.broken").is_file());
        let _ = std::fs::remove_dir_all(&root);
    }
}
