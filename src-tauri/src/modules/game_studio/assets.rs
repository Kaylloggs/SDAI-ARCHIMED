//! Ressources du jeu (§11, §40) : registre, dossiers par moteur, import de fichiers, trace
//! d'import laissée par le moteur, consignes d'images générées et commandes Blender sans
//! interface.
//!
//! Rien n'est supposé : un fichier est copié ou non, le moteur a écrit son fichier d'import
//! (`.import` de Godot, `.meta` d'Unity, `.uasset` d'Unreal) ou non, Blender a écrit son
//! résultat ou l'action échoue.

use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::core::{AppError, AppResult};

use super::engines::{display, folder_name, CommandSpec};
use super::scanner::{kind_of, GameFileKind};
use super::store::state_dir;
use super::types::*;

/// Ligne écrite par les scripts Blender de Game Studio quand tout s'est bien passé.
pub const BLENDER_MARKER: &str = "ARCHIMED_BLENDER_OK";
const INSPECT_PY: &str = include_str!("blender/inspect.py");
const EXPORT_PY: &str = include_str!("blender/export.py");
/// Fichiers hors registre montrés au plus.
const MAX_LOOSE: usize = 2000;
/// Fichiers parcourus au plus pour les trouver.
const MAX_WALK: usize = 60_000;

// ─── Types partagés ───────────────────────────────────────────────────────────────────────

/// Format d'export d'un modèle : GLB pour Godot, FBX pour Unity et Unreal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameModelFormat {
    Glb,
    Fbx,
}

impl GameModelFormat {
    pub fn ext(self) -> &'static str {
        match self {
            Self::Glb => "glb",
            Self::Fbx => "fbx",
        }
    }

    pub fn for_engine(engine: Option<GameEngine>) -> Self {
        match engine {
            Some(GameEngine::Unity) | Some(GameEngine::Unreal) => Self::Fbx,
            _ => Self::Glb,
        }
    }
}

/// Travail sur les ressources confié à Blender ou au moteur (suivi comme une action moteur).
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GameAssetJob {
    /// Lire un fichier .blend : objets, triangles, matériaux, textures, animations.
    #[serde(rename_all = "camelCase")]
    BlenderInspect { asset: String },
    /// Exporter un fichier .blend pour le moteur (format du moteur si absent).
    #[serde(rename_all = "camelCase")]
    BlenderExport {
        asset: String,
        format: Option<GameModelFormat>,
    },
    /// Lancer un script Python du projet dans Blender, sur un fichier .blend ou non.
    #[serde(rename_all = "camelCase")]
    BlenderScript {
        script: String,
        blend: Option<String>,
    },
    /// Faire importer les ressources par le moteur.
    EngineImport,
}

/// Ce qu'il reste à faire après la réussite d'un travail sur les ressources.
#[derive(Debug, Clone)]
pub enum Followup {
    Inspect {
        asset: String,
        json: PathBuf,
    },
    Export {
        asset: String,
        output: String,
        format: GameModelFormat,
    },
    Script {
        script: String,
    },
    Import,
}

/// Une ressource du registre, avec ce que le disque et le moteur en disent.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameAssetEntry {
    pub asset: GameAsset,
    /// Le fichier existe dans le projet.
    pub exists: bool,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Le moteur l'a pris en compte (fichier d'import présent).
    pub in_engine: bool,
    /// Chemin absolu, pour l'aperçu.
    pub absolute: Option<String>,
}

/// Fichier de ressource présent dans le projet mais absent du registre.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameLooseFile {
    pub path: String,
    pub kind: GameAssetKind,
    #[ts(type = "number")]
    pub bytes: u64,
    pub in_engine: bool,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBlenderTool {
    pub path: String,
    pub version: Option<String>,
}

/// Vue des ressources d'un projet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameAssetsView {
    pub entries: Vec<GameAssetEntry>,
    pub loose: Vec<GameLooseFile>,
    /// La recherche des fichiers hors registre s'est arrêtée avant la fin.
    pub loose_truncated: bool,
    /// Dossier où arrivent les fichiers importés, selon le moteur.
    pub folder: String,
    /// Comment le moteur prend les ressources en compte.
    pub import_hint: String,
    pub blender: Option<GameBlenderTool>,
}

/// Demande d'image générée pour le jeu.
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameImageRequest {
    pub provider: crate::core::imaging::ProviderId,
    pub model: String,
    /// Ce que la personne demande (la consigne envoyée y ajoute l'usage et la charte).
    pub prompt: String,
    pub name: String,
    pub kind: GameAssetKind,
    /// Nouvelle version d'une ressource existante.
    pub asset: Option<String>,
    pub aspect_ratio: Option<String>,
    pub resolution: Option<String>,
    #[ts(type = "number | null")]
    pub seed: Option<u64>,
    pub negative_prompt: Option<String>,
    pub transparent: bool,
    /// Ajouter la charte graphique du projet à la consigne.
    pub use_style: bool,
}

// ─── Lecture d'un fichier .blend ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBlendObject {
    pub name: String,
    /// Type Blender (`MESH`, `ARMATURE`, `EMPTY`, `LIGHT`, `CAMERA`…).
    #[serde(rename = "type")]
    pub kind: String,
    pub parent: Option<String>,
    pub dimensions: Vec<f64>,
    pub scale: Vec<f64>,
    #[serde(default)]
    pub materials: Vec<String>,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub vertices: u32,
    pub triangles: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBlendImage {
    pub name: String,
    pub path: String,
    pub packed: bool,
    pub found: bool,
    pub size: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBlendAction {
    pub name: String,
    pub frames: Vec<f64>,
}

/// Résumé d'un fichier .blend lu par Blender.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameBlendInfo {
    pub blender: String,
    pub file: String,
    pub unit_system: String,
    pub unit_scale: f64,
    pub frame_start: i32,
    pub frame_end: i32,
    pub fps: f64,
    pub objects: Vec<GameBlendObject>,
    pub materials: Vec<String>,
    pub images: Vec<GameBlendImage>,
    pub actions: Vec<GameBlendAction>,
    /// Triangles de tous les maillages (modificateurs appliqués).
    #[serde(default)]
    pub triangles: u32,
    /// Ce qui posera problème dans le moteur.
    #[serde(default)]
    pub warnings: Vec<String>,
    #[serde(default)]
    pub read_at: String,
}

/// Complète la lecture : total des triangles et points à vérifier avant l'export.
pub fn analyze_blend(mut info: GameBlendInfo, at: String) -> GameBlendInfo {
    info.triangles = info.objects.iter().map(|o| o.triangles).sum();
    let mut warnings = Vec::new();
    if !info.objects.iter().any(|o| o.kind == "MESH") {
        warnings.push("Aucun maillage dans ce fichier : rien à afficher dans le jeu.".to_string());
    }
    let scaled: Vec<String> = info
        .objects
        .iter()
        .filter(|o| matches!(o.kind.as_str(), "MESH" | "ARMATURE"))
        .filter(|o| o.scale.iter().any(|s| (s - 1.0).abs() > 1e-3))
        .map(|o| {
            let s: Vec<String> = o.scale.iter().map(|v| trim_number(*v)).collect();
            format!("{} ({})", o.name, s.join(" × "))
        })
        .collect();
    if !scaled.is_empty() {
        warnings.push(format!(
            "Échelle non appliquée : {}. Dans Blender : Objet › Appliquer › Échelle, sinon la taille et la physique diffèrent dans le moteur.",
            scaled.join(", ")
        ));
    }
    for image in info.images.iter().filter(|i| !i.found) {
        warnings.push(format!(
            "Texture introuvable : {} ({}). Retrouvez-la (Fichier › Externe › Trouver les fichiers manquants) ou empaquetez les ressources.",
            image.name, image.path
        ));
    }
    if (info.unit_scale - 1.0).abs() > 1e-6 {
        warnings.push(format!(
            "Échelle d'unité de la scène : {} (1 unité = {} m). Vérifiez la taille une fois dans le moteur.",
            trim_number(info.unit_scale),
            trim_number(info.unit_scale)
        ));
    }
    let untextured: Vec<&str> = info
        .objects
        .iter()
        .filter(|o| o.kind == "MESH" && o.materials.is_empty())
        .map(|o| o.name.as_str())
        .collect();
    if !untextured.is_empty() {
        warnings.push(format!(
            "Sans matériau : {} (gris par défaut dans le moteur).",
            untextured.join(", ")
        ));
    }
    info.warnings = warnings;
    info.read_at = at;
    info
}

fn trim_number(value: f64) -> String {
    let text = format!("{value:.3}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    text.to_string()
}

pub fn blend_info_path(root: &Path, asset: &str) -> PathBuf {
    state_dir(root)
        .join("cache")
        .join("blender")
        .join(format!("{asset}.json"))
}

pub fn load_blend_info(root: &Path, asset: &str) -> Option<GameBlendInfo> {
    std::fs::read_to_string(blend_info_path(root, asset))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

// ─── Dossiers et nature des fichiers ──────────────────────────────────────────────────────

fn folder(kind: GameAssetKind) -> &'static str {
    match kind {
        GameAssetKind::Model => "models",
        GameAssetKind::Texture => "textures",
        GameAssetKind::Material => "materials",
        GameAssetKind::Sprite => "sprites",
        GameAssetKind::Animation => "animations",
        GameAssetKind::Audio => "audio",
        GameAssetKind::Music => "music",
        GameAssetKind::Scene => "scenes",
        GameAssetKind::Prefab => "prefabs",
        GameAssetKind::Script => "scripts",
        GameAssetKind::Shader => "shaders",
        GameAssetKind::Ui => "ui",
        GameAssetKind::Font => "fonts",
        GameAssetKind::Data => "data",
        GameAssetKind::Concept => "concepts",
        GameAssetKind::Vfx => "vfx",
        GameAssetKind::Other => "other",
    }
}

fn title(folder: &str) -> String {
    match folder {
        "ui" => "UI".to_string(),
        "vfx" => "VFX".to_string(),
        _ => {
            let mut chars = folder.chars();
            chars
                .next()
                .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        }
    }
}

/// Racine des ressources brutes : `assets/` (Godot), `Assets/Art/` (Unity), `SourceArt/`
/// (Unreal, importées ensuite dans `Content/`).
pub fn assets_root(engine: Option<GameEngine>) -> &'static str {
    match engine {
        Some(GameEngine::Unity) => "Assets/Art",
        Some(GameEngine::Unreal) => "SourceArt",
        _ => "assets",
    }
}

/// Dossier d'une nature de ressource. Les concepts restent hors du jeu (`docs/concepts`).
pub fn asset_dir(engine: Option<GameEngine>, kind: GameAssetKind) -> String {
    if kind == GameAssetKind::Concept {
        return "docs/concepts".to_string();
    }
    let name = folder(kind);
    match engine {
        Some(GameEngine::Unity) | Some(GameEngine::Unreal) => {
            format!("{}/{}", assets_root(engine), title(name))
        }
        _ => format!("{}/{name}", assets_root(engine)),
    }
}

/// Nature d'un fichier d'après son extension.
pub fn kind_for(path: &Path) -> GameAssetKind {
    match kind_of(path) {
        GameFileKind::Texture => GameAssetKind::Texture,
        GameFileKind::Model => GameAssetKind::Model,
        GameFileKind::Audio => GameAssetKind::Audio,
        GameFileKind::Material => GameAssetKind::Material,
        GameFileKind::Shader => GameAssetKind::Shader,
        GameFileKind::Animation => GameAssetKind::Animation,
        GameFileKind::Font => GameAssetKind::Font,
        GameFileKind::Scene => GameAssetKind::Scene,
        GameFileKind::Script => GameAssetKind::Script,
        GameFileKind::Data => GameAssetKind::Data,
        GameFileKind::Video | GameFileKind::Other => GameAssetKind::Other,
    }
}

fn ext(path: &str) -> String {
    Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Fichier que l'on range comme ressource (images, modèles, sons, polices, vidéos) ; les
/// fichiers internes des moteurs (`.uasset`, `.umap`) n'en sont pas.
fn is_asset_file(path: &Path) -> bool {
    let e = ext(&path.to_string_lossy());
    if matches!(e.as_str(), "uasset" | "umap") {
        return false;
    }
    matches!(
        kind_of(path),
        GameFileKind::Texture
            | GameFileKind::Model
            | GameFileKind::Audio
            | GameFileKind::Font
            | GameFileKind::Video
    )
}

/// Godot crée un fichier `.import` pour ce qu'il convertit ; le reste est lu tel quel.
fn godot_imports(rel: &str) -> bool {
    matches!(
        ext(rel).as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "tga"
            | "bmp"
            | "exr"
            | "hdr"
            | "svg"
            | "ktx"
            | "dds"
            | "glb"
            | "gltf"
            | "fbx"
            | "obj"
            | "dae"
            | "blend"
            | "wav"
            | "ogg"
            | "mp3"
            | "ttf"
            | "otf"
            | "woff"
            | "woff2"
            | "fnt"
    )
}

/// Nom d'asset Unreal : lettres, chiffres et `_`.
fn unreal_name(stem: &str) -> String {
    stem.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect()
}

/// `SourceArt/Models/Props/caisse.fbx` → (`/Game/Models/Props`, `Content/Models/Props/caisse.uasset`).
pub fn unreal_destination(rel: &str) -> Option<(String, String)> {
    let inner = rel.strip_prefix("SourceArt/")?;
    let path = Path::new(inner);
    let stem = path.file_stem()?.to_string_lossy().to_string();
    let parent = path
        .parent()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let game = if parent.is_empty() {
        "/Game".to_string()
    } else {
        format!("/Game/{parent}")
    };
    let content = if parent.is_empty() {
        format!("Content/{}.uasset", unreal_name(&stem))
    } else {
        format!("Content/{parent}/{}.uasset", unreal_name(&stem))
    };
    Some((game, content))
}

/// Le moteur a pris le fichier en compte (il a laissé sa trace d'import).
pub fn in_engine(root: &Path, engine: Option<GameEngine>, rel: &str) -> bool {
    match engine {
        Some(GameEngine::Godot) => {
            !godot_imports(rel) || root.join(format!("{rel}.import")).is_file()
        }
        Some(GameEngine::Unity) => {
            rel.starts_with("Assets/") && root.join(format!("{rel}.meta")).is_file()
        }
        Some(GameEngine::Unreal) => {
            matches!(ext(rel).as_str(), "uasset" | "umap")
                || unreal_destination(rel).is_some_and(|(_, content)| root.join(content).is_file())
        }
        None => false,
    }
}

pub fn import_hint(engine: Option<GameEngine>) -> String {
    match engine {
        Some(GameEngine::Godot) => "Godot importe tout ce qui est dans le projet : « Importer dans Godot » le fait sans ouvrir l'éditeur (un fichier .import par ressource).".to_string(),
        Some(GameEngine::Unity) => "Unity importe le dossier Assets à l'ouverture du projet : « Importer dans Unity » l'ouvre en arrière-plan (un fichier .meta par ressource).".to_string(),
        Some(GameEngine::Unreal) => "Unreal n'utilise que des .uasset : « Importer dans Unreal » convertit les fichiers de SourceArt/ vers Content/ par l'extension Python de l'éditeur.".to_string(),
        None => "Aucun moteur choisi : les fichiers sont rangés dans assets/ en attendant.".to_string(),
    }
}

/// Chemin relatif sûr dans le projet (pas de `..`, pas de chemin absolu).
pub fn safe_relative(rel: &str) -> AppResult<String> {
    let rel = rel.trim().replace('\\', "/");
    let path = Path::new(&rel);
    if rel.is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(AppError::invalid(format!(
            "Chemin refusé : {rel} (un chemin relatif au dossier du jeu est attendu)."
        )));
    }
    Ok(rel.trim_start_matches("./").to_string())
}

/// Chemin libre dans `dir` : `caisse.png`, sinon `caisse-2.png`, `caisse-3.png`…
pub fn unique_path(root: &Path, dir: &str, file: &str) -> String {
    let path = Path::new(file);
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "ressource".to_string());
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    let mut n = 1;
    loop {
        let name = if n == 1 {
            format!("{stem}{extension}")
        } else {
            format!("{stem}-{n}{extension}")
        };
        let rel = format!("{dir}/{name}");
        if !root.join(&rel).exists() {
            return rel;
        }
        n += 1;
    }
}

/// Godot importe tout ce qui est dans le projet : les concepts (`docs/`) restent hors du jeu.
pub fn protect_dir(root: &Path, engine: Option<GameEngine>, rel: &str) {
    if engine == Some(GameEngine::Godot) && rel.starts_with("docs/") {
        let marker = root.join("docs/.gdignore");
        if !marker.exists() {
            let _ = std::fs::write(marker, "");
        }
    }
}

/// Nom de fichier à partir d'un nom lisible : « Caisse en bois » → `caisse-en-bois`.
pub fn file_stem(name: &str) -> String {
    folder_name(name).to_lowercase()
}

// ─── Registre ─────────────────────────────────────────────────────────────────────────────

pub fn entry(root: &Path, engine: Option<GameEngine>, asset: &GameAsset) -> GameAssetEntry {
    let file = asset.path.as_deref().map(|p| root.join(p));
    let meta = file.as_ref().and_then(|f| std::fs::metadata(f).ok());
    GameAssetEntry {
        exists: meta.as_ref().is_some_and(|m| m.is_file()),
        bytes: meta.map(|m| m.len()).unwrap_or(0),
        in_engine: asset
            .path
            .as_deref()
            .is_some_and(|p| in_engine(root, engine, p)),
        absolute: file.map(|f| display(&f)),
        asset: asset.clone(),
    }
}

/// Fichiers de ressources du projet absents du registre.
pub fn loose_files(
    root: &Path,
    engine: Option<GameEngine>,
    ignored: &[&str],
    registered: &HashSet<String>,
) -> (Vec<GameLooseFile>, bool) {
    let skip: HashSet<String> = ignored
        .iter()
        .map(|d| d.to_lowercase())
        .chain(
            [".git", ".gamestudio", "node_modules", ".vs", ".idea", "build"]
                .map(String::from),
        )
        .collect();
    let mut out = Vec::new();
    let mut seen = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_WALK || out.len() >= MAX_LOOSE {
                return (sorted(out), true);
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                let top = dir == root;
                if (top && skip.contains(&name.to_lowercase())) || name.starts_with('.') {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !is_asset_file(&path) {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or(name);
            if registered.contains(&rel) {
                continue;
            }
            out.push(GameLooseFile {
                kind: kind_for(&path),
                bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
                in_engine: in_engine(root, engine, &rel),
                path: rel,
            });
        }
    }
    (sorted(out), false)
}

fn sorted(mut files: Vec<GameLooseFile>) -> Vec<GameLooseFile> {
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

/// Nouvelle entrée du registre pour un fichier du projet.
pub fn new_asset(
    id: String,
    rel: &str,
    kind: GameAssetKind,
    source: GameAssetSource,
    status: GameAssetStatus,
    at: String,
) -> GameAsset {
    let name = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel.to_string());
    GameAsset {
        id,
        name,
        kind,
        source,
        path: Some(rel.to_string()),
        version: 1,
        dependencies: Vec::new(),
        import_settings: None,
        generations: Vec::new(),
        usage: Vec::new(),
        status,
        notes: None,
        updated_at: at,
    }
}

/// Copie un fichier de la machine dans le dossier des ressources du projet. Un fichier déjà
/// dans le projet n'est pas copié. Un `.gltf` emmène ses fichiers `.bin` et ses textures.
/// Rend le chemin relatif et les fichiers liés copiés.
pub fn copy_into_project(
    root: &Path,
    engine: Option<GameEngine>,
    source: &Path,
    kind: GameAssetKind,
) -> AppResult<(String, Vec<String>)> {
    if !source.is_file() {
        return Err(AppError::not_found(format!(
            "Fichier introuvable : {}",
            display(source)
        )));
    }
    let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let canonical = source.canonicalize().unwrap_or_else(|_| source.to_path_buf());
    if let Ok(inside) = canonical.strip_prefix(&canonical_root) {
        return Ok((inside.to_string_lossy().replace('\\', "/"), Vec::new()));
    }
    let file = source
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| AppError::invalid("Nom de fichier illisible."))?;
    let dir = asset_dir(engine, kind);
    let rel = unique_path(root, &dir, &file);
    let target = root.join(&rel);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(source, &target)?;
    let mut linked = Vec::new();
    if ext(&file) == "gltf" {
        let from = source.parent().unwrap_or(Path::new("."));
        let to = target.parent().unwrap_or(root);
        for uri in gltf_dependencies(&std::fs::read_to_string(source).unwrap_or_default()) {
            let (src, dst) = (from.join(&uri), to.join(&uri));
            if src.is_file() && !dst.exists() {
                if let Some(parent) = dst.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(&src, &dst)?;
                linked.push(uri);
            }
        }
    }
    Ok((rel, linked))
}

/// Fichiers relatifs cités par un `.gltf` (tampons et images), sans données intégrées.
pub fn gltf_dependencies(raw: &str) -> Vec<String> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for list in ["buffers", "images"] {
        for item in json
            .get(list)
            .and_then(|v| v.as_array())
            .into_iter()
            .flatten()
        {
            if let Some(uri) = item.get("uri").and_then(|u| u.as_str()) {
                let decoded = uri.replace("%20", " ");
                if !decoded.contains(':') && safe_relative(&decoded).is_ok() {
                    out.push(decoded);
                }
            }
        }
    }
    out
}

// ─── Images générées ──────────────────────────────────────────────────────────────────────

/// Extension d'une image d'après ses premiers octets.
pub fn image_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else if bytes.starts_with(b"GIF8") {
        Some("gif")
    } else {
        None
    }
}

/// Consigne envoyée au modèle : la demande, l'usage dans le jeu, puis la charte du projet.
pub fn image_prompt(
    request: &str,
    kind: GameAssetKind,
    style: &GameStyleGuide,
    use_style: bool,
    transparent: bool,
) -> String {
    let mut lines = vec![request.trim().to_string()];
    let usage = match kind {
        GameAssetKind::Texture => "Usage : texture de jeu vidéo, vue de face à plat, éclairage uniforme sans ombre portée, bords raccordables pour être répétée.",
        GameAssetKind::Material => "Usage : échantillon de matériau de jeu vidéo, vue de face à plat, éclairage uniforme, raccordable.",
        GameAssetKind::Sprite => "Usage : sprite de jeu vidéo, un seul sujet entier et centré, silhouette lisible, sans décor.",
        GameAssetKind::Ui => "Usage : élément d'interface de jeu vidéo, lisible en petit, formes nettes, sans texte sauf demande.",
        GameAssetKind::Vfx => "Usage : élément d'effet visuel de jeu (particule, éclat), centré sur fond noir uni.",
        GameAssetKind::Concept => "Usage : concept art pour préparer le jeu (référence de direction artistique).",
        _ => "Usage : ressource graphique de jeu vidéo.",
    };
    lines.push(usage.to_string());
    if transparent && !matches!(kind, GameAssetKind::Texture | GameAssetKind::Material) {
        lines.push("Fond transparent.".to_string());
    }
    if use_style {
        let mut add = |label: &str, value: &str| {
            if !value.trim().is_empty() {
                lines.push(format!("{label} : {}", value.trim()));
            }
        };
        add("Style visuel", &style.visual_style);
        if !style.palette.is_empty() {
            add("Palette", &style.palette.join(", "));
        }
        match kind {
            GameAssetKind::Texture | GameAssetKind::Material => {
                add("Matériaux", &style.materials);
                add("Environnements", &style.environment_style);
            }
            GameAssetKind::Ui => {
                add("Interface", &style.ui_style);
                add("Typographie", &style.typography);
            }
            GameAssetKind::Vfx => add("Effets", &style.vfx_style),
            GameAssetKind::Sprite | GameAssetKind::Concept => {
                add("Personnages", &style.character_style);
                add("Environnements", &style.environment_style);
            }
            _ => {}
        }
    }
    lines.join("\n")
}

// ─── Blender ──────────────────────────────────────────────────────────────────────────────

/// Écrit les scripts de Game Studio dans `.gamestudio/blender/` (réécrits à chaque fois).
pub fn write_blender_scripts(root: &Path) -> AppResult<PathBuf> {
    let dir = state_dir(root).join("blender");
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("inspect.py"), INSPECT_PY)?;
    std::fs::write(dir.join("export.py"), EXPORT_PY)?;
    Ok(dir)
}

/// Commande Blender sans fenêtre. `factory` : réglages d'usine (extensions de la personne
/// ignorées), pour les scripts de Game Studio ; les scripts du projet gardent l'environnement.
pub fn blender_command(
    blender: &Path,
    root: &Path,
    blend: Option<&Path>,
    script: &Path,
    extra: &[String],
    factory: bool,
    timeout_secs: u64,
) -> CommandSpec {
    let mut args = vec!["--background".to_string()];
    if factory {
        args.push("--factory-startup".to_string());
    }
    if let Some(blend) = blend {
        args.push(display(blend));
    }
    args.extend([
        "--python-exit-code".to_string(),
        "1".to_string(),
        "--python".to_string(),
        display(script),
    ]);
    if !extra.is_empty() {
        args.push("--".to_string());
        args.extend(extra.iter().cloned());
    }
    CommandSpec {
        program: blender.to_path_buf(),
        args,
        cwd: root.to_path_buf(),
        timeout: Some(Duration::from_secs(timeout_secs)),
        ..Default::default()
    }
}

// ─── Unreal ───────────────────────────────────────────────────────────────────────────────

fn py_string(text: &str) -> String {
    format!(
        "\"{}\"",
        text.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

/// Script d'import de l'éditeur Unreal : chaque fichier de `SourceArt/` vers `/Game/…`.
pub fn unreal_import_script(root: &Path, files: &[String]) -> String {
    let mut out = String::from(
        "# Écrit par Game Studio (ARCHIMED) : importe les fichiers de SourceArt/ dans Content/.\n\
         # Lancé par : UnrealEditor-Cmd <projet>.uproject -run=pythonscript -script=<ce fichier>\n\
         import unreal\n\nFILES = [\n",
    );
    for rel in files {
        if let Some((destination, _)) = unreal_destination(rel) {
            out.push_str(&format!(
                "    ({}, {}),\n",
                py_string(&display(&root.join(rel)).replace('\\', "/")),
                py_string(&destination)
            ));
        }
    }
    out.push_str(
        "]\n\ntasks = []\nfor source, destination in FILES:\n    task = unreal.AssetImportTask()\n    task.filename = source\n    task.destination_path = destination\n    task.automated = True\n    task.replace_existing = True\n    task.save = True\n    tasks.append(task)\n\nunreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks(tasks)\nfor task in tasks:\n    imported = list(task.imported_object_paths)\n    print(\"ARCHIMED_IMPORTED\" if imported else \"ARCHIMED_NOT_IMPORTED\", task.filename, \" \".join(str(p) for p in imported))\nprint(\"",
    );
    out.push_str(super::engines::UNREAL_IMPORT_MARKER);
    out.push_str("\")\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gs-assets-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn folders_follow_the_engine() {
        assert_eq!(asset_dir(Some(GameEngine::Godot), GameAssetKind::Model), "assets/models");
        assert_eq!(asset_dir(Some(GameEngine::Unity), GameAssetKind::Ui), "Assets/Art/UI");
        assert_eq!(asset_dir(Some(GameEngine::Unreal), GameAssetKind::Texture), "SourceArt/Textures");
        assert_eq!(asset_dir(None, GameAssetKind::Audio), "assets/audio");
        assert_eq!(asset_dir(Some(GameEngine::Unity), GameAssetKind::Concept), "docs/concepts");
        assert_eq!(GameModelFormat::for_engine(Some(GameEngine::Godot)), GameModelFormat::Glb);
        assert_eq!(GameModelFormat::for_engine(Some(GameEngine::Unreal)), GameModelFormat::Fbx);
    }

    #[test]
    fn engine_traces_decide_what_is_imported() {
        let root = temp("engine");
        std::fs::create_dir_all(root.join("assets/textures")).unwrap();
        std::fs::write(root.join("assets/textures/sol.png"), b"x").unwrap();
        assert!(!in_engine(&root, Some(GameEngine::Godot), "assets/textures/sol.png"));
        std::fs::write(root.join("assets/textures/sol.png.import"), b"x").unwrap();
        assert!(in_engine(&root, Some(GameEngine::Godot), "assets/textures/sol.png"));
        // Godot lit les scènes et scripts tels quels.
        assert!(in_engine(&root, Some(GameEngine::Godot), "scenes/main.tscn"));

        assert!(!in_engine(&root, Some(GameEngine::Unity), "Assets/Art/Models/a.fbx"));
        std::fs::create_dir_all(root.join("Assets/Art/Models")).unwrap();
        std::fs::write(root.join("Assets/Art/Models/a.fbx.meta"), b"x").unwrap();
        assert!(in_engine(&root, Some(GameEngine::Unity), "Assets/Art/Models/a.fbx"));

        assert_eq!(
            unreal_destination("SourceArt/Models/Props/caisse en bois.fbx"),
            Some((
                "/Game/Models/Props".to_string(),
                "Content/Models/Props/caisse_en_bois.uasset".to_string()
            ))
        );
        assert!(!in_engine(&root, Some(GameEngine::Unreal), "SourceArt/Models/Props/caisse en bois.fbx"));
        std::fs::create_dir_all(root.join("Content/Models/Props")).unwrap();
        std::fs::write(root.join("Content/Models/Props/caisse_en_bois.uasset"), b"x").unwrap();
        assert!(in_engine(&root, Some(GameEngine::Unreal), "SourceArt/Models/Props/caisse en bois.fbx"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn copies_files_and_gltf_companions_without_overwriting() {
        let root = temp("copy");
        let outside = temp("copy-src");
        std::fs::create_dir_all(outside.join("tex")).unwrap();
        std::fs::write(
            outside.join("arbre.gltf"),
            r#"{"buffers":[{"uri":"arbre.bin"}],"images":[{"uri":"tex/ecorce.png"},{"uri":"data:image/png;base64,AA"},{"uri":"../secret.png"}]}"#,
        )
        .unwrap();
        std::fs::write(outside.join("arbre.bin"), b"bin").unwrap();
        std::fs::write(outside.join("tex/ecorce.png"), b"png").unwrap();
        let (rel, linked) = copy_into_project(&root, Some(GameEngine::Godot), &outside.join("arbre.gltf"), GameAssetKind::Model).unwrap();
        assert_eq!(rel, "assets/models/arbre.gltf");
        assert_eq!(linked, vec!["arbre.bin".to_string(), "tex/ecorce.png".to_string()]);
        assert!(root.join("assets/models/tex/ecorce.png").is_file());
        let (again, _) = copy_into_project(&root, Some(GameEngine::Godot), &outside.join("arbre.gltf"), GameAssetKind::Model).unwrap();
        assert_eq!(again, "assets/models/arbre-2.gltf");
        // Déjà dans le projet : rien n'est copié.
        let (inside, _) = copy_into_project(&root, Some(GameEngine::Godot), &root.join("assets/models/arbre.bin"), GameAssetKind::Model).unwrap();
        assert_eq!(inside, "assets/models/arbre.bin");

        let registered: HashSet<String> = ["assets/models/arbre.gltf".to_string()].into();
        let (loose, truncated) = loose_files(&root, Some(GameEngine::Godot), &[".godot"], &registered);
        assert!(!truncated);
        let paths: Vec<&str> = loose.iter().map(|l| l.path.as_str()).collect();
        assert_eq!(paths, vec!["assets/models/arbre-2.gltf", "assets/models/tex/ecorce.png"]);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn refuses_paths_leaving_the_project() {
        assert!(safe_relative("../x.py").is_err());
        assert!(safe_relative("/etc/passwd").is_err());
        assert!(safe_relative("").is_err());
        assert_eq!(safe_relative("./tools\\bake.py").unwrap(), "tools/bake.py");
    }

    #[test]
    fn prompts_carry_usage_and_style() {
        let style = GameStyleGuide {
            visual_style: "Peint à la main, contrastes doux".into(),
            palette: vec!["#2b3a55".into(), "#e6b566".into()],
            materials: "Bois usé, pierre moussue".into(),
            ..Default::default()
        };
        let prompt = image_prompt("Sol de forêt", GameAssetKind::Texture, &style, true, true);
        assert!(prompt.starts_with("Sol de forêt\nUsage : texture"));
        assert!(prompt.contains("Palette : #2b3a55, #e6b566"));
        assert!(prompt.contains("Matériaux : Bois usé"));
        assert!(!prompt.contains("Fond transparent"));
        let plain = image_prompt("Épée", GameAssetKind::Sprite, &style, false, true);
        assert!(plain.contains("Fond transparent."));
        assert!(!plain.contains("Style visuel"));
        assert_eq!(image_ext(&[0x89, b'P', b'N', b'G', 0]), Some("png"));
        assert_eq!(image_ext(b"RIFF\0\0\0\0WEBPVP8 "), Some("webp"));
        assert_eq!(image_ext(b"nope"), None);
    }

    #[test]
    fn blend_reading_flags_what_breaks_in_engines() {
        let raw = r#"{"blender":"5.2.2 LTS","file":"/p/props.blend","unitSystem":"METRIC","unitScale":1.0,"frameStart":1,"frameEnd":250,"fps":24.0,
            "objects":[{"name":"Suzanne","type":"MESH","parent":null,"dimensions":[5.4,3.4,3.9],"scale":[2.0,2.0,2.0],"materials":["Peau"],"modifiers":[],"vertices":507,"triangles":968},
                       {"name":"Caisse","type":"MESH","parent":null,"dimensions":[2,2,2],"scale":[1,1,1],"materials":[],"modifiers":[],"vertices":8,"triangles":12}],
            "materials":["Peau"],"images":[{"name":"Diffuse","path":"//tex/d.png","packed":false,"found":false,"size":[0,0]}],"actions":[{"name":"CaisseAction","frames":[1.0,24.0]}]}"#;
        let info = analyze_blend(serde_json::from_str(raw).unwrap(), "maintenant".into());
        assert_eq!(info.triangles, 980);
        assert_eq!(info.warnings.len(), 3, "{:?}", info.warnings);
        assert!(info.warnings[0].contains("Suzanne (2 × 2 × 2)"));
        assert!(info.warnings[1].contains("//tex/d.png"));
        assert!(info.warnings[2].contains("Caisse"));
    }

    #[test]
    fn blender_and_unreal_commands() {
        let spec = blender_command(Path::new("/opt/blender"), Path::new("/jeu"), Some(Path::new("/jeu/a.blend")), Path::new("/jeu/.gamestudio/blender/export.py"), &["/jeu/out.glb".into(), "glb".into()], true, 60);
        assert_eq!(
            spec.args,
            vec!["--background", "--factory-startup", "/jeu/a.blend", "--python-exit-code", "1", "--python", "/jeu/.gamestudio/blender/export.py", "--", "/jeu/out.glb", "glb"]
        );
        let script = unreal_import_script(Path::new("/jeu"), &["SourceArt/Models/caisse.fbx".into(), "assets/ignored.png".into()]);
        assert!(script.contains("(\"/jeu/SourceArt/Models/caisse.fbx\", \"/Game/Models\")"));
        assert!(!script.contains("ignored"));
        assert!(script.trim_end().ends_with("print(\"ARCHIMED_IMPORT_DONE\")"));
    }
}
