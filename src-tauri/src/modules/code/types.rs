use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// `true` si le dossier est ignoré par défaut (node_modules, target…).
    pub ignored: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    /// Langage déduit de l'extension, pour la coloration syntaxique.
    pub language: String,
    pub lines: usize,
    pub truncated: bool,
    pub binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub name: String,
    /// Marqueurs trouvés : "package.json", "Cargo.toml", ".git"…
    pub markers: Vec<String>,
    /// Types déduits : "node", "rust", "python", "git"…
    pub kinds: Vec<String>,
    pub is_project: bool,
}

/// Options de la recherche dans le projet.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    /// La saisie est une expression régulière (syntaxe Rust `regex`).
    pub regex: bool,
}

/// Morceau d'un extrait de ligne : texte ordinaire ou occurrence trouvée.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSegment {
    pub text: String,
    pub hit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLine {
    /// Numéro de ligne, à partir de 1.
    pub line: usize,
    pub segments: Vec<SearchSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFile {
    pub path: String,
    /// Chemin relatif à la racine du projet, séparateurs `/`.
    pub relative: String,
    /// Occurrences dans le fichier.
    pub matches: usize,
    /// Lignes concernées mais non listées (au-delà de 100 par fichier).
    pub hidden_lines: usize,
    pub lines: Vec<SearchLine>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub files: Vec<SearchFile>,
    pub total_matches: usize,
    pub files_searched: usize,
    /// Arrêtée avant la fin : trop de résultats ou trop longue.
    pub truncated: bool,
    /// Remplacée par une recherche plus récente.
    pub cancelled: bool,
    pub duration_ms: u64,
}
