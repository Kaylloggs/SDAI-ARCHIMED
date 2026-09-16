//! Découverte des modules backend :
//! - lit chaque `src/modules/<id>/module.toml`
//! - déclare le plugin inline correspondant à tauri-build (permissions)
//! - régénère `capabilities/modules.generated.json`
//! - échoue si un module n'est pas enregistré dans `src/modules/mod.rs`

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Debug)]
struct ModuleDecl {
    /// Nom du dossier Rust (snake_case) — sert à l'enregistrement dans mod.rs.
    folder: String,
    /// Identifiant du plugin Tauri (kebab-case : les `_` sont interdits).
    id: String,
    commands: Vec<String>,
}

fn discover(root: &Path) -> Vec<ModuleDecl> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new();
    };

    let mut modules = Vec::new();
    for entry in entries.flatten() {
        let manifest = entry.path().join("module.toml");
        if !manifest.exists() {
            continue;
        }
        let raw = fs::read_to_string(&manifest)
            .unwrap_or_else(|e| panic!("lecture de {}: {e}", manifest.display()));
        let value: toml::Value = raw
            .parse()
            .unwrap_or_else(|e| panic!("{} invalide: {e}", manifest.display()));

        let id = value
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("{}: champ `id` manquant", manifest.display()))
            .to_string();

        let commands = value
            .get("commands")
            .and_then(|v| v.as_array())
            .map(|array| {
                array
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let folder = entry.file_name().to_string_lossy().to_string();
        if id.contains('_') {
            panic!("{}: `id` doit être en kebab-case (Tauri interdit `_`)", manifest.display());
        }
        modules.push(ModuleDecl { folder, id, commands });
    }
    modules.sort_by(|a, b| a.folder.cmp(&b.folder));
    modules
}

fn assert_registered(modules: &[ModuleDecl], registry: &Path) {
    let source = fs::read_to_string(registry)
        .unwrap_or_else(|e| panic!("lecture de {}: {e}", registry.display()));

    for module in modules {
        let declared = source.contains(&format!("pub mod {};", module.folder));
        let registered = source.contains(&format!("register!(builder, {});", module.folder));
        if !declared || !registered {
            panic!(
                "module `{}` non enregistré dans src/modules/mod.rs (attendu: `pub mod {};` et `register!(builder, {});`)",
                module.folder, module.folder, module.folder
            );
        }
    }
}

fn write_capability(modules: &[ModuleDecl], path: &Path) {
    let permissions: BTreeSet<String> = modules
        .iter()
        .map(|module| format!("{}:default", module.id))
        .collect();

    let json = format!(
        r#"{{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "modules-generated",
  "description": "GÉNÉRÉ par build.rs — ne pas éditer. Permissions des modules.",
  "windows": ["main"],
  "permissions": [
{}
  ]
}}
"#,
        permissions
            .iter()
            .map(|p| format!("    \"{p}\""))
            .collect::<Vec<_>>()
            .join(",\n")
    );

    let current = fs::read_to_string(path).unwrap_or_default();
    if current != json {
        fs::write(path, json).unwrap_or_else(|e| panic!("écriture de {}: {e}", path.display()));
    }
}

fn main() {
    let modules_dir = Path::new("src/modules");
    let modules = discover(modules_dir);

    assert_registered(&modules, &modules_dir.join("mod.rs"));
    write_capability(&modules, Path::new("capabilities/modules.generated.json"));

    let mut attributes = tauri_build::Attributes::new();
    for module in &modules {
        // `&'static str` requis par l'API ; fuite volontaire, limitée au build.
        let id: &'static str = Box::leak(module.id.clone().into_boxed_str());
        let commands: &'static [&'static str] = Box::leak(
            module
                .commands
                .iter()
                .map(|c| Box::leak(c.clone().into_boxed_str()) as &'static str)
                .collect::<Vec<_>>()
                .into_boxed_slice(),
        );

        attributes = attributes.plugin(
            id,
            tauri_build::InlinedPlugin::new()
                .commands(commands)
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        );
    }

    println!("cargo:rerun-if-changed=src/modules");
    tauri_build::try_build(attributes).expect("échec de tauri-build");
}
