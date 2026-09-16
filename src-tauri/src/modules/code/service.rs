use std::path::{Path, PathBuf};

use crate::core::{AppError, AppResult};

use super::types::{FileContent, FileEntry, ProjectInfo};

/// Dossiers masqués par défaut dans l'arbre (toujours listables sur demande).
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    ".git",
    ".next",
    ".turbo",
    ".venv",
    "__pycache__",
    ".cache",
    "vendor",
];

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;

pub struct CodeService;

impl CodeService {
    /// Liste un dossier (non récursif) : dossiers d'abord, puis fichiers, triés.
    pub fn list_dir(path: &Path) -> AppResult<Vec<FileEntry>> {
        if !path.is_dir() {
            return Err(AppError::not_found(format!(
                "dossier introuvable : {}",
                path.display()
            )));
        }

        let mut entries = Vec::new();
        for entry in std::fs::read_dir(path)?.flatten().take(MAX_ENTRIES) {
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = metadata.is_dir();
            entries.push(FileEntry {
                ignored: is_dir && IGNORED_DIRS.contains(&name.as_str()),
                path: entry.path().display().to_string(),
                name,
                is_dir,
                size: if is_dir { 0 } else { metadata.len() },
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    /// Lit un fichier texte. Les binaires et les fichiers trop gros sont signalés,
    /// jamais chargés entièrement dans l'interface.
    pub fn read_file(path: &Path) -> AppResult<FileContent> {
        if !path.is_file() {
            return Err(AppError::not_found(format!(
                "fichier introuvable : {}",
                path.display()
            )));
        }

        let bytes = std::fs::read(path)?;
        let truncated = bytes.len() > MAX_FILE_BYTES;
        let slice = &bytes[..bytes.len().min(MAX_FILE_BYTES)];

        // Heuristique binaire : un octet nul dans les 8 premiers Ko.
        let binary = slice.iter().take(8192).any(|byte| *byte == 0);
        let content = if binary {
            String::new()
        } else {
            String::from_utf8_lossy(slice).to_string()
        };

        Ok(FileContent {
            language: language_of(path),
            lines: content.lines().count(),
            path: path.display().to_string(),
            content,
            truncated,
            binary,
        })
    }

    /// Détecte si un dossier est un projet de code et de quel type.
    pub fn project_info(path: &Path) -> AppResult<ProjectInfo> {
        if !path.is_dir() {
            return Err(AppError::not_found(format!(
                "dossier introuvable : {}",
                path.display()
            )));
        }

        let candidates: &[(&str, &str)] = &[
            ("package.json", "node"),
            ("Cargo.toml", "rust"),
            ("pyproject.toml", "python"),
            ("requirements.txt", "python"),
            ("go.mod", "go"),
            ("pom.xml", "java"),
            ("build.gradle", "java"),
            ("composer.json", "php"),
            ("Gemfile", "ruby"),
            ("CMakeLists.txt", "cpp"),
            ("pubspec.yaml", "flutter"),
            (".git", "git"),
            ("tsconfig.json", "typescript"),
            ("src-tauri", "tauri"),
        ];

        let mut markers = Vec::new();
        let mut kinds = Vec::new();
        for (marker, kind) in candidates {
            if path.join(marker).exists() {
                markers.push((*marker).to_string());
                if !kinds.contains(&(*kind).to_string()) {
                    kinds.push((*kind).to_string());
                }
            }
        }

        Ok(ProjectInfo {
            name: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.display().to_string()),
            root: path.display().to_string(),
            is_project: !markers.is_empty(),
            markers,
            kinds,
        })
    }

    /// Recherche de fichiers par fragment de nom (palette de fichiers).
    pub fn search_files(root: &Path, query: &str, limit: usize) -> AppResult<Vec<FileEntry>> {
        let needle = query.to_lowercase();
        let mut results = Vec::new();
        let mut stack = vec![root.to_path_buf()];

        while let Some(dir) = stack.pop() {
            if results.len() >= limit {
                break;
            }
            let Ok(entries) = std::fs::read_dir(&dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

                if is_dir {
                    if !IGNORED_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                        stack.push(entry.path());
                    }
                    continue;
                }
                if needle.is_empty() || name.to_lowercase().contains(&needle) {
                    results.push(FileEntry {
                        name,
                        path: entry.path().display().to_string(),
                        is_dir: false,
                        size: entry.metadata().map(|m| m.len()).unwrap_or(0),
                        ignored: false,
                    });
                    if results.len() >= limit {
                        break;
                    }
                }
            }
        }
        Ok(results)
    }
}

/// Identifiant de langage pour la coloration syntaxique côté frontend.
pub fn language_of(path: &Path) -> String {
    let extension = path
        .extension()
        .map(|ext| ext.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match file_name.as_str() {
        "dockerfile" => return "dockerfile".into(),
        "makefile" => return "makefile".into(),
        "cargo.lock" => return "toml".into(),
        _ => {}
    }

    match extension.as_str() {
        "ts" | "mts" | "cts" => "typescript",
        "tsx" => "tsx",
        "js" | "mjs" | "cjs" => "javascript",
        "jsx" => "jsx",
        "rs" => "rust",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "cc" | "hpp" | "hh" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "rb" => "ruby",
        "sh" | "bash" | "zsh" => "shell",
        "ps1" | "psm1" => "powershell",
        "sql" => "sql",
        "html" | "htm" => "html",
        "css" => "css",
        "scss" | "sass" => "sass",
        "json" => "json",
        "yaml" | "yml" => "yaml",
        "toml" => "toml",
        "xml" | "svg" => "xml",
        "md" | "mdx" => "markdown",
        "vue" => "vue",
        "svelte" => "svelte",
        "dart" => "dart",
        "lua" => "lua",
        "r" => "r",
        "ex" | "exs" => "elixir",
        "zig" => "zig",
        _ => "plaintext",
    }
    .to_string()
}

pub fn to_path(raw: &str) -> PathBuf {
    PathBuf::from(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_languages_from_extension() {
        assert_eq!(language_of(Path::new("a/b/main.rs")), "rust");
        assert_eq!(language_of(Path::new("Component.tsx")), "tsx");
        assert_eq!(language_of(Path::new("script.ps1")), "powershell");
        assert_eq!(language_of(Path::new("Dockerfile")), "dockerfile");
        assert_eq!(language_of(Path::new("inconnu.xyz")), "plaintext");
    }

    #[test]
    fn lists_directory_with_dirs_first() {
        let dir = std::env::temp_dir().join("archimed-code-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("node_modules")).unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("a.txt"), "bonjour").unwrap();

        let entries = CodeService::list_dir(&dir).unwrap();
        assert!(entries[0].is_dir);
        assert!(entries.iter().any(|e| e.name == "node_modules" && e.ignored));
        assert!(entries.iter().any(|e| e.name == "a.txt" && !e.is_dir));

        let content = CodeService::read_file(&dir.join("a.txt")).unwrap();
        assert_eq!(content.content, "bonjour");
        assert!(!content.binary);

        let info = CodeService::project_info(&dir).unwrap();
        assert!(!info.is_project);

        std::fs::write(dir.join("Cargo.toml"), "[package]").unwrap();
        let info = CodeService::project_info(&dir).unwrap();
        assert!(info.is_project);
        assert!(info.kinds.contains(&"rust".to_string()));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reports_missing_paths() {
        let missing = std::env::temp_dir().join("archimed-absent-xyz");
        assert!(CodeService::list_dir(&missing).is_err());
        assert!(CodeService::read_file(&missing).is_err());
    }
}
