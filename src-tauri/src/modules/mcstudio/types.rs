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
}

impl BuildTask {
    pub fn gradle_task(self) -> &'static str {
        match self {
            Self::Build => "build",
            Self::Clean => "clean",
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

// ── Textures : OpenRouter, brouillons, application ──────────────────────────

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

/// Modèle d'OpenRouter capable de produire des images.
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
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct ImageModelList {
    pub models: Vec<ImageModel>,
    /// Liste lue dans le cache : OpenRouter injoignable.
    pub offline: bool,
}

/// Ce qu'une texture habille : un objet, un bloc ou l'icône du mod.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextureTarget {
    Item { id: String },
    Block { id: String },
    Icon,
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
}

/// Origine d'un brouillon de texture.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DraftSource {
    OpenRouter { model: String, prompt: String },
    File { name: String },
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
}

#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct TextureRequest {
    pub target: TextureTarget,
    /// Ce que la personne décrit (« épée en rubis, garde dorée »).
    pub description: String,
    pub model: String,
    pub options: PixelOptions,
    /// Accord explicite pour un modèle payant.
    pub allow_paid: bool,
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
