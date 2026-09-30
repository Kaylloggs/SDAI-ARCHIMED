//! Logique de Game Studio, testable sans Tauri.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::core::{AppError, AppResult};

use super::agents;
use super::assets::{self, Followup, GameAssetJob, GameAssetsView, GameBlendInfo, GameImageRequest};
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
    /// Fournisseurs d'images (clés `game-studio-<fournisseur>`, ou celles d'un autre module).
    imaging: crate::core::imaging::Imaging,
    /// Génération d'image en cours, par projet (de quoi l'annuler).
    image_jobs: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
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
            imaging: crate::core::imaging::Imaging::new(super::ID, &dir),
            image_jobs: Mutex::new(HashMap::new()),
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
        if action == GameAction::Import {
            return Err(AppError::invalid(
                "L'import des ressources se lance depuis la section Ressources.",
            ));
        }
        let mut job = self.claim_job(id, root, action, spec, None)?;
        job.platform = (action == GameAction::Build).then_some(platform);
        job.development = development;
        Ok(job)
    }

    /// Réserve le projet pour une commande préparée.
    fn claim_job(
        &self,
        id: &str,
        root: PathBuf,
        action: GameAction,
        spec: engines::CommandSpec,
        followup: Option<Followup>,
    ) -> AppResult<PreparedJob> {
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
            platform: None,
            development: false,
            spec,
            started_at,
            cancelled,
            followup,
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
                GameAction::Blender => format!("Blender s'est arrêté sur une erreur ({code})."),
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
                GameAction::Import => format!("Importation terminée en {seconds} s.{note}"),
                GameAction::Blender => format!("Blender a terminé en {seconds} s.{note}"),
            };
            (GameBuildStatus::Success, text)
        };
        // Ressources : la suite (lecture enregistrée, export ajouté au registre, import constaté).
        let (status, summary) = match (&job.followup, status) {
            (Some(followup), GameBuildStatus::Success) => {
                match self.follow_up(&job.project_id, root, followup, &summary) {
                    Ok(text) => (status, text),
                    Err(error) => (GameBuildStatus::Failed, error.message),
                }
            }
            _ => (status, summary),
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
            GameAction::Import | GameAction::Blender => GameLogCategory::Asset,
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

    // ── Ressources ────────────────────────────────────────────────────────────────────

    fn blender_tool(&self) -> Option<assets::GameBlenderTool> {
        self.environment(false)
            .tools
            .into_iter()
            .find(|t| t.id == "blender" && t.state == GameToolState::Ready)
            .and_then(|t| {
                t.path.map(|path| assets::GameBlenderTool {
                    path,
                    version: t.version,
                })
            })
    }

    fn blender_path(&self) -> AppResult<PathBuf> {
        self.blender_tool()
            .map(|t| PathBuf::from(t.path))
            .ok_or_else(|| {
                AppError::cli_missing(
                    "Blender n'est pas installé sur cette machine : installez-le depuis l'onglet Outils, ou désignez son exécutable.",
                )
            })
    }

    /// Registre, fichiers de ressources hors registre, et ce que le moteur a pris en compte.
    pub fn assets(&self, id: &str) -> AppResult<GameAssetsView> {
        let root = self.root(id)?;
        let engine = store::load_project(&root)?.engine;
        let graph = store::load_graph(&root);
        let entries = graph
            .assets
            .iter()
            .map(|a| assets::entry(&root, engine, a))
            .collect();
        // Fichiers déjà connus : ceux du registre et les versions précédentes des images.
        let registered: HashSet<String> = graph
            .assets
            .iter()
            .flat_map(|a| {
                a.path
                    .iter()
                    .cloned()
                    .chain(a.generations.iter().map(|g| g.output.clone()))
            })
            .collect();
        let ignored: Vec<&str> = engine
            .map(|e| engines::adapter(e).ignored_dirs().to_vec())
            .unwrap_or_default();
        let (loose, loose_truncated) = assets::loose_files(&root, engine, &ignored, &registered);
        Ok(GameAssetsView {
            entries,
            loose,
            loose_truncated,
            folder: assets::assets_root(engine).to_string(),
            import_hint: assets::import_hint(engine),
            blender: self.blender_tool(),
        })
    }

    fn register_path(
        &self,
        id: &str,
        rel: &str,
        kind: GameAssetKind,
        source: GameAssetSource,
        dependencies: Vec<String>,
        by: &str,
    ) -> AppResult<GameAsset> {
        let root = &self.root(id)?;
        if let Some(existing) = store::load_graph(root)
            .assets
            .into_iter()
            .find(|a| a.path.as_deref() == Some(rel))
        {
            return Ok(existing);
        }
        let engine = store::load_project(root)?.engine;
        let status = if engine.is_some() && assets::in_engine(root, engine, rel) {
            GameAssetStatus::Integrated
        } else {
            GameAssetStatus::Imported
        };
        let mut asset =
            assets::new_asset(graph::new_id("as"), rel, kind, source, status, now());
        asset.dependencies = dependencies;
        self.graph_op(id, GameGraphOp::UpsertAsset { asset: asset.clone() }, by)?;
        Ok(asset)
    }

    /// Copie des fichiers de la machine dans le dossier des ressources et les inscrit au
    /// registre (un fichier déjà dans le projet est seulement inscrit).
    pub fn import_assets(
        &self,
        id: &str,
        paths: &[String],
        kind: Option<GameAssetKind>,
        by: &str,
    ) -> AppResult<Vec<GameAsset>> {
        let root = self.root(id)?;
        let engine = store::load_project(&root)?.engine;
        let mut added = Vec::new();
        for path in paths {
            let source = PathBuf::from(path);
            let kind = kind.unwrap_or_else(|| assets::kind_for(&source));
            let (rel, linked) = assets::copy_into_project(&root, engine, &source, kind)?;
            assets::protect_dir(&root, engine, &rel);
            // Textures d'un .gltf : inscrites elles aussi, le modèle en dépend.
            let dir = Path::new(&rel)
                .parent()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let mut dependencies = Vec::new();
            for link in linked {
                let link_rel = format!("{dir}/{link}");
                if assets::kind_for(Path::new(&link_rel)) == GameAssetKind::Texture {
                    let texture = self.register_path(
                        id,
                        &link_rel,
                        GameAssetKind::Texture,
                        GameAssetSource::Manual,
                        Vec::new(),
                        by,
                    )?;
                    dependencies.push(texture.id);
                }
            }
            added.push(self.register_path(
                id,
                &rel,
                kind,
                GameAssetSource::Manual,
                dependencies,
                by,
            )?);
        }
        if !added.is_empty() {
            let names: Vec<String> = added.iter().filter_map(|a| a.path.clone()).collect();
            journal::info(
                &root,
                GameLogCategory::Asset,
                &format!("{} ressource(s) ajoutée(s) : {}", added.len(), names.join(", ")),
            );
        }
        Ok(added)
    }

    /// Inscrit au registre un fichier déjà présent dans le projet.
    pub fn register_asset(
        &self,
        id: &str,
        path: &str,
        kind: Option<GameAssetKind>,
        by: &str,
    ) -> AppResult<GameAsset> {
        let root = self.root(id)?;
        let rel = assets::safe_relative(path)?;
        if !root.join(&rel).is_file() {
            return Err(AppError::not_found(format!(
                "Aucun fichier {rel} dans le projet."
            )));
        }
        let kind = kind.unwrap_or_else(|| assets::kind_for(Path::new(&rel)));
        self.register_path(id, &rel, kind, GameAssetSource::Scanned, Vec::new(), by)
    }

    /// Dernière lecture d'un fichier .blend par Blender.
    pub fn blend_info(&self, id: &str, asset: &str) -> AppResult<Option<GameBlendInfo>> {
        Ok(assets::load_blend_info(&self.root(id)?, asset))
    }

    /// Prépare un travail sur les ressources (Blender ou import par le moteur), suivi comme
    /// une action moteur : sortie en direct, arrêt, historique, problème ouvert si échec.
    pub fn prepare_asset_job(&self, id: &str, job: GameAssetJob) -> AppResult<PreparedJob> {
        let root = self.root(id)?;
        let engine = store::load_project(&root)?.engine;
        let graph = store::load_graph(&root);
        let find = |asset: &str| {
            graph
                .assets
                .iter()
                .find(|a| a.id == asset)
                .cloned()
                .ok_or_else(|| AppError::not_found("Ressource inconnue : relisez la liste des ressources."))
        };
        let blend_of = |asset: &GameAsset| -> AppResult<PathBuf> {
            let rel = asset
                .path
                .as_deref()
                .filter(|p| p.to_lowercase().ends_with(".blend"))
                .ok_or_else(|| AppError::invalid("Seuls les fichiers .blend s'ouvrent dans Blender."))?;
            let file = root.join(rel);
            if !file.is_file() {
                return Err(AppError::not_found(format!("Fichier absent : {rel}")));
            }
            Ok(file)
        };
        match job {
            GameAssetJob::EngineImport => {
                let engine = engine.ok_or_else(|| {
                    AppError::invalid("Choisissez d'abord un moteur dans Réglages.")
                })?;
                if engine == GameEngine::Unreal {
                    let files: Vec<String> = graph
                        .assets
                        .iter()
                        .filter_map(|a| a.path.clone())
                        .filter(|p| {
                            p.starts_with("SourceArt/")
                                && root.join(p).is_file()
                                && !assets::in_engine(&root, Some(engine), p)
                        })
                        .collect();
                    if files.is_empty() {
                        return Err(AppError::invalid(
                            "Rien à importer : les ressources du registre rangées dans SourceArt/ sont déjà dans Unreal.",
                        ));
                    }
                    let script = root.join(engines::UNREAL_IMPORT_SCRIPT);
                    if let Some(parent) = script.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&script, assets::unreal_import_script(&root, &files))?;
                }
                let (root, spec, _) = self.action_command(id, GameAction::Import, None, false)?;
                self.claim_job(id, root, GameAction::Import, spec, Some(Followup::Import))
            }
            GameAssetJob::BlenderInspect { asset } => {
                let asset = find(&asset)?;
                let file = blend_of(&asset)?;
                let blender = self.blender_path()?;
                let scripts = assets::write_blender_scripts(&root)?;
                let json = assets::blend_info_path(&root, &asset.id);
                if let Some(parent) = json.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let _ = std::fs::remove_file(&json);
                let mut spec = assets::blender_command(
                    &blender,
                    &root,
                    Some(&file),
                    &scripts.join("inspect.py"),
                    &[display(&json)],
                    true,
                    300,
                );
                spec.output = Some(json.clone());
                spec.success_marker = Some(assets::BLENDER_MARKER.to_string());
                self.claim_job(
                    id,
                    root,
                    GameAction::Blender,
                    spec,
                    Some(Followup::Inspect {
                        asset: asset.id,
                        json,
                    }),
                )
            }
            GameAssetJob::BlenderExport { asset, format } => {
                let asset = find(&asset)?;
                let file = blend_of(&asset)?;
                let format = format.unwrap_or_else(|| assets::GameModelFormat::for_engine(engine));
                let blender = self.blender_path()?;
                // Un nouvel export du même fichier remplace le précédent (nouvelle version).
                let suffix = format!(".{}", format.ext());
                let previous = graph.assets.iter().find_map(|d| {
                    d.path.clone().filter(|p| {
                        d.source == GameAssetSource::Blender
                            && d.dependencies.contains(&asset.id)
                            && p.to_lowercase().ends_with(&suffix)
                    })
                });
                let output = previous.unwrap_or_else(|| {
                    let stem = file
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "modele".to_string());
                    assets::unique_path(
                        &root,
                        &assets::asset_dir(engine, GameAssetKind::Model),
                        &format!("{stem}{suffix}"),
                    )
                });
                let scripts = assets::write_blender_scripts(&root)?;
                let target = root.join(&output);
                let mut spec = assets::blender_command(
                    &blender,
                    &root,
                    Some(&file),
                    &scripts.join("export.py"),
                    &[display(&target), format.ext().to_string()],
                    true,
                    900,
                );
                spec.output = Some(target);
                spec.success_marker = Some(assets::BLENDER_MARKER.to_string());
                self.claim_job(
                    id,
                    root,
                    GameAction::Blender,
                    spec,
                    Some(Followup::Export {
                        asset: asset.id,
                        output,
                        format,
                    }),
                )
            }
            GameAssetJob::BlenderScript { script, blend } => {
                let rel = assets::safe_relative(&script)?;
                if !rel.to_lowercase().ends_with(".py") {
                    return Err(AppError::invalid("Un script Python (.py) du projet est attendu."));
                }
                let path = root.join(&rel);
                if !path.is_file() {
                    return Err(AppError::not_found(format!("Aucun script {rel} dans le projet.")));
                }
                let blend = match blend {
                    Some(b) => {
                        let b = assets::safe_relative(&b)?;
                        let file = root.join(&b);
                        if !file.is_file() || !b.to_lowercase().ends_with(".blend") {
                            return Err(AppError::not_found(format!("Aucun fichier .blend {b} dans le projet.")));
                        }
                        Some(file)
                    }
                    None => None,
                };
                let blender = self.blender_path()?;
                let spec = assets::blender_command(
                    &blender,
                    &root,
                    blend.as_deref(),
                    &path,
                    &[],
                    false,
                    1800,
                );
                self.claim_job(
                    id,
                    root,
                    GameAction::Blender,
                    spec,
                    Some(Followup::Script { script: rel }),
                )
            }
        }
    }

    /// Suite d'un travail réussi sur les ressources ; le texte devient le résumé.
    fn follow_up(
        &self,
        id: &str,
        root: &Path,
        followup: &Followup,
        summary: &str,
    ) -> AppResult<String> {
        let engine = store::load_project(root).ok().and_then(|p| p.engine);
        let graph = store::load_graph(root);
        match followup {
            Followup::Inspect { asset, json } => {
                let raw = std::fs::read_to_string(json).map_err(|_| {
                    AppError::internal("Blender n'a pas écrit le résumé attendu.")
                })?;
                let info: GameBlendInfo = serde_json::from_str(&raw).map_err(|e| {
                    AppError::internal(format!("Résumé de Blender illisible : {e}"))
                })?;
                let info = assets::analyze_blend(info, now());
                std::fs::write(json, serde_json::to_vec_pretty(&info)?)?;
                let name = graph
                    .assets
                    .iter()
                    .find(|a| &a.id == asset)
                    .map(|a| a.name.clone())
                    .unwrap_or_default();
                let meshes = info.objects.iter().filter(|o| o.kind == "MESH").count();
                let mut text = format!(
                    "{name} lu par Blender {} : {} objet(s) dont {meshes} maillage(s), {} triangles, {} matériau(x), {} animation(s).",
                    info.blender,
                    info.objects.len(),
                    info.triangles,
                    info.materials.len(),
                    info.actions.len()
                );
                if !info.warnings.is_empty() {
                    text.push_str(&format!(" {} point(s) à vérifier.", info.warnings.len()));
                }
                Ok(text)
            }
            Followup::Export {
                asset,
                output,
                format,
            } => {
                let source = graph.assets.iter().find(|a| &a.id == asset).cloned();
                let existing = graph
                    .assets
                    .iter()
                    .find(|a| a.path.as_deref() == Some(output.as_str()))
                    .cloned();
                let mut derived = match existing {
                    Some(mut a) => {
                        a.version += 1;
                        a.status = GameAssetStatus::Processed;
                        a
                    }
                    None => assets::new_asset(
                        graph::new_id("as"),
                        output,
                        GameAssetKind::Model,
                        GameAssetSource::Blender,
                        GameAssetStatus::Processed,
                        now(),
                    ),
                };
                if let Some(source) = &source {
                    derived.name = format!("{} ({})", source.name, format.ext().to_uppercase());
                    if !derived.dependencies.contains(&source.id) {
                        derived.dependencies.push(source.id.clone());
                    }
                }
                derived.import_settings = Some(
                    match format {
                        assets::GameModelFormat::Glb => "glTF binaire (GLB) exporté par Blender : axe Y en haut, modificateurs appliqués.",
                        assets::GameModelFormat::Fbx => "FBX exporté par Blender : échelle appliquée (FBX_SCALE_ALL), sans os de fin, textures intégrées.",
                    }
                    .to_string(),
                );
                self.graph_op(id, GameGraphOp::UpsertAsset { asset: derived }, "Blender")?;
                let hint = if assets::in_engine(root, engine, output) {
                    ""
                } else {
                    " Importez-le dans le moteur pour l'utiliser."
                };
                Ok(format!("Exporté : {output}.{hint}"))
            }
            Followup::Script { script } => Ok(format!("Script {script} : {summary}")),
            Followup::Import => {
                let mut integrated = 0;
                let mut missing = Vec::new();
                for asset in &graph.assets {
                    let Some(path) = asset.path.as_deref() else {
                        continue;
                    };
                    if asset.kind == GameAssetKind::Concept || !root.join(path).is_file() {
                        continue;
                    }
                    if assets::in_engine(root, engine, path) {
                        integrated += 1;
                        if matches!(
                            asset.status,
                            GameAssetStatus::Concept
                                | GameAssetStatus::Generated
                                | GameAssetStatus::Imported
                                | GameAssetStatus::Processed
                        ) {
                            let mut next = asset.clone();
                            next.status = GameAssetStatus::Integrated;
                            self.graph_op(id, GameGraphOp::UpsertAsset { asset: next }, "Game Studio")?;
                        }
                    } else {
                        missing.push(path.to_string());
                    }
                }
                let mut text =
                    format!("{summary} {integrated} ressource(s) du registre dans le moteur.");
                if !missing.is_empty() {
                    let shown: Vec<&str> = missing.iter().take(6).map(String::as_str).collect();
                    text.push_str(&format!(
                        " Pas prises en compte ({}) : {}{} (format que le moteur ne lit pas, ou fichier hors de ses dossiers).",
                        missing.len(),
                        shown.join(", "),
                        if missing.len() > shown.len() { "…" } else { "" }
                    ));
                }
                Ok(text)
            }
        }
    }

    // ── Images générées ───────────────────────────────────────────────────────────────

    pub async fn image_providers(&self, check: bool) -> Vec<crate::core::imaging::ProviderStatus> {
        let tasks: Vec<_> = self
            .imaging
            .all()
            .iter()
            .cloned()
            .map(|provider| tokio::spawn(async move { provider.status(check).await }))
            .collect();
        let mut out = Vec::new();
        for task in tasks {
            if let Ok(status) = task.await {
                out.push(status);
            }
        }
        out
    }

    pub async fn set_image_key(
        &self,
        provider: crate::core::imaging::ProviderId,
        key: &str,
    ) -> AppResult<crate::core::imaging::ProviderStatus> {
        self.imaging.provider(provider)?.set_key(key.trim()).await
    }

    pub async fn clear_image_key(
        &self,
        provider: crate::core::imaging::ProviderId,
    ) -> AppResult<crate::core::imaging::ProviderStatus> {
        let provider = self.imaging.provider(provider)?;
        provider.clear_key()?;
        Ok(provider.status(false).await)
    }

    pub async fn image_login(
        &self,
        provider: crate::core::imaging::ProviderId,
    ) -> AppResult<crate::core::imaging::ProviderStatus> {
        self.imaging.provider(provider)?.login().await
    }

    pub async fn image_models(
        &self,
        provider: crate::core::imaging::ProviderId,
    ) -> AppResult<crate::core::imaging::ModelList> {
        self.imaging.provider(provider)?.models().await
    }

    /// Consigne qui sera envoyée, pour la relire avant de générer.
    pub fn image_prompt(
        &self,
        id: &str,
        prompt: &str,
        kind: GameAssetKind,
        use_style: bool,
        transparent: bool,
    ) -> AppResult<String> {
        let project = store::load_project(&self.root(id)?)?;
        Ok(assets::image_prompt(prompt, kind, &project.style, use_style, transparent))
    }

    /// Génère une image, l'écrit dans les ressources du projet et garde de quoi la refaire
    /// (fournisseur, modèle, consigne, réglages, coût annoncé).
    pub async fn generate_image(
        self: &std::sync::Arc<Self>,
        id: &str,
        request: GameImageRequest,
    ) -> AppResult<GameAsset> {
        if request.prompt.trim().is_empty() {
            return Err(AppError::invalid("Décrivez l'image à produire."));
        }
        if request.asset.is_none() && request.name.trim().is_empty() {
            return Err(AppError::invalid("Donnez un nom à la ressource."));
        }
        let root = self.root(id)?;
        let project = store::load_project(&root)?;
        let prompt = assets::image_prompt(
            &request.prompt,
            request.kind,
            &project.style,
            request.use_style,
            request.transparent,
        );
        let provider = self.imaging.provider(request.provider)?;
        let (sender, cancel) = crate::core::imaging::cancel_pair();
        {
            let mut running = self
                .image_jobs
                .lock()
                .map_err(|_| AppError::internal("générations verrouillées"))?;
            if running.contains_key(id) {
                return Err(AppError::invalid(
                    "Une image est déjà en cours pour ce jeu : attendez-la ou annulez-la.",
                ));
            }
            running.insert(id.to_string(), sender);
        }
        let image_request = crate::core::imaging::ImageRequest {
            model: request.model.clone(),
            prompt: prompt.clone(),
            negative_prompt: request.negative_prompt.clone().filter(|n| !n.trim().is_empty()),
            images: Vec::new(),
            aspect_ratio: request.aspect_ratio.clone(),
            resolution: request.resolution.clone(),
            count: 1,
            seed: request.seed,
            quality: None,
            transparent_background: request.transparent,
        };
        let result = provider.generate(&image_request, cancel).await;
        if let Ok(mut running) = self.image_jobs.lock() {
            running.remove(id);
        }
        let response = result?;
        let studio = self.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || studio.save_generated(&id, &request, &prompt, response))
            .await
            .map_err(|e| AppError::internal(format!("enregistrement interrompu : {e}")))?
    }

    pub fn cancel_image(&self, id: &str) -> AppResult<()> {
        let running = self
            .image_jobs
            .lock()
            .map_err(|_| AppError::internal("générations verrouillées"))?;
        let sender = running
            .get(id)
            .ok_or_else(|| AppError::not_found("Aucune image en cours pour ce jeu."))?;
        let _ = sender.send(true);
        Ok(())
    }

    fn save_generated(
        &self,
        id: &str,
        request: &GameImageRequest,
        prompt: &str,
        response: crate::core::imaging::ImageResponse,
    ) -> AppResult<GameAsset> {
        let root = self.root(id)?;
        let engine = store::load_project(&root)?.engine;
        let image = response
            .images
            .into_iter()
            .next()
            .ok_or_else(|| AppError::internal("Le fournisseur n'a rendu aucune image."))?;
        let ext = assets::image_ext(&image.bytes)
            .ok_or_else(|| AppError::internal("Le fournisseur a rendu un fichier qui n'est pas une image connue."))?;
        let graph = store::load_graph(&root);
        let previous = match &request.asset {
            Some(asset) => Some(
                graph
                    .assets
                    .iter()
                    .find(|a| &a.id == asset)
                    .cloned()
                    .ok_or_else(|| AppError::not_found("Ressource inconnue : relisez la liste des ressources."))?,
            ),
            None => None,
        };
        let (rel, mut asset) = match previous {
            Some(mut asset) => {
                // Nouvelle version à côté de l'ancienne : rien n'est écrasé.
                let current = asset.path.clone().unwrap_or_default();
                let dir = Path::new(&current)
                    .parent()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_else(|| assets::asset_dir(engine, asset.kind));
                let base = assets::file_stem(&asset.name);
                asset.version += 1;
                let rel = assets::unique_path(&root, &dir, &format!("{base}-v{}.{ext}", asset.version));
                (rel, asset)
            }
            None => {
                let dir = assets::asset_dir(engine, request.kind);
                let rel = assets::unique_path(
                    &root,
                    &dir,
                    &format!("{}.{ext}", assets::file_stem(&request.name)),
                );
                let mut asset = assets::new_asset(
                    graph::new_id("as"),
                    &rel,
                    request.kind,
                    GameAssetSource::Generated,
                    GameAssetStatus::Generated,
                    now(),
                );
                asset.name = request.name.trim().to_string();
                (rel, asset)
            }
        };
        let target = root.join(&rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&target, &image.bytes)?;
        assets::protect_dir(&root, engine, &rel);
        asset.path = Some(rel.clone());
        asset.status = GameAssetStatus::Generated;
        asset.source = GameAssetSource::Generated;
        asset.generations.push(GameGeneration {
            provider: request.provider.slug().to_string(),
            model: request.model.clone(),
            prompt: prompt.to_string(),
            params: serde_json::json!({
                "request": request.prompt,
                "kind": request.kind,
                "aspectRatio": request.aspect_ratio,
                "resolution": request.resolution,
                "negativePrompt": request.negative_prompt,
                "transparent": request.transparent,
                "useStyle": request.use_style,
                "usage": response.usage,
                "dropped": response.dropped,
            }),
            seed: request.seed.map(|s| s.to_string()),
            at: now(),
            output: rel.clone(),
        });
        self.graph_op(id, GameGraphOp::UpsertAsset { asset: asset.clone() }, "vous")?;
        journal::info(
            &root,
            GameLogCategory::Ai,
            &format!(
                "Image générée : {rel} ({}, {})",
                request.provider.label(),
                request.model
            ),
        );
        crate::core::audit::record("game-studio.image", &rel, "ok", "user");
        Ok(asset)
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

    fn image_request(name: &str, asset: Option<String>) -> GameImageRequest {
        GameImageRequest {
            provider: crate::core::imaging::ProviderId::Gemini,
            model: "gemini-image".into(),
            prompt: "Sol de forêt moussu".into(),
            name: name.into(),
            kind: GameAssetKind::Texture,
            asset,
            aspect_ratio: Some("1:1".into()),
            resolution: None,
            seed: Some(7),
            negative_prompt: None,
            transparent: false,
            use_style: true,
        }
    }

    fn png(tag: u8) -> crate::core::imaging::ImageResponse {
        crate::core::imaging::ImageResponse {
            images: vec![crate::core::imaging::GeneratedImage {
                bytes: vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, tag],
            }],
            usage: crate::core::imaging::ImageUsage {
                cost_usd: Some(0.04),
                ..Default::default()
            },
            dropped: Vec::new(),
        }
    }

    #[test]
    fn assets_are_imported_registered_generated_and_listed() {
        let (studio, base) = studio("assets");
        let analysis = studio.analyze("Un jeu d'exploration en 3D dans une forêt.").unwrap();
        let outcome = studio
            .create(request(&analysis, &base.join("jeux"), Some(GameEngine::Godot)))
            .unwrap();
        let id = outcome.project.id.clone();
        let root = PathBuf::from(&outcome.project.root);

        // Fichier de la machine : copié dans assets/, inscrit, pas encore importé par Godot.
        let outside = base.join("dehors");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("écorce.png"), [0x89, b'P', b'N', b'G']).unwrap();
        let added = studio
            .import_assets(&id, &[display(&outside.join("écorce.png"))], None, "vous")
            .unwrap();
        assert_eq!(added[0].path.as_deref(), Some("assets/textures/écorce.png"));
        assert_eq!(added[0].kind, GameAssetKind::Texture);
        assert_eq!(added[0].status, GameAssetStatus::Imported);
        assert!(root.join("assets/textures/écorce.png").is_file());

        // Fichier déjà dans le projet : proposé hors registre, puis inscrit sans copie.
        std::fs::create_dir_all(root.join("art")).unwrap();
        std::fs::write(root.join("art/rocher.glb"), b"glTF").unwrap();
        let view = studio.assets(&id).unwrap();
        assert!(view.loose.iter().any(|l| l.path == "art/rocher.glb" && l.kind == GameAssetKind::Model));
        assert!(!view.loose.iter().any(|l| l.path == "assets/textures/écorce.png"));
        let entry = view.entries.iter().find(|e| e.asset.id == added[0].id).unwrap();
        assert!(entry.exists && !entry.in_engine);
        let rocher = studio.register_asset(&id, "art/rocher.glb", None, "vous").unwrap();
        assert_eq!(rocher.source, GameAssetSource::Scanned);
        assert!(!studio.assets(&id).unwrap().loose.iter().any(|l| l.path == "art/rocher.glb"));
        assert!(studio.register_asset(&id, "../secret.png", None, "vous").is_err());
        assert!(studio.register_asset(&id, "art/absent.png", None, "vous").is_err());

        // Blender n'ouvre que des .blend ; un script doit exister dans le projet.
        let inspect = studio.prepare_asset_job(
            &id,
            GameAssetJob::BlenderInspect { asset: rocher.id.clone() },
        );
        assert!(inspect.err().is_some_and(|e| e.message.contains(".blend")));
        assert!(studio
            .prepare_asset_job(&id, GameAssetJob::BlenderScript { script: "tools/absent.py".into(), blend: None })
            .is_err());
        assert!(studio.current_action(&id).is_none());

        // Image générée : écrite, inscrite avec sa trace ; une nouvelle version n'écrase rien.
        let first = studio
            .save_generated(&id, &image_request("Sol de forêt", None), "consigne", png(1))
            .unwrap();
        assert_eq!(first.path.as_deref(), Some("assets/textures/sol-de-foret.png"));
        assert_eq!(first.status, GameAssetStatus::Generated);
        let generation = &first.generations[0];
        assert_eq!(generation.provider, "gemini");
        assert_eq!(generation.seed.as_deref(), Some("7"));
        assert_eq!(generation.params["usage"]["costUsd"], 0.04);
        assert_eq!(generation.params["request"], "Sol de forêt moussu");
        let second = studio
            .save_generated(&id, &image_request("", Some(first.id.clone())), "consigne", png(2))
            .unwrap();
        assert_eq!(second.id, first.id);
        assert_eq!(second.version, 2);
        assert_eq!(second.path.as_deref(), Some("assets/textures/sol-de-foret-v2.png"));
        assert_eq!(second.generations.len(), 2);
        assert!(root.join("assets/textures/sol-de-foret.png").is_file());
        let view = studio.assets(&id).unwrap();
        assert!(!view.loose.iter().any(|l| l.path.starts_with("assets/textures/sol-de-foret")));
        assert_eq!(view.entries.len(), 3);

        // Concepts : hors du jeu, et Godot ne les importe pas.
        let mut concept = image_request("Village au crépuscule", None);
        concept.kind = GameAssetKind::Concept;
        let art = studio.save_generated(&id, &concept, "consigne", png(3)).unwrap();
        assert_eq!(art.path.as_deref(), Some("docs/concepts/village-au-crepuscule.png"));
        assert!(root.join("docs/.gdignore").is_file());

        let prompt = studio
            .image_prompt(&id, "Épée courte", GameAssetKind::Sprite, false, true)
            .unwrap();
        assert!(prompt.starts_with("Épée courte\nUsage : sprite"));
        assert!(prompt.ends_with("Fond transparent."));
    }

    #[tokio::test]
    #[ignore = "demande Blender et Godot 4 : GAMESTUDIO_BLENDER=<blender> GAMESTUDIO_GODOT=<godot>"]
    async fn real_blender_and_godot_asset_pipeline() {
        let (Ok(blender), Ok(godot)) = (
            std::env::var("GAMESTUDIO_BLENDER"),
            std::env::var("GAMESTUDIO_GODOT"),
        ) else {
            return;
        };
        let (studio, base) = studio("blender");
        let studio = std::sync::Arc::new(studio);
        studio.set_tool_path("godot", Some(&godot)).unwrap();
        studio.set_tool_path("blender", Some(&blender)).unwrap();
        let analysis = studio.analyze("Un jeu d'aventure en 3D avec des caisses à pousser.").unwrap();
        let outcome = studio
            .create(request(&analysis, &base.join("jeux"), Some(GameEngine::Godot)))
            .unwrap();
        let id = outcome.project.id.clone();
        let root = PathBuf::from(&outcome.project.root);
        let run = |job| {
            let prepared = studio.prepare_asset_job(&id, job).unwrap();
            studio.run_prepared(prepared, |_| {})
        };

        // Un script du projet fabrique le fichier .blend (Blender sans fenêtre).
        std::fs::create_dir_all(root.join("tools")).unwrap();
        std::fs::write(
            root.join("tools/make_props.py"),
            "import os\nimport bpy\nbpy.ops.wm.read_factory_settings(use_empty=True)\nbpy.ops.mesh.primitive_monkey_add()\nbpy.context.object.name = 'Suzanne'\nbpy.context.object.scale = (2, 2, 2)\nbpy.ops.mesh.primitive_cube_add(location=(3, 0, 0))\ncube = bpy.context.object\ncube.name = 'Caisse'\ncube.keyframe_insert('location', frame=1)\ncube.location.x = 5\ncube.keyframe_insert('location', frame=24)\nos.makedirs('assets/models', exist_ok=True)\nbpy.ops.wm.save_as_mainfile(filepath=os.path.abspath('assets/models/props.blend'))\n",
        )
        .unwrap();
        let made = run(GameAssetJob::BlenderScript { script: "tools/make_props.py".into(), blend: None }).await;
        assert_eq!(made.status, GameBuildStatus::Success, "{}", made.summary);
        assert!(made.summary.starts_with("Script tools/make_props.py"), "{}", made.summary);
        assert_eq!(made.action, GameAction::Blender);
        let blend = studio.register_asset(&id, "assets/models/props.blend", None, "vous").unwrap();

        // Lecture : objets, triangles, animation, échelle non appliquée signalée.
        let read = run(GameAssetJob::BlenderInspect { asset: blend.id.clone() }).await;
        assert_eq!(read.status, GameBuildStatus::Success, "{}", read.summary);
        assert!(read.summary.contains("980 triangles"), "{}", read.summary);
        let info = studio.blend_info(&id, &blend.id).unwrap().unwrap();
        assert_eq!(info.objects.len(), 2);
        assert_eq!(info.actions.len(), 1);
        assert!(info.warnings.iter().any(|w| w.contains("Suzanne")), "{:?}", info.warnings);

        // Export pour Godot (GLB), inscrit au registre avec sa source.
        let exported = run(GameAssetJob::BlenderExport { asset: blend.id.clone(), format: None }).await;
        assert_eq!(exported.status, GameBuildStatus::Success, "{}", exported.summary);
        assert_eq!(exported.output.as_deref().map(|o| o.ends_with("assets/models/props.glb")), Some(true));
        let graph = store::load_graph(&root);
        let glb = graph.assets.iter().find(|a| a.path.as_deref() == Some("assets/models/props.glb")).unwrap().clone();
        assert_eq!(glb.source, GameAssetSource::Blender);
        assert_eq!(glb.dependencies, vec![blend.id.clone()]);
        assert_eq!(glb.status, GameAssetStatus::Processed);
        // Un second export remplace le premier (nouvelle version, même fichier).
        let again = run(GameAssetJob::BlenderExport { asset: blend.id.clone(), format: None }).await;
        assert_eq!(again.status, GameBuildStatus::Success, "{}", again.summary);
        let graph = store::load_graph(&root);
        assert_eq!(graph.assets.iter().filter(|a| a.source == GameAssetSource::Blender).count(), 1);
        assert_eq!(graph.assets.iter().find(|a| a.id == glb.id).unwrap().version, 2);

        // Import par Godot : le GLB reçoit son .import et passe « dans le moteur ».
        let import = run(GameAssetJob::EngineImport).await;
        assert_eq!(import.status, GameBuildStatus::Success, "{}", import.summary);
        assert_eq!(import.action, GameAction::Import);
        assert!(root.join("assets/models/props.glb.import").is_file());
        let graph = store::load_graph(&root);
        assert_eq!(graph.assets.iter().find(|a| a.id == glb.id).unwrap().status, GameAssetStatus::Integrated);
        assert!(import.summary.contains("dans le moteur"), "{}", import.summary);
        // Sans le réglage posé à la création, Godot resterait bloqué sur le .blend : refusé.
        let settings = std::fs::read_to_string(root.join("project.godot")).unwrap();
        assert!(settings.contains("import/blender/enabled=false"));
        std::fs::write(root.join("project.godot"), settings.replace("import/blender/enabled=false", "")).unwrap();
        let refused = studio.prepare_asset_job(&id, GameAssetJob::EngineImport);
        assert!(refused.err().is_some_and(|e| e.message.contains("assets/models/props.blend")));
        std::fs::write(root.join("project.godot"), settings).unwrap();

        // Script en erreur : échec expliqué (trace Python), problème ouvert, refermé ensuite.
        std::fs::write(root.join("tools/broken.py"), "import bpy\n\nraise RuntimeError('caisse introuvable')\n").unwrap();
        let broken = run(GameAssetJob::BlenderScript { script: "tools/broken.py".into(), blend: None }).await;
        assert_eq!(broken.status, GameBuildStatus::Failed, "{}", broken.summary);
        assert!(broken.diagnostics.iter().any(|d| d.message.contains("caisse introuvable")), "{:?}", broken.diagnostics);
        let open = |g: &GameGraph| g.issues.iter().filter(|i| i.open && i.source.as_deref() == Some("run:blender")).count();
        assert_eq!(open(&store::load_graph(&root)), 1);
        let fixed = run(GameAssetJob::BlenderScript { script: "tools/make_props.py".into(), blend: None }).await;
        assert_eq!(fixed.status, GameBuildStatus::Success, "{}", fixed.summary);
        assert_eq!(open(&store::load_graph(&root)), 0);
        let _ = std::fs::remove_dir_all(&base);
    }
}
