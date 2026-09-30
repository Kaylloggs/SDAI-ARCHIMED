//! Logique de Game Studio, testable sans Tauri.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::core::{AppError, AppResult};

use super::agents;
use super::analysis::{self, Installed};
use super::builds;
use super::catalog::catalog;
use super::diagnostics;
use super::docs::{self, GameDocuments};
use super::engines::{self, display, folder_name, ActionContext, GameAction, NewProject};
use super::graph;
use super::journal;
use super::mcp_client::{self, GameMcpHealth, GameMcpOwnServer, GameMcpServer, GameMcpState};
use super::runner::{self, GameJobEvent, GameRunningJob, Jobs, PreparedJob, RunOutcome};
use super::scanner::{self, GameProjectMap, ScanInput};
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
    /// Action moteur en cours, par projet.
    jobs: Jobs,
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
        validation: "« Vérifier le code » et « Lancer les tests » réussis dans Build et tests."
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

/// Exécution dont l'analyse n'a pas pu se faire (tâche interrompue).
fn failed_record(summary: String) -> GameBuildRecord {
    GameBuildRecord {
        id: graph::new_id("run"),
        action: GameAction::Check,
        platform: None,
        development: false,
        status: GameBuildStatus::Failed,
        started_at: now(),
        duration_ms: 0,
        exit_code: None,
        command: String::new(),
        output: None,
        summary,
        diagnostics: Vec::new(),
        log_lines: 0,
    }
}

impl GameStudio {
    pub fn new(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self {
            store: Store::new(&dir),
            dir,
            env: Mutex::new(None),
            graph_lock: Mutex::new(()),
            jobs: Jobs::default(),
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
                let install =
                    tools::pick_install_for(&env, engine, project.engine_version.as_deref());
                let info = adapter.inspect(&root).map(|p| GameEngineInfo {
                    name: p.name,
                    engine_version: p.engine_version,
                    main_scene: p.main_scene,
                    languages: p.languages,
                    packages: p.packages,
                });
                let mut caps = adapter.capabilities(Some(&root), install.as_ref());
                caps.extend(self.mcp_capabilities(engine, &root));
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

    // ── Actions moteur ────────────────────────────────────────────────────────────────

    /// Vérifie que l'action est possible et réserve le projet ; la commande vient de
    /// l'adaptateur du moteur (erreur claire sinon : moteur absent, préréglage manquant…).
    pub fn prepare_action(
        &self,
        id: &str,
        action: GameAction,
        platform: Option<GamePlatform>,
        development: bool,
    ) -> AppResult<PreparedJob> {
        let (root, spec, platform) = self.action_command(id, action, platform, development)?;
        if spec.detached {
            return Err(AppError::invalid(
                "Cette action ouvre un programme sans le suivre : utilisez « Ouvrir l'éditeur ».",
            ));
        }
        let job_id = graph::new_id("run");
        let started_at = now();
        let cancelled = self.jobs.claim(
            id,
            GameRunningJob {
                job_id: job_id.clone(),
                action,
                started_at: started_at.clone(),
                command: runner::command_line(&spec),
            },
        )?;
        Ok(PreparedJob {
            project_id: id.to_string(),
            job_id,
            root,
            action,
            platform: (action == GameAction::Build).then_some(platform),
            development,
            spec,
            started_at,
            cancelled,
        })
    }

    fn action_command(
        &self,
        id: &str,
        action: GameAction,
        platform: Option<GamePlatform>,
        development: bool,
    ) -> AppResult<(PathBuf, engines::CommandSpec, GamePlatform)> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let engine = project.engine.ok_or_else(|| {
            AppError::invalid("Ce jeu n'a pas encore de moteur : choisissez-en un dans Réglages.")
        })?;
        let adapter = engines::adapter(engine);
        let install = tools::pick_install_for(
            &self.environment(false),
            engine,
            project.engine_version.as_deref(),
        )
        .ok_or_else(|| {
            AppError::cli_missing(format!(
                "{} n'est pas installé sur cette machine : installez-le depuis l'onglet Outils, ou désignez son exécutable.",
                engine.label()
            ))
        })?;
        let inspected = adapter.inspect(&root).ok_or_else(|| {
            AppError::not_found(format!(
                "Le dossier ne contient plus de projet {} lisible.",
                engine.label()
            ))
        })?;
        let platform = platform
            .or_else(|| project.targets.first().copied())
            .unwrap_or(GamePlatform::Windows);
        let ctx = ActionContext {
            root: &root,
            project: &inspected,
            install: &install,
            platform,
            development,
        };
        let spec = adapter.command(action, &ctx)?;
        Ok((root, spec, platform))
    }

    /// Ouvre l'éditeur du moteur sur le projet (sans l'attendre).
    pub fn open_editor(&self, id: &str) -> AppResult<String> {
        let (root, spec, _) = self.action_command(id, GameAction::Editor, None, false)?;
        runner::spawn_detached(&spec)?;
        journal::info(
            &root,
            GameLogCategory::Engine,
            &format!("Éditeur ouvert : {}", runner::command_line(&spec)),
        );
        Ok("Éditeur du moteur ouvert.".to_string())
    }

    /// Exécute l'action préparée ; les événements partent vers `emit` au fil de l'eau.
    pub async fn run_prepared(
        self: &std::sync::Arc<Self>,
        job: PreparedJob,
        emit: impl Fn(GameJobEvent) + Send + Sync + 'static,
    ) -> GameBuildRecord {
        emit(GameJobEvent::Started {
            job_id: job.job_id.clone(),
            action: job.action,
            command: runner::command_line(&job.spec),
            cwd: display(&job.spec.cwd),
            timeout_secs: job.spec.timeout.map(|t| t.as_secs()),
        });
        let since = std::time::SystemTime::now();
        let outcome = runner::run(&self.jobs, &job, journal::redact, &emit).await;
        self.jobs.release(&job.project_id, &job.job_id);
        let studio = self.clone();
        let record = tokio::task::spawn_blocking(move || studio.finish_job(&job, outcome, since))
            .await
            .unwrap_or_else(|e| failed_record(format!("analyse interrompue : {e}")));
        emit(GameJobEvent::Finished {
            record: record.clone(),
        });
        record
    }

    /// Verdict, erreurs expliquées, historique, journal et problèmes du graphe.
    fn finish_job(
        &self,
        job: &PreparedJob,
        outcome: RunOutcome,
        since: std::time::SystemTime,
    ) -> GameBuildRecord {
        let root = &job.root;
        let engine = store::load_project(root).ok().and_then(|p| p.engine);
        let mut diags = diagnostics::parse(&outcome.log, root, engine);
        let mut failed_tests = 0;
        if let Some(results) = job.spec.results.as_deref() {
            if runner::output_written(results, since) {
                let found =
                    diagnostics::parse_nunit(&std::fs::read_to_string(results).unwrap_or_default());
                failed_tests = found.len();
                diags.splice(0..0, found);
            }
        }
        diagnostics::attach_systems(&mut diags, &store::load_graph(root));
        let errors = diags
            .iter()
            .filter(|d| d.severity == GameIssueSeverity::Error)
            .count();
        let label = job.action.label();
        let first_error = diags
            .iter()
            .find(|d| d.severity == GameIssueSeverity::Error)
            .map(|d| match (&d.file, d.line) {
                (Some(f), Some(l)) => format!("{} ({f}:{l})", d.message),
                (Some(f), None) => format!("{} ({f})", d.message),
                _ => d.message.clone(),
            });
        let cause = first_error
            .as_ref()
            .map(|e| format!(" Première erreur : {e}"))
            .unwrap_or_default();
        let output = job
            .spec
            .output
            .as_ref()
            .filter(|o| runner::output_written(o, since));
        let marker_ok = job
            .spec
            .success_marker
            .as_ref()
            .is_none_or(|m| outcome.log.iter().any(|l| l.contains(m.as_str())));
        let seconds = outcome.duration.as_secs();

        let (status, summary) = if let Some(error) = &outcome.start_error {
            (GameBuildStatus::Failed, error.clone())
        } else if outcome.cancelled {
            (
                GameBuildStatus::Cancelled,
                match job.action {
                    GameAction::Run => "Jeu arrêté à votre demande.".to_string(),
                    _ => format!("{label} arrêtée à votre demande."),
                },
            )
        } else if outcome.timed_out {
            (
                GameBuildStatus::Failed,
                format!(
                    "{label} arrêtée : délai de {} min dépassé.{cause}",
                    job.spec.timeout.map(|t| t.as_secs() / 60).unwrap_or(0)
                ),
            )
        } else if outcome.exit_code != Some(0) {
            let code = outcome
                .exit_code
                .map(|c| format!("code {c}"))
                .unwrap_or_else(|| "arrêt anormal".to_string());
            let base = match job.action {
                GameAction::Run => format!("Le jeu s'est arrêté sur une erreur ({code})."),
                GameAction::Check => format!("Vérification échouée : {errors} erreur(s)."),
                GameAction::Test if failed_tests > 0 => {
                    format!("{failed_tests} test(s) échoué(s).")
                }
                _ => format!("{label} échouée ({code})."),
            };
            (GameBuildStatus::Failed, format!("{base}{cause}"))
        } else if !marker_ok {
            (
                GameBuildStatus::Failed,
                format!("{label} : le programme s'est arrêté avant la fin attendue.{cause}"),
            )
        } else if job.spec.strict && errors > 0 {
            (
                GameBuildStatus::Failed,
                format!("{errors} erreur(s) pendant l'exécution.{cause}"),
            )
        } else if failed_tests > 0 {
            (
                GameBuildStatus::Failed,
                format!("{failed_tests} test(s) échoué(s).{cause}"),
            )
        } else if job.spec.output.is_some() && output.is_none() {
            (
                GameBuildStatus::Failed,
                format!(
                    "Le build s'est terminé sans produire {}.",
                    job.spec.output.as_deref().map(display).unwrap_or_default()
                ),
            )
        } else {
            let warnings = diags.len() - errors;
            let note = if warnings > 0 {
                format!(" {warnings} avertissement(s).")
            } else {
                String::new()
            };
            let text = match job.action {
                GameAction::Setup => format!("Projet préparé en {seconds} s.{note}"),
                GameAction::Check => format!("Vérification réussie : aucun code en erreur.{note}"),
                GameAction::Test => format!("Tests réussis en {seconds} s.{note}"),
                GameAction::Build => format!(
                    "Build produit : {}.{note}",
                    output.map(|o| display(o)).unwrap_or_default()
                ),
                GameAction::Run => "Partie terminée : le jeu s'est fermé normalement.".to_string(),
                GameAction::Editor => "Éditeur fermé.".to_string(),
            };
            (GameBuildStatus::Success, text)
        };

        let record = GameBuildRecord {
            id: job.job_id.clone(),
            action: job.action,
            platform: job.platform,
            development: job.development,
            status,
            started_at: job.started_at.clone(),
            duration_ms: outcome.duration.as_millis() as u64,
            exit_code: outcome.exit_code,
            command: runner::command_line(&job.spec),
            output: output.map(|o| display(o)),
            summary: summary.clone(),
            diagnostics: diags.clone(),
            log_lines: outcome.log.len() as u32,
        };
        builds::save(root, &record, &outcome.log);
        let category = match job.action {
            GameAction::Setup | GameAction::Build => GameLogCategory::Build,
            GameAction::Check | GameAction::Test => GameLogCategory::Test,
            GameAction::Run | GameAction::Editor => GameLogCategory::Engine,
        };
        let level = match status {
            GameBuildStatus::Failed => GameLogLevel::Error,
            GameBuildStatus::Cancelled => GameLogLevel::Warning,
            _ => GameLogLevel::Info,
        };
        journal::log(root, category, level, &summary, Some(&record.command));
        crate::core::audit::record(
            "game-studio.run",
            &record.command,
            &format!("{status:?}").to_lowercase(),
            "user",
        );
        self.track_issue(&job.project_id, job.action, status, &summary, &diags);
        if status == GameBuildStatus::Success {
            self.complete_start_task(&job.project_id, root);
        }
        record
    }

    /// La tâche de départ est faite quand la vérification et le test de démarrage ont réussi
    /// (les dernières exécutions de chacun).
    fn complete_start_task(&self, id: &str, root: &Path) {
        let history = builds::history(root);
        let last_ok = |action: GameAction| {
            history
                .iter()
                .rev()
                .find(|r| r.action == action)
                .is_some_and(|r| r.status == GameBuildStatus::Success)
        };
        let pending = store::load_graph(root).tasks.iter().any(|t| {
            t.id == "t-start"
                && matches!(
                    t.status,
                    GameTaskStatus::Todo | GameTaskStatus::Running | GameTaskStatus::Failed
                )
        });
        if pending && last_ok(GameAction::Check) && last_ok(GameAction::Test) {
            let _ = self.graph_op(
                id,
                GameGraphOp::SetTaskStatus {
                    id: "t-start".to_string(),
                    status: GameTaskStatus::Done,
                    result: Some("Vérification et test de démarrage réussis.".to_string()),
                    conversation_id: None,
                },
                "Game Studio",
            );
        }
    }

    /// Un échec devient un problème du projet ; la même action réussie le referme.
    fn track_issue(
        &self,
        id: &str,
        action: GameAction,
        status: GameBuildStatus,
        summary: &str,
        diags: &[GameDiagnostic],
    ) {
        if status == GameBuildStatus::Cancelled {
            return;
        }
        let Ok(root) = self.root(id) else { return };
        let source = format!("run:{}", action.slug());
        let open: Vec<String> = store::load_graph(&root)
            .issues
            .iter()
            .filter(|i| i.open && i.source.as_deref() == Some(source.as_str()))
            .map(|i| i.id.clone())
            .collect();
        for issue in open {
            let _ = self.graph_op(
                id,
                GameGraphOp::SetIssueOpen {
                    id: issue,
                    open: false,
                },
                "Game Studio",
            );
        }
        if status == GameBuildStatus::Failed {
            let detail = diags
                .iter()
                .filter(|d| d.severity == GameIssueSeverity::Error)
                .take(5)
                .map(|d| match (&d.file, d.line) {
                    (Some(f), Some(l)) => format!("{f}:{l} — {}", d.message),
                    (Some(f), None) => format!("{f} — {}", d.message),
                    _ => d.message.clone(),
                })
                .collect::<Vec<_>>()
                .join("\n");
            let mut systems: Vec<String> = diags.iter().flat_map(|d| d.systems.clone()).collect();
            systems.sort();
            systems.dedup();
            let _ = self.graph_op(
                id,
                GameGraphOp::AddIssue {
                    title: summary.chars().take(300).collect(),
                    detail,
                    severity: GameIssueSeverity::Error,
                    systems,
                    source: Some(source),
                },
                "Game Studio",
            );
        }
    }

    pub fn cancel_action(&self, id: &str) -> AppResult<()> {
        self.jobs.cancel(id)
    }

    pub fn current_action(&self, id: &str) -> Option<GameRunningJob> {
        self.jobs.current(id)
    }

    pub fn runs(&self, id: &str) -> AppResult<Vec<GameBuildRecord>> {
        let mut runs = builds::history(&self.root(id)?);
        runs.reverse();
        Ok(runs)
    }

    /// Journal complet d'une exécution (la fin, s'il est très long).
    pub fn run_log(&self, id: &str, run_id: &str) -> AppResult<String> {
        if !run_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err(AppError::invalid("Identifiant d'exécution invalide."));
        }
        let text = std::fs::read_to_string(builds::log_path(&self.root(id)?, run_id))
            .map_err(|_| AppError::not_found("Journal de cette exécution introuvable."))?;
        const MAX: usize = 2 * 1024 * 1024;
        if text.len() <= MAX {
            return Ok(text);
        }
        let mut start = text.len() - MAX;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        Ok(format!("[… début coupé]\n{}", &text[start..]))
    }

    // ── Carte du projet ───────────────────────────────────────────────────────────────

    pub fn scan(&self, id: &str) -> AppResult<GameProjectMap> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let graph = store::load_graph(&root);
        let adapter = project.engine.map(engines::adapter);
        let main_scene = adapter
            .as_ref()
            .and_then(|a| a.inspect(&root))
            .map(|p| p.main_scene);
        let installed_versions = project
            .engine
            .map(|engine| {
                self.environment(false)
                    .engines
                    .iter()
                    .filter(|i| i.engine == engine)
                    .filter_map(|i| i.version.clone())
                    .collect()
            })
            .unwrap_or_default();
        let ignored: Vec<&str> = adapter
            .as_ref()
            .map(|a| a.ignored_dirs().to_vec())
            .unwrap_or_default();
        let map = scanner::scan(&ScanInput {
            root: &root,
            ignored: &ignored,
            graph: &graph,
            main_scene,
            engine_version: project.engine_version.clone(),
            installed_versions,
            git: vcs::is_repository(&root),
        })?;
        journal::info(
            &root,
            GameLogCategory::System,
            &format!(
                "Projet analysé : {} fichiers ({} modifiés), {} systèmes repérés, {} risques.",
                map.files,
                map.changed,
                map.systems.len(),
                map.risks.len()
            ),
        );
        Ok(map)
    }

    pub fn map(&self, id: &str) -> AppResult<Option<GameProjectMap>> {
        Ok(scanner::load_map(&self.root(id)?))
    }

    // ── Serveurs MCP ──────────────────────────────────────────────────────────────────

    fn mcp_entries(&self, root: Option<PathBuf>) -> Vec<mcp_client::Entry> {
        mcp_client::Locations::system(root, mcp_client::load_own(&self.dir))
            .map(|loc| mcp_client::discover(&loc))
            .unwrap_or_default()
    }

    /// Serveurs MCP de la machine (et du projet), avec le résultat de leur dernier test.
    pub fn mcp_servers(&self, project: Option<&str>) -> Vec<GameMcpServer> {
        let root = project.and_then(|id| self.root(id).ok());
        let health = mcp_client::load_health(&self.dir);
        self.mcp_entries(root)
            .into_iter()
            .map(|e| {
                let mut server = e.server;
                server.health = health.get(&server.key).cloned();
                server
            })
            .collect()
    }

    /// Teste un serveur pour de vrai (lancement ou connexion, `initialize`, `tools/list`).
    pub async fn check_mcp(&self, key: &str, project: Option<&str>) -> AppResult<GameMcpHealth> {
        let root = project.and_then(|id| self.root(id).ok());
        let entry = self
            .mcp_entries(root)
            .into_iter()
            .find(|e| e.server.key == key)
            .ok_or_else(|| AppError::not_found("Serveur MCP introuvable : relisez la liste."))?;
        crate::core::audit::record(
            "game-studio.mcp.check",
            &entry.server.key,
            "started",
            "user",
        );
        let result = mcp_client::check(&entry).await;
        let mut all = mcp_client::load_health(&self.dir);
        all.insert(key.to_string(), result.clone());
        mcp_client::save_health(&self.dir, &all);
        Ok(result)
    }

    /// Ajoute (ou remplace) un serveur déclaré aux agents d'ARCHIMED.
    pub fn add_mcp(&self, server: GameMcpOwnServer) -> AppResult<Vec<GameMcpServer>> {
        let server = mcp_client::validate(&server)?;
        let mut own = mcp_client::load_own(&self.dir);
        own.retain(|s| s.name != server.name);
        own.push(server);
        mcp_client::save_own(&self.dir, crate::core::mcp::dir().as_deref(), &own)?;
        Ok(self.mcp_servers(None))
    }

    pub fn remove_mcp(&self, name: &str) -> AppResult<Vec<GameMcpServer>> {
        let mut own = mcp_client::load_own(&self.dir);
        let before = own.len();
        own.retain(|s| s.name != name);
        if own.len() == before {
            return Err(AppError::not_found(
                "Ce serveur n'a pas été ajouté dans Game Studio.",
            ));
        }
        mcp_client::save_own(&self.dir, crate::core::mcp::dir().as_deref(), &own)?;
        Ok(self.mcp_servers(None))
    }

    /// Pilotage de l'éditeur par un serveur MCP du moteur : disponible seulement une fois testé.
    fn mcp_capabilities(&self, engine: GameEngine, root: &Path) -> Vec<GameCapability> {
        let health = mcp_client::load_health(&self.dir);
        self.mcp_entries(Some(root.to_path_buf()))
            .into_iter()
            .filter(|e| e.server.target.as_deref() == Some(engine.slug()))
            .map(|e| {
                let checked = health.get(&e.server.key);
                let (available, detail) = match checked {
                    Some(h) if h.state == GameMcpState::Ok => {
                        let names: Vec<&str> =
                            h.tools.iter().take(6).map(|t| t.name.as_str()).collect();
                        (
                            Some(true),
                            Some(format!(
                                "{} outil(s) : {}{}",
                                h.tools.len(),
                                names.join(", "),
                                if h.tools.len() > 6 { "…" } else { "" }
                            )),
                        )
                    }
                    Some(h) => (Some(false), Some(h.message.clone())),
                    None => (None, None),
                };
                GameCapability {
                    id: format!("mcp:{}", e.server.key),
                    label: format!("Piloter {} par MCP ({})", engine.label(), e.server.name),
                    via: GameCapabilityVia::Mcp,
                    requires: Some(format!(
                        "Serveur testé dans Intégrations ; agents : {}",
                        e.server.agents.join(", ")
                    )),
                    available,
                    detail,
                }
            })
            .collect()
    }

    // ── Agents et documents ───────────────────────────────────────────────────────────

    fn engine_info(&self, root: &Path, project: &GameProject) -> Option<GameEngineInfo> {
        project
            .engine
            .and_then(|e| engines::adapter(e).inspect(root))
            .map(|p| GameEngineInfo {
                name: p.name,
                engine_version: p.engine_version,
                main_scene: p.main_scene,
                languages: p.languages,
                packages: p.packages,
            })
    }

    /// Consignes d'un agent (prompt système) pour ce projet et ce rôle.
    pub fn agent_instructions(&self, id: &str, role: GameAgentRole) -> AppResult<String> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let graph = store::load_graph(&root);
        let info = self.engine_info(&root, &project);
        Ok(agents::instructions(&project, &graph, role, info.as_ref()))
    }

    /// Premier message pour l'agent chargé d'une tâche.
    pub fn task_request(&self, id: &str, task: &str) -> AppResult<String> {
        let root = self.root(id)?;
        let graph = store::load_graph(&root);
        let found = graph
            .tasks
            .iter()
            .find(|t| t.id == task)
            .ok_or_else(|| AppError::not_found("Tâche introuvable."))?;
        Ok(agents::task_request(found, &graph))
    }

    pub fn documents(&self, id: &str) -> AppResult<GameDocuments> {
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let graph = store::load_graph(&root);
        let info = self.engine_info(&root, &project);
        Ok(GameDocuments {
            gdd: docs::gdd(&project, &graph),
            tdd: docs::tdd(&project, &graph, info.as_ref()),
        })
    }

    /// Écrit `docs/GDD.md` et `docs/TDD.md` dans le projet, après un point de restauration.
    pub fn write_documents(&self, id: &str, by: &str) -> AppResult<Vec<String>> {
        let root = self.root(id)?;
        let documents = self.documents(id)?;
        let checkpoint = if vcs::is_repository(&root) {
            Some(vcs::checkpoint(&root, "Avant la mise à jour des documents", by)?.id)
        } else {
            None
        };
        std::fs::create_dir_all(root.join("docs"))?;
        let mut written = Vec::new();
        for (path, body) in [
            (docs::GDD_PATH, &documents.gdd),
            (docs::TDD_PATH, &documents.tdd),
        ] {
            let target = root.join(path);
            if std::fs::read_to_string(&target).ok().as_deref() != Some(body.as_str()) {
                store::write_atomic(&target, body.as_bytes())?;
                written.push(path.to_string());
            }
        }
        if !written.is_empty() {
            let change = GameChange {
                id: graph::new_id("c"),
                title: "Documents du projet".to_string(),
                what: format!("{} écrit(s) depuis le graphe.", written.join(", ")),
                why: "Garder le GDD et le TDD alignés sur les systèmes, décisions et hypothèses."
                    .to_string(),
                impact: String::new(),
                files: written.clone(),
                systems: Vec::new(),
                risks: Vec::new(),
                checkpoint,
                by: by.to_string(),
                at: now(),
            };
            self.graph_op(id, GameGraphOp::AddChange { change }, by)?;
        }
        Ok(written)
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

        // Documents : écrits une fois, puis rien tant que le graphe ne change pas.
        let written = studio.write_documents(&outcome.project.id, "vous").unwrap();
        assert_eq!(written, vec![docs::GDD_PATH, docs::TDD_PATH]);
        assert!(PathBuf::from(&with_engine.root).join(docs::GDD_PATH).is_file());
        assert!(studio.write_documents(&outcome.project.id, "vous").unwrap().is_empty());
        let instructions = studio
            .agent_instructions(&outcome.project.id, GameAgentRole::Director)
            .unwrap();
        assert!(instructions.contains("Directeur"));
        assert!(studio.task_request(&outcome.project.id, "t-start").unwrap().contains("t-start"));

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

    #[tokio::test]
    #[ignore = "demande Godot 4 : GAMESTUDIO_GODOT=<chemin de l'exécutable>"]
    async fn real_godot_actions_are_run_explained_and_tracked() {
        let Ok(godot) = std::env::var("GAMESTUDIO_GODOT") else {
            return;
        };
        let (studio, base) = studio("actions");
        let studio = std::sync::Arc::new(studio);
        studio.set_tool_path("godot", Some(&godot)).unwrap();
        let analysis = studio
            .analyze("Un petit jeu de plateforme en 2D avec des pièces à ramasser.")
            .unwrap();
        let outcome = studio
            .create(request(
                &analysis,
                &base.join("jeux"),
                Some(GameEngine::Godot),
            ))
            .unwrap();
        let id = outcome.project.id.clone();
        let root = PathBuf::from(&outcome.project.root);
        let run = |action| {
            let job = studio.prepare_action(&id, action, None, false).unwrap();
            studio.run_prepared(job, |_| {})
        };

        let setup = run(GameAction::Setup).await;
        assert_eq!(setup.status, GameBuildStatus::Success, "{}", setup.summary);
        let check = run(GameAction::Check).await;
        assert_eq!(check.status, GameBuildStatus::Success, "{}", check.summary);

        // Erreur de script : échec expliqué, problème ouvert, rattaché au fichier.
        std::fs::write(
            root.join("scripts/casse.gd"),
            "extends Node\nfunc f() -> void:\n\tvar x: int = \"texte\"\n",
        )
        .unwrap();
        let broken = run(GameAction::Check).await;
        assert_eq!(broken.status, GameBuildStatus::Failed, "{}", broken.summary);
        let first = &broken.diagnostics[0];
        assert_eq!(first.file.as_deref(), Some("scripts/casse.gd"));
        assert_eq!(first.line, Some(3));
        assert!(first.likely_cause.is_some());
        assert!(
            broken.summary.contains("scripts/casse.gd:3"),
            "{}",
            broken.summary
        );
        let open = |g: &GameGraph| {
            g.issues
                .iter()
                .filter(|i| i.open && i.source.as_deref() == Some("run:check"))
                .count()
        };
        assert_eq!(open(&store::load_graph(&root)), 1);

        // Corrigé : la vérification repasse et referme le problème.
        std::fs::remove_file(root.join("scripts/casse.gd")).unwrap();
        let fixed = run(GameAction::Check).await;
        assert_eq!(fixed.status, GameBuildStatus::Success, "{}", fixed.summary);
        assert_eq!(open(&store::load_graph(&root)), 0);

        // Erreur à l'exécution : Godot finit à 0, le test de démarrage échoue quand même.
        std::fs::write(
            root.join("scripts/main.gd"),
            "extends Node2D\n\nfunc _ready() -> void:\n\tvar n: Node = null\n\tn.queue_free()\n",
        )
        .unwrap();
        let test = run(GameAction::Test).await;
        assert_eq!(test.status, GameBuildStatus::Failed, "{}", test.summary);
        assert!(test
            .diagnostics
            .iter()
            .any(|d| d.file.as_deref() == Some("scripts/main.gd") && d.line == Some(5)));

        // Une action à la fois ; l'historique et le journal complet sont lisibles.
        let held = studio
            .prepare_action(&id, GameAction::Check, None, false)
            .unwrap();
        assert!(studio
            .prepare_action(&id, GameAction::Test, None, false)
            .is_err());
        assert_eq!(
            studio.current_action(&id).map(|j| j.action),
            Some(GameAction::Check)
        );
        studio.run_prepared(held, |_| {}).await;
        let runs = studio.runs(&id).unwrap();
        assert_eq!(runs.len(), 6);
        assert_eq!(runs[0].action, GameAction::Check, "le plus récent d'abord");
        assert_eq!(runs[1].action, GameAction::Test);
        assert!(studio
            .run_log(&id, &runs[1].id)
            .unwrap()
            .contains("queue_free"));
        assert!(studio.run_log(&id, "../../etc/passwd").is_err());

        // Export sans modèles : refusé avant de lancer quoi que ce soit, avec la marche à suivre.
        if let Err(e) =
            studio.prepare_action(&id, GameAction::Build, Some(GamePlatform::Windows), false)
        {
            assert!(e.message.contains("export"), "{}", e.message);
        }
        assert!(studio.current_action(&id).is_none());

        // Code réparé : vérification et test de démarrage réussis cochent la tâche de départ.
        std::fs::write(
            root.join("scripts/main.gd"),
            "extends Node2D\n\nfunc _ready() -> void:\n\tpass\n",
        )
        .unwrap();
        assert_eq!(run(GameAction::Test).await.status, GameBuildStatus::Success);
        let start = store::load_graph(&root)
            .tasks
            .into_iter()
            .find(|t| t.id == "t-start")
            .unwrap();
        assert_eq!(start.status, GameTaskStatus::Done);

        let map = studio.scan(&id).unwrap();
        assert!(map.files > 5);
        assert!(map.languages.iter().any(|l| l.language == "GDScript"));
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
