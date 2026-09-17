//! Mémoire d'ARCHIMED : notes durables + journal automatique des réponses.
//! Tout est local : `%APPDATA%\com.sdai.archimed\modules\memory\`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::core::paths::Paths;
use crate::core::{AppError, AppResult};

/// Plafond du bloc injecté dans une nouvelle conversation (caractères).
const CONTEXT_BUDGET: usize = 3000;
const JOURNAL_IN_CONTEXT: usize = 5;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub text: String,
    /// Dossier de projet, ou `None` pour une note globale.
    pub project: Option<String>,
    /// `user` | `ai` | `message`
    pub source: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    pub at: i64,
    pub conversation_id: String,
    pub origin: String,
    pub adapter: String,
    pub project: Option<String>,
    pub title: String,
    pub request: String,
    pub outcome: String,
    pub files: Vec<String>,
    pub commands: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MemorySettings {
    /// Ajouter la mémoire au premier message des nouvelles conversations.
    pub inject: bool,
    /// Tenir le journal automatiquement.
    pub capture: bool,
}

impl Default for MemorySettings {
    fn default() -> Self {
        Self {
            inject: true,
            capture: true,
        }
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

fn truncate(text: &str, max: usize) -> String {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= max {
        clean
    } else {
        format!("{}…", clean.chars().take(max.saturating_sub(1)).collect::<String>())
    }
}

impl MemoryService {
    pub fn new(paths: &Paths) -> AppResult<Self> {
        let dir = paths.module_dir("memory");
        std::fs::create_dir_all(&dir)?;
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

    pub fn notes(&self) -> Vec<Note> {
        let mut notes = self.read_notes();
        notes.sort_by_key(|note| std::cmp::Reverse(note.created_at));
        notes
    }

    pub fn add_note(&self, text: &str, project: Option<String>, source: &str) -> AppResult<Note> {
        let text = text.trim();
        if text.is_empty() {
            return Err(AppError::invalid("note vide"));
        }
        let _guard = self.guard();
        let mut notes = self.read_notes();
        // Pas de doublon exact dans la même portée (l'IA peut répéter une note).
        let project = project.filter(|p| !p.trim().is_empty());
        if let Some(existing) = notes.iter().find(|n| {
            n.text.eq_ignore_ascii_case(text)
                && n.project.as_deref().map(normalize) == project.as_deref().map(normalize)
        }) {
            return Ok(existing.clone());
        }
        let note = Note {
            id: uuid::Uuid::new_v4().to_string(),
            text: truncate(text, 600),
            project,
            source: source.to_string(),
            created_at: chrono::Utc::now().timestamp(),
        };
        notes.push(note.clone());
        self.write_notes(&notes)?;
        Ok(note)
    }

    pub fn update_note(&self, id: &str, text: &str) -> AppResult<()> {
        let _guard = self.guard();
        let mut notes = self.read_notes();
        let note = notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::not_found("note introuvable"))?;
        note.text = truncate(text, 600);
        self.write_notes(&notes)
    }

    pub fn delete_note(&self, id: &str) -> AppResult<()> {
        let _guard = self.guard();
        let mut notes = self.read_notes();
        notes.retain(|n| n.id != id);
        self.write_notes(&notes)
    }

    // ── Journal ─────────────────────────────────────────────────────────────
    pub fn record(&self, mut entry: JournalEntry) -> AppResult<()> {
        entry.request = truncate(&entry.request, 300);
        entry.outcome = truncate(&entry.outcome, 400);
        entry.files.truncate(20);
        entry.commands.truncate(10);
        let _guard = self.guard();
        let line = serde_json::to_string(&entry)?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.dir.join("journal.jsonl"))?;
        writeln!(file, "{line}")?;
        Ok(())
    }

    /// Entrées les plus récentes d'abord ; `project` filtre sur un dossier.
    pub fn journal(&self, project: Option<&str>, limit: usize) -> Vec<JournalEntry> {
        let Ok(raw) = std::fs::read_to_string(self.dir.join("journal.jsonl")) else {
            return Vec::new();
        };
        let mut entries: Vec<JournalEntry> = raw
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .filter(|entry: &JournalEntry| match (project, entry.project.as_deref()) {
                (Some(wanted), Some(actual)) => applies_to(wanted, actual) || applies_to(actual, wanted),
                (Some(_), None) => false,
                (None, _) => true,
            })
            .collect();
        entries.reverse();
        entries.truncate(limit);
        entries
    }

    pub fn clear_journal(&self) -> AppResult<()> {
        let _guard = self.guard();
        let path = self.dir.join("journal.jsonl");
        if path.exists() {
            std::fs::remove_file(path)?;
        }
        Ok(())
    }

    // ── Contexte injecté ────────────────────────────────────────────────────
    /// Bloc ajouté au premier message d'une conversation. `None` si rien d'utile.
    pub fn build_context(&self, cwd: Option<&str>) -> Option<String> {
        let notes: Vec<Note> = self
            .notes()
            .into_iter()
            .filter(|note| match (&note.project, cwd) {
                (None, _) => true,
                (Some(project), Some(cwd)) => applies_to(project, cwd),
                (Some(_), None) => false,
            })
            .collect();
        let journal = cwd.map(|cwd| self.journal(Some(cwd), JOURNAL_IN_CONTEXT)).unwrap_or_default();

        if notes.is_empty() && journal.is_empty() {
            return None;
        }

        let mut block = String::from(
            "[Mémoire ARCHIMED — informations des sessions précédentes. Utilise-les si elles sont pertinentes, sans les répéter.]\n",
        );
        let footer = "Pour retenir une information utile aux prochaines sessions, écris une ligne commençant par « 📌 Mémoire : ».\n[Fin de la mémoire]";

        let push = |line: String, block: &mut String| -> bool {
            if block.chars().count() + line.chars().count() + footer.chars().count() > CONTEXT_BUDGET {
                return false;
            }
            block.push_str(&line);
            true
        };

        if !notes.is_empty() {
            push("Notes :\n".to_string(), &mut block);
            for note in &notes {
                let scope = if note.project.is_some() { "projet" } else { "général" };
                if !push(format!("- ({scope}) {}\n", note.text), &mut block) {
                    break;
                }
            }
        }

        if !journal.is_empty() {
            push("Travail récent sur ce projet :\n".to_string(), &mut block);
            for entry in &journal {
                let when = chrono::DateTime::from_timestamp(entry.at, 0)
                    .map(|utc| utc.with_timezone(&chrono::Local).format("%d/%m %H:%M").to_string())
                    .unwrap_or_default();
                let mut facts = Vec::new();
                if !entry.files.is_empty() {
                    let names: Vec<String> = entry
                        .files
                        .iter()
                        .take(4)
                        .map(|f| f.rsplit(['/', '\\']).next().unwrap_or(f).to_string())
                        .collect();
                    facts.push(format!("fichiers : {}", names.join(", ")));
                }
                if !entry.commands.is_empty() {
                    facts.push(format!("{} commande(s)", entry.commands.len()));
                }
                let facts = if facts.is_empty() { String::new() } else { format!(" [{}]", facts.join(" ; ")) };
                let line = format!(
                    "- {when} « {} »{facts} → {}\n",
                    truncate(&entry.request, 120),
                    truncate(&entry.outcome, 160)
                );
                if !push(line, &mut block) {
                    break;
                }
            }
        }

        block.push_str(footer);
        Some(block)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn service(name: &str) -> MemoryService {
        let dir = std::env::temp_dir().join(format!("archimed-memory-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        MemoryService::at(dir)
    }

    fn entry(project: &str, request: &str) -> JournalEntry {
        JournalEntry {
            at: 1_789_600_000,
            conversation_id: "c1".into(),
            origin: "code".into(),
            adapter: "claude".into(),
            project: Some(project.into()),
            title: "t".into(),
            request: request.into(),
            outcome: "Tests verts.".into(),
            files: vec!["F:/Proj/src/a.ts".into()],
            commands: vec!["pnpm test".into()],
        }
    }

    #[test]
    fn notes_are_deduplicated_and_scoped() {
        let memory = service("notes");
        memory.add_note("Utiliser pnpm, jamais npm", Some("F:\\Proj".into()), "ai").unwrap();
        memory.add_note("utiliser pnpm, jamais npm", Some("f:/proj/".into()), "ai").unwrap();
        memory.add_note("Répondre en français", None, "user").unwrap();
        assert_eq!(memory.notes().len(), 2);
        assert!(memory.add_note("   ", None, "user").is_err());

        let context = memory.build_context(Some("F:/Proj/src")).unwrap();
        assert!(context.contains("(projet) Utiliser pnpm"));
        assert!(context.contains("(général) Répondre en français"));

        let elsewhere = memory.build_context(Some("D:/Autre")).unwrap();
        assert!(!elsewhere.contains("pnpm"));
    }

    #[test]
    fn context_includes_recent_project_work_within_budget() {
        let memory = service("journal");
        for i in 0..40 {
            memory.record(entry("F:/Proj", &format!("Tâche {i} {}", "détail ".repeat(60)))).unwrap();
        }
        memory.record(entry("D:/Autre", "Ne pas inclure")).unwrap();

        let context = memory.build_context(Some("F:\\Proj")).unwrap();
        assert!(context.contains("Travail récent sur ce projet"));
        assert!(context.contains("fichiers : a.ts"));
        assert!(!context.contains("Ne pas inclure"));
        assert!(context.chars().count() <= CONTEXT_BUDGET);
        assert!(context.ends_with("[Fin de la mémoire]"));

        assert_eq!(memory.journal(Some("F:/Proj"), 3).len(), 3);
        assert!(memory.journal(Some("F:/Proj"), 1)[0].request.starts_with("Tâche 39"));
    }

    #[test]
    fn nothing_to_inject_on_empty_memory() {
        assert!(service("empty").build_context(Some("F:/Proj")).is_none());
    }
}
