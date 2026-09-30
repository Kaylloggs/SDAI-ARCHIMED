//! Adaptateur Unreal Engine 5.
//!
//! Installations : `%ProgramData%\Epic\UnrealEngineLauncher\LauncherInstalled.dat` (Epic Games
//! Launcher), registre (`HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>` → `InstalledDirectory`,
//! moteurs compilés : `HKCU\Software\Epic Games\Unreal Engine\Builds`), puis `Program Files\Epic
//! Games\UE_*`. Version : `Engine/Build/Build.version`.
//!
//! Outils officiels : `Engine/Build/BatchFiles/Build.bat <Cible> Win64 Development
//! -Project=<uproject>` (UnrealBuildTool), `RunUAT.bat BuildCookRun` (packaging),
//! `UnrealEditor-Cmd.exe <uproject> -run=CompileAllBlueprints` (vérification des Blueprints),
//! `-ExecCmds="Automation RunTests …"` (tests), `-game` (lancer le jeu). Non vérifié sur cette
//! machine (pas d'Unreal) : arguments tirés de la documentation d'Epic.
//!
//! Serveur dédié : seulement avec un moteur compilé depuis les sources (les versions du
//! Launcher n'ont pas les cibles serveur).

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::{AppError, AppResult};

use super::{
    capability, check, display, ensure_empty_dir, env_dir, files_in, keep_dir, subdirs, write_file,
    ActionContext, CommandSpec, Created, EngineAdapter, EngineProject, GameAction, NewProject,
};
use crate::modules::game_studio::types::{
    GameCapability, GameCapabilityVia, GameCheck, GameEngine, GameEngineInstall, GamePlatform,
};

pub struct Unreal;

const GITIGNORE: &str = "# Unreal Engine (Game Studio)\nBinaries/\nDerivedDataCache/\nIntermediate/\nSaved/\nBuild/\n.vs/\n.vsconfig\n*.sln\n*.VC.db\n*.opensdf\n*.opendb\n*.sdf\n*.suo\n*.xcodeproj\n*.xcworkspace\nPlugins/*/Binaries/\nPlugins/*/Intermediate/\n# Données locales de Game Studio\n.gamestudio/logs/\n.gamestudio/builds/\n.gamestudio/cache/\n";

/// Fichiers binaires d'Unreal à ranger dans Git LFS.
pub const LFS_ATTRIBUTES: &str = "*.uasset filter=lfs diff=lfs merge=lfs -text\n*.umap filter=lfs diff=lfs merge=lfs -text\n*.fbx filter=lfs diff=lfs merge=lfs -text\n*.png filter=lfs diff=lfs merge=lfs -text\n*.wav filter=lfs diff=lfs merge=lfs -text\n";

fn binaries_dir(root: &Path) -> PathBuf {
    let platform = if cfg!(windows) {
        "Win64"
    } else if cfg!(target_os = "macos") {
        "Mac"
    } else {
        "Linux"
    };
    root.join("Engine").join("Binaries").join(platform)
}

fn editor_of(root: &Path) -> Option<(PathBuf, Option<PathBuf>)> {
    let bin = binaries_dir(root);
    let ext = if cfg!(windows) { ".exe" } else { "" };
    for (editor, console) in [
        ("UnrealEditor", "UnrealEditor-Cmd"),
        ("UE4Editor", "UE4Editor-Cmd"),
    ] {
        let path = bin.join(format!("{editor}{ext}"));
        if path.is_file() {
            let cmd = bin.join(format!("{console}{ext}"));
            return Some((path, cmd.is_file().then_some(cmd)));
        }
    }
    None
}

/// `Engine/Build/Build.version` → `5.4.4`.
pub fn read_version(root: &Path) -> Option<String> {
    let raw =
        std::fs::read_to_string(root.join("Engine").join("Build").join("Build.version")).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let part = |key: &str| value.get(key).and_then(|v| v.as_u64());
    Some(format!(
        "{}.{}.{}",
        part("MajorVersion")?,
        part("MinorVersion")?,
        part("PatchVersion").unwrap_or(0)
    ))
}

/// Moteur compilé depuis les sources (cibles serveur disponibles).
pub fn is_source_build(root: &Path) -> bool {
    !root
        .join("Engine")
        .join("Build")
        .join("InstalledBuild.txt")
        .is_file()
}

fn install_from(root: &Path, source: &str) -> Option<GameEngineInstall> {
    let (editor, console) = editor_of(root)?;
    Some(GameEngineInstall {
        engine: GameEngine::Unreal,
        version: read_version(root),
        editor: display(&editor),
        console: console.as_deref().map(display),
        root: display(root),
        source: source.to_string(),
    })
}

/// Racine d'un moteur à partir d'un chemin choisi (racine, dossier Engine ou exécutable).
fn root_from_override(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|p| p.join("Engine").join("Build").is_dir())
        .map(Path::to_path_buf)
}

/// Emplacements lus dans `LauncherInstalled.dat`.
pub fn launcher_locations(raw: &str) -> Vec<PathBuf> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    value
        .get("InstallationList")
        .and_then(|l| l.as_array())
        .map(|list| {
            list.iter()
                .filter(|item| {
                    item.get("AppName")
                        .and_then(|n| n.as_str())
                        .is_some_and(|n| n.starts_with("UE_"))
                })
                .filter_map(|item| {
                    item.get("InstallLocation")
                        .and_then(|l| l.as_str())
                        .map(PathBuf::from)
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Chemins d'une sortie de `reg query` (`    Nom    REG_SZ    C:\…`).
#[cfg(any(windows, test))]
pub fn registry_paths(output: &str) -> Vec<PathBuf> {
    output
        .lines()
        .filter_map(|line| {
            let (_, value) = line.split_once("REG_SZ")?;
            let value = value.trim();
            (!value.is_empty()).then(|| PathBuf::from(value))
        })
        .collect()
}

#[cfg(windows)]
fn registry(key: &str, value: Option<&str>) -> Vec<PathBuf> {
    let mut args = vec!["query", key, "/s"];
    if let Some(value) = value {
        args.extend(["/v", value]);
    }
    super::probe(Path::new("reg"), &args, Duration::from_secs(5))
        .map(|out| registry_paths(&out))
        .unwrap_or_default()
}

#[cfg(not(windows))]
fn registry(_key: &str, _value: Option<&str>) -> Vec<PathBuf> {
    Vec::new()
}

fn uproject(root: &Path) -> Option<PathBuf> {
    files_in(root).into_iter().find(|p| {
        p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("uproject"))
    })
}

fn read_uproject(path: &Path) -> Option<serde_json::Value> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

fn has_cpp(root: &Path) -> bool {
    root.join("Source").is_dir()
        || uproject(root)
            .and_then(|p| read_uproject(&p))
            .and_then(|v| {
                v.get("Modules")
                    .and_then(|m| m.as_array())
                    .map(|m| !m.is_empty())
            })
            .unwrap_or(false)
}

/// Visual Studio avec les outils C++ (nécessaire pour compiler un projet C++ Unreal).
pub fn visual_studio() -> Option<PathBuf> {
    let vswhere = env_dir("ProgramFiles(x86)")?
        .join("Microsoft Visual Studio")
        .join("Installer")
        .join("vswhere.exe");
    if !vswhere.is_file() {
        return None;
    }
    let out = super::probe(
        &vswhere,
        &[
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
        ],
        Duration::from_secs(10),
    )?;
    out.lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .map(PathBuf::from)
}

fn uat_platform(platform: GamePlatform) -> Option<&'static str> {
    Some(match platform {
        GamePlatform::Windows => "Win64",
        GamePlatform::Linux => "Linux",
        GamePlatform::Macos => "Mac",
        GamePlatform::Android => "Android",
        GamePlatform::Ios => "IOS",
        GamePlatform::Web | GamePlatform::Console => return None,
    })
}

fn batch(root: &Path, name: &str) -> PathBuf {
    let ext = if cfg!(windows) { "bat" } else { "sh" };
    root.join("Engine")
        .join("Build")
        .join("BatchFiles")
        .join(format!("{name}.{ext}"))
}

impl EngineAdapter for Unreal {
    fn engine(&self) -> GameEngine {
        GameEngine::Unreal
    }

    fn detect(&self, overrides: &[PathBuf]) -> (Vec<GameEngineInstall>, Vec<GameCheck>) {
        let mut installs: Vec<GameEngineInstall> = Vec::new();
        let mut checks = Vec::new();
        let add = |root: &Path, source: &str, installs: &mut Vec<GameEngineInstall>| {
            if let Some(install) = install_from(root, source) {
                if !installs
                    .iter()
                    .any(|i| i.root.eq_ignore_ascii_case(&install.root))
                {
                    installs.push(install);
                }
            }
        };
        for path in overrides {
            match root_from_override(path) {
                Some(root) => add(&root, "Chemin choisi", &mut installs),
                None => checks.push(check(
                    format!("Chemin choisi : {}", display(path)),
                    false,
                    Some("Aucun dossier Engine/Build au-dessus de ce chemin.".to_string()),
                )),
            }
        }
        let launcher = env_dir("ProgramData").map(|d| {
            d.join("Epic")
                .join("UnrealEngineLauncher")
                .join("LauncherInstalled.dat")
        });
        let from_launcher = launcher
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|raw| launcher_locations(&raw))
            .unwrap_or_default();
        checks.push(check(
            "Epic Games Launcher (LauncherInstalled.dat)",
            !from_launcher.is_empty(),
            Some(match &launcher {
                Some(p) if p.is_file() => format!("{} moteur(s) déclaré(s).", from_launcher.len()),
                Some(p) => format!("Fichier absent : {}", display(p)),
                None => "Variable ProgramData absente.".to_string(),
            }),
        ));
        for root in from_launcher {
            add(&root, "Epic Games Launcher", &mut installs);
        }
        let from_registry = registry(
            r"HKLM\SOFTWARE\EpicGames\Unreal Engine",
            Some("InstalledDirectory"),
        );
        let builds = registry(r"HKCU\Software\Epic Games\Unreal Engine\Builds", None);
        if cfg!(windows) {
            checks.push(check(
                "Registre Windows (moteurs installés et compilés)",
                !(from_registry.is_empty() && builds.is_empty()),
                None,
            ));
        }
        for root in from_registry {
            add(&root, "Registre Windows", &mut installs);
        }
        for root in builds {
            add(&root, "Moteur compilé depuis les sources", &mut installs);
        }
        for var in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(pf) = env_dir(var) {
                for dir in subdirs(&pf.join("Epic Games")) {
                    if dir
                        .file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("UE_"))
                    {
                        add(&dir, "Program Files", &mut installs);
                    }
                }
            }
        }
        installs.sort_by(|a, b| {
            super::godot::version_key(b.version.as_deref())
                .cmp(&super::godot::version_key(a.version.as_deref()))
        });
        (installs, checks)
    }

    fn is_project(&self, root: &Path) -> bool {
        uproject(root).is_some()
    }

    fn inspect(&self, root: &Path) -> Option<EngineProject> {
        let file = uproject(root)?;
        let value = read_uproject(&file).unwrap_or(serde_json::Value::Null);
        let association = value
            .get("EngineAssociation")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .filter(|v| !v.is_empty());
        let plugins = value
            .get("Plugins")
            .and_then(|p| p.as_array())
            .map(|list| {
                list.iter()
                    .filter(|p| p.get("Enabled").and_then(|e| e.as_bool()).unwrap_or(false))
                    .filter_map(|p| p.get("Name").and_then(|n| n.as_str()).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let mut languages = vec!["Blueprints".to_string()];
        if has_cpp(root) {
            languages.push("C++".to_string());
        }
        let main_scene = std::fs::read_to_string(root.join("Config").join("DefaultEngine.ini"))
            .ok()
            .and_then(|text| {
                text.lines().find_map(|l| {
                    l.trim()
                        .strip_prefix("GameDefaultMap=")
                        .map(|v| v.trim().to_string())
                })
            });
        Some(EngineProject {
            name: file
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default(),
            engine_version: association,
            main_scene,
            languages,
            packages: plugins,
        })
    }

    fn create(&self, spec: &NewProject, install: Option<&GameEngineInstall>) -> AppResult<Created> {
        ensure_empty_dir(&spec.dir)?;
        let root = spec.dir.as_path();
        let mut created = Created::default();
        let module = super::code_name(&spec.name);
        let association = install
            .and_then(|i| i.version.as_deref())
            .map(|v| v.split('.').take(2).collect::<Vec<_>>().join("."))
            .unwrap_or_else(|| "5.4".to_string());
        let mut uproject = serde_json::json!({
            "FileVersion": 3,
            "EngineAssociation": association,
            "Category": "",
            "Description": spec.description.chars().take(240).collect::<String>(),
            "Plugins": [
                { "Name": "PythonScriptPlugin", "Enabled": true },
                { "Name": "EditorScriptingUtilities", "Enabled": true }
            ]
        });
        if spec.cpp {
            uproject["Modules"] = serde_json::json!([{ "Name": module, "Type": "Runtime", "LoadingPhase": "Default" }]);
        }
        let body = serde_json::to_string_pretty(&uproject)?;
        write_file(
            root,
            &format!("{module}.uproject"),
            &format!("{body}\n"),
            &mut created,
        )?;
        write_file(
            root,
            "Config/DefaultEngine.ini",
            "; Écrit par Game Studio (ARCHIMED).\n[/Script/EngineSettings.GameMapsSettings]\nGameDefaultMap=/Engine/Maps/Templates/Template_Default\nEditorStartupMap=/Engine/Maps/Templates/Template_Default\n\n[/Script/Engine.RendererSettings]\nr.DefaultFeature.AutoExposure=False\n",
            &mut created,
        )?;
        write_file(
            root,
            "Config/DefaultGame.ini",
            &format!(
                "[/Script/EngineSettings.GeneralProjectSettings]\nProjectName={}\nDescription={}\n",
                spec.name.replace(['\n', '\r'], " "),
                spec.description
                    .chars()
                    .take(240)
                    .collect::<String>()
                    .replace(['\n', '\r'], " ")
            ),
            &mut created,
        )?;
        keep_dir(root, "Content/Game", &mut created)?;
        keep_dir(root, "Content/Game/Generated", &mut created)?;
        keep_dir(root, "RawArt", &mut created)?;
        if spec.cpp {
            let modern = !association.starts_with("5.0");
            let include_order = if modern {
                "\t\tIncludeOrderVersion = EngineIncludeOrderVersion.Latest;\n"
            } else {
                ""
            };
            for (suffix, kind) in [("", "Game"), ("Editor", "Editor")] {
                write_file(
                    root,
                    &format!("Source/{module}{suffix}.Target.cs"),
                    &format!(
                        "using UnrealBuildTool;\n\npublic class {module}{suffix}Target : TargetRules\n{{\n\tpublic {module}{suffix}Target(TargetInfo Target) : base(Target)\n\t{{\n\t\tType = TargetType.{kind};\n\t\tDefaultBuildSettings = BuildSettingsVersion.Latest;\n{include_order}\t\tExtraModuleNames.Add(\"{module}\");\n\t}}\n}}\n"
                    ),
                    &mut created,
                )?;
            }
            write_file(
                root,
                &format!("Source/{module}/{module}.Build.cs"),
                &format!(
                    "using UnrealBuildTool;\n\npublic class {module} : ModuleRules\n{{\n\tpublic {module}(ReadOnlyTargetRules Target) : base(Target)\n\t{{\n\t\tPCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;\n\t\tPublicDependencyModuleNames.AddRange(new string[] {{ \"Core\", \"CoreUObject\", \"Engine\", \"InputCore\", \"EnhancedInput\" }});\n\t}}\n}}\n"
                ),
                &mut created,
            )?;
            write_file(
                root,
                &format!("Source/{module}/{module}.h"),
                "#pragma once\n\n#include \"CoreMinimal.h\"\n",
                &mut created,
            )?;
            write_file(
                root,
                &format!("Source/{module}/{module}.cpp"),
                &format!("#include \"{module}.h\"\n#include \"Modules/ModuleManager.h\"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, {module}, \"{module}\");\n"),
                &mut created,
            )?;
            created.notes.push("Module C++ écrit : la première préparation compile l'éditeur du projet (Visual Studio avec les outils C++ requis).".to_string());
        }
        write_file(root, ".gitignore", GITIGNORE, &mut created)?;
        created.notes.push(format!(
            "Projet Unreal {} écrit ({module}.uproject). Les cartes et Blueprints se créent dans l'éditeur, par scripts Python d'éditeur ou par un serveur MCP Unreal.",
            if spec.cpp { "C++ et Blueprints" } else { "Blueprints" }
        ));
        if install.is_none() {
            created.notes.push("Unreal Engine n'est pas installé : installez-le depuis l'Epic Games Launcher (version 5.4 ou plus).".to_string());
        }
        Ok(created)
    }

    fn capabilities(
        &self,
        root: Option<&Path>,
        install: Option<&GameEngineInstall>,
    ) -> Vec<GameCapability> {
        let editor = install.is_some();
        let cpp = root.is_some_and(has_cpp);
        let compiler = if cpp {
            Some(visual_studio().is_some())
        } else {
            None
        };
        let source = install.map(|i| is_source_build(Path::new(&i.root)));
        let python = root
            .and_then(uproject)
            .and_then(|p| read_uproject(&p))
            .and_then(|v| v.get("Plugins").and_then(|p| p.as_array()).cloned())
            .is_some_and(|list| {
                list.iter().any(|p| {
                    p.get("Name").and_then(|n| n.as_str()) == Some("PythonScriptPlugin")
                        && p.get("Enabled").and_then(|e| e.as_bool()) == Some(true)
                })
            });
        vec![
            capability(
                "create",
                "Créer un projet (Blueprints ou C++)",
                GameCapabilityVia::Files,
                None,
                Some(true),
                Some(".uproject, Config/*.ini et module C++ sont des fichiers texte.".to_string()),
            ),
            capability(
                "inspect",
                "Lire le projet (version, extensions, carte de départ)",
                GameCapabilityVia::Files,
                None,
                Some(true),
                None,
            ),
            capability(
                "cpp",
                "Écrire et compiler le code C++",
                GameCapabilityVia::Cli,
                Some("Visual Studio avec les outils C++"),
                compiler.or(Some(false)),
                None,
            ),
            capability(
                "blueprints",
                "Vérifier les Blueprints",
                GameCapabilityVia::Cli,
                Some("Unreal installé"),
                Some(editor),
                Some("UnrealEditor-Cmd -run=CompileAllBlueprints".to_string()),
            ),
            capability(
                "editor_python",
                "Automatiser l'éditeur (import d'assets, cartes)",
                GameCapabilityVia::Cli,
                Some("Extension Python Editor Script activée"),
                Some(editor && python),
                None,
            ),
            capability(
                "levels",
                "Créer des cartes et des Blueprints",
                GameCapabilityVia::Mcp,
                Some("Serveur MCP Unreal connecté, ou script Python d'éditeur"),
                None,
                Some("Les .umap et .uasset sont binaires : pas d'écriture directe.".to_string()),
            ),
            capability(
                "test",
                "Tests d'automatisation",
                GameCapabilityVia::Cli,
                Some("Unreal installé"),
                Some(editor),
                None,
            ),
            capability(
                "build",
                "Empaqueter le jeu (BuildCookRun)",
                GameCapabilityVia::Cli,
                Some("Unreal installé ; Visual Studio pour un projet C++"),
                Some(editor && compiler.unwrap_or(true)),
                None,
            ),
            capability(
                "dedicated_server",
                "Build de serveur dédié",
                GameCapabilityVia::Cli,
                Some("Moteur compilé depuis les sources (GitHub d'Epic)"),
                source.or(Some(false)),
                None,
            ),
            capability(
                "run",
                "Lancer le jeu",
                GameCapabilityVia::Cli,
                Some("Unreal installé"),
                Some(editor),
                None,
            ),
            capability(
                "editor",
                "Ouvrir l'éditeur",
                GameCapabilityVia::Cli,
                Some("Unreal installé"),
                Some(editor),
                None,
            ),
        ]
    }

    fn command(&self, action: GameAction, ctx: &ActionContext) -> AppResult<CommandSpec> {
        let root = ctx.root.to_path_buf();
        let file = uproject(ctx.root).ok_or_else(|| {
            AppError::not_found("Aucun fichier .uproject dans le dossier du projet.")
        })?;
        let project = display(&file);
        let engine = PathBuf::from(&ctx.install.root);
        let module = file
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let cpp = has_cpp(ctx.root);
        let console = ctx
            .install
            .console
            .clone()
            .unwrap_or_else(|| ctx.install.editor.clone());
        let spec = |program: PathBuf, args: Vec<String>, timeout: Option<u64>, detached: bool| {
            CommandSpec {
                program,
                args,
                cwd: root.clone(),
                timeout: timeout.map(Duration::from_secs),
                output: None,
                success_marker: None,
                detached,
            }
        };
        let compile_editor = || {
            spec(
                batch(&engine, "Build"),
                vec![
                    format!("{module}Editor"),
                    "Win64".into(),
                    "Development".into(),
                    format!("-Project={project}"),
                    "-WaitMutex".into(),
                    "-NoHotReloadFromIDE".into(),
                ],
                Some(7200),
                false,
            )
        };
        Ok(match action {
            GameAction::Setup | GameAction::Check if cpp => {
                if cfg!(windows) && visual_studio().is_none() {
                    return Err(AppError::invalid(
                        "Ce projet contient du C++ : installez Visual Studio 2022 avec la charge de travail « Développement de jeux en C++ », puis relancez.",
                    ));
                }
                compile_editor()
            }
            GameAction::Setup => {
                return Err(AppError::invalid("Projet Blueprint : rien à compiler. Ouvrez l'éditeur pour préparer les shaders, ou lancez une vérification."));
            }
            GameAction::Check => spec(
                PathBuf::from(&console),
                vec![
                    project,
                    "-run=CompileAllBlueprints".into(),
                    "-unattended".into(),
                    "-nopause".into(),
                    "-nosplash".into(),
                    "-nullrhi".into(),
                    "-stdout".into(),
                    "-FullStdOutLogOutput".into(),
                ],
                Some(3600),
                false,
            ),
            GameAction::Test => spec(
                PathBuf::from(&console),
                vec![
                    project,
                    format!("-ExecCmds=Automation RunTests {module}; Quit"),
                    "-testexit=Automation Test Queue Empty".into(),
                    "-unattended".into(),
                    "-nopause".into(),
                    "-nosplash".into(),
                    "-nullrhi".into(),
                    "-stdout".into(),
                    "-FullStdOutLogOutput".into(),
                ],
                Some(3600),
                false,
            ),
            GameAction::Build => {
                let platform = uat_platform(ctx.platform)
                    .ok_or_else(|| AppError::invalid("Unreal 5 n'exporte ni vers le web, ni vers les consoles sans les kits des constructeurs."))?;
                let folder = ctx.root.join("Build").join(platform.to_lowercase());
                let mut args = vec![
                    "BuildCookRun".to_string(),
                    format!("-project={project}"),
                    "-noP4".into(),
                    format!("-platform={platform}"),
                    format!(
                        "-clientconfig={}",
                        if ctx.development {
                            "Development"
                        } else {
                            "Shipping"
                        }
                    ),
                    "-cook".into(),
                    "-stage".into(),
                    "-pak".into(),
                    "-archive".into(),
                    format!("-archivedirectory={}", display(&folder)),
                    "-utf8output".into(),
                    "-unattended".into(),
                ];
                if cpp {
                    args.push("-build".into());
                }
                let mut s = spec(batch(&engine, "RunUAT"), args, Some(4 * 3600), false);
                s.output = Some(folder);
                s
            }
            GameAction::Run => spec(
                PathBuf::from(&ctx.install.editor),
                vec![
                    project,
                    "-game".into(),
                    "-log".into(),
                    "-windowed".into(),
                    "-ResX=1280".into(),
                    "-ResY=720".into(),
                ],
                None,
                true,
            ),
            GameAction::Editor => spec(
                PathBuf::from(&ctx.install.editor),
                vec![project],
                None,
                true,
            ),
        })
    }

    fn gitignore(&self) -> &'static str {
        GITIGNORE
    }

    fn ignored_dirs(&self) -> &'static [&'static str] {
        &[
            "Binaries",
            "DerivedDataCache",
            "Intermediate",
            "Saved",
            "Build",
            ".vs",
        ]
    }

    fn asset_dir(&self) -> &'static str {
        "RawArt"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::types::GameDimension;

    #[test]
    fn reads_launcher_and_registry_listings() {
        let raw = r#"{"InstallationList":[{"InstallLocation":"C:\\Program Files\\Epic Games\\UE_5.4","AppName":"UE_5.4","AppVersion":"5.4.4"},{"InstallLocation":"C:\\Games\\Fortnite","AppName":"Fortnite"}]}"#;
        assert_eq!(
            launcher_locations(raw),
            vec![PathBuf::from("C:\\Program Files\\Epic Games\\UE_5.4")]
        );
        let reg = "HKEY_LOCAL_MACHINE\\SOFTWARE\\EpicGames\\Unreal Engine\\5.4\n    InstalledDirectory    REG_SZ    C:\\Program Files\\Epic Games\\UE_5.4\n";
        assert_eq!(
            registry_paths(reg),
            vec![PathBuf::from("C:\\Program Files\\Epic Games\\UE_5.4")]
        );
    }

    fn fake_engine(dir: &Path) -> GameEngineInstall {
        std::fs::create_dir_all(dir.join("Engine/Build")).unwrap();
        std::fs::write(
            dir.join("Engine/Build/Build.version"),
            r#"{"MajorVersion":5,"MinorVersion":4,"PatchVersion":4}"#,
        )
        .unwrap();
        std::fs::write(dir.join("Engine/Build/InstalledBuild.txt"), "").unwrap();
        let bin = binaries_dir(dir);
        std::fs::create_dir_all(&bin).unwrap();
        let ext = if cfg!(windows) { ".exe" } else { "" };
        std::fs::write(bin.join(format!("UnrealEditor{ext}")), "").unwrap();
        std::fs::write(bin.join(format!("UnrealEditor-Cmd{ext}")), "").unwrap();
        install_from(dir, "test").unwrap()
    }

    #[test]
    fn creates_blueprint_and_cpp_projects() {
        let base = std::env::temp_dir().join(format!("gs-unreal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let install = fake_engine(&base.join("UE_5.4"));
        assert_eq!(install.version.as_deref(), Some("5.4.4"));
        assert!(!is_source_build(Path::new(&install.root)));

        let dir = base.join("Chasse");
        let spec = NewProject {
            name: "Chasse aux étoiles".to_string(),
            dir: dir.clone(),
            dimension: GameDimension::ThreeD,
            description: "Test".to_string(),
            targets: vec![],
            cpp: true,
        };
        let created = Unreal.create(&spec, Some(&install)).unwrap();
        assert!(created
            .files
            .iter()
            .any(|f| f == "ChasseAuxEtoiles.uproject"));
        assert!(created
            .files
            .iter()
            .any(|f| f == "Source/ChasseAuxEtoiles/ChasseAuxEtoiles.Build.cs"));
        let project = Unreal.inspect(&dir).unwrap();
        assert_eq!(project.engine_version.as_deref(), Some("5.4"));
        assert!(project.languages.contains(&"C++".to_string()));
        assert!(project.packages.contains(&"PythonScriptPlugin".to_string()));

        let ctx = ActionContext {
            root: &dir,
            project: &project,
            install: &install,
            platform: GamePlatform::Windows,
            development: false,
        };
        let build = Unreal.command(GameAction::Build, &ctx).unwrap();
        assert_eq!(build.args[0], "BuildCookRun");
        assert!(build.args.contains(&"-build".to_string()));
        assert!(build.args.contains(&"-clientconfig=Shipping".to_string()));
        let web = ActionContext {
            platform: GamePlatform::Web,
            ..ctx.clone()
        };
        assert!(Unreal.command(GameAction::Build, &web).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
