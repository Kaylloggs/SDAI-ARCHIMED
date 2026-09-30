//! Carte d'un projet (§108, projet existant) : fichiers par nature et par langage, dossiers,
//! systèmes repérés dans le code (noms de fichiers, de classes et de fonctions rapprochés du
//! catalogue), et risques. L'analyse est incrémentale : un fichier inchangé (taille et date)
//! n'est pas relu. Rien n'est écrit hors de `.gamestudio/cache/`.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Instant, UNIX_EPOCH};

use regex::Regex;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::core::AppResult;

use super::catalog::{catalog, fold};
use super::store::{state_dir, write_atomic};
use super::types::{GameGraph, GameIssueSeverity, GameSystemCategory};

/// Au-delà, l'analyse s'arrête (et le dit) : un projet de jeu en compte rarement autant hors
/// des dossiers générés.
const MAX_FILES: usize = 60_000;
/// Taille maximale d'un script relu pour ses noms.
const MAX_SCRIPT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_FILES_PER_SYSTEM: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameFileKind {
    Script,
    Scene,
    Texture,
    Model,
    Audio,
    Material,
    Shader,
    Animation,
    Font,
    Video,
    Data,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameKindStat {
    pub kind: GameFileKind,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameLanguageStat {
    pub language: String,
    pub files: u32,
    pub lines: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameFolderStat {
    pub path: String,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
}

/// Système du catalogue repéré dans le code.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameFoundSystem {
    pub id: String,
    pub name: String,
    pub category: GameSystemCategory,
    /// Déjà dans le graphe du projet.
    pub in_graph: bool,
    /// Fichiers où il apparaît (les premiers).
    pub files: Vec<String>,
    pub file_count: u32,
    /// Mots qui l'ont fait reconnaître.
    pub evidence: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameRisk {
    pub severity: GameIssueSeverity,
    pub title: String,
    pub detail: String,
}

/// Carte d'un projet (`.gamestudio/cache/map.json`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub struct GameProjectMap {
    pub scanned_at: String,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub files: u32,
    #[ts(type = "number")]
    pub bytes: u64,
    /// Fichiers nouveaux ou modifiés depuis l'analyse précédente.
    pub changed: u32,
    /// L'analyse s'est arrêtée avant la fin (trop de fichiers).
    pub truncated: bool,
    pub kinds: Vec<GameKindStat>,
    pub languages: Vec<GameLanguageStat>,
    pub folders: Vec<GameFolderStat>,
    pub systems: Vec<GameFoundSystem>,
    pub risks: Vec<GameRisk>,
}

/// Ce que l'analyse doit savoir du projet.
pub struct ScanInput<'a> {
    pub root: &'a Path,
    /// Dossiers générés par le moteur (jamais lus).
    pub ignored: &'a [&'a str],
    pub graph: &'a GameGraph,
    /// Scène ou carte de démarrage déclarée (projet moteur connu).
    pub main_scene: Option<Option<String>>,
    /// Version visée par le projet et versions installées du même moteur.
    pub engine_version: Option<String>,
    pub installed_versions: Vec<String>,
    pub git: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Indexed {
    size: u64,
    modified: u64,
    lines: u32,
    /// Noms repérés : suites de mots des chemins (fort), types (fort), fonctions (faible).
    strong: Vec<Vec<String>>,
    weak: Vec<Vec<String>>,
}

fn cache_dir(root: &Path) -> PathBuf {
    state_dir(root).join("cache")
}

pub fn map_path(root: &Path) -> PathBuf {
    cache_dir(root).join("map.json")
}

/// Dernière carte enregistrée.
pub fn load_map(root: &Path) -> Option<GameProjectMap> {
    std::fs::read_to_string(map_path(root))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

pub fn kind_of(path: &Path) -> GameFileKind {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "gd" | "cs" | "cpp" | "cc" | "cxx" | "h" | "hpp" | "py" | "lua" | "js" | "ts" | "rs" => {
            GameFileKind::Script
        }
        "tscn" | "scn" | "unity" | "umap" | "prefab" => GameFileKind::Scene,
        "png" | "jpg" | "jpeg" | "tga" | "psd" | "exr" | "hdr" | "webp" | "bmp" | "dds" | "ktx"
        | "svg" => GameFileKind::Texture,
        "fbx" | "obj" | "glb" | "gltf" | "blend" | "dae" | "3ds" | "vox" => GameFileKind::Model,
        "wav" | "ogg" | "mp3" | "flac" | "aiff" | "aif" | "opus" => GameFileKind::Audio,
        "tres" | "mat" | "material" | "uasset" => GameFileKind::Material,
        "gdshader" | "shader" | "hlsl" | "glsl" | "usf" | "ush" | "shadergraph" | "compute" => {
            GameFileKind::Shader
        }
        "anim" | "controller" | "overridecontroller" => GameFileKind::Animation,
        "ttf" | "otf" | "fnt" | "woff" | "woff2" => GameFileKind::Font,
        "mp4" | "webm" | "mov" | "ogv" => GameFileKind::Video,
        // Métadonnées des moteurs (.import et .uid de Godot, .meta d'Unity) comprises.
        "json" | "csv" | "yaml" | "yml" | "xml" | "toml" | "ini" | "cfg" | "asset" | "txt"
        | "import" | "uid" | "meta" | "godot" | "uproject" => GameFileKind::Data,
        _ => GameFileKind::Other,
    }
}

fn language_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    Some(match ext.as_str() {
        "gd" => "GDScript",
        "cs" => "C#",
        "cpp" | "cc" | "cxx" | "h" | "hpp" => "C++",
        "py" => "Python",
        "lua" => "Lua",
        "js" | "ts" => "JavaScript",
        "rs" => "Rust",
        "gdshader" | "shader" | "hlsl" | "glsl" | "usf" | "ush" | "compute" => "Shaders",
        _ => return None,
    })
}

/// « InventoryManager », « take_damage », « HTTPServer » → mots en minuscules, pluriels ôtés.
pub fn identifier_words(name: &str) -> Vec<String> {
    let mut words = Vec::new();
    for part in name.split(|c: char| !c.is_alphanumeric()) {
        let chars: Vec<char> = part.chars().collect();
        let mut current = String::new();
        for (i, &c) in chars.iter().enumerate() {
            let prev = i.checked_sub(1).map(|p| chars[p]);
            let next = chars.get(i + 1).copied();
            let boundary = c.is_uppercase()
                && prev.is_some_and(|p| {
                    p.is_lowercase()
                        || p.is_ascii_digit()
                        || (p.is_uppercase() && next.is_some_and(|n| n.is_lowercase()))
                });
            if boundary && !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            current.push(c);
        }
        if !current.is_empty() {
            words.push(current);
        }
    }
    words
        .into_iter()
        .map(|w| singular(&fold(&w)))
        .filter(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit()))
        .collect()
}

fn singular(word: &str) -> String {
    let w = word.trim();
    if w.len() > 4 && w.ends_with("ies") {
        format!("{}y", &w[..w.len() - 3])
    } else if w.len() > 4 && (w.ends_with('s') || w.ends_with('x')) && !w.ends_with("ss") {
        w[..w.len() - 1].to_string()
    } else {
        w.to_string()
    }
}

struct Names {
    types: Regex,
    functions: Regex,
}

fn names() -> &'static Names {
    static N: OnceLock<Names> = OnceLock::new();
    N.get_or_init(|| Names {
        types: Regex::new(
            r"(?m)^\s*(?:class_name\s+(\w+)|(?:public\s+|private\s+|internal\s+|protected\s+|static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|struct|interface|enum)\s+(?:[A-Z0-9_]+_API\s+)?(\w+))",
        )
        .unwrap(),
        functions: Regex::new(
            r"(?m)^\s*(?:func\s+(\w+)|def\s+(\w+)|(?:public|private|protected|internal)\s+(?:static\s+|override\s+|virtual\s+|async\s+)*[\w<>\[\],]+\s+(\w+)\s*\()",
        )
        .unwrap(),
    })
}

/// Noms déclarés dans un script, et son nombre de lignes.
fn read_script(path: &Path, rel: &str) -> Indexed {
    let mut strong = vec![path_words(rel)];
    let mut weak = Vec::new();
    let mut lines = 0;
    if let Ok(text) = std::fs::read(path).map(|b| String::from_utf8_lossy(&b).to_string()) {
        lines = text.lines().count() as u32;
        let n = names();
        for c in n.types.captures_iter(&text) {
            if let Some(name) = c.get(1).or_else(|| c.get(2)) {
                strong.push(identifier_words(name.as_str()));
            }
        }
        for c in n.functions.captures_iter(&text) {
            if let Some(name) = c.get(1).or_else(|| c.get(2)).or_else(|| c.get(3)) {
                weak.push(identifier_words(name.as_str()));
            }
        }
    }
    Indexed {
        lines,
        strong,
        weak,
        ..Indexed::default()
    }
}

fn path_words(rel: &str) -> Vec<String> {
    let without_ext = rel.rsplit_once('.').map(|(a, _)| a).unwrap_or(rel);
    identifier_words(without_ext)
}

/// Mots trop génériques pour désigner un système à eux seuls.
const GENERIC: &[&str] = &[
    "system",
    "manager",
    "game",
    "data",
    "core",
    "controller",
    "main",
    "base",
    "node",
    "script",
    "scene",
    "asset",
    "object",
    "component",
    "util",
    "utils",
    "helper",
    "test",
    "tests",
    "editor",
    "source",
    "private",
    "public",
    "content",
    "world",
    "player",
    "state",
    "event",
    "handler",
];

/// Suites de mots qui désignent chaque système du catalogue (identifiant et mots-clés).
fn matchers() -> &'static Vec<(String, Vec<Vec<String>>)> {
    static M: OnceLock<Vec<(String, Vec<Vec<String>>)>> = OnceLock::new();
    M.get_or_init(|| {
        let Ok(cat) = catalog() else {
            return Vec::new();
        };
        cat.systems
            .iter()
            .map(|s| {
                let mut phrases: Vec<Vec<String>> = Vec::new();
                let mut push = |words: Vec<String>| {
                    let useful = match words.as_slice() {
                        [] => false,
                        [one] => one.len() >= 4 && !GENERIC.contains(&one.as_str()),
                        _ => true,
                    };
                    if useful && !phrases.contains(&words) {
                        phrases.push(words);
                    }
                };
                push(identifier_words(&s.id));
                for keyword in &s.keywords {
                    push(
                        fold(keyword)
                            .split(' ')
                            .filter(|w| !w.is_empty())
                            .map(singular)
                            .collect(),
                    );
                }
                (s.id.clone(), phrases)
            })
            .collect()
    })
}

fn contains_phrase(words: &[String], phrase: &[String]) -> bool {
    !phrase.is_empty() && words.windows(phrase.len()).any(|w| w == phrase)
}

/// Analyse le projet ; l'index précédent évite de relire les fichiers inchangés.
pub fn scan(input: &ScanInput) -> AppResult<GameProjectMap> {
    let started = Instant::now();
    let root = input.root;
    let index_path = cache_dir(root).join("index.json");
    let previous: HashMap<String, Indexed> = std::fs::read_to_string(&index_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    let mut index: HashMap<String, Indexed> = HashMap::new();
    let mut kinds: BTreeMap<GameFileKind, (u32, u64)> = BTreeMap::new();
    let mut languages: BTreeMap<&'static str, (u32, u32)> = BTreeMap::new();
    let mut folders: BTreeMap<String, (u32, u64)> = BTreeMap::new();
    let mut largest: Vec<(String, u64)> = Vec::new();
    let mut long_scripts = 0u32;
    let mut tests = 0u32;
    let mut changed = 0u32;
    let mut truncated = false;
    let mut total_bytes = 0u64;

    let skip: HashSet<String> = input
        .ignored
        .iter()
        .map(|d| d.to_lowercase())
        .chain(
            [
                ".git",
                ".gamestudio",
                "node_modules",
                ".vs",
                ".idea",
                "__pycache__",
            ]
            .map(String::from),
        )
        .collect();
    let mut stack = vec![root.to_path_buf()];
    'walk: while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                // Les dossiers ignorés ne le sont qu'à la racine (Unreal a des « Build » ailleurs).
                let top = dir == root;
                if (top && skip.contains(&name.to_lowercase()))
                    || name == ".git"
                    || name == ".gamestudio"
                {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if index.len() >= MAX_FILES {
                truncated = true;
                break 'walk;
            }
            let rel = path
                .strip_prefix(root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| name.clone());
            let meta = entry.metadata().ok();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified = meta
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let kind = kind_of(&path);
            total_bytes += size;
            let slot = kinds.entry(kind).or_default();
            slot.0 += 1;
            slot.1 += size;
            let folder = rel
                .split_once('/')
                .map(|(f, _)| f.to_string())
                .unwrap_or_else(|| ".".to_string());
            let f = folders.entry(folder).or_default();
            f.0 += 1;
            f.1 += size;
            if size > 20 * 1024 * 1024 {
                largest.push((rel.clone(), size));
            }
            let lower = rel.to_lowercase();
            if lower.contains("test") {
                tests += 1;
            }

            let reuse = previous
                .get(&rel)
                .filter(|p| p.size == size && p.modified == modified)
                .cloned();
            if reuse.is_none() {
                changed += 1;
            }
            let mut indexed = reuse.unwrap_or_else(|| {
                if kind == GameFileKind::Script && size <= MAX_SCRIPT_BYTES {
                    read_script(&path, &rel)
                } else if matches!(kind, GameFileKind::Scene | GameFileKind::Script) {
                    Indexed {
                        strong: vec![path_words(&rel)],
                        ..Indexed::default()
                    }
                } else {
                    Indexed::default()
                }
            });
            indexed.size = size;
            indexed.modified = modified;
            if let Some(language) = language_of(&path) {
                let l = languages.entry(language).or_default();
                l.0 += 1;
                l.1 += indexed.lines;
                if indexed.lines > 2_000 && kind == GameFileKind::Script {
                    long_scripts += 1;
                }
            }
            index.insert(rel, indexed);
        }
    }

    // Systèmes : fort (chemin, type) dès un fichier ; faible (fonctions) à partir de deux.
    let in_graph: HashSet<&str> = input.graph.systems.iter().map(|s| s.id.as_str()).collect();
    let mut found: Vec<GameFoundSystem> = Vec::new();
    if let Ok(cat) = catalog() {
        for (id, phrases) in matchers() {
            let mut strong_files: Vec<&str> = Vec::new();
            let mut weak_files: Vec<&str> = Vec::new();
            let mut evidence: Vec<String> = Vec::new();
            for (rel, item) in &index {
                let hit = |seqs: &[Vec<String>], evidence: &mut Vec<String>| {
                    phrases.iter().any(|p| {
                        let ok = seqs.iter().any(|s| contains_phrase(s, p));
                        if ok {
                            let word = p.join(" ");
                            if !evidence.contains(&word) && evidence.len() < 5 {
                                evidence.push(word);
                            }
                        }
                        ok
                    })
                };
                if hit(&item.strong, &mut evidence) {
                    strong_files.push(rel);
                } else if hit(&item.weak, &mut evidence) {
                    weak_files.push(rel);
                }
            }
            let count = strong_files.len()
                + if strong_files.is_empty() && weak_files.len() < 2 {
                    0
                } else {
                    weak_files.len()
                };
            if count == 0 {
                continue;
            }
            let Some(def) = cat.get(id) else { continue };
            let mut files: Vec<String> = strong_files
                .iter()
                .chain(weak_files.iter())
                .map(|f| f.to_string())
                .collect();
            files.sort();
            files.truncate(MAX_FILES_PER_SYSTEM);
            found.push(GameFoundSystem {
                id: id.clone(),
                name: def.name.clone(),
                category: def.category,
                in_graph: in_graph.contains(id.as_str()),
                files,
                file_count: count as u32,
                evidence,
            });
        }
    }
    found.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.name.cmp(&b.name)));

    let risks = risks(input, &index, &largest, long_scripts, tests, truncated);

    let _ = std::fs::create_dir_all(cache_dir(root));
    if let Ok(body) = serde_json::to_vec(&index) {
        let _ = write_atomic(&index_path, &body);
    }

    let mut folders: Vec<GameFolderStat> = folders
        .into_iter()
        .map(|(path, (files, bytes))| GameFolderStat { path, files, bytes })
        .collect();
    folders.sort_by_key(|f| std::cmp::Reverse(f.files));
    folders.truncate(24);
    let mut languages: Vec<GameLanguageStat> = languages
        .into_iter()
        .map(|(language, (files, lines))| GameLanguageStat {
            language: language.to_string(),
            files,
            lines,
        })
        .collect();
    languages.sort_by_key(|l| std::cmp::Reverse(l.lines));

    let map = GameProjectMap {
        scanned_at: chrono::Utc::now().to_rfc3339(),
        duration_ms: started.elapsed().as_millis() as u64,
        files: index.len() as u32,
        bytes: total_bytes,
        changed,
        truncated,
        kinds: kinds
            .into_iter()
            .map(|(kind, (files, bytes))| GameKindStat { kind, files, bytes })
            .collect(),
        languages,
        folders,
        systems: found,
        risks,
    };
    if let Ok(body) = serde_json::to_string_pretty(&map) {
        write_atomic(&map_path(root), body.as_bytes())?;
    }
    Ok(map)
}

fn mb(bytes: u64) -> String {
    format!("{} Mo", bytes / (1024 * 1024))
}

fn risks(
    input: &ScanInput,
    index: &HashMap<String, Indexed>,
    largest: &[(String, u64)],
    long_scripts: u32,
    tests: u32,
    truncated: bool,
) -> Vec<GameRisk> {
    let root = input.root;
    let mut out = Vec::new();
    let risk = |severity, title: &str, detail: String| GameRisk {
        severity,
        title: title.to_string(),
        detail,
    };
    if !input.git {
        out.push(risk(
            GameIssueSeverity::Warning,
            "Pas de dépôt Git",
            "Sans Git, pas de points de restauration : une modification ratée ne se défait pas. Historique > Activer Git.".to_string(),
        ));
    }
    let attributes = std::fs::read_to_string(root.join(".gitattributes")).unwrap_or_default();
    let lfs = |file: &str| {
        let ext = file
            .rsplit_once('.')
            .map(|(_, e)| e.to_lowercase())
            .unwrap_or_default();
        attributes
            .lines()
            .any(|l| l.contains("filter=lfs") && l.to_lowercase().contains(&format!("*.{ext}")))
    };
    let heavy: Vec<&(String, u64)> = largest.iter().filter(|(f, _)| !lfs(f)).collect();
    if let Some(biggest) = heavy.iter().max_by_key(|(_, s)| *s) {
        let over = heavy.iter().filter(|(_, s)| *s > 100 * 1024 * 1024).count();
        out.push(risk(
            if over > 0 {
                GameIssueSeverity::Error
            } else {
                GameIssueSeverity::Warning
            },
            "Gros fichiers hors de Git LFS",
            format!(
                "{} fichier(s) de plus de 20 Mo sans Git LFS, dont {} ({}). {}",
                heavy.len(),
                biggest.0,
                mb(biggest.1),
                if over > 0 {
                    "GitHub refuse les fichiers de plus de 100 Mo."
                } else {
                    "Le dépôt grossira à chaque version."
                }
            ),
        ));
    }
    let gitignore = std::fs::read_to_string(root.join(".gitignore")).unwrap_or_default();
    if input.git {
        let generated: Vec<&str> = input
            .ignored
            .iter()
            .copied()
            .filter(|d| root.join(d).is_dir())
            .filter(|d| {
                !gitignore
                    .lines()
                    .any(|l| l.trim().trim_matches('/').eq_ignore_ascii_case(d))
            })
            .collect();
        if !generated.is_empty() {
            out.push(risk(
                GameIssueSeverity::Warning,
                "Dossiers générés non ignorés par Git",
                format!(
                    "{} : ajoutez-les au .gitignore (le moteur les recrée).",
                    generated.join(", ")
                ),
            ));
        }
    }
    if let Some(None) = &input.main_scene {
        out.push(risk(
            GameIssueSeverity::Warning,
            "Aucune scène de démarrage",
            "Le jeu ne sait pas quelle scène ou carte ouvrir au lancement : choisissez-la dans les réglages du projet du moteur.".to_string(),
        ));
    }
    if let Some(wanted) = input.engine_version.as_deref() {
        let key = |v: &str| v.split('.').take(2).collect::<Vec<_>>().join(".");
        if !input.installed_versions.is_empty()
            && !input
                .installed_versions
                .iter()
                .any(|v| key(v) == key(wanted))
        {
            out.push(risk(
                GameIssueSeverity::Warning,
                "Version du moteur différente",
                format!(
                    "Le projet vise la version {wanted} ; installé : {}. L'ouvrir avec une autre version peut le convertir sans retour : prenez d'abord un point de restauration.",
                    input.installed_versions.join(", ")
                ),
            ));
        }
    }
    let scripts = index.values().filter(|i| i.lines > 0).count();
    if scripts >= 20 && tests == 0 {
        out.push(risk(
            GameIssueSeverity::Info,
            "Aucun test automatisé",
            format!("{scripts} scripts et aucun fichier de test : les régressions ne se verront qu'en jouant."),
        ));
    }
    if long_scripts > 0 {
        out.push(risk(
            GameIssueSeverity::Info,
            "Scripts très longs",
            format!("{long_scripts} script(s) de plus de 2 000 lignes : difficiles à modifier sans casser autre chose."),
        ));
    }
    if truncated {
        out.push(risk(
            GameIssueSeverity::Info,
            "Analyse incomplète",
            format!("Plus de {MAX_FILES} fichiers : seuls les premiers ont été lus."),
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gs-scan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, rel: &str, body: &str) {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn words_from_identifiers() {
        assert_eq!(
            identifier_words("InventoryManager"),
            vec!["inventory", "manager"]
        );
        assert_eq!(identifier_words("take_damage"), vec!["take", "damage"]);
        assert_eq!(identifier_words("HTTPServer"), vec!["http", "server"]);
        assert_eq!(
            identifier_words("DayNightCycle"),
            vec!["day", "night", "cycle"]
        );
        assert_eq!(
            identifier_words("Scripts/Enemies/BossAI"),
            vec!["script", "enemy", "boss", "ai"]
        );
    }

    #[test]
    fn maps_an_existing_project_incrementally() {
        let root = temp("map");
        write(&root, "project.godot", "config_version=5\n");
        write(
            &root,
            "scripts/inventory.gd",
            "extends Node\nclass_name Inventory\nfunc add_item(item) -> void:\n\tpass\n",
        );
        write(
            &root,
            "scripts/weather/rain.gd",
            "extends Node\nfunc start_rain() -> void:\n\tpass\n",
        );
        write(
            &root,
            "Scripts/DayNightCycle.cs",
            "public class DayNightCycle : MonoBehaviour {\n  public void Tick() {}\n}\n",
        );
        write(&root, "scenes/main.tscn", "[gd_scene format=3]\n");
        write(&root, "assets/music/theme.ogg", "x");
        write(&root, ".godot/imported/huge.bin", "généré : jamais lu");
        let graph = GameGraph::default();
        let input = ScanInput {
            root: &root,
            ignored: &[".godot"],
            graph: &graph,
            main_scene: Some(None),
            engine_version: Some("4.2".into()),
            installed_versions: vec!["4.4.1.stable".into()],
            git: false,
        };
        let map = scan(&input).unwrap();
        assert_eq!(map.files, 6, "le dossier .godot n'est pas lu");
        assert_eq!(map.changed, 6);
        let ids: Vec<&str> = map.systems.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"inventory"), "{ids:?}");
        assert!(ids.contains(&"weather"), "{ids:?}");
        assert!(ids.contains(&"day_night"), "{ids:?}");
        let inventory = map.systems.iter().find(|s| s.id == "inventory").unwrap();
        assert!(inventory
            .files
            .contains(&"scripts/inventory.gd".to_string()));
        assert!(!inventory.in_graph);
        assert!(map
            .languages
            .iter()
            .any(|l| l.language == "GDScript" && l.files == 2));
        let titles: Vec<&str> = map.risks.iter().map(|r| r.title.as_str()).collect();
        assert!(titles.contains(&"Pas de dépôt Git"));
        assert!(titles.contains(&"Aucune scène de démarrage"));
        assert!(titles.contains(&"Version du moteur différente"));
        assert!(load_map(&root).is_some());

        // Deuxième passage : seuls les fichiers modifiés sont relus.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        write(
            &root,
            "scripts/inventory.gd",
            "extends Node\nclass_name Inventory\n",
        );
        let again = scan(&input).unwrap();
        assert_eq!(again.changed, 1);
        let _ = std::fs::remove_dir_all(&root);
    }
}
