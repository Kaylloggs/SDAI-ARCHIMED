//! Découverte des modules backend :
//! - lit chaque `src/modules/<id>/module.toml`
//! - déclare le plugin inline correspondant à tauri-build (permissions)
//! - régénère `capabilities/modules.generated.json`
//! - génère le registre `OUT_DIR/modules.rs` inclus par `src/modules/mod.rs`
//!
//! Conséquence : un module backend s'ajoute et se retire en créant ou supprimant son
//! dossier, sans toucher au moindre fichier partagé.

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
    /// Comptes du Gestionnaire d'identifiants du module (`<id>-…`), effacés s'il est supprimé.
    credentials: Vec<String>,
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

        let credentials: Vec<String> = value
            .get("credentials")
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
        if let Some(bad) = credentials.iter().find(|c| !c.starts_with(&format!("{id}-"))) {
            panic!("{}: l'identifiant `{bad}` doit commencer par `{id}-`", manifest.display());
        }
        modules.push(ModuleDecl { folder, id, commands, credentials });
    }
    modules.sort_by(|a, b| a.folder.cmp(&b.folder));
    modules
}

/// Écrit le registre Rust : déclaration de chaque module (par chemin absolu, le fichier
/// vit dans `OUT_DIR`) puis enregistrement de son plugin Tauri.
fn write_registry(modules: &[ModuleDecl], modules_dir: &Path, path: &Path) {
    let root = fs::canonicalize(modules_dir)
        .unwrap_or_else(|e| panic!("chemin de {}: {e}", modules_dir.display()));
    // `\\?\` en tête d'un chemin canonique Windows : `#[path]` ne le comprend pas.
    let root = root.display().to_string();
    let root = root.strip_prefix(r"\\?\").unwrap_or(&root).replace('\\', "/");

    let mut out = String::from(
        "// GÉNÉRÉ par build.rs — ne pas éditer.\n",
    );
    for module in modules {
        out.push_str(&format!(
            "#[path = \"{root}/{folder}/mod.rs\"]\npub mod {folder};\n",
            folder = module.folder
        ));
    }
    out.push_str(
        "\npub fn register_all<R: tauri::Runtime>(\n    #[allow(unused_mut)] mut builder: tauri::Builder<R>,\n) -> tauri::Builder<R> {\n",
    );
    for module in modules {
        out.push_str(&format!(
            "    builder = builder.plugin({}::plugin());\n",
            module.folder
        ));
    }
    out.push_str("    builder\n}\n");
    out.push_str(
        "\n/// Comptes du Gestionnaire d'identifiants déclarés par un module (`credentials`).\npub fn credentials(module: &str) -> &'static [&'static str] {\n    match module {\n",
    );
    for module in modules.iter().filter(|m| !m.credentials.is_empty()) {
        let list = module
            .credentials
            .iter()
            .map(|c| format!("{c:?}"))
            .collect::<Vec<_>>()
            .join(", ");
        out.push_str(&format!("        {:?} => &[{list}],\n", module.id));
    }
    out.push_str("        _ => &[],\n    }\n}\n");
    out.push_str(
        "\n/// Tous les comptes déclarés, `(module, compte)` : relecture d'une clé partagée.\n#[allow(dead_code)]\npub fn all_credentials() -> &'static [(&'static str, &'static str)] {\n    &[\n",
    );
    for module in modules {
        for account in &module.credentials {
            out.push_str(&format!("        ({:?}, {account:?}),\n", module.id));
        }
    }
    out.push_str("    ]\n}\n");

    let current = fs::read_to_string(path).unwrap_or_default();
    if current != out {
        fs::write(path, out).unwrap_or_else(|e| panic!("écriture de {}: {e}", path.display()));
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

    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR absent");
    write_registry(&modules, modules_dir, &Path::new(&out_dir).join("modules.rs"));
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
