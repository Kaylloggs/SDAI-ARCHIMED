//! Types échangés avec le frontend (bindings générés par ts-rs dans `src/core/ipc/bindings/`).
//!
//! Tous les noms commencent par `Game` : les bindings de tous les modules partagent un dossier.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ─── Moteurs ──────────────────────────────────────────────────────────────────────────────

/// Moteur de jeu pris en charge par un adaptateur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum GameEngine {
    Godot,
    Unity,
    Unreal,
}

impl GameEngine {
    pub const ALL: [GameEngine; 3] = [GameEngine::Godot, GameEngine::Unity, GameEngine::Unreal];

    pub fn label(self) -> &'static str {
        match self {
            Self::Godot => "Godot",
            Self::Unity => "Unity",
            Self::Unreal => "Unreal Engine",
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Self::Godot => "godot",
            Self::Unity => "unity",
            Self::Unreal => "unreal",
        }
    }
}

/// Installation d'un moteur trouvée sur la machine.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameEngineInstall {
    pub engine: GameEngine,
    /// Version lue sur l'installation (`4.3.stable`, `6000.0.23f1`, `5.4.4`).
    pub version: Option<String>,
    /// Exécutable de l'éditeur.
    pub editor: String,
    /// Variante console quand elle existe (Godot `_console.exe`, Unreal `-Cmd.exe`) : sortie lisible.
    pub console: Option<String>,
    /// Dossier racine de l'installation.
    pub root: String,
    /// Où elle a été trouvée : « Chemin choisi », « Unity Hub », « Epic Games Launcher », « PATH »…
    pub source: String,
}

/// Moyen par lequel une opération est réellement faite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameCapabilityVia {
    /// Ligne de commande officielle du moteur.
    Cli,
    /// Écriture ou lecture directe des fichiers du projet (formats texte documentés).
    Files,
    /// Serveur MCP connecté (détecté dynamiquement).
    Mcp,
    /// Seulement dans l'éditeur, par la personne : ARCHIMED guide.
    Manual,
}

/// Ce qu'un adaptateur sait faire, dit honnêtement.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameCapability {
    pub id: String,
    pub label: String,
    pub via: GameCapabilityVia,
    /// Condition à remplir (« éditeur installé », « modèles d'export installés »…).
    pub requires: Option<String>,
    /// Remplie sur cette machine pour ce projet (`None` : pas encore vérifiable).
    pub available: Option<bool>,
    pub detail: Option<String>,
}

// ─── Projet ───────────────────────────────────────────────────────────────────────────────

/// Niveau d'ambition du projet (§49 : prototype → production, ou projet existant).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameMode {
    Prototype,
    Standard,
    Advanced,
    Production,
    Existing,
}

/// Liberté laissée aux agents (§86).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAutonomy {
    /// Chaque action importante est validée par la personne.
    Manual,
    /// Les tâches courantes sont faites seules ; le reste est demandé.
    Assisted,
    /// Chaînes complètes de tâches, avec points de restauration.
    Autonomous,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameDimension {
    #[serde(rename = "2d")]
    TwoD,
    #[serde(rename = "2.5d")]
    TwoAndHalfD,
    #[serde(rename = "3d")]
    ThreeD,
}

impl GameDimension {
    pub fn label(self) -> &'static str {
        match self {
            Self::TwoD => "2D",
            Self::TwoAndHalfD => "2,5D",
            Self::ThreeD => "3D",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GamePlatform {
    Windows,
    Linux,
    Macos,
    Android,
    Ios,
    Web,
    Console,
}

/// Budget de performance (§73). Tout est facultatif.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct GameBudget {
    pub target_fps: Option<u32>,
    pub resolution: Option<String>,
    pub memory_mb: Option<u32>,
    pub cpu_ms: Option<f32>,
    pub gpu_ms: Option<f32>,
    pub network_kbps: Option<u32>,
}

/// Guide de style du projet (§90) : les agents le respectent pour chaque nouvel élément.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct GameStyleGuide {
    pub visual_style: String,
    pub palette: Vec<String>,
    pub materials: String,
    pub typography: String,
    pub ui_style: String,
    pub character_style: String,
    pub environment_style: String,
    pub vfx_style: String,
    pub audio_style: String,
    /// Images ou pages de référence (chemins du projet ou adresses).
    pub references: Vec<String>,
}

/// Identité et réglages d'un projet (`<projet>/.gamestudio/project.json`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameProject {
    pub id: String,
    pub name: String,
    /// Dossier du projet (chemin absolu).
    pub root: String,
    pub engine: Option<GameEngine>,
    /// Version du moteur visée par le projet.
    pub engine_version: Option<String>,
    pub mode: GameMode,
    pub autonomy: GameAutonomy,
    /// Idée de départ, telle que la personne l'a écrite.
    pub idea: String,
    /// Genres descriptifs (jamais une contrainte d'architecture, §2).
    #[serde(default)]
    pub genres: Vec<String>,
    pub dimension: GameDimension,
    #[serde(default)]
    pub targets: Vec<GamePlatform>,
    #[serde(default)]
    pub budget: GameBudget,
    #[serde(default)]
    pub style: GameStyleGuide,
    /// Version du jeu (`0.1`, `0.2`…), avancée à chaque étape marquante.
    #[serde(default = "first_version")]
    pub version: String,
    pub created_at: String,
    pub updated_at: String,
}

fn first_version() -> String {
    "0.1".to_string()
}

/// Ligne de la liste des projets.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameProjectSummary {
    pub id: String,
    pub name: String,
    pub root: String,
    pub engine: Option<GameEngine>,
    pub engine_version: Option<String>,
    pub mode: Option<GameMode>,
    pub dimension: Option<GameDimension>,
    /// Le dossier existe et contient `.gamestudio/project.json`.
    pub available: bool,
    pub systems: u32,
    pub open_tasks: u32,
    pub last_build: Option<GameBuildStatus>,
    pub updated_at: Option<String>,
    pub last_opened: Option<String>,
}

// ─── Graphe de connaissance ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameSystemCategory {
    Core,
    Player,
    Camera,
    Combat,
    Ai,
    Npc,
    Rpg,
    Items,
    Crafting,
    Building,
    Vehicles,
    Narrative,
    Economy,
    World,
    Generation,
    Environment,
    Multiplayer,
    Backend,
    Persistence,
    Ui,
    Audio,
    Visual,
    Gameplay,
    Platform,
}

/// Où vit l'état d'un système en multijoueur (§33).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameNetMode {
    /// Rien à synchroniser (jeu solo, ou calcul purement local).
    Local,
    /// Le serveur décide, les clients reçoivent le résultat.
    ServerAuthority,
    /// État copié du serveur vers les clients.
    Replicated,
    /// Le client anticipe, le serveur corrige.
    Predicted,
    /// Affiché ou joué seulement chez le joueur (interface, sons).
    ClientOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameSystemStatus {
    Planned,
    InProgress,
    Implemented,
    Validated,
    Broken,
    Deprecated,
}

/// D'où vient un système du graphe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameSystemOrigin {
    /// Catalogue d'ARCHIMED (connaissances générales).
    Catalog,
    /// Ajouté par la personne ou un agent (système propre au jeu).
    Custom,
    /// Reconnu dans le code d'un projet existant.
    Detected,
}

/// Un système du jeu et ses liens (§6).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameSystem {
    /// Identifiant stable en `snake_case` (`combat_melee`).
    pub id: String,
    pub name: String,
    pub category: GameSystemCategory,
    /// Rôle dans le jeu, en une ou deux phrases.
    pub role: String,
    pub origin: GameSystemOrigin,
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Événements émis (`DamageDealt`, `ItemCrafted`…).
    #[serde(default)]
    pub produces: Vec<String>,
    /// Fichiers ou motifs (`Scripts/Combat/**`), relatifs au projet.
    #[serde(default)]
    pub files: Vec<String>,
    /// Identifiants d'assets du registre.
    #[serde(default)]
    pub assets: Vec<String>,
    /// Interfaces publiques (`IDamageable`, `take_damage(amount)`).
    #[serde(default)]
    pub interfaces: Vec<String>,
    /// Types de données pilotant le système (`WeaponData`).
    #[serde(default)]
    pub data: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    /// Vérifications attendues (« Un coup retire des points de vie »).
    #[serde(default)]
    pub tests: Vec<String>,
    pub status: GameSystemStatus,
    pub network: GameNetMode,
    /// Risque d'échelle signalé (« sans risque en prototype, risqué en production »).
    #[serde(default)]
    pub risk: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Décision d'architecture (§124).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameDecision {
    pub id: String,
    pub title: String,
    pub decision: String,
    pub reason: String,
    #[serde(default)]
    pub alternatives: Vec<String>,
    #[serde(default)]
    pub tradeoffs: Option<String>,
    /// « analyse », « vous », « agent:architecture »…
    pub by: String,
    pub at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAssumptionStatus {
    /// Choisie faute d'information, modifiable.
    Editable,
    /// Validée par la personne.
    Confirmed,
    /// Remplacée par une autre valeur (gardée pour l'historique).
    Replaced,
}

/// Hypothèse prise automatiquement (§55).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameAssumption {
    pub id: String,
    /// Sujet (`camera`, `players`, `engine`…).
    pub topic: String,
    pub value: String,
    pub reason: String,
    pub status: GameAssumptionStatus,
    pub at: String,
}

/// Spécialité d'un agent (§50).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAgentRole {
    Director,
    GameDesign,
    Architecture,
    Programming,
    World,
    AiNpc,
    Modeling,
    Texture,
    Animation,
    Vfx,
    UiUx,
    Audio,
    Network,
    Backend,
    Build,
    Qa,
    Debug,
    Optimization,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameTaskStatus {
    Todo,
    Running,
    Blocked,
    Review,
    Done,
    Failed,
    Cancelled,
}

/// Tâche du plan (§52).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameTask {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub status: GameTaskStatus,
    pub role: GameAgentRole,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
    /// Résultat attendu.
    #[serde(default)]
    pub expected: String,
    /// Comment vérifier que c'est fait (compilation, test, contrôle en jeu).
    #[serde(default)]
    pub validation: String,
    /// Phase de la feuille de route.
    #[serde(default)]
    pub phase: Option<String>,
    /// Conversation d'agent qui a traité la tâche.
    #[serde(default)]
    pub conversation_id: Option<String>,
    /// Compte rendu de l'agent ou de la personne.
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default)]
    #[ts(type = "number")]
    pub order: u64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameIssueSeverity {
    Info,
    Warning,
    Error,
}

/// Problème connu du projet.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameIssue {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub detail: String,
    pub severity: GameIssueSeverity,
    #[serde(default)]
    pub systems: Vec<String>,
    pub open: bool,
    pub at: String,
}

/// Trace d'une modification importante (§43 : quoi, pourquoi, impact, fichiers, risques).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameChange {
    pub id: String,
    pub title: String,
    pub what: String,
    pub why: String,
    #[serde(default)]
    pub impact: String,
    #[serde(default)]
    pub files: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    #[serde(default)]
    pub risks: Vec<String>,
    /// Point de restauration pris avant la modification.
    #[serde(default)]
    pub checkpoint: Option<String>,
    pub by: String,
    pub at: String,
}

/// Étape marquante du jeu (§56 : 0.1 prototype, 0.2 inventaire…).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameVersion {
    pub version: String,
    pub label: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub checkpoint: Option<String>,
    pub at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GamePhaseStatus {
    Planned,
    Active,
    Done,
}

/// Phase de la feuille de route (§58).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GamePhase {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub goals: Vec<String>,
    #[serde(default)]
    pub systems: Vec<String>,
    pub status: GamePhaseStatus,
}

/// Architecture de monde (§14).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameWorldKind {
    Static,
    SceneBased,
    LevelBased,
    OpenWorld,
    Streaming,
    Procedural,
    Infinite,
    Voxel,
    Tile,
    Destructible,
    Hybrid,
}

impl GameWorldKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Static => "Monde statique",
            Self::SceneBased => "Scènes successives",
            Self::LevelBased => "Niveaux",
            Self::OpenWorld => "Monde ouvert",
            Self::Streaming => "Monde en streaming",
            Self::Procedural => "Monde procédural",
            Self::Infinite => "Monde infini",
            Self::Voxel => "Monde en voxels",
            Self::Tile => "Monde en tuiles",
            Self::Destructible => "Monde destructible",
            Self::Hybrid => "Monde hybride",
        }
    }
}

/// Plan du monde retenu et ses conséquences (mémoire, processeur, carte graphique, disque, réseau).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameWorldPlan {
    pub kind: GameWorldKind,
    /// Traits combinés (`streaming`, `procedural`, `destructible`…).
    #[serde(default)]
    pub traits: Vec<GameWorldKind>,
    pub reason: String,
    /// Points d'attention par ressource : « Mémoire : chunks déchargés au-delà de … ».
    #[serde(default)]
    pub concerns: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameNetTopology {
    /// Jeu solo.
    None,
    /// Plusieurs joueurs sur la même machine.
    Local,
    /// Un joueur héberge la partie.
    ListenServer,
    /// Serveur dédié qui fait autorité.
    DedicatedServer,
    /// Serveurs persistants et services en ligne (monde partagé).
    Persistent,
}

impl GameNetTopology {
    pub fn label(self) -> &'static str {
        match self {
            Self::None => "Solo",
            Self::Local => "Multijoueur local",
            Self::ListenServer => "Hôte joueur (listen server)",
            Self::DedicatedServer => "Serveur dédié",
            Self::Persistent => "Monde persistant en ligne",
        }
    }
}

/// Plan réseau (§32 à §34).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameNetworkPlan {
    pub topology: GameNetTopology,
    pub max_players: Option<u32>,
    pub reason: String,
    /// Mécanismes nécessaires (lobby, matchmaking, prédiction, compensation de latence…).
    #[serde(default)]
    pub features: Vec<String>,
    /// Estimations et risques (bande passante, fréquence de mise à jour, triche).
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Graphe de connaissance du projet (`<projet>/.gamestudio/graph.json`, §5).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct GameGraph {
    /// Augmente à chaque écriture : un agent sait si sa lecture est à jour.
    #[ts(type = "number")]
    pub revision: u64,
    pub systems: Vec<GameSystem>,
    pub assets: Vec<GameAsset>,
    pub decisions: Vec<GameDecision>,
    pub assumptions: Vec<GameAssumption>,
    pub tasks: Vec<GameTask>,
    pub issues: Vec<GameIssue>,
    pub changes: Vec<GameChange>,
    pub versions: Vec<GameVersion>,
    pub roadmap: Vec<GamePhase>,
    pub world: Option<GameWorldPlan>,
    pub network: Option<GameNetworkPlan>,
}

// ─── Assets ───────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAssetKind {
    Model,
    Texture,
    Material,
    Sprite,
    Animation,
    Audio,
    Music,
    Scene,
    Prefab,
    Script,
    Shader,
    Ui,
    Font,
    Data,
    Concept,
    Vfx,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAssetStatus {
    Concept,
    Generated,
    Imported,
    Processed,
    Integrated,
    Validated,
    Deprecated,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAssetSource {
    /// Fichier fourni par la personne.
    Manual,
    /// Produit par un fournisseur d'IA (métadonnées de génération gardées).
    Generated,
    /// Produit ou converti par Blender.
    Blender,
    /// Trouvé dans le projet par l'analyse.
    Scanned,
}

/// Trace d'une génération par IA (§11) : de quoi la refaire ou la modifier.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameGeneration {
    pub provider: String,
    pub model: String,
    pub prompt: String,
    /// Paramètres envoyés (format, taille, style…).
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub params: serde_json::Value,
    pub seed: Option<String>,
    pub at: String,
    /// Fichier produit, relatif au projet.
    pub output: String,
}

/// Entrée du registre d'assets (§40).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameAsset {
    pub id: String,
    pub name: String,
    pub kind: GameAssetKind,
    pub source: GameAssetSource,
    /// Fichier relatif au projet (absent pour un concept pas encore produit).
    pub path: Option<String>,
    pub version: u32,
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Réglages d'import pour le moteur (« échelle 0,01, axe Z en haut »).
    #[serde(default)]
    pub import_settings: Option<String>,
    /// Générations successives, la plus récente en dernier.
    #[serde(default)]
    pub generations: Vec<GameGeneration>,
    /// Systèmes ou scènes qui l'utilisent.
    #[serde(default)]
    pub usage: Vec<String>,
    pub status: GameAssetStatus,
    #[serde(default)]
    pub notes: Option<String>,
    pub updated_at: String,
}

// ─── Analyse d'une idée ───────────────────────────────────────────────────────────────────

/// Système retenu par l'analyse, avec ce qui l'a fait retenir.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameDetectedSystem {
    pub system: GameSystem,
    /// Mots de l'idée qui l'ont déclenché.
    pub evidence: Vec<String>,
    /// Systèmes qui en ont besoin (ajouté comme dépendance).
    pub required_by: Vec<String>,
    /// Présent dans tout jeu jouable (boucle de jeu, entrées, interface…).
    pub foundation: bool,
}

/// Note d'un moteur pour ce projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameEngineScore {
    pub engine: GameEngine,
    pub score: i32,
    pub reasons: Vec<String>,
    pub concerns: Vec<String>,
    pub installed: bool,
}

/// Question posée seulement quand la réponse change l'architecture (§54).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameQuestion {
    pub topic: String,
    pub question: String,
    pub why: String,
    pub options: Vec<String>,
}

/// Spécification technique tirée d'une idée (§4).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameAnalysis {
    pub idea: String,
    pub name: String,
    pub genres: Vec<String>,
    pub dimension: GameDimension,
    pub perspective: String,
    pub systems: Vec<GameDetectedSystem>,
    pub world: GameWorldPlan,
    pub network: GameNetworkPlan,
    pub assumptions: Vec<GameAssumption>,
    pub decisions: Vec<GameDecision>,
    pub engines: Vec<GameEngineScore>,
    pub mode: GameMode,
    pub roadmap: Vec<GamePhase>,
    pub content: Vec<String>,
    pub risks: Vec<String>,
    pub questions: Vec<GameQuestion>,
    pub targets: Vec<GamePlatform>,
}

/// Création d'un projet à partir d'une analyse relue par la personne.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameCreateRequest {
    pub name: String,
    /// Dossier parent ; le projet est créé dans `<parent>/<nom-en-dossier>`.
    pub parent: String,
    pub engine: Option<GameEngine>,
    /// Installation choisie (chemin de l'éditeur) ; sinon la plus récente.
    pub engine_editor: Option<String>,
    pub mode: GameMode,
    pub autonomy: GameAutonomy,
    pub idea: String,
    pub genres: Vec<String>,
    pub dimension: GameDimension,
    pub targets: Vec<GamePlatform>,
    /// Systèmes gardés (identifiants du catalogue ou systèmes propres).
    pub systems: Vec<GameSystem>,
    pub assumptions: Vec<GameAssumption>,
    pub decisions: Vec<GameDecision>,
    pub world: Option<GameWorldPlan>,
    pub network: Option<GameNetworkPlan>,
    pub roadmap: Vec<GamePhase>,
    /// Unreal : module C++ en plus des Blueprints.
    #[serde(default)]
    pub cpp: bool,
    /// Initialiser un dépôt Git (avec le `.gitignore` du moteur).
    #[serde(default)]
    pub git: bool,
}

/// Résultat d'une création : ce qui a été écrit, et ce qui reste à faire à la main.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameCreateOutcome {
    pub project: GameProject,
    pub files: Vec<String>,
    pub notes: Vec<String>,
}

// ─── Environnement ────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameToolState {
    Ready,
    Missing,
    Optional,
    Error,
    Degraded,
    AuthRequired,
    VersionMismatch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameToolCategory {
    Engine,
    Content,
    Vcs,
    Runtime,
    Sdk,
    Ai,
}

/// Une vérification faite pendant la détection (auto-diagnostic, §123).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameCheck {
    pub label: String,
    pub ok: bool,
    pub detail: Option<String>,
}

/// Outil de la machine et son état (§63, §111).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameTool {
    pub id: String,
    pub label: String,
    pub category: GameToolCategory,
    pub state: GameToolState,
    pub version: Option<String>,
    pub path: Option<String>,
    /// Ce que l'outil permet dans Game Studio.
    pub purpose: String,
    /// Ce qui a été vérifié pour arriver à cet état.
    pub checks: Vec<GameCheck>,
    /// Étapes simples pour l'installer ou le réparer (§122).
    pub setup: Vec<String>,
    pub url: Option<String>,
    /// La personne peut désigner l'exécutable à la main.
    pub overridable: bool,
}

/// Rapport d'environnement (§63).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameEnvironment {
    pub tools: Vec<GameTool>,
    pub engines: Vec<GameEngineInstall>,
    pub checked_at: String,
    pub os: String,
}

// ─── Builds ───────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameBuildStatus {
    Running,
    Success,
    Failed,
    Cancelled,
}

// ─── Journal ──────────────────────────────────────────────────────────────────────────────

/// Catégories du journal structuré (§78).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameLogCategory {
    System,
    Build,
    Engine,
    Mcp,
    Ai,
    Network,
    Asset,
    Code,
    Test,
    Error,
    Performance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameLogLevel {
    Info,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameLogEntry {
    pub at: String,
    pub category: GameLogCategory,
    pub level: GameLogLevel,
    pub message: String,
    #[serde(default)]
    pub detail: Option<String>,
}

// ─── État d'un projet et modifications ────────────────────────────────────────────────────

/// Ce que l'adaptateur du moteur lit dans le projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameEngineInfo {
    pub name: String,
    pub engine_version: Option<String>,
    pub main_scene: Option<String>,
    pub languages: Vec<String>,
    pub packages: Vec<String>,
}

/// Projet ouvert : identité, graphe, moteur, capacités réelles.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameProjectState {
    pub project: GameProject,
    pub graph: GameGraph,
    pub engine_info: Option<GameEngineInfo>,
    pub install: Option<GameEngineInstall>,
    pub capabilities: Vec<GameCapability>,
}

/// Réglages modifiables d'un projet (champs absents : inchangés).
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase", default)]
pub struct GameProjectPatch {
    #[ts(optional = nullable)]
    pub name: Option<String>,
    #[ts(optional = nullable)]
    pub engine: Option<GameEngine>,
    #[ts(optional = nullable)]
    pub engine_version: Option<String>,
    #[ts(optional = nullable)]
    pub mode: Option<GameMode>,
    #[ts(optional = nullable)]
    pub autonomy: Option<GameAutonomy>,
    #[ts(optional = nullable)]
    pub idea: Option<String>,
    #[ts(optional = nullable)]
    pub genres: Option<Vec<String>>,
    #[ts(optional = nullable)]
    pub dimension: Option<GameDimension>,
    #[ts(optional = nullable)]
    pub targets: Option<Vec<GamePlatform>>,
    #[ts(optional = nullable)]
    pub budget: Option<GameBudget>,
    #[ts(optional = nullable)]
    pub style: Option<GameStyleGuide>,
    #[ts(optional = nullable)]
    pub version: Option<String>,
}

/// Une modification du graphe de connaissance, faite par la personne ou par un agent.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum GameGraphOp {
    /// Ajoute ou remplace un système (dépendances connues, sans cycle).
    #[serde(rename_all = "camelCase")]
    UpsertSystem { system: GameSystem },
    /// Ajoute un système du catalogue et ses dépendances manquantes.
    #[serde(rename_all = "camelCase")]
    AddCatalogSystem { id: String },
    /// Retire un système dont plus rien ne dépend.
    #[serde(rename_all = "camelCase")]
    RemoveSystem { id: String },
    #[serde(rename_all = "camelCase")]
    SetSystemStatus {
        id: String,
        status: GameSystemStatus,
    },
    /// Rattache des fichiers (ou motifs) à un système.
    #[serde(rename_all = "camelCase")]
    LinkFiles { id: String, files: Vec<String> },
    #[serde(rename_all = "camelCase")]
    AddDecision {
        title: String,
        decision: String,
        reason: String,
        #[serde(default)]
        alternatives: Vec<String>,
        #[serde(default)]
        tradeoffs: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    RemoveDecision { id: String },
    #[serde(rename_all = "camelCase")]
    AddAssumption {
        topic: String,
        value: String,
        reason: String,
    },
    /// Change la valeur d'une hypothèse (l'ancienne est gardée, marquée remplacée) ou la confirme.
    #[serde(rename_all = "camelCase")]
    SetAssumption {
        id: String,
        #[serde(default)]
        value: Option<String>,
        status: GameAssumptionStatus,
    },
    #[serde(rename_all = "camelCase")]
    UpsertTask { task: GameTask },
    #[serde(rename_all = "camelCase")]
    SetTaskStatus {
        id: String,
        status: GameTaskStatus,
        #[serde(default)]
        result: Option<String>,
        #[serde(default)]
        conversation_id: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    RemoveTask { id: String },
    #[serde(rename_all = "camelCase")]
    AddIssue {
        title: String,
        #[serde(default)]
        detail: String,
        severity: GameIssueSeverity,
        #[serde(default)]
        systems: Vec<String>,
    },
    #[serde(rename_all = "camelCase")]
    SetIssueOpen { id: String, open: bool },
    #[serde(rename_all = "camelCase")]
    AddChange { change: GameChange },
    #[serde(rename_all = "camelCase")]
    AddVersion {
        version: String,
        label: String,
        #[serde(default)]
        summary: String,
        #[serde(default)]
        checkpoint: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    UpsertPhase { phase: GamePhase },
    #[serde(rename_all = "camelCase")]
    RemovePhase { id: String },
    #[serde(rename_all = "camelCase")]
    SetWorld { world: GameWorldPlan },
    #[serde(rename_all = "camelCase")]
    SetNetwork { network: GameNetworkPlan },
    #[serde(rename_all = "camelCase")]
    UpsertAsset { asset: GameAsset },
    #[serde(rename_all = "camelCase")]
    RemoveAsset { id: String },
}

// ─── Builds et diagnostics ────────────────────────────────────────────────────────────────

/// Erreur ou avertissement lu dans la sortie d'un outil (§107).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameDiagnostic {
    pub severity: GameIssueSeverity,
    pub message: String,
    /// Fichier relatif au projet quand il est connu.
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    /// Code de l'outil (`CS0246`, `C2065`…).
    pub code: Option<String>,
    /// Outil qui l'a produit (`GDScript`, `C#`, `C++`, `Unreal`, `Blender`…).
    pub source: String,
    /// Cause probable, en clair.
    pub likely_cause: Option<String>,
    /// Piste de correction.
    pub suggestion: Option<String>,
    /// Systèmes du graphe concernés (d'après les fichiers rattachés).
    #[serde(default)]
    pub systems: Vec<String>,
}

/// Exécution terminée d'une action moteur (`.gamestudio/builds/history.json`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBuildRecord {
    pub id: String,
    pub action: super::engines::GameAction,
    pub platform: Option<GamePlatform>,
    pub development: bool,
    pub status: GameBuildStatus,
    pub started_at: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub command: String,
    /// Fichier ou dossier produit.
    pub output: Option<String>,
    pub summary: String,
    pub diagnostics: Vec<GameDiagnostic>,
    pub log_lines: u32,
}
