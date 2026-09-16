//! Lecture et écriture d'un `roadmap.md` au format « checklist Markdown » :
//!
//! ```markdown
//! # Roadmap du projet
//! ## Phase 1 — Fondations          ← section (colonne du tableau)
//! - [x] Initialiser le dépôt        ← tâche terminée
//! - [ ] Écrire le parseur @2026-10-01   ← échéance optionnelle « @AAAA-MM-JJ »
//!   - [ ] Sous-tâche                ← sous-tâche (checklist de la carte parente)
//! ```
//!
//! Une IA peut produire ce fichier : ARCHIMED le relit à chaque modification et
//! réécrit uniquement la case `[ ]`/`[x]` quand l'utilisateur coche une carte.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::core::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapSubtask {
    pub title: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapTask {
    pub title: String,
    pub done: bool,
    /// Date au format `AAAA-MM-JJ` extraite d'un suffixe `@AAAA-MM-JJ`.
    pub due: Option<String>,
    pub subtasks: Vec<RoadmapSubtask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapSection {
    pub title: String,
    pub tasks: Vec<RoadmapTask>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RoadmapDoc {
    pub title: Option<String>,
    pub sections: Vec<RoadmapSection>,
    pub total: usize,
    pub done: usize,
}

/// Regex constantes compilées une fois. `None` seulement si le motif était invalide,
/// ce que les tests unitaires excluent : on dégrade alors sans paniquer.
fn compiled(cell: &'static OnceLock<Option<Regex>>, pattern: &str) -> Option<&'static Regex> {
    cell.get_or_init(|| Regex::new(pattern).ok()).as_ref()
}

fn task_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    compiled(&RE, r"^(?P<indent>\s*)[-*+]\s+\[(?P<mark>[ xX])\]\s+(?P<text>.+?)\s*$")
}

fn heading_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    compiled(&RE, r"^(?P<level>#{1,6})\s+(?P<text>.+?)\s*#*\s*$")
}

fn due_regex() -> Option<&'static Regex> {
    static RE: OnceLock<Option<Regex>> = OnceLock::new();
    compiled(&RE, r"\s*@(?P<date>\d{4}-\d{2}-\d{2})\b")
}

/// Sépare le titre et l'échéance `@AAAA-MM-JJ`.
fn split_due(text: &str) -> (String, Option<String>) {
    let Some(re) = due_regex() else {
        return (text.trim().to_string(), None);
    };
    let due = re
        .captures(text)
        .and_then(|captures| captures.name("date"))
        .map(|date| date.as_str().to_string());
    let title = re.replace_all(text, "").trim().to_string();
    (title, due)
}

/// Normalise un titre pour identifier une tâche d'une lecture à l'autre.
pub fn task_key(title: &str) -> String {
    split_due(title)
        .0
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn parse(markdown: &str) -> RoadmapDoc {
    let (Some(task_re), Some(heading_re)) = (task_regex(), heading_regex()) else {
        return RoadmapDoc { title: None, sections: Vec::new(), total: 0, done: 0 };
    };
    let mut title = None;
    let mut sections: Vec<RoadmapSection> = Vec::new();

    for line in markdown.lines() {
        if let Some(captures) = heading_re.captures(line) {
            let level = captures.name("level").map(|m| m.as_str().len()).unwrap_or(1);
            let text = captures.name("text").map(|m| m.as_str().trim()).unwrap_or_default();
            if level == 1 && title.is_none() && sections.is_empty() {
                title = Some(text.to_string());
            } else {
                sections.push(RoadmapSection {
                    title: text.to_string(),
                    tasks: Vec::new(),
                });
            }
            continue;
        }

        let Some(captures) = task_re.captures(line) else {
            continue;
        };
        let indent = captures.name("indent").map(|m| m.as_str().len()).unwrap_or(0);
        let done = captures
            .name("mark")
            .map(|m| m.as_str().eq_ignore_ascii_case("x"))
            .unwrap_or(false);
        let text = captures.name("text").map(|m| m.as_str()).unwrap_or_default();

        if sections.is_empty() {
            sections.push(RoadmapSection {
                title: "Tâches".to_string(),
                tasks: Vec::new(),
            });
        }
        let Some(section) = sections.last_mut() else {
            continue;
        };

        if indent >= 2 {
            if let Some(parent) = section.tasks.last_mut() {
                parent.subtasks.push(RoadmapSubtask {
                    title: split_due(text).0,
                    done,
                });
                continue;
            }
        }

        let (task_title, due) = split_due(text);
        section.tasks.push(RoadmapTask {
            title: task_title,
            done,
            due,
            subtasks: Vec::new(),
        });
    }

    sections.retain(|section| !section.tasks.is_empty());
    let total = sections.iter().map(|s| s.tasks.len()).sum();
    let done = sections
        .iter()
        .flat_map(|s| s.tasks.iter())
        .filter(|t| t.done)
        .count();

    RoadmapDoc {
        title,
        sections,
        total,
        done,
    }
}

/// Coche ou décoche la tâche principale dont le titre correspond (hors indentation).
/// Retourne le Markdown modifié ; les fins de ligne d'origine sont conservées.
pub fn set_task_done(markdown: &str, title: &str, done: bool) -> AppResult<String> {
    let task_re = task_regex().ok_or_else(|| AppError::internal("motif de tâche invalide"))?;
    let wanted = task_key(title);
    let newline = if markdown.contains("\r\n") { "\r\n" } else { "\n" };
    let mut found = false;

    let lines: Vec<String> = markdown
        .lines()
        .map(|line| {
            if found {
                return line.to_string();
            }
            let Some(captures) = task_re.captures(line) else {
                return line.to_string();
            };
            let indent = captures.name("indent").map(|m| m.as_str().len()).unwrap_or(0);
            let text = captures.name("text").map(|m| m.as_str()).unwrap_or_default();
            if indent >= 2 || task_key(text) != wanted {
                return line.to_string();
            }
            found = true;
            match captures.name("mark") {
                Some(mark) => {
                    let mut updated = line.to_string();
                    updated.replace_range(mark.range(), if done { "x" } else { " " });
                    updated
                }
                None => line.to_string(),
            }
        })
        .collect();

    if !found {
        return Err(AppError::not_found(format!(
            "tâche « {title} » introuvable dans la roadmap"
        )));
    }

    let mut output = lines.join(newline);
    if markdown.ends_with('\n') {
        output.push_str(newline);
    }
    Ok(output)
}

/// Ajoute des tâches à la fin d'une section (créée si absente).
pub fn append_tasks(markdown: &str, section: &str, tasks: &[String]) -> String {
    let newline = if markdown.contains("\r\n") { "\r\n" } else { "\n" };
    let mut lines: Vec<String> = markdown.lines().map(str::to_string).collect();
    let wanted = section.trim().to_lowercase();

    let is_heading = |line: &str| heading_regex().map(|re| re.is_match(line)).unwrap_or(false);
    let heading_index = lines.iter().position(|line| {
        heading_regex()
            .and_then(|re| re.captures(line))
            .and_then(|c| c.name("text"))
            .map(|text| text.as_str().trim().to_lowercase() == wanted)
            .unwrap_or(false)
    });

    let new_lines: Vec<String> = tasks.iter().map(|task| format!("- [ ] {task}")).collect();

    match heading_index {
        Some(index) => {
            // Insère après la dernière ligne non vide de la section.
            let mut insert_at = index + 1;
            for (offset, line) in lines.iter().enumerate().skip(index + 1) {
                if is_heading(line) {
                    break;
                }
                if !line.trim().is_empty() {
                    insert_at = offset + 1;
                }
            }
            for (i, line) in new_lines.into_iter().enumerate() {
                lines.insert(insert_at + i, line);
            }
        }
        None => {
            if lines.last().map(|l| !l.trim().is_empty()).unwrap_or(false) {
                lines.push(String::new());
            }
            lines.push(format!("## {section}"));
            lines.extend(new_lines);
        }
    }

    let mut output = lines.join(newline);
    output.push_str(newline);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "# Roadmap ARCHIMED\n\nIntro libre.\n\n## Phase 1 — Fondations\n- [x] Initialiser le dépôt\n- [ ] Écrire le parseur @2026-10-01\n  - [x] Sections\n  - [ ] Échéances\n\n## Phase 2\n* [ ] Transport PTY\n";

    #[test]
    fn parses_sections_tasks_due_and_subtasks() {
        let doc = parse(SAMPLE);
        assert_eq!(doc.title.as_deref(), Some("Roadmap ARCHIMED"));
        assert_eq!(doc.sections.len(), 2);
        assert_eq!(doc.total, 3);
        assert_eq!(doc.done, 1);

        let parser = &doc.sections[0].tasks[1];
        assert_eq!(parser.title, "Écrire le parseur");
        assert_eq!(parser.due.as_deref(), Some("2026-10-01"));
        assert_eq!(parser.subtasks.len(), 2);
        assert!(parser.subtasks[0].done);
        assert_eq!(doc.sections[1].tasks[0].title, "Transport PTY");
    }

    #[test]
    fn toggles_only_the_matching_top_level_task() {
        let updated = set_task_done(SAMPLE, "écrire le parseur", true).unwrap();
        assert!(updated.contains("- [x] Écrire le parseur @2026-10-01"));
        assert!(updated.contains("  - [ ] Échéances"));
        assert!(updated.ends_with('\n'));

        let reverted = set_task_done(&updated, "Initialiser le dépôt", false).unwrap();
        assert!(reverted.contains("- [ ] Initialiser le dépôt"));
    }

    #[test]
    fn keeps_windows_line_endings() {
        let crlf = SAMPLE.replace('\n', "\r\n");
        let updated = set_task_done(&crlf, "Transport PTY", true).unwrap();
        assert!(updated.contains("* [x] Transport PTY\r\n"));
        assert!(!updated.contains("\r\r"));
    }

    #[test]
    fn reports_unknown_task() {
        assert!(set_task_done(SAMPLE, "Tâche fantôme", true).is_err());
    }

    #[test]
    fn appends_to_existing_or_new_section() {
        let appended = append_tasks(SAMPLE, "Phase 1 — Fondations", &["Documenter".into()]);
        let doc = parse(&appended);
        assert_eq!(doc.sections[0].tasks.last().unwrap().title, "Documenter");

        let created = append_tasks(SAMPLE, "Phase 3", &["Planner".into(), "Agenda".into()]);
        let doc = parse(&created);
        assert_eq!(doc.sections.last().unwrap().title, "Phase 3");
        assert_eq!(doc.sections.last().unwrap().tasks.len(), 2);
    }
}
