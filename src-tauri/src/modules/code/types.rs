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
