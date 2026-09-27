//! Modules ajoutés ou modifiés dans le code source d'ARCHIMED et pas encore compilés dans
//! l'exécutable en cours (« mise à jour locale », ADR 0013).
//!
//! Le code source est celui qui a servi à compiler cette version (`ARCHIMED_SOURCE_DIR`), ou
//! un dossier choisi par la personne (Réglages) ou enregistré par `pnpm new:module`
//! (`<données>/updater.json`). Un module est **nouveau** s'il n'est pas compilé ici,
//! **modifié** si ses fichiers ont changé depuis le point de départ, et **prêt** quand rien n'y
//! a bougé depuis quelques secondes (l'IA ou la personne a fini d'écrire).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Plus rien ne bouge depuis ce délai : le module est considéré comme terminé.
pub const QUIET: Duration = Duration::from_secs(30);
/// Marge contre les horloges de fichiers imprécises.
const MARGIN_MS: u64 = 2_000;
/// Fichiers parcourus au plus par module (un module ne devrait pas en avoir autant).
const MAX_FILES: usize = 20_000;
const SKIPPED: &[&str] = &["node_modules", "target", "dist", ".git", "build", "__pycache__"];
/// Textes du modèle de `pnpm new:module` : tant qu'ils sont là, le module n'est pas terminé.
const TEMPLATE_MARKS: &[&str] = &["Module fraîchement créé", "À implémenter", "Décrire le module en une phrase."];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub enum LocalModuleState {
    /// Absent de l'exécutable en cours.
    New,
    /// Compilé, mais ses fichiers ont changé depuis.
    Modified,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct LocalModule {
    pub id: String,
    pub name: String,
    pub state: LocalModuleState,
    /// Dossier du module (`src/modules/<id>`).
    pub path: String,
    /// Dernière modification d'un de ses fichiers (ms).
    #[ts(type = "number")]
    pub modified_at: u64,
    /// Rien n'a bougé depuis `QUIET`, le manifeste est complet et le modèle a été remplacé.
    pub ready: bool,
    /// Encore le contenu du modèle de `pnpm new:module` (écran « À implémenter »…).
    pub unfinished: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/core/ipc/bindings/")]
pub struct LocalStatus {
    /// Dossier du code source suivi (`None` : inconnu).
    pub source_dir: Option<String>,
    /// Choisi par la personne (ou `pnpm new:module`), et non celui de la compilation.
    pub configured: bool,
    /// Le dossier existe et contient le code d'ARCHIMED.
    pub valid: bool,
    pub modules: Vec<LocalModule>,
    /// Délai de calme avant qu'un module soit « prêt » (ms).
    #[ts(type = "number")]
    pub quiet_ms: u64,
}

/// `<données>/updater.json` : dossier choisi et point de départ des modifications.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalConfig {
    #[serde(default)]
    pub source_dir: Option<String>,
    #[serde(default)]
    pub baseline: Option<Baseline>,
}

/// État des modules pris comme référence pour un exécutable donné (sa date) et un dossier.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub stamp: u64,
    pub dir: String,
    pub modules: BTreeMap<String, u64>,
}

/// Module trouvé dans le code source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scanned {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    pub latest: u64,
    /// Manifeste présent (`defineModule`) et identifiant conforme au dossier.
    pub complete: bool,
    /// Textes du modèle encore présents.
    pub template: bool,
}

pub fn read_config(path: &Path) -> LocalConfig {
    std::fs::read_to_string(path).ok().and_then(|raw| serde_json::from_str(&raw).ok()).unwrap_or_default()
}

pub fn write_config(path: &Path, config: &LocalConfig) {
    if let Ok(text) = serde_json::to_string_pretty(config) {
        let temp = path.with_extension("json.tmp");
        if std::fs::write(&temp, text).is_ok() {
            let _ = std::fs::rename(&temp, path);
        }
    }
}

/// Le dossier contient le code d'ARCHIMED (et pas un autre projet Tauri).
pub fn is_archimed_source(dir: &Path) -> bool {
    dir.join("src").join("modules").is_dir()
        && std::fs::read_to_string(dir.join("src-tauri").join("tauri.conf.json"))
            .is_ok_and(|conf| conf.contains("\"com.sdai.archimed\""))
}

pub fn now_ms() -> u64 {
    to_ms(SystemTime::now())
}

fn to_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(0)
}

/// Date de l'exécutable en cours : celle de sa compilation (l'installeur et la copie la gardent).
pub fn exe_stamp() -> u64 {
    std::env::current_exe().ok().and_then(|exe| exe.metadata().ok()).and_then(|m| m.modified().ok()).map(to_ms).unwrap_or(0)
}

/// Modules de `src/modules/` (hors `_template`), avec la date de leur fichier le plus récent,
/// partie Rust (`src-tauri/src/modules/<id>`) comprise.
pub fn scan(dir: &Path) -> Vec<Scanned> {
    let Ok(entries) = std::fs::read_dir(dir.join("src").join("modules")) else {
        return Vec::new();
    };
    let mut modules: Vec<Scanned> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let id = entry.file_name().to_string_lossy().to_string();
            if id.starts_with(['_', '.']) {
                return None;
            }
            let path = entry.path();
            let manifest = std::fs::read_to_string(path.join("module.config.ts")).ok()?;
            let backend = dir.join("src-tauri").join("src").join("modules").join(id.replace('-', "_"));
            let latest = latest_change(&path).max(latest_change(&backend));
            let declared = field(&manifest, "id");
            let page = std::fs::read_to_string(path.join("index.tsx")).unwrap_or_default();
            let template = TEMPLATE_MARKS.iter().any(|mark| manifest.contains(mark) || page.contains(mark));
            Some(Scanned {
                template,
                name: field(&manifest, "name").unwrap_or_else(|| id.clone()),
                complete: manifest.contains("defineModule") && declared.as_deref() == Some(id.as_str()),
                id,
                path,
                latest,
            })
        })
        .collect();
    modules.sort_by(|a, b| a.id.cmp(&b.id));
    modules
}

/// Première valeur `clé: "…"` du manifeste.
fn field(manifest: &str, key: &str) -> Option<String> {
    manifest.lines().find_map(|line| {
        let rest = line.trim_start().strip_prefix(key)?.trim_start().strip_prefix(':')?.trim_start();
        let quote = rest.chars().next().filter(|c| *c == '"' || *c == '\'')?;
        let value = &rest[1..];
        value.find(quote).map(|end| value[..end].to_string())
    })
}

fn latest_change(root: &Path) -> u64 {
    let mut latest = 0;
    let mut seen = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_FILES {
                return latest;
            }
            let path = entry.path();
            if path.is_dir() {
                if !SKIPPED.iter().any(|skip| entry.file_name() == *skip) {
                    stack.push(path);
                }
            } else if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                latest = latest.max(to_ms(modified));
            }
        }
    }
    latest
}

/// Point de départ des « modifiés » : pour un exécutable compilé depuis ce dossier, sa date de
/// compilation ; sinon l'état du dossier la première fois qu'ARCHIMED le voit.
pub fn baseline_for(scanned: &[Scanned], stamp: u64, built_here: bool) -> BTreeMap<String, u64> {
    scanned.iter().map(|m| (m.id.clone(), if built_here { stamp } else { m.latest })).collect()
}

/// Nouveaux et modifiés, avec leur état « prêt ».
pub fn classify(scanned: &[Scanned], compiled: &[String], baseline: &BTreeMap<String, u64>, stamp: u64, now: u64) -> Vec<LocalModule> {
    let quiet = u64::try_from(QUIET.as_millis()).unwrap_or(30_000);
    scanned
        .iter()
        .filter_map(|module| {
            let state = if !compiled.contains(&module.id) {
                LocalModuleState::New
            } else if module.latest > baseline.get(&module.id).copied().unwrap_or(stamp) + MARGIN_MS {
                LocalModuleState::Modified
            } else {
                return None;
            };
            Some(LocalModule {
                id: module.id.clone(),
                name: module.name.clone(),
                state,
                path: module.path.display().to_string(),
                modified_at: module.latest,
                ready: module.complete && !module.template && now.saturating_sub(module.latest) >= quiet,
                unfinished: module.template,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("archimed-local-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn module(root: &Path, id: &str, manifest: &str) {
        let dir = root.join("src").join("modules").join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("module.config.ts"), manifest).unwrap();
        std::fs::write(dir.join("index.tsx"), "export default function Page() { return null; }").unwrap();
    }

    #[test]
    fn finds_new_modules_and_reads_their_manifest() {
        let root = temp("scan");
        std::fs::create_dir_all(root.join("src-tauri")).unwrap();
        std::fs::write(root.join("src-tauri").join("tauri.conf.json"), r#"{ "identifier": "com.sdai.archimed" }"#).unwrap();
        module(&root, "chat", "export default defineModule({\n  id: \"chat\",\n  name: \"Chat\",\n});");
        module(&root, "meteo", "export default defineModule({\n  id: \"meteo\",\n  name: \"Météo\",\n});");
        module(&root, "brouillon", "export default defineModule({\n  id: \"autre\",\n});");
        module(&root, "_template", "export default defineModule({ id: \"__ID__\" });");
        module(&root, "fraiche", "export default defineModule({\n  id: \"fraiche\",\n  name: \"Fraiche\",\n  description: \"Décrire le module en une phrase.\",\n});");
        assert!(is_archimed_source(&root));

        let scanned = scan(&root);
        assert_eq!(scanned.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["brouillon", "chat", "fraiche", "meteo"]);
        let meteo = scanned.iter().find(|m| m.id == "meteo").unwrap();
        assert_eq!(meteo.name, "Météo");
        assert!(meteo.complete);
        assert!(!scanned.iter().find(|m| m.id == "brouillon").unwrap().complete);

        let compiled = vec!["chat".to_string()];
        let later = meteo.latest + 60_000;
        let baseline = baseline_for(&scanned, later, true);
        let found = classify(&scanned, &compiled, &baseline, later, later);
        assert_eq!(found.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["brouillon", "fraiche", "meteo"]);
        let fraiche = found.iter().find(|m| m.id == "fraiche").unwrap();
        assert!(fraiche.unfinished && !fraiche.ready, "encore le modèle de pnpm new:module");
        assert!(found.iter().all(|m| m.state == LocalModuleState::New));
        assert!(found.iter().find(|m| m.id == "meteo").unwrap().ready);
        assert!(!found.iter().find(|m| m.id == "brouillon").unwrap().ready, "manifeste non conforme");
        // Tout juste écrit : pas encore prêt.
        assert!(!classify(&scanned, &compiled, &baseline, later, meteo.latest + 1_000).iter().any(|m| m.ready));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn modified_modules_are_measured_from_the_baseline() {
        let scanned = vec![Scanned { id: "chat".into(), name: "Chat".into(), path: PathBuf::from("chat"), latest: 100_000, complete: true, template: false }];
        let compiled = vec!["chat".to_string()];
        // Compilé depuis ce dossier après la dernière modification : rien à signaler.
        assert!(classify(&scanned, &compiled, &baseline_for(&scanned, 200_000, true), 200_000, 300_000).is_empty());
        // Compilé avant : modifié depuis.
        let found = classify(&scanned, &compiled, &baseline_for(&scanned, 50_000, true), 50_000, 300_000);
        assert_eq!(found[0].state, LocalModuleState::Modified);
        // Version officielle + dossier vu pour la première fois : l'état actuel sert de départ.
        assert!(classify(&scanned, &compiled, &baseline_for(&scanned, 50_000, false), 50_000, 300_000).is_empty());
    }

    #[test]
    fn config_round_trips() {
        let dir = temp("config");
        let path = dir.join("updater.json");
        assert_eq!(read_config(&path), LocalConfig::default());
        let config = LocalConfig { source_dir: Some("C:/src".into()), baseline: None };
        write_config(&path, &config);
        assert_eq!(read_config(&path), config);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
