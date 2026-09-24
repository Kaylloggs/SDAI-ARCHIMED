//! Profils de version : pour chaque couple loader × plage de Minecraft, l'outillage
//! (Java, Gradle, plugin), les mappings, le template et le format de données.
//!
//! Les profils livrés sont embarqués (`defaults/*.toml`). Un fichier du même `id` déposé
//! dans `<données>/modules/mcstudio/profiles/` les remplace : corriger une version de
//! plugin ne demande pas de recompiler ARCHIMED.

pub mod meta;

use std::cmp::Ordering;
use std::path::Path;

use serde::Deserialize;

use crate::core::{AppError, AppResult};

use super::types::{LoaderId, ProfileInfo};

const DEFAULTS: &[(&str, &str)] = &[
    (
        "fabric-1.20.toml",
        include_str!("defaults/fabric-1.20.toml"),
    ),
    (
        "fabric-1.21.toml",
        include_str!("defaults/fabric-1.21.toml"),
    ),
    ("forge-1.20.toml", include_str!("defaults/forge-1.20.toml")),
    (
        "neoforge-1.21.toml",
        include_str!("defaults/neoforge-1.21.toml"),
    ),
];

/// Variante de code Java générée (API qui diffère d'une version à l'autre).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Dialect {
    #[serde(rename = "fabric-yarn-1.20")]
    FabricYarn120,
    #[serde(rename = "fabric-yarn-1.21")]
    FabricYarn121,
    #[serde(rename = "forge-1.20")]
    Forge120,
    #[serde(rename = "neoforge-1.21")]
    NeoForge121,
}

/// Emplacement et forme des fichiers de données (datapack) selon la version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum DataFormat {
    /// `recipes/`, `loot_tables/`, `tags/items/`, résultat `{"item": …}`.
    #[serde(rename = "1.20")]
    V1_20,
    /// `recipe/`, `loot_table/`, `tags/item/`, résultat `{"id": …}`.
    #[serde(rename = "1.21")]
    V1_21,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    pub id: String,
    pub loader: LoaderId,
    pub label: String,
    pub minecraft_min: String,
    pub minecraft_max: String,
    pub java: u32,
    #[serde(default)]
    pub java_max: Option<u32>,
    pub gradle: String,
    /// Version du plugin Gradle du loader (Loom, ForgeGradle, ModDevGradle).
    pub plugin: String,
    pub mappings: String,
    pub template: String,
    pub dialect: Dialect,
    pub data_format: DataFormat,
    pub pack_format: u32,
}

impl Profile {
    pub fn covers(&self, minecraft: &str) -> bool {
        let (Some(version), Some(min), Some(max)) = (
            parse_release(minecraft),
            parse_release(&self.minecraft_min),
            parse_release(&self.minecraft_max),
        ) else {
            return false;
        };
        version >= min && version <= max
    }

    pub fn info(&self) -> ProfileInfo {
        ProfileInfo {
            id: self.id.clone(),
            loader: self.loader,
            label: self.label.clone(),
            minecraft_min: self.minecraft_min.clone(),
            minecraft_max: self.minecraft_max.clone(),
            java: self.java,
            java_max: self.java_max,
            gradle: self.gradle.clone(),
            mappings: self.mappings.clone(),
        }
    }
}

/// Profils livrés, remplacés par ceux de l'utilisateur de même `id`.
pub fn load_all(user_dir: &Path) -> Vec<Profile> {
    let mut profiles: Vec<Profile> = DEFAULTS
        .iter()
        .filter_map(|(name, raw)| match toml::from_str::<Profile>(raw) {
            Ok(profile) => Some(profile),
            Err(error) => {
                tracing::error!("profil embarqué {name} invalide : {error}");
                None
            }
        })
        .collect();

    if let Ok(entries) = std::fs::read_dir(user_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_none_or(|ext| ext != "toml") {
                continue;
            }
            let parsed = std::fs::read_to_string(&path)
                .map_err(|e| e.to_string())
                .and_then(|raw| toml::from_str::<Profile>(&raw).map_err(|e| e.to_string()));
            match parsed {
                Ok(profile) => {
                    profiles.retain(|p| p.id != profile.id);
                    profiles.push(profile);
                }
                Err(error) => tracing::warn!("profil {} ignoré : {error}", path.display()),
            }
        }
    }
    profiles.sort_by(|a, b| a.id.cmp(&b.id));
    profiles
}

pub fn find<'a>(profiles: &'a [Profile], id: &str) -> AppResult<&'a Profile> {
    profiles
        .iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::not_found(format!("profil de version inconnu : {id}")))
}

/// Profil qui construit `minecraft` pour `loader`, s'il existe.
pub fn matching<'a>(
    profiles: &'a [Profile],
    loader: LoaderId,
    minecraft: &str,
) -> Option<&'a Profile> {
    profiles
        .iter()
        .find(|p| p.loader == loader && p.covers(minecraft))
}

/// Version publiée de Minecraft (`1.21.1` → `[1, 21, 1]`). Snapshots, pré-versions et
/// release candidates renvoient `None` : aucun profil ne les couvre.
pub fn parse_release(version: &str) -> Option<Vec<u32>> {
    let parts: Option<Vec<u32>> = version.split('.').map(|part| part.parse().ok()).collect();
    parts.filter(|p| p.len() >= 2)
}

pub fn compare_releases(a: &str, b: &str) -> Ordering {
    match (parse_release(a), parse_release(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        (Some(_), None) => Ordering::Greater,
        (None, Some(_)) => Ordering::Less,
        (None, None) => a.cmp(b),
    }
}

/// Première version mineure suivante (`1.20.1` → `1.21`), borne haute des dépendances.
pub fn next_minor(version: &str) -> String {
    match parse_release(version) {
        Some(parts) => format!("{}.{}", parts[0], parts[1] + 1),
        None => version.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_embedded_profile_parses() {
        let dir = std::env::temp_dir().join("mcstudio-no-user-profiles");
        let profiles = load_all(&dir);
        assert_eq!(profiles.len(), DEFAULTS.len());
        for profile in &profiles {
            assert!(
                crate::modules::mcstudio::templates::TEMPLATE_IDS
                    .contains(&profile.template.as_str()),
                "{} : template inconnu",
                profile.id
            );
        }
    }

    #[test]
    fn ranges_are_inclusive_and_skip_snapshots() {
        let profiles = load_all(&std::env::temp_dir().join("mcstudio-none"));
        let fabric = find(&profiles, "fabric-1.21").unwrap();
        assert!(fabric.covers("1.21"));
        assert!(fabric.covers("1.21.1"));
        assert!(!fabric.covers("1.21.2"));
        assert!(!fabric.covers("24w14a"));
        assert!(!fabric.covers("1.21-rc1"));
        assert_eq!(
            matching(&profiles, LoaderId::Forge, "1.20.1").unwrap().id,
            "forge-1.20"
        );
        assert!(matching(&profiles, LoaderId::Forge, "1.21.1").is_none());
    }

    #[test]
    fn user_profile_replaces_embedded_one() {
        let dir = std::env::temp_dir().join(format!("mcstudio-profiles-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw =
            include_str!("defaults/fabric-1.21.toml").replace("1.10-SNAPSHOT", "1.99-SNAPSHOT");
        std::fs::write(dir.join("mine.toml"), raw).unwrap();
        let profiles = load_all(&dir);
        assert_eq!(
            find(&profiles, "fabric-1.21").unwrap().plugin,
            "1.99-SNAPSHOT"
        );
        assert_eq!(profiles.len(), DEFAULTS.len());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(compare_releases("1.21.10", "1.21.9"), Ordering::Greater);
        assert_eq!(compare_releases("1.20", "1.20.1"), Ordering::Less);
        assert_eq!(next_minor("1.20.1"), "1.21");
        assert_eq!(next_minor("1.21"), "1.22");
    }
}
