//! Export des sources d'un projet en archive ZIP : ce qu'il faut pour le reconstruire ou
//! l'importer ailleurs, sans sorties de build, caches ni état propre à cette machine.

use std::io::{Cursor, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;

use super::fsutil::{walk_files, write_atomic};
use super::types::{ExportOutcome, ProjectMeta};
use crate::core::{AppError, AppResult};

/// Au-delà, ce n'est plus un projet de mod (monde, captures…) : on refuse plutôt que de saturer.
const MAX_BYTES: u64 = 512 * 1024 * 1024;

/// Fichiers propres à une machine, jamais exportés.
const LOCAL_FILES: &[&str] = &["local.properties", ".DS_Store", "Thumbs.db"];

/// Dans `.mcstudio`, seuls la fiche du projet et les modèles d'entités voyagent.
fn keeps_state(relative: &str) -> bool {
    relative == ".mcstudio/project.json" || relative.starts_with(".mcstudio/models/")
}

/// Mots qui trahissent un secret dans un fichier de propriétés (jeton de publication…).
const SECRET_HINTS: &[&str] = &["token", "password", "passwd", "secret", "api_key", "apikey"];

fn secret_warnings(relative: &str, text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let (key, value) = line.split_once('=')?;
            let key = key.trim();
            let lower = key.to_ascii_lowercase();
            (!key.starts_with('#')
                && !value.trim().is_empty()
                && SECRET_HINTS.iter().any(|hint| lower.contains(hint)))
            .then(|| format!("{relative} contient « {key} » : retirez ce secret avant de partager l'archive."))
        })
        .collect()
}

/// Fichiers du projet à exporter, chemins relatifs triés (séparateur `/`).
pub fn files(root: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    walk_files(root, &mut |file| {
        let Ok(relative) = file.strip_prefix(root) else {
            return;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        let name = relative.rsplit('/').next().unwrap_or_default();
        if !LOCAL_FILES.contains(&name) && !name.ends_with(".mcstudio-tmp") {
            paths.push(relative);
        }
    });
    let models = root.join(".mcstudio/models");
    if models.is_dir() {
        walk_files(&models, &mut |file| {
            if let Ok(relative) = file.strip_prefix(root) {
                paths.push(relative.to_string_lossy().replace('\\', "/"));
            }
        });
    }
    if root.join(".mcstudio/project.json").is_file() {
        paths.push(".mcstudio/project.json".into());
    }
    paths.retain(|p| !p.starts_with(".mcstudio/") || keeps_state(p));
    paths.sort();
    paths.dedup();
    paths
}

/// Écrit l'archive `destination` : un dossier `<modid>-<version>/` avec les sources.
pub fn export(root: &Path, meta: &ProjectMeta, destination: &Path) -> AppResult<ExportOutcome> {
    if destination
        .extension()
        .is_none_or(|e| !e.eq_ignore_ascii_case("zip"))
    {
        return Err(AppError::invalid("L'archive doit se terminer par .zip."));
    }
    let folder = format!("{}-{}", meta.mod_id, meta.mod_version);
    let skip = destination.canonicalize().ok();
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let (mut count, mut total, mut warnings) = (0u32, 0u64, Vec::new());
    for relative in files(root) {
        let path = root.join(&relative);
        if skip.is_some() && path.canonicalize().ok() == skip {
            continue;
        }
        let bytes = std::fs::read(&path)?;
        total += bytes.len() as u64;
        if total > MAX_BYTES {
            return Err(AppError::invalid(format!(
                "Le projet dépasse {} Mo hors builds : retirez les gros fichiers (mondes, vidéos…) avant d'exporter.",
                MAX_BYTES / 1024 / 1024
            )));
        }
        if relative.ends_with(".properties") || relative.ends_with(".env") {
            warnings.extend(secret_warnings(&relative, &String::from_utf8_lossy(&bytes)));
        }
        // gradlew doit rester exécutable une fois l'archive extraite (Linux, macOS).
        let mode = if relative == "gradlew" { 0o755 } else { 0o644 };
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(mode);
        writer
            .start_file(format!("{folder}/{relative}"), options)
            .map_err(|e| AppError::internal(format!("archive : {e}")))?;
        writer.write_all(&bytes)?;
        count += 1;
    }
    let archive = writer
        .finish()
        .map_err(|e| AppError::internal(format!("archive : {e}")))?
        .into_inner();
    write_atomic(destination, &archive)?;
    crate::core::audit::record(
        "mcstudio.export_zip",
        &destination.display().to_string(),
        &format!("{count} fichiers"),
        "user",
    );
    Ok(ExportOutcome {
        path: destination.display().to_string(),
        files: count,
        bytes: archive.len() as u64,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::mcstudio::types::{License, LoaderId, ResolvedVersions};
    use std::io::Read;

    fn write(root: &Path, relative: &str, body: &str) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    #[test]
    fn the_archive_keeps_sources_and_drops_builds_and_local_state() {
        let root = std::env::temp_dir().join(format!("mcstudio-export-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for file in [
            "build.gradle",
            "gradlew",
            "src/main/java/com/demo/Demo.java",
            "build/libs/demo.jar",
            ".gradle/cache.bin",
            "run/eula.txt",
            ".git/HEAD",
            ".mcstudio/project.json",
            ".mcstudio/models/golem.json",
            ".mcstudio/snapshots/1/manifest.json",
            ".mcstudio/work/copy.txt",
            "local.properties",
        ] {
            write(&root, file, "x");
        }
        write(
            &root,
            "gradle.properties",
            "# token=old\nmod_version=1.0\ncurseforge_token=abc\nsigning_password=\n",
        );
        assert_eq!(
            files(&root),
            [
                ".mcstudio/models/golem.json",
                ".mcstudio/project.json",
                "build.gradle",
                "gradle.properties",
                "gradlew",
                "src/main/java/com/demo/Demo.java",
            ]
        );

        let meta = ProjectMeta {
            format: super::super::projects::META_FORMAT,
            id: "p".into(),
            name: "Demo".into(),
            mod_id: "dm".into(),
            package: "com.demo".into(),
            main_class: "Demo".into(),
            author: String::new(),
            description: String::new(),
            mod_version: "1.0.0".into(),
            license: License::Mit,
            versions: ResolvedVersions {
                profile_id: "fabric-1.21".into(),
                loader: LoaderId::Fabric,
                minecraft: "1.21.1".into(),
                loader_version: "0.16.5".into(),
                mappings_version: None,
                api_version: None,
                java: 21,
                java_max: None,
                gradle: "8.14.3".into(),
                plugin: "1.10".into(),
                offline: false,
            },
            java_home: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        assert!(
            export(&root, &meta, &root.join("dist/out.txt")).is_err(),
            "extension .zip exigée"
        );
        let destination = root.join("dist/dm-sources.zip");
        let outcome = export(&root, &meta, &destination).unwrap();
        assert_eq!(outcome.files, 6);
        assert_eq!(outcome.warnings.len(), 1, "{:?}", outcome.warnings);
        assert!(outcome.warnings[0].contains("curseforge_token"));

        let mut zip = zip::ZipArchive::new(std::fs::File::open(&destination).unwrap()).unwrap();
        let mut body = String::new();
        zip.by_name("dm-1.0.0/src/main/java/com/demo/Demo.java")
            .unwrap()
            .read_to_string(&mut body)
            .unwrap();
        assert_eq!(body, "x");
        assert_eq!(
            zip.by_name("dm-1.0.0/gradlew")
                .unwrap()
                .unix_mode()
                .map(|m| m & 0o777),
            Some(0o755)
        );
        assert!(zip.by_name("dm-1.0.0/build/libs/demo.jar").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
