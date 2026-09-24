//! Import d'un projet Fabric, Forge ou NeoForge qui n'a pas été créé par Mod Studio.
//!
//! L'examen (`inspect`) lit sans rien écrire : métadonnées du mod (`fabric.mod.json`,
//! `META-INF/mods.toml`, `META-INF/neoforge.mods.toml`), `gradle.properties`, le wrapper Gradle
//! et la classe principale. La personne voit ce qui a été trouvé avant d'importer ; l'import
//! n'écrit que `.mcstudio/project.json`, jamais les fichiers du projet.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::core::{AppError, AppResult};

use super::profiles::{self, Profile};
use super::types::{ImportPreview, License, LoaderId, ProjectMeta, ResolvedVersions};

/// `clé=valeur` d'un fichier `.properties` (commentaires et lignes vides ignorés).
fn properties(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with('!'))
        .filter_map(|line| {
            let (key, value) = line.split_once('=').or_else(|| line.split_once(':'))?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

/// Remplace les `${clé}` par les valeurs de `gradle.properties`.
fn expand(value: &str, props: &BTreeMap<String, String>) -> String {
    let mut out = value.to_string();
    for (key, replacement) in props {
        out = out.replace(&format!("${{{key}}}"), replacement);
    }
    out
}

fn first<'a>(props: &'a BTreeMap<String, String>, keys: &[&str]) -> Option<&'a String> {
    keys.iter()
        .find_map(|key| props.get(*key))
        .filter(|v| !v.is_empty())
}

/// Paquet et classe d'un nom complet (`com.demo.Main` → `com.demo`, `Main`).
fn split_class(full: &str) -> Option<(String, String)> {
    let (package, class) = full.rsplit_once('.')?;
    let valid = |part: &str| {
        !part.is_empty()
            && part
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
            && part.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
    };
    (package.split('.').all(valid) && valid(class))
        .then(|| (package.to_string(), class.to_string()))
}

/// Classe annotée `@Mod(` (Forge, NeoForge) : son paquet et son nom.
fn find_mod_class(java: &Path) -> Option<(String, String)> {
    fn visit(dir: &Path, depth: usize, budget: &mut usize) -> Option<PathBuf> {
        if depth > 12 || *budget == 0 {
            return None;
        }
        let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .flatten()
            .map(|e| e.path())
            .collect();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                if let Some(found) = visit(&path, depth + 1, budget) {
                    return Some(found);
                }
            } else if path.extension().and_then(|e| e.to_str()) == Some("java") {
                *budget = budget.saturating_sub(1);
                let text = std::fs::read_to_string(&path).unwrap_or_default();
                if text
                    .lines()
                    .any(|line| line.trim_start().starts_with("@Mod("))
                {
                    return Some(path);
                }
            }
        }
        None
    }
    let mut budget = 3000;
    let file = visit(java, 0, &mut budget)?;
    let text = std::fs::read_to_string(&file).ok()?;
    let package = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("package "))
        .map(|rest| rest.trim_end_matches(';').trim().to_string())?;
    let class = file.file_stem()?.to_str()?.to_string();
    split_class(&format!("{package}.{class}"))
}

/// Premier bloc `[[mods]]` d'un `mods.toml` : identifiant, nom, version, description, auteurs.
fn mods_toml(
    text: &str,
    props: &BTreeMap<String, String>,
) -> Option<BTreeMap<&'static str, String>> {
    let value: toml::Value = toml::from_str(text).ok()?;
    let entry = value.get("mods")?.as_array()?.first()?.as_table()?;
    let get = |key: &str| {
        entry
            .get(key)
            .and_then(|v| v.as_str())
            .map(|v| expand(v, props))
    };
    let mut out = BTreeMap::new();
    out.insert("id", get("modId")?);
    for (field, key) in [
        ("name", "displayName"),
        ("version", "version"),
        ("description", "description"),
        ("author", "authors"),
    ] {
        if let Some(v) = get(key) {
            out.insert(field, v.trim().to_string());
        }
    }
    Some(out)
}

fn gradle_version(root: &Path) -> Option<String> {
    let text =
        std::fs::read_to_string(root.join("gradle/wrapper/gradle-wrapper.properties")).ok()?;
    let url = properties(&text).get("distributionUrl")?.clone();
    let name = url.rsplit('/').next()?;
    let version = name.strip_prefix("gradle-")?;
    Some(version.split('-').next()?.to_string())
}

/// Examine un dossier ; `problem` dit pourquoi il ne peut pas être importé.
pub fn inspect(root: &Path, all: &[Profile]) -> ImportPreview {
    let mut preview = ImportPreview {
        path: root.display().to_string(),
        ..ImportPreview::default()
    };
    let fail = |mut p: ImportPreview, why: &str| {
        p.problem = Some(why.to_string());
        p
    };
    if root.join(".mcstudio/project.json").is_file() {
        preview.existing = true;
        return fail(
            preview,
            "Ce dossier est déjà un projet Mod Studio : ouvrez-le directement.",
        );
    }
    let gradle = ["build.gradle", "build.gradle.kts"]
        .iter()
        .any(|f| root.join(f).is_file());
    if !gradle {
        return fail(
            preview,
            "Pas de build.gradle : ce dossier n'est pas un projet de mod Gradle.",
        );
    }
    let props =
        properties(&std::fs::read_to_string(root.join("gradle.properties")).unwrap_or_default());
    let resources = root.join("src/main/resources");

    // Loader et métadonnées du mod.
    let fabric = resources.join("fabric.mod.json");
    let neo_toml = resources.join("META-INF/neoforge.mods.toml");
    let forge_toml = resources.join("META-INF/mods.toml");
    let neo_props = first(&props, &["neo_version", "neoforge_version"]).is_some();
    if fabric.is_file() {
        preview.loader = Some(LoaderId::Fabric);
        let json: Value = std::fs::read_to_string(&fabric)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Value::Null);
        let text = |key: &str| {
            json.get(key)
                .and_then(Value::as_str)
                .map(|v| expand(v, &props))
        };
        preview.mod_id = text("id").unwrap_or_default();
        preview.name = text("name").unwrap_or_default();
        preview.description = text("description").unwrap_or_default();
        preview.mod_version = text("version").unwrap_or_default();
        preview.author = json
            .get("authors")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(|a| {
                a.as_str()
                    .map(str::to_string)
                    .or_else(|| a.get("name").and_then(Value::as_str).map(str::to_string))
            })
            .unwrap_or_default();
        let main = json.pointer("/entrypoints/main/0").and_then(|e| {
            e.as_str()
                .map(str::to_string)
                .or_else(|| e.get("value").and_then(Value::as_str).map(str::to_string))
        });
        if let Some((package, class)) = main
            .as_deref()
            .and_then(|m| split_class(m.split("::").next().unwrap_or(m)))
        {
            preview.package = package;
            preview.main_class = class;
        }
        preview.minecraft = first(&props, &["minecraft_version", "mc_version"])
            .cloned()
            .unwrap_or_default();
        preview.loader_version = first(&props, &["loader_version", "fabric_loader_version"])
            .cloned()
            .unwrap_or_default();
        preview.mappings_version = first(&props, &["yarn_mappings"]).cloned();
        preview.api_version = first(&props, &["fabric_version", "fabric_api_version"]).cloned();
        if preview.mappings_version.is_none() {
            preview.notes.push(
                "Pas de Yarn dans gradle.properties (mappings officiels ?) : les générateurs d'objets et de blocs de Mod Studio écrivent du code Yarn.".into(),
            );
        }
    } else if neo_toml.is_file() || (forge_toml.is_file() && neo_props) {
        preview.loader = Some(LoaderId::Neoforge);
        let file = if neo_toml.is_file() {
            neo_toml
        } else {
            forge_toml
        };
        apply_toml(&mut preview, &file, &props);
        preview.minecraft = first(&props, &["minecraft_version", "mc_version"])
            .cloned()
            .unwrap_or_default();
        preview.loader_version = first(&props, &["neo_version", "neoforge_version"])
            .cloned()
            .unwrap_or_default();
    } else if forge_toml.is_file() {
        preview.loader = Some(LoaderId::Forge);
        apply_toml(&mut preview, &forge_toml, &props);
        preview.minecraft = first(&props, &["minecraft_version", "mc_version"])
            .cloned()
            .unwrap_or_default();
        // `1.20.1-47.2.0` → `47.2.0`.
        let forge = first(&props, &["forge_version"])
            .cloned()
            .unwrap_or_default();
        preview.loader_version = match forge.split_once('-') {
            Some((mc, rest)) if mc == preview.minecraft => rest.to_string(),
            _ => forge,
        };
    } else {
        return fail(
            preview,
            "Ni fabric.mod.json, ni META-INF/mods.toml, ni META-INF/neoforge.mods.toml : loader introuvable.",
        );
    }
    if preview.package.is_empty() {
        if let Some((package, class)) = find_mod_class(&root.join("src/main/java")) {
            preview.package = package;
            preview.main_class = class;
        } else if let Some(group) = first(&props, &["maven_group", "mod_group_id", "group"]) {
            preview.package = group.clone();
            preview
                .notes
                .push("Classe principale introuvable : le paquet vient du groupe Maven.".into());
        }
    }
    if preview.mod_version.is_empty() || preview.mod_version.contains("${") {
        preview.mod_version = first(&props, &["mod_version", "version"])
            .cloned()
            .unwrap_or_else(|| "1.0.0".into());
    }
    if preview.name.is_empty() {
        preview.name = preview.mod_id.clone();
    }
    preview.gradle = gradle_version(root);

    // Ce qui manque pour construire le projet.
    let loader = preview.loader.unwrap_or(LoaderId::Fabric);
    let valid_id = !preview.mod_id.is_empty()
        && preview
            .mod_id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if !valid_id {
        return fail(
            preview,
            "Identifiant du mod introuvable ou invalide dans les métadonnées.",
        );
    }
    if preview.minecraft.is_empty() {
        return fail(
            preview,
            "Version de Minecraft introuvable dans gradle.properties (minecraft_version).",
        );
    }
    if preview.loader_version.is_empty() {
        return fail(
            preview,
            "Version du loader introuvable dans gradle.properties.",
        );
    }
    if preview.package.is_empty() {
        return fail(
            preview,
            "Paquet Java introuvable (classe principale ou groupe Maven).",
        );
    }
    match profiles::matching(all, loader, &preview.minecraft) {
        Some(profile) => preview.profile_id = Some(profile.id.clone()),
        None => {
            return fail(
                preview.clone(),
                &format!(
                    "Minecraft {} avec {} n'est pas pris en charge par Mod Studio.",
                    preview.minecraft,
                    loader.label()
                ),
            )
        }
    }
    preview
}

fn apply_toml(preview: &mut ImportPreview, file: &Path, props: &BTreeMap<String, String>) {
    let text = std::fs::read_to_string(file).unwrap_or_default();
    if let Some(found) = mods_toml(&text, props) {
        preview.mod_id = found.get("id").cloned().unwrap_or_default();
        preview.name = found.get("name").cloned().unwrap_or_default();
        preview.mod_version = found.get("version").cloned().unwrap_or_default();
        preview.description = found.get("description").cloned().unwrap_or_default();
        preview.author = found.get("author").cloned().unwrap_or_default();
    }
}

/// Métadonnées Mod Studio d'un projet importé (l'examen doit avoir réussi).
pub fn meta_from(
    preview: &ImportPreview,
    profile: &Profile,
    license: License,
) -> AppResult<ProjectMeta> {
    if let Some(problem) = &preview.problem {
        return Err(AppError::invalid(problem.clone()));
    }
    let loader = preview
        .loader
        .ok_or_else(|| AppError::invalid("Loader inconnu."))?;
    Ok(ProjectMeta {
        format: super::projects::META_FORMAT,
        id: uuid::Uuid::new_v4().to_string(),
        name: preview.name.clone(),
        mod_id: preview.mod_id.clone(),
        package: preview.package.clone(),
        main_class: preview.main_class.clone(),
        author: if preview.author.is_empty() {
            "Unknown".into()
        } else {
            preview.author.clone()
        },
        description: preview.description.clone(),
        mod_version: preview.mod_version.clone(),
        license,
        versions: ResolvedVersions {
            profile_id: profile.id.clone(),
            loader,
            minecraft: preview.minecraft.clone(),
            loader_version: preview.loader_version.clone(),
            mappings_version: preview.mappings_version.clone(),
            api_version: preview.api_version.clone(),
            java: profile.java,
            java_max: profile.java_max,
            gradle: preview
                .gradle
                .clone()
                .unwrap_or_else(|| profile.gradle.clone()),
            plugin: profile.plugin.clone(),
            offline: false,
        },
        java_home: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// Licence MIT si le fichier LICENSE le dit, sinon aucune.
pub fn license_of(root: &Path) -> License {
    let mit = ["LICENSE", "LICENSE.txt", "LICENSE.md"]
        .iter()
        .filter_map(|name| std::fs::read_to_string(root.join(name)).ok())
        .any(|text| {
            text.contains("MIT License")
                || text.contains("Permission is hereby granted, free of charge")
        });
    if mit {
        License::Mit
    } else {
        License::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("mcstudio-import-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    fn all() -> Vec<Profile> {
        profiles::load_all(Path::new("/nonexistent"))
    }

    #[test]
    fn a_fabric_project_is_recognised() {
        let root = temp("fabric");
        write(&root, "build.gradle", "plugins { id 'fabric-loom' }");
        write(
            &root,
            "gradle.properties",
            "# Fabric\nminecraft_version=1.21.1\nyarn_mappings=1.21.1+build.3\nloader_version=0.16.5\nfabric_version=0.105.0+1.21.1\nmod_version=2.3.0\n",
        );
        write(
            &root,
            "gradle/wrapper/gradle-wrapper.properties",
            "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10-bin.zip\n",
        );
        write(
            &root,
            "src/main/resources/fabric.mod.json",
            r#"{"id":"xraygoogles","name":"XRAY Googles","version":"${version}","authors":[{"name":"Kay"}],
               "entrypoints":{"main":["com.kaylloggs.xraygoogles.XRAYGoogles"],"client":["com.kaylloggs.xraygoogles.client.XRAYGooglesClient"]}}"#,
        );
        write(&root, "LICENSE", "MIT License\n...");
        let preview = inspect(&root, &all());
        assert_eq!(preview.problem, None, "{preview:?}");
        assert_eq!(preview.loader, Some(LoaderId::Fabric));
        assert_eq!(preview.mod_id, "xraygoogles");
        assert_eq!(preview.package, "com.kaylloggs.xraygoogles");
        assert_eq!(preview.main_class, "XRAYGoogles");
        assert_eq!(preview.mod_version, "2.3.0");
        assert_eq!(preview.author, "Kay");
        assert_eq!(preview.gradle.as_deref(), Some("8.10"));
        assert_eq!(preview.profile_id.as_deref(), Some("fabric-1.21"));
        let profile = profiles::find(&all(), "fabric-1.21").unwrap().clone();
        let meta = meta_from(&preview, &profile, license_of(&root)).unwrap();
        assert_eq!(meta.license, License::Mit);
        assert_eq!(meta.versions.loader_version, "0.16.5");
        assert_eq!(
            meta.versions.mappings_version.as_deref(),
            Some("1.21.1+build.3")
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn forge_and_neoforge_projects_are_recognised() {
        let root = temp("forge");
        write(&root, "build.gradle", "");
        write(&root, "gradle.properties", "minecraft_version=1.20.1\nforge_version=1.20.1-47.2.0\nmod_id=rubies\nmod_name=Rubies\nmod_version=1.0\n");
        write(&root, "src/main/resources/META-INF/mods.toml", "modLoader=\"javafml\"\n[[mods]]\nmodId=\"${mod_id}\"\ndisplayName=\"${mod_name}\"\nversion=\"${mod_version}\"\n");
        write(
            &root,
            "src/main/java/net/demo/rubies/Rubies.java",
            "package net.demo.rubies;\n\n@Mod(Rubies.MODID)\npublic class Rubies {}\n",
        );
        let preview = inspect(&root, &all());
        assert_eq!(preview.problem, None, "{preview:?}");
        assert_eq!(preview.loader, Some(LoaderId::Forge));
        assert_eq!(
            (preview.mod_id.as_str(), preview.name.as_str()),
            ("rubies", "Rubies")
        );
        assert_eq!(preview.loader_version, "47.2.0");
        assert_eq!(
            (preview.package.as_str(), preview.main_class.as_str()),
            ("net.demo.rubies", "Rubies")
        );

        let neo = temp("neo");
        write(&neo, "build.gradle", "");
        write(
            &neo,
            "gradle.properties",
            "minecraft_version=1.21.1\nneo_version=21.1.72\n",
        );
        write(
            &neo,
            "src/main/resources/META-INF/neoforge.mods.toml",
            "[[mods]]\nmodId=\"gems\"\n",
        );
        write(
            &neo,
            "src/main/java/a/b/Gems.java",
            "package a.b;\n@Mod(\"gems\")\nclass Gems {}\n",
        );
        let preview = inspect(&neo, &all());
        assert_eq!(preview.problem, None, "{preview:?}");
        assert_eq!(preview.loader, Some(LoaderId::Neoforge));
        assert_eq!(preview.profile_id.as_deref(), Some("neoforge-1.21"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&neo);
    }

    #[test]
    fn unusable_folders_say_why() {
        let root = temp("empty");
        assert!(inspect(&root, &all())
            .problem
            .unwrap()
            .contains("build.gradle"));
        write(&root, "build.gradle", "");
        assert!(inspect(&root, &all()).problem.unwrap().contains("loader"));
        write(
            &root,
            "src/main/resources/fabric.mod.json",
            r#"{"id":"old","entrypoints":{"main":["a.B"]}}"#,
        );
        write(
            &root,
            "gradle.properties",
            "minecraft_version=1.12.2\nloader_version=0.1\n",
        );
        assert!(inspect(&root, &all())
            .problem
            .unwrap()
            .contains("pas pris en charge"));
        write(&root, ".mcstudio/project.json", "{}");
        assert!(inspect(&root, &all()).problem.unwrap().contains("déjà"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
