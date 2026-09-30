//! Adaptateur Godot 4.
//!
//! Vérifié avec Godot 4.4.1 (linux x86_64) le 2026-09-30 :
//! - `--version` → `4.4.1.stable.official.49a5bc7b6` ;
//! - `--headless --path <p> --import` importe et analyse les scripts, mais sort avec 0 même
//!   s'ils ont des erreurs, et ne les revérifie plus ensuite : la vérification passe donc par
//!   `.gamestudio/godot/check_scripts.gd` (`--script`), qui charge chaque script et sort avec
//!   le nombre d'échecs ;
//! - `--script res://tests/smoke_test.gd` : test de démarrage (marqueur `GAMESTUDIO_SMOKE_OK`) ;
//! - `--export-release "<preset>" <chemin>` : une section `[preset.N.options]` vide est ignorée
//!   (« nonexistent section ») ; sans modèles d'export, message « No export template found at
//!   the expected path: …/export_templates/4.4.1.stable/… ».
//!
//! Sous Windows, l'exécutable graphique ne rend pas sa sortie à la console : on utilise la
//! variante `_console.exe` quand elle existe.

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::core::{AppError, AppResult};

use super::{
    capability, check, display, ensure_empty_dir, env_dir, files_in, first_existing, home,
    keep_dir, probe, quote, subdirs, write_file, ActionContext, CommandSpec, Created,
    EngineAdapter, EngineProject, GameAction, NewProject,
};
use crate::modules::game_studio::types::{
    GameCapability, GameCapabilityVia, GameCheck, GameDimension, GameEngine, GameEngineInstall,
    GamePlatform,
};

pub struct Godot;

/// Script de vérification déposé dans le projet (dossier caché, ignoré par Godot).
pub const CHECK_SCRIPT: &str = ".gamestudio/godot/check_scripts.gd";
pub const SMOKE_TEST: &str = "tests/smoke_test.gd";
pub const SMOKE_MARKER: &str = "GAMESTUDIO_SMOKE_OK";

const CHECK_SCRIPT_BODY: &str = r#"extends SceneTree
## Vérification de Game Studio (ARCHIMED) : charge chaque script GDScript du projet (analyse
## complète) et quitte avec le nombre de scripts en erreur (0 = tout est valide).
## Réécrit avant chaque vérification ; ne pas modifier.

func _initialize() -> void:
	var failures := 0
	var checked := 0
	for path in _scripts("res://"):
		checked += 1
		var script := ResourceLoader.load(path, "GDScript", ResourceLoader.CACHE_MODE_IGNORE) as GDScript
		if script == null or not script.can_instantiate():
			failures += 1
			printerr("GAMESTUDIO_SCRIPT_FAILED %s" % path)
	print("GAMESTUDIO_CHECK checked=%d failed=%d" % [checked, failures])
	quit(1 if failures > 0 else 0)

func _scripts(dir: String) -> PackedStringArray:
	var out := PackedStringArray()
	for sub in DirAccess.get_directories_at(dir):
		if sub.begins_with(".") or sub == "addons":
			continue
		out.append_array(_scripts(dir.path_join(sub)))
	for file in DirAccess.get_files_at(dir):
		if file.get_extension() == "gd":
			out.append(dir.path_join(file))
	return out
"#;

const SMOKE_TEST_BODY: &str = r#"extends SceneTree
## Test de démarrage lancé par Game Studio : charge la scène principale, la fait tourner
## quelques images, puis quitte. Code 0 et marqueur GAMESTUDIO_SMOKE_OK = réussi.

const FRAMES := 120
var _frames := 0

func _initialize() -> void:
	var path: String = ProjectSettings.get_setting("application/run/main_scene", "")
	if path.is_empty():
		push_error("Aucune scène principale (application/run/main_scene).")
		quit(1)
		return
	var packed := load(path) as PackedScene
	if packed == null:
		push_error("Scène principale illisible : %s" % path)
		quit(1)
		return
	root.add_child(packed.instantiate())

func _process(_delta: float) -> bool:
	_frames += 1
	if _frames >= FRAMES:
		print("GAMESTUDIO_SMOKE_OK frames=%d" % _frames)
		quit(0)
	return false
"#;

const GITIGNORE: &str = "# Godot 4 (Game Studio)\n.godot/\n/android/\n/build/\n# Données locales de Game Studio (journaux, builds, caches)\n.gamestudio/logs/\n.gamestudio/builds/\n.gamestudio/cache/\n";

/// Nom de la préréglage d'export d'une plateforme (Godot 4.3 et suivants).
pub fn preset_name(platform: GamePlatform) -> Option<&'static str> {
    Some(match platform {
        GamePlatform::Windows => "Windows Desktop",
        GamePlatform::Linux => "Linux",
        GamePlatform::Macos => "macOS",
        GamePlatform::Web => "Web",
        GamePlatform::Android => "Android",
        GamePlatform::Ios => "iOS",
        GamePlatform::Console => return None,
    })
}

/// Fichier produit par un export, relatif au projet.
fn export_path(platform: GamePlatform, code: &str) -> Option<String> {
    Some(match platform {
        GamePlatform::Windows => format!("build/windows/{code}.exe"),
        GamePlatform::Linux => format!("build/linux/{code}.x86_64"),
        GamePlatform::Macos => format!("build/macos/{code}.zip"),
        GamePlatform::Web => "build/web/index.html".to_string(),
        GamePlatform::Android => format!("build/android/{code}.apk"),
        GamePlatform::Ios => format!("build/ios/{code}.ipa"),
        GamePlatform::Console => return None,
    })
}

/// Modèle d'export release attendu pour une plateforme.
fn template_file(platform: GamePlatform) -> Option<&'static str> {
    Some(match platform {
        GamePlatform::Windows => "windows_release_x86_64.exe",
        GamePlatform::Linux => "linux_release.x86_64",
        GamePlatform::Macos => "macos.zip",
        GamePlatform::Web => "web_nothreads_release.zip",
        GamePlatform::Android => "android_release.apk",
        GamePlatform::Ios => "ios.zip",
        GamePlatform::Console => return None,
    })
}

/// `4.4.1.stable.official.49a5bc7b6` → `4.4.1.stable` (dossier des modèles d'export) ;
/// les versions .NET gardent `.mono`.
pub fn templates_version(version: &str) -> String {
    let parts: Vec<&str> = version.split('.').collect();
    let mut out: Vec<&str> = Vec::new();
    for part in &parts {
        out.push(part);
        if !part.chars().all(|c| c.is_ascii_digit()) {
            break;
        }
    }
    let mut text = out.join(".");
    if parts.contains(&"mono") {
        text.push_str(".mono");
    }
    text
}

/// Dossier des modèles d'export de Godot.
pub fn templates_dir(version: &str) -> Option<PathBuf> {
    let base = if cfg!(windows) {
        env_dir("APPDATA")?.join("Godot")
    } else if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support/Godot")
    } else {
        env_dir("XDG_DATA_HOME")
            .unwrap_or(home()?.join(".local/share"))
            .join("godot")
    };
    Some(
        base.join("export_templates")
            .join(templates_version(version)),
    )
}

/// Version lue dans un nom de fichier officiel : `Godot_v4.4.1-stable_win64.exe` → `4.4.1.stable`.
fn version_from_name(name: &str) -> Option<String> {
    let rest = name.strip_prefix("Godot_v")?;
    let version = rest.split('_').next()?;
    let mut text = version.replace('-', ".");
    if name.contains("_mono") {
        text.push_str(".mono");
    }
    Some(text)
}

fn is_godot_binary(path: &Path) -> bool {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    (name.starts_with("godot") || name == "godot.windows.opt.tools.64.exe")
        && !name.contains("console")
        && (name.ends_with(".exe") || !cfg!(windows))
        && !name.ends_with(".zip")
        && !name.ends_with(".pck")
}

/// Variante console d'un exécutable Windows (`X.exe` → `X_console.exe`).
fn console_variant(editor: &Path) -> Option<PathBuf> {
    let stem = editor.file_stem()?.to_string_lossy().to_string();
    let candidate = editor.with_file_name(format!("{stem}_console.exe"));
    candidate.is_file().then_some(candidate)
}

fn install_from(path: &Path, source: &str) -> Option<GameEngineInstall> {
    if !path.is_file() {
        return None;
    }
    let console = console_variant(path);
    let name = path.file_name()?.to_string_lossy().to_string();
    // La variante console (ou le binaire lui-même hors Windows) donne la version exacte.
    let version = console
        .as_deref()
        .or((!cfg!(windows)).then_some(path))
        .and_then(|bin| probe(bin, &["--version"], Duration::from_secs(8)))
        .and_then(|out| {
            out.lines()
                .rev()
                .find(|l| l.chars().next().is_some_and(|c| c.is_ascii_digit()))
                .map(|l| l.trim().to_string())
        })
        .or_else(|| version_from_name(&name));
    Some(GameEngineInstall {
        engine: GameEngine::Godot,
        version,
        editor: display(path),
        console: console.as_deref().map(display),
        root: path.parent().map(display).unwrap_or_default(),
        source: source.to_string(),
    })
}

/// Exécutables Godot d'un dossier et de ses sous-dossiers directs (archives décompressées).
fn scan_folder(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = files_in(dir)
        .into_iter()
        .filter(|p| is_godot_binary(p))
        .collect();
    for sub in subdirs(dir) {
        let name = sub
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if name.contains("godot") {
            out.extend(files_in(&sub).into_iter().filter(|p| is_godot_binary(p)));
        }
    }
    out
}

fn known_locations() -> Vec<(PathBuf, &'static str)> {
    let mut out: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Some(local) = env_dir("LOCALAPPDATA") {
        // winget : Packages\GodotEngine.GodotEngine_…\Godot_v4…_win64.exe
        for package in subdirs(&local.join("Microsoft").join("WinGet").join("Packages")) {
            let name = package
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            if name.starts_with("GodotEngine.") {
                out.extend(scan_folder(&package).into_iter().map(|p| (p, "winget")));
            }
        }
        out.extend(
            scan_folder(&local.join("Programs").join("Godot"))
                .into_iter()
                .map(|p| (p, "Programmes")),
        );
    }
    if let Some(home) = home() {
        if let Some(p) = first_existing([home.join("scoop/apps/godot/current/godot.exe")]) {
            out.push((p, "Scoop"));
        }
        for folder in [
            "Downloads",
            "Téléchargements",
            "Desktop",
            "Bureau",
            "Documents",
            "Applications",
            "Games",
        ] {
            out.extend(
                scan_folder(&home.join(folder))
                    .into_iter()
                    .map(|p| (p, "Dossier personnel")),
            );
        }
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(pf) = env_dir(var) {
            out.extend(
                scan_folder(&pf.join("Godot"))
                    .into_iter()
                    .map(|p| (p, "Program Files")),
            );
            let steam = pf
                .join("Steam")
                .join("steamapps")
                .join("common")
                .join("Godot Engine");
            out.extend(
                files_in(&steam)
                    .into_iter()
                    .filter(|p| is_godot_binary(p))
                    .map(|p| (p, "Steam")),
            );
        }
    }
    if let Some(data) = env_dir("ProgramData") {
        if let Some(p) = first_existing([data.join("chocolatey").join("bin").join("godot.exe")]) {
            out.push((p, "Chocolatey"));
        }
    }
    for name in ["godot", "godot4", "Godot"] {
        if let Ok(path) = which::which(name) {
            out.push((path, "PATH"));
        }
    }
    out
}

fn read_project_file(root: &Path) -> Option<String> {
    std::fs::read_to_string(root.join("project.godot")).ok()
}

/// Valeur d'une clé de `project.godot` (`config/name="X"` → `X`).
fn value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let rest = line
            .trim()
            .strip_prefix(key)?
            .trim_start()
            .strip_prefix('=')?;
        Some(rest.trim().trim_matches('"').to_string())
    })
}

fn presets(targets: &[GamePlatform], code: &str) -> String {
    let mut out = String::from("; Préréglages d'export écrits par Game Studio (ARCHIMED).\n; Les modèles d'export de Godot doivent être installés (Éditeur > Gérer les modèles d'export).\n");
    let mut index = 0;
    let mut platforms: Vec<GamePlatform> = targets.to_vec();
    if !platforms.contains(&GamePlatform::Windows) {
        platforms.insert(0, GamePlatform::Windows);
    }
    for platform in platforms {
        let (Some(name), Some(path)) = (preset_name(platform), export_path(platform, code)) else {
            continue;
        };
        let option = match platform {
            GamePlatform::Web => "variant/extensions_support=false",
            GamePlatform::Android => "gradle_build/use_gradle_build=false",
            GamePlatform::Macos | GamePlatform::Ios => {
                "application/bundle_identifier=\"com.example.game\""
            }
            _ => "binary_format/embed_pck=false",
        };
        out.push_str(&format!(
            "\n[preset.{index}]\n\nname=\"{name}\"\nplatform=\"{name}\"\nrunnable=true\nexport_filter=\"all_resources\"\ninclude_filter=\"\"\nexclude_filter=\".gamestudio/*, tests/*\"\nexport_path=\"{path}\"\n\n[preset.{index}.options]\n\n{option}\n"
        ));
        index += 1;
    }
    out
}

impl EngineAdapter for Godot {
    fn engine(&self) -> GameEngine {
        GameEngine::Godot
    }

    fn detect(&self, overrides: &[PathBuf]) -> (Vec<GameEngineInstall>, Vec<GameCheck>) {
        let mut checks = Vec::new();
        let mut installs: Vec<GameEngineInstall> = Vec::new();
        let push = |install: GameEngineInstall, installs: &mut Vec<GameEngineInstall>| {
            if !installs
                .iter()
                .any(|i| i.editor.eq_ignore_ascii_case(&install.editor))
            {
                installs.push(install);
            }
        };
        for path in overrides {
            match install_from(path, "Chemin choisi") {
                Some(install) => push(install, &mut installs),
                None => checks.push(check(
                    format!("Chemin choisi : {}", display(path)),
                    false,
                    Some("Fichier introuvable.".to_string()),
                )),
            }
        }
        let found = known_locations();
        checks.push(check(
            "Emplacements connus (PATH, winget, Scoop, Steam, Program Files, Téléchargements, Bureau)",
            !found.is_empty(),
            Some(if found.is_empty() {
                "Aucun exécutable Godot trouvé.".to_string()
            } else {
                format!("{} exécutable(s) trouvé(s).", found.len())
            }),
        ));
        for (path, source) in found {
            if let Some(install) = install_from(&path, source) {
                push(install, &mut installs);
            }
        }
        installs.sort_by(|a, b| {
            version_key(b.version.as_deref()).cmp(&version_key(a.version.as_deref()))
        });
        (installs, checks)
    }

    fn is_project(&self, root: &Path) -> bool {
        root.join("project.godot").is_file()
    }

    fn inspect(&self, root: &Path) -> Option<EngineProject> {
        let text = read_project_file(root)?;
        let features = value(&text, "config/features").unwrap_or_default();
        let version = features
            .split('"')
            .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .map(str::to_string);
        let mut languages = vec!["GDScript".to_string()];
        if files_in(root)
            .iter()
            .any(|p| p.extension().is_some_and(|e| e == "csproj"))
            || features.contains("C#")
        {
            languages.push("C#".to_string());
        }
        let packages = subdirs(&root.join("addons"))
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        Some(EngineProject {
            name: value(&text, "config/name").unwrap_or_else(|| {
                root.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default()
            }),
            engine_version: version,
            main_scene: value(&text, "run/main_scene"),
            languages,
            packages,
        })
    }

    fn create(&self, spec: &NewProject, install: Option<&GameEngineInstall>) -> AppResult<Created> {
        ensure_empty_dir(&spec.dir)?;
        let root = spec.dir.as_path();
        let mut created = Created::default();
        let code = super::code_name(&spec.name);
        let feature = install
            .and_then(|i| i.version.as_deref())
            .map(|v| v.split('.').take(2).collect::<Vec<_>>().join("."))
            .filter(|v| v.starts_with('4'))
            .unwrap_or_else(|| "4.4".to_string());
        let two_d = spec.dimension == GameDimension::TwoD;
        let (method, feature_name) = if two_d || spec.targets.contains(&GamePlatform::Web) {
            ("gl_compatibility", "GL Compatibility")
        } else if spec
            .targets
            .iter()
            .any(|t| matches!(t, GamePlatform::Android | GamePlatform::Ios))
        {
            ("mobile", "Mobile")
        } else {
            ("forward_plus", "Forward Plus")
        };
        let mut project = format!(
            "; Configuration du moteur Godot, écrite par Game Studio (ARCHIMED).\n\nconfig_version=5\n\n[application]\n\nconfig/name=\"{}\"\nconfig/description=\"{}\"\nrun/main_scene=\"res://scenes/main.tscn\"\nconfig/features=PackedStringArray(\"{feature}\", \"{feature_name}\")\nconfig/icon=\"res://icon.svg\"\n",
            quote(&spec.name),
            quote(&spec.description.chars().take(240).collect::<String>()),
        );
        if two_d {
            project.push_str("\n[display]\n\nwindow/stretch/mode=\"canvas_items\"\n");
        }
        project.push_str(&format!(
            "\n[rendering]\n\nrenderer/rendering_method=\"{method}\"\n"
        ));
        if two_d {
            project.push_str("textures/canvas_textures/default_texture_filter=0\n");
        }
        write_file(root, "project.godot", &project, &mut created)?;
        write_file(root, "icon.svg", ICON, &mut created)?;

        let (base, scene) = if two_d {
            (
                "Node2D",
                "[gd_scene load_steps=2 format=3]\n\n[ext_resource type=\"Script\" path=\"res://scripts/main.gd\" id=\"1\"]\n\n[node name=\"Main\" type=\"Node2D\"]\nscript = ExtResource(\"1\")\n\n[node name=\"Camera2D\" type=\"Camera2D\" parent=\".\"]\n".to_string(),
            )
        } else {
            (
                "Node3D",
                "[gd_scene load_steps=2 format=3]\n\n[ext_resource type=\"Script\" path=\"res://scripts/main.gd\" id=\"1\"]\n\n[node name=\"Main\" type=\"Node3D\"]\nscript = ExtResource(\"1\")\n\n[node name=\"Camera3D\" type=\"Camera3D\" parent=\".\"]\ntransform = Transform3D(1, 0, 0, 0, 0.94, 0.34, 0, -0.34, 0.94, 0, 3, 6)\n\n[node name=\"Sun\" type=\"DirectionalLight3D\" parent=\".\"]\ntransform = Transform3D(1, 0, 0, 0, 0.71, 0.71, 0, -0.71, 0.71, 0, 5, 0)\nshadow_enabled = true\n".to_string(),
            )
        };
        write_file(root, "scenes/main.tscn", &scene, &mut created)?;
        write_file(
            root,
            "scripts/main.gd",
            &format!(
                "extends {base}\n## Point d'entrée du jeu « {} », créé par Game Studio.\n\nfunc _ready() -> void:\n\tprint(\"{} : démarrage\")\n",
                spec.name.replace('"', "'"),
                quote(&spec.name),
            ),
            &mut created,
        )?;
        write_file(root, SMOKE_TEST, SMOKE_TEST_BODY, &mut created)?;
        write_file(root, CHECK_SCRIPT, CHECK_SCRIPT_BODY, &mut created)?;
        write_file(
            root,
            "export_presets.cfg",
            &presets(&spec.targets, &code),
            &mut created,
        )?;
        write_file(root, ".gitignore", GITIGNORE, &mut created)?;
        write_file(
            root,
            ".gitattributes",
            "# Normalise les fins de ligne (recommandation Godot).\n* text=auto eol=lf\n",
            &mut created,
        )?;
        for dir in [
            "assets/generated",
            "data",
            "scenes/levels",
            "scripts/systems",
            "ui",
            "audio",
        ] {
            keep_dir(root, dir, &mut created)?;
        }
        created.notes.push("Projet Godot 4 écrit : scène principale, script d'entrée, test de démarrage et préréglages d'export.".to_string());
        if spec.cpp {
            created.notes.push("C# demandé : ouvrez le projet avec la version .NET de Godot, qui crée la solution (Projet > Outils > C#).".to_string());
        }
        if install.is_none() {
            created.notes.push("Godot n'est pas encore installé : le projet s'ouvrira dès qu'il le sera (godotengine.org, version 4).".to_string());
        }
        Ok(created)
    }

    fn capabilities(
        &self,
        root: Option<&Path>,
        install: Option<&GameEngineInstall>,
    ) -> Vec<GameCapability> {
        let editor = install.is_some();
        let version = install.and_then(|i| i.version.clone());
        let templates = version.as_deref().and_then(templates_dir);
        let templates_ok = templates.as_ref().map(|dir| {
            dir.join("windows_release_x86_64.exe").is_file()
                || dir.join("linux_release.x86_64").is_file()
        });
        let addons = root.map(|r| subdirs(&r.join("addons"))).unwrap_or_default();
        let has_tests = addons.iter().any(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            name == "gut" || name == "gdunit4"
        });
        vec![
            capability("create", "Créer un projet", GameCapabilityVia::Files, None, Some(true), Some("project.godot, scènes .tscn et scripts .gd sont des fichiers texte documentés.".to_string())),
            capability("inspect", "Lire le projet, ses scènes et scripts", GameCapabilityVia::Files, None, Some(true), None),
            capability("scenes", "Modifier les scènes (.tscn)", GameCapabilityVia::Files, None, Some(true), Some("Format texte : modifiable sans l'éditeur, relu par Godot.".to_string())),
            capability("scripts", "Écrire le code (GDScript, C#)", GameCapabilityVia::Files, None, Some(true), None),
            capability("check", "Vérifier tous les scripts", GameCapabilityVia::Cli, Some("Godot 4 installé"), Some(editor), Some("--headless --script .gamestudio/godot/check_scripts.gd".to_string())),
            capability("run", "Lancer le jeu", GameCapabilityVia::Cli, Some("Godot 4 installé"), Some(editor), None),
            capability("smoke", "Test de démarrage automatique", GameCapabilityVia::Cli, Some("Godot 4 installé"), Some(editor), Some("tests/smoke_test.gd : charge la scène principale et fait tourner 120 images.".to_string())),
            capability("unit_tests", "Tests unitaires (GUT ou gdUnit4)", GameCapabilityVia::Cli, Some("Extension GUT ou gdUnit4 dans addons/"), Some(editor && has_tests), None),
            capability(
                "build",
                "Exporter un build",
                GameCapabilityVia::Cli,
                Some("Modèles d'export de la même version (Éditeur > Gérer les modèles d'export)"),
                if editor { templates_ok.or(Some(false)) } else { Some(false) },
                templates.map(|t| format!("Dossier attendu : {}", display(&t))),
            ),
            capability("editor", "Ouvrir l'éditeur", GameCapabilityVia::Cli, Some("Godot 4 installé"), Some(editor), None),
        ]
    }

    fn command(&self, action: GameAction, ctx: &ActionContext) -> AppResult<CommandSpec> {
        let root = ctx.root.to_path_buf();
        let console = ctx
            .install
            .console
            .as_deref()
            .unwrap_or(&ctx.install.editor);
        let path = display(&root);
        let spec = |program: &str, args: Vec<String>, timeout: Option<u64>| CommandSpec {
            program: PathBuf::from(program),
            args,
            cwd: root.clone(),
            timeout: timeout.map(Duration::from_secs),
            output: None,
            success_marker: None,
            detached: false,
        };
        Ok(match action {
            GameAction::Setup => {
                let mut args = vec![
                    "--headless".into(),
                    "--path".into(),
                    path,
                    "--import".into(),
                ];
                if ctx.project.languages.iter().any(|l| l == "C#") {
                    args.push("--build-solutions".into());
                }
                spec(console, args, Some(900))
            }
            GameAction::Check => {
                ensure_check_script(ctx.root)?;
                spec(
                    console,
                    vec![
                        "--headless".into(),
                        "--path".into(),
                        path,
                        "--script".into(),
                        format!("res://{CHECK_SCRIPT}"),
                    ],
                    Some(300),
                )
            }
            GameAction::Test => {
                if !ctx.root.join(SMOKE_TEST).is_file() {
                    std::fs::create_dir_all(ctx.root.join("tests"))?;
                    std::fs::write(ctx.root.join(SMOKE_TEST), SMOKE_TEST_BODY)?;
                }
                let mut s = spec(
                    console,
                    vec![
                        "--headless".into(),
                        "--path".into(),
                        path,
                        "--script".into(),
                        format!("res://{SMOKE_TEST}"),
                    ],
                    Some(300),
                );
                s.success_marker = Some(SMOKE_MARKER.to_string());
                s
            }
            GameAction::Run => {
                let mut s = spec(&ctx.install.editor, vec!["--path".into(), path], None);
                s.detached = true;
                s
            }
            GameAction::Editor => {
                let mut s = spec(
                    &ctx.install.editor,
                    vec!["--editor".into(), "--path".into(), path],
                    None,
                );
                s.detached = true;
                s
            }
            GameAction::Build => {
                let preset = preset_name(ctx.platform)
                    .ok_or_else(|| AppError::invalid("Godot n'exporte pas directement vers les consoles : passez par une société de portage."))?;
                let presets = std::fs::read_to_string(ctx.root.join("export_presets.cfg"))
                    .unwrap_or_default();
                if !presets.contains(&format!("name=\"{preset}\"")) {
                    return Err(AppError::invalid(format!(
                        "Aucun préréglage d'export « {preset} » dans export_presets.cfg : ajoutez-le dans Projet > Exporter, ou demandez-le à l'assistant."
                    )));
                }
                if let (Some(version), Some(file)) =
                    (ctx.install.version.as_deref(), template_file(ctx.platform))
                {
                    if let Some(dir) = templates_dir(version) {
                        if !dir.join(file).is_file() {
                            return Err(AppError::invalid(format!(
                                "Modèles d'export Godot {} absents ({}). Installez-les dans Godot : Éditeur > Gérer les modèles d'export > Télécharger.",
                                templates_version(version),
                                display(&dir)
                            )));
                        }
                    }
                }
                let code = super::code_name(&ctx.project.name);
                let out =
                    export_path(ctx.platform, &code).unwrap_or_else(|| "build/game".to_string());
                if let Some(parent) = ctx.root.join(&out).parent() {
                    std::fs::create_dir_all(parent)?;
                }
                let flag = if ctx.development {
                    "--export-debug"
                } else {
                    "--export-release"
                };
                let mut s = spec(
                    console,
                    vec![
                        "--headless".into(),
                        "--path".into(),
                        path,
                        flag.into(),
                        preset.into(),
                        out.clone(),
                    ],
                    Some(1800),
                );
                s.output = Some(ctx.root.join(out));
                s
            }
        })
    }

    fn gitignore(&self) -> &'static str {
        GITIGNORE
    }

    fn ignored_dirs(&self) -> &'static [&'static str] {
        &[".godot", "build", "android", ".import"]
    }

    fn asset_dir(&self) -> &'static str {
        "assets/generated"
    }
}

/// Réécrit le script de vérification (il peut manquer dans un projet importé).
pub fn ensure_check_script(root: &Path) -> AppResult<()> {
    let path = root.join(CHECK_SCRIPT);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(CHECK_SCRIPT_BODY) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, CHECK_SCRIPT_BODY)?;
    }
    Ok(())
}

/// Clé de tri des versions (`4.4.1.stable` > `4.3`).
pub fn version_key(version: Option<&str>) -> Vec<u32> {
    version
        .unwrap_or("")
        .split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .take(4)
        .filter_map(|s| s.parse().ok())
        .collect()
}

const ICON: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#1d2027"/><path d="M64 26a38 38 0 1 0 38 38" fill="none" stroke="#d9a94f" stroke-width="10" stroke-linecap="round"/><circle cx="64" cy="64" r="10" fill="#f2d58e"/></svg>
"##;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::game_studio::types::GamePlatform;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("gs-godot-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn versions_map_to_template_folders() {
        assert_eq!(
            templates_version("4.4.1.stable.official.49a5bc7b6"),
            "4.4.1.stable"
        );
        assert_eq!(
            templates_version("4.3.stable.mono.official.77dcf97d8"),
            "4.3.stable.mono"
        );
        assert_eq!(
            version_from_name("Godot_v4.4.1-stable_win64.exe").as_deref(),
            Some("4.4.1.stable")
        );
        assert_eq!(
            version_from_name("Godot_v4.3-stable_mono_win64.exe").as_deref(),
            Some("4.3.stable.mono")
        );
        assert!(version_key(Some("4.4.1.stable")) > version_key(Some("4.3.stable")));
    }

    #[test]
    fn creates_a_readable_project() {
        let dir = temp("create");
        let spec = NewProject {
            name: "Marée basse".to_string(),
            dir: dir.clone(),
            dimension: GameDimension::TwoD,
            description: "Un jeu de pêche \"relaxant\".".to_string(),
            targets: vec![GamePlatform::Web],
            cpp: false,
        };
        let created = Godot.create(&spec, None).unwrap();
        assert!(created.files.contains(&"project.godot".to_string()));
        assert!(Godot.is_project(&dir));
        let project = Godot.inspect(&dir).unwrap();
        assert_eq!(project.name, "Marée basse");
        assert_eq!(project.engine_version.as_deref(), Some("4.4"));
        assert_eq!(
            project.main_scene.as_deref(),
            Some("res://scenes/main.tscn")
        );
        let presets = std::fs::read_to_string(dir.join("export_presets.cfg")).unwrap();
        assert!(presets.contains("name=\"Windows Desktop\"") && presets.contains("name=\"Web\""));
        assert!(
            !presets.contains("[preset.0.options]\n\n["),
            "une section d'options vide est ignorée par Godot"
        );
        let config = std::fs::read_to_string(dir.join("project.godot")).unwrap();
        assert!(config.contains("config/description=\"Un jeu de pêche \\\"relaxant\\\".\""));
        // Le dossier n'est plus vide : une seconde création est refusée.
        assert!(Godot.create(&spec, None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// De bout en bout avec un vrai Godot 4 : `GAMESTUDIO_GODOT=/chemin/vers/godot cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn real_godot_checks_and_runs_a_new_project() {
        let Some(binary) = std::env::var_os("GAMESTUDIO_GODOT").map(PathBuf::from) else {
            return;
        };
        let install = install_from(&binary, "test").unwrap();
        assert!(install
            .version
            .as_deref()
            .is_some_and(|v| v.starts_with('4')));
        let dir = temp("real");
        let spec = NewProject {
            name: "Essai réel".to_string(),
            dir: dir.clone(),
            dimension: GameDimension::ThreeD,
            description: "Test".to_string(),
            targets: vec![],
            cpp: false,
        };
        Godot.create(&spec, Some(&install)).unwrap();
        let project = Godot.inspect(&dir).unwrap();
        let ctx = ActionContext {
            root: &dir,
            project: &project,
            install: &install,
            platform: GamePlatform::Linux,
            development: false,
        };
        let run = |action| {
            let cmd = Godot.command(action, &ctx).unwrap();
            let out = std::process::Command::new(&cmd.program)
                .args(&cmd.args)
                .current_dir(&cmd.cwd)
                .output()
                .unwrap();
            (
                out.status.code(),
                String::from_utf8_lossy(&out.stdout).to_string()
                    + &String::from_utf8_lossy(&out.stderr),
            )
        };
        let (code, _) = run(GameAction::Setup);
        assert_eq!(code, Some(0));
        let (code, out) = run(GameAction::Check);
        assert_eq!(code, Some(0), "{out}");
        assert!(out.contains("GAMESTUDIO_CHECK"));
        let (code, out) = run(GameAction::Test);
        assert_eq!(code, Some(0), "{out}");
        assert!(out.contains(SMOKE_MARKER));
        // Une erreur de script fait échouer la vérification.
        std::fs::write(
            dir.join("scripts/cassé.gd"),
            "extends Node\nfunc f() -> void:\n\tvar x: int = \"texte\"\n",
        )
        .unwrap();
        let (code, out) = run(GameAction::Check);
        assert_eq!(code, Some(1), "{out}");
        assert!(out.contains("Parse Error"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
