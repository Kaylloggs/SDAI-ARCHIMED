//! Adaptateur Unity (Unity 2021 LTS et suivants, Unity 6).
//!
//! Ligne de commande officielle de l'éditeur (documentation « Command line arguments ») :
//! `-batchmode`, `-nographics`, `-quit`, `-projectPath`, `-logFile -` (journal sur la sortie
//! standard), `-executeMethod Classe.Méthode`, `-runTests -testPlatform EditMode
//! -testResults <xml>`. Unity doit être activé (licence) pour fonctionner en `-batchmode`.
//! Non vérifié sur cette machine de développement (Linux, pas d'éditeur Unity) : les
//! emplacements et arguments suivent la documentation d'Unity et d'Unity Hub.
//!
//! Création : Game Studio écrit les dossiers, les scripts et `ProjectVersion.txt` ; l'éditeur
//! complète le projet à la première ouverture (paquets par défaut, `Library/`), puis
//! `ArchimedGameStudio.Setup` crée la scène principale et l'inscrit dans le build.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::{AppError, AppResult};

use super::{
    capability, check, display, ensure_empty_dir, env_dir, home, keep_dir, subdirs, write_file,
    ActionContext, CommandSpec, Created, EngineAdapter, EngineProject, GameAction, NewProject,
};
use crate::modules::game_studio::types::{
    GameCapability, GameCapabilityVia, GameCheck, GameEngine, GameEngineInstall, GamePlatform,
};

pub struct Unity;

const EDITOR_SCRIPT: &str = "Assets/Editor/ArchimedGameStudio.cs";
pub const SETUP_MARKER: &str = "GAMESTUDIO_SETUP_OK";
pub const TEST_RESULTS: &str = ".gamestudio/builds/unity-tests.xml";

const EDITOR_SCRIPT_BODY: &str = r#"// Écrit par Game Studio (ARCHIMED) : commandes lancées en ligne de commande
// (-batchmode -executeMethod ArchimedGameStudio.<Méthode>). Vous pouvez le garder dans le projet.
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

public static class ArchimedGameStudio
{
    const string MainScene = "Assets/Scenes/Main.unity";

    // Crée la scène principale si elle manque et l'inscrit dans les scènes du build.
    public static void Setup()
    {
        if (!File.Exists(MainScene))
        {
            Directory.CreateDirectory("Assets/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
            EditorSceneManager.SaveScene(scene, MainScene);
        }
        if (!EditorBuildSettings.scenes.Any(s => s.path == MainScene))
        {
            var scenes = EditorBuildSettings.scenes.ToList();
            scenes.Insert(0, new EditorBuildSettingsScene(MainScene, true));
            EditorBuildSettings.scenes = scenes.ToArray();
        }
        AssetDatabase.SaveAssets();
        Debug.Log("GAMESTUDIO_SETUP_OK");
    }

    public static void BuildWindows() => Build(BuildTarget.StandaloneWindows64, "windows", ".exe");
    public static void BuildLinux() => Build(BuildTarget.StandaloneLinux64, "linux", ".x86_64");
    public static void BuildMac() => Build(BuildTarget.StandaloneOSX, "macos", ".app");
    public static void BuildAndroid() => Build(BuildTarget.Android, "android", ".apk");
    public static void BuildIos() => Build(BuildTarget.iOS, "ios", "");
    public static void BuildWeb() => Build(BuildTarget.WebGL, "web", "");

    static void Build(BuildTarget target, string folder, string extension)
    {
        var scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();
        if (scenes.Length == 0)
        {
            Setup();
            scenes = new[] { MainScene };
        }
        var name = string.IsNullOrWhiteSpace(PlayerSettings.productName) ? "Game" : PlayerSettings.productName;
        var output = Path.Combine("Build", folder, extension.Length > 0 ? name + extension : name);
        var development = System.Environment.GetCommandLineArgs().Contains("-gsDevelopment");
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
        {
            scenes = scenes,
            locationPathName = output,
            target = target,
            options = development ? BuildOptions.Development : BuildOptions.None,
        });
        var summary = report.summary;
        Debug.Log($"GAMESTUDIO_BUILD_RESULT {summary.result} errors={summary.totalErrors} warnings={summary.totalWarnings} output={output}");
        EditorApplication.Exit(summary.result == BuildResult.Succeeded ? 0 : 1);
    }
}
"#;

const GITIGNORE: &str = "# Unity (Game Studio)\n/[Ll]ibrary/\n/[Tt]emp/\n/[Oo]bj/\n/[Bb]uild/\n/[Bb]uilds/\n/[Ll]ogs/\n/[Uu]ser[Ss]ettings/\n/[Mm]emoryCaptures/\n/[Rr]ecordings/\n/Assets/Plugins/Editor/JetBrains*\n.vs/\n.vscode/\n.idea/\n.gradle/\nExportedObj/\n.consulo/\n*.csproj\n*.unityproj\n*.sln\n*.suo\n*.tmp\n*.user\n*.userprefs\n*.pidb\n*.booproj\n*.svd\n*.pdb\n*.mdb\n*.opendb\n*.VC.db\n*.pidb.meta\n*.pdb.meta\n*.mdb.meta\nsysinfo.txt\n*.apk\n*.aab\n*.unitypackage\n*.app\ncrashlytics-build.properties\n/[Aa]ssets/[Ss]treamingAssets/aa/*\n# Données locales de Game Studio\n.gamestudio/logs/\n.gamestudio/builds/\n.gamestudio/cache/\n";

fn editor_binary(editor_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        editor_dir.join("Unity.exe")
    } else if cfg!(target_os = "macos") {
        editor_dir.join("Unity.app/Contents/MacOS/Unity")
    } else {
        editor_dir.join("Unity")
    }
}

/// Version d'après le chemin Hub : `…/Hub/Editor/6000.0.23f1/Editor/Unity.exe`.
fn version_from_path(path: &Path) -> Option<String> {
    path.ancestors().find_map(|p| {
        let name = p.file_name()?.to_string_lossy().to_string();
        let looks =
            name.split('.').count() >= 3 && name.chars().next().is_some_and(|c| c.is_ascii_digit());
        looks.then_some(name)
    })
}

fn install_from(binary: &Path, source: &str) -> Option<GameEngineInstall> {
    if !binary.is_file() {
        return None;
    }
    // …/<version>/Editor/Unity.exe → racine = <version>
    let root = binary.parent().and_then(|p| {
        if cfg!(target_os = "macos") {
            p.parent()?.parent()?.parent()
        } else {
            p.parent()
        }
    });
    Some(GameEngineInstall {
        engine: GameEngine::Unity,
        version: version_from_path(binary),
        editor: display(binary),
        console: None,
        root: root.map(display).unwrap_or_default(),
        source: source.to_string(),
    })
}

/// Toutes les chaînes d'un JSON qui finissent par l'exécutable d'Unity (formats d'Unity Hub
/// qui changent selon les versions : on ne dépend pas de leur structure).
fn executables_in_json(value: &serde_json::Value, out: &mut Vec<PathBuf>) {
    match value {
        serde_json::Value::String(text) => {
            let lower = text.to_lowercase();
            if lower.ends_with("unity.exe")
                || lower.ends_with("/editor/unity")
                || lower.ends_with("unity.app")
            {
                out.push(PathBuf::from(text));
            }
        }
        serde_json::Value::Array(items) => items.iter().for_each(|v| executables_in_json(v, out)),
        serde_json::Value::Object(map) => map.values().for_each(|v| executables_in_json(v, out)),
        _ => {}
    }
}

fn hub_roots() -> Vec<(PathBuf, &'static str)> {
    let mut roots = Vec::new();
    if let Some(pf) = env_dir("ProgramFiles") {
        roots.push((pf.join("Unity").join("Hub").join("Editor"), "Unity Hub"));
    }
    if let Some(appdata) = env_dir("APPDATA") {
        // Emplacement choisi dans Unity Hub (JSON : une chaîne).
        if let Ok(raw) =
            std::fs::read_to_string(appdata.join("UnityHub").join("secondaryInstallPath.json"))
        {
            if let Ok(serde_json::Value::String(path)) =
                serde_json::from_str::<serde_json::Value>(&raw)
            {
                if !path.trim().is_empty() {
                    roots.push((PathBuf::from(path), "Unity Hub (emplacement choisi)"));
                }
            }
        }
    }
    if cfg!(target_os = "macos") {
        roots.push((PathBuf::from("/Applications/Unity/Hub/Editor"), "Unity Hub"));
    }
    if let Some(home) = home() {
        roots.push((home.join("Unity").join("Hub").join("Editor"), "Unity Hub"));
    }
    roots
}

impl EngineAdapter for Unity {
    fn engine(&self) -> GameEngine {
        GameEngine::Unity
    }

    fn detect(&self, overrides: &[PathBuf]) -> (Vec<GameEngineInstall>, Vec<GameCheck>) {
        let mut installs: Vec<GameEngineInstall> = Vec::new();
        let mut checks = Vec::new();
        let add = |install: Option<GameEngineInstall>, installs: &mut Vec<GameEngineInstall>| {
            if let Some(install) = install {
                if !installs
                    .iter()
                    .any(|i| i.editor.eq_ignore_ascii_case(&install.editor))
                {
                    installs.push(install);
                }
            }
        };
        for path in overrides {
            let binary = if path.is_dir() {
                editor_binary(&path.join("Editor"))
            } else {
                path.clone()
            };
            let found = install_from(&binary, "Chemin choisi");
            if found.is_none() {
                checks.push(check(
                    format!("Chemin choisi : {}", display(path)),
                    false,
                    Some("Unity.exe introuvable à cet endroit.".to_string()),
                ));
            }
            add(found, &mut installs);
        }
        for (root, source) in hub_roots() {
            let versions = subdirs(&root);
            checks.push(check(
                format!("{source} : {}", display(&root)),
                !versions.is_empty(),
                Some(if root.is_dir() {
                    format!("{} version(s)", versions.len())
                } else {
                    "Dossier absent.".to_string()
                }),
            ));
            for version in versions {
                add(
                    install_from(&editor_binary(&version.join("Editor")), source),
                    &mut installs,
                );
            }
        }
        if let Some(appdata) = env_dir("APPDATA") {
            for file in ["editors-v2.json", "editors.json"] {
                if let Ok(raw) = std::fs::read_to_string(appdata.join("UnityHub").join(file)) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                        let mut found = Vec::new();
                        executables_in_json(&value, &mut found);
                        for path in found {
                            add(
                                install_from(&path, "Unity Hub (liste des éditeurs)"),
                                &mut installs,
                            );
                        }
                    }
                }
            }
        }
        if let Some(pf) = env_dir("ProgramFiles") {
            add(
                install_from(
                    &pf.join("Unity").join("Editor").join("Unity.exe"),
                    "Installation classique",
                ),
                &mut installs,
            );
        }
        installs.sort_by(|a, b| {
            super::godot::version_key(b.version.as_deref())
                .cmp(&super::godot::version_key(a.version.as_deref()))
        });
        (installs, checks)
    }

    fn is_project(&self, root: &Path) -> bool {
        root.join("ProjectSettings")
            .join("ProjectVersion.txt")
            .is_file()
            || (root.join("Assets").is_dir() && root.join("ProjectSettings").is_dir())
    }

    fn inspect(&self, root: &Path) -> Option<EngineProject> {
        if !self.is_project(root) {
            return None;
        }
        let version =
            std::fs::read_to_string(root.join("ProjectSettings").join("ProjectVersion.txt"))
                .ok()
                .and_then(|text| {
                    text.lines().find_map(|l| {
                        l.trim()
                            .strip_prefix("m_EditorVersion:")
                            .map(|v| v.trim().to_string())
                    })
                });
        let name =
            std::fs::read_to_string(root.join("ProjectSettings").join("ProjectSettings.asset"))
                .ok()
                .and_then(|text| {
                    text.lines().find_map(|l| {
                        l.trim()
                            .strip_prefix("productName:")
                            .map(|v| v.trim().to_string())
                    })
                })
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| {
                    root.file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default()
                });
        let packages = std::fs::read_to_string(root.join("Packages").join("manifest.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .and_then(|v| {
                v.get("dependencies")
                    .and_then(|d| d.as_object())
                    .map(|d| d.keys().cloned().collect())
            })
            .unwrap_or_default();
        let main_scene = std::fs::read_to_string(
            root.join("ProjectSettings")
                .join("EditorBuildSettings.asset"),
        )
        .ok()
        .and_then(|text| {
            text.lines()
                .find_map(|l| l.trim().strip_prefix("path:").map(|v| v.trim().to_string()))
        })
        .filter(|p| !p.is_empty());
        Some(EngineProject {
            name,
            engine_version: version,
            main_scene,
            languages: vec!["C#".to_string()],
            packages,
        })
    }

    fn create(&self, spec: &NewProject, install: Option<&GameEngineInstall>) -> AppResult<Created> {
        ensure_empty_dir(&spec.dir)?;
        let root = spec.dir.as_path();
        let mut created = Created::default();
        let code = super::code_name(&spec.name);
        write_file(root, EDITOR_SCRIPT, EDITOR_SCRIPT_BODY, &mut created)?;
        write_file(
            root,
            "Assets/Scripts/GameBootstrap.cs",
            &format!(
                "using UnityEngine;\n\n// Point d'entrée du jeu « {} », créé par Game Studio : appelé au lancement,\n// sans objet à placer dans la scène.\npublic static class GameBootstrap\n{{\n    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]\n    static void OnGameStarted()\n    {{\n        Debug.Log(\"{} : démarrage\");\n    }}\n}}\n",
                spec.name.replace('"', "'"),
                spec.name.replace('"', "'"),
            ),
            &mut created,
        )?;
        write_file(
            root,
            "Assets/Tests/EditMode/Tests.EditMode.asmdef",
            "{\n  \"name\": \"Tests.EditMode\",\n  \"references\": [\"UnityEngine.TestRunner\", \"UnityEditor.TestRunner\"],\n  \"includePlatforms\": [\"Editor\"],\n  \"overrideReferences\": true,\n  \"precompiledReferences\": [\"nunit.framework.dll\"],\n  \"autoReferenced\": false,\n  \"defineConstraints\": [\"UNITY_INCLUDE_TESTS\"]\n}\n",
            &mut created,
        )?;
        write_file(
            root,
            "Assets/Tests/EditMode/SmokeTests.cs",
            "using NUnit.Framework;\nusing UnityEditor;\n\n// Tests de base écrits par Game Studio.\npublic class SmokeTests\n{\n    [Test]\n    public void MainSceneIsInTheBuild()\n    {\n        Assert.IsNotEmpty(EditorBuildSettings.scenes, \"Aucune scène dans le build : lancez la préparation du projet.\");\n    }\n}\n",
            &mut created,
        )?;
        for dir in [
            "Assets/Scenes",
            "Assets/Art/Generated",
            "Assets/Data",
            "Assets/Prefabs",
            "Assets/Audio",
            "Assets/UI",
        ] {
            keep_dir(root, dir, &mut created)?;
        }
        if let Some(version) = install.and_then(|i| i.version.clone()) {
            write_file(
                root,
                "ProjectSettings/ProjectVersion.txt",
                &format!("m_EditorVersion: {version}\n"),
                &mut created,
            )?;
        } else {
            std::fs::create_dir_all(root.join("ProjectSettings"))?;
            created.notes.push("Aucun éditeur Unity installé : Unity Hub demandera la version à utiliser à la première ouverture.".to_string());
        }
        write_file(root, ".gitignore", GITIGNORE, &mut created)?;
        write_file(
            root,
            ".gitattributes",
            "* text=auto\n*.cs diff=csharp\n",
            &mut created,
        )?;
        created.notes.push(format!(
            "Squelette Unity écrit pour « {} » ({code}) : scripts, tests et commandes de build. L'éditeur complète le projet (paquets, Library) à la première préparation.",
            spec.name
        ));
        created.notes.push("Lancez « Préparer » : Unity crée la scène principale et l'inscrit dans le build (licence Unity activée nécessaire).".to_string());
        Ok(created)
    }

    fn capabilities(
        &self,
        root: Option<&Path>,
        install: Option<&GameEngineInstall>,
    ) -> Vec<GameCapability> {
        let editor = install.is_some();
        let prepared = root.map(|r| r.join("Library").is_dir());
        let script = root.map(|r| r.join(EDITOR_SCRIPT).is_file());
        vec![
            capability("create", "Créer un projet", GameCapabilityVia::Files, None, Some(true), Some("Dossiers, scripts C# et ProjectVersion.txt ; l'éditeur complète le reste.".to_string())),
            capability("inspect", "Lire le projet (version, paquets, scènes du build)", GameCapabilityVia::Files, None, Some(true), None),
            capability("scripts", "Écrire le code C#", GameCapabilityVia::Files, None, Some(true), None),
            capability("scenes", "Créer et modifier les scènes", GameCapabilityVia::Cli, Some("Éditeur Unity installé ; scripts d'éditeur (-executeMethod) ou serveur MCP Unity"), Some(editor), Some("Les fichiers .unity ne se modifient pas à la main sans risque : Game Studio passe par l'éditeur.".to_string())),
            capability("setup", "Préparer le projet (scène principale, build)", GameCapabilityVia::Cli, Some("Éditeur Unity installé et licence activée"), Some(editor), None),
            capability("check", "Compiler les scripts", GameCapabilityVia::Cli, Some("Éditeur Unity installé et licence activée"), Some(editor), Some("-batchmode -quit : les erreurs de compilation C# sont lues dans le journal.".to_string())),
            capability("test", "Tests EditMode (Unity Test Framework)", GameCapabilityVia::Cli, Some("Paquet com.unity.test-framework"), Some(editor && prepared.unwrap_or(false)), None),
            capability("build", "Produire un build", GameCapabilityVia::Cli, Some("Module de build de la plateforme installé dans Unity Hub"), Some(editor && script.unwrap_or(true)), None),
            capability("run", "Lancer le jeu", GameCapabilityVia::Cli, Some("Un build Windows, ou l'éditeur en mode Play"), Some(editor), None),
            capability("editor", "Ouvrir l'éditeur", GameCapabilityVia::Cli, Some("Éditeur Unity installé"), Some(editor), None),
        ]
    }

    fn command(&self, action: GameAction, ctx: &ActionContext) -> AppResult<CommandSpec> {
        let root = ctx.root.to_path_buf();
        let path = display(&root);
        ensure_editor_script(ctx.root)?;
        let base = |args: &[&str]| -> Vec<String> {
            let mut out = vec![
                "-batchmode".to_string(),
                "-nographics".to_string(),
                "-projectPath".to_string(),
                path.clone(),
                "-logFile".to_string(),
                "-".to_string(),
            ];
            out.extend(args.iter().map(|a| a.to_string()));
            out
        };
        let spec = |args: Vec<String>, timeout: Option<u64>| CommandSpec {
            program: PathBuf::from(&ctx.install.editor),
            args,
            cwd: root.clone(),
            timeout: timeout.map(Duration::from_secs),
            output: None,
            success_marker: None,
            detached: false,
            strict: false,
            results: None,
        };
        Ok(match action {
            GameAction::Setup => {
                let mut s = spec(
                    base(&["-quit", "-executeMethod", "ArchimedGameStudio.Setup"]),
                    Some(3600),
                );
                s.success_marker = Some(SETUP_MARKER.to_string());
                s
            }
            GameAction::Check => spec(base(&["-quit"]), Some(3600)),
            GameAction::Test => {
                let results = display(&ctx.root.join(TEST_RESULTS));
                std::fs::create_dir_all(ctx.root.join(".gamestudio").join("builds"))?;
                // -runTests quitte seul : pas de -quit (documentation Unity Test Framework).
                let mut s = spec(
                    base(&[
                        "-runTests",
                        "-testPlatform",
                        "EditMode",
                        "-testResults",
                        &results,
                    ]),
                    Some(3600),
                );
                s.results = Some(ctx.root.join(TEST_RESULTS));
                s
            }
            GameAction::Build => {
                let (method, folder, ext) = match ctx.platform {
                    GamePlatform::Windows => ("BuildWindows", "windows", ".exe"),
                    GamePlatform::Linux => ("BuildLinux", "linux", ".x86_64"),
                    GamePlatform::Macos => ("BuildMac", "macos", ".app"),
                    GamePlatform::Android => ("BuildAndroid", "android", ".apk"),
                    GamePlatform::Ios => ("BuildIos", "ios", ""),
                    GamePlatform::Web => ("BuildWeb", "web", ""),
                    GamePlatform::Console => {
                        return Err(AppError::invalid("Les builds console d'Unity demandent les modules des constructeurs (licence développeur) : Game Studio ne peut pas les produire sans eux."))
                    }
                };
                let execute = format!("ArchimedGameStudio.{method}");
                let mut args = base(&["-executeMethod", &execute]);
                if ctx.development {
                    args.push("-gsDevelopment".to_string());
                }
                let mut s = spec(args, Some(7200));
                let name = if ctx.project.name.is_empty() {
                    "Game".to_string()
                } else {
                    ctx.project.name.clone()
                };
                s.output = Some(ctx.root.join("Build").join(folder).join(if ext.is_empty() {
                    name
                } else {
                    format!("{name}{ext}")
                }));
                s
            }
            GameAction::Run => {
                let built = ctx.root.join("Build").join("windows");
                let exe = super::files_in(&built)
                    .into_iter()
                    .find(|p| p.extension().is_some_and(|e| e == "exe"));
                match exe {
                    Some(exe) => CommandSpec {
                        program: exe,
                        cwd: built,
                        ..CommandSpec::default()
                    },
                    None => {
                        return Err(AppError::invalid(
                            "Aucun build Windows à lancer : faites d'abord un build, ou ouvrez l'éditeur et appuyez sur Play.",
                        ))
                    }
                }
            }
            GameAction::Editor => {
                let mut s = spec(vec!["-projectPath".to_string(), path], None);
                s.detached = true;
                s
            }
        })
    }

    fn gitignore(&self) -> &'static str {
        GITIGNORE
    }

    fn ignored_dirs(&self) -> &'static [&'static str] {
        &[
            "Library",
            "Temp",
            "Obj",
            "obj",
            "Logs",
            "UserSettings",
            "Build",
            "Builds",
            "MemoryCaptures",
            "Recordings",
            ".vs",
        ]
    }

    fn asset_dir(&self) -> &'static str {
        "Assets/Art/Generated"
    }
}

/// Réécrit le script d'éditeur de Game Studio s'il manque ou diffère.
pub fn ensure_editor_script(root: &Path) -> AppResult<()> {
    let path = root.join(EDITOR_SCRIPT);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(EDITOR_SCRIPT_BODY) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, EDITOR_SCRIPT_BODY)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::types::GameDimension;

    #[test]
    fn reads_versions_from_hub_paths_and_json() {
        let path = PathBuf::from("C:/Program Files/Unity/Hub/Editor/6000.0.23f1/Editor/Unity.exe");
        assert_eq!(version_from_path(&path).as_deref(), Some("6000.0.23f1"));
        let json: serde_json::Value = serde_json::from_str(r#"{"data":[{"version":"2022.3.40f1","location":["D:\\Unity\\2022.3.40f1\\Editor\\Unity.exe"]}]}"#).unwrap();
        let mut found = Vec::new();
        executables_in_json(&json, &mut found);
        assert_eq!(found.len(), 1);
    }

    #[test]
    fn creates_and_inspects_a_skeleton() {
        let dir = std::env::temp_dir().join(format!("gs-unity-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let install = GameEngineInstall {
            engine: GameEngine::Unity,
            version: Some("6000.0.23f1".to_string()),
            editor: "Unity.exe".to_string(),
            console: None,
            root: String::new(),
            source: "test".to_string(),
        };
        let spec = NewProject {
            name: "Forge des Brumes".to_string(),
            dir: dir.clone(),
            dimension: GameDimension::ThreeD,
            description: String::new(),
            targets: vec![],
            cpp: false,
        };
        Unity.create(&spec, Some(&install)).unwrap();
        assert!(Unity.is_project(&dir));
        let project = Unity.inspect(&dir).unwrap();
        assert_eq!(project.engine_version.as_deref(), Some("6000.0.23f1"));
        let ctx = ActionContext {
            root: &dir,
            project: &project,
            install: &install,
            platform: GamePlatform::Windows,
            development: true,
        };
        let build = Unity.command(GameAction::Build, &ctx).unwrap();
        assert!(build
            .args
            .contains(&"ArchimedGameStudio.BuildWindows".to_string()));
        assert!(build.args.contains(&"-gsDevelopment".to_string()));
        assert!(
            Unity.command(GameAction::Run, &ctx).is_err(),
            "pas de build : rien à lancer"
        );
        let test = Unity.command(GameAction::Test, &ctx).unwrap();
        assert!(!test.args.contains(&"-quit".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
