//! Rapport d'environnement (§63, §111) : moteurs, Blender, Git, runtimes et SDK de la
//! machine, avec ce qui a été vérifié (auto-diagnostic, §123), un guide simple pour ce qui
//! manque (§122) et l'installation en un clic quand winget la propose (§112).
//!
//! Tout est détecté sur la machine, rien n'est supposé. Les chemins choisis par la personne
//! (`<données du module>/tools.json`) passent avant les emplacements connus.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::core::{AppError, AppResult};

use super::engines::{self, check, display, env_dir, godot::version_key, home, probe, subdirs};
use super::types::{
    GameCheck, GameEngine, GameEngineInstall, GameEnvironment, GameTool, GameToolCategory,
    GameToolState,
};

const PROBE: Duration = Duration::from_secs(8);

/// Chemins choisis à la main, par outil (`godot`, `unity`, `unreal`, `blender`, `git`…).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ToolOverrides {
    pub paths: BTreeMap<String, Vec<String>>,
}

impl ToolOverrides {
    pub fn load(dir: &Path) -> Self {
        std::fs::read_to_string(dir.join("tools.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, dir: &Path) -> AppResult<()> {
        std::fs::create_dir_all(dir)?;
        std::fs::write(dir.join("tools.json"), serde_json::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn get(&self, tool: &str) -> Vec<PathBuf> {
        self.paths
            .get(tool)
            .map(|v| v.iter().map(PathBuf::from).collect())
            .unwrap_or_default()
    }
}

/// Paquet winget qui installe un outil.
pub fn winget_package(tool: &str) -> Option<(&'static str, &'static str)> {
    Some(match tool {
        "godot" => ("GodotEngine.GodotEngine", "Godot"),
        "unity" => ("Unity.UnityHub", "Unity Hub"),
        "unreal" => ("EpicGames.EpicGamesLauncher", "Epic Games Launcher"),
        "blender" => ("BlenderFoundation.Blender", "Blender"),
        "git" => ("Git.Git", "Git"),
        "python" => ("Python.Python.3.12", "Python 3.12"),
        "node" => ("OpenJS.NodeJS.LTS", "Node.js LTS"),
        "dotnet" => ("Microsoft.DotNet.SDK.8", ".NET SDK 8"),
        _ => return None,
    })
}

fn tool(id: &str, label: &str, category: GameToolCategory, purpose: &str) -> GameTool {
    GameTool {
        id: id.to_string(),
        label: label.to_string(),
        category,
        state: GameToolState::Missing,
        version: None,
        path: None,
        purpose: purpose.to_string(),
        checks: Vec::new(),
        setup: Vec::new(),
        url: None,
        overridable: false,
    }
}

fn steps(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

fn engine_tool(
    engine: GameEngine,
    installs: &[GameEngineInstall],
    checks: Vec<GameCheck>,
) -> GameTool {
    let (purpose, url, setup): (&str, &str, Vec<String>) = match engine {
        GameEngine::Godot => (
            "Moteur libre et léger (2D et 3D) : création, vérification, test de démarrage et export.",
            "https://godotengine.org/download",
            steps(&[
                "Cliquez sur « Installer » (winget), ou téléchargez Godot 4 sur godotengine.org.",
                "Pour le C#, prenez la version .NET.",
                "Si vous avez décompressé une archive, cliquez sur « Désigner l'exécutable » et choisissez Godot_v4…_win64.exe.",
                "Cliquez sur « Détecter à nouveau ».",
            ]),
        ),
        GameEngine::Unity => (
            "Moteur polyvalent (C#) : compilation, tests et builds en ligne de commande.",
            "https://unity.com/download",
            steps(&[
                "Installez Unity Hub (bouton « Installer » ou unity.com/download).",
                "Ouvrez Unity Hub, connectez-vous et activez une licence (Personal est gratuite).",
                "Dans Installs, ajoutez une version LTS avec « Windows Build Support ».",
                "Cliquez sur « Détecter à nouveau ».",
            ]),
        ),
        GameEngine::Unreal => (
            "Moteur 3D haut de gamme : Blueprints et C++, packaging BuildCookRun.",
            "https://www.unrealengine.com/download",
            steps(&[
                "Installez l'Epic Games Launcher (bouton « Installer »).",
                "Dans l'onglet Unreal Engine > Bibliothèque, ajoutez la version 5.4 ou plus.",
                "Pour le C++ : installez Visual Studio 2022 avec « Développement de jeux en C++ ».",
                "Cliquez sur « Détecter à nouveau ».",
            ]),
        ),
    };
    let mut t = tool(
        engine.slug(),
        engine.label(),
        GameToolCategory::Engine,
        purpose,
    );
    t.url = Some(url.to_string());
    t.setup = setup;
    t.overridable = true;
    t.checks = checks;
    if let Some(best) = installs.first() {
        t.state = GameToolState::Ready;
        t.version = best.version.clone();
        t.path = Some(best.editor.clone());
        if engine == GameEngine::Godot
            && best.version.as_deref().is_some_and(|v| !v.starts_with('4'))
        {
            t.state = GameToolState::VersionMismatch;
            t.checks.push(check(
                "Version 4 requise",
                false,
                Some("Game Studio écrit des projets Godot 4.".to_string()),
            ));
        }
        if engine == GameEngine::Unreal
            && best.version.as_deref().is_some_and(|v| v.starts_with('4'))
        {
            t.state = GameToolState::Degraded;
            t.checks.push(check("Unreal 5 recommandé", false, Some("Les projets créés visent Unreal 5 ; Unreal 4 reste utilisable pour des projets existants.".to_string())));
        }
        if cfg!(windows) && engine == GameEngine::Godot && best.console.is_none() {
            t.checks.push(check(
                "Variante console (_console.exe)",
                false,
                Some("Sans elle, la version est lue dans le nom du fichier et la sortie de Godot n'est pas lisible : gardez le fichier …_console.exe à côté de l'exécutable.".to_string()),
            ));
            t.state = GameToolState::Degraded;
        }
    } else {
        t.state = GameToolState::Optional;
    }
    t
}

/// Premier fichier existant parmi des dossiers « <racine>/<version>/<exe> » triés par version.
fn newest_in(dirs: &[PathBuf], exe: &str) -> Option<PathBuf> {
    let mut found: Vec<PathBuf> = dirs
        .iter()
        .flat_map(|d| subdirs(d))
        .map(|d| d.join(exe))
        .filter(|p| p.is_file())
        .collect();
    found.sort_by_key(|p| {
        std::cmp::Reverse(version_key(
            p.parent()
                .and_then(|d| d.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .as_deref(),
        ))
    });
    found.into_iter().next()
}

fn blender_candidates(overrides: &[PathBuf]) -> Vec<(PathBuf, &'static str)> {
    let mut out: Vec<(PathBuf, &'static str)> = overrides
        .iter()
        .map(|p| (p.clone(), "Chemin choisi"))
        .collect();
    let exe = if cfg!(windows) {
        "blender.exe"
    } else {
        "blender"
    };
    let mut roots = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = env_dir(var) {
            roots.push(pf.join("Blender Foundation"));
            let steam = pf
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Blender")
                .join(exe);
            if steam.is_file() {
                out.push((steam, "Steam"));
            }
        }
    }
    if let Some(local) = env_dir("LOCALAPPDATA") {
        roots.push(local.join("Programs").join("Blender Foundation"));
    }
    if let Some(found) = newest_in(&roots, exe) {
        out.push((found, "Program Files"));
    }
    if cfg!(target_os = "macos") {
        out.push((
            PathBuf::from("/Applications/Blender.app/Contents/MacOS/Blender"),
            "Applications",
        ));
    }
    if let Ok(path) = which::which("blender") {
        out.push((path, "PATH"));
    }
    out
}

/// Blender : chemin et version (`Blender 4.2.1 LTS`).
pub fn find_blender(overrides: &[PathBuf]) -> (Option<(PathBuf, Option<String>)>, Vec<GameCheck>) {
    let mut checks = Vec::new();
    for (path, source) in blender_candidates(overrides) {
        if !path.is_file() {
            if source == "Chemin choisi" {
                checks.push(check(
                    format!("Chemin choisi : {}", display(&path)),
                    false,
                    Some("Fichier introuvable.".to_string()),
                ));
            }
            continue;
        }
        let version = probe(
            &path,
            &["--factory-startup", "--version"],
            Duration::from_secs(20),
        )
        .and_then(|out| {
            out.lines().find_map(|l| {
                l.trim()
                    .strip_prefix("Blender ")
                    .map(|v| v.trim().to_string())
            })
        })
        .or_else(|| {
            path.parent()
                .and_then(|d| d.file_name())
                .map(|n| n.to_string_lossy().to_string())
                .and_then(|n| n.strip_prefix("Blender ").map(str::to_string))
        });
        checks.push(check(
            format!("{source} : {}", display(&path)),
            true,
            version.clone(),
        ));
        return (Some((path, version)), checks);
    }
    checks.push(check(
        "Emplacements connus (Program Files, Steam, PATH)",
        false,
        Some("Aucun blender.exe trouvé.".to_string()),
    ));
    (None, checks)
}

/// Outil en ligne de commande dans le PATH : chemin et première ligne de version.
fn cli_version(
    overrides: &[PathBuf],
    names: &[&str],
    args: &[&str],
    parse: impl Fn(&str) -> Option<String>,
) -> (Option<(PathBuf, String)>, Vec<GameCheck>) {
    let mut checks = Vec::new();
    let candidates: Vec<PathBuf> = overrides
        .iter()
        .cloned()
        .chain(names.iter().filter_map(|n| which::which(n).ok()))
        .collect();
    for path in candidates {
        match probe(&path, args, PROBE) {
            Some(out) => match parse(&out) {
                Some(version) => {
                    checks.push(check(
                        format!("{} {}", display(&path), args.join(" ")),
                        true,
                        Some(version.clone()),
                    ));
                    return (Some((path, version)), checks);
                }
                None => checks.push(check(
                    format!("{} {}", display(&path), args.join(" ")),
                    false,
                    Some(format!(
                        "Réponse inattendue : {}",
                        out.lines().next().unwrap_or("(vide)")
                    )),
                )),
            },
            None => checks.push(check(
                format!("{} {}", display(&path), args.join(" ")),
                false,
                Some("Ne répond pas.".to_string()),
            )),
        }
    }
    if checks.is_empty() {
        checks.push(check(
            format!("{} dans le PATH", names.join(" / ")),
            false,
            Some("Introuvable.".to_string()),
        ));
    }
    (None, checks)
}

fn after_prefix(prefix: &'static str) -> impl Fn(&str) -> Option<String> {
    move |out: &str| {
        out.lines().find_map(|l| {
            l.trim()
                .strip_prefix(prefix)
                .map(|v| v.split_whitespace().next().unwrap_or(v).to_string())
        })
    }
}

/// Rapport complet. Lent (lance des programmes) : à appeler hors du fil asynchrone.
pub fn environment(overrides: &ToolOverrides) -> GameEnvironment {
    let mut tools = Vec::new();
    let mut engines_found = Vec::new();
    for adapter in engines::all() {
        let engine = adapter.engine();
        let (installs, checks) = adapter.detect(&overrides.get(engine.slug()));
        tools.push(engine_tool(engine, &installs, checks));
        engines_found.extend(installs);
    }

    // Blender
    let mut blender = tool("blender", "Blender", GameToolCategory::Content, "Création et conversion de modèles 3D en arrière-plan (sans fenêtre) : modèles, matériaux, UV, export glTF et FBX.");
    blender.url = Some("https://www.blender.org/download/".to_string());
    blender.overridable = true;
    blender.setup = steps(&[
        "Cliquez sur « Installer » (winget) ou téléchargez Blender sur blender.org.",
        "Version 3.6 LTS ou plus récente.",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let (found, checks) = find_blender(&overrides.get("blender"));
    blender.checks = checks;
    match found {
        Some((path, version)) => {
            blender.state = GameToolState::Ready;
            blender.path = Some(display(&path));
            blender.version = version;
        }
        None => blender.state = GameToolState::Optional,
    }
    tools.push(blender);

    // Git (+ LFS)
    let mut git = tool(
        "git",
        "Git",
        GameToolCategory::Vcs,
        "Points de restauration, historique et retour en arrière des modifications (§43).",
    );
    git.url = Some("https://git-scm.com/downloads".to_string());
    git.overridable = true;
    git.setup = steps(&[
        "Cliquez sur « Installer » (winget) ou téléchargez Git sur git-scm.com.",
        "Gardez les options par défaut (Git LFS est inclus).",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let (found, checks) = cli_version(
        &overrides.get("git"),
        &["git"],
        &["--version"],
        after_prefix("git version "),
    );
    git.checks = checks;
    if let Some((path, version)) = found {
        git.state = GameToolState::Ready;
        git.version = Some(version);
        let lfs = probe(&path, &["lfs", "version"], PROBE).filter(|o| o.contains("git-lfs"));
        git.checks.push(check(
            "Git LFS (gros fichiers binaires)",
            lfs.is_some(),
            lfs.map(|o| o.lines().next().unwrap_or("").to_string()),
        ));
        git.path = Some(display(&path));
    } else {
        git.state = GameToolState::Missing;
    }
    tools.push(git);

    // Python
    let mut python = tool("python", "Python", GameToolCategory::Runtime, "Scripts d'outillage et de génération de contenu ; les scripts Blender utilisent le Python intégré à Blender.");
    python.url = Some("https://www.python.org/downloads/".to_string());
    python.setup = steps(&[
        "Cliquez sur « Installer » (winget).",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let names: &[&str] = if cfg!(windows) {
        &["python", "py"]
    } else {
        &["python3", "python"]
    };
    let (found, checks) = cli_version(
        &overrides.get("python"),
        names,
        &["--version"],
        after_prefix("Python "),
    );
    python.checks = checks;
    match found {
        Some((path, version)) => {
            python.state = GameToolState::Ready;
            python.version = Some(version);
            python.path = Some(display(&path));
        }
        None => python.state = GameToolState::Optional,
    }
    tools.push(python);

    // Node.js
    let mut node = tool(
        "node",
        "Node.js",
        GameToolCategory::Runtime,
        "Serveurs MCP en ligne de commande (npx) et outils web.",
    );
    node.url = Some("https://nodejs.org/".to_string());
    node.setup = steps(&[
        "Cliquez sur « Installer » (winget, version LTS).",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let (found, checks) = cli_version(
        &overrides.get("node"),
        &["node"],
        &["--version"],
        |out: &str| {
            out.lines()
                .find_map(|l| l.trim().strip_prefix('v').map(str::to_string))
        },
    );
    node.checks = checks;
    match found {
        Some((path, version)) => {
            node.state = GameToolState::Ready;
            node.version = Some(version);
            node.path = Some(display(&path));
        }
        None => node.state = GameToolState::Optional,
    }
    tools.push(node);

    // .NET SDK
    let mut dotnet = tool(
        "dotnet",
        ".NET SDK",
        GameToolCategory::Sdk,
        "Compilation C# de Godot .NET et outils C#.",
    );
    dotnet.url = Some("https://dotnet.microsoft.com/download".to_string());
    dotnet.setup = steps(&[
        "Cliquez sur « Installer » (winget, .NET 8).",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let (found, checks) = cli_version(
        &overrides.get("dotnet"),
        &["dotnet"],
        &["--list-sdks"],
        |out: &str| {
            out.lines()
                .filter_map(|l| l.split_whitespace().next())
                .rfind(|v| v.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .map(str::to_string)
        },
    );
    dotnet.checks = checks;
    match found {
        Some((path, version)) => {
            dotnet.state = GameToolState::Ready;
            dotnet.version = Some(version);
            dotnet.path = Some(display(&path));
        }
        None => dotnet.state = GameToolState::Optional,
    }
    tools.push(dotnet);

    // Visual Studio (C++ d'Unreal)
    if cfg!(windows) {
        let mut vs = tool(
            "visual_studio",
            "Visual Studio (C++)",
            GameToolCategory::Sdk,
            "Compilation du C++ des projets Unreal.",
        );
        vs.url = Some("https://visualstudio.microsoft.com/downloads/".to_string());
        vs.setup = steps(&[
            "Installez Visual Studio 2022 Community.",
            "Dans Visual Studio Installer, cochez « Développement de jeux en C++ ».",
            "Cliquez sur « Détecter à nouveau ».",
        ]);
        match engines::unreal::visual_studio() {
            Some(path) => {
                vs.state = GameToolState::Ready;
                vs.path = Some(display(&path));
                vs.checks
                    .push(check("vswhere : outils C++ x64", true, None));
            }
            None => {
                vs.state = GameToolState::Optional;
                vs.checks.push(check(
                    "vswhere : outils C++ x64",
                    false,
                    Some("Aucune installation avec les outils C++.".to_string()),
                ));
            }
        }
        tools.push(vs);
    }

    // Android SDK
    let mut android = tool(
        "android_sdk",
        "SDK Android",
        GameToolCategory::Sdk,
        "Builds Android (Godot, Unity, Unreal).",
    );
    android.url = Some("https://developer.android.com/studio".to_string());
    android.setup = steps(&[
        "Installez Android Studio.",
        "Ouvrez SDK Manager et installez « Android SDK Platform-Tools ».",
        "Cliquez sur « Détecter à nouveau ».",
    ]);
    let sdk = ["ANDROID_HOME", "ANDROID_SDK_ROOT"]
        .iter()
        .filter_map(|v| env_dir(v))
        .chain(env_dir("LOCALAPPDATA").map(|d| d.join("Android").join("Sdk")))
        .chain(home().map(|h| h.join("Android").join("Sdk")))
        .find(|p| p.join("platform-tools").is_dir());
    android.checks.push(check(
        "ANDROID_HOME, ANDROID_SDK_ROOT, dossier par défaut",
        sdk.is_some(),
        sdk.as_deref().map(display),
    ));
    match sdk {
        Some(path) => {
            android.state = GameToolState::Ready;
            android.path = Some(display(&path));
        }
        None => android.state = GameToolState::Optional,
    }
    tools.push(android);

    GameEnvironment {
        tools,
        engines: engines_found,
        checked_at: chrono::Utc::now().to_rfc3339(),
        os: format!("{} {}", std::env::consts::OS, std::env::consts::ARCH),
    }
}

/// Meilleure installation d'un moteur (ou celle dont l'éditeur est donné).
pub fn pick_install(
    env: &GameEnvironment,
    engine: GameEngine,
    editor: Option<&str>,
) -> Option<GameEngineInstall> {
    let mut installs = env.engines.iter().filter(|i| i.engine == engine);
    match editor {
        Some(editor) => installs
            .find(|i| i.editor.eq_ignore_ascii_case(editor))
            .cloned(),
        None => installs.next().cloned(),
    }
}

/// Vérifie qu'un chemin choisi à la main désigne bien un exécutable.
pub fn validate_override(path: &str) -> AppResult<PathBuf> {
    let path = PathBuf::from(path.trim());
    if path.as_os_str().is_empty() {
        return Err(AppError::invalid("Chemin vide."));
    }
    if !path.exists() {
        return Err(AppError::not_found(format!(
            "{} n'existe pas.",
            display(&path)
        )));
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overrides_round_trip() {
        let dir = std::env::temp_dir().join(format!("gs-tools-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut overrides = ToolOverrides::default();
        overrides
            .paths
            .insert("godot".into(), vec!["C:/Godot/godot.exe".into()]);
        overrides.save(&dir).unwrap();
        assert_eq!(ToolOverrides::load(&dir), overrides);
        assert_eq!(
            overrides.get("godot"),
            vec![PathBuf::from("C:/Godot/godot.exe")]
        );
        assert!(overrides.get("blender").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn environment_lists_every_tool_with_checks() {
        let env = environment(&ToolOverrides::default());
        for id in [
            "godot",
            "unity",
            "unreal",
            "blender",
            "git",
            "python",
            "node",
            "dotnet",
            "android_sdk",
        ] {
            let tool = env
                .tools
                .iter()
                .find(|t| t.id == id)
                .unwrap_or_else(|| panic!("outil absent : {id}"));
            assert!(!tool.checks.is_empty(), "{id} sans vérification");
            if tool.state != GameToolState::Ready {
                assert!(!tool.setup.is_empty(), "{id} sans guide d'installation");
            }
        }
        assert!(winget_package("godot").is_some());
    }

    #[test]
    fn finds_a_godot_given_by_hand() {
        let Some(binary) = std::env::var_os("GAMESTUDIO_GODOT") else {
            return;
        };
        let mut overrides = ToolOverrides::default();
        overrides
            .paths
            .insert("godot".into(), vec![binary.to_string_lossy().to_string()]);
        let env = environment(&overrides);
        let godot = env.tools.iter().find(|t| t.id == "godot").unwrap();
        assert_eq!(godot.state, GameToolState::Ready);
        assert!(pick_install(&env, GameEngine::Godot, None).is_some());
    }
}
