//! Types échangés avec le frontend (bindings générés par ts-rs dans `src/core/ipc/bindings/`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Mod loader d'un projet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "lowercase")]
pub enum LoaderId {
    Fabric,
    Forge,
    Neoforge,
}

impl LoaderId {
    pub fn label(self) -> &'static str {
        match self {
            Self::Fabric => "Fabric",
            Self::Forge => "Forge",
            Self::Neoforge => "NeoForge",
        }
    }
}

/// Profil de version : ce qu'il faut pour construire un mod pour une plage de versions.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProfileInfo {
    pub id: String,
    pub loader: LoaderId,
    pub label: String,
    pub minecraft_min: String,
    pub minecraft_max: String,
    pub java: u32,
    pub java_max: Option<u32>,
    pub gradle: String,
    pub mappings: String,
    /// Une vraie compilation a déjà réussi avec ce profil.
    pub verified: bool,
    pub notes: Option<String>,
}

/// Prise en charge d'une version de Minecraft par un loader.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct LoaderSupport {
    pub loader: LoaderId,
    /// Le loader publie une version pour ce Minecraft (métadonnées officielles).
    pub available: bool,
    /// Profil Mod Studio qui sait construire ce couple ; `None` = non supporté.
    pub profile_id: Option<String>,
    /// Pourquoi ce couple n'est pas pris en charge (quand `profile_id` est `None`).
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct VersionOption {
    pub minecraft: String,
    pub loaders: Vec<LoaderSupport>,
}

/// Versions de Minecraft connues des loaders, croisées avec les profils.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct VersionCatalog {
    pub versions: Vec<VersionOption>,
    pub profiles: Vec<ProfileInfo>,
    /// Au moins une source n'a pas répondu : données issues du cache.
    pub offline: bool,
    /// Sources injoignables et sans cache (message lisible).
    pub errors: Vec<String>,
}

/// Versions exactes retenues pour créer un projet.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ResolvedVersions {
    pub profile_id: String,
    pub loader: LoaderId,
    pub minecraft: String,
    pub loader_version: String,
    /// Yarn pour Fabric ; `None` pour les mappings officiels.
    pub mappings_version: Option<String>,
    /// Fabric API ; `None` pour Forge et NeoForge.
    pub api_version: Option<String>,
    pub java: u32,
    pub java_max: Option<u32>,
    pub gradle: String,
    pub plugin: String,
    /// Résolu depuis le cache faute de réseau.
    pub offline: bool,
}

/// Une version proposée dans une liste (loader, mappings, API).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct VersionChoice {
    pub value: String,
    /// Stable (par opposition à bêta) selon la source officielle.
    pub stable: bool,
    /// Version recommandée par le loader (Forge) ou la plus récente stable.
    pub recommended: bool,
}

/// Versions choisies à la main ; `None` = celle proposée par défaut.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct VersionSelection {
    pub loader_version: Option<String>,
    pub mappings_version: Option<String>,
    pub api_version: Option<String>,
}

/// Versions disponibles pour un couple Minecraft × loader, les plus récentes d'abord.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct VersionOptions {
    pub loader: Vec<VersionChoice>,
    /// Yarn (Fabric) ; vide pour les mappings officiels.
    pub mappings: Vec<VersionChoice>,
    /// Le profil demande Yarn (Fabric jusqu'à 1.21.x) ; faux pour les noms officiels de Mojang.
    pub yarn: bool,
    /// Fabric API ; vide pour Forge et NeoForge.
    pub api: Vec<VersionChoice>,
    pub offline: bool,
}

/// JDK installé sur la machine.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct JavaInstall {
    pub path: String,
    pub version: String,
    pub major: u32,
    pub vendor: Option<String>,
}

/// JDK retenu pour un projet, ou ce qui manque.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct JavaStatus {
    pub install: Option<JavaInstall>,
    pub min: u32,
    pub max: Option<u32>,
    /// Ce qu'il faut installer quand aucun JDK ne convient.
    pub problem: Option<String>,
}

/// JDK prêt à être téléchargé, tel que la source officielle le décrit.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct JdkOffer {
    pub major: u32,
    /// `jdk-21.0.4+7`
    pub release_name: String,
    pub vendor: String,
    pub url: String,
    pub file_name: String,
    #[ts(type = "number")]
    pub size: u64,
    pub sha256: String,
    /// Dossier où il sera installé (données d'ARCHIMED, rien dans le système).
    pub target_dir: String,
}

/// Besoin en Java de l'ensemble des profils : quelle version, et qui la satisfait.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct JdkNeed {
    pub major: u32,
    /// Cette version exactement (Forge 1.14 – 1.20 : les JVM plus récentes échouent).
    pub exact: bool,
    /// JDK compatible déjà présent (le plus proche du besoin).
    pub installed: Option<JavaInstall>,
    /// Plages de Minecraft concernées (« Fabric · 1.14 – 1.16.5 »…).
    pub used_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub jdks: Vec<JavaInstall>,
    pub needs: Vec<JdkNeed>,
    /// Dossier des JDK installés par Mod Studio.
    pub managed_dir: String,
}

/// Déroulé d'une installation de JDK, transmis par `Channel`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum InstallEvent {
    Downloading {
        #[ts(type = "number")]
        received: u64,
        #[ts(type = "number")]
        total: u64,
    },
    Verifying,
    Extracting,
    Done {
        install: JavaInstall,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum License {
    /// Aucune licence : tous droits réservés.
    None,
    Mit,
}

impl License {
    pub fn spdx(self) -> &'static str {
        match self {
            Self::None => "All-Rights-Reserved",
            Self::Mit => "MIT",
        }
    }
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    pub name: String,
    pub mod_id: String,
    pub package: String,
    pub main_class: String,
    pub author: String,
    pub description: String,
    /// Dossier parent ; le projet est créé dans `<parent>/<modId>`.
    pub parent_dir: String,
    pub versions: ResolvedVersions,
    pub license: License,
    /// Ajoute un objet, un bloc et deux recettes d'exemple.
    pub with_example: bool,
    /// JDK choisi ; `None` = détection automatique au moment du build.
    pub java_home: Option<String>,
}

/// Étape d'un portage vers une autre version de Minecraft.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PortStep {
    pub title: String,
    pub detail: String,
    /// Faite par Mod Studio ; sinon à faire dans le code (assistant IA).
    pub automatic: bool,
}

/// Ce qu'un portage fera, montré avant de confirmer.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PortPlan {
    pub from_minecraft: String,
    pub to_minecraft: String,
    pub from_profile: String,
    pub to_profile: String,
    pub steps: Vec<PortStep>,
    /// Changements d'API connus entre les deux versions.
    pub notes: Vec<String>,
}

/// Résultat d'un portage.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PortOutcome {
    pub summary: ProjectSummary,
    /// Point de restauration créé avant (pour annuler).
    pub snapshot: String,
    pub done: Vec<String>,
    pub warnings: Vec<String>,
    /// Message prêt pour l'assistant IA (code Java à adapter).
    pub prompt: String,
}

/// Ce que l'examen d'un projet existant (Fabric, Forge, NeoForge) a trouvé, avant l'import.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub path: String,
    /// Déjà un projet Mod Studio : il suffit de l'ouvrir.
    pub existing: bool,
    pub loader: Option<LoaderId>,
    pub minecraft: String,
    pub loader_version: String,
    pub mappings_version: Option<String>,
    pub api_version: Option<String>,
    pub mod_id: String,
    pub name: String,
    pub package: String,
    pub main_class: String,
    pub mod_version: String,
    pub author: String,
    pub description: String,
    /// Version de Gradle du wrapper du projet.
    pub gradle: Option<String>,
    /// Profil Mod Studio qui sait construire ce projet.
    pub profile_id: Option<String>,
    /// Pourquoi le projet ne peut pas être importé.
    pub problem: Option<String>,
    /// Remarques (mappings, paquet déduit…).
    pub notes: Vec<String>,
}

/// `.mcstudio/project.json` : identité et contexte de version d'un projet.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub format: u32,
    pub id: String,
    pub name: String,
    pub mod_id: String,
    pub package: String,
    pub main_class: String,
    pub author: String,
    pub description: String,
    pub mod_version: String,
    pub license: License,
    pub versions: ResolvedVersions,
    pub java_home: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ProjectHealth {
    Ok,
    /// Dossier absent (déplacé, supprimé, disque débranché).
    Missing,
    /// `project.json` illisible.
    Corrupt,
}

/// Entrée de la liste des projets.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub path: String,
    pub health: ProjectHealth,
    pub meta: Option<ProjectMeta>,
    /// Date de dernière modification d'un fichier source (ISO 8601).
    pub updated_at: Option<String>,
    pub last_build: Option<BuildRecord>,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProjectStats {
    pub java_classes: u32,
    pub kotlin_classes: u32,
    pub items: u32,
    pub blocks: u32,
    pub entities: u32,
    pub recipes: u32,
    pub loot_tables: u32,
    pub textures: u32,
    pub models: u32,
    pub sounds: u32,
    pub lang_files: u32,
    pub assets: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BuildTask {
    Build,
    Clean,
    /// Lance Minecraft avec le mod (configuration de lancement du projet).
    RunClient,
    /// Lance un serveur dédié avec le mod (vérifie qu'il n'appelle pas de code client).
    RunServer,
}

impl BuildTask {
    pub fn gradle_task(self) -> &'static str {
        match self {
            Self::Build => "build",
            Self::Clean => "clean",
            Self::RunClient => "runClient",
            Self::RunServer => "runServer",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BuildStatus {
    Success,
    Failed,
    Cancelled,
}

/// Compilation terminée, conservée dans `.mcstudio/builds.json`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct BuildRecord {
    pub id: String,
    pub task: BuildTask,
    pub status: BuildStatus,
    pub started_at: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub command: String,
    /// Jar produit par Gradle (`build/libs`).
    pub jar: Option<String>,
    /// Copie du jar dans `dist/`.
    pub dist: Option<String>,
    pub issues: Vec<BuildIssue>,
    /// Phrase lisible : « Compilation réussie », « Gradle n'a pas réussi… ».
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum IssueKind {
    Java,
    Gradle,
    Json,
    Dependency,
    Network,
    JavaVersion,
    Mapping,
    /// Le jeu a démarré puis s'est arrêté sur une erreur (partie de test).
    Crash,
    Unknown,
}

/// Erreur de build expliquée.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct BuildIssue {
    pub kind: IssueKind,
    /// Cause probable, en français.
    pub title: String,
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    /// Message d'origine (compilateur ou Gradle).
    pub message: String,
    /// Solution proposée.
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum LogLevel {
    Debug,
    Info,
    Warning,
    Error,
}

/// Flux d'une compilation, transmis par `Channel`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum BuildEvent {
    Started {
        build_id: String,
        command: String,
        cwd: String,
        java_home: String,
        java_version: String,
    },
    Line {
        stream: LogStream,
        level: LogLevel,
        text: String,
    },
    /// Tâche Gradle en cours (« :compileJava »).
    Task {
        name: String,
    },
    Finished {
        record: BuildRecord,
    },
}

/// Fichiers écrits par un générateur (chemins relatifs au projet).
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ContentResult {
    pub created: Vec<String>,
    pub modified: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BlockSound {
    Stone,
    Metal,
    Wood,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ItemRequest {
    /// Nom de registre (`ruby`).
    pub id: String,
    pub name_en: String,
    pub name_fr: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct BlockRequest {
    pub id: String,
    pub name_en: String,
    pub name_fr: String,
    pub hardness: f32,
    pub resistance: f32,
    pub sound: BlockSound,
}

/// Recette, au format de données de la version du projet.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum RecipeRequest {
    Shaped {
        id: String,
        pattern: Vec<String>,
        /// Symbole → objet (`minecraft:stick`, `monmod:ruby`).
        key: std::collections::BTreeMap<String, String>,
        result: String,
        count: u32,
    },
    Shapeless {
        id: String,
        ingredients: Vec<String>,
        result: String,
        count: u32,
    },
    Smelting {
        id: String,
        ingredient: String,
        result: String,
        experience: f32,
        cooking_time: u32,
    },
}

// ── Textures : OpenRouter, Google Gemini, brouillons, application ───────────

/// Service qui dessine les textures, avec la clé API de la personne.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ImageProvider {
    #[default]
    OpenRouter,
    /// API Gemini de Google (clé Google AI Studio) : modèles « Nano Banana ».
    Gemini,
    /// Higgsfield avec une clé d'API (couche d'images du core).
    Higgsfield,
    /// Higgsfield avec le compte de la personne, par la CLI officielle (crédits de l'abonnement).
    HiggsfieldAccount,
}

/// Outil officiel de Higgsfield (mode compte) : présent, installable par npm.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct HiggsfieldCliState {
    pub installed: bool,
    pub npm: bool,
    pub package: String,
}

/// Clé Google AI Studio : présente ou non, et ce que l'API Gemini en dit quand on vérifie.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GeminiStatus {
    pub configured: bool,
    /// Modèles d'image accessibles avec la clé (lu lors de la vérification).
    pub image_models: Option<u32>,
    /// Vérification impossible (réseau, clé refusée) : explication.
    pub problem: Option<String>,
}

/// Clé OpenRouter : présente ou non, et ce qu'OpenRouter en dit quand on vérifie.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct OpenRouterStatus {
    pub configured: bool,
    /// Libellé renvoyé par OpenRouter (clé masquée ou nom donné sur le site).
    pub label: Option<String>,
    /// Compte sans crédit acheté : seuls les modèles gratuits répondent.
    pub free_tier: Option<bool>,
    /// Crédit restant en dollars, quand la clé a une limite.
    pub credits_left: Option<f64>,
    /// Vérification impossible (réseau, clé refusée) : explication.
    pub problem: Option<String>,
}

/// Modèle capable de produire des images (OpenRouter ou Google Gemini).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImageModel {
    pub id: String,
    pub name: String,
    /// Aucun coût annoncé (prix nuls ou suffixe `:free`).
    pub free: bool,
    pub description: String,
    /// Le modèle répond aussi du texte (`modalities: ["image", "text"]`).
    pub text_output: bool,
    /// Le modèle accepte une image en entrée (texture de référence, retouche).
    #[serde(default)]
    pub image_input: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImageModelList {
    pub models: Vec<ImageModel>,
    /// Liste lue dans le cache : service injoignable.
    pub offline: bool,
}

/// Face d'un bloc dont les faces n'ont pas toutes la même texture.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BlockFace {
    Top,
    Bottom,
    /// Les quatre côtés (colonne, dessus-dessous-côtés).
    Side,
    /// Les deux extrémités d'une colonne (bûche, pilier).
    End,
    North,
    South,
    East,
    West,
}

/// Répartition des textures sur les faces d'un bloc (modèle parent du jeu).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum BlockLayout {
    /// Une texture sur les six faces (`cube_all`).
    All,
    /// Côtés + extrémités, comme une bûche (`cube_column`).
    Column,
    /// Dessus, dessous et côtés (`cube_bottom_top`).
    BottomTop,
    /// Six faces différentes (`cube`).
    Faces,
    /// Modèle écrit à la main : ses textures ne sont pas réparties par l'atelier.
    Custom,
}

/// Ce qu'une texture habille : un objet, un bloc (ou une de ses faces), l'icône du mod, un
/// élément d'interface (`textures/gui/`) ou toute autre texture du mod (superposition,
/// entité, armure, particule…).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextureTarget {
    Item {
        id: String,
    },
    Block {
        id: String,
        /// `None` : la texture unique du bloc (`cube_all`).
        #[serde(default)]
        face: Option<BlockFace>,
    },
    Icon,
    Gui {
        name: String,
    },
    /// Toute autre texture, par son chemin sous `textures/` sans `.png`
    /// (`misc/googles_overlay`, `entity/ruby_golem`, `models/armor/ruby_layer_1`…).
    Asset {
        path: String,
    },
}

/// Famille d'une texture libre, d'après son dossier et son nom : classement dans l'onglet
/// Textures, texte envoyé au modèle, réglages de départ.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum AssetKind {
    /// Superposition plein écran (casque, lunettes, citrouille, longue-vue…).
    Overlay,
    Entity,
    Armor,
    Particle,
    /// Icône d'effet de statut (`mob_effect/`).
    Effect,
    Painting,
    Gui,
    Other,
}

/// Une texture du projet (existante ou attendue par un objet / bloc déclaré).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TextureInfo {
    pub target: TextureTarget,
    /// Nom affiché (traduction du jeu si elle existe).
    pub label: String,
    /// Chemin absolu du PNG.
    pub path: String,
    /// Chemin relatif au projet.
    pub relative: String,
    pub exists: bool,
    pub width: u32,
    pub height: u32,
    /// Date de modification (ms), pour rafraîchir l'aperçu.
    #[ts(type = "number | null")]
    pub modified: Option<u64>,
    /// Blocs : répartition des textures sur les faces.
    pub layout: Option<BlockLayout>,
    /// PNG qu'aucun modèle, objet ni bloc n'utilise (face laissée par un changement de
    /// répartition, fichier en trop) : proposé à la suppression.
    pub unused: bool,
    /// Textures libres : leur famille.
    pub asset_kind: Option<AssetKind>,
    /// Fichier du mod qui cite la texture (code, modèle, JSON), quand il est connu.
    pub used_by: Option<String>,
}

/// Raccord d'une texture répétée côte à côte.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum Tiling {
    /// Texture unique (face avant, extrémité de bûche, objet).
    #[default]
    None,
    /// Gauche ↔ droite seulement (côté d'un bloc d'herbe : sa bande du haut reste en haut).
    Horizontal,
    /// Dans les deux sens (pierre, minerai, planches).
    Both,
}

/// Réglages de conversion en pixel-art.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PixelOptions {
    /// Côté de la texture en pixels : 16, 32 ou 64.
    pub size: u32,
    /// Nombre maximal de couleurs (0 : sans limite).
    pub colors: u32,
    /// Retirer le fond et cadrer l'objet (objets, icône détourée).
    pub transparent: bool,
    /// Raccord quand la texture est répétée (faces de bloc).
    #[serde(default)]
    pub tiling: Tiling,
    /// Contour sombre d'un pixel autour de l'objet, comme les objets du jeu.
    #[serde(default)]
    pub outline: bool,
    /// Éléments d'interface : taille libre (remplace `size`), 1 à 256 pixels.
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// Élément posé en haut à gauche d'une toile 256 × 256 (convention des écrans du jeu).
    #[serde(default)]
    pub atlas: bool,
    /// Zone de l'image reçue qui devient la texture (pixels de l'image d'origine) ; `None` :
    /// toute l'image.
    #[serde(default)]
    pub crop: Option<CropRect>,
}

/// Rectangle choisi dans l'image reçue.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// Origine d'un brouillon de texture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DraftSource {
    OpenRouter {
        model: String,
        prompt: String,
    },
    Gemini {
        model: String,
        prompt: String,
    },
    Higgsfield {
        model: String,
        prompt: String,
    },
    File {
        name: String,
    },
    /// Texture du projet reprise telle quelle pour être retouchée.
    Project {
        path: String,
    },
}

/// Texture proposée, pas encore écrite dans le projet.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TextureDraft {
    pub id: String,
    pub project_id: String,
    pub target: TextureTarget,
    pub source: DraftSource,
    /// Image reçue ou importée, telle quelle.
    pub original_path: String,
    pub original_width: u32,
    pub original_height: u32,
    /// Texture convertie (PNG), réécrite à chaque réglage.
    pub pixel_path: String,
    pub options: PixelOptions,
    /// Augmente à chaque conversion : contourne le cache de l'aperçu.
    pub revision: u32,
    pub created_at: String,
    /// Retouchée à la main : une nouvelle conversion effacerait ces retouches.
    #[serde(default)]
    pub edited: bool,
    /// Qualité du raccord quand la texture est répétée (0 à 100), textures pleines seulement.
    #[serde(default)]
    pub seam: Option<u8>,
    /// Ce que la conversion a corrigé (cadre retiré, raccord…).
    #[serde(default)]
    pub notes: Vec<String>,
}

/// Pixels d'un brouillon, pour l'éditeur (RVBA, ligne par ligne, en base64).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PixelData {
    pub width: u32,
    pub height: u32,
    pub rgba: String,
}

/// Famille d'un modèle 3D du mod (onglet Modèles).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ModelKind {
    /// `models/block/…json` (cubes du format des blocs).
    Block,
    /// `models/item/…json` : objet à plat (sprite en relief) ou en 3D (cubes).
    Item,
    /// Modèle d'entité (`.mcstudio/models/<nom>.json`), traduit en code Java.
    Entity,
    /// Armure portée : textures des couches sur le modèle humanoïde du jeu.
    Armor,
}

/// Un modèle 3D du projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub kind: ModelKind,
    /// `block/lamp`, `item/ruby_sword` (chemin sous `models/`), nom de l'entité ou de l'armure.
    pub id: String,
    pub label: String,
    /// Fichier source, relatif au projet.
    pub relative: String,
    /// Bloc ou objet décrit par ses propres cubes (`elements`), et non par un parent.
    pub custom: bool,
    pub parent: Option<String>,
    /// Textures portées (relatives au projet) : entité ; couches 1 et 2 d'une armure.
    pub textures: Vec<String>,
    #[ts(type = "number | null")]
    pub modified: Option<u64>,
}

/// Fichier de modèle de bloc ou d'objet, lu tel quel.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub relative: String,
    pub exists: bool,
    /// Contenu JSON (vide si le fichier n'existe pas).
    pub json: String,
}

/// Cube d'un os, dans l'espace des modèles d'entité du jeu (pixels, Y vers le bas).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct EntityCube {
    /// Coin minimal, relatif au pivot de l'os.
    pub origin: [f32; 3],
    pub size: [f32; 3],
    /// Coin haut-gauche de la zone du cube dans la texture (UV « en boîte » du jeu).
    pub uv: [u32; 2],
    /// Gonflement (armure, couches superposées), sans changer la zone de texture.
    #[serde(default)]
    pub inflate: f32,
    /// Zone de texture retournée gauche-droite (bras et jambes symétriques).
    #[serde(default)]
    pub mirror: bool,
}

/// Os d'un modèle d'entité : un point de pivot, une rotation, des cubes et des os enfants.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct EntityBone {
    pub name: String,
    /// Os parent ; `None` : à la racine du modèle.
    #[serde(default)]
    pub parent: Option<String>,
    /// Pivot, relatif à celui du parent (à la racine : 24 = sol).
    pub pivot: [f32; 3],
    /// Rotation en degrés autour de X, Y et Z (appliquée comme le jeu : Z, puis Y, puis X).
    #[serde(default)]
    pub rotation: [f32; 3],
    #[serde(default)]
    pub cubes: Vec<EntityCube>,
}

/// Modèle d'entité : ce que le jeu construit avec `TexturedModelData` / `LayerDefinition`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct EntityModel {
    pub name: String,
    pub texture_width: u32,
    pub texture_height: u32,
    pub bones: Vec<EntityBone>,
}

/// Ce que l'enregistrement d'un modèle d'entité a écrit.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct EntitySaved {
    pub model: ModelInfo,
    /// Classe Java générée (relative au projet).
    pub java: Option<String>,
    /// Pourquoi le code n'a pas été généré (versions 1.14 à 1.16).
    pub note: Option<String>,
}

/// Style demandé au modèle d'image.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum TextureStyle {
    /// Textures du jeu de base : palette réduite, léger bruit, lumière en haut à gauche.
    #[default]
    Vanilla,
    /// Plus de détails et de contraste, toujours en pixel-art.
    Detailed,
    /// Formes simples, peu de couleurs, aplats.
    Simple,
}

/// Comment le texte envoyé au modèle est construit.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct PromptSettings {
    #[serde(default)]
    pub style: TextureStyle,
    /// Consignes ajoutées à la fin (« lumière froide », « bordure dorée »…).
    #[serde(default)]
    pub extra: String,
    /// Une texture de référence accompagne la demande.
    #[serde(default)]
    pub with_reference: bool,
    /// Taille visée (éléments d'interface), pour annoncer le format au modèle.
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    /// Le fond sera retiré : le modèle dessine sur un fond d'incrustation uni (magenta, ou vert
    /// si l'objet est rose ou violet).
    #[serde(default)]
    pub transparent: bool,
}

/// Élément d'interface de départ, dessiné sans IA au format des écrans du jeu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GuiPreset {
    /// Fond d'écran de conteneur 176 × 166 (toile 256 × 256).
    Panel,
    /// Même fond avec l'inventaire du joueur (3 × 9 cases + barre rapide).
    InventoryPanel,
    /// Bouton 200 × 20.
    Button,
    /// Case d'inventaire 18 × 18.
    Slot,
    /// Flèche de progression 24 × 17.
    Arrow,
    /// Toile transparente de la taille choisie.
    Blank,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GuiRequest {
    /// Nom du fichier dans `textures/gui/` (minuscules, chiffres, `_`).
    pub name: String,
    pub preset: GuiPreset,
    /// Taille de la toile vide (`Blank`) : 1 à 256.
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TextureRequest {
    pub target: TextureTarget,
    /// Ce que la personne décrit (« épée en rubis, garde dorée »).
    pub description: String,
    /// Service qui dessine (OpenRouter si absent : demandes d'avant Gemini).
    #[serde(default)]
    pub provider: ImageProvider,
    pub model: String,
    pub options: PixelOptions,
    /// Accord explicite pour un modèle payant.
    pub allow_paid: bool,
    #[serde(default)]
    pub prompt: PromptSettings,
    /// Texte envoyé tel quel au modèle, à la place du texte construit.
    #[serde(default)]
    pub custom_prompt: Option<String>,
    /// Texture du projet envoyée en référence (chemin relatif au projet, `.png`).
    #[serde(default)]
    pub reference: Option<String>,
}

// ── Fichiers du projet (explorateur, éditeur) ───────────────────────────────

/// Entrée de l'explorateur ; `path` est relatif au projet, avec des `/`.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    #[ts(type = "number")]
    pub size: u64,
    /// Dossier de build, de cache ou d'état interne : affiché en retrait.
    pub ignored: bool,
}

/// Fichier ouvert dans l'éditeur.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub path: String,
    /// Texte (vide pour un fichier binaire).
    pub content: String,
    pub binary: bool,
    /// PNG, JPEG… : aperçu au lieu du texte.
    pub image: bool,
    /// Fichier trop gros : seul le début est montré, en lecture seule.
    pub truncated: bool,
    #[ts(type = "number")]
    pub size: u64,
    /// Date de modification (ms) : l'enregistrement refuse d'écraser un fichier changé entre-temps.
    #[ts(type = "number")]
    pub modified: u64,
}

// ── Validation du projet ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Error,
    Warning,
}

/// Problème trouvé sans compiler : fichier illisible, référence cassée, format d'une autre version.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub severity: Severity,
    /// Chemin relatif au projet, avec des `/`.
    pub file: String,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub issues: Vec<ValidationIssue>,
    /// Fichiers lus.
    pub files: u32,
    pub errors: u32,
    pub warnings: u32,
}

// ── Instantanés (points de restauration) ────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum SnapshotKind {
    /// Créé à la main.
    Manual,
    /// Avant l'application de modifications proposées par une IA.
    Ai,
    /// Avant une restauration (pour pouvoir l'annuler).
    Restore,
    /// Avant un changement fait dans l'atelier des textures (faces d'un bloc).
    Texture,
    /// Avant l'enregistrement d'un modèle 3D.
    Model,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct SnapshotFile {
    pub path: String,
    /// Le fichier n'existait pas : le restaurer revient à le supprimer (Corbeille).
    pub existed: bool,
}

/// Point de restauration : copie des fichiers concernés, dans `.mcstudio/snapshots/<id>/`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub label: String,
    pub kind: SnapshotKind,
    pub created_at: String,
    pub files: Vec<SnapshotFile>,
    #[ts(type = "number")]
    pub size: u64,
}

// ── Agent IA : copie de travail ─────────────────────────────────────────────

/// Copie de travail de l'agent (son dossier de travail).
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct WorkInfo {
    /// Chemin absolu : `cwd` de la conversation.
    pub path: String,
    pub files: u32,
    /// Modifications de l'agent pas encore appliquées ni rejetées.
    pub pending: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
}

/// Fichier que l'agent a créé, modifié ou supprimé dans sa copie.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct WorkChange {
    pub path: String,
    pub kind: ChangeKind,
    /// Le fichier du projet a aussi changé depuis la copie : appliquer écraserait ce changement.
    pub conflict: bool,
    pub binary: bool,
    /// Texte actuel dans le projet (`null` : absent, binaire ou trop gros).
    pub before: Option<String>,
    /// Texte proposé par l'agent.
    pub after: Option<String>,
    /// Chemin absolu de la version de l'agent (aperçu d'image).
    pub work_path: String,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ApplyOutcome {
    /// Point de restauration pris juste avant.
    pub snapshot: Snapshot,
    pub applied: Vec<String>,
}

/// Archive des sources d'un projet, prête à partager ou à sauvegarder.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ExportOutcome {
    pub path: String,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Points à vérifier avant de partager (jeton possible dans un fichier…).
    pub warnings: Vec<String>,
}
