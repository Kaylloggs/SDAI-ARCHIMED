//! Versions publiées par les loaders, lues à la source (métadonnées officielles).
//!
//! Chaque réponse est gardée dans `cache/meta/` : sans réseau, la dernière réponse connue
//! sert (et l'interface le dit). Aucune liste de versions n'est écrite en dur.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

use crate::core::{AppError, AppResult};

use super::super::types::{
    LoaderId, LoaderSupport, ResolvedVersions, VersionCatalog, VersionOption,
};
use super::{compare_releases, matching, Profile};

const FABRIC_GAME: &str = "https://meta.fabricmc.net/v2/versions/game";
const FABRIC_LOADER: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FABRIC_YARN: &str = "https://meta.fabricmc.net/v2/versions/yarn/";
const FABRIC_API: &str =
    "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml";
const FORGE_PROMOS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

/// Réponse d'une source, fraîche ou tirée du cache.
struct Fetched {
    body: String,
    from_cache: bool,
}

pub struct MetaClient {
    cache_dir: PathBuf,
    http: Option<reqwest::Client>,
}

impl MetaClient {
    pub fn new(cache_dir: PathBuf) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!(
                "SDAI-ARCHIMED-ModStudio/",
                env!("CARGO_PKG_VERSION")
            ))
            .build()
            .map_err(|e| tracing::warn!("client HTTP indisponible : {e}"))
            .ok();
        Self { cache_dir, http }
    }

    async fn fetch(&self, key: &str, url: &str) -> Result<Fetched, String> {
        let cache = self.cache_dir.join(format!("{}.txt", sanitize(key)));
        let network = match &self.http {
            Some(http) => fetch_text(http, url).await,
            None => Err("client HTTP indisponible".to_string()),
        };
        match network {
            Ok(body) => {
                if std::fs::create_dir_all(&self.cache_dir).is_ok() {
                    let _ = std::fs::write(&cache, &body);
                }
                Ok(Fetched {
                    body,
                    from_cache: false,
                })
            }
            Err(error) => match std::fs::read_to_string(&cache) {
                Ok(body) => {
                    tracing::info!("{url} injoignable ({error}) : cache utilisé");
                    Ok(Fetched {
                        body,
                        from_cache: true,
                    })
                }
                Err(_) => Err(format!(
                    "{} injoignable ({error}) et aucune copie en cache",
                    host(url)
                )),
            },
        }
    }

    /// Versions de Minecraft proposées par chaque loader, croisées avec les profils.
    pub async fn catalog(&self, profiles: &[Profile]) -> VersionCatalog {
        let (fabric, forge, neoforge) = tokio::join!(
            self.fetch("fabric-game", FABRIC_GAME),
            self.fetch("forge-promotions", FORGE_PROMOS),
            self.fetch("neoforge-maven", NEOFORGE),
        );

        let mut offline = false;
        let mut errors = Vec::new();
        let mut per_loader: Vec<(LoaderId, BTreeSet<String>)> = Vec::new();

        let mut take =
            |loader: LoaderId, result: Result<Fetched, String>, parse: fn(&str) -> Vec<String>| {
                match result {
                    Ok(fetched) => {
                        offline |= fetched.from_cache;
                        per_loader.push((loader, parse(&fetched.body).into_iter().collect()));
                    }
                    Err(error) => errors.push(format!("{} : {error}", loader.label())),
                }
            };
        take(LoaderId::Fabric, fabric, fabric_games);
        take(LoaderId::Forge, forge, |body| {
            forge_promotions(body).into_keys().collect()
        });
        take(LoaderId::Neoforge, neoforge, |body| {
            maven_versions(body)
                .iter()
                .filter_map(|v| neoforge_minecraft(v))
                .collect()
        });

        VersionCatalog {
            versions: build_catalog(&per_loader, profiles),
            profiles: profiles.iter().map(Profile::info).collect(),
            offline,
            errors,
        }
    }

    /// Versions exactes du loader, des mappings et de l'API pour `minecraft`.
    pub async fn resolve(&self, profile: &Profile, minecraft: &str) -> AppResult<ResolvedVersions> {
        if !profile.covers(minecraft) {
            return Err(AppError::invalid(format!(
                "Le profil {} ne couvre pas Minecraft {minecraft}.",
                profile.label
            )));
        }
        let unreachable =
            |error: String| AppError::new(crate::core::error::AppErrorCode::Network, error);
        let (loader_version, mappings_version, api_version, offline) = match profile.loader {
            LoaderId::Fabric => {
                let (yarn_key, yarn_url) = (
                    format!("fabric-yarn-{minecraft}"),
                    format!("{FABRIC_YARN}{minecraft}"),
                );
                let (loader, yarn, api) = tokio::join!(
                    self.fetch("fabric-loader", FABRIC_LOADER),
                    self.fetch(&yarn_key, &yarn_url),
                    self.fetch("fabric-api-maven", FABRIC_API),
                );
                let (loader, yarn, api) = (
                    loader.map_err(unreachable)?,
                    yarn.map_err(unreachable)?,
                    api.map_err(unreachable)?,
                );
                let offline = loader.from_cache || yarn.from_cache || api.from_cache;
                let loader = fabric_loader(&loader.body).ok_or_else(|| {
                    AppError::not_found("Aucune version stable de Fabric Loader publiée.")
                })?;
                let yarn = fabric_yarn(&yarn.body).ok_or_else(|| {
                    AppError::not_found(format!(
                        "Pas de mappings Yarn publiés pour Minecraft {minecraft}."
                    ))
                })?;
                let api =
                    fabric_api_for(&maven_versions(&api.body), minecraft).ok_or_else(|| {
                        AppError::not_found(format!(
                            "Pas de Fabric API publiée pour Minecraft {minecraft}."
                        ))
                    })?;
                (loader, Some(yarn), Some(api), offline)
            }
            LoaderId::Forge => {
                let promos = self
                    .fetch("forge-promotions", FORGE_PROMOS)
                    .await
                    .map_err(unreachable)?;
                let version = forge_promotions(&promos.body)
                    .remove(minecraft)
                    .ok_or_else(|| {
                        AppError::not_found(format!(
                            "Forge ne publie pas de version pour Minecraft {minecraft}."
                        ))
                    })?;
                (version, None, None, promos.from_cache)
            }
            LoaderId::Neoforge => {
                let maven = self
                    .fetch("neoforge-maven", NEOFORGE)
                    .await
                    .map_err(unreachable)?;
                let version =
                    neoforge_for(&maven_versions(&maven.body), minecraft).ok_or_else(|| {
                        AppError::not_found(format!(
                            "NeoForge ne publie pas de version pour Minecraft {minecraft}."
                        ))
                    })?;
                (version, None, None, maven.from_cache)
            }
        };

        Ok(ResolvedVersions {
            profile_id: profile.id.clone(),
            loader: profile.loader,
            minecraft: minecraft.to_string(),
            loader_version,
            mappings_version,
            api_version,
            java: profile.java,
            java_max: profile.java_max,
            gradle: profile.gradle.clone(),
            plugin: profile.plugin.clone(),
            offline,
        })
    }
}

async fn fetch_text(http: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = http.get(url).send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    response.text().await.map_err(|e| e.to_string())
}

fn sanitize(key: &str) -> String {
    key.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn host(url: &str) -> &str {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(url)
}

/// Une ligne par version de Minecraft, la plus récente en tête.
fn build_catalog(
    per_loader: &[(LoaderId, BTreeSet<String>)],
    profiles: &[Profile],
) -> Vec<VersionOption> {
    let mut all: Vec<String> = per_loader
        .iter()
        .flat_map(|(_, versions)| versions.iter().cloned())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    all.sort_by(|a, b| compare_releases(b, a));

    all.into_iter()
        .map(|minecraft| VersionOption {
            loaders: [LoaderId::Fabric, LoaderId::Forge, LoaderId::Neoforge]
                .into_iter()
                .map(|loader| {
                    let available = per_loader
                        .iter()
                        .any(|(id, versions)| *id == loader && versions.contains(&minecraft));
                    LoaderSupport {
                        loader,
                        available,
                        profile_id: available
                            .then(|| matching(profiles, loader, &minecraft).map(|p| p.id.clone()))
                            .flatten(),
                    }
                })
                .collect(),
            minecraft,
        })
        .collect()
}

/// `/v2/versions/game` → versions stables.
fn fabric_games(body: &str) -> Vec<String> {
    serde_json::from_str::<Vec<Value>>(body)
        .unwrap_or_default()
        .iter()
        .filter(|entry| entry["stable"].as_bool() == Some(true))
        .filter_map(|entry| entry["version"].as_str().map(str::to_string))
        .collect()
}

/// `/v2/versions/loader` → première version stable (la liste est triée, récente d'abord).
fn fabric_loader(body: &str) -> Option<String> {
    serde_json::from_str::<Vec<Value>>(body)
        .ok()?
        .iter()
        .find(|entry| entry["stable"].as_bool() == Some(true))
        .and_then(|entry| entry["version"].as_str().map(str::to_string))
}

/// `/v2/versions/yarn/<mc>` → build le plus récent.
fn fabric_yarn(body: &str) -> Option<String> {
    serde_json::from_str::<Vec<Value>>(body)
        .ok()?
        .first()
        .and_then(|entry| entry["version"].as_str().map(str::to_string))
}

/// `<version>…</version>` d'un `maven-metadata.xml`, dans l'ordre de publication.
fn maven_versions(xml: &str) -> Vec<String> {
    xml.split("<version>")
        .skip(1)
        .filter_map(|chunk| chunk.split("</version>").next())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .collect()
}

/// Dernière Fabric API compilée pour cette version (`0.116.6+1.21.1`).
fn fabric_api_for(versions: &[String], minecraft: &str) -> Option<String> {
    let suffix = format!("+{minecraft}");
    versions
        .iter()
        .rev()
        .find(|v| v.ends_with(&suffix))
        .cloned()
}

/// `promotions_slim.json` → Minecraft → version Forge (recommandée, sinon la plus récente).
fn forge_promotions(body: &str) -> BTreeMap<String, String> {
    let promos = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("promos").cloned())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();

    let mut result: BTreeMap<String, String> = BTreeMap::new();
    for (key, value) in &promos {
        let Some(version) = value.as_str() else {
            continue;
        };
        if let Some(minecraft) = key.strip_suffix("-recommended") {
            result.insert(minecraft.to_string(), version.to_string());
        }
    }
    for (key, value) in &promos {
        let Some(version) = value.as_str() else {
            continue;
        };
        if let Some(minecraft) = key.strip_suffix("-latest") {
            result
                .entry(minecraft.to_string())
                .or_insert_with(|| version.to_string());
        }
    }
    result
}

/// Minecraft ciblé par une version NeoForge (`21.1.172` → `1.21.1`, `21.0.3-beta` → `1.21`).
/// Les numérotations inconnues renvoient `None` plutôt qu'une supposition.
fn neoforge_minecraft(version: &str) -> Option<String> {
    let base = version.split('-').next()?;
    let parts: Vec<u32> = base
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    if parts.len() != 3 || !(20..=21).contains(&parts[0]) {
        return None;
    }
    Some(if parts[1] == 0 {
        format!("1.{}", parts[0])
    } else {
        format!("1.{}.{}", parts[0], parts[1])
    })
}

/// Dernière version stable pour ce Minecraft, sinon la dernière bêta.
fn neoforge_for(versions: &[String], minecraft: &str) -> Option<String> {
    let candidates: Vec<&String> = versions
        .iter()
        .filter(|v| neoforge_minecraft(v).as_deref() == Some(minecraft))
        .collect();
    candidates
        .iter()
        .rev()
        .find(|v| !v.contains('-'))
        .or_else(|| candidates.last())
        .map(|v| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::profiles::load_all;

    #[test]
    fn fabric_metadata_is_parsed() {
        let games = r#"[{"version":"1.21.1","stable":true},{"version":"24w33a","stable":false},{"version":"1.20.1","stable":true}]"#;
        assert_eq!(fabric_games(games), vec!["1.21.1", "1.20.1"]);

        let loader =
            r#"[{"version":"0.17.0-beta.1","stable":false},{"version":"0.16.14","stable":true}]"#;
        assert_eq!(fabric_loader(loader).as_deref(), Some("0.16.14"));

        let yarn = r#"[{"gameVersion":"1.21.1","version":"1.21.1+build.3","stable":true},{"version":"1.21.1+build.2"}]"#;
        assert_eq!(fabric_yarn(yarn).as_deref(), Some("1.21.1+build.3"));

        let xml = "<metadata><versioning><versions><version>0.92.2+1.20.1</version>\
                   <version>0.116.5+1.21.1</version><version>0.116.6+1.21.1</version>\
                   <version>0.117.0+1.21.2</version></versions></versioning></metadata>";
        let versions = maven_versions(xml);
        assert_eq!(
            fabric_api_for(&versions, "1.21.1").as_deref(),
            Some("0.116.6+1.21.1")
        );
        assert_eq!(
            fabric_api_for(&versions, "1.20.1").as_deref(),
            Some("0.92.2+1.20.1")
        );
        assert_eq!(fabric_api_for(&versions, "1.19.4"), None);
    }

    #[test]
    fn forge_prefers_recommended_builds() {
        let promos = r#"{"homepage":"x","promos":{"1.20.1-latest":"47.4.9","1.20.1-recommended":"47.4.0","1.21.1-latest":"52.1.0"}}"#;
        let map = forge_promotions(promos);
        assert_eq!(map["1.20.1"], "47.4.0");
        assert_eq!(map["1.21.1"], "52.1.0");
    }

    #[test]
    fn neoforge_versions_map_to_minecraft() {
        assert_eq!(neoforge_minecraft("21.1.172").as_deref(), Some("1.21.1"));
        assert_eq!(neoforge_minecraft("21.0.3-beta").as_deref(), Some("1.21"));
        assert_eq!(neoforge_minecraft("20.4.237").as_deref(), Some("1.20.4"));
        assert_eq!(neoforge_minecraft("26.1.0.1"), None);
        let versions: Vec<String> = ["21.1.1-beta", "21.1.170", "21.1.172", "21.2.0-beta"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(
            neoforge_for(&versions, "1.21.1").as_deref(),
            Some("21.1.172")
        );
        assert_eq!(
            neoforge_for(&versions, "1.21.2").as_deref(),
            Some("21.2.0-beta")
        );
    }

    #[test]
    fn catalog_marks_versions_without_profile_as_unsupported() {
        let profiles = load_all(&std::env::temp_dir().join("mcstudio-none"));
        let per_loader = vec![
            (
                LoaderId::Fabric,
                ["1.21.1", "1.21.4", "1.20.1"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            ),
            (
                LoaderId::Forge,
                ["1.20.1"].iter().map(|s| s.to_string()).collect(),
            ),
        ];
        let catalog = build_catalog(&per_loader, &profiles);
        assert_eq!(catalog[0].minecraft, "1.21.4");
        let fabric_1214 = &catalog[0].loaders[0];
        assert!(fabric_1214.available && fabric_1214.profile_id.is_none());
        let v1201 = catalog.iter().find(|v| v.minecraft == "1.20.1").unwrap();
        assert_eq!(v1201.loaders[0].profile_id.as_deref(), Some("fabric-1.20"));
        assert_eq!(v1201.loaders[1].profile_id.as_deref(), Some("forge-1.20"));
        assert!(!v1201.loaders[2].available);
    }

    #[tokio::test]
    async fn cache_serves_when_network_fails() {
        let dir = std::env::temp_dir().join(format!("mcstudio-meta-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("probe.txt"), "cached").unwrap();
        let client = MetaClient::new(dir.clone());
        // Port fermé : l'erreur réseau est immédiate.
        let fetched = client
            .fetch("probe", "http://127.0.0.1:9/none")
            .await
            .unwrap();
        assert!(fetched.from_cache);
        assert_eq!(fetched.body, "cached");
        assert!(client
            .fetch("absent", "http://127.0.0.1:9/none")
            .await
            .is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
