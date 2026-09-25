//! Versions publiées par les loaders, lues à la source (métadonnées officielles).
//!
//! Chaque réponse est gardée dans `cache/meta/` : sans réseau, la dernière réponse connue
//! sert (et l'interface le dit). Aucune liste de versions n'est écrite en dur.

use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;

use crate::core::error::AppErrorCode;
use crate::core::{AppError, AppResult};

use super::super::types::{
    LoaderId, LoaderSupport, ResolvedVersions, VersionCatalog, VersionChoice, VersionOption,
    VersionOptions, VersionSelection,
};
use super::{compare_releases, matching, unsupported_reason, Profile};

const FABRIC_GAME: &str = "https://meta.fabricmc.net/v2/versions/game";
const FABRIC_LOADER: &str = "https://meta.fabricmc.net/v2/versions/loader";
const FABRIC_YARN: &str = "https://meta.fabricmc.net/v2/versions/yarn/";
const FABRIC_API_MAVEN: &str =
    "https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml";
/// Fabric API sur Modrinth : la seule source qui dit pour quelles versions de Minecraft
/// chaque build est publiée (les suffixes Maven comme `+1.16` sont ambigus).
const FABRIC_API_MODRINTH: &str = "https://api.modrinth.com/v2/project/fabric-api/version";
const FORGE_PROMOS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const FORGE_MAVEN: &str =
    "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml";
const NEOFORGE: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";

/// Taille des listes proposées (les plus récentes).
const MAX_CHOICES: usize = 80;

/// Réponse d'une source, fraîche ou tirée du cache.
struct Fetched {
    body: String,
    from_cache: bool,
}

pub struct MetaClient {
    cache_dir: PathBuf,
    http: Option<reqwest::Client>,
}

fn unreachable(error: String) -> AppError {
    AppError::new(AppErrorCode::Network, error)
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

        let mut take = |loader: LoaderId,
                        result: Result<Fetched, String>,
                        parse: fn(&str) -> Vec<String>| match result {
            Ok(fetched) => {
                offline |= fetched.from_cache;
                per_loader.push((loader, parse(&fetched.body).into_iter().collect()));
            }
            Err(error) => errors.push(format!("{} : {error}", loader.label())),
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

    /// Toutes les versions de loader, de mappings et d'API publiées pour `minecraft`.
    pub async fn options(&self, profile: &Profile, minecraft: &str) -> AppResult<VersionOptions> {
        if !profile.covers(minecraft) {
            return Err(AppError::invalid(format!(
                "Le profil {} ne couvre pas Minecraft {minecraft}.",
                profile.label
            )));
        }
        match profile.loader {
            LoaderId::Fabric => {
                let (yarn_key, yarn_url) = (
                    format!("fabric-yarn-{minecraft}"),
                    format!("{FABRIC_YARN}{minecraft}"),
                );
                let modrinth_url = format!(
                    "{FABRIC_API_MODRINTH}?loaders=%5B%22fabric%22%5D&game_versions=%5B%22{minecraft}%22%5D"
                );
                let modrinth_key = format!("modrinth-fabric-api-{minecraft}");
                // 26.1+ : jeu non obfusqué, plus de Yarn (noms officiels de Mojang).
                let wants_yarn = profile.mappings == "yarn";
                let (loader, yarn, modrinth) = tokio::join!(
                    self.fetch("fabric-loader", FABRIC_LOADER),
                    async {
                        if wants_yarn {
                            self.fetch(&yarn_key, &yarn_url).await.map(Some)
                        } else {
                            Ok(None)
                        }
                    },
                    self.fetch(&modrinth_key, &modrinth_url),
                );
                let (loader, yarn) = (loader.map_err(unreachable)?, yarn.map_err(unreachable)?);
                let mut offline = loader.from_cache || yarn.as_ref().is_some_and(|y| y.from_cache);
                let mut api = match &modrinth {
                    Ok(fetched) => {
                        offline |= fetched.from_cache;
                        modrinth_versions(&fetched.body)
                    }
                    Err(_) => Vec::new(),
                };
                if api.is_empty() {
                    // Modrinth injoignable : suffixes du dépôt Maven de Fabric.
                    let maven = self
                        .fetch("fabric-api-maven", FABRIC_API_MAVEN)
                        .await
                        .map_err(unreachable)?;
                    offline |= maven.from_cache;
                    api = fabric_api_from_maven(&maven_versions(&maven.body), minecraft);
                }
                Ok(VersionOptions {
                    loader: fabric_loaders(&loader.body),
                    mappings: yarn.map(|y| fabric_yarns(&y.body)).unwrap_or_default(),
                    yarn: wants_yarn,
                    api,
                    offline,
                })
            }
            LoaderId::Forge => {
                let (promos, maven) = tokio::join!(
                    self.fetch("forge-promotions", FORGE_PROMOS),
                    self.fetch("forge-maven", FORGE_MAVEN),
                );
                let promos = promos.map_err(unreachable)?;
                let (versions, maven_cached) = match maven {
                    Ok(fetched) => (maven_versions(&fetched.body), fetched.from_cache),
                    Err(_) => (Vec::new(), false),
                };
                Ok(VersionOptions {
                    loader: forge_versions(&versions, &promos.body, minecraft),
                    mappings: Vec::new(),
                    yarn: false,
                    api: Vec::new(),
                    offline: promos.from_cache || maven_cached,
                })
            }
            LoaderId::Neoforge => {
                let maven = self
                    .fetch("neoforge-maven", NEOFORGE)
                    .await
                    .map_err(unreachable)?;
                Ok(VersionOptions {
                    loader: neoforge_versions(&maven_versions(&maven.body), minecraft),
                    mappings: Vec::new(),
                    yarn: false,
                    api: Vec::new(),
                    offline: maven.from_cache,
                })
            }
        }
    }

    /// Versions exactes retenues : le choix de la personne s'il est publié, sinon la
    /// version recommandée (ou la plus récente stable).
    pub async fn resolve(
        &self,
        profile: &Profile,
        minecraft: &str,
        selection: &VersionSelection,
    ) -> AppResult<ResolvedVersions> {
        let options = self.options(profile, minecraft).await?;
        let loader_name = profile.loader.label();
        let loader_version = pick(
            &options.loader,
            selection.loader_version.as_deref(),
            loader_name,
        )?
        .ok_or_else(|| {
            AppError::not_found(format!(
                "{loader_name} ne publie pas de version pour Minecraft {minecraft}."
            ))
        })?;
        let (mappings_version, api_version) = if profile.loader == LoaderId::Fabric {
            let yarn = if profile.mappings == "yarn" {
                Some(
                    pick(
                        &options.mappings,
                        selection.mappings_version.as_deref(),
                        "Yarn",
                    )?
                    .ok_or_else(|| {
                        AppError::not_found(format!(
                            "Pas de mappings Yarn publiés pour Minecraft {minecraft}."
                        ))
                    })?,
                )
            } else {
                None
            };
            let api = pick(&options.api, selection.api_version.as_deref(), "Fabric API")?
                .ok_or_else(|| {
                    AppError::not_found(format!(
                        "Pas de Fabric API publiée pour Minecraft {minecraft}."
                    ))
                })?;
            (yarn, Some(api))
        } else {
            (None, None)
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
            offline: options.offline,
        })
    }
}

/// La version demandée si elle est publiée ; sinon la recommandée, puis la première stable.
fn pick(choices: &[VersionChoice], wanted: Option<&str>, what: &str) -> AppResult<Option<String>> {
    if let Some(wanted) = wanted {
        return if choices.iter().any(|c| c.value == wanted) {
            Ok(Some(wanted.to_string()))
        } else {
            Err(AppError::invalid(format!(
                "{what} {wanted} n'est pas publiée pour cette version de Minecraft."
            )))
        };
    }
    Ok(choices
        .iter()
        .find(|c| c.recommended)
        .or_else(|| choices.iter().find(|c| c.stable))
        .or_else(|| choices.first())
        .map(|c| c.value.clone()))
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

/// Compare deux versions segment par segment (`47.10.0` > `47.9.2`, `21.1.172` > `21.1.9`).
pub fn compare_dotted(a: &str, b: &str) -> Ordering {
    let parts = |v: &str| -> Vec<(u64, String)> {
        v.split(['.', '-', '+'])
            .map(|p| {
                let digits: String = p.chars().take_while(char::is_ascii_digit).collect();
                (digits.parse().unwrap_or(0), p.to_string())
            })
            .collect()
    };
    let (x, y) = (parts(a), parts(b));
    for (left, right) in x.iter().zip(y.iter()) {
        let order = left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1));
        if order != Ordering::Equal {
            return order;
        }
    }
    x.len().cmp(&y.len())
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
                    let profile_id = available
                        .then(|| matching(profiles, loader, &minecraft).map(|p| p.id.clone()))
                        .flatten();
                    LoaderSupport {
                        loader,
                        available,
                        reason: (available && profile_id.is_none())
                            .then(|| unsupported_reason(loader, &minecraft)),
                        profile_id,
                    }
                })
                .collect(),
            minecraft,
        })
        .collect()
}

fn choice(value: &str, stable: bool) -> VersionChoice {
    VersionChoice {
        value: value.to_string(),
        stable,
        recommended: false,
    }
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

/// `/v2/versions/loader` → versions du loader (liste déjà triée, récentes d'abord).
fn fabric_loaders(body: &str) -> Vec<VersionChoice> {
    let mut list: Vec<VersionChoice> = serde_json::from_str::<Vec<Value>>(body)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            Some(choice(
                entry["version"].as_str()?,
                entry["stable"].as_bool() == Some(true),
            ))
        })
        .take(MAX_CHOICES)
        .collect();
    if let Some(first) = list.iter_mut().find(|c| c.stable) {
        first.recommended = true;
    }
    list
}

/// `/v2/versions/yarn/<mc>` → builds Yarn, le plus récent d'abord.
fn fabric_yarns(body: &str) -> Vec<VersionChoice> {
    let mut list: Vec<VersionChoice> = serde_json::from_str::<Vec<Value>>(body)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| Some(choice(entry["version"].as_str()?, true)))
        .take(MAX_CHOICES)
        .collect();
    if let Some(first) = list.first_mut() {
        first.recommended = true;
    }
    list
}

/// Réponse Modrinth → versions de Fabric API publiées pour ce Minecraft.
fn modrinth_versions(body: &str) -> Vec<VersionChoice> {
    let mut entries: Vec<(String, bool, String)> = serde_json::from_str::<Vec<Value>>(body)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            Some((
                entry["version_number"].as_str()?.to_string(),
                entry["version_type"].as_str() == Some("release"),
                entry["date_published"].as_str().unwrap_or("").to_string(),
            ))
        })
        .collect();
    entries.sort_by(|a, b| b.2.cmp(&a.2).then_with(|| compare_dotted(&b.0, &a.0)));
    let mut list: Vec<VersionChoice> = entries
        .iter()
        .take(MAX_CHOICES)
        .map(|(value, stable, _)| choice(value, *stable))
        .collect();
    if let Some(first) = list.iter_mut().find(|c| c.stable) {
        first.recommended = true;
    }
    list
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

/// Fabric API d'après les suffixes Maven : `+1.21.1` exact, sinon la famille `+1.16`
/// (anciennes versions publiées pour toute une mise à jour).
fn fabric_api_from_maven(versions: &[String], minecraft: &str) -> Vec<VersionChoice> {
    let exact = format!("+{minecraft}");
    let family = minecraft.split('.').take(2).collect::<Vec<_>>().join(".");
    let family = format!("+{family}");
    let mut found: Vec<&String> = versions.iter().filter(|v| v.ends_with(&exact)).collect();
    if found.is_empty() {
        found = versions.iter().filter(|v| v.ends_with(&family)).collect();
    }
    found.sort_by(|a, b| compare_dotted(b, a));
    let mut list: Vec<VersionChoice> = found
        .into_iter()
        .take(MAX_CHOICES)
        .map(|v| choice(v, true))
        .collect();
    if let Some(first) = list.first_mut() {
        first.recommended = true;
    }
    list
}

/// `promotions_slim.json` → Minecraft → version Forge (recommandée, sinon la plus récente).
fn forge_promotions(body: &str) -> BTreeMap<String, String> {
    promos_by_kind(body, "recommended")
        .into_iter()
        .chain(promos_by_kind(body, "latest"))
        .fold(BTreeMap::new(), |mut map, (mc, version)| {
            map.entry(mc).or_insert(version);
            map
        })
}

fn promos_by_kind(body: &str, kind: &str) -> Vec<(String, String)> {
    let suffix = format!("-{kind}");
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.get("promos").and_then(Value::as_object).cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|(key, value)| {
            Some((
                key.strip_suffix(&suffix)?.to_string(),
                value.as_str()?.to_string(),
            ))
        })
        .collect()
}

/// Versions Forge pour ce Minecraft (`1.20.1-47.4.0` → `47.4.0`), recommandée marquée.
fn forge_versions(maven: &[String], promos: &str, minecraft: &str) -> Vec<VersionChoice> {
    let prefix = format!("{minecraft}-");
    let recommended: Option<String> = promos_by_kind(promos, "recommended")
        .into_iter()
        .find(|(mc, _)| mc == minecraft)
        .map(|(_, v)| v);
    let latest: Option<String> = promos_by_kind(promos, "latest")
        .into_iter()
        .find(|(mc, _)| mc == minecraft)
        .map(|(_, v)| v);

    let mut versions: BTreeSet<String> = maven
        .iter()
        .filter_map(|v| v.strip_prefix(&prefix))
        // `1.12.2-14.23.5.2860` oui ; `1.7.10-10.13.4.1614-1.7.10` : suffixe ignoré.
        .map(|v| v.split('-').next().unwrap_or(v).to_string())
        .collect();
    // Sans Maven, les promotions suffisent à proposer quelque chose.
    versions.extend(recommended.iter().cloned());
    versions.extend(latest.iter().cloned());

    let mut list: Vec<VersionChoice> = versions.into_iter().map(|v| choice(&v, true)).collect();
    list.sort_by(|a, b| compare_dotted(&b.value, &a.value));
    list.truncate(MAX_CHOICES);
    let default = recommended.or(latest);
    for entry in &mut list {
        entry.recommended = Some(&entry.value) == default.as_ref();
    }
    list
}

/// Minecraft ciblé par une version NeoForge (`21.1.172` → `1.21.1`, `21.0.3-beta` → `1.21`).
/// Depuis 26.1, les trois premiers nombres sont ceux de Minecraft, puis le build
/// (`26.1.0.19-beta` → `26.1`, `26.1.2.4` → `26.1.2`).
/// Les numérotations inconnues renvoient `None` plutôt qu'une supposition.
fn neoforge_minecraft(version: &str) -> Option<String> {
    let base = version.split('-').next()?;
    let parts: Vec<u32> = base
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    if parts.len() == 4 && parts[0] >= 26 {
        return Some(if parts[2] == 0 {
            format!("{}.{}", parts[0], parts[1])
        } else {
            format!("{}.{}.{}", parts[0], parts[1], parts[2])
        });
    }
    if parts.len() != 3 || !(20..=21).contains(&parts[0]) {
        return None;
    }
    Some(if parts[1] == 0 {
        format!("1.{}", parts[0])
    } else {
        format!("1.{}.{}", parts[0], parts[1])
    })
}

/// Versions NeoForge pour ce Minecraft, la plus récente d'abord ; bêtas marquées.
fn neoforge_versions(versions: &[String], minecraft: &str) -> Vec<VersionChoice> {
    let mut list: Vec<VersionChoice> = versions
        .iter()
        .filter(|v| neoforge_minecraft(v).as_deref() == Some(minecraft))
        .map(|v| choice(v, !v.contains('-')))
        .collect();
    list.sort_by(|a, b| compare_dotted(&b.value, &a.value));
    list.truncate(MAX_CHOICES);
    if let Some(first) = list.iter_mut().find(|c| c.stable) {
        first.recommended = true;
    }
    list
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::profiles::{find, load_all};

    fn values(list: &[VersionChoice]) -> Vec<&str> {
        list.iter().map(|c| c.value.as_str()).collect()
    }

    #[test]
    fn fabric_metadata_is_parsed() {
        let games = r#"[{"version":"1.21.1","stable":true},{"version":"24w33a","stable":false},{"version":"1.20.1","stable":true}]"#;
        assert_eq!(fabric_games(games), vec!["1.21.1", "1.20.1"]);

        let loader = r#"[{"version":"0.17.0-beta.1","stable":false},{"version":"0.16.14","stable":true},{"version":"0.16.13","stable":true}]"#;
        let loaders = fabric_loaders(loader);
        assert_eq!(
            values(&loaders),
            vec!["0.17.0-beta.1", "0.16.14", "0.16.13"]
        );
        assert_eq!(
            pick(&loaders, None, "x").unwrap().as_deref(),
            Some("0.16.14")
        );
        assert_eq!(
            pick(&loaders, Some("0.16.13"), "x").unwrap().as_deref(),
            Some("0.16.13")
        );
        assert!(pick(&loaders, Some("9.9.9"), "x").is_err());

        let yarn = r#"[{"gameVersion":"1.21.1","version":"1.21.1+build.3","stable":true},{"version":"1.21.1+build.2"}]"#;
        assert_eq!(
            pick(&fabric_yarns(yarn), None, "x").unwrap().as_deref(),
            Some("1.21.1+build.3")
        );
    }

    #[test]
    fn fabric_api_comes_from_modrinth_then_maven() {
        let modrinth = r#"[
            {"version_number":"0.116.5+1.21.1","version_type":"release","date_published":"2025-06-01T00:00:00Z"},
            {"version_number":"0.116.6+1.21.1","version_type":"release","date_published":"2025-08-01T00:00:00Z"},
            {"version_number":"0.117.0-beta+1.21.1","version_type":"beta","date_published":"2025-09-01T00:00:00Z"}]"#;
        let api = modrinth_versions(modrinth);
        assert_eq!(values(&api)[0], "0.117.0-beta+1.21.1");
        assert_eq!(
            pick(&api, None, "x").unwrap().as_deref(),
            Some("0.116.6+1.21.1")
        );

        let xml = "<metadata><versioning><versions><version>0.28.5+1.14</version>\
                   <version>0.42.0+1.16</version><version>0.9.0+1.16</version>\
                   <version>0.116.5+1.21.1</version><version>0.116.6+1.21.1</version>\
                   </versions></versioning></metadata>";
        let versions = maven_versions(xml);
        assert_eq!(
            values(&fabric_api_from_maven(&versions, "1.21.1")),
            vec!["0.116.6+1.21.1", "0.116.5+1.21.1"]
        );
        assert_eq!(
            values(&fabric_api_from_maven(&versions, "1.16.5"))[0],
            "0.42.0+1.16"
        );
        assert!(fabric_api_from_maven(&versions, "1.19.4").is_empty());
    }

    #[test]
    fn forge_lists_every_build_and_marks_the_recommended_one() {
        let promos = r#"{"homepage":"x","promos":{"1.20.1-latest":"47.4.9","1.20.1-recommended":"47.4.0","1.21.1-latest":"52.1.0"}}"#;
        let map = forge_promotions(promos);
        assert_eq!(map["1.20.1"], "47.4.0");
        assert_eq!(map["1.21.1"], "52.1.0");

        let maven: Vec<String> = [
            "1.20.1-47.1.0",
            "1.20.1-47.4.0",
            "1.20.1-47.10.2",
            "1.20.2-48.0.1",
            "1.7.10-10.13.4.1614-1.7.10",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let list = forge_versions(&maven, promos, "1.20.1");
        assert_eq!(values(&list), vec!["47.10.2", "47.4.9", "47.4.0", "47.1.0"]);
        assert_eq!(pick(&list, None, "x").unwrap().as_deref(), Some("47.4.0"));
        assert_eq!(
            values(&forge_versions(&maven, promos, "1.7.10")),
            vec!["10.13.4.1614"]
        );
        // Maven injoignable : les promotions seules.
        assert_eq!(
            values(&forge_versions(&[], promos, "1.21.1")),
            vec!["52.1.0"]
        );
    }

    #[test]
    fn neoforge_versions_map_to_minecraft() {
        assert_eq!(neoforge_minecraft("21.1.172").as_deref(), Some("1.21.1"));
        assert_eq!(neoforge_minecraft("21.0.3-beta").as_deref(), Some("1.21"));
        assert_eq!(neoforge_minecraft("21.10.5").as_deref(), Some("1.21.10"));
        assert_eq!(neoforge_minecraft("20.4.237").as_deref(), Some("1.20.4"));
        assert_eq!(neoforge_minecraft("26.1.0.19-beta").as_deref(), Some("26.1"));
        assert_eq!(neoforge_minecraft("26.3.0.10-beta").as_deref(), Some("26.3"));
        assert_eq!(neoforge_minecraft("26.1.2.4").as_deref(), Some("26.1.2"));
        assert_eq!(neoforge_minecraft("26.1.0"), None);
        assert_eq!(neoforge_minecraft("19.4.1"), None);
        let modern: Vec<String> = ["26.1.0.19-beta", "26.1.0.21", "26.3.0.10-beta"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(values(&neoforge_versions(&modern, "26.1")), vec!["26.1.0.21", "26.1.0.19-beta"]);
        let versions: Vec<String> = ["21.1.1-beta", "21.1.9", "21.1.172", "21.2.0-beta"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let list = neoforge_versions(&versions, "1.21.1");
        assert_eq!(values(&list), vec!["21.1.172", "21.1.9", "21.1.1-beta"]);
        assert_eq!(pick(&list, None, "x").unwrap().as_deref(), Some("21.1.172"));
        let beta_only = neoforge_versions(&versions, "1.21.2");
        assert_eq!(
            pick(&beta_only, None, "x").unwrap().as_deref(),
            Some("21.2.0-beta")
        );
    }

    #[test]
    fn dotted_versions_compare_numerically() {
        assert_eq!(compare_dotted("47.10.0", "47.9.2"), Ordering::Greater);
        assert_eq!(compare_dotted("21.1.172", "21.1.9"), Ordering::Greater);
        assert_eq!(compare_dotted("1.0", "1.0.1"), Ordering::Less);
    }

    #[test]
    fn catalog_explains_unsupported_versions() {
        let profiles = load_all(&std::env::temp_dir().join("mcstudio-none"));
        let per_loader = vec![
            (
                LoaderId::Fabric,
                ["1.21.1", "1.12.2", "1.20.1"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            ),
            (
                LoaderId::Forge,
                ["1.20.1", "1.21.8", "1.12.2"]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
            ),
        ];
        let catalog = build_catalog(&per_loader, &profiles);
        assert_eq!(catalog[0].minecraft, "1.21.8");
        let forge_1218 = &catalog[0].loaders[1];
        assert!(forge_1218.available && forge_1218.profile_id.is_none());
        assert!(forge_1218
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("EventBus"));
        let v1201 = catalog.iter().find(|v| v.minecraft == "1.20.1").unwrap();
        assert_eq!(v1201.loaders[0].profile_id.as_deref(), Some("fabric-1.20"));
        assert_eq!(v1201.loaders[1].profile_id.as_deref(), Some("forge-1.20"));
        assert!(!v1201.loaders[2].available && v1201.loaders[2].reason.is_none());
        assert!(find(&profiles, "fabric-1.21").unwrap().verified);
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
