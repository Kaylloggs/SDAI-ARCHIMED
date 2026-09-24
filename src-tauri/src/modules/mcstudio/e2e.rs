//! Test de bout en bout : projet « TestMod » (1 objet, 1 bloc, recettes), versions
//! résolues depuis les métadonnées officielles, puis **vraie** compilation Gradle.
//!
//! Ignoré par défaut : il télécharge Gradle, Minecraft et le loader (plusieurs centaines
//! de Mo au premier passage) et demande le JDK du profil. Lancer :
//!
//! ```text
//! cargo test --manifest-path src-tauri/Cargo.toml mcstudio::e2e -- --ignored --nocapture
//! ```
//!
//! `MCSTUDIO_E2E_PROFILES=fabric-1.21,forge-1.20` choisit les profils (tous par défaut),
//! `MCSTUDIO_E2E_MINECRAFT=1.21.1` force la version de Minecraft (sinon la plus haute du profil).

use std::path::PathBuf;

use super::projects::tests::request;
use super::service::McStudio;
use super::types::{BuildEvent, BuildStatus, BuildTask};

#[tokio::test]
#[ignore = "réseau et JDK requis : compile un vrai mod"]
async fn basic_pipeline_compiles_a_real_mod() {
    let base = std::env::temp_dir().join(format!("mcstudio-e2e-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(&base).unwrap();
    let studio = McStudio::new(base.join("module"));

    let wanted: Option<Vec<String>> = std::env::var("MCSTUDIO_E2E_PROFILES")
        .ok()
        .map(|list| list.split(',').map(|s| s.trim().to_string()).collect());
    let profiles: Vec<_> = studio
        .profiles()
        .into_iter()
        .filter(|p| wanted.as_ref().is_none_or(|w| w.contains(&p.id)))
        .collect();
    assert!(!profiles.is_empty(), "aucun profil sélectionné");

    let mut failures = Vec::new();
    for profile in &profiles {
        let minecraft = std::env::var("MCSTUDIO_E2E_MINECRAFT")
            .unwrap_or_else(|_| profile.minecraft_max.clone());
        println!("\n=== {} · Minecraft {minecraft}", profile.id);
        let versions = match studio.resolve(&profile.id, &minecraft).await {
            Ok(v) => v,
            Err(e) => {
                failures.push(format!(
                    "{}: résolution impossible — {}",
                    profile.id, e.message
                ));
                continue;
            }
        };
        println!("versions : {versions:?}");

        let parent = base.join(&profile.id);
        let mut req = request(profile, &parent);
        req.versions = versions;
        let summary = studio.create(&req).expect("création du projet");

        let params = match studio.prepare_build(&summary.id, BuildTask::Build, false) {
            Ok(p) => p,
            Err(e) => {
                failures.push(format!("{}: {}", profile.id, e.message));
                continue;
            }
        };
        let record = studio
            .build(params, format!("e2e-{}", profile.id), |event| {
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
                println!("MODULE BASIC PIPELINE = OK ({})", profile.id);
            }
            _ => failures.push(format!("{}: {}", profile.id, record.summary)),
        }
    }

    if failures.is_empty() {
        let _ = std::fs::remove_dir_all(&base);
    } else {
        panic!(
            "projets laissés dans {} pour inspection :\n{}",
            base.display(),
            failures.join("\n")
        );
    }
}
