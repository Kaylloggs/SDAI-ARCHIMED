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
        "fabric-1.14.toml",
        include_str!("defaults/fabric-1.14.toml"),
    ),
    (
        "fabric-1.17.toml",
        include_str!("defaults/fabric-1.17.toml"),
    ),
    (
        "fabric-1.18.toml",
        include_str!("defaults/fabric-1.18.toml"),
    ),
    (
        "fabric-1.19.3.toml",
        include_str!("defaults/fabric-1.19.3.toml"),
    ),
    (
        "fabric-1.20.5.toml",
        include_str!("defaults/fabric-1.20.5.toml"),
    ),
    (
        "fabric-1.20.toml",
        include_str!("defaults/fabric-1.20.toml"),
    ),
    (
        "fabric-1.21.2.toml",
        include_str!("defaults/fabric-1.21.2.toml"),
    ),
    (
        "fabric-1.21.4.toml",
        include_str!("defaults/fabric-1.21.4.toml"),
    ),
    (
        "fabric-1.21.toml",
        include_str!("defaults/fabric-1.21.toml"),
    ),
    ("forge-1.14.toml", include_str!("defaults/forge-1.14.toml")),
    ("forge-1.17.toml", include_str!("defaults/forge-1.17.toml")),
    ("forge-1.18.toml", include_str!("defaults/forge-1.18.toml")),
    (
        "forge-1.19.3.toml",
        include_str!("defaults/forge-1.19.3.toml"),
    ),
    (
        "forge-1.20.6.toml",
        include_str!("defaults/forge-1.20.6.toml"),
    ),
    ("forge-1.20.toml", include_str!("defaults/forge-1.20.toml")),
    (
        "forge-1.21.3.toml",
        include_str!("defaults/forge-1.21.3.toml"),
    ),
    (
        "forge-1.21.4.toml",
        include_str!("defaults/forge-1.21.4.toml"),
    ),
    ("forge-1.21.toml", include_str!("defaults/forge-1.21.toml")),
    (
        "neoforge-1.20.4.toml",
        include_str!("defaults/neoforge-1.20.4.toml"),
    ),
    (
        "neoforge-1.20.6.toml",
        include_str!("defaults/neoforge-1.20.6.toml"),
    ),
    (
        "neoforge-1.21.2.toml",
        include_str!("defaults/neoforge-1.21.2.toml"),
    ),
    (
        "neoforge-1.21.4.toml",
        include_str!("defaults/neoforge-1.21.4.toml"),
    ),
    (
        "neoforge-1.21.toml",
        include_str!("defaults/neoforge-1.21.toml"),
    ),
];

/// Variante de code Java générée (API qui diffère d'une version à l'autre).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum Dialect {
    /// 1.14 – 1.19.2 : `Registry.ITEM`, onglet créatif dans les réglages de l'objet.
    #[serde(rename = "fabric-yarn-1.14")]
    FabricYarn114,
    /// 1.19.3 – 1.19.4 : `Registries`, onglets par événement, pas encore de `Settings.create()`.
    #[serde(rename = "fabric-yarn-1.19.3")]
    FabricYarn1193,
    #[serde(rename = "fabric-yarn-1.20")]
    FabricYarn120,
    #[serde(rename = "fabric-yarn-1.21")]
    FabricYarn121,
    /// 1.21.2+ : clé de registre dans les réglages.
    #[serde(rename = "fabric-yarn-1.21.2")]
    FabricYarn1212,
    /// 1.14.4 – 1.16.5 : noms de classes MCP, `Material`, onglet dans les propriétés.
    #[serde(rename = "forge-1.14")]
    Forge114,
    /// 1.17.1 – 1.19.2 : noms Mojang, `Material`, onglet dans les propriétés.
    #[serde(rename = "forge-1.17")]
    Forge117,
    /// 1.19.3 – 1.19.4 : `Material`, onglets par `CreativeModeTabEvent`.
    #[serde(rename = "forge-1.19.3")]
    Forge1193,
    #[serde(rename = "forge-1.20")]
    Forge120,
    /// 1.21.3+ : `setId` dans les propriétés.
    #[serde(rename = "forge-1.21.3")]
    Forge1213,
    #[serde(rename = "neoforge-1.21")]
    NeoForge121,
    /// 1.21.2+ : `setId` dans les propriétés.
    #[serde(rename = "neoforge-1.21.2")]
    NeoForge1212,
}

/// Emplacement et forme des fichiers de données (datapack) selon la version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
pub enum DataFormat {
    /// 1.14 – 1.20.4 : `recipes/`, `loot_tables/`, `tags/blocks/`, résultat `{"item": …}`.
    #[serde(rename = "1.14", alias = "1.20")]
    Legacy,
    /// 1.20.5 – 1.20.6 : dossiers au pluriel, résultat `{"id": …}`.
    #[serde(rename = "1.20.5")]
    V1_20_5,
    /// 1.21 – 1.21.1 : `recipe/`, `loot_table/`, `tags/block/`.
    #[serde(rename = "1.21")]
    V1_21,
    /// 1.21.2 – 1.21.3 : ingrédients écrits en texte (`"minecraft:stick"`).
    #[serde(rename = "1.21.2")]
    V1_21_2,
    /// 1.21.4+ : définitions de modèle d'objet (`assets/<modid>/items/`).
    #[serde(rename = "1.21.4")]
    V1_21_4,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Profile {
    pub id: String,
    pub loader: LoaderId,
    pub label: String,
    pub minecraft_min: String,
    pub minecraft_max: String,
    /// JDK minimal pour lancer la compilation (Gradle et le plugin du loader).
    pub java: u32,
    #[serde(default)]
    pub java_max: Option<u32>,
    /// Version du bytecode produit (`--release`) ; par défaut `java`.
    #[serde(default)]
    pub java_release: Option<u32>,
    pub gradle: String,
    /// Version du plugin Gradle du loader (Loom, ForgeGradle, ModDevGradle).
    pub plugin: String,
    pub mappings: String,
    pub template: String,
    pub dialect: Dialect,
    pub data_format: DataFormat,
    pub pack_format: u32,
    /// Une vraie compilation a déjà réussi avec ce profil.
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub notes: Option<String>,
    /// Valeurs propres au template (chemins d'import qui changent d'une version à l'autre).
    #[serde(default)]
    pub vars: std::collections::BTreeMap<String, String>,
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
            verified: self.verified,
            notes: self.notes.clone(),
        }
    }

    pub fn release(&self) -> u32 {
        self.java_release.unwrap_or(self.java)
    }
}

/// Pourquoi aucun profil ne couvre ce couple, en clair.
pub fn unsupported_reason(loader: LoaderId, minecraft: &str) -> String {
    let Some(parts) = parse_release(minecraft) else {
        return "Version de test (snapshot, pré-version) : seules les versions publiées sont prises en charge.".into();
    };
    if parts[0] >= 2 {
        return "Nouvelle numérotation (26.x et suivantes) : jeu non obfusqué et chaîne d'outils des loaders refondue. Pas encore pris en charge.".into();
    }
    if parts[1] < 14 {
        return "Avant 1.14 : outillage (ForgeGradle 1 à 3, Gradle 2 à 4) et formats de données différents. Pas encore pris en charge.".into();
    }
    match loader {
        LoaderId::Forge if parts >= vec![1, 21, 6] => {
            "Forge 1.21.6 et plus : nouveau bus d'événements (EventBus 7). Pas encore pris en charge.".into()
        }
        LoaderId::Forge if parts < vec![1, 14, 4] => "Forge : 1.14.4 minimum.".into(),
        LoaderId::Neoforge if parts < vec![1, 20, 4] => {
            "Premières versions de NeoForge : utilisez 1.20.4 ou plus récent.".into()
        }
        _ => "Pas encore de profil pour cette version.".into(),
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
        assert_eq!(
            matching(&profiles, LoaderId::Fabric, "1.16.5").unwrap().id,
            "fabric-1.14"
        );
        assert_eq!(
            matching(&profiles, LoaderId::Neoforge, "1.21.10")
                .unwrap()
                .id,
            "neoforge-1.21.4"
        );
        assert!(matching(&profiles, LoaderId::Forge, "1.21.8").is_none());
        assert!(matching(&profiles, LoaderId::Fabric, "1.12.2").is_none());
    }

    /// Chaque version publiée de 1.14 à 1.21.11 a au plus un profil par loader (le premier
    /// trouvé gagnerait en silence), et Fabric les couvre toutes.
    #[test]
    fn profiles_cover_every_release_once() {
        let profiles = load_all(&std::env::temp_dir().join("mcstudio-none"));
        let mut releases: Vec<String> = Vec::new();
        for minor in 14..=21u32 {
            let last = match minor {
                14 => 4,
                15 => 2,
                16 => 5,
                17 => 1,
                18 => 2,
                19 => 4,
                20 => 6,
                _ => 11,
            };
            releases.push(format!("1.{minor}"));
            releases.extend((1..=last).map(|patch| format!("1.{minor}.{patch}")));
        }
        for loader in [LoaderId::Fabric, LoaderId::Forge, LoaderId::Neoforge] {
            for version in &releases {
                let covering: Vec<&str> = profiles
                    .iter()
                    .filter(|p| p.loader == loader && p.covers(version))
                    .map(|p| p.id.as_str())
                    .collect();
                assert!(covering.len() <= 1, "{version} couvert par {covering:?}");
                if loader == LoaderId::Fabric {
                    assert_eq!(covering.len(), 1, "Fabric {version} sans profil");
                }
            }
        }
        assert!(unsupported_reason(LoaderId::Forge, "1.21.8").contains("EventBus 7"));
        assert!(unsupported_reason(LoaderId::Fabric, "1.12.2").contains("Avant 1.14"));
        assert!(unsupported_reason(LoaderId::Fabric, "26.1").contains("26.x"));
        assert!(unsupported_reason(LoaderId::Fabric, "25w14a").contains("snapshot"));
    }

    #[test]
    fn user_profile_replaces_embedded_one() {
        let dir = std::env::temp_dir().join(format!("mcstudio-profiles-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let raw =
            include_str!("defaults/fabric-1.21.toml").replace("1.10-SNAPSHOT", "1.99-SNAPSHOT");
        std::fs::write(dir.join("mine.toml"), raw).unwrap();
        // Un fichier invalide est ignoré sans empêcher les autres de charger.
        std::fs::write(dir.join("broken.toml"), "id = ").unwrap();
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
