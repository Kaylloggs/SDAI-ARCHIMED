//! Détection des JDK installés.
//!
//! Lit le fichier `release` de chaque JDK candidat (aucun processus lancé) et ne garde
//! que les vrais JDK (présence de `javac`) : un JRE ne compile pas un mod.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use super::types::JavaInstall;

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// Dossiers qui contiennent habituellement des JDK (un JDK par sous-dossier).
fn vendor_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        for base in [
            std::env::var_os("ProgramFiles"),
            std::env::var_os("ProgramW6432"),
        ]
        .into_iter()
        .flatten()
        {
            let base = PathBuf::from(base);
            for vendor in [
                "Java",
                "Eclipse Adoptium",
                "Microsoft",
                "Zulu",
                "Amazon Corretto",
                "BellSoft",
                "Semeru",
                "OpenJDK",
            ] {
                dirs.push(base.join(vendor));
            }
        }
    } else {
        dirs.push(PathBuf::from("/usr/lib/jvm"));
        dirs.push(PathBuf::from("/opt"));
        dirs.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    }
    if let Some(home) = crate::core::paths::dirs_home() {
        dirs.push(home.join(".jdks"));
        dirs.push(home.join(".sdkman/candidates/java"));
    }
    dirs
}

/// Ramène un chemin (dossier du JDK, `bin/java`, `Contents/Home`) à la racine du JDK.
fn jdk_root(path: &Path) -> Option<PathBuf> {
    let candidates = [
        path.to_path_buf(),
        path.join("Contents").join("Home"),
        path.parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_default(),
    ];
    candidates
        .into_iter()
        .filter(|dir| !dir.as_os_str().is_empty())
        .find(|dir| dir.join("bin").join(exe("javac")).is_file())
}

/// Lit `release` : `JAVA_VERSION="21.0.4"`, `IMPLEMENTOR="Eclipse Adoptium"`.
pub fn read_release(root: &Path) -> Option<(String, Option<String>)> {
    let text = std::fs::read_to_string(root.join("release")).ok()?;
    let field = |key: &str| {
        text.lines()
            .find_map(|line| line.strip_prefix(key))
            .and_then(|rest| rest.strip_prefix('='))
            .map(|value| value.trim().trim_matches('"').to_string())
    };
    Some((field("JAVA_VERSION")?, field("IMPLEMENTOR")))
}

/// `1.8.0_392` → 8, `17.0.9` → 17, `21` → 21.
pub fn major_of(version: &str) -> Option<u32> {
    let mut parts = version.split(['.', '_', '-', '+']);
    let first: u32 = parts.next()?.parse().ok()?;
    if first == 1 {
        parts.next()?.parse().ok()
    } else {
        Some(first)
    }
}

pub fn inspect(path: &Path) -> Option<JavaInstall> {
    let root = jdk_root(path)?;
    let (version, vendor) = read_release(&root)?;
    let major = major_of(&version)?;
    let root = std::fs::canonicalize(&root).unwrap_or(root);
    let display = root.display().to_string();
    Some(JavaInstall {
        path: display
            .strip_prefix(r"\\?\")
            .unwrap_or(&display)
            .to_string(),
        version,
        major,
        vendor,
    })
}

/// Tous les JDK trouvés, du plus récent au plus ancien.
pub fn detect() -> Vec<JavaInstall> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("JAVA_HOME") {
        candidates.push(PathBuf::from(home));
    }
    if let Ok(java) = which::which(exe("java")) {
        candidates.push(std::fs::canonicalize(&java).unwrap_or(java));
    }
    for dir in vendor_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            candidates.extend(entries.flatten().map(|entry| entry.path()));
        }
    }

    let mut seen = BTreeSet::new();
    let mut installs: Vec<JavaInstall> = candidates
        .iter()
        .filter_map(|path| inspect(path))
        .filter(|install| seen.insert(install.path.clone()))
        .collect();
    installs.sort_by(|a, b| {
        b.major
            .cmp(&a.major)
            .then_with(|| b.version.cmp(&a.version))
    });
    installs
}

pub fn compatible(install: &JavaInstall, min: u32, max: Option<u32>) -> bool {
    install.major >= min && max.is_none_or(|max| install.major <= max)
}

/// JDK à utiliser : celui choisi s'il convient, sinon le plus proche du minimum requis
/// (le plus ancien compatible : c'est la version que la chaîne d'outils a été testée avec).
pub fn choose(
    installs: &[JavaInstall],
    preferred: Option<&str>,
    min: u32,
    max: Option<u32>,
) -> Option<JavaInstall> {
    if let Some(preferred) = preferred {
        if let Some(install) = inspect(Path::new(preferred)) {
            if compatible(&install, min, max) {
                return Some(install);
            }
        }
    }
    installs
        .iter()
        .filter(|install| compatible(install, min, max))
        .min_by_key(|install| install.major)
        .cloned()
}

/// Ce qu'il faut installer, en clair.
pub fn missing_message(min: u32, max: Option<u32>) -> String {
    let wanted = match max {
        Some(max) if max == min => format!("Java {min} exactement"),
        Some(max) => format!("Java {min} à {max}"),
        None => format!("Java {min} ou plus récent"),
    };
    format!(
        "Aucun JDK compatible trouvé : ce projet demande {wanted}. Installez Eclipse Temurin {min} (JDK, pas JRE) \
depuis https://adoptium.net/temurin/releases/?version={min}, puis relancez la détection."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_jdk(dir: &Path, version: &str) {
        std::fs::create_dir_all(dir.join("bin")).unwrap();
        std::fs::write(dir.join("bin").join(exe("javac")), "").unwrap();
        std::fs::write(
            dir.join("release"),
            format!("IMPLEMENTOR=\"Test\"\nJAVA_VERSION=\"{version}\"\n"),
        )
        .unwrap();
    }

    #[test]
    fn versions_are_parsed() {
        assert_eq!(major_of("1.8.0_392"), Some(8));
        assert_eq!(major_of("17.0.9"), Some(17));
        assert_eq!(major_of("21"), Some(21));
        assert_eq!(major_of("21-ea"), Some(21));
        assert_eq!(major_of("x"), None);
    }

    #[test]
    fn jdks_are_inspected_and_chosen_by_range() {
        let base = std::env::temp_dir().join(format!("mcstudio-jdk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        fake_jdk(&base.join("jdk-17"), "17.0.12");
        fake_jdk(&base.join("jdk-21"), "21.0.4");
        std::fs::create_dir_all(base.join("jre-21/bin")).unwrap(); // pas de javac : ignoré

        let jdk17 = inspect(&base.join("jdk-17")).unwrap();
        assert_eq!(jdk17.major, 17);
        assert_eq!(jdk17.vendor.as_deref(), Some("Test"));
        // Depuis bin/java aussi.
        assert_eq!(inspect(&base.join("jdk-21/bin/java")).unwrap().major, 21);
        assert!(inspect(&base.join("jre-21")).is_none());

        let installs = vec![inspect(&base.join("jdk-21")).unwrap(), jdk17.clone()];
        assert_eq!(choose(&installs, None, 17, None).unwrap().major, 17);
        assert_eq!(choose(&installs, None, 21, None).unwrap().major, 21);
        assert!(choose(&installs, None, 17, Some(17)).is_some());
        assert!(choose(&installs[..1], None, 17, Some(17)).is_none());
        let preferred = base.join("jdk-21").display().to_string();
        assert_eq!(
            choose(&installs, Some(&preferred), 17, None).unwrap().major,
            21
        );
        assert!(missing_message(17, Some(17)).contains("Java 17 exactement"));
        let _ = std::fs::remove_dir_all(&base);
    }
}
