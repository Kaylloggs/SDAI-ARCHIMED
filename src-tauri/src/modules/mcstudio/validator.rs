//! Vérification d'un projet sans compiler : ce que Gradle laisse passer mais que le jeu
//! refuse ou ignore au chargement.
//!
//! - JSON et TOML lisibles (ligne, colonne, explication en français) ;
//! - textures PNG lisibles, de taille multiple de 16 ;
//! - dossiers de données au format de la version (`recipe/` ou `recipes/`…) ;
//! - recettes écrites au format de la version (ingrédients, résultats) ;
//! - références du mod lui-même : textures des modèles, modèles des états de bloc et des
//!   définitions d'objet, noms affichés.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use super::fsutil::walk_files;
use super::profiles::DataFormat;
use super::types::{Severity, ValidationIssue, ValidationReport};

const RESOURCES: &str = "src/main/resources";

struct Checker<'a> {
    mod_id: &'a str,
    format: DataFormat,
    issues: Vec<ValidationIssue>,
}

fn issue(
    severity: Severity,
    file: &str,
    position: Option<(u32, u32)>,
    message: impl Into<String>,
    hint: Option<&str>,
) -> ValidationIssue {
    ValidationIssue {
        severity,
        file: file.to_string(),
        line: position.map(|p| p.0),
        column: position.map(|p| p.1),
        message: message.into(),
        hint: hint.map(str::to_string),
    }
}

/// Explication d'une erreur de syntaxe JSON de serde.
fn json_hint(message: &str) -> &'static str {
    if message.contains("trailing comma") {
        "Virgule en trop juste avant } ou ] : retirez-la."
    } else if message.contains("EOF while parsing") {
        "Fichier incomplet : une accolade ou un crochet n'est pas fermé."
    } else if message.contains("key must be a string") {
        "Les clés s'écrivent entre guillemets doubles : \"nom\": valeur."
    } else if message.contains("expected `,` or") {
        "Virgule manquante entre deux entrées, ou accolade en trop."
    } else if message.contains("expected `:`") {
        "Deux-points manquant entre une clé et sa valeur."
    } else if message.contains("control character") {
        "Retour à la ligne ou tabulation dans un texte : écrivez \\n ou \\t."
    } else {
        "Vérifiez guillemets, virgules et accolades autour de cette position."
    }
}

/// Position (ligne, colonne) d'un octet dans un texte, à partir de 1.
fn position_of(text: &str, offset: usize) -> (u32, u32) {
    let before = &text[..offset.min(text.len())];
    let line = before.matches('\n').count() + 1;
    let column = before.rsplit('\n').next().map_or(0, |l| l.chars().count()) + 1;
    (line as u32, column as u32)
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

impl Checker<'_> {
    fn push(&mut self, issue: ValidationIssue) {
        self.issues.push(issue);
    }

    /// `monmod:item/rubis` → (namespace, chemin) ; sans espace de noms : `minecraft`.
    fn split<'v>(&self, reference: &'v str) -> (&'v str, &'v str) {
        reference
            .split_once(':')
            .unwrap_or(("minecraft", reference))
    }

    fn own<'v>(&self, reference: &'v str) -> Option<&'v str> {
        let (namespace, path) = self.split(reference);
        (namespace == self.mod_id).then_some(path)
    }

    fn check_ingredient(&mut self, file: &str, value: &Value) {
        let text_era = self.format >= DataFormat::V1_21_2;
        match value {
            Value::Array(options) => {
                for option in options {
                    self.check_ingredient(file, option);
                }
            }
            Value::Object(object)
                if text_era && (object.contains_key("item") || object.contains_key("tag")) =>
            {
                let written = object
                    .get("item")
                    .or_else(|| object.get("tag"))
                    .and_then(Value::as_str)
                    .unwrap_or("…");
                let tag = if object.contains_key("tag") { "#" } else { "" };
                self.push(issue(
                    Severity::Error,
                    file,
                    None,
                    format!("Ingrédient au format d'avant 1.21.2 : {{\"item\": \"{written}\"}}."),
                    Some(&format!(
                        "Depuis 1.21.2, un ingrédient s'écrit en texte : \"{tag}{written}\"."
                    )),
                ));
            }
            Value::String(text) if !text_era => {
                self.push(issue(
                    Severity::Error,
                    file,
                    None,
                    format!("Ingrédient écrit en texte (\"{text}\") : format de 1.21.2 et plus."),
                    Some(&format!(
                        "Pour cette version : {{\"item\": \"{}\"}} (ou {{\"tag\": …}} pour un tag).",
                        text.trim_start_matches('#')
                    )),
                ));
            }
            _ => {}
        }
    }

    fn check_result(&mut self, file: &str, kind: &str, result: &Value) {
        let cooking = matches!(
            kind,
            "smelting" | "blasting" | "smoking" | "campfire_cooking"
        );
        let legacy = self.format == DataFormat::Legacy;
        match (cooking, legacy, result) {
            (true, true, Value::Object(_)) => self.push(issue(
                Severity::Error,
                file,
                None,
                "Résultat de cuisson en objet : format de 1.20.5 et plus.",
                Some("Pour cette version, le résultat est un texte : \"result\": \"monmod:objet\"."),
            )),
            (true, false, Value::String(text)) => self.push(issue(
                Severity::Error,
                file,
                None,
                "Résultat de cuisson écrit en texte : format d'avant 1.20.5.",
                Some(&format!("Depuis 1.20.5 : \"result\": {{\"id\": \"{text}\"}}.")),
            )),
            (false, true, Value::Object(object)) if object.contains_key("id") && !object.contains_key("item") => {
                self.push(issue(
                    Severity::Error,
                    file,
                    None,
                    "Résultat {\"id\": …} : format de 1.20.5 et plus.",
                    Some("Pour cette version : \"result\": {\"item\": \"monmod:objet\", \"count\": 1}."),
                ))
            }
            (false, false, Value::Object(object)) if object.contains_key("item") && !object.contains_key("id") => {
                self.push(issue(
                    Severity::Error,
                    file,
                    None,
                    "Résultat {\"item\": …} : format d'avant 1.20.5.",
                    Some("Depuis 1.20.5 : \"result\": {\"id\": \"monmod:objet\", \"count\": 1}."),
                ))
            }
            _ => {}
        }
    }

    fn check_recipe(&mut self, file: &str, recipe: &Value) {
        let kind = recipe["type"]
            .as_str()
            .map(|t| self.split(t).1.to_string())
            .unwrap_or_default();
        match kind.as_str() {
            "crafting_shaped" => {
                if let Some(key) = recipe["key"].as_object() {
                    for value in key.values() {
                        self.check_ingredient(file, value);
                    }
                }
            }
            "crafting_shapeless" => {
                if let Some(list) = recipe["ingredients"].as_array() {
                    for value in list {
                        self.check_ingredient(file, value);
                    }
                }
            }
            "smelting" | "blasting" | "smoking" | "campfire_cooking" | "stonecutting" => {
                self.check_ingredient(file, &recipe["ingredient"]);
            }
            _ => return,
        }
        if !recipe["result"].is_null() {
            self.check_result(file, &kind, &recipe["result"]);
        }
    }
}

/// Toutes les valeurs de `key` dans un JSON (modèles d'état de bloc, définitions d'objet).
fn strings_under(value: &Value, key: &str, out: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (name, inner) in object {
                if name == key {
                    if let Some(text) = inner.as_str() {
                        out.push(text.to_string());
                    }
                }
                strings_under(inner, key, out);
            }
        }
        Value::Array(list) => {
            for inner in list {
                strings_under(inner, key, out);
            }
        }
        _ => {}
    }
}

/// Vérifie le projet ; les problèmes sont triés (erreurs d'abord, puis par fichier).
pub fn validate(root: &Path, mod_id: &str, format: DataFormat) -> ValidationReport {
    let mut checker = Checker {
        mod_id,
        format,
        issues: Vec::new(),
    };
    let resources = root.join(RESOURCES);
    let mut json: BTreeMap<String, Value> = BTreeMap::new();
    let mut textures: BTreeSet<String> = BTreeSet::new();
    let mut files = 0u32;

    let mut paths = Vec::new();
    walk_files(&resources, &mut |path| paths.push(path.to_path_buf()));
    for path in &paths {
        let rel = relative(root, path);
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        match extension.as_str() {
            "json" | "mcmeta" => {
                files += 1;
                let Ok(text) = std::fs::read_to_string(path) else {
                    checker.push(issue(
                        Severity::Error,
                        &rel,
                        None,
                        "Fichier illisible (encodage UTF-8 attendu).",
                        None,
                    ));
                    continue;
                };
                match serde_json::from_str::<Value>(&text) {
                    Ok(value) => {
                        json.insert(rel, value);
                    }
                    Err(error) => {
                        let message = error.to_string();
                        let detail = message.split(" at line ").next().unwrap_or(&message);
                        checker.push(issue(
                            Severity::Error,
                            &rel,
                            Some((error.line() as u32, error.column() as u32)),
                            format!("JSON invalide : {detail}."),
                            Some(json_hint(&message)),
                        ));
                    }
                }
            }
            "toml" => {
                files += 1;
                let Ok(text) = std::fs::read_to_string(path) else {
                    continue;
                };
                if let Err(error) = toml::from_str::<toml::Value>(&text) {
                    let position = error.span().map(|span| position_of(&text, span.start));
                    checker.push(issue(
                        Severity::Error,
                        &rel,
                        position,
                        format!("TOML invalide : {}.", error.message().trim_end_matches('.')),
                        Some("Vérifiez les guillemets et les [sections] autour de cette ligne."),
                    ));
                }
            }
            "png" => {
                files += 1;
                textures.insert(rel.clone());
                if !rel.contains("/textures/") {
                    continue;
                }
                match image::image_dimensions(path) {
                    Err(_) => checker.push(issue(
                        Severity::Error,
                        &rel,
                        None,
                        "Image PNG illisible.",
                        Some("Régénérez-la depuis l'onglet Textures, ou remplacez le fichier."),
                    )),
                    Ok((width, height)) => {
                        let animated = paths
                            .iter()
                            .any(|p| relative(root, p) == format!("{rel}.mcmeta"));
                        let square = width == height || (animated && height % width == 0);
                        if width % 16 != 0 || !square {
                            checker.push(issue(
                                Severity::Warning,
                                &rel,
                                None,
                                format!("Texture de {width}×{height} : Minecraft attend un carré de 16, 32, 64… pixels."),
                                Some("Une texture animée a un fichier .mcmeta à côté et une hauteur multiple de la largeur."),
                            ));
                        }
                    }
                }
            }
            _ => {}
        }
    }

    // Dossiers de données au format de la version.
    let plural = format < DataFormat::V1_21;
    let renamed = [
        ("recipes", "recipe"),
        ("loot_tables", "loot_table"),
        ("advancements", "advancement"),
        ("tags/blocks", "tags/block"),
        ("tags/items", "tags/item"),
    ];
    if let Ok(namespaces) = std::fs::read_dir(resources.join("data")) {
        for namespace in namespaces.flatten() {
            let base = namespace.path();
            for (old, new) in renamed {
                let (wrong, right) = if plural { (new, old) } else { (old, new) };
                if base.join(wrong).is_dir() {
                    let rel = relative(root, &base.join(wrong));
                    checker.push(issue(
                        Severity::Error,
                        &rel,
                        None,
                        format!(
                            "Dossier « {wrong}/ » ignoré par Minecraft {} : son contenu n'est jamais chargé.",
                            if plural { "avant 1.21" } else { "1.21 et plus" }
                        ),
                        Some(&format!("Renommez-le « {right}/ ».")),
                    ));
                }
            }
        }
    }

    let data_prefix = format!("{RESOURCES}/data/{mod_id}/");
    let assets_prefix = format!("{RESOURCES}/assets/{mod_id}/");
    let asset = |path: &str| format!("{assets_prefix}{path}");

    for (file, value) in &json {
        // Recettes du mod.
        if let Some(rest) = file.strip_prefix(&data_prefix) {
            if rest.starts_with("recipe/") || rest.starts_with("recipes/") {
                checker.check_recipe(file, value);
            }
            continue;
        }
        let Some(rest) = file.strip_prefix(&assets_prefix) else {
            continue;
        };
        if rest.starts_with("models/") {
            if let Some(map) = value["textures"].as_object() {
                for reference in map.values().filter_map(Value::as_str) {
                    if reference.starts_with('#') {
                        continue;
                    }
                    if let Some(path) = checker.own(reference) {
                        let png = asset(&format!("textures/{path}.png"));
                        if !textures.contains(&png) {
                            checker.push(issue(
                                Severity::Error,
                                file,
                                None,
                                format!("Texture « {reference} » introuvable : l'objet s'affichera en damier violet et noir."),
                                Some(&format!("Créez {png} (onglet Textures) ou corrigez le nom.")),
                            ));
                        }
                    }
                }
            }
            // Le jeu refuse un modèle dont un cube sort de -16 à 32 (formes placées trop loin).
            let outside = value["elements"]
                .as_array()
                .map(|elements| {
                    elements
                        .iter()
                        .filter(|element| {
                            ["from", "to"].iter().any(|key| {
                                element[key].as_array().is_some_and(|v| {
                                    v.iter()
                                        .filter_map(Value::as_f64)
                                        .any(|c| !(-16.0..=32.0).contains(&c))
                                })
                            })
                        })
                        .count()
                })
                .unwrap_or(0);
            if outside > 0 {
                checker.push(issue(
                    Severity::Error,
                    file,
                    None,
                    format!("{outside} cube(s) hors des limites du jeu (-16 à 32) : le modèle ne se chargera pas."),
                    Some("Rapprochez ou réduisez ces cubes dans l'atelier 3D (onglet Modèles 3D)."),
                ));
            }
            if let Some(parent) = value["parent"].as_str() {
                if let Some(path) = checker.own(parent) {
                    let model = asset(&format!("models/{path}.json"));
                    if !json.contains_key(&model) {
                        checker.push(issue(
                            Severity::Error,
                            file,
                            None,
                            format!("Modèle parent « {parent} » introuvable."),
                            Some(&format!("Attendu : {model}.")),
                        ));
                    }
                }
            }
        } else if rest.starts_with("blockstates/") || rest.starts_with("items/") {
            let mut models = Vec::new();
            strings_under(value, "model", &mut models);
            for reference in models {
                if let Some(path) = checker.own(&reference) {
                    let model = asset(&format!("models/{path}.json"));
                    if !json.contains_key(&model) {
                        checker.push(issue(
                            Severity::Error,
                            file,
                            None,
                            format!("Modèle « {reference} » introuvable : le jeu affichera un cube violet et noir."),
                            Some(&format!("Attendu : {model}.")),
                        ));
                    }
                }
            }
        }
    }

    // Objets du mod : définition (1.21.4+) et nom affiché.
    let lang = json
        .get(&asset("lang/en_us.json"))
        .and_then(Value::as_object);
    let item_models: Vec<String> = json
        .keys()
        .filter_map(|file| {
            file.strip_prefix(&asset("models/item/"))
                .and_then(|rest| rest.strip_suffix(".json"))
                .filter(|id| !id.contains('/'))
                .map(str::to_string)
        })
        .collect();
    for id in item_models {
        let model = asset(&format!("models/item/{id}.json"));
        if format >= DataFormat::V1_21_4 && !json.contains_key(&asset(&format!("items/{id}.json")))
        {
            checker.push(issue(
                Severity::Error,
                &model,
                None,
                format!("« {id} » n'a pas de définition d'objet : depuis 1.21.4, il resterait invisible."),
                Some(&format!(
                    "Créez {} avec {{\"model\": {{\"type\": \"minecraft:model\", \"model\": \"{mod_id}:item/{id}\"}}}}.",
                    asset(&format!("items/{id}.json"))
                )),
            ));
        }
        if let Some(lang) = lang {
            let named = [
                format!("item.{mod_id}.{id}"),
                format!("block.{mod_id}.{id}"),
            ]
            .iter()
            .any(|key| lang.contains_key(key));
            if !named {
                checker.push(issue(
                    Severity::Warning,
                    &model,
                    None,
                    format!("« {id} » n'a pas de nom dans en_us.json : le jeu affichera sa clé brute."),
                    Some(&format!("Ajoutez \"item.{mod_id}.{id}\" (ou \"block.…\") dans les fichiers de langue.")),
                ));
            }
        }
    }

    let mut issues = checker.issues;
    issues.sort_by(|a, b| {
        a.severity
            .cmp(&b.severity)
            .then(a.file.cmp(&b.file))
            .then(a.line.cmp(&b.line))
    });
    issues.dedup();
    ValidationReport {
        errors: issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count() as u32,
        warnings: issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
            .count() as u32,
        issues,
        files,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::pixelart::Raster;

    fn project(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("mcstudio-valid-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        root
    }

    fn put(root: &Path, rel: &str, content: &[u8]) {
        let path = root.join(RESOURCES).join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    fn png(side: u32) -> Vec<u8> {
        Raster::new(side, side).png().unwrap()
    }

    fn messages(report: &ValidationReport) -> Vec<String> {
        report
            .issues
            .iter()
            .map(|i| format!("{} | {}", i.file.rsplit('/').next().unwrap(), i.message))
            .collect()
    }

    #[test]
    fn broken_json_and_toml_are_located() {
        let root = project("syntax");
        put(
            &root,
            "assets/dm/lang/en_us.json",
            b"{\n  \"item.dm.ruby\": \"Ruby\",\n}\n",
        );
        put(
            &root,
            "META-INF/mods.toml",
            b"modLoader=\"javafml\"\n[[mods]\nmodId=\"dm\"\n",
        );
        let report = validate(&root, "dm", DataFormat::V1_21);
        assert_eq!(report.errors, 2, "{:?}", messages(&report));
        let json = report
            .issues
            .iter()
            .find(|i| i.file.ends_with("en_us.json"))
            .unwrap();
        assert_eq!(json.line, Some(3));
        assert!(json.hint.as_deref().unwrap().contains("Virgule en trop"));
        let toml = report
            .issues
            .iter()
            .find(|i| i.file.ends_with("mods.toml"))
            .unwrap();
        assert_eq!(toml.line, Some(2));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn data_folders_and_recipes_follow_the_version() {
        let root = project("format");
        // Projet 1.21.1 écrit à l'ancienne.
        put(&root, "data/dm/recipes/ruby_block.json", br###"{"type":"minecraft:crafting_shaped","pattern":["##"],"key":{"#":{"item":"dm:ruby"}},"result":{"id":"dm:ruby_block","count":1}}"###);
        put(&root, "data/dm/recipe/ok.json", br#"{"type":"minecraft:crafting_shapeless","ingredients":[{"item":"dm:ruby"}],"result":{"id":"dm:ruby","count":9}}"#);
        put(&root, "data/dm/recipe/bad_result.json", br#"{"type":"minecraft:crafting_shapeless","ingredients":[{"item":"dm:ruby"}],"result":{"item":"dm:ruby","count":9}}"#);
        put(
            &root,
            "data/dm/recipe/cook.json",
            br#"{"type":"minecraft:smelting","ingredient":"dm:raw_ruby","result":"dm:ruby"}"#,
        );
        let report = validate(&root, "dm", DataFormat::V1_21);
        let found = messages(&report);
        assert!(
            found.iter().any(|m| m.contains("« recipes/ » ignoré")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("bad_result.json | Résultat {\"item\"")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("cook.json | Ingrédient écrit en texte")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("cook.json | Résultat de cuisson écrit en texte")),
            "{found:?}"
        );
        assert!(!found.iter().any(|m| m.starts_with("ok.json")), "{found:?}");

        // Le même ingrédient objet est une erreur en 1.21.2.
        let report = validate(&root, "dm", DataFormat::V1_21_2);
        assert!(messages(&report)
            .iter()
            .any(|m| m.starts_with("ok.json | Ingrédient au format d'avant 1.21.2")));
        // Et en 1.20.1 c'est `recipe/` (singulier) qui est ignoré.
        let report = validate(&root, "dm", DataFormat::Legacy);
        assert!(messages(&report)
            .iter()
            .any(|m| m.contains("« recipe/ » ignoré par Minecraft avant 1.21")));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn broken_references_are_reported() {
        let root = project("refs");
        put(
            &root,
            "assets/dm/lang/en_us.json",
            br#"{"item.dm.ruby":"Ruby"}"#,
        );
        put(
            &root,
            "assets/dm/models/item/ruby.json",
            br#"{"parent":"minecraft:item/generated","textures":{"layer0":"dm:item/ruby"}}"#,
        );
        put(&root, "assets/dm/textures/item/ruby.png", &png(16));
        put(
            &root,
            "assets/dm/models/item/sapphire.json",
            br#"{"parent":"minecraft:item/generated","textures":{"layer0":"dm:item/sapphire"}}"#,
        );
        put(
            &root,
            "assets/dm/models/block/ore.json",
            br#"{"parent":"dm:block/base","textures":{"all":"dm:block/ore"}}"#,
        );
        put(&root, "assets/dm/textures/block/ore.png", &png(20));
        put(
            &root,
            "assets/dm/models/block/tower.json",
            br#"{"groups":[{"name":"g","origin":[8,8,8],"children":[0,1]}],"elements":[{"from":[0,0,0],"to":[16,16,16],"faces":{}},{"from":[4,16,4],"to":[12,40,12],"faces":{}}]}"#,
        );
        put(
            &root,
            "assets/dm/blockstates/ore.json",
            br#"{"variants":{"":{"model":"dm:block/ore"}}}"#,
        );
        put(
            &root,
            "assets/dm/blockstates/gone.json",
            br#"{"variants":{"":{"model":"dm:block/gone"}}}"#,
        );
        put(
            &root,
            "assets/dm/items/ruby.json",
            br#"{"model":{"type":"minecraft:model","model":"dm:item/ruby"}}"#,
        );

        let report = validate(&root, "dm", DataFormat::V1_21_4);
        let found = messages(&report);
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("sapphire.json | Texture « dm:item/sapphire » introuvable")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("ore.json | Modèle parent « dm:block/base »")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("gone.json | Modèle « dm:block/gone » introuvable")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("tower.json | 1 cube(s) hors des limites du jeu")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("sapphire.json | « sapphire » n'a pas de définition")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("sapphire.json | « sapphire » n'a pas de nom")),
            "{found:?}"
        );
        assert!(
            found
                .iter()
                .any(|m| m.starts_with("ore.png | Texture de 20×20")),
            "{found:?}"
        );
        assert!(
            !found.iter().any(|m| m.starts_with("ruby.json")),
            "{found:?}"
        );
        // Erreurs avant avertissements.
        assert_eq!(report.issues[0].severity, Severity::Error);
        assert_eq!(report.warnings, 2);

        // Avant 1.21.4, pas de définition d'objet exigée.
        let report = validate(&root, "dm", DataFormat::V1_21);
        assert!(!messages(&report).iter().any(|m| m.contains("définition")));
        let _ = std::fs::remove_dir_all(&root);
    }
}
