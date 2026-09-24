//! Portage d'un projet vers une autre version de Minecraft (même loader).
//!
//! Mod Studio fait ce qui est mécanique, après un point de restauration :
//! - fichiers de build et de métadonnées : réécrits depuis le template de la version cible s'ils
//!   n'ont pas été modifiés à la main, sinon seules leurs versions changent (Minecraft, loader,
//!   mappings, Java, Gradle, plugin, format du pack) ;
//! - dossiers de données renommés au passage de 1.21 (`recipes/` ↔ `recipe/`…) ;
//! - définitions de modèle d'objet (`assets/<modid>/items/`) créées à partir de 1.21.4.
//!
//! Le code Java n'est pas réécrit : un message prêt pour l'assistant IA liste les changements
//! d'API connus et montre les classes de départ attendues pour la version cible.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use regex::Regex;

use crate::core::{AppError, AppResult};

use super::fsutil;
use super::profiles::{self, next_minor, DataFormat, Profile};
use super::projects;
use super::snapshots;
use super::types::{LoaderId, PortPlan, PortStep, ProjectMeta, SnapshotKind};

/// Fichiers de build et de métadonnées gérés par le portage.
const MANAGED: [&str; 8] = [
    "gradle.properties",
    "build.gradle",
    "settings.gradle",
    "gradle/wrapper/gradle-wrapper.properties",
    "src/main/resources/pack.mcmeta",
    "src/main/resources/fabric.mod.json",
    "src/main/resources/META-INF/mods.toml",
    "src/main/resources/META-INF/neoforge.mods.toml",
];

/// Dossiers de données au pluriel (jusqu'à 1.20.6) et au singulier (1.21+).
const DATA_DIRS: [(&str, &str); 13] = [
    ("recipes", "recipe"),
    ("loot_tables", "loot_table"),
    ("advancements", "advancement"),
    ("structures", "structure"),
    ("predicates", "predicate"),
    ("item_modifiers", "item_modifier"),
    ("functions", "function"),
    ("tags/blocks", "tags/block"),
    ("tags/items", "tags/item"),
    ("tags/entity_types", "tags/entity_type"),
    ("tags/fluids", "tags/fluid"),
    ("tags/game_events", "tags/game_event"),
    ("tags/functions", "tags/function"),
];

/// Ce que le portage va écrire, déplacer et supprimer.
#[derive(Debug, Default)]
pub struct Changes {
    pub writes: Vec<(String, Vec<u8>)>,
    pub moves: Vec<(String, String)>,
    pub deletes: Vec<String>,
    pub done: Vec<String>,
    pub warnings: Vec<String>,
}

impl Changes {
    fn touched(&self) -> Vec<String> {
        let mut all: BTreeSet<String> = self.writes.iter().map(|(p, _)| p.clone()).collect();
        all.extend(self.deletes.iter().cloned());
        for (from, to) in &self.moves {
            all.insert(from.clone());
            all.insert(to.clone());
        }
        all.into_iter().collect()
    }
}

/// Profil cible d'un portage, ou pourquoi il n'y en a pas.
pub fn target_profile<'a>(
    all: &'a [Profile],
    meta: &ProjectMeta,
    minecraft: &str,
) -> AppResult<&'a Profile> {
    if minecraft == meta.versions.minecraft {
        return Err(AppError::invalid(
            "Le projet est déjà sur cette version de Minecraft.",
        ));
    }
    profiles::matching(all, meta.versions.loader, minecraft).ok_or_else(|| {
        AppError::invalid(profiles::unsupported_reason(
            meta.versions.loader,
            minecraft,
        ))
    })
}

fn crosses(from: DataFormat, to: DataFormat, at: DataFormat) -> bool {
    (from < at) != (to < at)
}

/// Changements d'API connus entre deux versions (pour la personne et pour l'assistant).
fn api_notes(from: &Profile, to: &Profile, loader: LoaderId) -> Vec<String> {
    let yarn = loader == LoaderId::Fabric;
    let mut notes = Vec::new();
    let (a, b) = (from.data_format, to.data_format);
    let java = |p: &Profile| p.release();
    if java(from) != java(to) {
        notes.push(format!(
            "Java {} au lieu de Java {} : un JDK adapté est nécessaire (Mod Studio propose de l'installer).",
            to.java,
            from.java
        ));
    }
    if from.template != to.template
        && (from.template.ends_with("legacy") || to.template.ends_with("legacy"))
    {
        notes.push(
            "Passage de 1.16 à 1.17 : Java 16/17, nouveau système de modèles d'entité (ModelPart, LayerDefinition), noms de paquets et de classes du jeu très différents."
                .into(),
        );
    }
    if crosses(a, b, DataFormat::V1_20_5) {
        notes.push(
            "1.20.5 : les piles d'objets utilisent des composants de données (DataComponentTypes / DataComponents) à la place du NBT ; le résultat d'une recette s'écrit {\"id\": …} et non {\"item\": …}."
                .into(),
        );
    }
    if crosses(a, b, DataFormat::V1_21) {
        notes.push(if yarn {
            "1.21 : `new Identifier(ns, path)` devient `Identifier.of(ns, path)` ; dossiers de données au singulier (déjà déplacés) ; enchantements définis en données.".into()
        } else {
            "1.21 : `new ResourceLocation(ns, path)` devient `ResourceLocation.fromNamespaceAndPath(ns, path)` ; dossiers de données au singulier (déjà déplacés) ; enchantements définis en données.".into()
        });
    }
    if crosses(a, b, DataFormat::V1_21_2) {
        notes.push(if yarn {
            "1.21.2 : chaque objet et bloc reçoit sa clé de registre avant sa construction (`Item.Settings#registryKey`, `AbstractBlock.Settings#registryKey`) ; ingrédients des recettes écrits en texte (\"minecraft:stick\").".into()
        } else {
            "1.21.2 : chaque objet et bloc reçoit sa clé de registre avant sa construction (`Item.Properties#setId`, `BlockBehaviour.Properties#setId`) ; ingrédients des recettes écrits en texte (\"minecraft:stick\").".into()
        });
    }
    if crosses(a, b, DataFormat::V1_21_4) {
        notes.push(
            "1.21.4 : chaque objet a une définition de modèle dans assets/<modid>/items/ (créées par Mod Studio pour les modèles existants)."
                .into(),
        );
    }
    notes
}

/// Ce que le portage fera, sans rien écrire (pour la personne, avant de confirmer).
pub fn plan(meta: &ProjectMeta, from: &Profile, to: &Profile, target: &str) -> PortPlan {
    let mut steps = vec![
        PortStep {
            title: "Fichiers de build".into(),
            detail: format!(
                "gradle.properties, build.gradle, settings.gradle, wrapper Gradle ({} → {}) : réécrits depuis le modèle de {target} s'ils n'ont pas été modifiés, sinon seules leurs versions changent.",
                meta.versions.gradle, to.gradle
            ),
            automatic: true,
        },
        PortStep {
            title: "Métadonnées du mod".into(),
            detail: "Versions de Minecraft, du loader et de Java dans fabric.mod.json ou mods.toml ; format du pack.".into(),
            automatic: true,
        },
    ];
    if crosses(from.data_format, to.data_format, DataFormat::V1_21) {
        steps.push(PortStep {
            title: "Dossiers de données".into(),
            detail: if to.data_format >= DataFormat::V1_21 {
                "recipes/ → recipe/, loot_tables/ → loot_table/, tags/blocks/ → tags/block/… (tous les espaces de noms).".into()
            } else {
                "recipe/ → recipes/, loot_table/ → loot_tables/, tags/block/ → tags/blocks/… (tous les espaces de noms).".into()
            },
            automatic: true,
        });
    }
    if from.data_format < DataFormat::V1_21_4 && to.data_format >= DataFormat::V1_21_4 {
        steps.push(PortStep {
            title: "Définitions de modèle d'objet".into(),
            detail: "Un fichier assets/<modid>/items/<objet>.json par modèle d'objet existant."
                .into(),
            automatic: true,
        });
    }
    steps.push(PortStep {
        title: "Code Java et JSON".into(),
        detail: "À adapter aux changements d'API : un message prêt est proposé à l'assistant IA, qui compile et corrige.".into(),
        automatic: false,
    });
    PortPlan {
        from_minecraft: meta.versions.minecraft.clone(),
        to_minecraft: target.to_string(),
        from_profile: from.id.clone(),
        to_profile: to.id.clone(),
        steps,
        notes: api_notes(from, to, meta.versions.loader),
    }
}

fn read(root: &Path, relative: &str) -> Option<String> {
    std::fs::read_to_string(root.join(relative)).ok()
}

/// `clé=valeur` remplacées ou ajoutées dans un `.properties`, commentaires et ordre gardés.
fn set_properties(text: &str, values: &BTreeMap<&str, String>) -> String {
    let mut seen = BTreeSet::new();
    let mut out: Vec<String> = text
        .lines()
        .map(|line| {
            let trimmed = line.trim_start();
            if let Some((key, _)) = trimmed.split_once('=') {
                if let Some(value) = values.get(key.trim()) {
                    seen.insert(key.trim().to_string());
                    return format!("{}={value}", key.trim());
                }
            }
            line.to_string()
        })
        .collect();
    for (key, value) in values {
        if !seen.contains(*key) {
            out.push(format!("{key}={value}"));
        }
    }
    let mut joined = out.join("\n");
    joined.push('\n');
    joined
}

fn replace_all(text: &str, pattern: &str, replacement: &str) -> String {
    match Regex::new(pattern) {
        Ok(re) => re.replace_all(text, replacement).into_owned(),
        Err(_) => text.to_string(),
    }
}

/// Seules les versions d'un fichier modifié à la main changent.
fn surgical(
    relative: &str,
    text: &str,
    old: &ProjectMeta,
    new: &ProjectMeta,
    from: &Profile,
    to: &Profile,
) -> String {
    let (o, n) = (&old.versions, &new.versions);
    match relative {
        "gradle.properties" => {
            let mut values = BTreeMap::new();
            values.insert("minecraft_version", n.minecraft.clone());
            match n.loader {
                LoaderId::Fabric => {
                    values.insert("loader_version", n.loader_version.clone());
                    if let Some(yarn) = &n.mappings_version {
                        values.insert("yarn_mappings", yarn.clone());
                    }
                    if let Some(api) = &n.api_version {
                        values.insert("fabric_version", api.clone());
                    }
                }
                LoaderId::Forge => {
                    values.insert("forge_version", n.loader_version.clone());
                }
                LoaderId::Neoforge => {
                    values.insert("neo_version", n.loader_version.clone());
                }
            }
            // Seules les clés déjà présentes changent (sauf la version de Minecraft).
            let present: BTreeSet<String> = text
                .lines()
                .filter_map(|l| l.split_once('=').map(|(k, _)| k.trim().to_string()))
                .collect();
            values.retain(|key, _| *key == "minecraft_version" || present.contains(*key));
            set_properties(text, &values)
        }
        "gradle/wrapper/gradle-wrapper.properties" => replace_all(
            text,
            r"gradle-[0-9][0-9A-Za-z.\-]*-(bin|all)\.zip",
            &format!("gradle-{}-$1.zip", n.gradle),
        ),
        "src/main/resources/pack.mcmeta" => replace_all(
            text,
            r#""pack_format"\s*:\s*\d+"#,
            &format!("\"pack_format\": {}", to.pack_format),
        ),
        "src/main/resources/fabric.mod.json" => {
            let text = replace_all(
                text,
                r#""minecraft"\s*:\s*"[^"]*""#,
                &format!("\"minecraft\": \"~{}\"", n.minecraft),
            );
            let text = replace_all(
                &text,
                r#""fabricloader"\s*:\s*"[^"]*""#,
                &format!("\"fabricloader\": \">={}\"", n.loader_version),
            );
            replace_all(
                &text,
                r#""java"\s*:\s*"[^"]*""#,
                &format!("\"java\": \">={}\"", to.release()),
            )
        }
        "src/main/resources/META-INF/mods.toml"
        | "src/main/resources/META-INF/neoforge.mods.toml" => {
            let text = text.replace(
                &format!("[{},{})", o.minecraft, next_minor(&o.minecraft)),
                &format!("[{},{})", n.minecraft, next_minor(&n.minecraft)),
            );
            let old_major = o.loader_version.split('.').next().unwrap_or("");
            let new_major = n.loader_version.split('.').next().unwrap_or("");
            if old_major.is_empty() || new_major.is_empty() {
                text
            } else {
                text.replace(&format!("[{old_major},)"), &format!("[{new_major},)"))
            }
        }
        // build.gradle, settings.gradle : versions du plugin et de Java.
        _ => {
            let mut out = text.to_string();
            if !o.plugin.is_empty() && o.plugin != n.plugin {
                out = out.replace(&format!("'{}'", o.plugin), &format!("'{}'", n.plugin));
                out = out.replace(&format!("\"{}\"", o.plugin), &format!("\"{}\"", n.plugin));
            }
            let (old_release, new_release) = (from.release(), to.release());
            if old_release != new_release {
                out = replace_all(
                    &out,
                    &format!(r"release\s*=\s*{old_release}\b"),
                    &format!("release = {new_release}"),
                );
                out = replace_all(
                    &out,
                    &format!(r"JavaLanguageVersion\.of\({old_release}\)"),
                    &format!("JavaLanguageVersion.of({new_release})"),
                );
                let enum_of = |r: u32| {
                    if r <= 8 {
                        format!("1_{r}")
                    } else {
                        r.to_string()
                    }
                };
                out = out.replace(
                    &format!("JavaVersion.VERSION_{}", enum_of(old_release)),
                    &format!("JavaVersion.VERSION_{}", enum_of(new_release)),
                );
            }
            out
        }
    }
}

/// Fichiers `data/<espace>/<dossier>/…` à déplacer d'un nom de dossier à l'autre.
fn data_moves(root: &Path, to_singular: bool, changes: &mut Changes) {
    let data = root.join("src/main/resources/data");
    let Ok(namespaces) = std::fs::read_dir(&data) else {
        return;
    };
    for namespace in namespaces.flatten().filter(|e| e.path().is_dir()) {
        let ns = namespace.file_name().to_string_lossy().to_string();
        for (plural, singular) in DATA_DIRS {
            let (from, to) = if to_singular {
                (plural, singular)
            } else {
                (singular, plural)
            };
            let base = namespace.path().join(from);
            if !base.is_dir() {
                continue;
            }
            let mut files = Vec::new();
            collect(&base, &base, &mut files);
            for file in files {
                let source = format!("src/main/resources/data/{ns}/{from}/{file}");
                let target = format!("src/main/resources/data/{ns}/{to}/{file}");
                if root.join(&target).exists() {
                    changes.warnings.push(format!(
                        "{target} existe déjà : {source} n'a pas été déplacé."
                    ));
                } else {
                    changes.moves.push((source, target));
                }
            }
        }
    }
}

fn collect(base: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(base, &path, out);
        } else if let Ok(relative) = path.strip_prefix(base) {
            out.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}

/// Tout ce que le portage va faire, calculé sans rien écrire.
pub fn changes(
    root: &Path,
    old: &ProjectMeta,
    from: &Profile,
    new: &ProjectMeta,
    to: &Profile,
) -> AppResult<Changes> {
    let mut changes = Changes::default();
    let before: BTreeMap<String, Vec<u8>> = projects::render_project(from, old)?
        .into_iter()
        .map(|(path, bytes, _)| (path, bytes))
        .collect();
    let after: BTreeMap<String, Vec<u8>> = projects::render_project(to, new)?
        .into_iter()
        .map(|(path, bytes, _)| (path, bytes))
        .collect();
    for relative in MANAGED {
        let current = read(root, relative);
        let expected = before
            .get(relative)
            .map(|b| String::from_utf8_lossy(b).to_string());
        let target = after
            .get(relative)
            .map(|b| String::from_utf8_lossy(b).to_string());
        match (current, target) {
            (None, Some(target)) => {
                changes
                    .writes
                    .push((relative.to_string(), target.into_bytes()));
            }
            (Some(current), None) => {
                // Fichier que la version cible n'utilise plus (mods.toml de NeoForge 1.20.4).
                if relative.ends_with("mods.toml") && after.keys().any(|k| k.ends_with("mods.toml"))
                {
                    changes.deletes.push(relative.to_string());
                    if Some(&current) != expected.as_ref() {
                        changes.warnings.push(format!(
                            "{relative} avait été modifié : reportez vos changements dans le nouveau fichier (l'ancien est dans le point de restauration)."
                        ));
                    }
                }
            }
            (Some(current), Some(target)) => {
                if Some(&current) == expected.as_ref() {
                    if current != target {
                        changes
                            .writes
                            .push((relative.to_string(), target.into_bytes()));
                    }
                } else {
                    let updated = surgical(relative, &current, old, new, from, to);
                    if updated != current {
                        changes
                            .writes
                            .push((relative.to_string(), updated.into_bytes()));
                    }
                    if relative == "build.gradle" && from.template != to.template {
                        changes.warnings.push(
                            "build.gradle avait été modifié et son modèle change entre ces versions : seules les versions ont été mises à jour. Comparez-le avec celui d'un nouveau projet de cette version si la compilation échoue."
                                .into(),
                        );
                    }
                }
            }
            (None, None) => {}
        }
    }
    if !changes.writes.is_empty() {
        changes
            .done
            .push("Fichiers de build et métadonnées mis à jour.".into());
    }

    if crosses(from.data_format, to.data_format, DataFormat::V1_21) {
        data_moves(root, to.data_format >= DataFormat::V1_21, &mut changes);
        if !changes.moves.is_empty() {
            changes.done.push(format!(
                "{} fichier(s) de données déplacé(s) (dossiers de 1.21).",
                changes.moves.len()
            ));
        }
    }

    if from.data_format < DataFormat::V1_21_4 && to.data_format >= DataFormat::V1_21_4 {
        let base = format!("src/main/resources/assets/{}", new.mod_id);
        let mut created = 0;
        if let Ok(entries) = std::fs::read_dir(root.join(&base).join("models/item")) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let Some(stem) = name.strip_suffix(".json") else {
                    continue;
                };
                let definition = format!("{base}/items/{stem}.json");
                if root.join(&definition).exists() {
                    continue;
                }
                let body = format!(
                    "{{\n  \"model\": {{\n    \"type\": \"minecraft:model\",\n    \"model\": \"{}:item/{stem}\"\n  }}\n}}\n",
                    new.mod_id
                );
                changes.writes.push((definition, body.into_bytes()));
                created += 1;
            }
        }
        if created > 0 {
            changes.done.push(format!(
                "{created} définition(s) de modèle d'objet créée(s) (assets/<modid>/items/)."
            ));
        }
    }
    Ok(changes)
}

/// Applique les changements après un point de restauration ; `meta` devient celui du projet.
pub fn apply(root: &Path, meta: &ProjectMeta, changes: &Changes, label: &str) -> AppResult<String> {
    let mut touched = changes.touched();
    touched.push(".mcstudio/project.json".into());
    let snapshot = snapshots::create(root, label, SnapshotKind::Manual, &touched)?;
    for (relative, bytes) in &changes.writes {
        fsutil::write_atomic(&root.join(relative), bytes)?;
    }
    for (from, to) in &changes.moves {
        let target: PathBuf = root.join(to);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(root.join(from), &target)?;
    }
    for relative in &changes.deletes {
        let _ = std::fs::remove_file(root.join(relative));
    }
    projects::save_meta(root, meta)?;
    crate::core::audit::record(
        "mcstudio.port",
        &root.display().to_string(),
        &format!("{} → {}", label, meta.versions.minecraft),
        "user",
    );
    Ok(snapshot.label)
}

/// Message pour l'assistant IA : ce qui a été fait, ce qu'il reste, et le code de départ
/// attendu pour la version cible (généré pour ce mod).
pub fn assistant_prompt(
    old: &ProjectMeta,
    new: &ProjectMeta,
    to: &Profile,
    plan: &PortPlan,
    changes: &Changes,
) -> AppResult<String> {
    let mut lines = vec![
        format!(
            "Porte ce mod de Minecraft {} ({} {}) vers Minecraft {} ({} {}).",
            old.versions.minecraft,
            old.versions.loader.label(),
            old.versions.loader_version,
            new.versions.minecraft,
            new.versions.loader.label(),
            new.versions.loader_version
        ),
        String::new(),
        "Mod Studio a déjà fait :".into(),
    ];
    lines.extend(changes.done.iter().map(|d| format!("- {d}")));
    if changes.done.is_empty() {
        lines.push("- rien de mécanique n'était nécessaire.".into());
    }
    lines.push(String::new());
    lines.push("Il reste le code Java (et les fichiers JSON dont le format a changé). Compile avec gradlew build pour trouver les erreurs, corrige-les, puis recompile jusqu'à ce que la compilation réussisse. Ne touche pas aux versions dans gradle.properties.".into());
    if !plan.notes.is_empty() {
        lines.push(String::new());
        lines.push("Changements connus entre ces versions :".into());
        lines.extend(plan.notes.iter().map(|n| format!("- {n}")));
    }
    // Classes de départ que Mod Studio écrirait pour ce mod dans la version cible.
    let reference: Vec<(String, String)> = projects::render_project(to, new)?
        .into_iter()
        .filter(|(path, _, _)| path.ends_with(".java"))
        .map(|(path, bytes, _)| (path, String::from_utf8_lossy(&bytes).to_string()))
        .collect();
    if !reference.is_empty() {
        lines.push(String::new());
        lines.push(format!(
            "Pour t'aider, voici les classes de départ qu'un nouveau projet Minecraft {} aurait pour ce mod (style d'API attendu) :",
            new.versions.minecraft
        ));
        let mut budget = 12_000usize;
        for (path, text) in reference {
            if text.len() > budget {
                break;
            }
            budget -= text.len();
            lines.push(format!(
                "\n--- {path} ---\n```java\n{}\n```",
                text.trim_end()
            ));
        }
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::types::{License, ResolvedVersions};

    fn meta(
        profile: &str,
        minecraft: &str,
        loader: &str,
        yarn: &str,
        api: &str,
        gradle: &str,
    ) -> ProjectMeta {
        ProjectMeta {
            format: projects::META_FORMAT,
            id: "p".into(),
            name: "Demo".into(),
            mod_id: "dm".into(),
            package: "com.demo.dm".into(),
            main_class: "Demo".into(),
            author: "Me".into(),
            description: "".into(),
            mod_version: "1.0.0".into(),
            license: License::Mit,
            versions: ResolvedVersions {
                profile_id: profile.into(),
                loader: LoaderId::Fabric,
                minecraft: minecraft.into(),
                loader_version: loader.into(),
                mappings_version: Some(yarn.into()),
                api_version: Some(api.into()),
                java: 21,
                java_max: None,
                gradle: gradle.into(),
                plugin: "1.10-SNAPSHOT".into(),
                offline: false,
            },
            java_home: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        }
    }

    fn write(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn a_fabric_mod_is_ported_to_1_21_then_1_21_4() {
        let root = std::env::temp_dir().join(format!("mcstudio-port-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let all = profiles::load_all(Path::new("/nonexistent"));
        let from = profiles::find(&all, "fabric-1.20").unwrap().clone();
        let old = meta(
            "fabric-1.20",
            "1.20.1",
            "0.15.0",
            "1.20.1+build.10",
            "0.92.0+1.20.1",
            "8.14.3",
        );
        for (path, bytes, _) in projects::render_project(&from, &old).unwrap() {
            let target = root.join(&path);
            std::fs::create_dir_all(target.parent().unwrap()).unwrap();
            std::fs::write(target, bytes).unwrap();
        }
        projects::save_meta(&root, &old).unwrap();
        // Un ajout à la main dans build.gradle, des données au pluriel.
        let build = std::fs::read_to_string(root.join("build.gradle")).unwrap();
        write(
            &root,
            "build.gradle",
            &format!("{build}\n// dépendance ajoutée à la main\n"),
        );
        write(&root, "src/main/resources/data/dm/recipes/gem.json", "{}");
        write(
            &root,
            "src/main/resources/data/minecraft/tags/blocks/mineable/pickaxe.json",
            "{}",
        );
        write(
            &root,
            "src/main/resources/assets/dm/models/item/gem.json",
            "{}",
        );

        let to = target_profile(&all, &old, "1.21.1").unwrap().clone();
        assert_eq!(to.id, "fabric-1.21");
        assert!(
            target_profile(&all, &old, "1.20.1").is_err(),
            "même version"
        );
        let new = meta(
            "fabric-1.21",
            "1.21.1",
            "0.16.5",
            "1.21.1+build.3",
            "0.105.0+1.21.1",
            "8.14.3",
        );
        let steps = plan(&old, &from, &to, "1.21.1");
        assert!(
            steps.notes.iter().any(|n| n.contains("Identifier.of")),
            "{:?}",
            steps.notes
        );
        let first = changes(&root, &old, &from, &new, &to).unwrap();
        let prompt = assistant_prompt(&old, &new, &to, &steps, &first).unwrap();
        assert!(prompt.contains("Minecraft 1.20.1") && prompt.contains("Minecraft 1.21.1"));
        assert!(prompt.contains("```java"), "classes de départ jointes");
        apply(&root, &new, &first, "Avant le portage").unwrap();

        let properties = std::fs::read_to_string(root.join("gradle.properties")).unwrap();
        assert!(
            properties.contains("minecraft_version=1.21.1"),
            "{properties}"
        );
        assert!(properties.contains("yarn_mappings=1.21.1+build.3"));
        let build = std::fs::read_to_string(root.join("build.gradle")).unwrap();
        assert!(
            build.contains("dépendance ajoutée à la main"),
            "retouches gardées"
        );
        let mod_json =
            std::fs::read_to_string(root.join("src/main/resources/fabric.mod.json")).unwrap();
        assert!(
            mod_json.contains("\"minecraft\": \"~1.21.1\""),
            "{mod_json}"
        );
        assert!(root
            .join("src/main/resources/data/dm/recipe/gem.json")
            .is_file());
        assert!(!root
            .join("src/main/resources/data/dm/recipes/gem.json")
            .exists());
        assert!(root
            .join("src/main/resources/data/minecraft/tags/block/mineable/pickaxe.json")
            .is_file());
        assert_eq!(
            projects::read_meta(&root).unwrap().versions.minecraft,
            "1.21.1"
        );
        assert_eq!(snapshots::list(&root).len(), 1);

        // 1.21.4 : définitions de modèle d'objet.
        let to4 = target_profile(&all, &new, "1.21.4").unwrap().clone();
        let mut new4 = meta(
            "fabric-1.21.4",
            "1.21.4",
            "0.16.9",
            "1.21.4+build.1",
            "0.110.0+1.21.4",
            "8.14.3",
        );
        new4.id = "p".into();
        let second = changes(&root, &new, &to, &new4, &to4).unwrap();
        apply(&root, &new4, &second, "Avant 1.21.4").unwrap();
        let definition =
            std::fs::read_to_string(root.join("src/main/resources/assets/dm/items/gem.json"))
                .unwrap();
        assert!(definition.contains("\"dm:item/gem\""));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn surgical_edits_touch_only_versions() {
        let all = profiles::load_all(Path::new("/nonexistent"));
        let from = profiles::find(&all, "fabric-1.20").unwrap();
        let to = profiles::find(&all, "fabric-1.21").unwrap();
        let old = meta(
            "fabric-1.20",
            "1.20.1",
            "0.15.0",
            "1.20.1+build.10",
            "0.92.0+1.20.1",
            "8.10",
        );
        let new = meta(
            "fabric-1.21",
            "1.21.1",
            "0.16.5",
            "1.21.1+build.3",
            "0.105.0+1.21.1",
            "8.14.3",
        );
        let props = "# mine\nminecraft_version=1.20.1\nloader_version=0.15.0\nmy_dep=3.2\n";
        let out = surgical("gradle.properties", props, &old, &new, from, to);
        assert_eq!(
            out,
            "# mine\nminecraft_version=1.21.1\nloader_version=0.16.5\nmy_dep=3.2\n"
        );
        let wrapper =
            "distributionUrl=https\\://services.gradle.org/distributions/gradle-8.10-bin.zip\n";
        assert!(surgical(
            "gradle/wrapper/gradle-wrapper.properties",
            wrapper,
            &old,
            &new,
            from,
            to
        )
        .contains("gradle-8.14.3-bin.zip"));
        let toml = "[[dependencies.dm]]\nmodId=\"minecraft\"\nversionRange=\"[1.20.1,1.21)\"\n";
        let out = surgical(
            "src/main/resources/META-INF/mods.toml",
            toml,
            &old,
            &new,
            from,
            to,
        );
        assert!(out.contains("versionRange=\"[1.21.1,1.22)\""), "{out}");
    }
}
