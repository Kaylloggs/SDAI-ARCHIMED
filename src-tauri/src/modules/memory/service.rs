//! Mémoire d'ARCHIMED : informations saisies par l'utilisateur, transmises aux IA s'il le souhaite.
//! Tout est local : `%APPDATA%\com.sdai.archimed\modules\memory\`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::core::paths::Paths;
use crate::core::{AppError, AppResult};

/// Plafond du bloc injecté dans une nouvelle conversation (caractères).
const CONTEXT_BUDGET: usize = 4000;
const NOTE_MAX: usize = 2000;

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    /// Dossier de projet, ou `None` pour une information valable partout.
    pub project: Option<String>,
    /// Transmise aux IA (désactivable sans supprimer la note).
    #[serde(default = "yes")]
    pub enabled: bool,
    pub created_at: i64,
    #[serde(default)]
    pub updated_at: i64,
}

/// Modification partielle d'une note.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub text: Option<String>,
    pub enabled: Option<bool>,
    /// `Some(None)` : note globale ; `None` : portée inchangée.
    #[serde(default, deserialize_with = "serde_with_option::deserialize")]
    pub project: Option<Option<String>>,
}

/// Distingue un champ absent (`None`) d'un champ `null` (`Some(None)`).
mod serde_with_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        D: Deserializer<'de>,
        T: Deserialize<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MemorySettings {
    /// Transmettre les notes actives au premier message des nouvelles conversations.
    pub inject: bool,
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self { inject: true }
    }
}

pub struct MemoryService {
    dir: PathBuf,
    lock: Mutex<()>,
}

/// Comparaison de chemins insensible à la casse et aux séparateurs (Windows).
fn normalize(path: &str) -> String {
    path.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// Une note de projet s'applique au projet et à ses sous-dossiers.
fn applies_to(note_project: &str, cwd: &str) -> bool {
    let note = normalize(note_project);
    let cwd = normalize(cwd);
    cwd == note || cwd.starts_with(&format!("{note}/"))
}

fn clean(text: &str) -> AppResult<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::invalid("note vide"));
    }
    if text.chars().count() > NOTE_MAX {
        return Err(AppError::invalid(format!("note trop longue ({NOTE_MAX} caractères max)")));
    }
    Ok(text.to_string())
}

impl MemoryService {
    pub fn new(paths: &Paths) -> AppResult<Self> {
        let dir = paths.module_dir("memory");
        std::fs::create_dir_all(&dir)?;
        // Le journal automatique a été retiré : ses extraits de conversations ne sont plus conservés.
        let _ = std::fs::remove_file(dir.join("journal.jsonl"));
        Ok(Self::at(dir))
    }

    pub fn at(dir: PathBuf) -> Self {
        Self {
            dir,
            lock: Mutex::new(()),
        }
    }

    fn guard(&self) -> std::sync::MutexGuard<'_, ()> {
        self.lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_atomic(path: &Path, bytes: &[u8]) -> AppResult<()> {
        let temp = path.with_extension("tmp");
        std::fs::write(&temp, bytes)?;
        std::fs::rename(&temp, path)?;
        Ok(())
    }

    // ── Réglages ────────────────────────────────────────────────────────────
    pub fn settings(&self) -> MemorySettings {
        std::fs::read_to_string(self.dir.join("settings.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &MemorySettings) -> AppResult<()> {
        let _guard = self.guard();
        Self::write_atomic(&self.dir.join("settings.json"), &serde_json::to_vec_pretty(settings)?)
    }

    // ── Notes ───────────────────────────────────────────────────────────────
    fn read_notes(&self) -> Vec<Note> {
        std::fs::read_to_string(self.dir.join("notes.json"))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    fn write_notes(&self, notes: &[Note]) -> AppResult<()> {
        Self::write_atomic(&self.dir.join("notes.json"), &serde_json::to_vec_pretty(notes)?)
    }

    /// Plus récentes d'abord.
    pub fn notes(&self) -> Vec<Note> {
        let mut notes = self.read_notes();
        notes.sort_by_key(|note| std::cmp::Reverse(note.created_at));
        notes
    }

    pub fn add_note(&self, text: &str, project: Option<String>) -> AppResult<Note> {
        let text = clean(text)?;
        let now = chrono::Utc::now().timestamp();
        let note = Note {
            id: uuid::Uuid::new_v4().to_string(),
            text,
            project: project.filter(|p| !p.trim().is_empty()),
            enabled: true,
            created_at: now,
            updated_at: now,
        };
        let _guard = self.guard();
        let mut notes = self.read_notes();
        notes.push(note.clone());
        self.write_notes(&notes)?;
        Ok(note)
    }

    pub fn update_note(&self, id: &str, patch: NotePatch) -> AppResult<Note> {
        let _guard = self.guard();
        let mut notes = self.read_notes();
        let note = notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::not_found("note introuvable"))?;
        if let Some(text) = patch.text {
            note.text = clean(&text)?;
        }
        if let Some(enabled) = patch.enabled {
            note.enabled = enabled;
        }
        if let Some(project) = patch.project {
            note.project = project.filter(|p| !p.trim().is_empty());
        }
        note.updated_at = chrono::Utc::now().timestamp();
        let updated = note.clone();
        self.write_notes(&notes)?;
        Ok(updated)
    }

    pub fn delete_note(&self, id: &str) -> AppResult<()> {
        let _guard = self.guard();
        let mut notes = self.read_notes();
        notes.retain(|n| n.id != id);
        self.write_notes(&notes)
    }

    // ── Contexte injecté ────────────────────────────────────────────────────
    /// Bloc ajouté au premier message d'une conversation : notes actives, globales ou du projet.
    /// `None` s'il n'y a rien à transmettre.
    pub fn build_context(&self, cwd: Option<&str>) -> Option<String> {
        let mut notes: Vec<Note> = self
            .notes()
            .into_iter()
            .filter(|note| note.enabled)
            .filter(|note| match (&note.project, cwd) {
                (None, _) => true,
                (Some(project), Some(cwd)) => applies_to(project, cwd),
                (Some(_), None) => false,
            })
            .collect();
        if notes.is_empty() {
            return None;
        }
        // Les plus anciennes d'abord : l'ordre dans lequel l'utilisateur les a écrites.
        notes.reverse();

        let header = "[Mémoire ARCHIMED — informations fournies par l'utilisateur. Tiens-en compte si elles sont pertinentes, sans les répéter.]\n";
        let footer = "[Fin de la mémoire]";
        let mut block = String::from(header);
        for note in &notes {
            let scope = if note.project.is_some() { "ce projet" } else { "général" };
            let line = format!("- ({scope}) {}\n", note.text.replace('\n', "\n  "));
            if block.chars().count() + line.chars().count() + footer.chars().count() > CONTEXT_BUDGET {
                break;
            }
            block.push_str(&line);
        }
        if block == header {
            return None;
        }
        block.push_str(footer);
        Some(block)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(name: &str) -> MemoryService {
        let dir = std::env::temp_dir().join(format!("archimed-memory-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        MemoryService::at(dir)
    }

    #[test]
    fn context_contains_enabled_notes_in_scope() {
        let memory = service("scope");
        let pnpm = memory.add_note("Utiliser pnpm, jamais npm", Some("F:\\Proj".into())).unwrap();
        memory.add_note("Répondre en français", None).unwrap();
        let hidden = memory.add_note("Secret", None).unwrap();
        memory
            .update_note(&hidden.id, NotePatch { enabled: Some(false), ..Default::default() })
            .unwrap();
        assert!(memory.add_note("   ", None).is_err());

        let context = memory.build_context(Some("F:/proj/src")).unwrap();
        assert!(context.contains("(ce projet) Utiliser pnpm"));
        assert!(context.contains("(général) Répondre en français"));
        assert!(!context.contains("Secret"));
        assert!(context.ends_with("[Fin de la mémoire]"));

        let elsewhere = memory.build_context(Some("D:/Autre")).unwrap();
        assert!(!elsewhere.contains("pnpm"));

        memory
            .update_note(&pnpm.id, NotePatch { project: Some(None), ..Default::default() })
            .unwrap();
        assert!(memory.build_context(Some("D:/Autre")).unwrap().contains("pnpm"));
    }

    #[test]
    fn context_respects_budget() {
        let memory = service("budget");
        for i in 0..20 {
            memory.add_note(&format!("Note {i} {}", "détail ".repeat(60)), None).unwrap();
        }
        let context = memory.build_context(None).unwrap();
        assert!(context.chars().count() <= CONTEXT_BUDGET);
    }

    #[test]
    fn nothing_to_inject_without_active_notes() {
        let memory = service("empty");
        assert!(memory.build_context(Some("F:/Proj")).is_none());
        let note = memory.add_note("x", None).unwrap();
        memory
            .update_note(&note.id, NotePatch { enabled: Some(false), ..Default::default() })
            .unwrap();
        assert!(memory.build_context(None).is_none());
    }

    #[test]
    fn reads_notes_from_previous_format() {
        let memory = service("legacy");
        std::fs::write(
            memory.dir.join("notes.json"),
            r#"[{"id":"1","text":"ancienne","project":null,"source":"ai","createdAt":5}]"#,
        )
        .unwrap();
        let notes = memory.notes();
        assert_eq!(notes.len(), 1);
        assert!(notes[0].enabled);
    }
}
