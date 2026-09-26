//! Recherche de texte dans tout le projet ouvert (vue « Rechercher » du module Code).
//!
//! Parcours en profondeur du dossier, en sautant les dossiers de dépendances et de build
//! (`node_modules`, `target`, `.git`…), les fichiers binaires et ceux de plus de 2 Mo. Une
//! nouvelle recherche interrompt la précédente (compteur de génération), et chaque recherche
//! s'arrête d'elle-même au-delà d'un nombre de résultats ou d'un temps maximal.

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use regex::{Regex, RegexBuilder};

use crate::core::{AppError, AppResult};

use super::service::{is_ignored_dir, MAX_FILE_BYTES};
use super::types::{SearchFile, SearchLine, SearchOptions, SearchOutcome, SearchSegment};

/// Résultats au-delà desquels la recherche s'arrête (liste « tronquée »).
const MAX_MATCHES: usize = 2_000;
/// Lignes retenues par fichier ; les suivantes sont seulement comptées.
const MAX_LINES_PER_FILE: usize = 100;
/// Temps maximal d'une recherche.
const TIME_BUDGET: Duration = Duration::from_secs(10);
/// Longueur maximale d'un extrait de ligne (en caractères).
const PREVIEW_CHARS: usize = 220;
/// Caractères gardés avant la première occurrence quand la ligne est coupée.
const CONTEXT_BEFORE: usize = 60;

/// Numéro de la recherche en cours : une recherche plus récente interrompt les autres.
#[derive(Default)]
pub struct SearchState {
    generation: AtomicU64,
}

impl SearchState {
    pub fn begin(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }
}

/// Expression construite à partir de la saisie et des options.
pub fn build_matcher(query: &str, options: &SearchOptions) -> AppResult<Regex> {
    let body = if options.regex { query.to_string() } else { regex::escape(query) };
    let pattern = if options.whole_word { format!(r"\b(?:{body})\b") } else { body };
    RegexBuilder::new(&pattern)
        .case_insensitive(!options.case_sensitive)
        .size_limit(1 << 22)
        .build()
        .map_err(|e| AppError::invalid(format!("Expression régulière invalide : {}", first_line(&e.to_string()))))
}

fn first_line(text: &str) -> &str {
    text.lines().rfind(|line| line.trim_start().starts_with("error:")).unwrap_or(text).trim()
}

/// Filtre de chemins : motifs séparés par des virgules. Un motif avec `*` est un glob sur le
/// chemin relatif (`*` = tout sauf `/`, `**` = tout), sinon un fragment du chemin (`src/`, `.ts`).
pub struct PathFilter {
    patterns: Vec<PathPattern>,
}

enum PathPattern {
    Glob(Regex),
    Fragment(String),
}

impl PathFilter {
    pub fn parse(raw: &str) -> Self {
        let patterns = raw
            .split(',')
            .map(str::trim)
            .filter(|pattern| !pattern.is_empty())
            .filter_map(|pattern| {
                let pattern = pattern.replace('\\', "/").to_lowercase();
                if pattern.contains('*') || pattern.contains('?') {
                    glob_regex(&pattern).map(PathPattern::Glob)
                } else {
                    Some(PathPattern::Fragment(pattern))
                }
            })
            .collect();
        Self { patterns }
    }

    pub fn is_empty(&self) -> bool {
        self.patterns.is_empty()
    }

    /// `relative` : chemin relatif à la racine, séparateurs `/`, en minuscules.
    pub fn matches(&self, relative: &str) -> bool {
        self.patterns.iter().any(|pattern| match pattern {
            PathPattern::Glob(regex) => {
                // Un motif sans dossier (`*.ts`) vaut à toute profondeur.
                regex.is_match(relative) || relative.rsplit('/').next().is_some_and(|name| regex.is_match(name))
            }
            PathPattern::Fragment(fragment) => relative.contains(fragment.as_str()),
        })
    }
}

fn glob_regex(glob: &str) -> Option<Regex> {
    let mut out = String::from("^");
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                // `**/` : zéro ou plusieurs dossiers.
                if chars.peek() == Some(&'/') {
                    chars.next();
                    out.push_str("(?:.*/)?");
                } else {
                    out.push_str(".*");
                }
            }
            '*' => out.push_str("[^/]*"),
            '?' => out.push_str("[^/]"),
            other => out.push_str(&regex::escape(&other.to_string())),
        }
    }
    out.push('$');
    Regex::new(&out).ok()
}

/// Cherche `matcher` dans les fichiers texte sous `root`.
pub fn search(
    state: &SearchState,
    generation: u64,
    root: &Path,
    matcher: &Regex,
    include: &PathFilter,
    exclude: &PathFilter,
) -> AppResult<SearchOutcome> {
    if !root.is_dir() {
        return Err(AppError::not_found(format!("Dossier introuvable : {}", root.display())));
    }
    let started = Instant::now();
    let mut outcome = SearchOutcome::default();
    let mut stack = vec![root.to_path_buf()];

    'walk: while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        // Ordre stable : les résultats arrivent dans l'ordre alphabétique des dossiers.
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.file_name()));
        let mut files = Vec::new();
        for entry in entries {
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_dir() {
                if !is_ignored_dir(&name) && !name.starts_with('.') {
                    stack.push(entry.path());
                }
            } else if kind.is_file() {
                files.push(entry);
            }
        }
        files.reverse();

        for entry in files {
            if !state.is_current(generation) {
                outcome.cancelled = true;
                break 'walk;
            }
            if started.elapsed() > TIME_BUDGET {
                outcome.truncated = true;
                break 'walk;
            }
            let path = entry.path();
            let relative = relative_path(root, &path);
            let key = relative.to_lowercase();
            if (!include.is_empty() && !include.matches(&key)) || exclude.matches(&key) {
                continue;
            }
            if entry.metadata().map(|m| m.len() as usize > MAX_FILE_BYTES).unwrap_or(true) {
                continue;
            }
            let Ok(bytes) = std::fs::read(&path) else { continue };
            if looks_binary(&bytes) {
                continue;
            }
            outcome.files_searched += 1;
            let text = String::from_utf8_lossy(&bytes);
            let room = MAX_MATCHES - outcome.total_matches;
            if let Some(file) = search_text(&text, matcher, room) {
                outcome.total_matches += file.matches;
                outcome.files.push(SearchFile {
                    path: path.display().to_string(),
                    relative,
                    ..file
                });
                if outcome.total_matches >= MAX_MATCHES {
                    outcome.truncated = true;
                    break 'walk;
                }
            }
        }
    }

    outcome.duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    Ok(outcome)
}

/// Occurrences dans un texte ; `None` si aucune. `room` : occurrences encore acceptées.
pub fn search_text(text: &str, matcher: &Regex, room: usize) -> Option<SearchFile> {
    let mut lines = Vec::new();
    let mut matches = 0usize;
    let mut hidden_lines = 0usize;
    for (index, line) in text.lines().enumerate() {
        let ranges: Vec<(usize, usize)> = matcher
            .find_iter(line)
            .filter(|found| found.start() != found.end())
            .map(|found| (found.start(), found.end()))
            .collect();
        if ranges.is_empty() {
            continue;
        }
        matches += ranges.len();
        if lines.len() < MAX_LINES_PER_FILE {
            lines.push(SearchLine {
                line: index + 1,
                segments: preview(line, &ranges),
            });
        } else {
            hidden_lines += 1;
        }
        if matches >= room {
            break;
        }
    }
    (matches > 0).then(|| SearchFile {
        path: String::new(),
        relative: String::new(),
        matches,
        hidden_lines,
        lines,
    })
}

/// Découpe la ligne en morceaux (texte / occurrence), coupée autour de la première occurrence
/// si elle est trop longue. Les morceaux évitent tout calcul d'index côté interface.
fn preview(line: &str, ranges: &[(usize, usize)]) -> Vec<SearchSegment> {
    let first = ranges.first().map(|r| r.0).unwrap_or(0);
    // Début de fenêtre : quelques caractères avant la première occurrence, espaces de tête ôtés.
    let lead = line.len() - line.trim_start().len();
    let mut start = line[..first].char_indices().rev().nth(CONTEXT_BEFORE - 1).map(|(i, _)| i).unwrap_or(0);
    start = start.max(lead.min(first));
    let end = line[start..]
        .char_indices()
        .nth(PREVIEW_CHARS)
        .map(|(i, _)| start + i)
        .unwrap_or(line.len());

    let mut segments = Vec::new();
    let mut cursor = start;
    if start > lead {
        segments.push(SearchSegment { text: "…".into(), hit: false });
    }
    for &(from, to) in ranges {
        if to <= cursor || from >= end {
            continue;
        }
        let from = from.max(cursor);
        let to = to.min(end);
        if from > cursor {
            segments.push(SearchSegment { text: line[cursor..from].into(), hit: false });
        }
        segments.push(SearchSegment { text: line[from..to].into(), hit: true });
        cursor = to;
    }
    if cursor < end {
        segments.push(SearchSegment { text: line[cursor..end].into(), hit: false });
    }
    if end < line.len() {
        segments.push(SearchSegment { text: "…".into(), hit: false });
    }
    segments
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8_000).any(|&b| b == 0)
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(case_sensitive: bool, whole_word: bool, regex: bool) -> SearchOptions {
        SearchOptions { case_sensitive, whole_word, regex }
    }

    fn joined(segments: &[SearchSegment]) -> String {
        segments
            .iter()
            .map(|s| if s.hit { format!("[{}]", s.text) } else { s.text.clone() })
            .collect()
    }

    #[test]
    fn literal_search_escapes_and_ignores_case() {
        let matcher = build_matcher("a.b", &options(false, false, false)).unwrap();
        let file = search_text("x A.B y\naxb\n", &matcher, 100).unwrap();
        assert_eq!(file.matches, 1);
        assert_eq!(file.lines[0].line, 1);
        assert_eq!(joined(&file.lines[0].segments), "x [A.B] y");
    }

    #[test]
    fn whole_word_and_case_sensitive_options() {
        let matcher = build_matcher("user", &options(true, true, false)).unwrap();
        let file = search_text("user users User\nuser_id user", &matcher, 100).unwrap();
        assert_eq!(file.matches, 2);
        assert_eq!(joined(&file.lines[0].segments), "[user] users User");
        assert_eq!(file.lines[1].line, 2);
    }

    #[test]
    fn invalid_regex_is_a_readable_error() {
        let error = build_matcher("(unclosed", &options(false, false, true)).unwrap_err();
        assert!(error.to_string().contains("Expression régulière invalide"), "{error}");
    }

    #[test]
    fn long_lines_are_cut_around_the_first_match() {
        let line = format!("{}needle{}", "é".repeat(300), "x".repeat(300));
        let matcher = build_matcher("needle", &options(false, false, false)).unwrap();
        let file = search_text(&line, &matcher, 100).unwrap();
        let text = joined(&file.lines[0].segments);
        assert!(text.starts_with('…') && text.ends_with('…'), "{text}");
        assert!(text.contains("[needle]"));
        assert!(text.chars().count() < PREVIEW_CHARS + 10);
    }

    #[test]
    fn leading_indentation_is_trimmed_from_previews() {
        let matcher = build_matcher("x", &options(false, false, false)).unwrap();
        let file = search_text("        let x = 1;", &matcher, 100).unwrap();
        assert_eq!(joined(&file.lines[0].segments), "let [x] = 1;");
    }

    #[test]
    fn path_filters_accept_globs_and_fragments() {
        let include = PathFilter::parse("*.ts, src/lib");
        assert!(include.matches("app/main.ts"));
        assert!(include.matches("src/lib/util.rs"));
        assert!(!include.matches("src/main.rs"));
        let exclude = PathFilter::parse("**/generated/**");
        assert!(exclude.matches("src/generated/a.ts"));
        assert!(!exclude.matches("src/a.ts"));
        assert!(PathFilter::parse(" , ").is_empty());
    }

    #[test]
    fn walks_the_project_skipping_dependencies_and_binaries() {
        let root = std::env::temp_dir().join(format!("archimed-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        std::fs::write(root.join("src/app.ts"), "const token = 1;\n// token again token\n").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.js"), "token").unwrap();
        std::fs::write(root.join("image.bin"), [0u8, 1, 2, b't', b'o', b'k', b'e', b'n']).unwrap();
        std::fs::write(root.join("README.md"), "no match here").unwrap();

        let state = SearchState::default();
        let generation = state.begin();
        let matcher = build_matcher("token", &options(false, false, false)).unwrap();
        let outcome = search(&state, generation, &root, &matcher, &PathFilter::parse(""), &PathFilter::parse("")).unwrap();
        assert_eq!(outcome.files.len(), 1);
        assert_eq!(outcome.files[0].relative, "src/app.ts");
        assert_eq!(outcome.total_matches, 3);
        assert_eq!(outcome.files_searched, 2);
        assert!(!outcome.truncated && !outcome.cancelled);

        // Une recherche plus récente interrompt celle-ci.
        state.begin();
        let stale = search(&state, generation, &root, &matcher, &PathFilter::parse(""), &PathFilter::parse("")).unwrap();
        assert!(stale.cancelled);
        let _ = std::fs::remove_dir_all(&root);
    }
}
