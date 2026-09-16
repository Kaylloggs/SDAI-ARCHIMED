use std::path::{Path, PathBuf};

use crate::core::paths::{cli_skills_dir, Paths};
use crate::core::{AppError, AppResult};

use super::types::{Skill, SkillSource};

const CLI_TARGETS: &[&str] = &["claude", "antigravity"];

pub struct SkillsService {
    pub library: PathBuf,
}

impl SkillsService {
    pub fn new(paths: &Paths) -> AppResult<Self> {
        let library = paths.skills();
        std::fs::create_dir_all(&library)?;
        Ok(Self { library })
    }

    /// Bibliothèque locale + skills déjà présents dans les dossiers des CLI.
    pub fn list(&self) -> AppResult<Vec<Skill>> {
        let mut skills = Vec::new();

        for entry in read_skill_dirs(&self.library) {
            let id = folder_name(&entry);
            let targets = active_targets(&id);
            skills.push(build_skill(&entry, SkillSource::Library, !targets.is_empty(), targets)?);
        }

        for cli in CLI_TARGETS {
            let Some(dir) = cli_skills_dir(cli) else {
                continue;
            };
            for entry in read_skill_dirs(&dir) {
                let id = folder_name(&entry);
                if skills.iter().any(|s| s.id == id) {
                    continue;
                }
                // Une jonction pointant vers la bibliothèque est déjà comptée ci-dessus.
                if entry.read_link().is_ok() {
                    continue;
                }
                skills.push(build_skill(
                    &entry,
                    SkillSource::External,
                    true,
                    vec![(*cli).to_string()],
                )?);
            }
        }

        skills.sort_by_key(|skill| skill.name.to_lowercase());
        Ok(skills)
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> AppResult<()> {
        let source = self.library.join(id);
        if !source.exists() {
            return Err(AppError::not_found(format!("skill {id} absent de la bibliothèque")));
        }

        for cli in CLI_TARGETS {
            let Some(dir) = cli_skills_dir(cli) else {
                continue;
            };
            if !dir.exists() {
                continue;
            }
            let link = dir.join(id);
            if enabled {
                if !link.exists() {
                    create_link(&source, &link)?;
                }
            } else if link.exists() && link.read_link().is_ok() {
                let _ = std::fs::remove_dir(&link);
            }
        }
        Ok(())
    }

    /// Copie un dossier de skill dans la bibliothèque après validation.
    pub fn import_from_path(&self, path: &Path) -> AppResult<Skill> {
        if !path.join("SKILL.md").exists() {
            return Err(AppError::invalid("dossier sans fichier SKILL.md"));
        }
        let id = folder_name(path);
        let destination = self.library.join(&id);
        copy_dir(path, &destination)?;
        build_skill(&destination, SkillSource::Library, false, Vec::new())
    }
}

fn read_skill_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.join("SKILL.md").exists())
        .collect()
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn active_targets(id: &str) -> Vec<String> {
    CLI_TARGETS
        .iter()
        .filter(|cli| {
            cli_skills_dir(cli)
                .map(|dir| dir.join(id).exists())
                .unwrap_or(false)
        })
        .map(|cli| (*cli).to_string())
        .collect()
}

fn build_skill(
    path: &Path,
    source: SkillSource,
    enabled: bool,
    targets: Vec<String>,
) -> AppResult<Skill> {
    let id = folder_name(path);
    let content = std::fs::read_to_string(path.join("SKILL.md")).unwrap_or_default();
    let (name, description) = parse_frontmatter(&content);

    Ok(Skill {
        name: name.unwrap_or_else(|| id.clone()),
        description: description.unwrap_or_default(),
        id,
        path: path.display().to_string(),
        source,
        enabled,
        targets,
    })
}

/// Lit `name:` et `description:` du frontmatter YAML d'un SKILL.md.
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut name = None;
    let mut description = None;
    let mut in_front = false;

    for line in content.lines().take(40) {
        if line.trim() == "---" {
            if in_front {
                break;
            }
            in_front = true;
            continue;
        }
        if !in_front {
            continue;
        }
        if let Some(value) = line.strip_prefix("name:") {
            name = Some(value.trim().trim_matches('"').to_string());
        } else if let Some(value) = line.strip_prefix("description:") {
            description = Some(value.trim().trim_matches('"').to_string());
        }
    }
    (name, description)
}

#[cfg(windows)]
fn create_link(source: &Path, link: &Path) -> AppResult<()> {
    // Jonction NTFS : pas de droits administrateur nécessaires.
    let status = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(link)
        .arg(source)
        .output()?;
    if status.status.success() {
        Ok(())
    } else {
        Err(AppError::internal(
            String::from_utf8_lossy(&status.stderr).to_string(),
        ))
    }
}

#[cfg(not(windows))]
fn create_link(source: &Path, link: &Path) -> AppResult<()> {
    std::os::unix::fs::symlink(source, link)?;
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::parse_frontmatter;

    #[test]
    fn reads_name_and_description() {
        let content = "---\nname: mon-skill\ndescription: fait des choses\n---\n\ncorps";
        let (name, description) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("mon-skill"));
        assert_eq!(description.as_deref(), Some("fait des choses"));
    }

    #[test]
    fn tolerates_missing_frontmatter() {
        let (name, description) = parse_frontmatter("pas de frontmatter");
        assert!(name.is_none() && description.is_none());
    }
}
