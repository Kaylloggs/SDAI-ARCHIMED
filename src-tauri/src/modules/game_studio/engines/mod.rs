//! Adaptateurs de moteurs (§7) : ce que Game Studio sait faire avec Godot, Unity et Unreal,
//! et comment. Chaque adaptateur déclare honnêtement ses capacités (ligne de commande
//! officielle, fichiers texte documentés, MCP, ou geste manuel guidé) ; aucune capacité n'est
//! supposée : elle est vérifiée sur la machine (installation, modèles d'export, compilateur).

pub mod godot;
pub mod unity;
pub mod unreal;

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, Instant};

use crate::core::{AppError, AppResult};

use super::types::{
    GameCapability, GameCapabilityVia, GameCheck, GameDimension, GameEngine, GameEngineInstall,
    GamePlatform,
};

/// Ce qu'un adaptateur lit d'un projet existant.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EngineProject {
    pub name: String,
    pub engine_version: Option<String>,
    /// Scène ou carte de démarrage.
    pub main_scene: Option<String>,
    /// Langages du code (GDScript, C#, C++, Blueprints).
    pub languages: Vec<String>,
    /// Paquets, extensions ou modules déclarés.
    pub packages: Vec<String>,
}

/// Demande de création d'un projet moteur.
#[derive(Debug, Clone)]
pub struct NewProject {
    pub name: String,
    /// Dossier du projet (créé s'il n'existe pas, doit être vide).
    pub dir: PathBuf,
    pub dimension: GameDimension,
    pub description: String,
    pub targets: Vec<GamePlatform>,
    /// Unreal : module C++ ; Godot : projet C# (.NET).
    pub cpp: bool,
}

/// Fichiers écrits et remarques pour la personne.
#[derive(Debug, Clone, Default)]
pub struct Created {
    pub files: Vec<String>,
    pub notes: Vec<String>,
}

/// Action lancée par la ligne de commande d'un moteur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
#[serde(rename_all = "camelCase")]
pub enum GameAction {
    /// Prépare le projet dans le moteur (import, scène principale, fichiers de solution).
    Setup,
    /// Vérifie le code sans lancer le jeu (analyse des scripts, compilation).
    Check,
    /// Lance le jeu.
    Run,
    /// Lance les tests automatisés.
    Test,
    /// Produit un build jouable pour une plateforme.
    Build,
    /// Ouvre l'éditeur du moteur sur le projet.
    Editor,
    /// Fait importer les ressources du projet par le moteur (fichiers .import, .meta, .uasset).
    Import,
    /// Blender sans interface : lecture, export ou script d'un fichier du projet.
    Blender,
}

impl GameAction {
    pub fn slug(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Check => "check",
            Self::Run => "run",
            Self::Test => "test",
            Self::Build => "build",
            Self::Editor => "editor",
            Self::Import => "import",
            Self::Blender => "blender",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Setup => "Préparation",
            Self::Check => "Vérification",
            Self::Run => "Lancement du jeu",
            Self::Test => "Tests",
            Self::Build => "Build",
            Self::Editor => "Éditeur",
            Self::Import => "Importation dans le moteur",
            Self::Blender => "Tâche Blender",
        }
    }
}

/// Script d'import Unreal écrit par Game Studio avant l'action `Import`.
pub const UNREAL_IMPORT_SCRIPT: &str = ".gamestudio/unreal/import_assets.py";
/// Ligne écrite par ce script une fois tous les imports demandés.
pub const UNREAL_IMPORT_MARKER: &str = "ARCHIMED_IMPORT_DONE";

pub fn blender_is_not_engine() -> AppError {
    AppError::invalid("Blender se lance depuis les ressources du projet, pas depuis le moteur.")
}

/// Paramètres d'une action.
#[derive(Debug, Clone)]
pub struct ActionContext<'a> {
    pub root: &'a Path,
    pub project: &'a EngineProject,
    pub install: &'a GameEngineInstall,
    pub platform: GamePlatform,
    pub development: bool,
}

/// Commande prête à lancer.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct CommandSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    /// Délai au-delà duquel la commande est arrêtée (`None` : jamais, ex. jeu ou éditeur).
    pub timeout: Option<Duration>,
    /// Fichier ou dossier produit (build).
    pub output: Option<PathBuf>,
    /// Ligne qui prouve la réussite quand le code de sortie ne suffit pas.
    pub success_marker: Option<String>,
    /// Programme graphique lancé sans attendre sa fin ni lire sa sortie (éditeur).
    pub detached: bool,
    /// Une erreur lue dans la sortie fait échouer l'action même si le code de sortie est 0
    /// (Godot finit à 0 après une erreur de script à l'exécution).
    pub strict: bool,
    /// Résultats de tests au format NUnit 3 à lire après l'exécution (Unity).
    pub results: Option<PathBuf>,
}

pub trait EngineAdapter: Send + Sync {
    fn engine(&self) -> GameEngine;

    /// Installations trouvées : chemins choisis par la personne d'abord, puis emplacements
    /// connus. Les vérifications faites sont rendues pour l'auto-diagnostic.
    fn detect(&self, overrides: &[PathBuf]) -> (Vec<GameEngineInstall>, Vec<GameCheck>);

    fn is_project(&self, root: &Path) -> bool;

    fn inspect(&self, root: &Path) -> Option<EngineProject>;

    /// Écrit un projet neuf (fichiers texte documentés du moteur).
    fn create(&self, spec: &NewProject, install: Option<&GameEngineInstall>) -> AppResult<Created>;

    /// Capacités réelles pour ce projet sur cette machine.
    fn capabilities(
        &self,
        root: Option<&Path>,
        install: Option<&GameEngineInstall>,
    ) -> Vec<GameCapability>;

    /// Commande d'une action ; erreur claire si la machine ne le permet pas.
    fn command(&self, action: GameAction, ctx: &ActionContext) -> AppResult<CommandSpec>;

    /// Contenu du `.gitignore` recommandé.
    fn gitignore(&self) -> &'static str;

    /// Dossiers générés par le moteur, jamais analysés ni sauvegardés.
    fn ignored_dirs(&self) -> &'static [&'static str];

    /// Dossier où ranger les assets produits par Game Studio.
    #[allow(dead_code)] // lu par le registre des ressources (phase 5)
    fn asset_dir(&self) -> &'static str;
}

/// Tous les adaptateurs.
pub fn all() -> Vec<Box<dyn EngineAdapter>> {
    vec![
        Box::new(godot::Godot),
        Box::new(unity::Unity),
        Box::new(unreal::Unreal),
    ]
}

pub fn adapter(engine: GameEngine) -> Box<dyn EngineAdapter> {
    match engine {
        GameEngine::Godot => Box::new(godot::Godot),
        GameEngine::Unity => Box::new(unity::Unity),
        GameEngine::Unreal => Box::new(unreal::Unreal),
    }
}

/// Moteur d'un dossier existant, s'il est reconnu.
pub fn detect_project(root: &Path) -> Option<(GameEngine, EngineProject)> {
    all().into_iter().find_map(|a| {
        if a.is_project(root) {
            a.inspect(root).map(|p| (a.engine(), p))
        } else {
            None
        }
    })
}

// ─── Aides partagées ──────────────────────────────────────────────────────────────────────

pub(crate) fn capability(
    id: &str,
    label: &str,
    via: GameCapabilityVia,
    requires: Option<&str>,
    available: Option<bool>,
    detail: Option<String>,
) -> GameCapability {
    GameCapability {
        id: id.to_string(),
        label: label.to_string(),
        via,
        requires: requires.map(str::to_string),
        available,
        detail,
    }
}

pub(crate) fn check(
    label: impl Into<String>,
    ok: bool,
    detail: impl Into<Option<String>>,
) -> GameCheck {
    GameCheck {
        label: label.into(),
        ok,
        detail: detail.into(),
    }
}

/// Variable d'environnement de dossier (`ProgramFiles`, `LOCALAPPDATA`…).
pub(crate) fn env_dir(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn home() -> Option<PathBuf> {
    crate::core::paths::dirs_home()
}

/// Chemin affichable (sans le préfixe `\\?\` de Windows).
pub(crate) fn display(path: &Path) -> String {
    let text = path.display().to_string();
    text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
}

/// Sous-dossiers directs d'un dossier (vide s'il manque).
pub(crate) fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    out.sort();
    out
}

/// Fichiers directs d'un dossier.
pub(crate) fn files_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    out.sort();
    out
}

/// Lance un programme court et rend sa sortie (stdout puis stderr), ou `None` après
/// `timeout` ou en cas d'échec au lancement. À appeler hors du fil asynchrone.
pub(crate) fn probe(program: &Path, args: &[&str], timeout: Duration) -> Option<String> {
    let mut child = crate::core::process::command(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(_) => return None,
        }
    }
    let mut out = String::new();
    if let Some(mut stdout) = child.stdout.take() {
        let _ = stdout.read_to_string(&mut out);
    }
    if let Some(mut stderr) = child.stderr.take() {
        let mut err = String::new();
        let _ = stderr.read_to_string(&mut err);
        if !err.trim().is_empty() {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&err);
        }
    }
    Some(out)
}

/// Écrit un fichier du projet (dossiers créés) et le note dans `created`.
pub(crate) fn write_file(
    root: &Path,
    relative: &str,
    content: &str,
    created: &mut Created,
) -> AppResult<()> {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Un `.gitignore` déjà présent est complété, jamais écrasé.
    if relative.starts_with(".git") && path.is_file() {
        let mut existing = std::fs::read_to_string(&path)?;
        let missing: Vec<&str> = content
            .lines()
            .filter(|l| !l.trim().is_empty() && !existing.lines().any(|e| e.trim() == l.trim()))
            .collect();
        if !missing.is_empty() {
            if !existing.ends_with('\n') {
                existing.push('\n');
            }
            existing.push_str(&missing.join("\n"));
            existing.push('\n');
            std::fs::write(&path, existing)?;
        }
        created.files.push(relative.replace('\\', "/"));
        return Ok(());
    }
    std::fs::write(&path, content)?;
    created.files.push(relative.replace('\\', "/"));
    Ok(())
}

/// Crée un dossier vide gardé par Git (`.gitkeep`).
pub(crate) fn keep_dir(root: &Path, relative: &str, created: &mut Created) -> AppResult<()> {
    write_file(root, &format!("{relative}/.gitkeep"), "", created)
}

/// Entrées tolérées dans un dossier « vide » : la conception de Game Studio et Git, présents
/// quand le moteur est choisi après coup.
const TOLERATED: &[&str] = &[".gamestudio", ".git", ".gitignore", ".gitattributes"];

/// Le dossier cible est-il utilisable (absent, vide, ou ne contenant que la conception) ?
pub(crate) fn ensure_empty_dir(dir: &Path) -> AppResult<()> {
    if dir.exists() {
        let mut entries = std::fs::read_dir(dir)?
            .flatten()
            .filter(|e| !TOLERATED.contains(&e.file_name().to_string_lossy().as_ref()));
        if entries.next().is_some() {
            return Err(crate::core::AppError::invalid(format!(
                "Le dossier {} existe déjà et n'est pas vide : choisissez un autre nom ou un autre emplacement.",
                display(dir)
            )));
        }
    }
    std::fs::create_dir_all(dir)?;
    Ok(())
}

/// Identifiant de code à partir d'un nom : « Marée basse ! » → `MareeBasse`.
pub fn code_name(name: &str) -> String {
    let folded = super::catalog::fold(name);
    let mut out = String::new();
    for word in folded.split(' ') {
        let mut chars = word.chars().filter(|c| c.is_ascii_alphanumeric());
        if let Some(first) = chars.next() {
            out.push(first.to_ascii_uppercase());
            out.extend(chars);
        }
    }
    if out.is_empty() || out.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        out.insert_str(0, "Game");
    }
    out.chars().take(32).collect()
}

/// Nom de dossier lisible et sûr : « Marée basse ! » → `Maree-basse`.
pub fn folder_name(name: &str) -> String {
    let folded = super::catalog::fold(name);
    let mut out: String = folded
        .split(' ')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if let Some(first) = out.get(0..1) {
        let upper = first.to_uppercase();
        out.replace_range(0..1, &upper);
    }
    if out.is_empty() {
        "Nouveau-jeu".to_string()
    } else {
        out.chars().take(48).collect()
    }
}

/// Échappe une chaîne pour un fichier texte à guillemets (`project.godot`, `.ini`).
pub(crate) fn quote(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\n', '\r'], " ")
}

/// Premier chemin existant parmi des candidats.
pub(crate) fn first_existing(candidates: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    candidates.into_iter().find(|p| p.exists())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_become_identifiers_and_folders() {
        assert_eq!(code_name("Marée basse !"), "MareeBasse");
        assert_eq!(code_name("3 royaumes"), "Game3Royaumes");
        assert_eq!(code_name("!!"), "Game");
        assert_eq!(folder_name("Marée basse !"), "Maree-basse");
        assert_eq!(folder_name("   "), "Nouveau-jeu");
    }

    #[test]
    fn probe_reads_output_and_times_out() {
        #[cfg(unix)]
        {
            let out = probe(
                Path::new("sh"),
                &["-c", "echo bonjour"],
                Duration::from_secs(5),
            )
            .unwrap();
            assert!(out.contains("bonjour"));
            assert!(probe(
                Path::new("sh"),
                &["-c", "sleep 5"],
                Duration::from_millis(200)
            )
            .is_none());
        }
        assert!(probe(
            Path::new("programme-qui-n-existe-pas"),
            &[],
            Duration::from_secs(1)
        )
        .is_none());
    }

    #[test]
    fn project_folders_must_be_empty() {
        let dir = std::env::temp_dir().join(format!("gs-empty-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        ensure_empty_dir(&dir).unwrap();
        std::fs::write(dir.join("x.txt"), "x").unwrap();
        assert!(ensure_empty_dir(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
