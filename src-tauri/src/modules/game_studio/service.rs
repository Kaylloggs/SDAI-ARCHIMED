//! Logique de Game Studio, testable sans Tauri.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::core::{AppError, AppResult};

use super::analysis::{self, Installed};
use super::catalog::catalog;
use super::engines::{self, display, folder_name, NewProject};
use super::graph;
use super::journal;
use super::store::{self, Store};
use super::tools::{self, ToolOverrides};
use super::types::*;
use super::vcs;

/// Durée pendant laquelle le rapport d'environnement est réutilisé.
const ENV_TTL: Duration = Duration::from_secs(10 * 60);

pub struct GameStudio {
    dir: PathBuf,
    store: Store,
    env: Mutex<Option<(Instant, GameEnvironment)>>,
    /// Une modification du graphe à la fois (interface et agents écrivent le même fichier).
    graph_lock: Mutex<()>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Spécialité d'agent la plus proche d'une catégorie de système.
pub fn role_for(system: &GameSystem) -> GameAgentRole {
    use GameSystemCategory::*;
    match (system.category, system.id.as_str()) {
        (_, "animation") | (_, "procedural_animation") => GameAgentRole::Animation,
        (_, "lighting") | (_, "lod_culling") => GameAgentRole::Optimization,
        (Ai | Npc, _) => GameAgentRole::AiNpc,
        (World | Generation | Environment, _) => GameAgentRole::World,
        (Multiplayer, _) => GameAgentRole::Network,
        (Backend, _) => GameAgentRole::Backend,
        (Ui | Platform, _) => GameAgentRole::UiUx,
        (Audio, _) => GameAgentRole::Audio,
        (Visual, _) => GameAgentRole::Vfx,
        (Narrative, _) => GameAgentRole::GameDesign,
        _ => GameAgentRole::Programming,
    }
}

/// Ordre des systèmes où chaque dépendance précède ceux qui l'utilisent ; erreur en cas de cycle.
pub fn dependency_order(systems: &[GameSystem]) -> AppResult<Vec<GameSystem>> {
    let ids: HashSet<&str> = systems.iter().map(|s| s.id.as_str()).collect();
    let mut remaining: Vec<GameSystem> = systems.to_vec();
    for s in &mut remaining {
        s.dependencies
            .retain(|d| ids.contains(d.as_str()) && d != &s.id);
    }
    let mut placed: HashSet<String> = HashSet::new();
    let mut out = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        let before = remaining.len();
        let (ready, rest): (Vec<GameSystem>, Vec<GameSystem>) = remaining
            .into_iter()
            .partition(|s| s.dependencies.iter().all(|d| placed.contains(d)));
        for s in ready {
            placed.insert(s.id.clone());
            out.push(s);
        }
        remaining = rest;
        if remaining.len() == before {
            let names: Vec<String> = remaining.iter().map(|s| s.id.clone()).collect();
            return Err(AppError::invalid(format!(
                "Dépendances circulaires entre : {}.",
                names.join(", ")
            )));
        }
    }
    Ok(out)
}

/// Plan de départ : une tâche par système de la première phase, liées comme leurs systèmes,
/// précédée de la vérification du projet.
pub fn initial_tasks(
    systems: &[GameSystem],
    roadmap: &[GamePhase],
    engine: Option<GameEngine>,
) -> Vec<GameTask> {
    let at = now();
    let first_phase = roadmap.first();
    let wanted: HashSet<&str> = first_phase
        .map(|p| p.systems.iter().map(String::as_str).collect())
        .unwrap_or_default();
    let mut tasks = Vec::new();
    let check_id = "t-start".to_string();
    tasks.push(GameTask {
        id: check_id.clone(),
        title: "Vérifier que le projet s'ouvre et démarre".to_string(),
        description: match engine {
            Some(engine) => format!(
                "Préparer le projet dans {} puis lancer la vérification et le test de démarrage.",
                engine.label()
            ),
            None => {
                "Choisir le moteur du projet (Réglages du projet), puis le préparer.".to_string()
            }
        },
        status: GameTaskStatus::Todo,
        role: GameAgentRole::Build,
        depends_on: Vec::new(),
        systems: Vec::new(),
        files: Vec::new(),
        expected:
            "Le projet s'ouvre dans le moteur, la vérification et le test de démarrage réussissent."
                .to_string(),
        validation: "Le projet s'ouvre dans l'éditeur du moteur et la scène principale se lance sans erreur."
            .to_string(),
        phase: first_phase.map(|p| p.id.clone()),
        conversation_id: None,
        result: None,
        order: 1,
        created_at: at.clone(),
        updated_at: at.clone(),
    });
    let chosen: Vec<&GameSystem> = systems
        .iter()
        .filter(|s| wanted.contains(s.id.as_str()))
        .collect();
    let task_of: HashMap<&str, String> = chosen
        .iter()
        .map(|s| (s.id.as_str(), format!("t-{}", s.id)))
        .collect();
    for (index, system) in chosen.iter().enumerate() {
        let mut depends_on: Vec<String> = system
            .dependencies
            .iter()
            .filter_map(|d| task_of.get(d.as_str()).cloned())
            .collect();
        depends_on.push(check_id.clone());
        tasks.push(GameTask {
            id: format!("t-{}", system.id),
            title: format!("Implémenter : {}", system.name),
            description: system.role.clone(),
            status: GameTaskStatus::Todo,
            role: role_for(system),
            depends_on,
            systems: vec![system.id.clone()],
            files: Vec::new(),
            expected: format!(
                "{} fonctionne dans le jeu et respecte ses interfaces.",
                system.name
            ),
            validation: if system.tests.is_empty() {
                "Vérification du projet au vert.".to_string()
            } else {
                system.tests.join(" · ")
            },
            phase: first_phase.map(|p| p.id.clone()),
            conversation_id: None,
            result: None,
            order: index as u64 + 2,
            created_at: at.clone(),
            updated_at: at.clone(),
        });
    }
    tasks
}

impl GameStudio {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self {
            store: Store::new(&dir),
            dir,
            env: Mutex::new(None),
            graph_lock: Mutex::new(()),
        }
    }

    // ── Environnement ─────────────────────────────────────────────────────────────────

    pub fn environment(&self, refresh: bool) -> GameEnvironment {
        if !refresh {
            if let Ok(cache) = self.env.lock() {
                if let Some((at, env)) = cache.as_ref() {
                    if at.elapsed() < ENV_TTL {
                        return env.clone();
                    }
                }
            }
        }
        let env = tools::environment(&ToolOverrides::load(&self.dir));
        if let Ok(mut cache) = self.env.lock() {
            *cache = Some((Instant::now(), env.clone()));
        }
        env
    }

    pub fn set_tool_path(&self, tool: &str, path: Option<&str>) -> AppResult<GameEnvironment> {
        let known = [
            "godot", "unity", "unreal", "blender", "git", "python", "node", "dotnet",
        ];
        if !known.contains(&tool) {
            return Err(AppError::invalid(format!("Outil inconnu : {tool}.")));
        }
        let mut overrides = ToolOverrides::load(&self.dir);
        match path {
            Some(path) => {
                let valid = tools::validate_override(path)?;
                let list = overrides.paths.entry(tool.to_string()).or_default();
                let text = display(&valid);
                list.retain(|p| p != &text);
                list.insert(0, text);
            }
            None => {
                overrides.paths.remove(tool);
            }
        }
        overrides.save(&self.dir)?;
        Ok(self.environment(true))
    }

    fn installed_engines(&self) -> Installed {
        let env = self.environment(false);
        let mut engines: Vec<GameEngine> = env.engines.iter().map(|i| i.engine).collect();
        engines.dedup();
        Installed { engines }
    }

    // ── Analyse ───────────────────────────────────────────────────────────────────────

    pub fn analyze(&self, idea: &str) -> AppResult<GameAnalysis> {
        if idea.trim().is_empty() {
            return Err(AppError::invalid("Décrivez le jeu en une phrase ou plus."));
        }
        if idea.chars().count() > 20_000 {
            return Err(AppError::invalid(
                "Description trop longue (20 000 caractères au plus).",
            ));
        }
        analysis::analyze(idea, &self.installed_engines())
    }

    pub fn catalog(&self) -> AppResult<Vec<GameSystem>> {
        Ok(catalog()?.systems.iter().map(|s| s.to_system()).collect())
    }

    pub fn default_parent(&self) -> String {
        let base = engines::home()
            .map(|h| h.join("Documents"))
            .filter(|d| d.is_dir())
            .or_else(engines::home)
            .unwrap_or_else(std::env::temp_dir);
        display(&base.join("Game Studio"))
    }

    // ── Projets ───────────────────────────────────────────────────────────────────────

    pub fn create(&self, request: GameCreateRequest) -> AppResult<GameCreateOutcome> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AppError::invalid("Donnez un nom au jeu."));
        }
        if request.parent.trim().is_empty() {
            return Err(AppError::invalid(
                "Choisissez le dossier où créer le projet.",
            ));
        }
        let parent = PathBuf::from(request.parent.trim());
        std::fs::create_dir_all(&parent)?;
        let dir = parent.join(folder_name(name));
        let systems = dependency_order(&request.systems)?;

        let env = self.environment(false);
        let install = request
            .engine
            .and_then(|e| tools::pick_install(&env, e, request.engine_editor.as_deref()));
        let spec = NewProject {
            name: name.to_string(),
            dir: dir.clone(),
            dimension: request.dimension,
            description: request.idea.clone(),
            targets: request.targets.clone(),
            cpp: request.cpp,
        };
        let created = match request.engine {
            Some(engine) => engines::adapter(engine).create(&spec, install.as_ref())?,
            None => {
                engines::ensure_empty_dir(&dir)?;
                engines::Created {
                    files: Vec::new(),
                    notes: vec!["Aucun moteur choisi : le projet contient la conception ; choisissez le moteur dans ses réglages pour le créer.".to_string()],
                }
            }
        };

        let at = now();
        let project = GameProject {
            id: graph::new_id("g"),
            name: name.to_string(),
            root: display(&dir),
            engine: request.engine,
            engine_version: install.as_ref().and_then(|i| i.version.clone()),
            mode: request.mode,
            autonomy: request.autonomy,
            idea: request.idea.trim().to_string(),
            genres: request.genres.clone(),
            dimension: request.dimension,
            targets: request.targets.clone(),
            budget: GameBudget::default(),
            style: GameStyleGuide::default(),
            version: "0.1".to_string(),
            created_at: at.clone(),
            updated_at: at.clone(),
        };
        let mut g = GameGraph {
            systems: systems.clone(),
            assumptions: request.assumptions.clone(),
            decisions: request.decisions.clone(),
            world: request.world.clone(),
            network: request.network.clone(),
            roadmap: request.roadmap.clone(),
            tasks: initial_tasks(&systems, &request.roadmap, request.engine),
            ..GameGraph::default()
        };
        g.versions.push(GameVersion {
            version: "0.1".to_string(),
            label: "Création".to_string(),
            summary: format!(
                "{} systèmes prévus, {} tâches de départ.",
                g.systems.len(),
                g.tasks.len()
            ),
            checkpoint: None,
            at: at.clone(),
        });
        g.changes.push(GameChange {
            id: graph::new_id("c"),
            title: "Création du projet".to_string(),
            what: format!(
                "{} fichier(s) écrit(s) par l'adaptateur {}.",
                created.files.len(),
                request.engine.map(|e| e.label()).unwrap_or("(aucun)")
            ),
            why: "Nouveau jeu à partir de l'idée analysée.".to_string(),
            impact: "Projet vide et jouable, prêt pour la première phase.".to_string(),
            files: created.files.clone(),
            systems: Vec::new(),
            risks: Vec::new(),
            checkpoint: None,
            by: "vous".to_string(),
            at: at.clone(),
        });
        g.revision = 1;
        store::save_project(&project)?;
        store::save_graph(&dir, &g)?;
        self.store.register(&project)?;

        let mut notes = created.notes.clone();
        if request.git {
            let lfs = (request.engine == Some(GameEngine::Unreal))
                .then_some(engines::unreal::LFS_ATTRIBUTES);
            match vcs::init(
                &dir,
                lfs,
                &format!("Création de « {name} » par Game Studio"),
            ) {
                Ok(message) => notes.push(message),
                Err(e) => notes.push(format!("Git : {}", e.message)),
            }
        }
        journal::info(
            &dir,
            GameLogCategory::System,
            &format!(
                "Projet créé : {name} ({})",
                request.engine.map(|e| e.label()).unwrap_or("sans moteur")
            ),
        );
        Ok(GameCreateOutcome {
            project,
            files: created.files,
            notes,
        })
    }

    /// Ajoute un dossier de jeu existant (Godot, Unity, Unreal) ou un projet Game Studio.
    pub fn import(&self, root: &str) -> AppResult<GameProject> {
        let root = PathBuf::from(root.trim());
        if !root.is_dir() {
            return Err(AppError::not_found(format!(
                "Dossier introuvable : {}.",
                display(&root)
            )));
        }
        if let Ok(project) = store::load_project(&root) {
            self.store.register(&project)?;
            return Ok(project);
        }
        let (engine, info) = engines::detect_project(&root).ok_or_else(|| {
            AppError::invalid("Aucun projet Godot (project.godot), Unity (ProjectSettings) ou Unreal (.uproject) dans ce dossier.")
        })?;
        let at = now();
        let dimension =
            if engine == GameEngine::Godot && main_scene_is_2d(&root, info.main_scene.as_deref()) {
                GameDimension::TwoD
            } else {
                GameDimension::ThreeD
            };
        let project = GameProject {
            id: graph::new_id("g"),
            name: info.name.clone(),
            root: display(&root),
            engine: Some(engine),
            engine_version: info.engine_version.clone(),
            mode: GameMode::Existing,
            autonomy: GameAutonomy::Manual,
            idea: String::new(),
            genres: Vec::new(),
            dimension,
            targets: vec![GamePlatform::Windows],
            budget: GameBudget::default(),
            style: GameStyleGuide::default(),
            version: "0.1".to_string(),
            created_at: at.clone(),
            updated_at: at.clone(),
        };
        let mut g = store::load_graph(&root);
        g.assumptions.push(GameAssumption {
            id: graph::new_id("a"),
            topic: "dimension".to_string(),
            value: dimension.label().to_string(),
            reason: "Déduit du moteur et de la scène principale à l'import ; à corriger si besoin."
                .to_string(),
            status: GameAssumptionStatus::Editable,
            at: at.clone(),
        });
        g.revision += 1;
        store::save_project(&project)?;
        store::save_graph(&root, &g)?;
        self.store.register(&project)?;
        journal::info(
            &root,
            GameLogCategory::System,
            &format!(
                "Projet existant ajouté : {} ({})",
                project.name,
                engine.label()
            ),
        );
        Ok(project)
    }

    pub fn list(&self) -> Vec<GameProjectSummary> {
        self.store.summaries()
    }

    pub fn root(&self, id: &str) -> AppResult<PathBuf> {
        self.store.root_of(id)
    }

    pub fn state(&self, id: &str) -> AppResult<GameProjectState> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let g = store::load_graph(&root);
        self.store.touch(&project.id);
        let (engine_info, install, capabilities) = match project.engine {
            Some(engine) => {
                let adapter = engines::adapter(engine);
                let env = self.environment(false);
                let install = tools::pick_install(&env, engine, None);
                let info = adapter.inspect(&root).map(|p| GameEngineInfo {
                    name: p.name,
                    engine_version: p.engine_version,
                    main_scene: p.main_scene,
                    languages: p.languages,
                    packages: p.packages,
                });
                let caps = adapter.capabilities(Some(&root), install.as_ref());
                (info, install, caps)
            }
            None => (None, None, Vec::new()),
        };
        Ok(GameProjectState {
            project,
            graph: g,
            engine_info,
            install,
            capabilities,
        })
    }

    pub fn update(&self, id: &str, patch: GameProjectPatch) -> AppResult<GameProject> {
        let root = self.root(id)?;
        let mut project = store::load_project(&root)?;
        if let Some(name) = patch.name {
            let name = name.trim().to_string();
            if name.is_empty() {
                return Err(AppError::invalid("Le nom ne peut pas être vide."));
            }
            project.name = name;
        }
        if let Some(engine) = patch.engine {
            if project.engine != Some(engine) {
                return Err(AppError::invalid(if project.engine.is_none() {
                    "Le moteur se choisit avec « Choisir le moteur », qui écrit aussi ses fichiers dans le projet."
                } else {
                    "Le moteur d'un projet déjà créé ne change pas ici : un portage se fait comme une tâche (l'assistant peut la planifier)."
                }));
            }
        }
        if let Some(v) = patch.engine_version {
            project.engine_version = Some(v);
        }
        if let Some(v) = patch.mode {
            project.mode = v;
        }
        if let Some(v) = patch.autonomy {
            project.autonomy = v;
        }
        if let Some(v) = patch.idea {
            project.idea = v;
        }
        if let Some(v) = patch.genres {
            project.genres = v;
        }
        if let Some(v) = patch.dimension {
            project.dimension = v;
        }
        if let Some(v) = patch.targets {
            project.targets = v;
        }
        if let Some(v) = patch.budget {
            project.budget = v;
        }
        if let Some(v) = patch.style {
            project.style = v;
        }
        if let Some(v) = patch.version {
            project.version = v;
        }
        project.updated_at = now();
        store::save_project(&project)?;
        self.store.register(&project)?;
        journal::info(
            &root,
            GameLogCategory::System,
            "Réglages du projet modifiés",
        );
        Ok(project)
    }

    pub fn forget(&self, id: &str) -> AppResult<()> {
        self.store.forget(id)
    }

    /// Choisit le moteur d'un projet créé sans moteur, et écrit ses fichiers dans le dossier.
    pub fn set_engine(
        &self,
        id: &str,
        engine: GameEngine,
        editor: Option<&str>,
        cpp: bool,
    ) -> AppResult<(GameProject, Vec<String>)> {
        let root = self.root(id)?;
        let mut project = store::load_project(&root)?;
        if project.engine.is_some() {
            return Err(AppError::invalid("Ce projet a déjà un moteur : changer de moteur est un portage, à planifier comme une tâche."));
        }
        let env = self.environment(false);
        let install = tools::pick_install(&env, engine, editor);
        let spec = NewProject {
            name: project.name.clone(),
            dir: root.clone(),
            dimension: project.dimension,
            description: project.idea.clone(),
            targets: project.targets.clone(),
            cpp,
        };
        let created = engines::adapter(engine).create(&spec, install.as_ref())?;
        project.engine = Some(engine);
        project.engine_version = install.as_ref().and_then(|i| i.version.clone());
        project.updated_at = now();
        store::save_project(&project)?;
        let change = GameChange {
            id: graph::new_id("c"),
            title: format!("Moteur choisi : {}", engine.label()),
            what: format!("{} fichier(s) du moteur écrit(s).", created.files.len()),
            why: "Le projet avait été créé sans moteur.".to_string(),
            impact: "Le projet peut être préparé, vérifié et lancé.".to_string(),
            files: created.files.clone(),
            systems: Vec::new(),
            risks: Vec::new(),
            checkpoint: None,
            by: "vous".to_string(),
            at: now(),
        };
        self.graph_op(id, GameGraphOp::AddChange { change }, "vous")?;
        journal::info(
            &root,
            GameLogCategory::Engine,
            &format!("Moteur choisi : {}", engine.label()),
        );
        Ok((project, created.notes))
    }

    /// Applique une modification au graphe (sous verrou) et la note au journal.
    pub fn graph_op(&self, id: &str, op: GameGraphOp, by: &str) -> AppResult<(String, GameGraph)> {
        let root = self.root(id)?;
        let _guard = self
            .graph_lock
            .lock()
            .map_err(|_| AppError::internal("graphe verrouillé"))?;
        let mut g = store::load_graph(&root);
        let message = graph::apply(&mut g, op, by)?;
        store::save_graph(&root, &g)?;
        journal::info(&root, GameLogCategory::System, &format!("{message} ({by})"));
        Ok((message, g))
    }

    pub fn journal(
        &self,
        id: &str,
        category: Option<GameLogCategory>,
        limit: usize,
    ) -> AppResult<Vec<GameLogEntry>> {
        let root = self.root(id)?;
        Ok(journal::read(&root, category, limit.clamp(1, 2000)))
    }

    // ── Historique (Git) ──────────────────────────────────────────────────────────────

    pub fn vcs_state(&self, id: &str) -> AppResult<vcs::GameVcsState> {
        Ok(vcs::state(&self.root(id)?))
    }

    pub fn vcs_init(&self, id: &str) -> AppResult<String> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        if let Some(engine) = project.engine {
            let ignore = root.join(".gitignore");
            if !ignore.exists() {
                std::fs::write(&ignore, engines::adapter(engine).gitignore())?;
            }
        }
        let lfs =
            (project.engine == Some(GameEngine::Unreal)).then_some(engines::unreal::LFS_ATTRIBUTES);
        let message = vcs::init(
            &root,
            lfs,
            &format!("Début du suivi de « {} » par Game Studio", project.name),
        )?;
        journal::info(&root, GameLogCategory::System, &message);
        Ok(message)
    }

    pub fn checkpoint(&self, id: &str, label: &str, by: &str) -> AppResult<vcs::GameCheckpoint> {
        let root = self.root(id)?;
        let label = if label.trim().is_empty() {
            "Point de restauration"
        } else {
            label.trim()
        };
        let cp = vcs::checkpoint(&root, label, by)?;
        journal::info(
            &root,
            GameLogCategory::System,
            &format!("Point de restauration : {label}"),
        );
        Ok(cp)
    }

    pub fn checkpoint_changes(
        &self,
        id: &str,
        checkpoint: &str,
    ) -> AppResult<Vec<vcs::GameFileChange>> {
        vcs::changes_since(&self.root(id)?, checkpoint)
    }

    pub fn checkpoint_diff(&self, id: &str, checkpoint: &str, path: &str) -> AppResult<String> {
        vcs::file_diff(&self.root(id)?, checkpoint, path)
    }

    pub fn restore(
        &self,
        id: &str,
        checkpoint: &str,
        paths: Option<Vec<String>>,
        by: &str,
    ) -> AppResult<String> {
        let root = self.root(id)?;
        let (safety, done) = vcs::restore(&root, checkpoint, paths.as_deref())?;
        let message = format!(
            "{} fichier(s) remis comme au point de restauration ; l'état d'avant est gardé (« {} »).",
            done.len(),
            safety.label
        );
        crate::core::audit::record("game-studio.restore", &display(&root), &message, by);
        journal::log(
            &root,
            GameLogCategory::System,
            GameLogLevel::Warning,
            &message,
            None,
        );
        Ok(message)
    }
}

fn main_scene_is_2d(root: &Path, scene: Option<&str>) -> bool {
    let Some(scene) = scene.and_then(|s| s.strip_prefix("res://")) else {
        return false;
    };
    std::fs::read_to_string(root.join(scene))
        .ok()
        .and_then(|text| {
            text.lines()
                .find(|l| l.starts_with("[node "))
                .map(|l| l.contains("type=\"Node2D\"") || l.contains("type=\"Control\""))
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn studio(name: &str) -> (GameStudio, PathBuf) {
        let base = std::env::temp_dir().join(format!("gs-service-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        (GameStudio::new(base.join("module")), base)
    }

    fn request(
        analysis: &GameAnalysis,
        parent: &Path,
        engine: Option<GameEngine>,
    ) -> GameCreateRequest {
        GameCreateRequest {
            name: "Marée basse".to_string(),
            parent: parent.display().to_string(),
            engine,
            engine_editor: None,
            mode: analysis.mode,
            autonomy: GameAutonomy::Assisted,
            idea: analysis.idea.clone(),
            genres: analysis.genres.clone(),
            dimension: analysis.dimension,
            targets: analysis.targets.clone(),
            systems: analysis.systems.iter().map(|s| s.system.clone()).collect(),
            assumptions: analysis.assumptions.clone(),
            decisions: analysis.decisions.clone(),
            world: Some(analysis.world.clone()),
            network: Some(analysis.network.clone()),
            roadmap: analysis.roadmap.clone(),
            cpp: false,
            git: true,
        }
    }

    #[test]
    fn idea_to_project_with_graph_tasks_and_history() {
        let (studio, base) = studio("create");
        let analysis = studio.analyze("Un jeu de pêche relaxant en 2D avec une ville, des PNJ qui ont des routines et une économie.").unwrap();
        let outcome = studio
            .create(request(
                &analysis,
                &base.join("jeux"),
                Some(GameEngine::Godot),
            ))
            .unwrap();
        let root = PathBuf::from(&outcome.project.root);
        assert!(root.join("project.godot").is_file());
        assert!(root.join(".gamestudio/graph.json").is_file());

        let state = studio.state(&outcome.project.id).unwrap();
        assert_eq!(state.graph.systems.len(), analysis.systems.len());
        assert!(state.graph.tasks.iter().any(|t| t.id == "t-start"));
        assert!(state
            .graph
            .tasks
            .iter()
            .all(|t| t
                .depends_on
                .iter()
                .all(|d| state.graph.tasks.iter().any(|o| &o.id == d))));
        assert_eq!(
            state.engine_info.as_ref().map(|i| i.name.as_str()),
            Some("Marée basse")
        );
        assert!(!state.capabilities.is_empty());
        assert_eq!(
            graph::ready_tasks(&state.graph).len(),
            1,
            "seule la vérification est prête au départ"
        );

        // Graphe modifié par un agent.
        let (message, g) = studio
            .graph_op(
                &outcome.project.id,
                GameGraphOp::AddCatalogSystem {
                    id: "weather".into(),
                },
                "agent:world",
            )
            .unwrap();
        assert!(message.contains("Météo"), "{message}");
        assert!(g.systems.iter().any(|s| s.id == "weather"));
        assert!(studio
            .journal(&outcome.project.id, None, 50)
            .unwrap()
            .iter()
            .any(|e| e.message.contains("agent:world")));

        // Git initialisé à la création si disponible : un point de restauration est possible.
        if vcs::git_binary().is_some() {
            let vcs_state = studio.vcs_state(&outcome.project.id).unwrap();
            assert!(vcs_state.repository);
            let cp = studio
                .checkpoint(&outcome.project.id, "Avant la météo", "vous")
                .unwrap();
            std::fs::write(root.join("scripts/main.gd"), "extends Node2D\n").unwrap();
            let changes = studio
                .checkpoint_changes(&outcome.project.id, &cp.id)
                .unwrap();
            assert!(changes.iter().any(|c| c.path == "scripts/main.gd"));
            studio
                .restore(&outcome.project.id, &cp.id, None, "vous")
                .unwrap();
            assert!(std::fs::read_to_string(root.join("scripts/main.gd"))
                .unwrap()
                .contains("_ready"));
        }

        // Un dossier déjà utilisé est refusé.
        assert!(studio
            .create(request(
                &analysis,
                &base.join("jeux"),
                Some(GameEngine::Godot)
            ))
            .is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn design_only_projects_and_imports() {
        let (studio, base) = studio("import");
        let analysis = studio.analyze("Un FPS compétitif 5v5").unwrap();
        let outcome = studio
            .create(request(&analysis, &base.join("jeux"), None))
            .unwrap();
        assert!(outcome.notes.iter().any(|n| n.contains("Aucun moteur")));
        assert!(studio
            .update(
                &outcome.project.id,
                GameProjectPatch {
                    engine: Some(GameEngine::Godot),
                    ..Default::default()
                }
            )
            .is_err());
        let (with_engine, notes) = studio
            .set_engine(&outcome.project.id, GameEngine::Godot, None, false)
            .unwrap();
        assert_eq!(with_engine.engine, Some(GameEngine::Godot));
        assert!(!notes.is_empty());
        assert!(
            PathBuf::from(&with_engine.root)
                .join("project.godot")
                .is_file(),
            "fichiers écrits à côté de la conception"
        );
        assert!(PathBuf::from(&with_engine.root)
            .join(".gamestudio/graph.json")
            .is_file());
        assert!(
            studio
                .set_engine(&outcome.project.id, GameEngine::Unity, None, false)
                .is_err(),
            "un seul choix de moteur"
        );
        assert!(studio
            .update(
                &outcome.project.id,
                GameProjectPatch {
                    engine: Some(GameEngine::Unity),
                    ..Default::default()
                }
            )
            .is_err());

        // Import d'un projet Godot écrit à la main.
        let existing = base.join("ancien");
        std::fs::create_dir_all(existing.join("scenes")).unwrap();
        std::fs::write(existing.join("project.godot"), "config_version=5\n[application]\nconfig/name=\"Ancien\"\nrun/main_scene=\"res://scenes/m.tscn\"\n").unwrap();
        std::fs::write(
            existing.join("scenes/m.tscn"),
            "[gd_scene format=3]\n\n[node name=\"M\" type=\"Node2D\"]\n",
        )
        .unwrap();
        let imported = studio.import(&existing.display().to_string()).unwrap();
        assert_eq!(imported.mode, GameMode::Existing);
        assert_eq!(imported.dimension, GameDimension::TwoD);
        assert_eq!(studio.list().len(), 2);
        assert!(studio
            .import(&base.join("vide").display().to_string())
            .is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn cycles_are_refused_at_creation() {
        let mut a = catalog().unwrap().get("health").unwrap().to_system();
        let mut b = catalog().unwrap().get("damage").unwrap().to_system();
        a.dependencies = vec!["damage".into()];
        b.dependencies = vec!["health".into()];
        assert!(dependency_order(&[a, b]).is_err());
    }
}
