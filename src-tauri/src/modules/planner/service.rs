use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Runtime};

use crate::core::paths::Paths;
use crate::core::{AppError, AppResult};

use super::roadmap::{self, RoadmapDoc};

/// Événement émis quand un roadmap.md surveillé change sur disque.
pub const ROADMAP_CHANGED: &str = "planner:roadmap-changed";

/// Noms de fichiers reconnus comme roadmap à la racine d'un projet.
const ROADMAP_NAMES: &[&str] = &["roadmap.md", "ROADMAP.md", "Roadmap.md", "docs/roadmap.md"];

pub struct PlannerService {
    boards_file: PathBuf,
    watchers: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
}

impl PlannerService {
    pub fn new(paths: &Paths) -> AppResult<Self> {
        let dir = paths.module_dir("planner");
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            boards_file: dir.join("boards.json"),
            watchers: Mutex::new(HashMap::new()),
        })
    }

    /// Les tableaux sont stockés tels quels (JSON opaque) : leur schéma appartient au frontend.
    pub fn load_boards(&self) -> AppResult<serde_json::Value> {
        match std::fs::read_to_string(&self.boards_file) {
            Ok(raw) => Ok(serde_json::from_str(&raw)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(serde_json::Value::Array(Vec::new()))
            }
            Err(error) => Err(error.into()),
        }
    }

    /// Écriture atomique : un crash pendant la sauvegarde ne corrompt pas les tableaux.
    pub fn save_boards(&self, boards: &serde_json::Value) -> AppResult<()> {
        if !boards.is_array() {
            return Err(AppError::invalid("liste de tableaux attendue"));
        }
        let temp = self.boards_file.with_extension("json.tmp");
        std::fs::write(&temp, serde_json::to_vec_pretty(boards)?)?;
        std::fs::rename(&temp, &self.boards_file)?;
        Ok(())
    }

    pub fn read_roadmap(path: &Path) -> AppResult<RoadmapDoc> {
        let markdown = std::fs::read_to_string(path)
            .map_err(|e| AppError::not_found(format!("{} : {e}", path.display())))?;
        Ok(roadmap::parse(&markdown))
    }

    pub fn set_task_done(path: &Path, title: &str, done: bool) -> AppResult<RoadmapDoc> {
        let markdown = std::fs::read_to_string(path)?;
        let updated = roadmap::set_task_done(&markdown, title, done)?;
        std::fs::write(path, &updated)?;
        crate::core::audit::record(
            "planner.roadmap_task",
            &format!("{} · {title}", path.display()),
            if done { "done" } else { "todo" },
            "user",
        );
        Ok(roadmap::parse(&updated))
    }

    pub fn append_tasks(path: &Path, section: &str, tasks: &[String]) -> AppResult<RoadmapDoc> {
        let markdown = std::fs::read_to_string(path).unwrap_or_default();
        let updated = roadmap::append_tasks(&markdown, section, tasks);
        std::fs::write(path, &updated)?;
        crate::core::audit::record(
            "planner.roadmap_append",
            &format!("{} · {} tâche(s)", path.display(), tasks.len()),
            "ok",
            "user",
        );
        Ok(roadmap::parse(&updated))
    }

    /// Cherche un fichier de roadmap à la racine d'un projet.
    pub fn find_roadmap(root: &Path) -> Option<PathBuf> {
        ROADMAP_NAMES
            .iter()
            .map(|name| root.join(name))
            .find(|candidate| candidate.is_file())
    }

    /// Surveille un roadmap.md ; chaque modification émet `planner:roadmap-changed`.
    pub fn watch<R: Runtime>(&self, app: AppHandle<R>, path: &Path) -> AppResult<()> {
        let path = path.to_path_buf();
        let mut watchers = self
            .watchers
            .lock()
            .map_err(|_| AppError::internal("verrou des surveillances corrompu"))?;
        if watchers.contains_key(&path) {
            return Ok(());
        }

        let emitted = path.display().to_string();
        let target = path.clone();
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            let relevant = event.kind.is_modify() || event.kind.is_create();
            if relevant && event.paths.iter().any(|p| p.ends_with(target.file_name().unwrap_or_default())) {
                let _ = app.emit(ROADMAP_CHANGED, emitted.clone());
            }
        })
        .map_err(|e| AppError::internal(format!("surveillance impossible : {e}")))?;

        // On surveille le dossier parent : les éditeurs et les IA remplacent souvent le fichier.
        let parent = path
            .parent()
            .ok_or_else(|| AppError::invalid("chemin de roadmap sans dossier parent"))?;
        watcher
            .watch(parent, RecursiveMode::NonRecursive)
            .map_err(|e| AppError::internal(format!("surveillance impossible : {e}")))?;

        watchers.insert(path, watcher);
        Ok(())
    }

    pub fn unwatch(&self, path: &Path) {
        if let Ok(mut watchers) = self.watchers.lock() {
            watchers.remove(path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toggles_and_appends_on_disk() {
        let dir = std::env::temp_dir().join("archimed-planner-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("roadmap.md");
        std::fs::write(&file, "## Phase 1\n- [ ] Écrire les tests\n").unwrap();

        assert_eq!(PlannerService::find_roadmap(&dir), Some(file.clone()));

        let doc = PlannerService::set_task_done(&file, "Écrire les tests", true).unwrap();
        assert_eq!(doc.done, 1);
        assert!(std::fs::read_to_string(&file).unwrap().contains("- [x] Écrire les tests"));

        let doc = PlannerService::append_tasks(&file, "Phase 1", &["Relire".into()]).unwrap();
        assert_eq!(doc.total, 2);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
