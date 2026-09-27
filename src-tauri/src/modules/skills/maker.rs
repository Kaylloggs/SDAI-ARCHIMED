//! Atelier de skills : brouillons où une IA écrit un skill, sous le regard de la personne.
//!
//! ```text
//! <données>/modules/skills/
//!   drafts/<id>/            dossier de travail de l'IA (cwd de sa session)
//!     draft.json            nature, origine, dernier enregistrement
//!     skill/                le skill en cours (SKILL.md, references/, scripts/, assets/)
//!     tests.json            demandes de test (hors du skill : elles ne sont pas livrées)
//!     source/               matière fournie (conversation à transformer en skill…)
//!     runs/<n>/             dossier de travail d'un test
//!   backups/<nom>-<date>/   version remplacée d'un skill de la bibliothèque
//! ```
//! Rien n'entre dans la bibliothèque sans `save` : copie du dossier `skill/` sous le nom de son
//! en-tête, après vérification sans erreur ; un skill remplacé est d'abord sauvegardé.

use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::{AppError, AppResult};

use super::check;
use super::frontmatter;
use super::types::{ChangeKind, CheckLevel, DraftChange, DraftFile, DraftInfo, DraftKind, DraftReport};

/// Chemins qu'on peut lire ou écrire dans un brouillon depuis l'interface.
const WRITABLE: &[&str] = &["skill/", "tests.json", "source/"];
const MAX_TEXT: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    kind: DraftKind,
    source_id: Option<String>,
    created_at: u64,
    saved_as: Option<String>,
    saved_at: Option<u64>,
}

pub struct Maker {
    drafts: PathBuf,
    backups: PathBuf,
    library: PathBuf,
}

impl Maker {
    pub fn new(module_dir: &Path, library: &Path) -> AppResult<Self> {
        let drafts = module_dir.join("drafts");
        std::fs::create_dir_all(&drafts)?;
        Ok(Self {
            drafts,
            backups: module_dir.join("backups"),
            library: library.to_path_buf(),
        })
    }

    /// Nouveau brouillon, vide ou copie d'un skill (`source` : dossier du skill à améliorer).
    pub fn create(&self, source: Option<&Path>) -> AppResult<DraftInfo> {
        let created_at = now();
        // Deux brouillons dans la même milliseconde : le second prend le numéro suivant.
        let mut stamp = created_at;
        while self.drafts.join(format!("d{stamp}")).exists() {
            stamp += 1;
        }
        let id = format!("d{stamp}");
        let root = self.drafts.join(&id);
        let skill = root.join("skill");
        std::fs::create_dir_all(&skill)?;
        let source_id = match source {
            Some(path) => {
                if !path.join("SKILL.md").is_file() {
                    return Err(AppError::invalid("Ce dossier ne contient pas de SKILL.md."));
                }
                copy_dir(path, &skill)?;
                path.file_name().map(|n| n.to_string_lossy().to_string())
            }
            None => None,
        };
        let meta = Meta {
            kind: if source.is_some() { DraftKind::Edit } else { DraftKind::New },
            source_id,
            created_at,
            saved_as: None,
            saved_at: None,
        };
        write_meta(&root, &meta)?;
        self.info(&id)
    }

    pub fn list(&self) -> AppResult<Vec<DraftInfo>> {
        let mut drafts: Vec<DraftInfo> = std::fs::read_dir(&self.drafts)?
            .flatten()
            .filter(|entry| entry.path().join("draft.json").is_file())
            .filter_map(|entry| self.info(&entry.file_name().to_string_lossy()).ok())
            .collect();
        drafts.sort_by_key(|draft| std::cmp::Reverse(draft.updated_at));
        Ok(drafts)
    }

    pub fn info(&self, id: &str) -> AppResult<DraftInfo> {
        let root = self.root(id)?;
        let meta = read_meta(&root)?;
        let skill = root.join("skill");
        let header = std::fs::read_to_string(skill.join("SKILL.md")).map(|c| frontmatter::parse(&c)).unwrap_or_default();
        let files = check::collect(&skill);
        // Seul le skill compte : tests, avis et essais ne le rendent pas « modifié ».
        let updated_at = latest_change(&skill).max(meta.created_at);
        Ok(DraftInfo {
            id: id.to_string(),
            name: header.get("name").unwrap_or_default().to_string(),
            description: header.get("description").unwrap_or_default().to_string(),
            path: root.display().to_string(),
            skill_path: skill.display().to_string(),
            kind: meta.kind,
            source_id: meta.source_id,
            created_at: meta.created_at,
            updated_at,
            saved_as: meta.saved_as,
            saved_at: meta.saved_at,
            files: files.len(),
        })
    }

    /// Brouillon à la Corbeille (récupérable).
    pub fn delete(&self, id: &str) -> AppResult<()> {
        let root = self.root(id)?;
        trash::delete(&root).map_err(|e| AppError::internal(format!("mise à la Corbeille du brouillon : {e}")))
    }

    pub fn files(&self, id: &str) -> AppResult<Vec<DraftFile>> {
        let skill = self.root(id)?.join("skill");
        Ok(check::collect(&skill).into_iter().map(|f| DraftFile { path: f.path, size: f.size }).collect())
    }

    /// Texte d'un fichier du brouillon (`skill/…`, `tests.json`, `source/…`) ; `None` s'il n'existe pas.
    pub fn read(&self, id: &str, relative: &str) -> AppResult<Option<String>> {
        let path = self.resolve(id, relative)?;
        if !path.is_file() {
            return Ok(None);
        }
        if path.metadata()?.len() > MAX_TEXT {
            return Err(AppError::invalid("Fichier trop gros pour être affiché (plus de 2 Mo)."));
        }
        let bytes = std::fs::read(&path)?;
        if bytes.iter().take(8_000).any(|b| *b == 0) {
            return Err(AppError::invalid("Fichier binaire : il ne s'affiche pas comme du texte."));
        }
        Ok(Some(String::from_utf8_lossy(&bytes).to_string()))
    }

    pub fn write(&self, id: &str, relative: &str, content: &str) -> AppResult<()> {
        let path = self.resolve(id, relative)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let temp = path.with_extension("archimed-tmp");
        std::fs::write(&temp, content)?;
        std::fs::rename(&temp, &path)?;
        Ok(())
    }

    /// Dossier de travail d'un test (vide, numéroté) : les essais n'écrivent pas dans le skill.
    pub fn prepare_run(&self, id: &str) -> AppResult<String> {
        let runs = self.root(id)?.join("runs");
        std::fs::create_dir_all(&runs)?;
        let next = std::fs::read_dir(&runs)?
            .flatten()
            .filter_map(|e| e.file_name().to_string_lossy().parse::<u32>().ok())
            .max()
            .unwrap_or(0)
            + 1;
        let run = runs.join(next.to_string());
        std::fs::create_dir_all(&run)?;
        Ok(run.display().to_string())
    }

    pub fn report(&self, id: &str) -> AppResult<DraftReport> {
        let skill = self.root(id)?.join("skill");
        let files = check::collect(&skill);
        let checked = check::check(&files);
        let target_exists = checked
            .name
            .as_deref()
            .filter(|name| check::valid_name(name))
            .is_some_and(|name| self.library.join(name).join("SKILL.md").is_file());
        let ready = !checked.issues.iter().any(|issue| issue.level == CheckLevel::Error);
        Ok(DraftReport {
            name: checked.name,
            description: checked.description,
            body_lines: checked.body_lines,
            files: files.len(),
            bytes: files.iter().map(|f| f.size).sum(),
            scripts: checked.scripts,
            issues: checked.issues,
            ready,
            target_exists,
        })
    }

    /// Copie le skill dans la bibliothèque sous le nom de son en-tête. Un skill du même nom est
    /// remplacé seulement avec `replace`, après sauvegarde dans `backups/`. Le dossier existant
    /// est vidé puis rempli (et non supprimé) : les liens vers les CLI restent valides.
    pub fn save(&self, id: &str, replace: bool) -> AppResult<String> {
        let report = self.report(id)?;
        if !report.ready {
            return Err(AppError::invalid("Le skill a encore des erreurs : corrigez-les avant de l'enregistrer."));
        }
        let name = report.name.ok_or_else(|| AppError::invalid("Le skill n'a pas de nom."))?;
        let root = self.root(id)?;
        let destination = self.library.join(&name);
        if destination.exists() {
            if !replace {
                return Err(AppError::invalid(format!(
                    "Un skill « {name} » existe déjà dans la bibliothèque : confirmez pour le remplacer."
                )));
            }
            let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
            let backup = self.backups.join(format!("{name}-{stamp}"));
            copy_dir(&destination, &backup)?;
            clear_dir(&destination)?;
        }
        copy_dir(&root.join("skill"), &destination)?;

        let mut meta = read_meta(&root)?;
        meta.saved_as = Some(name.clone());
        meta.saved_at = Some(now());
        write_meta(&root, &meta)?;
        Ok(name)
    }

    /// Différences avec le skill d'origine (brouillon « améliorer »).
    pub fn changes(&self, id: &str) -> AppResult<Vec<DraftChange>> {
        let root = self.root(id)?;
        let meta = read_meta(&root)?;
        let Some(source_id) = meta.source_id else { return Ok(Vec::new()) };
        let source = self.library.join(&source_id);
        let before = check::collect(&source);
        let after = check::collect(&root.join("skill"));
        let mut changes = Vec::new();
        for file in &after {
            match before.iter().find(|b| b.path == file.path) {
                None => changes.push(DraftChange {
                    path: file.path.clone(),
                    kind: ChangeKind::Created,
                    before: None,
                    after: file.text.clone(),
                    binary: file.text.is_none(),
                }),
                Some(old) if old.text != file.text || old.size != file.size => changes.push(DraftChange {
                    path: file.path.clone(),
                    kind: ChangeKind::Modified,
                    before: old.text.clone(),
                    after: file.text.clone(),
                    binary: file.text.is_none() || old.text.is_none(),
                }),
                Some(_) => {}
            }
        }
        for old in &before {
            if !after.iter().any(|f| f.path == old.path) {
                changes.push(DraftChange {
                    path: old.path.clone(),
                    kind: ChangeKind::Deleted,
                    before: old.text.clone(),
                    after: None,
                    binary: old.text.is_none(),
                });
            }
        }
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(changes)
    }

    fn root(&self, id: &str) -> AppResult<PathBuf> {
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            return Err(AppError::invalid("Identifiant de brouillon invalide."));
        }
        let root = self.drafts.join(id);
        if !root.join("draft.json").is_file() {
            return Err(AppError::not_found("Ce brouillon n'existe plus."));
        }
        Ok(root)
    }

    /// Chemin relatif → chemin dans le brouillon, limité aux emplacements prévus.
    fn resolve(&self, id: &str, relative: &str) -> AppResult<PathBuf> {
        let root = self.root(id)?;
        let relative = relative.replace('\\', "/");
        let refused = || AppError::invalid(format!("« {relative} » : emplacement refusé dans le brouillon."));
        if relative.contains(':') || !WRITABLE.iter().any(|allowed| relative == allowed.trim_end_matches('/') || relative.starts_with(allowed)) {
            return Err(refused());
        }
        let mut clean = PathBuf::new();
        for component in Path::new(&relative).components() {
            match component {
                Component::Normal(part) => clean.push(part),
                Component::CurDir => {}
                _ => return Err(refused()),
            }
        }
        if clean.as_os_str().is_empty() || relative.ends_with('/') {
            return Err(refused());
        }
        Ok(root.join(clean))
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn read_meta(root: &Path) -> AppResult<Meta> {
    let text = std::fs::read_to_string(root.join("draft.json"))?;
    serde_json::from_str(&text).map_err(|e| AppError::internal(format!("draft.json illisible : {e}")))
}

fn write_meta(root: &Path, meta: &Meta) -> AppResult<()> {
    let text = serde_json::to_string_pretty(meta).map_err(|e| AppError::internal(e.to_string()))?;
    std::fs::write(root.join("draft.json"), text)?;
    Ok(())
}

/// Date de la dernière modification sous `root` (ms).
fn latest_change(root: &Path) -> u64 {
    let mut latest = 0;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if let Ok(modified) = entry.metadata().and_then(|m| m.modified()) {
                let ms = modified.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                latest = latest.max(ms);
            }
        }
    }
    latest
}

fn copy_dir(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else if kind.is_file() {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Vide un dossier sans le supprimer (une jonction peut pointer dessus).
fn clear_dir(dir: &Path) -> AppResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            std::fs::remove_dir_all(entry.path())?;
        } else {
            std::fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SKILL: &str = "---\nname: rapport-hebdo\ndescription: Rédige le rapport de la semaine à partir des tickets. À utiliser quand la personne demande un point hebdomadaire ou un récapitulatif.\n---\n\n# Rapport\n\n1. Lire.\n2. Regrouper.\n3. Écrire.\n";

    fn sandbox(name: &str) -> (PathBuf, Maker) {
        let root = std::env::temp_dir().join(format!("archimed-maker-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("library")).unwrap();
        let maker = Maker::new(&root.join("module"), &root.join("library")).unwrap();
        (root, maker)
    }

    #[test]
    fn new_draft_is_checked_saved_and_replaced_with_a_backup() {
        let (root, maker) = sandbox("save");
        let draft = maker.create(None).unwrap();
        assert_eq!(draft.kind, DraftKind::New);
        assert!(!maker.report(&draft.id).unwrap().ready, "un brouillon vide n'est pas prêt");
        assert!(maker.save(&draft.id, false).is_err());

        maker.write(&draft.id, "skill/SKILL.md", SKILL).unwrap();
        maker.write(&draft.id, "tests.json", "[]").unwrap();
        let report = maker.report(&draft.id).unwrap();
        assert!(report.ready, "{:?}", report.issues);
        assert!(!report.target_exists);
        assert_eq!(maker.info(&draft.id).unwrap().name, "rapport-hebdo");

        assert_eq!(maker.save(&draft.id, false).unwrap(), "rapport-hebdo");
        assert!(root.join("library/rapport-hebdo/SKILL.md").is_file());
        assert!(!root.join("library/rapport-hebdo/tests.json").exists(), "les tests ne sont pas livrés");
        assert_eq!(maker.info(&draft.id).unwrap().saved_as.as_deref(), Some("rapport-hebdo"));

        // Même nom : refus sans confirmation, puis remplacement avec sauvegarde.
        let second = maker.create(None).unwrap();
        maker.write(&second.id, "skill/SKILL.md", &SKILL.replace("3. Écrire.", "3. Écrire court.")).unwrap();
        assert!(maker.report(&second.id).unwrap().target_exists);
        assert!(maker.save(&second.id, false).is_err());
        maker.save(&second.id, true).unwrap();
        let saved = std::fs::read_to_string(root.join("library/rapport-hebdo/SKILL.md")).unwrap();
        assert!(saved.contains("Écrire court"));
        let backups: Vec<_> = std::fs::read_dir(root.join("module/backups")).unwrap().flatten().collect();
        assert_eq!(backups.len(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn edit_draft_lists_its_changes() {
        let (root, maker) = sandbox("edit");
        let source = root.join("library/rapport-hebdo");
        std::fs::create_dir_all(source.join("references")).unwrap();
        std::fs::write(source.join("SKILL.md"), SKILL).unwrap();
        std::fs::write(source.join("references/old.md"), "ancien").unwrap();

        let draft = maker.create(Some(&source)).unwrap();
        assert_eq!((draft.kind, draft.source_id.as_deref()), (DraftKind::Edit, Some("rapport-hebdo")));
        assert!(maker.changes(&draft.id).unwrap().is_empty());

        maker.write(&draft.id, "skill/SKILL.md", &SKILL.replace("Lire.", "Lire les tickets.")).unwrap();
        maker.write(&draft.id, "skill/references/new.md", "nouveau").unwrap();
        std::fs::remove_file(PathBuf::from(&draft.skill_path).join("references/old.md")).unwrap();
        let changes = maker.changes(&draft.id).unwrap();
        let kinds: Vec<(&str, ChangeKind)> = changes.iter().map(|c| (c.path.as_str(), c.kind)).collect();
        assert_eq!(
            kinds,
            [
                ("SKILL.md", ChangeKind::Modified),
                ("references/new.md", ChangeKind::Created),
                ("references/old.md", ChangeKind::Deleted)
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn paths_stay_inside_the_draft() {
        let (root, maker) = sandbox("paths");
        let draft = maker.create(None).unwrap();
        for bad in ["../x", "skill/../../x", "draft.json", "C:/x", "runs/1/a", "skill/"] {
            assert!(maker.write(&draft.id, bad, "x").is_err(), "{bad} accepté");
        }
        assert!(maker.read(&draft.id, "skill/absent.md").unwrap().is_none());
        assert!(maker.info("../etc").is_err());
        let run = maker.prepare_run(&draft.id).unwrap();
        assert!(run.ends_with('1'));
        let _ = std::fs::remove_dir_all(&root);
    }
}
