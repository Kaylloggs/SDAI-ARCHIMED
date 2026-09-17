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

    /// Ajoute plusieurs informations d'un coup (import). Ignore les vides et celles déjà
    /// présentes à l'identique dans la même portée. Retourne le nombre ajouté.
    pub fn add_notes(&self, texts: &[String], project: Option<String>) -> AppResult<usize> {
        let project = project.filter(|p| !p.trim().is_empty());
        let _guard = self.guard();
        let mut notes = self.read_notes();
        let now = chrono::Utc::now().timestamp();
        let mut added = 0;
        for text in texts {
            let Ok(text) = clean(text) else {
                continue;
            };
            let duplicate = notes.iter().any(|n| {
                n.text.eq_ignore_ascii_case(&text)
                    && n.project.as_deref().map(normalize) == project.as_deref().map(normalize)
            });
            if duplicate {
                continue;
            }
            notes.push(Note {
                id: uuid::Uuid::new_v4().to_string(),
                text,
                project: project.clone(),
                enabled: true,
                // Décalage d'une seconde par note : l'ordre du fichier est conservé.
                created_at: now + added as i64,
                updated_at: now,
            });
            added += 1;
        }
        if added > 0 {
            self.write_notes(&notes)?;
        }
        Ok(added)
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

/// Taille maximale d'un fichier importé.
const IMPORT_MAX_BYTES: u64 = 1024 * 1024;

/// Lit un fichier d'informations à importer et le découpe en entrées.
pub fn read_import_file(path: &Path) -> AppResult<Vec<String>> {
    let size = std::fs::metadata(path)?.len();
    if size > IMPORT_MAX_BYTES {
        return Err(AppError::invalid("fichier trop volumineux (1 Mo max)"));
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|_| AppError::invalid("fichier illisible : utilisez un fichier texte (UTF-8)"))?;
    let is_json = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("json"));
    let items = if is_json { parse_json_import(&raw)? } else { parse_text_import(&raw) };
    Ok(items.into_iter().filter(|item| item.chars().count() <= NOTE_MAX).collect())
}

/// JSON : tableau de textes, ou d'objets `{ "text": … }`.
fn parse_json_import(raw: &str) -> AppResult<Vec<String>> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| AppError::invalid(format!("JSON invalide : {e}")))?;
    let array = value
        .as_array()
        .ok_or_else(|| AppError::invalid("le JSON doit être une liste"))?;
    Ok(array
        .iter()
        .filter_map(|item| match item {
            serde_json::Value::String(text) => Some(text.trim().to_string()),
            other => other.get("text").and_then(|t| t.as_str()).map(|t| t.trim().to_string()),
        })
        .filter(|text| !text.is_empty())
        .collect())
}

/// Texte ou Markdown : une information par ligne (puces `-`, `*`, `•`, numéros ou texte simple).
/// Titres et séparateurs ignorés ; une ligne indentée sous une puce la complète.
fn parse_text_import(raw: &str) -> Vec<String> {
    let mut items: Vec<String> = Vec::new();
    let mut previous_was_item = false;
    for line in raw.lines() {
        let indented = line.starts_with("  ") || line.starts_with('\t');
        let trimmed = line.trim();
        if trimmed.is_empty() {
            previous_was_item = false;
            continue;
        }
        if trimmed.starts_with('#') || trimmed.chars().all(|c| matches!(c, '-' | '*' | '_' | '=')) {
            previous_was_item = false;
            continue;
        }
        let content = strip_bullet(trimmed);
        if content.is_empty() {
            continue;
        }
        let is_bullet = content.len() != trimmed.len();
        if indented && previous_was_item && !is_bullet {
            if let Some(last) = items.last_mut() {
                last.push(' ');
                last.push_str(content);
                continue;
            }
        }
        items.push(content.to_string());
        previous_was_item = true;
    }
    items
}

fn strip_bullet(line: &str) -> &str {
    let without = line
        .strip_prefix("- [ ] ")
        .or_else(|| line.strip_prefix("- [x] "))
        .or_else(|| line.strip_prefix("- "))
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("• "))
        .or_else(|| line.strip_prefix("+ "));
    if let Some(rest) = without {
        return rest.trim();
    }
    // « 1. » ou « 1) »
    let digits = line.chars().take_while(char::is_ascii_digit).count();
    if digits > 0 {
        let rest = &line[digits..];
        if let Some(rest) = rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") ")) {
            return rest.trim();
        }
    }
    line
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
    fn parses_text_and_markdown_lists() {
        let raw = "# Moi\n\n- Je m'appelle Alix\n* Je code en TypeScript\n  et en Rust\n1. Réponses en français\n---\nJ'aime les interfaces sobres\n\n## Vide\n- \n";
        assert_eq!(
            parse_text_import(raw),
            vec![
                "Je m'appelle Alix",
                "Je code en TypeScript et en Rust",
                "Réponses en français",
                "J'aime les interfaces sobres",
            ]
        );
    }

    #[test]
    fn parses_json_lists() {
        let items = parse_json_import(r#"["a", {"text": " b "}, 3, {"autre": 1}, ""]"#).unwrap();
        assert_eq!(items, vec!["a", "b"]);
        assert!(parse_json_import(r#"{"text": "a"}"#).is_err());
    }

    #[test]
    fn bulk_add_skips_duplicates() {
        let memory = service("bulk");
        memory.add_note("Déjà là", None).unwrap();
        let added = memory
            .add_notes(&["déjà là".into(), "Nouveau".into(), " ".into(), "Nouveau".into()], None)
            .unwrap();
        assert_eq!(added, 1);
        assert_eq!(memory.notes().len(), 2);
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
