//! Test de bout en bout : projet « TestMod » (1 objet, 1 bloc, recettes), versions
//! résolues depuis les métadonnées officielles, puis **vraie** compilation Gradle.
//!
//! Ignoré par défaut : il télécharge Gradle, Minecraft et le loader (plusieurs centaines
//! de Mo par version au premier passage) et demande les JDK des profils. Lancer :
//!
//! ```text
//! cargo test --manifest-path src-tauri/Cargo.toml mcstudio::e2e -- --ignored --nocapture
//! ```
//!
//! - `MCSTUDIO_E2E_PROFILES=fabric-1.21,forge-1.20` : profils testés (tous par défaut) ;
//! - `MCSTUDIO_E2E_ALL=1` : toutes les versions de Minecraft de chaque profil, pas seulement
//!   la plus récente (long : une installation de Minecraft par version) ;
//! - `MCSTUDIO_E2E_INSTALL_JDK=1` : installe les JDK manquants (Temurin, Adoptium) dans
//!   le dossier temporaire `mcstudio-e2e-module`, gardé d'un passage à l'autre.

use std::path::PathBuf;

use super::projects::tests::request;
use super::service::McStudio;
use super::types::{BuildEvent, BuildStatus, BuildTask};

#[tokio::test]
#[ignore = "réseau et JDK requis : compile de vrais mods"]
async fn basic_pipeline_compiles_real_mods() {
    let base = std::env::temp_dir().join(format!("mcstudio-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    // Le dossier du module (et donc les JDK installés) survit aux passages.
    let studio = McStudio::new(std::env::temp_dir().join("mcstudio-e2e-module"));

    let wanted: Option<Vec<String>> = std::env::var("MCSTUDIO_E2E_PROFILES")
        .ok()
        .map(|list| list.split(',').map(|s| s.trim().to_string()).collect());
    let every_version = std::env::var_os("MCSTUDIO_E2E_ALL").is_some();
    let install_jdk = std::env::var_os("MCSTUDIO_E2E_INSTALL_JDK").is_some();
    let catalog = studio.catalog().await;
    for error in &catalog.errors {
        println!("⚠ {error}");
    }

    let profiles: Vec<_> = studio
        .profiles()
        .into_iter()
        .filter(|p| wanted.as_ref().is_none_or(|w| w.contains(&p.id)))
        .collect();
    assert!(!profiles.is_empty(), "aucun profil sélectionné");

    let (mut passed, mut failures) = (Vec::new(), Vec::new());
    for profile in &profiles {
        let mut versions: Vec<String> = catalog
            .versions
            .iter()
            .filter(|v| {
                v.loaders
                    .iter()
                    .any(|l| l.profile_id.as_deref() == Some(profile.id.as_str()))
            })
            .map(|v| v.minecraft.clone())
            .collect();
        if versions.is_empty() {
            failures.push(format!(
                "{} : aucune version publiée par le loader",
                profile.id
            ));
            continue;
        }
        if !every_version {
            versions.truncate(1);
        }

        for minecraft in versions {
            let label = format!("{} · Minecraft {minecraft}", profile.id);
            println!("\n=== {label}");
            let resolved = match studio
                .resolve(&profile.id, &minecraft, &Default::default())
                .await
            {
                Ok(v) => v,
                Err(e) => {
                    failures.push(format!("{label} : résolution impossible — {}", e.message));
                    continue;
                }
            };
            println!("versions : {resolved:?}");

            let parent = base.join(format!("{}-{minecraft}", profile.id));
            let mut req = request(profile, &parent);
            req.versions = resolved;
            let summary = studio.create(&req).expect("création du projet");

            let mut params = studio.prepare_build(&summary.id, BuildTask::Build, false);
            if params.is_err() && install_jdk {
                let major = profile.java;
                println!("installation de Java {major}…");
                match studio.jdk.offer(major).await {
                    Ok(offer) => {
                        if let Err(e) = studio.jdk.install(&offer, &|_| {}).await {
                            println!("  échec : {}", e.message);
                        }
                    }
                    Err(e) => println!("  offre indisponible : {}", e.message),
                }
                params = studio.prepare_build(&summary.id, BuildTask::Build, false);
            }
            let params = match params {
                Ok(p) => p,
                Err(e) => {
                    failures.push(format!("{label} : {}", e.message));
                    continue;
                }
            };
            let record = studio
                .build(params, format!("e2e-{}-{minecraft}", profile.id), |event| {
                    if let BuildEvent::Line { text, .. } = event {
                        println!("  {text}");
                    }
                })
                .await;
            println!("{}", record.summary);
            for issue in &record.issues {
                println!(
                    "  ✕ {} — {:?}:{:?} {}",
                    issue.title, issue.file, issue.line, issue.message
                );
            }
            match (&record.status, &record.dist) {
                (BuildStatus::Success, Some(dist)) if PathBuf::from(dist).is_file() => {
                    println!("jar : {dist}");
                    println!("MODULE BASIC PIPELINE = OK ({label})");
                    passed.push(label);
                }
                _ => failures.push(format!("{label} : {}", record.summary)),
            }
        }
    }

    println!(
        "\n=== Bilan : {} réussi(s), {} échec(s)",
        passed.len(),
        failures.len()
    );
    for ok in &passed {
        println!("✓ {ok}");
    }
    for failure in &failures {
        println!("✕ {failure}");
    }
    if failures.is_empty() {
        let _ = std::fs::remove_dir_all(&base);
    } else {
        panic!("projets laissés dans {} pour inspection", base.display());
    }
}
