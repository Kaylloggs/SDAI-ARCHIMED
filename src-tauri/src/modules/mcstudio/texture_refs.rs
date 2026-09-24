//! Textures que le mod cite ailleurs que dans ses traductions : le code (`id("textures/misc/
//! googles_overlay.png")`, `Identifier.of(MOD_ID, "textures/…")`, `"<modid>:textures/…"`), les
//! modèles, les particules, les équipements (1.21.2+), les tableaux et tout JSON qui nomme un
//! PNG du mod. L'onglet Textures les liste, même quand le fichier n'existe pas encore.
//!
//! Lecture seule, bornée (nombre et taille des fichiers). Une texture du jeu (`minecraft:`,
//! `Identifier.ofVanilla(…)`, identifiant sans espace de noms) n'est jamais prise pour une
//! texture du mod.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

use super::types::AssetKind;

/// Fichiers lus au plus.
const MAX_FILES: usize = 4000;
/// Taille maximale d'un fichier lu.
const MAX_BYTES: u64 = 512 * 1024;
/// Dossiers jamais parcourus (sorties de build, caches).
const SKIPPED: [&str; 5] = ["build", ".gradle", "run", "node_modules", "out"];

/// Chemin sous `textures/` (sans `.png`) → fichier du projet qui le cite.
pub type Citations = BTreeMap<String, String>;

/// Chemin de texture sûr : minuscules, chiffres, `_ - . /`, sans segment vide ni `..`.
pub fn valid_asset_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 200
        && path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
        && path.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.' | '/')
        })
}

/// Famille d'une texture d'après son dossier et son nom.
pub fn asset_kind(path: &str) -> AssetKind {
    let name = path.rsplit('/').next().unwrap_or(path);
    if path.starts_with("models/armor/") || path.starts_with("entity/equipment/") {
        return AssetKind::Armor;
    }
    match path.split('/').next().unwrap_or("") {
        "entity" => AssetKind::Entity,
        "particle" => AssetKind::Particle,
        "mob_effect" => AssetKind::Effect,
        "painting" => AssetKind::Painting,
        "gui" => AssetKind::Gui,
        _ if ["overlay", "blur", "vignette", "scope", "hud"]
            .iter()
            .any(|word| name.contains(word)) =>
        {
            AssetKind::Overlay
        }
        _ => AssetKind::Other,
    }
}

/// Toutes les textures citées par les sources du projet (`src/`).
pub fn cited(root: &Path, mod_id: &str) -> Citations {
    let mut found = Citations::new();
    let mut budget = MAX_FILES;
    walk(root, &root.join("src"), mod_id, &mut budget, &mut found);
    found
}

fn walk(root: &Path, dir: &Path, mod_id: &str, budget: &mut usize, found: &mut Citations) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
    entries.sort();
    for path in entries {
        if *budget == 0 {
            return;
        }
        let Ok(meta) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if meta.is_dir() {
            if !SKIPPED.contains(&name) && !name.starts_with('.') {
                walk(root, &path, mod_id, budget, found);
            }
            continue;
        }
        let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if !matches!(extension, "java" | "kt" | "json") || meta.len() > MAX_BYTES {
            continue;
        }
        *budget -= 1;
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let paths = if extension == "json" {
            json_citations(&relative, &text, mod_id)
        } else {
            code_citations(&text, mod_id)
        };
        for texture in paths.into_iter().filter(|p| valid_asset_path(p)) {
            found.entry(texture).or_insert_with(|| relative.clone());
        }
    }
}

fn is_name_char(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.')
}

/// Appels dont le premier argument, sans espace de noms, désigne une ressource du jeu.
const VANILLA_CALLS: [&str; 7] = [
    "Identifier(",
    "Identifier.of(",
    "Identifier.tryParse(",
    "ofVanilla(",
    "withDefaultNamespace(",
    "ResourceLocation(",
    "ResourceLocation.parse(",
];

/// `"textures/…png"` dans le code : du mod s'il porte son espace de noms, ou sans espace de
/// noms s'il n'est pas le premier argument d'un identifiant du jeu (`id("textures/…")`,
/// `Identifier.of(MOD_ID, "textures/…")`).
fn code_citations(text: &str, mod_id: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in text.lines() {
        let mut rest = line;
        let mut offset = 0;
        while let Some(at) = rest.find("textures/") {
            let absolute = offset + at;
            let after = &line[absolute + "textures/".len()..];
            let end = after
                .find(|c: char| !(is_name_char(c) || c == '/'))
                .unwrap_or(after.len());
            let token = &after[..end];
            let before = &line[..absolute];
            // Espace de noms collé : `"<ns>:textures/…"`.
            let (namespace, opening) = match before.strip_suffix(':') {
                Some(head) => {
                    let start = head.rfind(|c: char| !is_name_char(c)).map_or(0, |i| i + 1);
                    (Some(&head[start..]), &head[..start])
                }
                None => (None, before),
            };
            let quoted = opening.ends_with('"');
            let ours = match namespace {
                Some(namespace) => namespace == mod_id,
                None => {
                    let call = opening.trim_end_matches('"').trim_end();
                    let vanilla = VANILLA_CALLS.iter().any(|vanilla| {
                        call.strip_suffix(vanilla).is_some_and(|head| {
                            !head.ends_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
                        })
                    });
                    !vanilla && !line.contains("\"minecraft\"")
                }
            };
            if quoted && ours {
                if let Some(path) = token.strip_suffix(".png") {
                    found.push(path.to_string());
                }
            }
            offset = absolute + "textures/".len() + end;
            rest = &line[offset..];
        }
    }
    found
}

/// Partie après `<modid>:` d'un identifiant du mod.
fn ours<'a>(reference: &'a str, mod_id: &str) -> Option<&'a str> {
    reference
        .split_once(':')
        .filter(|(namespace, _)| *namespace == mod_id)
        .map(|(_, rest)| rest)
}

/// Textures citées par un JSON du mod, selon son dossier (`assets/<modid>/models/…`,
/// `particles/`, `equipment/`, `data/<modid>/painting_variant/`), plus tout PNG nommé.
fn json_citations(relative: &str, text: &str, mod_id: &str) -> Vec<String> {
    let assets = format!("assets/{mod_id}/");
    let data = format!("data/{mod_id}/");
    let section = if let Some(at) = relative.find(&assets) {
        &relative[at + assets.len()..]
    } else if let Some(at) = relative.find(&data) {
        &relative[at + data.len()..]
    } else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    fn texture<'a>(reference: &'a Value, mod_id: &str) -> Option<&'a str> {
        reference.as_str().and_then(|r| ours(r, mod_id))
    }
    if section.starts_with("models/") {
        if let Some(textures) = value.get("textures").and_then(Value::as_object) {
            found.extend(
                textures
                    .values()
                    .filter_map(|t| texture(t, mod_id))
                    .map(str::to_string),
            );
        }
    } else if section.starts_with("particles/") {
        if let Some(list) = value.get("textures").and_then(Value::as_array) {
            found.extend(
                list.iter()
                    .filter_map(|t| texture(t, mod_id))
                    .map(|p| format!("particle/{p}")),
            );
        }
    } else if section.starts_with("equipment/") {
        if let Some(layers) = value.get("layers").and_then(Value::as_object) {
            for (kind, list) in layers {
                for layer in list.as_array().into_iter().flatten() {
                    if let Some(path) = layer.get("texture").and_then(|t| texture(t, mod_id)) {
                        found.push(format!("entity/equipment/{kind}/{path}"));
                    }
                }
            }
        }
    } else if section.starts_with("painting_variant/") {
        if let Some(path) = value.get("asset_id").and_then(|t| texture(t, mod_id)) {
            found.push(format!("painting/{path}"));
        }
    }
    // Tout PNG du mod nommé ailleurs (polices, atlas…) : relatif à `textures/`.
    png_strings(&value, mod_id, &mut found);
    found
}

fn png_strings(value: &Value, mod_id: &str, found: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            if let Some(path) = ours(text, mod_id).and_then(|p| p.strip_suffix(".png")) {
                found.push(path.strip_prefix("textures/").unwrap_or(path).to_string());
            }
        }
        Value::Array(list) => list.iter().for_each(|v| png_strings(v, mod_id, found)),
        Value::Object(map) => map.values().for_each(|v| png_strings(v, mod_id, found)),
        _ => {}
    }
}

/// PNG présents sous `textures/` (chemins sans `.png`), sous-dossiers compris.
pub fn present(textures: &Path) -> Vec<String> {
    fn visit(base: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
        if depth > 8 || out.len() >= MAX_FILES {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = entries.flatten().map(|e| e.path()).collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                visit(base, &path, depth + 1, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("png") {
                let relative = path
                    .strip_prefix(base)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                if let Some(stem) = relative.strip_suffix(".png") {
                    if valid_asset_path(stem) {
                        out.push(stem.to_string());
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    visit(textures, textures, 0, &mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_citations_keep_the_mod_textures_only() {
        let code = r#"
            private static final Identifier OVERLAY = XRAYGoogles.id("textures/misc/googles_overlay.png");
            Identifier a = Identifier.of(MOD_ID, "textures/gui/container/forge.png");
            Identifier b = Identifier.of("dm", "textures/entity/golem.png");
            Identifier c = Identifier.of("dm:textures/particle/spark.png");
            Identifier v1 = Identifier.ofVanilla("textures/misc/pumpkinblur.png");
            Identifier v2 = Identifier.of("minecraft", "textures/misc/vignette.png");
            Identifier v3 = new Identifier("textures/gui/widgets.png");
            Identifier m = modIdentifier("textures/gui/panel.png");
            Identifier v4 = Identifier.of("other:textures/x.png");
            // voir assets/dm/textures/item/ruby.png
            String s = "textures/entity/ruby_golem.png" + "textures/misc/a.png";
        "#;
        assert_eq!(
            code_citations(code, "dm"),
            vec![
                "misc/googles_overlay",
                "gui/container/forge",
                "entity/golem",
                "particle/spark",
                "gui/panel",
                "entity/ruby_golem",
                "misc/a",
            ]
        );
    }

    #[test]
    fn json_citations_follow_the_folder() {
        let model = r#"{"parent":"item/generated","textures":{"layer0":"dm:item/googles","layer1":"minecraft:item/x","overlay":"dm:entity/glow"}}"#;
        assert_eq!(
            json_citations(
                "src/main/resources/assets/dm/models/item/googles.json",
                model,
                "dm"
            ),
            vec!["item/googles", "entity/glow"]
        );
        let particle = r#"{"textures":["dm:spark_0","dm:spark_1"]}"#;
        assert_eq!(
            json_citations(
                "src/main/resources/assets/dm/particles/spark.json",
                particle,
                "dm"
            ),
            vec!["particle/spark_0", "particle/spark_1"]
        );
        let equipment = r#"{"layers":{"humanoid":[{"texture":"dm:ruby"}],"humanoid_leggings":[{"texture":"dm:ruby"}]}}"#;
        assert_eq!(
            json_citations(
                "src/main/resources/assets/dm/equipment/ruby.json",
                equipment,
                "dm"
            ),
            vec![
                "entity/equipment/humanoid/ruby",
                "entity/equipment/humanoid_leggings/ruby"
            ]
        );
        let painting = r#"{"asset_id":"dm:sunset","width":2,"height":1}"#;
        assert_eq!(
            json_citations(
                "src/main/resources/data/dm/painting_variant/sunset.json",
                painting,
                "dm"
            ),
            vec!["painting/sunset"]
        );
        let font = r#"{"providers":[{"type":"bitmap","file":"dm:font/glyphs.png"},{"file":"minecraft:font/ascii.png"}]}"#;
        assert_eq!(
            json_citations("src/main/resources/assets/dm/font/default.json", font, "dm"),
            vec!["font/glyphs"]
        );
        assert!(
            json_citations("src/main/resources/assets/other/models/x.json", model, "dm").is_empty()
        );
    }

    #[test]
    fn kinds_come_from_folder_and_name() {
        assert_eq!(asset_kind("misc/googles_overlay"), AssetKind::Overlay);
        assert_eq!(asset_kind("misc/scope"), AssetKind::Overlay);
        assert_eq!(asset_kind("entity/ruby_golem"), AssetKind::Entity);
        assert_eq!(
            asset_kind("entity/equipment/humanoid/ruby"),
            AssetKind::Armor
        );
        assert_eq!(asset_kind("models/armor/ruby_layer_1"), AssetKind::Armor);
        assert_eq!(asset_kind("particle/spark"), AssetKind::Particle);
        assert_eq!(asset_kind("mob_effect/glow"), AssetKind::Effect);
        assert_eq!(asset_kind("painting/sunset"), AssetKind::Painting);
        assert_eq!(asset_kind("gui/sprites/button"), AssetKind::Gui);
        assert_eq!(asset_kind("font/glyphs"), AssetKind::Other);
    }

    #[test]
    fn paths_stay_inside_textures() {
        assert!(valid_asset_path("misc/googles_overlay"));
        assert!(valid_asset_path("entity/equipment/humanoid/ruby"));
        for bad in ["", "../x", "a//b", "A/b", "a/./b", "a\\b", "a b"] {
            assert!(!valid_asset_path(bad), "{bad}");
        }
    }

    #[test]
    fn a_project_is_scanned_without_its_build_output() {
        let root = std::env::temp_dir().join(format!("mcstudio-refs-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let java = root.join("src/client/java/com/x");
        std::fs::create_dir_all(&java).unwrap();
        std::fs::write(
            java.join("Client.java"),
            r#"id("textures/misc/googles_overlay.png")"#,
        )
        .unwrap();
        let build = root.join("src/build");
        std::fs::create_dir_all(&build).unwrap();
        std::fs::write(build.join("Gen.java"), r#"id("textures/misc/ghost.png")"#).unwrap();
        let textures = root.join("src/main/resources/assets/dm/textures/entity");
        std::fs::create_dir_all(&textures).unwrap();
        std::fs::write(textures.join("golem.png"), b"x").unwrap();

        let found = cited(&root, "dm");
        assert_eq!(found.len(), 1);
        assert_eq!(
            found["misc/googles_overlay"],
            "src/client/java/com/x/Client.java"
        );
        assert_eq!(
            present(&root.join("src/main/resources/assets/dm/textures")),
            vec!["entity/golem"]
        );
        std::fs::remove_dir_all(&root).unwrap();
    }
}
